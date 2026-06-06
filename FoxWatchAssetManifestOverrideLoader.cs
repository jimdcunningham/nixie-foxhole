namespace FoxWatchService;

using System.Text.Json;

public sealed class FoxWatchAssetManifestOverrideLoader
{
    private readonly ILogger<FoxWatchAssetManifestOverrideLoader> _logger;

    public FoxWatchAssetManifestOverrideLoader(ILogger<FoxWatchAssetManifestOverrideLoader> logger)
    {
        _logger = logger;
    }

    public string GetStructureOverridePath(string structureId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(structureId);

        return Path.Combine(FoxWatchWorkspace.OverrideRoot, structureId, "manifest.json");
    }

    public string GetLegacyStructureOverridePath(string structureId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(structureId);

        return Path.Combine(FoxWatchWorkspace.LegacyAssetOverrideRoot, structureId, "manifest.json");
    }

    public bool TryLoadStructureOverride(string structureId, out JsonElement overrideElement)
    {
        var filePath = ResolveExistingOverridePath(structureId);
        if (!File.Exists(filePath))
        {
            overrideElement = default;
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(filePath));
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                _logger.LogWarning(
                    "Skipping structure manifest override at {OverridePath} for {StructureId} because the root value must be an object",
                    filePath,
                    structureId);
                overrideElement = default;
                return false;
            }

            overrideElement = document.RootElement.Clone();
            return true;
        }
        catch (JsonException exception)
        {
            _logger.LogWarning(exception, "Failed to parse structure manifest override at {OverridePath} for {StructureId}", filePath, structureId);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Failed to read structure manifest override at {OverridePath} for {StructureId}", filePath, structureId);
        }

        overrideElement = default;
        return false;
    }

    public IReadOnlyList<string> GetStructureOverrideIds()
    {
        var structureIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        CollectStructureOverrideIds(FoxWatchWorkspace.LegacyAssetOverrideRoot, structureIds);
        CollectStructureOverrideIds(FoxWatchWorkspace.OverrideRoot, structureIds);
        return structureIds.OrderBy(id => id, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private string ResolveExistingOverridePath(string structureId)
    {
        var primaryPath = GetStructureOverridePath(structureId);
        if (File.Exists(primaryPath))
        {
            return primaryPath;
        }

        return GetLegacyStructureOverridePath(structureId);
    }

    private static void CollectStructureOverrideIds(string rootPath, ISet<string> structureIds)
    {
        if (!Directory.Exists(rootPath))
        {
            return;
        }

        foreach (var directoryPath in Directory.EnumerateDirectories(rootPath))
        {
            var manifestPath = Path.Combine(directoryPath, "manifest.json");
            if (!File.Exists(manifestPath))
            {
                continue;
            }

            var structureId = Path.GetFileName(directoryPath);
            if (string.IsNullOrWhiteSpace(structureId))
            {
                continue;
            }

            structureIds.Add(structureId.Trim());
        }
    }
}