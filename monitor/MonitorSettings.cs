using System.Text.Json;

namespace FoxWatchMonitor;

internal sealed class MonitorSettings
{
    public int SchemaVersion { get; init; } = 1;
    public bool StartMinimized { get; set; } = true;
    public bool PollingStopped { get; set; }

    public static MonitorSettings Load(string path)
    {
        try
        {
            if (!File.Exists(path)) return new MonitorSettings();
            var settings = JsonSerializer.Deserialize<MonitorSettings>(
                File.ReadAllText(path),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (settings?.SchemaVersion == 1) return settings;
            HostDiagnostics.Write($"ignored unsupported monitor settings at {path}");
        }
        catch (Exception error)
        {
            HostDiagnostics.Write($"ignored unreadable monitor settings at {path}: {error.Message}");
        }
        return new MonitorSettings();
    }

    public void Save(string path)
    {
        var directory = Path.GetDirectoryName(path)
            ?? throw new InvalidOperationException($"Monitor settings path has no parent directory: {path}");
        Directory.CreateDirectory(directory);
        var temporaryPath = $"{path}.{Environment.ProcessId}.tmp";
        File.WriteAllText(
            temporaryPath,
            JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(temporaryPath, path, overwrite: true);
    }
}
