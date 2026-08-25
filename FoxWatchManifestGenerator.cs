namespace FoxWatchService;

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

public sealed class FoxWatchManifestGenerator
{
    private readonly FoxWatchManifestReferenceHydrator _manifestReferenceHydrator;
    private readonly FoxWatchAssetMeshExporter _meshAssetExporter;
    private readonly FoxWatchNonCodeNameStructureWhitelistLoader _nonCodeNameStructureWhitelistLoader;
    private readonly IOptions<FoxWatchOptions> _options;
    private readonly ILogger<FoxWatchManifestGenerator> _logger;

    public FoxWatchManifestGenerator(
        ILogger<FoxWatchManifestGenerator> logger,
        IOptions<FoxWatchOptions> options,
        FoxWatchAssetMeshExporter meshAssetExporter,
        FoxWatchNonCodeNameStructureWhitelistLoader nonCodeNameStructureWhitelistLoader,
        FoxWatchManifestReferenceHydrator manifestReferenceHydrator)
    {
        _logger = logger;
        _options = options;
        _meshAssetExporter = meshAssetExporter;
        _nonCodeNameStructureWhitelistLoader = nonCodeNameStructureWhitelistLoader;
        _manifestReferenceHydrator = manifestReferenceHydrator;
    }

    public async Task GenerateAsync(string outputPath, string baseAssetsUrl, string? pakDirectoryPath, FoxWatchTargetFilter? targetFilter = null, CancellationToken cancellationToken = default)
    {
        var manifest = BuildManifest(baseAssetsUrl, pakDirectoryPath, targetFilter);
        await WriteAsync(manifest, outputPath, targetFilter, cancellationToken);
    }

    public async Task WriteAsync(FoxWatchManifest manifest, string outputPath, FoxWatchTargetFilter? targetFilter = null, CancellationToken cancellationToken = default)
    {
        var serializerOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = true,
        };

        var outputDirectory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(outputDirectory))
        {
            Directory.CreateDirectory(outputDirectory);
        }

        var json = JsonSerializer.Serialize(manifest, serializerOptions);
        if (targetFilter is { HasFilters: true })
        {
            json = TryMergeTargetedManifestJson(outputPath, json, serializerOptions);
        }
        await File.WriteAllTextAsync(outputPath, $"{json}{Environment.NewLine}", cancellationToken);
        _logger.LogInformation("Wrote FoxWatch manifest to {OutputPath}", outputPath);

        var renderIndex = FoxWatchModificationRenderIdentity.BuildRenderIndex(manifest);
        var renderIndexPath = Path.Combine(
            outputDirectory ?? FoxWatchWorkspace.ResolvePath("tools/foxwatch/tmp") ?? Path.Combine(FoxWatchWorkspace.RepositoryRoot, "tools", "foxwatch", "tmp"),
            "modification-render-index.v1.json");
        if (targetFilter is { HasFilters: true })
        {
            var existingRenderIndex = await FoxWatchModificationRenderIndexWriter.LoadAsync(renderIndexPath, cancellationToken);
            if (existingRenderIndex != null)
            {
                var scopedStructureIds = manifest.Assets
                    .Select(structure => structure.Id)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                renderIndex = FoxWatchModificationRenderIdentity.MergeRenderIndex(
                    existingRenderIndex,
                    renderIndex,
                    scopedStructureIds);
            }
        }

        await FoxWatchModificationRenderIndexWriter.WriteAsync(renderIndex, renderIndexPath, cancellationToken);
        _logger.LogInformation("Wrote modification render index to {RenderIndexPath}", renderIndexPath);
    }

    public FoxWatchManifest BuildManifest(string baseAssetsUrl, string? pakDirectoryPath, FoxWatchTargetFilter? targetFilter = null, bool strictExtraction = false, string? rawCacheKey = null)
    {
        if (!string.IsNullOrWhiteSpace(pakDirectoryPath) && Directory.Exists(pakDirectoryPath))
        {
            _logger.LogInformation("Generating FoxWatch manifest from {PakDirectoryPath}", pakDirectoryPath);

            try
            {
                var iconOutputDirectory = FoxWatchWorkspace.ResolvePath(_options.Value.IconOutputDirectory);
                var rawCachePath = ResolveRawManifestCachePath(rawCacheKey);
                var manifest = TryReadRawManifestCache(rawCachePath);
                FoxWatchManifestAssetExtractor? extractor = null;
                if (manifest == null)
                {
                    extractor = new FoxWatchManifestAssetExtractor(
                        pakDirectoryPath,
                        _meshAssetExporter,
                        _nonCodeNameStructureWhitelistLoader);
                    manifest = extractor.BuildStructureManifest(baseAssetsUrl, iconOutputDirectory, targetFilter);
                    WriteRawManifestCache(rawCachePath, manifest);
                }
                else
                {
                    _logger.LogInformation("Reused cached raw FoxWatch extraction {RawCachePath}", rawCachePath);
                }

                manifest.Localizations[0].Strings["foxhole:meta:baseAssetsUrl"] = baseAssetsUrl;
                _logger.LogInformation("Resolved {StructureCount} structures across {CategoryCount} categories from direct extraction", manifest.Assets.Count, manifest.Categories.Count);
                manifest = _manifestReferenceHydrator.Hydrate(manifest);
                // Hydration can inject/synthetic-merge modification variants after extraction
                // AssignRenderIds; re-assign so every non-default slot variant has a renderId.
                FoxWatchModificationRenderIdentity.AssignRenderIds(manifest);
                var exportedCategoryIconCount = extractor?.ExportCategoryIcons(manifest.Categories, iconOutputDirectory) ?? 0;
                if (exportedCategoryIconCount > 0)
                {
                    _logger.LogInformation("Exported {ExportedCategoryIconCount} category icon(s) from pak textures", exportedCategoryIconCount);
                }

                return ApplyTargetFilter(manifest, targetFilter);
            }
            catch (Exception exception)
            {
                if (strictExtraction)
                {
                    throw new InvalidOperationException($"Strict FoxWatch extraction failed for '{pakDirectoryPath}'.", exception);
                }

                _logger.LogWarning(exception, "Falling back to scaffold manifest because direct extraction failed");
            }
        }
        else
        {
            if (strictExtraction)
            {
                throw new DirectoryNotFoundException($"Strict FoxWatch extraction requires a valid pak directory: '{pakDirectoryPath}'.");
            }

            _logger.LogWarning("FoxWatch manifest generation is scaffolded only. Pak directory is unavailable: {PakDirectoryPath}", pakDirectoryPath);
        }

        return ApplyTargetFilter(new FoxWatchManifest
        {
            Source = new FoxWatchManifestSource
            {
                Kind = "foxwatch",
            },
            Localizations = [
                new FoxWatchLocalizationBundle
                {
                    Locale = "en",
                    Strings = new Dictionary<string, string>
                    {
                        ["foxhole:meta:baseAssetsUrl"] = baseAssetsUrl,
                    },
                },
            ],
        }, targetFilter);
    }

    private string TryMergeTargetedManifestJson(string outputPath, string targetedJson, JsonSerializerOptions serializerOptions)
    {
        if (!File.Exists(outputPath))
        {
            return targetedJson;
        }

        try
        {
            var existing = JsonNode.Parse(File.ReadAllText(outputPath))?.AsObject();
            var targeted = JsonNode.Parse(targetedJson)?.AsObject();
            if (existing == null || targeted == null)
            {
                return targetedJson;
            }

            MergeArrayById(existing, targeted, "assets");
            MergeArrayById(existing, targeted, "categories");
            MergeLocalizations(existing, targeted);
            existing["schemaVersion"] = targeted["schemaVersion"]?.DeepClone();
            existing["source"] = targeted["source"]?.DeepClone();
            existing["shared"] = targeted["shared"]?.DeepClone();
            if (targeted["items"] is JsonArray { Count: > 0 } targetedItems)
            {
                existing["items"] = targetedItems.DeepClone();
            }
            var targetedAssetCount = targeted["assets"]?.AsArray().Count ?? 0;
            var mergedAssetCount = existing["assets"]?.AsArray().Count ?? 0;
            _logger.LogInformation("Merged {TargetedAssetCount} targeted assets into the existing {ExistingAssetCount}-asset raw manifest", targetedAssetCount, mergedAssetCount);
            return existing.ToJsonString(serializerOptions);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not merge targeted manifest into {OutputPath}; writing the targeted manifest only", outputPath);
            return targetedJson;
        }
    }

    private static void MergeArrayById(JsonObject existing, JsonObject targeted, string propertyName)
    {
        if (targeted[propertyName] is not JsonArray targetedValues)
        {
            return;
        }
        var targetedIds = targetedValues
            .OfType<JsonObject>()
            .Select(value => value["id"]?.GetValue<string>())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var merged = new List<JsonNode?>();
        foreach (var value in existing[propertyName]?.AsArray() ?? [])
        {
            var id = value?["id"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(id) || !targetedIds.Contains(id))
            {
                merged.Add(value?.DeepClone());
            }
        }
        foreach (var value in targetedValues)
        {
            merged.Add(value?.DeepClone());
        }
        existing[propertyName] = new JsonArray(merged
            .OrderBy(value => value?["id"]?.GetValue<string>(), StringComparer.Ordinal)
            .ToArray());
    }

    private static void MergeLocalizations(JsonObject existing, JsonObject targeted)
    {
        if (targeted["localizations"] is not JsonArray targetedBundles)
        {
            return;
        }
        var existingBundles = existing["localizations"] as JsonArray ?? new JsonArray();
        foreach (var targetedNode in targetedBundles.OfType<JsonObject>())
        {
            var locale = targetedNode["locale"]?.GetValue<string>();
            var existingNode = existingBundles
                .OfType<JsonObject>()
                .FirstOrDefault(bundle => string.Equals(bundle["locale"]?.GetValue<string>(), locale, StringComparison.OrdinalIgnoreCase));
            if (existingNode == null)
            {
                existingBundles.Add(targetedNode.DeepClone());
                continue;
            }
            if (targetedNode["strings"] is not JsonObject targetedStrings)
            {
                continue;
            }
            var existingStrings = existingNode["strings"] as JsonObject ?? new JsonObject();
            foreach (var (key, value) in targetedStrings)
            {
                existingStrings[key] = value?.DeepClone();
            }
            existingNode["strings"] = existingStrings;
        }
        existing["localizations"] = existingBundles;
    }

    private string? ResolveRawManifestCachePath(string? rawCacheKey)
    {
        if (string.IsNullOrWhiteSpace(rawCacheKey) || rawCacheKey.Any(character => !char.IsAsciiHexDigit(character)))
        {
            return null;
        }

        return FoxWatchWorkspace.ResolvePath(Path.Combine(
            "tools",
            "foxwatch",
            "tmp",
            "regen-cache",
            "v1",
            "raw-manifests",
            $"{rawCacheKey.ToLowerInvariant()}.json"));
    }

    private FoxWatchManifest? TryReadRawManifestCache(string? cachePath)
    {
        if (string.IsNullOrWhiteSpace(cachePath) || !File.Exists(cachePath))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<FoxWatchManifest>(File.ReadAllText(cachePath), new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Ignoring corrupt raw FoxWatch manifest cache {RawCachePath}", cachePath);
            return null;
        }
    }

    private void WriteRawManifestCache(string? cachePath, FoxWatchManifest manifest)
    {
        if (string.IsNullOrWhiteSpace(cachePath))
        {
            return;
        }

        var directory = Path.GetDirectoryName(cachePath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var temporaryPath = $"{cachePath}.{Environment.ProcessId}.tmp";
        var json = JsonSerializer.Serialize(manifest, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        });
        File.WriteAllText(temporaryPath, json);
        File.Move(temporaryPath, cachePath, overwrite: true);
        _logger.LogInformation("Cached raw FoxWatch extraction at {RawCachePath}", cachePath);
    }

    private FoxWatchManifest ApplyTargetFilter(FoxWatchManifest manifest, FoxWatchTargetFilter? targetFilter)
    {
        if (targetFilter == null || !targetFilter.HasFilters)
        {
            return manifest;
        }

        var filteredAssets = manifest.Assets
            .Where(targetFilter.Matches)
            .ToList();
        var categoryIds = filteredAssets
            .Select(structure => structure.CategoryId)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var filteredCategories = manifest.Categories
            .Where(category => categoryIds.Contains(category.Id))
            .ToList();

        _logger.LogInformation(
            "Applied FoxWatch target filter ({TargetFilter}) => {StructureCount}/{OriginalStructureCount} structures, {CategoryCount}/{OriginalCategoryCount} categories",
            targetFilter,
            filteredAssets.Count,
            manifest.Assets.Count,
            filteredCategories.Count,
            manifest.Categories.Count);

        return new FoxWatchManifest
        {
            SchemaVersion = manifest.SchemaVersion,
            Source = manifest.Source,
            Shared = manifest.Shared,
            Categories = filteredCategories,
            Assets = filteredAssets,
            Items = manifest.Items,
            Localizations = manifest.Localizations,
        };
    }
}
