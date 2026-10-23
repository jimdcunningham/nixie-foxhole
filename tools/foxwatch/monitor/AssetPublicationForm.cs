using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FoxWatchMonitor;

internal sealed class AssetPublicationForm : Form
{
    private readonly string _repoRoot;
    private readonly string _configPath;
    private readonly JsonObject _config;
    private readonly Dictionary<string, TextBox> _fields = new();
    private readonly TextBox _accessKey = new();
    private readonly TextBox _secretKey = new() { UseSystemPasswordChar = true };
    private readonly Label _summary = new() { AutoSize = true, MaximumSize = new Size(740, 0) };
    public string? RequestedOperation { get; private set; }

    public AssetPublicationForm(string repoRoot)
    {
        _repoRoot = repoRoot;
        _configPath = Path.Combine(repoRoot, "tools", "foxwatch", "local", "asset-publication.json");
        var template = Path.Combine(repoRoot, "config", "asset-publication.example.json");
        _config = JsonNode.Parse(File.ReadAllText(File.Exists(_configPath) ? _configPath : template))!.AsObject();
        Text = "Asset Publishing";
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(800, 680);
        MinimumSize = new Size(760, 600);
        BackColor = Color.FromArgb(18, 24, 31);
        ForeColor = Color.FromArgb(232, 238, 246);
        Font = new Font("Segoe UI", 10);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true, Padding = new Padding(20), ColumnCount = 2 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 165));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(layout);
        void Row(string label, Control control)
        {
            var row = layout.RowCount++;
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 8, 8, 8) }, 0, row);
            control.Dock = DockStyle.Top; control.Margin = new Padding(0, 4, 0, 8);
            layout.Controls.Add(control, 1, row);
        }
        void Field(string label, string key, string? value)
        {
            var box = new TextBox { Text = value ?? "" };
            _fields.Add(key, box); Row(label, box);
        }
        string Value(string key) => _config[key]?.GetValue<string>() ?? "";
        Field("Assets Directory", "assetsRoot", Value("assetsRoot"));
        Field("Output Directory", "outputRoot", Value("outputRoot"));
        var target = _config["target"]!.AsObject();
        foreach (var (label, key) in new[] { ("S3 Endpoint", "endpoint"), ("Bucket", "bucket"), ("Public Asset URL", "publicBaseUrl"), ("Object Prefix", "prefix") })
            Field(label, key, target[key]?.GetValue<string>());
        Row("Access Key ID", _accessKey);
        Row("Secret Access Key", _secretKey);
        var credentials = new Label { AutoSize = true, MaximumSize = new Size(560, 0), Text = "Credentials stay local and are encrypted for this Windows user. Existing saved secrets are not shown. Environment credentials can also be used." };
        Row("Credentials", credentials);
        var buttons = new FlowLayoutPanel { AutoSize = true, WrapContents = true, Dock = DockStyle.Top };
        Button Add(string label, Action action)
        {
            var button = new Button { Text = label, AutoSize = true, FlatStyle = FlatStyle.Flat, Padding = new Padding(8, 4, 8, 4), Margin = new Padding(0, 0, 8, 8) };
            button.Click += (_, _) => {try { action(); } catch (Exception error) {MessageBox.Show(this, error.Message, "Asset Publishing", MessageBoxButtons.OK, MessageBoxIcon.Error);}};
            buttons.Controls.Add(button); return button;
        }
        Add("Save Settings", () => { SaveConfiguration(); UpdateSummary(); });
        var saveCredentials = Add("Save Credentials", () => {});
        saveCredentials.Click += async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(_accessKey.Text) || string.IsNullOrWhiteSpace(_secretKey.Text))
            { MessageBox.Show(this, "Enter both credential fields to replace the saved credentials.", "Asset Publishing"); return; }
            var input = JsonSerializer.Serialize(new { accessKeyId = _accessKey.Text.Trim(), secretAccessKey = _secretKey.Text.Trim() });
            foreach (Control button in buttons.Controls) button.Enabled = false;
            try
            {
                var encrypted = await EncryptCredentials(input);
                var credentialPath = Path.Combine("tools", "foxwatch", "local", "asset-publication.credentials.dpapi");
                var destination = Path.Combine(_repoRoot, credentialPath);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                var temporary = destination + "." + Guid.NewGuid() + ".tmp";
                await File.WriteAllTextAsync(temporary, encrypted);
                File.Move(temporary, destination, overwrite: true);
                _config["credentialFile"] = credentialPath.Replace('\\', '/');
                SaveConfiguration(); _accessKey.Clear(); _secretKey.Clear();
                credentials.Text = "Credentials saved with current-user Windows encryption.";
            }
            catch { MessageBox.Show(this, "Could not save encrypted credentials. Existing credential files were not intentionally cleared.", "Asset Publishing", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { if (!IsDisposed) foreach (Control button in buttons.Controls) button.Enabled = true; }
        };
        void Request(string operation) { SaveConfiguration(); RequestedOperation = operation; DialogResult = DialogResult.OK; Close(); }
        Add("Prepare Assets", () => Request("prepare"));
        Add("Check Upload", () => Request("check"));
        Add("Publish Assets", () => Request("publish"));
        Add("Open Output", () => { var output = Path.GetFullPath(Path.Combine(_repoRoot, _fields["outputRoot"].Text)); Directory.CreateDirectory(output); Process.Start(new ProcessStartInfo(output) { UseShellExecute = true }); });
        Row("Actions", buttons);
        Row("Prepared Release", _summary);
        Row("Publication", new Label { AutoSize = true, MaximumSize = new Size(560, 0), Text = "Prepare validates and snapshots local files. Check Upload verifies the plan without sending files. Publish uploads that prepared plan and publishes its pinned release last. Production pins and previous releases are preserved." });
        UpdateSummary();
    }
    private void SaveConfiguration()
    {
        foreach (var key in new[] { "assetsRoot", "outputRoot" }) _config[key] = _fields[key].Text.Trim();
        var target = _config["target"]!.AsObject();
        foreach (var key in new[] { "endpoint", "bucket", "publicBaseUrl", "prefix" }) target[key] = _fields[key].Text.Trim();
        Directory.CreateDirectory(Path.GetDirectoryName(_configPath)!);
        var temporary = _configPath + "." + Guid.NewGuid() + ".tmp";
        File.WriteAllText(temporary, _config.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        File.Move(temporary, _configPath, overwrite: true);
    }
    private void UpdateSummary()
    {
        try
        {
            var pointer = Path.Combine(_repoRoot, _fields["outputRoot"].Text, "latest-plan.json");
            using var latest = JsonDocument.Parse(File.ReadAllText(pointer));
            using var plan = JsonDocument.Parse(File.ReadAllText(latest.RootElement.GetProperty("planPath").GetString()!));
            var root = plan.RootElement;
            var summary = root.GetProperty("summary");
            _summary.Text = $"{summary.GetProperty("sourceFiles").GetInt32():N0} source files · {summary.GetProperty("bytes").GetInt64() / 1_000_000_000d:N2} GB · {summary.GetProperty("packs").GetInt32()} packs\n"
                + root.GetProperty("release").GetProperty("url").GetString();
        }
        catch { _summary.Text = "No prepared release. Prepare assets before checking or publishing."; }
    }
    private async Task<string> EncryptCredentials(string value)
    {
        var start = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in new[] { "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", Path.Combine(_repoRoot, "tools", "foxwatch", "scripts", "foxwatch-monitor-secrets.ps1"), "-Action", "encrypt-stdin" }) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start the credential helper.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        await process.StandardInput.WriteAsync(value); process.StandardInput.Close();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch { if (!process.HasExited) process.Kill(entireProcessTree: true); throw; }
        await error;
        var encrypted = await output;
        if (process.ExitCode != 0 || !encrypted.StartsWith("dpapi-v1:", StringComparison.Ordinal)) throw new InvalidOperationException("Credential encryption failed.");
        return encrypted;
    }
}
