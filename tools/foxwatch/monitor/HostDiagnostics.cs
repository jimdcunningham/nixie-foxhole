namespace FoxWatchMonitor;

internal static class HostDiagnostics
{
    private static readonly object Sync = new();
    private static readonly string LogPath = Path.Combine(AppContext.BaseDirectory, "monitor-host.log");

    public static void Write(string message)
    {
        try
        {
            lock (Sync)
            {
                File.AppendAllText(
                    LogPath,
                    $"{DateTimeOffset.Now:O} pid={Environment.ProcessId} {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // Host diagnostics must never prevent the tray monitor from running.
        }
    }
}
