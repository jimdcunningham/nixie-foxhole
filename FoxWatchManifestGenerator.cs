namespace FoxWatchService;

using System.Diagnostics;
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
        var totalStopwatch = Stopwatch.StartNew();
        if (!string.IsNullOrWhiteSpace(pakDirectoryPath) && Directory.Exists(pakDirectoryPath))
        {
            _logger.LogInformation("Generating FoxWatch manifest from {PakDirectoryPath}", pakDirectoryPath);

            try
            {
                var iconOutputDirectory = FoxWatchWorkspace.ResolvePath(_options.Value.IconOutputDirectory);
                var rawCachePath = ResolveRawManifestCachePath(rawCacheKey);
                var manifest = TryReadRawManifestCache(rawCachePath);
                FoxWatchManifestAssetExtractor? extractor = null;
                var extractionStopwatch = Stopwatch.StartNew();
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
                extractionStopwatch.Stop();

                manifest.Localizations[0].Strings["foxhole:meta:baseAssetsUrl"] = baseAssetsUrl;
                _logger.LogInformation("Resolved {StructureCount} structures across {CategoryCount} categories from direct extraction", manifest.Assets.Count, manifest.Categories.Count);
                var hydrationStopwatch = Stopwatch.StartNew();
                manifest = _manifestReferenceHydrator.Hydrate(manifest);
                hydrationStopwatch.Stop();
                // Hydration can inject/synthetic-merge modification variants after extraction
                // AssignRenderIds; re-assign so every non-default slot variant has a renderId.
                var identityStopwatch = Stopwatch.StartNew();
                FoxWatchModificationRenderIdentity.AssignRenderIds(manifest);
                identityStopwatch.Stop();
                var categoryIconStopwatch = Stopwatch.StartNew();
                var exportedCategoryIconCount = extractor?.ExportCategoryIcons(manifest.Categories, iconOutputDirectory) ?? 0;
                categoryIconStopwatch.Stop();
                if (exportedCategoryIconCount > 0)
                {
                    _logger.LogInformation("Exported {ExportedCategoryIconCount} category icon(s) from pak textures", exportedCategoryIconCount);
                }

                if (extractor != null)
                {
                    var timings = extractor.ExtractionTimings;
                    _logger.LogInformation(
                        "Manifest extraction stages: mount/index {MountIndexMs:F0} ms, candidate discovery {CandidateDiscoveryMs:F0} ms, decoded reads {DecodedReadMs:F0} ms, structure interpretation {StructureInterpretationMs:F0} ms, referenced build sites {ReferencedBuildSiteMs:F0} ms, post-processing {PostProcessingMs:F0} ms, localization {LocalizationMs:F0} ms, shared data {SharedDataMs:F0} ms ({CandidatePackageCount} candidate package(s))",
                        timings.MountAndIndex.TotalMilliseconds,
                        timings.CandidateDiscovery.TotalMilliseconds,
                        timings.DecodedReads.TotalMilliseconds,
                        timings.StructureInterpretation.TotalMilliseconds,
                        timings.ReferencedBuildSites.TotalMilliseconds,
                        timings.PostProcessing.TotalMilliseconds,
                        timings.Localization.TotalMilliseconds,
                        timings.SharedData.TotalMilliseconds,
                        timings.CandidatePackageCount);
                    if (timings.SlowPackages.Count > 0)
                    {
                    _logger.LogInformation(
                        "Slowest manifest packages: {SlowPackages}",
                            string.Join(
                                ", ",
                                timings.SlowPackages.Select(entry => $"{entry.PackagePath} {entry.Elapsed.TotalMilliseconds:F0} ms")));
                    }
                    _logger.LogInformation(
                        "Inherited blueprint properties: {LookupCount} lookup(s) in {LookupMs:F0} ms",
                        extractor.InheritedPropertyLookupCount,
                        extractor.InheritedPropertyLookupElapsed.TotalMilliseconds);
                    _logger.LogInformation(
                        "Structure extraction phases: core metadata/icons {CoreMs:F0} ms, spatial components {SpatialMs:F0} ms, production/modifications {ProductionMs:F0} ms, combat/render metadata {CombatRenderMs:F0} ms, model assembly {AssemblyMs:F0} ms",
                        extractor.CoreMetadataExtractionElapsed.TotalMilliseconds,
                        extractor.SpatialComponentExtractionElapsed.TotalMilliseconds,
                        extractor.ProductionModificationExtractionElapsed.TotalMilliseconds,
                        extractor.CombatRenderExtractionElapsed.TotalMilliseconds,
                        extractor.ModelAssemblyElapsed.TotalMilliseconds);
                    _logger.LogInformation(
                        "Spatial extraction detail: sockets {SocketsMs:F0} ms, crane spawns {CraneMs:F0} ms, emplacement {EmplacementMs:F0} ms, rail couplers {RailMs:F0} ms, footprints/volumes {VolumesMs:F0} ms, vehicle seats {SeatsMs:F0} ms, spotlights {SpotlightsMs:F0} ms",
                        extractor.BuildSocketExtractionElapsed.TotalMilliseconds,
                        extractor.CraneSpawnExtractionElapsed.TotalMilliseconds,
                        extractor.EmplacementExtractionElapsed.TotalMilliseconds,
                        extractor.RailCouplerExtractionElapsed.TotalMilliseconds,
                        extractor.FootprintVolumeExtractionElapsed.TotalMilliseconds,
                        extractor.VehicleSeatExtractionElapsed.TotalMilliseconds,
                        extractor.SpotlightExtractionElapsed.TotalMilliseconds);
                    _logger.LogInformation(
                        "Manifest package-summary caches: blueprint components {BlueprintComponentHits} hit(s), {BlueprintComponentMisses} miss(es) in {BlueprintComponentMs:F0} ms; mesh-axis bounds {MeshAxisHits} hit(s), {MeshAxisMisses} miss(es) in {MeshAxisMs:F0} ms; modification data {ModificationDataHits} hit(s), {ModificationDataMisses} miss(es); variant inspection {VariantHits} hit(s), {VariantMisses} miss(es)",
                        _meshAssetExporter.BlueprintComponentCacheHits,
                        _meshAssetExporter.BlueprintComponentCacheMisses,
                        _meshAssetExporter.BlueprintComponentInspectionElapsed.TotalMilliseconds,
                        _meshAssetExporter.MeshAxisLengthCacheHits,
                        _meshAssetExporter.MeshAxisLengthCacheMisses,
                        _meshAssetExporter.MeshAxisLengthInspectionElapsed.TotalMilliseconds,
                        extractor.ModificationDataCacheHits,
                        extractor.ModificationDataCacheMisses,
                        _meshAssetExporter.ModificationVariantCacheHits,
                        _meshAssetExporter.ModificationVariantCacheMisses);
                }

                _logger.LogInformation(
                    "Manifest timings: extraction {ExtractionMs:F0} ms, hydration {HydrationMs:F0} ms, render identities {IdentityMs:F0} ms, category icons {CategoryIconMs:F0} ms, total {TotalMs:F0} ms",
                    extractionStopwatch.Elapsed.TotalMilliseconds,
                    hydrationStopwatch.Elapsed.TotalMilliseconds,
                    identityStopwatch.Elapsed.TotalMilliseconds,
                    categoryIconStopwatch.Elapsed.TotalMilliseconds,
                    totalStopwatch.Elapsed.TotalMilliseconds);

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
            "pipeline-cache",
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
