using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Reflection;
using System.Xml.Linq;

namespace FoxWatchMonitor;

internal sealed class MonitorForm : Form
{
    private static readonly Color AppBackground = Color.FromArgb(11, 15, 20);
    private static readonly Color Surface = Color.FromArgb(18, 24, 31);
    private static readonly Color SurfaceRaised = Color.FromArgb(22, 29, 37);
    private static readonly Color Border = Color.FromArgb(47, 58, 70);
    private static readonly Color PrimaryText = Color.FromArgb(232, 238, 246);
    private static readonly Color SecondaryText = Color.FromArgb(157, 170, 188);
    private static readonly Color MutedText = Color.FromArgb(105, 121, 143);
    private static readonly Color Accent = Color.FromArgb(77, 226, 201);
    private static readonly Color Success = Color.FromArgb(92, 214, 112);
    private static readonly Color Warning = Color.FromArgb(250, 204, 21);
    private static readonly Color Danger = Color.FromArgb(248, 100, 104);

    private readonly Label _statusValue;
    private readonly Label _buildValue;
    private readonly Label _nextPollValue;
    private readonly NxActionButton _startStopButton;
    private readonly NxActionButton _runRefreshButton;
    private readonly NxActionButton _clearCacheButton;
    private readonly CheckBox _startWithWindows;
    private readonly CheckBox _startMinimized;
    private readonly Label _stageValue;
    private readonly Label _stageDetail;
    private readonly Label _overallValue;
    private readonly Label _elapsedValue;
    private readonly NxSvgIcon _remainingIcon;
    private readonly Label _timingSeparator;
    private readonly Label _remainingValue;
    private readonly NxProgressBar _overallProgress;
    private readonly Label _batchSummary;
    private readonly TableLayoutPanel _workerSection;
    private readonly Label[] _workerStateLabels;
    private readonly Label[] _workerBatchLabels;
    private readonly Label[] _workerSceneLabels;
    private readonly Label[] _workerAssetLabels;
    private readonly NxProgressBar[] _workerProgress;
    private bool _allowClose;
    private bool _updatingStartup;
    private bool _updatingStartMinimized;

    public event EventHandler? StartRequested;
    public event EventHandler? StopRequested;
    public event EventHandler? RunRefreshRequested;
    public event EventHandler? ClearCacheRequested;
    public event EventHandler? OpenLogsRequested;
    public event EventHandler<bool>? StartWithWindowsChanged;
    public event EventHandler<bool>? StartMinimizedChanged;

    public MonitorForm(Icon appIcon)
    {
        Text = "FoxWatch Monitor";
        Icon = appIcon;
        MinimumSize = new Size(760, 480);
        Size = new Size(920, 560);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = AppBackground;
        ForeColor = PrimaryText;
        Font = new Font("Segoe UI", 9F);
        ShowInTaskbar = false;

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            Padding = Padding.Empty,
            BackColor = AppBackground,
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var header = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 3,
            RowCount = 1,
            BackColor = AppBackground,
            Padding = new Padding(0, 8, 0, 8),
            Margin = new Padding(18, 10, 18, 8),
        };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.333F));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.333F));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.334F));

        var statusBlock = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 1,
            RowCount = 2,
            Margin = Padding.Empty,
            BackColor = Color.Transparent,
        };
        statusBlock.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        statusBlock.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        statusBlock.Controls.Add(CreateCaption("Status"), 0, 0);

        _statusValue = new Label
        {
            Text = "Starting",
            AutoSize = true,
            ForeColor = Accent,
            Font = new Font("Segoe UI Semibold", 11F, FontStyle.Bold),
            Anchor = AnchorStyles.Left,
            Margin = new Padding(0, 2, 0, 0),
        };
        statusBlock.Controls.Add(_statusValue, 0, 1);
        header.Controls.Add(statusBlock, 0, 0);

        _buildValue = CreateMetricValue("—");
        header.Controls.Add(CreateMetric("LATEST BUILD", _buildValue), 1, 0);
        _nextPollValue = CreateMetricValue("—");
        header.Controls.Add(CreateMetric("NEXT POLL", _nextPollValue), 2, 0);
        root.Controls.Add(header, 0, 0);

        var content = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            Margin = new Padding(18, 0, 18, 0),
            BackColor = AppBackground,
        };
        content.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        content.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var pipelineCard = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 1,
            RowCount = 4,
            BackColor = Surface,
            Padding = new Padding(16, 14, 16, 14),
            Margin = new Padding(0, 0, 0, 12),
        };
        ApplyRoundedCorners(pipelineCard, () => Border, radius: 6);
        for (var index = 0; index < 4; index += 1)
            pipelineCard.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var stageHeader = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            Margin = Padding.Empty,
        };
        stageHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        stageHeader.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _stageValue = new NxFlushLabel
        {
            Text = "Waiting",
            AutoSize = true,
            ForeColor = PrimaryText,
            Font = new Font("Segoe UI Semibold", 18F, FontStyle.Bold),
            Margin = Padding.Empty,
        };
        _overallValue = new NxFlushLabel
        {
            Text = "0%",
            AutoSize = true,
            ForeColor = SecondaryText,
            Font = new Font("Segoe UI Semibold", 14F, FontStyle.Bold),
            Margin = new Padding(12, 5, 0, 0),
        };
        stageHeader.Controls.Add(_stageValue, 0, 0);
        stageHeader.Controls.Add(_overallValue, 1, 0);
        pipelineCard.Controls.Add(stageHeader, 0, 0);

        _stageDetail = CreateDetail("Waiting for the next Steam metadata poll.");
        _stageDetail.Dock = DockStyle.Top;
        _stageDetail.Margin = new Padding(0, 5, 0, 14);
        pipelineCard.Controls.Add(_stageDetail, 0, 1);

        _overallProgress = new NxProgressBar
        {
            Dock = DockStyle.Top,
            Height = 12,
            Margin = new Padding(0, 0, 0, 14),
            TrackColor = Color.FromArgb(49, 58, 69),
            StartColor = Color.FromArgb(63, 190, 182),
            EndColor = Color.FromArgb(96, 213, 112),
        };
        pipelineCard.Controls.Add(_overallProgress, 0, 2);

        var timingRow = new TableLayoutPanel
        {
            AutoSize = true,
            ColumnCount = 5,
            RowCount = 1,
            Margin = Padding.Empty,
        };
        for (var index = 0; index < 5; index += 1)
            timingRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        timingRow.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        timingRow.Controls.Add(new NxSvgIcon("FoxWatchMonitor.Assets.clock.svg")
        {
            Size = new Size(16, 16),
            ForeColor = SecondaryText,
            Anchor = AnchorStyles.None,
            Margin = new Padding(0, 0, 7, 0),
        }, 0, 0);
        _elapsedValue = new Label
        {
            Text = "Elapsed 0s",
            AutoSize = true,
            ForeColor = SecondaryText,
            Font = new Font("Segoe UI Semibold", 9F, FontStyle.Bold),
            Anchor = AnchorStyles.Left,
            Margin = Padding.Empty,
        };
        timingRow.Controls.Add(_elapsedValue, 1, 0);
        _timingSeparator = new Label
        {
            AutoSize = false,
            Size = new Size(1, 16),
            BackColor = Border,
            Anchor = AnchorStyles.None,
            Margin = new Padding(14, 0, 14, 0),
            Visible = false,
        };
        timingRow.Controls.Add(_timingSeparator, 2, 0);
        _remainingIcon = new NxSvgIcon("FoxWatchMonitor.Assets.hourglass.svg")
        {
            Size = new Size(16, 16),
            ForeColor = SecondaryText,
            Anchor = AnchorStyles.None,
            Margin = new Padding(0, 0, 7, 0),
            Visible = false,
        };
        timingRow.Controls.Add(_remainingIcon, 3, 0);
        _remainingValue = new Label
        {
            AutoSize = true,
            ForeColor = SecondaryText,
            Font = new Font("Segoe UI Semibold", 9F, FontStyle.Bold),
            Anchor = AnchorStyles.Left,
            Margin = Padding.Empty,
            Visible = false,
        };
        timingRow.Controls.Add(_remainingValue, 4, 0);
        pipelineCard.Controls.Add(timingRow, 0, 3);
        content.Controls.Add(pipelineCard, 0, 0);

        _workerSection = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            BackColor = Surface,
            Padding = new Padding(16),
            Margin = Padding.Empty,
            Visible = false,
        };
        ApplyRoundedCorners(_workerSection, () => Border, radius: 6);
        _workerSection.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _workerSection.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        _batchSummary = CreateCaption("WORKER ACTIVITY");
        _batchSummary.Margin = new Padding(2, 0, 0, 10);
        _workerSection.Controls.Add(_batchSummary, 0, 0);

        var workerGrid = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            Margin = Padding.Empty,
            BackColor = Surface,
        };
        workerGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        workerGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        _workerStateLabels = new Label[2];
        _workerBatchLabels = new Label[2];
        _workerSceneLabels = new Label[2];
        _workerAssetLabels = new Label[2];
        _workerProgress = new NxProgressBar[2];
        for (var index = 0; index < 2; index += 1)
            workerGrid.Controls.Add(CreateWorkerCard(index), index, 0);
        _workerSection.Controls.Add(workerGrid, 0, 1);
        content.Controls.Add(_workerSection, 0, 1);
        root.Controls.Add(content, 0, 1);

        var actionBar = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            RowCount = 1,
            BackColor = Surface,
            Padding = new Padding(18, 11, 18, 12),
            Margin = Padding.Empty,
        };
        actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        actionBar.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var actions = new FlowLayoutPanel
        {
            AutoSize = true,
            WrapContents = false,
            Margin = Padding.Empty,
        };
        _startStopButton = CreateButton("Stop Run");
        _startStopButton.FlatAppearance.BorderColor = Danger;
        _startStopButton.ForeColor = Danger;
        ApplyActionPalette(
            _startStopButton,
            Color.FromArgb(57, 27, 30),
            Color.FromArgb(76, 34, 38),
            Color.FromArgb(45, 22, 25));
        _startStopButton.Click += (_, _) =>
        {
            if (_startStopButton.Text == "Start") StartRequested?.Invoke(this, EventArgs.Empty);
            else StopRequested?.Invoke(this, EventArgs.Empty);
        };
        actions.Controls.Add(_startStopButton);
        _runRefreshButton = CreateButton("Run Refresh");
        _runRefreshButton.ForeColor = Accent;
        _runRefreshButton.FlatAppearance.BorderColor = Accent;
        ApplyActionPalette(
            _runRefreshButton,
            Color.FromArgb(23, 66, 62),
            Color.FromArgb(29, 84, 78),
            Color.FromArgb(18, 54, 51));
        _runRefreshButton.Click += (_, _) => RunRefreshRequested?.Invoke(this, EventArgs.Empty);
        actions.Controls.Add(_runRefreshButton);
        _clearCacheButton = CreateButton("Clear Cache");
        _clearCacheButton.ForeColor = Color.FromArgb(250, 215, 132);
        _clearCacheButton.FlatAppearance.BorderColor = Color.FromArgb(127, 101, 44);
        ApplyActionPalette(
            _clearCacheButton,
            Color.FromArgb(48, 39, 20),
            Color.FromArgb(65, 52, 24),
            Color.FromArgb(38, 31, 17));
        _clearCacheButton.Click += (_, _) => ClearCacheRequested?.Invoke(this, EventArgs.Empty);
        actions.Controls.Add(_clearCacheButton);
        var logsButton = CreateButton("Open Logs");
        logsButton.FlatAppearance.BorderColor = Color.FromArgb(119, 132, 148);
        logsButton.Click += (_, _) => OpenLogsRequested?.Invoke(this, EventArgs.Empty);
        actions.Controls.Add(logsButton);
        actionBar.Controls.Add(actions, 0, 0);

        var preferences = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            Margin = Padding.Empty,
        };
        _startWithWindows = CreateToggleButton("Start with Windows");
        _startWithWindows.CheckedChanged += (_, _) =>
        {
            ApplyToggleStyle(_startWithWindows);
            if (!_updatingStartup) StartWithWindowsChanged?.Invoke(this, _startWithWindows.Checked);
        };
        _startMinimized = CreateToggleButton("Start Minimized");
        _startMinimized.CheckedChanged += (_, _) =>
        {
            ApplyToggleStyle(_startMinimized);
            if (!_updatingStartMinimized) StartMinimizedChanged?.Invoke(this, _startMinimized.Checked);
        };
        preferences.Controls.Add(_startMinimized);
        preferences.Controls.Add(_startWithWindows);
        actionBar.Controls.Add(preferences, 1, 0);

        var footer = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 1,
            RowCount = 2,
            BackColor = Surface,
            Margin = new Padding(0, 12, 0, 0),
            Padding = Padding.Empty,
        };
        footer.RowStyles.Add(new RowStyle(SizeType.Absolute, 1));
        footer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        footer.Controls.Add(new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Border,
            Margin = Padding.Empty,
        }, 0, 0);
        footer.Controls.Add(actionBar, 0, 1);
        root.Controls.Add(footer, 0, 2);

        Controls.Add(root);
        FormClosing += OnFormClosing;
    }

    public void SetStatus(string status, string detail)
    {
        _statusValue.Text = status;
        var color = status switch
        {
            "Failed" => Danger,
            "Running" => Success,
            "Stopped" => Danger,
            "Stopping" => Warning,
            _ => Accent,
        };
        _statusValue.ForeColor = color;
        AccessibleDescription = detail;
    }

    public void SetBuildState(string selectedBuild, string _)
    {
        _buildValue.Text = selectedBuild;
    }

    public void SetNextPoll(string value) => _nextPollValue.Text = value;

    public void SetStopped(bool stopped, bool stopping = false)
    {
        _startStopButton.Text = stopping ? "Stopping..." : stopped ? "Start" : "Stop Run";
        _startStopButton.Enabled = !stopping;
        _startStopButton.ForeColor = stopped ? Accent : Danger;
        _startStopButton.FlatAppearance.BorderColor = stopped ? Accent : Danger;
        ApplyActionPalette(
            _startStopButton,
            stopped ? Color.FromArgb(23, 66, 62) : Color.FromArgb(57, 27, 30),
            stopped ? Color.FromArgb(29, 84, 78) : Color.FromArgb(76, 34, 38),
            stopped ? Color.FromArgb(18, 54, 51) : Color.FromArgb(45, 22, 25));
        _startStopButton.Invalidate();
    }

    public void SetActionsEnabled(bool enabled)
    {
        _runRefreshButton.Enabled = enabled;
        _clearCacheButton.Enabled = enabled;
    }

    public void SetStartWithWindows(bool enabled)
    {
        _updatingStartup = true;
        _startWithWindows.Checked = enabled;
        ApplyToggleStyle(_startWithWindows);
        _updatingStartup = false;
    }

    public void SetStartMinimized(bool enabled)
    {
        _updatingStartMinimized = true;
        _startMinimized.Checked = enabled;
        ApplyToggleStyle(_startMinimized);
        _updatingStartMinimized = false;
    }

    public void SetPipelineProgress(string stage, string detail, int percent, bool showWorkers = false)
    {
        _stageValue.Text = stage;
        _stageDetail.Text = detail;
        var normalized = Math.Clamp(percent, 0, 100);
        _overallProgress.Value = normalized;
        _overallValue.Text = $"{normalized}%";
        _workerSection.Visible = showWorkers;
    }

    public void SetRenderSummary(int completedBatches, int totalBatches, int sceneTotal)
    {
        _workerSection.Visible = true;
        _stageDetail.Text = sceneTotal > 0
            ? $"{completedBatches:N0} of {totalBatches:N0} batches complete · {sceneTotal:N0} scenes total"
            : $"{completedBatches:N0} of {totalBatches:N0} batches complete";
        _batchSummary.Text = "WORKER ACTIVITY";
    }

    public void SetWorkerProgress(int worker, int batch, int scene, int sceneTotal, string sceneLabel)
    {
        if (worker is < 1 or > 2) return;
        var index = worker - 1;
        var safeSceneTotal = Math.Max(sceneTotal, 1);
        var safeScene = Math.Clamp(scene, 0, safeSceneTotal);
        var complete = sceneLabel.Equals("Batch Complete", StringComparison.OrdinalIgnoreCase);
        _workerStateLabels[index].Text = complete ? "●  Waiting" : "●  Active";
        _workerStateLabels[index].ForeColor = complete ? SecondaryText : Accent;
        _workerBatchLabels[index].Text = $"Batch {batch:N0}";
        _workerSceneLabels[index].Text = $"Scene {safeScene:N0}/{safeSceneTotal:N0}";
        _workerAssetLabels[index].Text = complete
            ? "Waiting for next batch"
            : string.IsNullOrWhiteSpace(sceneLabel) ? "Rendering" : sceneLabel;
        _workerProgress[index].Value = (int)Math.Round(safeScene * 100D / safeSceneTotal);
    }

    public void SetWorkerWaiting(int worker, string reason, string detail)
    {
        if (worker is < 1 or > 2) return;
        var index = worker - 1;
        _workerStateLabels[index].Text = reason;
        _workerStateLabels[index].ForeColor = Warning;
        _workerBatchLabels[index].Text = "Batch —";
        _workerSceneLabels[index].Text = "Waiting";
        _workerAssetLabels[index].Text = detail;
        _workerProgress[index].Value = 0;
    }

    public void ResetWorkerProgress()
    {
        for (var index = 0; index < 2; index += 1)
        {
            _workerStateLabels[index].Text = "●  Waiting";
            _workerStateLabels[index].ForeColor = MutedText;
            _workerBatchLabels[index].Text = "Batch —";
            _workerSceneLabels[index].Text = "Scene —";
            _workerAssetLabels[index].Text = "Waiting for work";
            _workerProgress[index].Value = 0;
        }
        _batchSummary.Text = "WORKER ACTIVITY";
    }

    public void SetTiming(string elapsed, string? remaining = null)
    {
        _elapsedValue.Text = $"Elapsed {elapsed}";
        var hasRemaining = !string.IsNullOrWhiteSpace(remaining);
        _timingSeparator.Visible = hasRemaining;
        _remainingIcon.Visible = hasRemaining;
        _remainingValue.Visible = hasRemaining;
        _remainingValue.Text = hasRemaining ? $"About {remaining} remaining" : string.Empty;
    }

    public void AllowClose() => _allowClose = true;

    private TableLayoutPanel CreateWorkerCard(int index)
    {
        var card = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            BackColor = SurfaceRaised,
            Padding = new Padding(16, 14, 16, 14),
            Margin = index == 0 ? new Padding(0, 0, 6, 0) : new Padding(6, 0, 0, 0),
        };
        ApplyRoundedCorners(card, () => Border, radius: 6);
        for (var row = 0; row < 5; row += 1)
            card.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var header = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            Margin = Padding.Empty,
        };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.Controls.Add(new Label
        {
            Text = $"W{index + 1}",
            AutoSize = true,
            ForeColor = Accent,
            Font = new Font("Segoe UI Semibold", 12F, FontStyle.Bold),
            Margin = Padding.Empty,
        }, 0, 0);
        _workerStateLabels[index] = new Label
        {
            Text = "●  Waiting",
            AutoSize = true,
            ForeColor = MutedText,
            Font = new Font("Segoe UI Semibold", 9F, FontStyle.Bold),
            Margin = new Padding(8, 3, 0, 0),
        };
        header.Controls.Add(_workerStateLabels[index], 1, 0);
        card.Controls.Add(header, 0, 0);

        _workerBatchLabels[index] = new Label
        {
            Text = "Batch —",
            AutoSize = true,
            ForeColor = PrimaryText,
            Font = new Font("Segoe UI Semibold", 12F, FontStyle.Bold),
            Margin = new Padding(0, 12, 0, 0),
        };
        card.Controls.Add(_workerBatchLabels[index], 0, 1);
        _workerSceneLabels[index] = CreateDetail("Scene —");
        _workerSceneLabels[index].Margin = new Padding(0, 5, 0, 0);
        card.Controls.Add(_workerSceneLabels[index], 0, 2);
        _workerAssetLabels[index] = CreateDetail("Waiting for work");
        _workerAssetLabels[index].Dock = DockStyle.Fill;
        _workerAssetLabels[index].AutoEllipsis = true;
        _workerAssetLabels[index].Margin = new Padding(0, 3, 0, 12);
        card.Controls.Add(_workerAssetLabels[index], 0, 3);
        _workerProgress[index] = new NxProgressBar
        {
            Dock = DockStyle.Top,
            Height = 9,
            TrackColor = Color.FromArgb(50, 60, 72),
            StartColor = Color.FromArgb(63, 190, 182),
            EndColor = Color.FromArgb(96, 213, 112),
            Margin = Padding.Empty,
        };
        card.Controls.Add(_workerProgress[index], 0, 4);
        return card;
    }

    private static TableLayoutPanel CreateMetric(string caption, Label value)
    {
        var metric = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 1,
            RowCount = 2,
            Margin = Padding.Empty,
        };
        metric.Controls.Add(CreateCaption(caption), 0, 0);
        metric.Controls.Add(value, 0, 1);
        return metric;
    }

    private static Label CreateCaption(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = MutedText,
        Font = new Font("Segoe UI", 8F, FontStyle.Bold),
        Margin = Padding.Empty,
    };

    private static Label CreateMetricValue(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = Accent,
        Font = new Font("Segoe UI Semibold", 10F, FontStyle.Bold),
        Margin = new Padding(0, 2, 0, 0),
    };

    private static Label CreateDetail(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = SecondaryText,
        Margin = Padding.Empty,
    };

    private static NxActionButton CreateButton(string text)
    {
        var button = new NxActionButton
        {
            Text = text,
            AutoSize = true,
            FlatStyle = FlatStyle.Flat,
            BackColor = SurfaceRaised,
            ForeColor = PrimaryText,
            Padding = new Padding(11, 5, 11, 5),
            Margin = new Padding(0, 0, 8, 0),
            DisabledBackColor = SurfaceRaised,
            DisabledForeColor = MutedText,
            DisabledBorderColor = Border,
            HoverBackColor = Color.FromArgb(32, 42, 52),
            PressedBackColor = Color.FromArgb(18, 24, 31),
            FlatAppearance = { BorderColor = Border, BorderSize = 0 },
        };
        ApplyRoundedCorners(button);
        return button;
    }

    private static void ApplyActionPalette(
        NxActionButton button,
        Color background,
        Color hoverBackground,
        Color pressedBackground)
    {
        button.BackColor = background;
        button.HoverBackColor = hoverBackground;
        button.PressedBackColor = pressedBackground;
        button.Invalidate();
    }

    private static CheckBox CreateToggleButton(string text)
    {
        var toggle = new CheckBox
        {
            Text = text,
            Appearance = Appearance.Button,
            AutoSize = false,
            Size = new Size(text == "Start with Windows" ? 142 : 128, 34),
            FlatStyle = FlatStyle.Flat,
            TextAlign = ContentAlignment.MiddleCenter,
            Padding = Padding.Empty,
            Margin = new Padding(8, 0, 0, 0),
            ForeColor = SecondaryText,
            BackColor = SurfaceRaised,
            UseVisualStyleBackColor = false,
        };
        toggle.FlatAppearance.BorderSize = 0;
        toggle.FlatAppearance.BorderColor = Border;
        toggle.FlatAppearance.CheckedBackColor = Color.FromArgb(23, 66, 62);
        ApplyRoundedCorners(toggle, () => toggle.FlatAppearance.BorderColor);
        return toggle;
    }

    private static void ApplyRoundedCorners(Control control, Func<Color>? borderColor = null, int radius = 4)
    {
        GraphicsPath CreatePath(float inset = 0F)
        {
            var bounds = new RectangleF(
                inset,
                inset,
                Math.Max(1F, control.Width - (inset * 2F)),
                Math.Max(1F, control.Height - (inset * 2F)));
            var diameter = Math.Min(radius * 2F, Math.Min(bounds.Width, bounds.Height));
            var path = new GraphicsPath();
            path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        void UpdateRegion()
        {
            if (control.Width <= 0 || control.Height <= 0) return;
            using var path = CreatePath();
            var previousRegion = control.Region;
            control.Region = new Region(path);
            previousRegion?.Dispose();
        }

        control.SizeChanged += (_, _) => UpdateRegion();
        control.HandleCreated += (_, _) => UpdateRegion();
        control.Layout += (_, _) => UpdateRegion();
        if (borderColor is not null) control.Paint += (_, eventArgs) =>
        {
            if (control.Width <= 0 || control.Height <= 0) return;
            using var path = CreatePath(1F);
            using var pen = new Pen(borderColor(), 1F);
            eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            eventArgs.Graphics.DrawPath(pen, path);
        };
        UpdateRegion();
    }

    private static void ApplyToggleStyle(CheckBox toggle)
    {
        toggle.Text = toggle.Text.TrimStart('✓', ' ');
        if (toggle.Checked) toggle.Text = $"✓  {toggle.Text}";
        toggle.ForeColor = toggle.Checked ? Color.FromArgb(166, 250, 233) : SecondaryText;
        toggle.BackColor = toggle.Checked ? Color.FromArgb(23, 66, 62) : SurfaceRaised;
        toggle.FlatAppearance.BorderColor = toggle.Checked ? Color.FromArgb(54, 128, 118) : Border;
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs eventArgs)
    {
        if (_allowClose) return;
        eventArgs.Cancel = true;
        Hide();
        ShowInTaskbar = false;
    }
}

internal sealed class NxFlushLabel : Label
{
    public override Size GetPreferredSize(Size proposedSize)
    {
        var measured = TextRenderer.MeasureText(
            Text,
            Font,
            new Size(int.MaxValue, int.MaxValue),
            TextFormatFlags.SingleLine | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        return new Size(measured.Width + Padding.Horizontal, measured.Height + Padding.Vertical);
    }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        TextRenderer.DrawText(
            eventArgs.Graphics,
            Text,
            Font,
            ClientRectangle,
            ForeColor,
            TextFormatFlags.Left
                | TextFormatFlags.Top
                | TextFormatFlags.SingleLine
                | TextFormatFlags.NoPadding
                | TextFormatFlags.NoPrefix);
    }
}

internal sealed class NxActionButton : Button
{
    private bool _hovered;
    private bool _pressed;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color DisabledBackColor { get; set; } = Color.FromArgb(22, 29, 37);

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color DisabledForeColor { get; set; } = Color.FromArgb(105, 121, 143);

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color DisabledBorderColor { get; set; } = Color.FromArgb(47, 58, 70);

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color HoverBackColor { get; set; } = Color.FromArgb(32, 42, 52);

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color PressedBackColor { get; set; } = Color.FromArgb(18, 24, 31);

    public NxActionButton()
    {
        SetStyle(
            ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.ResizeRedraw
                | ControlStyles.UserPaint,
            true);
    }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        // Keep the complete one-pixel stroke inside the client area. A path on
        // the half-pixel outer edge loses its bottom/right antialiasing when
        // WinForms clips the control, making those corners appear square.
        var bounds = new RectangleF(1F, 1F, Math.Max(1F, Width - 2F), Math.Max(1F, Height - 2F));
        using var path = CreateRoundedRectangle(bounds, 4F);
        var backgroundColor = !Enabled
            ? DisabledBackColor
            : _pressed
                ? PressedBackColor
                : _hovered
                    ? HoverBackColor
                    : BackColor;
        using var background = new SolidBrush(backgroundColor);
        using var border = new Pen(Enabled ? FlatAppearance.BorderColor : DisabledBorderColor, 1F);
        eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        eventArgs.Graphics.FillPath(background, path);
        eventArgs.Graphics.DrawPath(border, path);
        TextRenderer.DrawText(
            eventArgs.Graphics,
            Text,
            Font,
            ClientRectangle,
            Enabled ? ForeColor : DisabledForeColor,
            TextFormatFlags.HorizontalCenter
                | TextFormatFlags.VerticalCenter
                | TextFormatFlags.SingleLine
                | TextFormatFlags.NoPrefix);
    }

    protected override void OnMouseEnter(EventArgs eventArgs)
    {
        base.OnMouseEnter(eventArgs);
        _hovered = true;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs eventArgs)
    {
        base.OnMouseLeave(eventArgs);
        _hovered = false;
        _pressed = false;
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs eventArgs)
    {
        base.OnMouseDown(eventArgs);
        if (eventArgs.Button == MouseButtons.Left) _pressed = true;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs eventArgs)
    {
        base.OnMouseUp(eventArgs);
        _pressed = false;
        Invalidate();
    }

    protected override void OnEnabledChanged(EventArgs eventArgs)
    {
        base.OnEnabledChanged(eventArgs);
        if (!Enabled)
        {
            _hovered = false;
            _pressed = false;
        }
        Invalidate();
    }

    private static GraphicsPath CreateRoundedRectangle(RectangleF bounds, float radius)
    {
        var path = new GraphicsPath();
        var diameter = Math.Min(radius * 2F, Math.Min(bounds.Width, bounds.Height));
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal sealed class NxSvgIcon : Control
{
    private readonly float _viewWidth;
    private readonly float _viewHeight;
    private readonly float _strokeWidth;
    private readonly List<(string Kind, float[] Values)> _shapes = [];

    public NxSvgIcon(string resourceName)
    {
        SetStyle(
            ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.ResizeRedraw
                | ControlStyles.SupportsTransparentBackColor
                | ControlStyles.UserPaint,
            true);
        BackColor = Color.Transparent;

        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Embedded SVG resource '{resourceName}' was not found.");
        var document = XDocument.Load(stream);
        var root = document.Root ?? throw new InvalidDataException($"SVG resource '{resourceName}' has no root element.");
        var viewBox = ParseNumbers(root.Attribute("viewBox")?.Value);
        _viewWidth = viewBox.Length == 4 ? viewBox[2] : 24F;
        _viewHeight = viewBox.Length == 4 ? viewBox[3] : 24F;
        _strokeWidth = ParseNumber(root.Attribute("stroke-width")?.Value, 1.75F);

        foreach (var element in root.Elements())
        {
            switch (element.Name.LocalName)
            {
                case "circle":
                    _shapes.Add(("circle",
                    [
                        ParseNumber(element.Attribute("cx")?.Value),
                        ParseNumber(element.Attribute("cy")?.Value),
                        ParseNumber(element.Attribute("r")?.Value),
                    ]));
                    break;
                case "line":
                    _shapes.Add(("line",
                    [
                        ParseNumber(element.Attribute("x1")?.Value),
                        ParseNumber(element.Attribute("y1")?.Value),
                        ParseNumber(element.Attribute("x2")?.Value),
                        ParseNumber(element.Attribute("y2")?.Value),
                    ]));
                    break;
                case "polyline":
                    _shapes.Add(("polyline", ParseNumbers(element.Attribute("points")?.Value)));
                    break;
            }
        }
    }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        base.OnPaint(eventArgs);
        if (Width <= 0 || Height <= 0) return;
        var scale = Math.Min(Width / _viewWidth, Height / _viewHeight);
        var offsetX = (Width - (_viewWidth * scale)) / 2F;
        var offsetY = (Height - (_viewHeight * scale)) / 2F;
        PointF Point(float x, float y) => new(offsetX + (x * scale), offsetY + (y * scale));

        eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var pen = new Pen(ForeColor, Math.Max(1F, _strokeWidth * scale))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round,
        };
        foreach (var shape in _shapes)
        {
            if (shape.Kind == "circle" && shape.Values.Length == 3)
            {
                var center = Point(shape.Values[0], shape.Values[1]);
                var radius = shape.Values[2] * scale;
                eventArgs.Graphics.DrawEllipse(pen, center.X - radius, center.Y - radius, radius * 2F, radius * 2F);
            }
            else if (shape.Kind == "line" && shape.Values.Length == 4)
            {
                eventArgs.Graphics.DrawLine(
                    pen,
                    Point(shape.Values[0], shape.Values[1]),
                    Point(shape.Values[2], shape.Values[3]));
            }
            else if (shape.Kind == "polyline" && shape.Values.Length >= 4 && shape.Values.Length % 2 == 0)
            {
                var points = new PointF[shape.Values.Length / 2];
                for (var index = 0; index < shape.Values.Length; index += 2)
                    points[index / 2] = Point(shape.Values[index], shape.Values[index + 1]);
                eventArgs.Graphics.DrawLines(pen, points);
            }
        }
    }

    private static float ParseNumber(string? value, float fallback = 0F)
        => float.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : fallback;

    private static float[] ParseNumbers(string? value)
        => string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split([' ', ','], StringSplitOptions.RemoveEmptyEntries)
                .Select(item => ParseNumber(item))
                .ToArray();
}

internal sealed class NxProgressBar : Control
{
    private int _value;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public int Value
    {
        get => _value;
        set
        {
            _value = Math.Clamp(value, 0, 100);
            Invalidate();
        }
    }

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color TrackColor { get; set; } = Color.FromArgb(49, 58, 69);

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color StartColor { get; set; } = Color.FromArgb(63, 190, 182);

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color EndColor { get; set; } = Color.FromArgb(96, 213, 112);

    public NxProgressBar()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
    }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        base.OnPaint(eventArgs);
        var bounds = ClientRectangle;
        if (bounds.Width <= 0 || bounds.Height <= 0) return;
        eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var trackPath = CreateRoundedRectangle(
            new RectangleF(0, 0, bounds.Width - 1F, bounds.Height - 1F),
            3F);
        using var track = new SolidBrush(TrackColor);
        eventArgs.Graphics.FillPath(track, trackPath);
        var progressWidth = (int)Math.Round(bounds.Width * (_value / 100D));
        if (progressWidth <= 0) return;
        var progressBounds = new RectangleF(
            0,
            0,
            Math.Max(1F, Math.Min(progressWidth, bounds.Width) - 1F),
            bounds.Height - 1F);
        using var progressPath = CreateRoundedRectangle(progressBounds, 3F);
        using var gradient = new LinearGradientBrush(
            new Rectangle(0, 0, Math.Max(progressWidth, 1), bounds.Height),
            StartColor,
            EndColor,
            LinearGradientMode.Horizontal);
        eventArgs.Graphics.FillPath(gradient, progressPath);
    }

    private static GraphicsPath CreateRoundedRectangle(RectangleF bounds, float radius)
    {
        var path = new GraphicsPath();
        var diameter = Math.Min(radius * 2F, Math.Min(bounds.Width, bounds.Height));
        if (diameter <= 0F)
        {
            path.AddRectangle(bounds);
            return path;
        }
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}
