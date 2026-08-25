using System.Text.Json;

namespace FoxWatchMonitor;

internal sealed class MonitorHostOptions
{
    public int SchemaVersion { get; init; } = 1;
    public required string RepoRoot { get; init; }
    public required string NodePath { get; init; }
    public required string RunnerScriptPath { get; init; }
    public required string LogsRoot { get; init; }
    public required string StatePath { get; init; }
    public required string SettingsPath { get; init; }
    public int IntervalMinutes { get; init; } = 10;

    public static MonitorHostOptions Load(string[] args)
    {
        var configuredPath = GetOption(args, "--config");
        var configPath = configuredPath is null
            ? Path.Combine(AppContext.BaseDirectory, "host.config.v1.json")
            : Path.GetFullPath(configuredPath);
        if (!File.Exists(configPath))
        {
            throw new FileNotFoundException(
                $"FoxWatch monitor host configuration was not found: {configPath}. Run setup-monitor again.",
                configPath);
        }

        var options = JsonSerializer.Deserialize<MonitorHostOptions>(
            File.ReadAllText(configPath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException($"FoxWatch monitor host configuration is invalid: {configPath}");
        options.Validate(configPath);
        return options;
    }

    private void Validate(string configPath)
    {
        if (SchemaVersion != 1) throw new InvalidDataException($"Unsupported monitor host schema in {configPath}: {SchemaVersion}");
        if (IntervalMinutes is < 5 or > 1440) throw new InvalidDataException($"Invalid polling interval in {configPath}: {IntervalMinutes}");
        RequireDirectory(RepoRoot, nameof(RepoRoot), configPath);
        RequireFile(NodePath, nameof(NodePath), configPath);
        RequireFile(RunnerScriptPath, nameof(RunnerScriptPath), configPath);
        Directory.CreateDirectory(LogsRoot);
        var settingsDirectory = Path.GetDirectoryName(SettingsPath);
        if (string.IsNullOrWhiteSpace(settingsDirectory))
            throw new InvalidDataException($"SettingsPath in {configPath} has no parent directory: {SettingsPath}");
        Directory.CreateDirectory(settingsDirectory);
    }

    private static void RequireDirectory(string value, string name, string configPath)
    {
        if (string.IsNullOrWhiteSpace(value) || !Directory.Exists(value))
            throw new InvalidDataException($"{name} in {configPath} does not identify an existing directory: {value}");
    }

    private static void RequireFile(string value, string name, string configPath)
    {
        if (string.IsNullOrWhiteSpace(value) || !File.Exists(value))
            throw new InvalidDataException($"{name} in {configPath} does not identify an existing file: {value}");
    }

    private static string? GetOption(string[] args, string name)
    {
        for (var index = 0; index < args.Length; index += 1)
        {
            if (args[index].StartsWith($"{name}=", StringComparison.OrdinalIgnoreCase))
                return args[index][(name.Length + 1)..];
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
                return args[index + 1];
        }
        return null;
    }
}
