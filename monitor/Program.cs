namespace FoxWatchMonitor;

internal static class Program
{
    private const string MutexName = "Local\\Nixie.FoxWatch.Monitor";
    private const string ShowEventName = "Local\\Nixie.FoxWatch.Monitor.Show";
    private const string ExitEventName = "Local\\Nixie.FoxWatch.Monitor.Exit";

    [STAThread]
    private static void Main(string[] args)
    {
        HostDiagnostics.Write($"starting args=[{string.Join(' ', args)}]");
        try
        {
            Run(args);
            HostDiagnostics.Write("stopped");
        }
        catch (Exception error)
        {
            HostDiagnostics.Write($"fatal {error}");
            throw;
        }
    }

    private static void Run(string[] args)
    {
        var requestExit = args.Contains("--exit", StringComparer.OrdinalIgnoreCase);
        var startHidden = args.Contains("--background", StringComparer.OrdinalIgnoreCase);
        var startPaused = args.Contains("--paused", StringComparer.OrdinalIgnoreCase);
        using var mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        HostDiagnostics.Write($"mutex createdNew={createdNew}");
        if (!createdNew)
        {
            if (requestExit)
            {
                HostDiagnostics.Write("signaling exit");
                SignalExistingInstance(ExitEventName);
            }
            else if (!startHidden)
            {
                HostDiagnostics.Write("signaling show");
                SignalExistingInstance(ShowEventName);
            }
            return;
        }

        if (requestExit)
        {
            return;
        }

        ApplicationConfiguration.Initialize();
        var options = MonitorHostOptions.Load(args);
        var settings = MonitorSettings.Load(options.SettingsPath);
        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        using var exitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ExitEventName);
        using var context = new MonitorApplicationContext(options, settings, startHidden, startPaused, showEvent, exitEvent);
        Application.Run(context);
    }

    private static void SignalExistingInstance(string eventName)
    {
        try
        {
            using var signal = EventWaitHandle.OpenExisting(eventName);
            signal.Set();
            HostDiagnostics.Write($"signaled {eventName}");
        }
        catch (WaitHandleCannotBeOpenedException)
        {
            HostDiagnostics.Write($"signal unavailable {eventName}");
        }
    }
}
