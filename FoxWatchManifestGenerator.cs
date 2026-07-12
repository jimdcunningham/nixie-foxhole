namespace FoxWatchService;

using System.Text.Json;
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
        await File.WriteAllTextAsync(outputPath, $"{json}{Environment.NewLine}", cancellationToken);
        _logger.LogInformation("Wrote FoxWatch manifest to {OutputPath}", outputPath);

        var renderIndex = FoxWatchModificationRenderIdentity.BuildRenderIndex(manifest);
        var renderIndexPath = Path.Combine(
            outputDirectory ?? FoxWatchWorkspace.ResolvePath("tmp"),
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

    public FoxWatchManifest BuildManifest(string baseAssetsUrl, string? pakDirectoryPath, FoxWatchTargetFilter? targetFilter = null)
    {
        if (!string.IsNullOrWhiteSpace(pakDirectoryPath) && Directory.Exists(pakDirectoryPath))
        {
            _logger.LogInformation("Generating FoxWatch manifest from {PakDirectoryPath}", pakDirectoryPath);

            try
            {
                var extractor = new FoxWatchManifestAssetExtractor(
                    pakDirectoryPath,
                    _meshAssetExporter,
                    _nonCodeNameStructureWhitelistLoader);
                var iconOutputDirectory = FoxWatchWorkspace.ResolvePath(_options.Value.IconOutputDirectory);
                var manifest = extractor.BuildStructureManifest(baseAssetsUrl, iconOutputDirectory, targetFilter);
                manifest.Localizations[0].Strings["foxhole:meta:baseAssetsUrl"] = baseAssetsUrl;
                _logger.LogInformation("Resolved {StructureCount} structures across {CategoryCount} categories from direct extraction", manifest.Assets.Count, manifest.Categories.Count);
                manifest = _manifestReferenceHydrator.Hydrate(manifest);
                // Hydration can inject/synthetic-merge modification variants after extraction
                // AssignRenderIds; re-assign so every non-default slot variant has a renderId.
                FoxWatchModificationRenderIdentity.AssignRenderIds(manifest);
                var exportedCategoryIconCount = extractor.ExportCategoryIcons(manifest.Categories, iconOutputDirectory);
                if (exportedCategoryIconCount > 0)
                {
                    _logger.LogInformation("Exported {ExportedCategoryIconCount} category icon(s) from pak textures", exportedCategoryIconCount);
                }

                return ApplyTargetFilter(manifest, targetFilter);
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Falling back to scaffold manifest because direct extraction failed");
            }
        }
        else
        {
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
            Categories = filteredCategories,
            Assets = filteredAssets,
            Items = manifest.Items,
            Localizations = manifest.Localizations,
        };
    }
}
