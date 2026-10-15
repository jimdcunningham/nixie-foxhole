using System.Text.Json;

namespace FoxWatchMonitor;

internal sealed class MonitorSpatialExportProgress
{
    public int Total { get; private set; }
    public int Completed { get; private set; }
    public int Exported { get; private set; }
    public int Reused { get; private set; }
    public int Skipped { get; private set; }
    public int Failed { get; private set; }
    public int Workers { get; private set; }
    public bool Finished { get; private set; }
    public string Activity { get; private set; } = string.Empty;
    public double Fraction => Total > 0 ? Math.Clamp((double)Completed / Total, 0, 1) : Finished ? 1 : 0;
    public string Summary => $"3D Export: {Completed:N0}/{Total:N0} assets · {Exported:N0} exported · {Reused:N0} cached · {Skipped:N0} skipped · {Failed:N0} failed";

    public void Reset()
    {
        Total = Completed = Exported = Reused = Skipped = Failed = Workers = 0;
        Finished = false;
        Activity = string.Empty;
    }

    public void Apply(JsonElement root)
    {
        static int Count(JsonElement root, string key) => root.TryGetProperty(key, out var value) && value.TryGetInt32(out var count) ? Math.Max(0, count) : 0;
        Total = Count(root, "assetTotal");
        Completed = Math.Min(Total, Count(root, "completedAssets"));
        Exported = Count(root, "exported"); Reused = Count(root, "reused");
        Skipped = Count(root, "skipped"); Failed = Count(root, "failed");
        Workers = Count(root, "workerCount");
        Finished = root.TryGetProperty("kind", out var kind) && kind.GetString() == "spatial-complete";
        Activity = root.TryGetProperty("active", out var active) && active.ValueKind == JsonValueKind.Object
            ? string.Join(" · ", active.EnumerateObject().Select(worker => $"CPU {worker.Name}: {worker.Value.GetString()}"))
            : string.Empty;
    }

    public int OverallPercent(int rendered, int renderTotal) => 40 + (int)Math.Round(25 * Fraction
        + 25 * (renderTotal > 0 ? Math.Clamp((double)rendered / renderTotal, 0, 1) : 0));
}
