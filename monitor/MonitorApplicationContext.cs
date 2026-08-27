using Microsoft.Win32;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace FoxWatchMonitor;

internal sealed class MonitorApplicationContext : ApplicationContext
{
    private const int ShowWindowRestore = 9;
    private const string StartupRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string StartupValueName = "Nixie FoxWatch Monitor";
    private readonly MonitorHostOptions _options;
    private readonly MonitorSettings _settings;
    private readonly EventWaitHandle _showEvent;
    private readonly EventWaitHandle _exitEvent;
    private readonly Icon _appIcon;
    private readonly MonitorForm _form;
    private readonly NotifyIcon _notifyIcon;
    private readonly ToolStripMenuItem _startStopMenuItem;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly ConcurrentQueue<string> _pendingProcessLines = new();
    private Process? _activeProcess;
    private RunnerOperation _activeOperation;
    private DateTimeOffset _nextPollAt;
    private DateTimeOffset _lastStateReadAt = DateTimeOffset.MinValue;
    private int _pipelinePercent;
    private int _renderSceneTotal;
    private int _renderCompletedScenes;
    private int _renderWorkerCount;
    private DateTimeOffset? _pipelineStartedAt;
    private DateTimeOffset? _pipelineCompletedAt;
    private DateTimeOffset? _renderStartedAt;
    private bool _paused;
    private bool _stopRequested;
    private bool _exitWhenIdle;
    private bool _shuttingDown;

    public MonitorApplicationContext(
        MonitorHostOptions options,
        MonitorSettings settings,
        bool startHidden,
        bool startPaused,
        EventWaitHandle showEvent,
        EventWaitHandle exitEvent)
    {
        _options = options;
        _settings = settings;
        _showEvent = showEvent;
        _exitEvent = exitEvent;
        _paused = startPaused || settings.PollingStopped;
        _appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath)
            ?? (Icon)SystemIcons.Application.Clone();
        _form = new MonitorForm(_appIcon);
        // Create the native handle on the UI thread before named-event callbacks
        // can request Show/Exit from ThreadPool threads.
        _ = _form.Handle;
        _form.StartRequested += (_, _) => StartPollingNow();
        _form.StopRequested += (_, _) => StopRunAndPolling();
        _form.RunRefreshRequested += (_, _) => StartFullRefresh();
        _form.ClearCacheRequested += (_, _) => ConfirmAndClearCache();
        _form.OpenLogsRequested += (_, _) => OpenLogsFolder();
        _form.StartWithWindowsChanged += (_, enabled) => SetStartWithWindows(enabled);
        _form.StartMinimizedChanged += (_, enabled) => SetStartMinimized(enabled);
        _form.SetStartWithWindows(IsStartWithWindowsEnabled());
        _form.SetStartMinimized(_settings.StartMinimized);

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Monitor", null, (_, _) => ShowWindow());
        _startStopMenuItem = new ToolStripMenuItem("Stop", null, (_, _) =>
        {
            if (_paused && _activeProcess is null) StartPollingNow();
            else StopRunAndPolling();
        });
        menu.Items.Add(_startStopMenuItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => RequestExit(promptIfRunning: true));
        _notifyIcon = new NotifyIcon
        {
            Icon = _appIcon,
            Text = "FoxWatch Monitor — Starting",
            Visible = true,
            ContextMenuStrip = menu,
        };
        _notifyIcon.DoubleClick += (_, _) => ShowWindow();

        _nextPollAt = _paused
            ? DateTimeOffset.Now.AddMinutes(_options.IntervalMinutes)
            : DateTimeOffset.Now.AddSeconds(5);
        _timer = new System.Windows.Forms.Timer { Interval = 250 };
        _timer.Tick += (_, _) => OnTick();
        _timer.Start();
        SetStoppedControls(_paused);
        UpdateStatus(
            _paused ? "Stopped" : "Starting",
            _paused ? "Automatic polling is stopped." : "Preparing the first Steam metadata poll.");
        _form.SetPipelineProgress(
            _paused ? "Stopped" : "Waiting",
            _paused ? "Automatic polling is stopped." : "Waiting for the first Steam metadata poll.",
            0);
        RefreshStateDisplay();
        if (!startHidden) ShowWindow();
    }

    public void RequestExit(bool promptIfRunning = true)
    {
        OnUi(() =>
        {
            if (_activeProcess is not null)
            {
                if (promptIfRunning)
                {
                    var result = MessageBox.Show(
                        _form,
                        "FoxWatch is currently running. Exit after the active run finishes?",
                        "Exit FoxWatch Monitor",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Question);
                    if (result != DialogResult.Yes) return;
                }
                _exitWhenIdle = true;
                _paused = true;
                SetStoppedControls(true);
                UpdateStatus("Finishing", "The monitor will exit after the active FoxWatch run finishes.");
                return;
            }
            Shutdown();
        });
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _timer.Dispose();
            _notifyIcon.Dispose();
            _activeProcess?.Dispose();
            _form.Dispose();
            _appIcon.Dispose();
        }
        base.Dispose(disposing);
    }

    private void OnTick()
    {
        FlushPendingProcessLines();
        if (_showEvent.WaitOne(0))
        {
            HostDiagnostics.Write("consumed show event");
            ShowWindow();
        }
        if (_exitEvent.WaitOne(0)) RequestExit(promptIfRunning: false);
        if (DateTimeOffset.Now - _lastStateReadAt >= TimeSpan.FromSeconds(2))
        {
            RefreshStateDisplay();
            _lastStateReadAt = DateTimeOffset.Now;
        }
        UpdateCountdown();
        UpdateElapsedTime();
        if (!_paused && _activeProcess is null && DateTimeOffset.Now >= _nextPollAt)
            StartPoll();
    }

    private void StartPollingNow()
    {
        if (_activeProcess is not null)
        {
            ShowWindow();
            UpdateStatus("Running", "A FoxWatch poll is already active.");
            return;
        }
        _paused = false;
        PersistPollingStopped(false);
        SetStoppedControls(false);
        _nextPollAt = DateTimeOffset.Now;
        StartPoll();
    }

    private void StartPoll()
    {
        StartRunnerOperation(
            RunnerOperation.Poll,
            "monitor-once",
            [],
            "Starting Poll",
            "Starting Steam metadata and FoxWatch checks.");
    }

    private void StartFullRefresh()
    {
        if (_activeProcess is not null)
        {
            UpdateStatus("Running", "A FoxWatch operation is already active.");
            return;
        }
        StartRunnerOperation(
            RunnerOperation.Refresh,
            "monitor-now",
            ["--force-refresh"],
            "Starting Refresh",
            "Starting a full refresh for the latest verified Foxhole build.");
    }

    private void ConfirmAndClearCache()
    {
        if (_activeProcess is not null)
        {
            UpdateStatus("Running", "Stop the active FoxWatch operation before clearing its cache.");
            return;
        }
        var result = MessageBox.Show(
            _form,
            "Clear FoxWatch's decoded package, mesh, material, texture, icon, and pipeline caches?\n\n"
            + "Steam installations, monitor settings, logs, rendered outputs, and published assets will be preserved. "
            + "The next refresh will rebuild the cache.",
            "Clear FoxWatch Cache",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning,
            MessageBoxDefaultButton.Button2);
        if (result != DialogResult.Yes) return;
        StartRunnerOperation(
            RunnerOperation.ClearCache,
            "clear-cache",
            [],
            "Clearing Cache",
            "Removing generated FoxWatch caches while preserving installations and published assets.");
    }

    private void StartRunnerOperation(
        RunnerOperation operation,
        string command,
        IReadOnlyList<string> commandArguments,
        string initialStage,
        string initialDetail)
    {
        if (_activeProcess is not null || _shuttingDown) return;
        _pipelinePercent = 0;
        _renderSceneTotal = 0;
        _renderCompletedScenes = 0;
        _renderWorkerCount = 0;
        _pipelineStartedAt = DateTimeOffset.Now;
        _pipelineCompletedAt = null;
        _renderStartedAt = null;
        _form.ResetWorkerProgress();
        _form.SetPipelineProgress(initialStage, initialDetail, 0);
        _form.SetTiming("0s");
        _form.SetActionsEnabled(false);
        SetStoppedControls(false);
        var startInfo = new ProcessStartInfo
        {
            FileName = _options.NodePath,
            WorkingDirectory = _options.RepoRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.ArgumentList.Add(_options.RunnerScriptPath);
        startInfo.ArgumentList.Add(command);
        foreach (var argument in commandArguments)
            startInfo.ArgumentList.Add(argument);

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, eventArgs) => AppendProcessLine(eventArgs.Data);
        process.ErrorDataReceived += (_, eventArgs) => AppendProcessLine(eventArgs.Data);
        process.Exited += (_, _) => OnUi(() => CompletePoll(process));
        try
        {
            if (!process.Start()) throw new InvalidOperationException("The monitor process did not start.");
            _activeProcess = process;
            _activeOperation = operation;
            HostDiagnostics.Write($"started {command} pid={process.Id}");
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            UpdateStatus("Running", $"Steam and FoxWatch monitor process {process.Id} is active.");
        }
        catch (Exception error)
        {
            process.Dispose();
            _activeOperation = RunnerOperation.None;
            _form.SetActionsEnabled(true);
            SetStoppedControls(_paused);
            _nextPollAt = DateTimeOffset.Now.AddMinutes(_options.IntervalMinutes);
            UpdateStatus("Failed", error.Message);
            _form.SetPipelineProgress("Failed", error.Message, _pipelinePercent);
        }
    }

    private void CompletePoll(Process process)
    {
        if (!ReferenceEquals(_activeProcess, process)) return;
        // Exited can fire before asynchronous stdout/stderr handlers deliver
        // their final lines. Drain them before committing terminal UI state.
        process.WaitForExit();
        FlushPendingProcessLines(int.MaxValue);
        var exitCode = process.ExitCode;
        var operation = _activeOperation;
        _activeOperation = RunnerOperation.None;
        var stoppedByUser = _stopRequested;
        _stopRequested = false;
        HostDiagnostics.Write($"monitor-once pid={process.Id} exited code={exitCode}");
        process.Dispose();
        _activeProcess = null;
        _form.SetActionsEnabled(true);
        _nextPollAt = DateTimeOffset.Now.AddMinutes(_options.IntervalMinutes);
        if (stoppedByUser)
        {
            while (_pendingProcessLines.TryDequeue(out _)) { }
            _pipelineCompletedAt = DateTimeOffset.Now;
            UpdateStatus("Stopped", "The active FoxWatch run was stopped. Automatic polling remains stopped.");
            _form.SetPipelineProgress("Stopped", "The active run and automatic polling were stopped.", _pipelinePercent);
            SetStoppedControls(true);
        }
        else if (exitCode == 0)
        {
            _pipelineCompletedAt = DateTimeOffset.Now;
            var completion = operation switch
            {
                RunnerOperation.Refresh => ("Refresh Complete", "The full FoxWatch refresh completed successfully."),
                RunnerOperation.ClearCache => ("Cache Cleared", "FoxWatch caches were cleared. The next refresh will rebuild them."),
                _ => ("Complete", "The latest poll and any required FoxWatch work completed successfully."),
            };
            UpdateStatus(_paused ? "Stopped" : "Idle", completion.Item2);
            _pipelinePercent = 100;
            _form.SetPipelineProgress(completion.Item1, completion.Item2, 100);
        }
        else
        {
            _pipelineCompletedAt = DateTimeOffset.Now;
            var operationName = operation switch
            {
                RunnerOperation.Refresh => "refresh",
                RunnerOperation.ClearCache => "cache clear",
                _ => "monitor poll",
            };
            UpdateStatus("Failed", $"The FoxWatch {operationName} exited with code {exitCode}.");
            _form.SetPipelineProgress("Failed", $"The FoxWatch {operationName} exited with code {exitCode}.", _pipelinePercent);
        }
        SetStoppedControls(_paused);
        RefreshStateDisplay();
        if (_exitWhenIdle) Shutdown();
    }

    private void StopRunAndPolling()
    {
        if (_shuttingDown) return;
        _paused = true;
        PersistPollingStopped(true);
        _nextPollAt = DateTimeOffset.MaxValue;
        if (_activeProcess is null)
        {
            SetStoppedControls(true);
            UpdateStatus("Stopped", "Automatic Steam polling is stopped.");
            _form.SetPipelineProgress("Stopped", "Automatic polling is stopped. Select Start to continue.", _pipelinePercent);
            return;
        }

        var process = _activeProcess;
        _stopRequested = true;
        SetStoppedControls(true, stopping: true);
        UpdateStatus("Stopping", $"Stopping FoxWatch process {process.Id} and all child processes.");
        _form.SetPipelineProgress("Stopping", "Stopping the active run and disabling automatic polling.", _pipelinePercent);
        HostDiagnostics.Write($"stopping monitor-once pid={process.Id} with entire process tree");
        try
        {
            process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException) when (process.HasExited)
        {
            // The normal Exited callback will complete the stopped transition.
        }
        catch (Exception error)
        {
            _stopRequested = false;
            SetStoppedControls(false);
            UpdateStatus("Failed", $"Could not stop FoxWatch process {process.Id}: {error.Message}");
            _form.SetPipelineProgress("Stop Failed", error.Message, _pipelinePercent);
        }
    }

    private void SetStoppedControls(bool stopped, bool stopping = false)
    {
        _form.SetStopped(stopped, stopping);
        _startStopMenuItem.Text = stopping ? "Stopping..." : stopped ? "Start" : "Stop";
        _startStopMenuItem.Enabled = !stopping;
    }

    private void PersistPollingStopped(bool stopped)
    {
        _settings.PollingStopped = stopped;
        _settings.Save(_options.SettingsPath);
    }

    private void UpdateStatus(string status, string detail)
    {
        _form.SetStatus(status, detail);
        var tooltip = $"FoxWatch Monitor — {status}";
        _notifyIcon.Text = tooltip.Length <= 63 ? tooltip : tooltip[..63];
    }

    private void UpdateCountdown()
    {
        if (_activeProcess is not null)
        {
            _form.SetNextPoll($"{_options.IntervalMinutes} min after this run completes");
            return;
        }
        if (_paused)
        {
            _form.SetNextPoll("Stopped");
            return;
        }
        _form.SetNextPoll(FormatPollTime(_nextPollAt));
    }

    private static string FormatPollTime(DateTimeOffset value)
    {
        var local = value.LocalDateTime;
        if (local.Date == DateTime.Today)
            return $"Today at {local:h:mm:ss tt}";
        if (local.Date == DateTime.Today.AddDays(1))
            return $"Tomorrow at {local:h:mm:ss tt}";
        return local.ToString("ddd, MMM d 'at' h:mm:ss tt");
    }

    private void RefreshStateDisplay()
    {
        try
        {
            if (!File.Exists(_options.StatePath))
            {
                _form.SetBuildState("No completed poll yet", "—");
                return;
            }
            using var document = JsonDocument.Parse(File.ReadAllText(_options.StatePath));
            var root = document.RootElement;
            var branch = GetString(root, "selectedBranch") ?? "none";
            var buildId = GetString(root, "selectedBuildId") ?? "none";
            var successfulBuild = "none";
            var lastError = (string?)null;
            if (root.TryGetProperty("branches", out var branches)
                && branches.TryGetProperty(branch, out var branchState))
            {
                successfulBuild = GetString(branchState, "successfulBuildId") ?? "none";
                lastError = GetString(branchState, "lastError");
            }
            _form.SetBuildState($"{branch} · {buildId}", successfulBuild);
            if (_activeProcess is null && !_paused && !string.IsNullOrWhiteSpace(lastError))
                UpdateStatus("Failed", lastError);
        }
        catch (Exception error)
        {
            _form.SetBuildState("State unavailable", error.Message);
        }
    }

    private static string? GetString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private void AppendProcessLine(string? line)
    {
        if (line is null) return;
        _pendingProcessLines.Enqueue(line);
    }

    private void FlushPendingProcessLines(int maximumLines = 4_000)
    {
        if (_pendingProcessLines.IsEmpty) return;
        var lineCount = 0;
        while (lineCount < maximumLines && _pendingProcessLines.TryDequeue(out var line))
        {
            lineCount += 1;
            UpdatePipelineDetail(line);
        }
    }

    private void UpdatePipelineDetail(string line)
    {
        if (TryUpdateStructuredProgress(line)) return;
        if (line.Contains("Checking Steam branch metadata", StringComparison.OrdinalIgnoreCase))
            SetPipelineStage("Checking Steam", "Checking public and devbranch Steam metadata.", 2);
        else if (line.Contains("Acquiring Steam", StringComparison.OrdinalIgnoreCase))
            SetPipelineStage("Acquiring Game Build", "Downloading and validating the selected Foxhole build.", 5);
        else if (line.Contains("is already acquired and verified", StringComparison.OrdinalIgnoreCase))
            SetPipelineStage("Game Build Ready", "The selected Steam build is already acquired and verified.", 7);
        else if (line.Contains("Generating FoxWatch manifest", StringComparison.OrdinalIgnoreCase))
            SetPipelineStage("Preparing Manifest", "Generating the FoxWatch manifest.", 25);
        else if (line.Contains("Deep asset cache", StringComparison.OrdinalIgnoreCase))
            SetPipelineStage("Preparing Render Assets", "Preparing decoded assets for rendering.", 40);
        else if (line.Contains("Deep refresh: rendering", StringComparison.OrdinalIgnoreCase))
            SetPipelineStage("Rendering", "Rendering FoxWatch scenes in Blender.", 50, showWorkers: true);
        else if (line.Contains("publish-manifest:", StringComparison.OrdinalIgnoreCase))
            SetPipelineStage("Publishing", "Publishing the generated FoxWatch assets and manifest.", 92);
        else if (line.Contains("completed successfully", StringComparison.OrdinalIgnoreCase))
            SetPipelineStage("Finalizing", "FoxWatch completed successfully; finalizing monitor state.", 99);
    }

    private bool TryUpdateStructuredProgress(string line)
    {
        const string prefix = "FOXWATCH_PROGRESS ";
        var prefixIndex = line.IndexOf(prefix, StringComparison.Ordinal);
        if (prefixIndex < 0) return false;
        try
        {
            using var document = JsonDocument.Parse(line[(prefixIndex + prefix.Length)..]);
            var root = document.RootElement;
            var kind = GetString(root, "kind") ?? string.Empty;
            var stage = GetString(root, "stage") ?? "Running";
            var detail = GetString(root, "detail") ?? string.Empty;
            var percent = GetInt32(root, "overallPercent", _pipelinePercent);
            if (kind == "pipeline")
            {
                SetPipelineStage(stage, detail, percent);
                return true;
            }
            if (kind == "blender-start")
            {
                _renderSceneTotal = GetInt32(root, "sceneTotal", 0);
                _renderCompletedScenes = 0;
                _renderWorkerCount = GetInt32(root, "workerCount", 1);
                _renderStartedAt = DateTimeOffset.Now;
                _form.ResetWorkerProgress();
                SetPipelineStage(stage, detail, percent, showWorkers: true);
                _form.SetRenderSummary(0, GetInt32(root, "batchTotal", 0), _renderSceneTotal);
                return true;
            }
            if (kind == "blender-worker-wait")
            {
                var worker = GetInt32(root, "worker", 0);
                var reason = GetString(root, "reason") switch
                {
                    "memory-guard" => "Memory Guard",
                    "exclusive-batch" => "Waiting",
                    "resource-match" => "Waiting",
                    _ => "Waiting",
                };
                _form.SetWorkerWaiting(worker, reason, detail);
                return true;
            }
            if (kind is "blender-batch-start" or "blender-scene" or "blender-batch")
            {
                var worker = GetInt32(root, "worker", 0);
                var batch = GetInt32(root, "batch", 0);
                var batchTotal = GetInt32(root, "batchTotal", 0);
                var scene = GetInt32(root, "scene", 0);
                var sceneTotal = GetInt32(root, "sceneTotal", 0);
                var completedBatches = GetInt32(root, "completedBatches", 0);
                _renderCompletedScenes = GetInt32(root, "completedScenes", _renderCompletedScenes);
                var sceneEntry = GetString(root, "sceneEntry");
                var structureId = GetString(root, "structureId");
                var sceneLabel = kind switch
                {
                    "blender-batch-start" => detail,
                    "blender-batch" => "Batch Complete",
                    _ => FormatSceneLabel(sceneEntry, structureId),
                };
                var workerLabel = _renderWorkerCount == 1 ? "One Blender worker is" : $"{_renderWorkerCount} Blender workers are";
                SetPipelineStage("Rendering", $"{workerLabel} rendering FoxWatch scenes.", percent, showWorkers: true);
                _form.SetRenderSummary(completedBatches, batchTotal, _renderSceneTotal);
                _form.SetWorkerProgress(worker, batch, scene, sceneTotal, sceneLabel);
                return true;
            }
        }
        catch (JsonException error)
        {
            HostDiagnostics.Write($"ignored malformed FoxWatch progress: {error.Message}");
        }
        return false;
    }

    private void SetPipelineStage(string stage, string detail, int percent, bool showWorkers = false)
    {
        _pipelinePercent = Math.Clamp(percent, 0, 100);
        UpdateStatus("Running", $"{stage} — {detail}");
        _form.SetPipelineProgress(stage, detail, _pipelinePercent, showWorkers);
    }

    private static int GetInt32(JsonElement element, string propertyName, int fallback)
    {
        return element.TryGetProperty(propertyName, out var value) && value.TryGetInt32(out var parsed)
            ? parsed
            : fallback;
    }

    private static string FormatSceneLabel(string? sceneEntry, string? structureId)
    {
        var normalized = sceneEntry?.Replace('\\', '/').Trim('/');
        if (!string.IsNullOrWhiteSpace(normalized))
        {
            const string suffix = ".scene.json";
            if (normalized.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                normalized = normalized[..^suffix.Length];
            return normalized;
        }
        return string.IsNullOrWhiteSpace(structureId) ? "Rendering" : structureId;
    }

    private void UpdateElapsedTime()
    {
        if (_pipelineStartedAt is null) return;
        var elapsed = (_pipelineCompletedAt ?? DateTimeOffset.Now) - _pipelineStartedAt.Value;
        string? remaining = null;
        if (_activeProcess is not null
            && _renderStartedAt is not null
            && _renderCompletedScenes > 0
            && _renderCompletedScenes < _renderSceneTotal)
        {
            var renderElapsedSeconds = Math.Max((DateTimeOffset.Now - _renderStartedAt.Value).TotalSeconds, 1);
            var remainingSeconds = renderElapsedSeconds
                * (_renderSceneTotal - _renderCompletedScenes)
                / _renderCompletedScenes;
            remaining = FormatDuration(TimeSpan.FromSeconds(remainingSeconds));
        }
        _form.SetTiming(FormatDuration(elapsed), remaining);
    }

    private static string FormatDuration(TimeSpan duration)
    {
        if (duration.TotalHours >= 1)
            return $"{(int)duration.TotalHours}h {duration.Minutes}m {duration.Seconds}s";
        if (duration.TotalMinutes >= 1)
            return $"{duration.Minutes}m {duration.Seconds}s";
        return $"{Math.Max(0, duration.Seconds)}s";
    }

    private void OpenLogsFolder()
    {
        Directory.CreateDirectory(_options.LogsRoot);
        Process.Start(new ProcessStartInfo { FileName = _options.LogsRoot, UseShellExecute = true });
    }

    private bool IsStartWithWindowsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(StartupRegistryPath);
        return key?.GetValue(StartupValueName) is string;
    }

    private void SetStartWithWindows(bool enabled)
    {
        HostDiagnostics.Write($"start-with-Windows changed enabled={enabled}");
        using var key = Registry.CurrentUser.CreateSubKey(StartupRegistryPath);
        if (enabled)
        {
            key.SetValue(StartupValueName, BuildStartupCommand());
        }
        else
        {
            key.DeleteValue(StartupValueName, throwOnMissingValue: false);
        }
        _form.SetStartWithWindows(enabled);
    }

    private void SetStartMinimized(bool enabled)
    {
        HostDiagnostics.Write($"start-minimized changed enabled={enabled}");
        _settings.StartMinimized = enabled;
        _settings.Save(_options.SettingsPath);
        _form.SetStartMinimized(enabled);
        if (IsStartWithWindowsEnabled())
        {
            using var key = Registry.CurrentUser.CreateSubKey(StartupRegistryPath);
            key.SetValue(StartupValueName, BuildStartupCommand());
        }
    }

    private string BuildStartupCommand()
    {
        var executable = Environment.ProcessPath
            ?? throw new InvalidOperationException("Unable to locate the FoxWatch monitor executable.");
        return _settings.StartMinimized
            ? $"\"{executable}\" --background"
            : $"\"{executable}\"";
    }

    private void ShowWindow()
    {
        if (_shuttingDown) return;
        _form.ShowInTaskbar = true;
        if (!_form.Visible) _form.Show();
        if (_form.WindowState == FormWindowState.Minimized) _form.WindowState = FormWindowState.Normal;
        NativeMethods.ShowWindow(_form.Handle, ShowWindowRestore);
        _form.Activate();
        _form.BringToFront();
        HostDiagnostics.Write($"show requested visible={_form.Visible} handle={_form.Handle}");
    }

    private static class NativeMethods
    {
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ShowWindow(IntPtr windowHandle, int command);
    }

    private void Shutdown()
    {
        if (_shuttingDown) return;
        _shuttingDown = true;
        HostDiagnostics.Write("shutting down");
        _timer.Stop();
        _notifyIcon.Visible = false;
        _form.AllowClose();
        _form.Close();
        ExitThread();
    }

    private void OnUi(Action action)
    {
        if (_shuttingDown) return;
        if (_form.InvokeRequired) _form.BeginInvoke(action);
        else action();
    }

    private enum RunnerOperation
    {
        None,
        Poll,
        Refresh,
        ClearCache,
    }
}
