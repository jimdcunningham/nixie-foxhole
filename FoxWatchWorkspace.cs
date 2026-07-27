namespace FoxWatchService;

public static class FoxWatchWorkspace
{
    public static readonly string RepositoryRoot = FindRepositoryRoot();
    private static readonly string[] DefaultPakDirectoryCandidates =
    [
        @"C:\Program Files (x86)\Steam\steamapps\common\Foxhole\War\Content\Paks",
        @"C:\Program Files\Steam\steamapps\common\Foxhole\War\Content\Paks",
    ];

    public static readonly string OverrideRoot = Path.Combine(RepositoryRoot, "tools", "foxwatch", "asset-overrides");
    public static readonly string SharedModificationOverrideManifestPath = Path.Combine(OverrideRoot, "modifications.json");
    public static readonly string BunkerDestructionOverrideManifestPath = Path.Combine(OverrideRoot, "bunker-destruction.json");
    public static readonly string LegacyAssetOverrideRoot = Path.Combine(RepositoryRoot, "tools", "foxwatch", "assets");
    public static readonly string LegacyPoseOverrideRoot = Path.Combine(RepositoryRoot, "tools", "foxwatch", "pose-overrides");

    public const string ImportedCategoryCatalogRelativePath = "tools/foxwatch/asset-overrides/categories.json";
    public const string NonCodeNameStructureWhitelistRelativePath = "tools/foxwatch/asset-overrides/non-codename-whitelist.json";
    public const string DefaultManifestOutputRelativePath = "tools/foxwatch/tmp/foxwatch-manifest.v1.json";
    public const string DefaultModificationRenderIndexRelativePath = "tools/foxwatch/tmp/modification-render-index.v1.json";
    public const string DefaultBlueprintTargetIndexRelativePath = "tools/foxwatch/tmp/foxwatch-blueprint-target-index.v1.json";
    public const string DefaultMapDataOutputRelativePath = "tools/foxwatch/tmp/foxwatch-map-data.v1.json";
    public const string DefaultIconOutputRelativePath = "tools/foxwatch/tmp/foxhole-icons";
    public const string DefaultTextureOutputRelativePath = "tools/foxwatch/tmp/pak-assets";
    public const string DefaultRenderSceneOutputRelativePath = "tools/foxwatch/tmp/renders";
    public const string DefaultRenderAssetOutputRelativePath = "tools/foxwatch/tmp/assets";
    public const string DefaultMeshProbeOutputRelativePath = "tools/foxwatch/tmp/mesh-export-probe.v1.json";
    public const string DefaultPackageDumpOutputRelativePath = "tools/foxwatch/tmp/package-dumps";
    public const string DefaultBaseAssetsUrl = "/foxhole/assets/";

    public static string? ResolvePath(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        return Path.IsPathRooted(value)
            ? Path.GetFullPath(value)
            : Path.GetFullPath(value, RepositoryRoot);
    }

    public static string? ResolvePakDirectoryPath(string? configuredPath)
    {
        var resolvedConfiguredPath = ResolvePath(configuredPath);
        if (!string.IsNullOrWhiteSpace(resolvedConfiguredPath))
        {
            return resolvedConfiguredPath;
        }

        return DefaultPakDirectoryCandidates.FirstOrDefault(Directory.Exists);
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        string? packageJsonRoot = null;
        while (current is not null)
        {
            var directoryPath = current.FullName;
            if (IsRepositoryRoot(directoryPath))
            {
                return directoryPath;
            }

            if (packageJsonRoot is null && File.Exists(Path.Combine(directoryPath, "package.json")))
            {
                packageJsonRoot = directoryPath;
            }

            current = current.Parent;
        }

        return packageJsonRoot ?? Directory.GetCurrentDirectory();
    }

    private static bool IsRepositoryRoot(string directoryPath)
    {
        return Directory.Exists(Path.Combine(directoryPath, "apps", "foxhole-planner"))
            && Directory.Exists(Path.Combine(directoryPath, "tools", "foxwatch", "asset-overrides"));
    }
}
