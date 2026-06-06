namespace FoxWatchService;

public sealed class FoxWatchOptions
{
    public const string SectionName = "FoxWatch";

    public string? PakDirectoryPath { get; set; }

    public string? ManifestOutputPath { get; set; } = FoxWatchWorkspace.DefaultManifestOutputRelativePath;

    public string? MapDataOutputPath { get; set; } = FoxWatchWorkspace.DefaultMapDataOutputRelativePath;

    public string? IconOutputDirectory { get; set; } = FoxWatchWorkspace.DefaultIconOutputRelativePath;

    public string? TextureOutputDirectory { get; set; } = FoxWatchWorkspace.DefaultTextureOutputRelativePath;

    public string? RenderSceneOutputDirectory { get; set; } = FoxWatchWorkspace.DefaultRenderSceneOutputRelativePath;

    public string? RenderAssetOutputDirectory { get; set; } = FoxWatchWorkspace.DefaultRenderAssetOutputRelativePath;

    public string? MeshProbeOutputPath { get; set; } = FoxWatchWorkspace.DefaultMeshProbeOutputRelativePath;

    public string? BaseAssetsUrl { get; set; } = FoxWatchWorkspace.DefaultBaseAssetsUrl;
}
