namespace FoxWatchService;

public sealed class FoxWatchAssetExportPlan
{
    public int SchemaVersion { get; set; } = 1;

    public List<string> MeshPackagePaths { get; set; } = [];

    public List<string> MaterialPackagePaths { get; set; } = [];

    public List<string> TexturePackagePaths { get; set; } = [];
}

public sealed class FoxWatchAssetExportWorkerResult
{
    public int SchemaVersion { get; set; } = 1;

    public int WorkerIndex { get; set; }

    public int CompletedJobs { get; set; }

    public List<string> ReferencedMaterialPackagePaths { get; set; } = [];

    public List<string> ReferencedTexturePackagePaths { get; set; } = [];
}
