using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;

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

    private readonly Label _statusDot;
    private readonly Label _statusValue;
    private readonly Label _buildValue;
    private readonly Label _successfulValue;
    private readonly Label _nextPollValue;
    private readonly Button _startStopButton;
    private readonly CheckBox _startWithWindows;
    private readonly CheckBox _startMinimized;
    private readonly Label _stageValue;
    private readonly Label _stageDetail;
    private readonly Label _overallValue;
    private readonly Label _timingValue;
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
            Padding = new Padding(18),
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
            BackColor = Surface,
            Padding = new Padding(18, 14, 18, 14),
            Margin = new Padding(0, 0, 0, 12),
        };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 28));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 30));

        var statusBlock = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 2,
            RowCount = 1,
            Margin = Padding.Empty,
            BackColor = Color.Transparent,
        };
        statusBlock.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        statusBlock.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _statusDot = new Label
        {
            Text = "●",
            AutoSize = true,
            ForeColor = Accent,
            Font = new Font("Segoe UI", 11F, FontStyle.Bold),
            Anchor = AnchorStyles.Left,
            Margin = new Padding(0, 0, 7, 0),
        };
        _statusValue = new Label
        {
            Text = "Starting",
            AutoSize = true,
            ForeColor = Accent,
            Font = new Font("Segoe UI Semibold", 11F, FontStyle.Bold),
            Anchor = AnchorStyles.Left,
            Margin = Padding.Empty,
        };
        statusBlock.Controls.Add(_statusDot, 0, 0);
        statusBlock.Controls.Add(_statusValue, 1, 0);
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
            Margin = Padding.Empty,
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
            Padding = new Padding(20, 18, 20, 18),
            Margin = new Padding(0, 0, 0, 12),
        };
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
        _stageValue = new Label
        {
            Text = "Waiting",
            AutoSize = true,
            ForeColor = PrimaryText,
            Font = new Font("Segoe UI Semibold", 18F, FontStyle.Bold),
            Margin = Padding.Empty,
        };
        _overallValue = new Label
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

        _timingValue = new Label
        {
            Text = "Elapsed 0s",
            AutoSize = true,
            ForeColor = SecondaryText,
            Font = new Font("Segoe UI Semibold", 9F, FontStyle.Bold),
            Margin = Padding.Empty,
        };
        pipelineCard.Controls.Add(_timingValue, 0, 3);
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
            ColumnCount = 3,
            RowCount = 1,
            BackColor = Surface,
            Padding = new Padding(14, 12, 14, 12),
            Margin = new Padding(0, 12, 0, 0),
        };
        actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var actions = new FlowLayoutPanel
        {
            AutoSize = true,
            WrapContents = false,
            Margin = Padding.Empty,
        };
        _startStopButton = CreateButton("Stop Run");
        _startStopButton.FlatAppearance.BorderColor = Danger;
        _startStopButton.ForeColor = Color.FromArgb(255, 180, 182);
        _startStopButton.Click += (_, _) =>
        {
            if (_startStopButton.Text == "Start") StartRequested?.Invoke(this, EventArgs.Empty);
            else StopRequested?.Invoke(this, EventArgs.Empty);
        };
        actions.Controls.Add(_startStopButton);
        var logsButton = CreateButton("Open Logs");
        logsButton.Click += (_, _) => OpenLogsRequested?.Invoke(this, EventArgs.Empty);
        actions.Controls.Add(logsButton);
        actionBar.Controls.Add(actions, 0, 0);

        var successfulBlock = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            Margin = new Padding(12, 7, 18, 0),
        };
        _successfulValue = CreateDetail("—");
        successfulBlock.Controls.Add(_successfulValue);
        successfulBlock.Controls.Add(CreateCaption("LAST SUCCESSFUL"));
        actionBar.Controls.Add(successfulBlock, 1, 0);

        var preferences = new FlowLayoutPanel
        {
            AutoSize = true,
            WrapContents = false,
            Margin = Padding.Empty,
        };
        _startWithWindows = CreateToggleButton("Start with Windows");
        _startWithWindows.CheckedChanged += (_, _) =>
        {
            ApplyToggleStyle(_startWithWindows);
            if (!_updatingStartup) StartWithWindowsChanged?.Invoke(this, _startWithWindows.Checked);
        };
        preferences.Controls.Add(_startWithWindows);
        _startMinimized = CreateToggleButton("Start Minimized");
        _startMinimized.CheckedChanged += (_, _) =>
        {
            ApplyToggleStyle(_startMinimized);
            if (!_updatingStartMinimized) StartMinimizedChanged?.Invoke(this, _startMinimized.Checked);
        };
        preferences.Controls.Add(_startMinimized);
        actionBar.Controls.Add(preferences, 2, 0);
        root.Controls.Add(actionBar, 0, 2);

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
            "Stopping" or "Stopped" => Warning,
            _ => Accent,
        };
        _statusDot.ForeColor = color;
        _statusValue.ForeColor = color;
        AccessibleDescription = detail;
    }

    public void SetBuildState(string selectedBuild, string successfulBuild)
    {
        _buildValue.Text = selectedBuild;
        _successfulValue.Text = successfulBuild;
    }

    public void SetNextPoll(string value) => _nextPollValue.Text = value;

    public void SetStopped(bool stopped, bool stopping = false)
    {
        _startStopButton.Text = stopping ? "Stopping..." : stopped ? "Start" : "Stop Run";
        _startStopButton.Enabled = !stopping;
        _startStopButton.BackColor = stopped ? Color.FromArgb(20, 72, 68) : SurfaceRaised;
        _startStopButton.ForeColor = stopped ? Color.FromArgb(166, 250, 233) : Color.FromArgb(255, 180, 182);
        _startStopButton.FlatAppearance.BorderColor = stopped ? Accent : Danger;
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

    public void SetWorkerProgress(int worker, int workerBatch, int scene, int sceneTotal, string sceneLabel)
    {
        if (worker is < 1 or > 2) return;
        var index = worker - 1;
        var safeSceneTotal = Math.Max(sceneTotal, 1);
        var safeScene = Math.Clamp(scene, 0, safeSceneTotal);
        var complete = sceneLabel.Equals("Batch Complete", StringComparison.OrdinalIgnoreCase);
        _workerStateLabels[index].Text = complete ? "●  Complete" : "●  Active";
        _workerStateLabels[index].ForeColor = complete ? Success : Accent;
        _workerBatchLabels[index].Text = $"Batch {workerBatch:N0}";
        _workerSceneLabels[index].Text = $"Scene {safeScene:N0}/{safeSceneTotal:N0}";
        _workerAssetLabels[index].Text = string.IsNullOrWhiteSpace(sceneLabel) ? "Rendering" : sceneLabel;
        _workerProgress[index].Value = (int)Math.Round(safeScene * 100D / safeSceneTotal);
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

    public void SetTiming(string value) => _timingValue.Text = value;

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

    private static Button CreateButton(string text) => new()
    {
        Text = text,
        AutoSize = true,
        FlatStyle = FlatStyle.Flat,
        BackColor = SurfaceRaised,
        ForeColor = PrimaryText,
        Padding = new Padding(11, 5, 11, 5),
        Margin = new Padding(0, 0, 8, 0),
        FlatAppearance = { BorderColor = Border, BorderSize = 1 },
    };

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
        toggle.FlatAppearance.BorderSize = 1;
        toggle.FlatAppearance.BorderColor = Border;
        toggle.FlatAppearance.CheckedBackColor = Color.FromArgb(23, 66, 62);
        return toggle;
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
        using var track = new SolidBrush(TrackColor);
        eventArgs.Graphics.FillRectangle(track, bounds);
        var progressWidth = (int)Math.Round(bounds.Width * (_value / 100D));
        if (progressWidth <= 0) return;
        using var gradient = new LinearGradientBrush(
            new Rectangle(0, 0, Math.Max(progressWidth, 1), bounds.Height),
            StartColor,
            EndColor,
            LinearGradientMode.Horizontal);
        eventArgs.Graphics.FillRectangle(gradient, new Rectangle(0, 0, progressWidth, bounds.Height));
    }
}
