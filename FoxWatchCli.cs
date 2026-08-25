namespace FoxWatchService;

using System.Collections.Concurrent;
using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Text.Json.Nodes;

public static class FoxWatchCli
{
    public static async Task<int> RunGenerateMapDataAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchMapDataGenerator>(configuration);

        var (logger, generator, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchMapDataGenerator>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var outputPath = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output") ?? configuredOptions.MapDataOutputPath,
            "output",
            "FoxWatch:MapDataOutputPath",
            "map data output path");
        if (outputPath == null)
        {
            return 1;
        }

        await generator.GenerateAsync(outputPath);
        return 0;
    }

    public static async Task<int> RunGenerateManifestAsync(string[] args)
    {
        var parsedArguments = FoxWatchCliArguments.Parse(args);
        var verbose = parsedArguments.ContainsKey("verbose");
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider(
            configuration,
            builder => FoxWatchCliSupport.ApplyStandardLoggingFilters(builder, verbose));

        var (logger, generator, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchManifestGenerator>(provider);
        var targetFilter = FoxWatchTargetFilter.FromArguments(parsedArguments);

        var outputPath = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output") ?? configuredOptions.ManifestOutputPath,
            "output",
            "FoxWatch:ManifestOutputPath",
            "manifest output path");
        if (outputPath == null)
        {
            return 1;
        }

        var baseAssetsUrl = parsedArguments.GetValueOrDefault("base-assets-url") ?? configuredOptions.BaseAssetsUrl ?? FoxWatchWorkspace.DefaultBaseAssetsUrl;
        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: false);

        await generator.GenerateAsync(outputPath, baseAssetsUrl, pakDirectoryPath, targetFilter);
        return 0;
    }

    public static async Task<int> RunExtractUiAssetsAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetTextureExporter>(configuration);

        var (logger, exporter, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetTextureExporter>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return 1;
        }

        var outputDirectory = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output-dir") ?? configuredOptions.TextureOutputDirectory,
            "output-dir",
            "FoxWatch:TextureOutputDirectory",
            "texture output directory");
        if (outputDirectory == null)
        {
            return 1;
        }

        var pathPrefixes = parsedArguments.GetListValues("path-prefix");
        if (pathPrefixes.Count == 0)
        {
            pathPrefixes =
            [
                "War/Content/Textures/UI/MapIcons/",
                "War/Content/Textures/UI/HexMaps/",
            ];
        }

        var exportedPaths = await exporter.ExportTexturesByPathPrefixesAsync(pathPrefixes, outputDirectory);
        logger.LogInformation("Exported {TextureCount} UI textures to {OutputDirectory}", exportedPaths.Count, outputDirectory);
        return 0;
    }

    public static async Task<int> RunGenerateRenderScenesAsync(string[] args)
    {
        var parsedArguments = FoxWatchCliArguments.Parse(args);
        var verbose = parsedArguments.ContainsKey("verbose");
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider(
            configuration,
            builder => FoxWatchCliSupport.ApplyStandardLoggingFilters(builder, verbose));

        var (logger, generator, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchRenderSceneGenerator>(provider);
        var targetFilter = FoxWatchTargetFilter.FromArguments(parsedArguments);

        var outputDirectory = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output-dir") ?? configuredOptions.RenderSceneOutputDirectory,
            "output-dir",
            "FoxWatch:RenderSceneOutputDirectory",
            "render bundle output directory");
        if (outputDirectory == null)
        {
            return 1;
        }

        var renderAssetOutputDirectory = FoxWatchWorkspace.ResolvePath(parsedArguments.GetValueOrDefault("render-asset-output-dir") ?? configuredOptions.RenderAssetOutputDirectory);

        var baseAssetsUrl = parsedArguments.GetValueOrDefault("base-assets-url") ?? configuredOptions.BaseAssetsUrl ?? FoxWatchWorkspace.DefaultBaseAssetsUrl;
        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: false);
        await generator.GenerateAsync(
            outputDirectory,
            renderAssetOutputDirectory,
            baseAssetsUrl,
            pakDirectoryPath,
            targetFilter,
            includePoseVariants: parsedArguments.ContainsKey("pose-variants"));
        return 0;
    }

    public static async Task<int> RunPrepareRegenAsync(string[] args)
    {
        var parsedArguments = FoxWatchCliArguments.Parse(args);
        var verbose = parsedArguments.ContainsKey("verbose");
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider(
            configuration,
            builder => FoxWatchCliSupport.ApplyStandardLoggingFilters(builder, verbose));

        var logger = provider.GetRequiredService<ILoggerFactory>().CreateLogger("prepare-regen");
        var configuredOptions = provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<FoxWatchOptions>>().Value;
        var manifestGenerator = provider.GetRequiredService<FoxWatchManifestGenerator>();
        var renderSceneGenerator = provider.GetRequiredService<FoxWatchRenderSceneGenerator>();
        var targetFilter = FoxWatchTargetFilter.FromArguments(parsedArguments);

        var outputPath = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output") ?? configuredOptions.ManifestOutputPath,
            "output",
            "FoxWatch:ManifestOutputPath",
            "manifest output path");
        var outputDirectory = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output-dir") ?? configuredOptions.RenderSceneOutputDirectory,
            "output-dir",
            "FoxWatch:RenderSceneOutputDirectory",
            "render bundle output directory");
        if (outputPath == null || outputDirectory == null)
        {
            return 1;
        }

        var renderAssetOutputDirectory = FoxWatchWorkspace.ResolvePath(parsedArguments.GetValueOrDefault("render-asset-output-dir") ?? configuredOptions.RenderAssetOutputDirectory);
        var baseAssetsUrl = parsedArguments.GetValueOrDefault("base-assets-url") ?? configuredOptions.BaseAssetsUrl ?? FoxWatchWorkspace.DefaultBaseAssetsUrl;
        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return 1;
        }

        var manifest = manifestGenerator.BuildManifest(
            baseAssetsUrl,
            pakDirectoryPath,
            targetFilter,
            strictExtraction: parsedArguments.ContainsKey("strict"),
            rawCacheKey: parsedArguments.GetValueOrDefault("raw-cache-key"));
        if (manifest.Assets.Count == 0)
        {
            logger.LogError("Strict regen extraction produced no requested assets; refusing to write or render outputs.");
            return 1;
        }

        var requestedAssetIds = parsedArguments.GetListValues("only")
            .Select(value => value.Trim().ToLowerInvariant())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var extractedAssetIds = manifest.Assets
            .Select(asset => asset.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missingAssetIds = requestedAssetIds
            .Where(assetId => !extractedAssetIds.Contains(assetId))
            .OrderBy(assetId => assetId, StringComparer.Ordinal)
            .ToArray();
        if (missingAssetIds.Length > 0)
        {
            logger.LogError("Strict regen extraction did not resolve requested assets: {MissingAssetIds}", string.Join(", ", missingAssetIds));
            return 1;
        }

        await manifestGenerator.WriteAsync(manifest, outputPath, targetFilter);
        await renderSceneGenerator.GenerateAsync(
            manifest,
            outputDirectory,
            renderAssetOutputDirectory,
            baseAssetsUrl,
            pakDirectoryPath,
            targetFilter,
            includePoseVariants: parsedArguments.ContainsKey("pose-variants"));
        var regenPlanPath = parsedArguments.GetValueOrDefault("regen-plan");
        if (!string.IsNullOrWhiteSpace(regenPlanPath))
        {
            await EnrichRegenPlanAsync(
                FoxWatchWorkspace.ResolvePath(regenPlanPath)!,
                Path.Combine(outputDirectory, "index.render-scenes.v1.json"),
                manifest);
        }
        logger.LogInformation("Prepared regen manifest and scenes from one hydrated extraction pass for {AssetCount} asset(s)", manifest.Assets.Count);
        return 0;
    }

    private static async Task EnrichRegenPlanAsync(string planPath, string sceneIndexPath, FoxWatchManifest manifest)
    {
        var plan = JsonNode.Parse(await File.ReadAllTextAsync(planPath))?.AsObject()
            ?? throw new InvalidDataException($"Invalid regen plan: {planPath}");
        var sceneIndex = JsonNode.Parse(await File.ReadAllTextAsync(sceneIndexPath))?.AsObject()
            ?? throw new InvalidDataException($"Invalid render scene index: {sceneIndexPath}");
        var modesByAsset = plan["modesByAsset"]?.AsObject();
        var jobs = new JsonArray();
        var seenJobs = new HashSet<string>(StringComparer.Ordinal);

        foreach (var sceneNode in sceneIndex["scenes"]?.AsArray() ?? [])
        {
            if (sceneNode is not JsonObject scene)
            {
                continue;
            }

            var sceneEntry = scene["outputPath"]?.GetValue<string>();
            var structureIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (scene["structureId"]?.GetValue<string>() is { Length: > 0 } structureId)
            {
                structureIds.Add(structureId);
            }
            foreach (var allowedId in scene["allowedStructureIds"]?.AsArray() ?? [])
            {
                if (allowedId?.GetValue<string>() is { Length: > 0 } value)
                {
                    structureIds.Add(value);
                }
            }

            var requestedModes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var assetId in structureIds)
            {
                if (modesByAsset?[assetId] is not JsonArray assetModes)
                {
                    continue;
                }
                foreach (var modeNode in assetModes)
                {
                    var mode = modeNode?.GetValue<string>();
                    if (mode is "preview" or "rendered-icon") requestedModes.Add("preview");
                    if (mode is "component") requestedModes.Add("topdown");
                }
            }

            foreach (var renderMode in requestedModes.OrderBy(value => value, StringComparer.Ordinal))
            {
                var jobKey = $"{sceneEntry}|default|{renderMode}";
                if (!seenJobs.Add(jobKey))
                {
                    continue;
                }
                jobs.Add(new JsonObject
                {
                    ["jobKey"] = jobKey,
                    ["sceneEntry"] = sceneEntry,
                    ["sceneVariant"] = null,
                    ["renderMode"] = renderMode,
                    ["structureIds"] = new JsonArray(structureIds
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .Select(value => (JsonNode?)JsonValue.Create(value))
                        .ToArray()),
                });
            }
        }

        plan["preparedAt"] = DateTimeOffset.UtcNow.ToString("O");
        plan["preparedManifestAssetCount"] = manifest.Assets.Count;
        plan["manifestChanges"] = new JsonArray(manifest.Assets
            .Select(asset => (JsonNode?)new JsonObject { ["assetId"] = asset.Id, ["status"] = "prepared" })
            .ToArray());
        plan["jobs"] = jobs;

        var temporaryPath = $"{planPath}.{Environment.ProcessId}.tmp";
        await File.WriteAllTextAsync(temporaryPath, $"{plan.ToJsonString(new JsonSerializerOptions { WriteIndented = true })}{Environment.NewLine}");
        File.Move(temporaryPath, planPath, overwrite: true);
    }

    public static async Task<int> RunProbeMeshExportAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetMeshExportProbe>(configuration);

        var (logger, probe, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetMeshExportProbe>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var outputPath = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output") ?? configuredOptions.MeshProbeOutputPath,
            "output",
            "FoxWatch:MeshProbeOutputPath",
            "mesh probe output path");
        if (outputPath == null)
        {
            return 1;
        }

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: false);
        await probe.WriteReportAsync(outputPath, pakDirectoryPath);
        return 0;
    }

    public static Task<int> RunFindMeshAssetsAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetMeshExporter>(configuration);

        var (logger, exporter, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetMeshExporter>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return Task.FromResult(1);
        }

        var query = parsedArguments.GetValueOrDefault("query");
        if (string.IsNullOrWhiteSpace(query))
        {
            logger.LogError("Missing mesh asset search query. Use --query <substring>.");
            return Task.FromResult(1);
        }

        var limitText = parsedArguments.GetValueOrDefault("limit");
        var limit = int.TryParse(limitText, out var parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
        foreach (var match in exporter.FindMeshPackages(query, limit))
        {
            logger.LogInformation("Mesh package: {MeshPackage}", match);
        }

        return Task.FromResult(0);
    }

    public static Task<int> RunFindAssetsAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetMeshExporter>(configuration);

        var (logger, exporter, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetMeshExporter>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return Task.FromResult(1);
        }

        var query = parsedArguments.GetValueOrDefault("query");
        if (string.IsNullOrWhiteSpace(query))
        {
            logger.LogError("Missing asset search query. Use --query <substring>.");
            return Task.FromResult(1);
        }

        var pathPrefix = parsedArguments.GetValueOrDefault("path-prefix");
        var limitText = parsedArguments.GetValueOrDefault("limit");
        var limit = int.TryParse(limitText, out var parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
        foreach (var match in exporter.FindPackages(query, limit, pathPrefix))
        {
            logger.LogInformation("Package: {PackagePath}", match);
        }

        return Task.FromResult(0);
    }

    public static async Task<int> RunInspectBlueprintAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetMeshExporter>(configuration);

        var (logger, exporter, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetMeshExporter>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return 1;
        }

        var assetPath = parsedArguments.GetValueOrDefault("asset-path");
        if (string.IsNullOrWhiteSpace(assetPath))
        {
            logger.LogError("Missing blueprint asset path. Use --asset-path <package path>.");
            return 1;
        }

        try
        {
            var references = await exporter.InspectBlueprintComponentsAsync(assetPath);
            foreach (var reference in references)
            {
                logger.LogInformation(
                    "Blueprint component: source={SourceClassName} | {ComponentName} | {ComponentType} | {MeshType} | {MeshPath} | parent={AttachParentName} socket={AttachSocketName} | rel loc={RelativeLocation} rot={RelativeRotation} scale={RelativeScale} | abs loc={AbsoluteLocation} rot={AbsoluteRotation} scale={AbsoluteScale}",
                    reference.SourceClassName,
                    reference.ComponentName,
                    reference.ComponentType,
                    reference.MeshType,
                    reference.MeshPath,
                    reference.AttachParentName,
                    reference.AttachSocketName,
                    reference.RelativeLocation,
                    reference.RelativeRotation,
                    reference.RelativeScale,
                    reference.AbsoluteLocation,
                    reference.AbsoluteRotation,
                    reference.AbsoluteScale);
            }

            return 0;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Blueprint inspection failed for {AssetPath}", assetPath);
            return 1;
        }
    }

    public static async Task<int> RunCompareAnimationReferencePoseAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetMeshExporter>(configuration);

        var (logger, exporter, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetMeshExporter>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return 1;
        }

        var animationAssetPath = parsedArguments.GetValueOrDefault("animation-path");
        if (string.IsNullOrWhiteSpace(animationAssetPath))
        {
            logger.LogError("Missing animation asset path. Use --animation-path <package path>.");
            return 1;
        }

        var referenceMeshAssetPath = parsedArguments.GetValueOrDefault("mesh-path");
        if (string.IsNullOrWhiteSpace(referenceMeshAssetPath))
        {
            logger.LogError("Missing reference mesh asset path. Use --mesh-path <package path or exported .glb path>.");
            return 1;
        }

        var limitText = parsedArguments.GetValueOrDefault("limit");
        var limit = int.TryParse(limitText, out var parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

        try
        {
            var comparison = await exporter.CompareAnimationSkeletonReferencePoseAsync(animationAssetPath, referenceMeshAssetPath);
            logger.LogInformation(
                "Compared animation ref pose {AnimationAssetPath} against mesh ref pose {ReferenceMeshAssetPath} | animation bones={AnimationBoneCount} mesh bones={MeshBoneCount} compared={ComparedBoneCount} | max translation={MaxTranslationDeltaCentimeters:F3}cm max rotation={MaxRotationDeltaDegrees:F3}deg max scale delta={MaxScaleDelta:F6}",
                comparison.AnimationAssetPath,
                comparison.ReferenceMeshAssetPath,
                comparison.AnimationBoneCount,
                comparison.MeshBoneCount,
                comparison.ComparedBoneCount,
                comparison.MaxTranslationDeltaCentimeters,
                comparison.MaxRotationDeltaDegrees,
                comparison.MaxScaleDelta);

            foreach (var boneName in comparison.MissingInMeshBones)
            {
                logger.LogInformation("Missing in mesh ref pose: {BoneName}", boneName);
            }

            foreach (var boneName in comparison.MissingInAnimationBones)
            {
                logger.LogInformation("Missing in animation ref pose: {BoneName}", boneName);
            }

            foreach (var difference in comparison.BoneDifferences.Take(limit))
            {
                logger.LogInformation(
                    "Bone diff: {BoneName} | parents animation={AnimationParentName} mesh={MeshParentName} | translation={TranslationDeltaCentimeters:F3}cm rotation={RotationDeltaDegrees:F3}deg scale=({ScaleDeltaX:F6},{ScaleDeltaY:F6},{ScaleDeltaZ:F6})",
                    difference.Name,
                    difference.AnimationParentName,
                    difference.MeshParentName,
                    difference.TranslationDeltaCentimeters,
                    difference.RotationDeltaDegrees,
                    difference.ScaleDelta.Count > 0 ? difference.ScaleDelta[0] : 0.0,
                    difference.ScaleDelta.Count > 1 ? difference.ScaleDelta[1] : 0.0,
                    difference.ScaleDelta.Count > 2 ? difference.ScaleDelta[2] : 0.0);
            }

            return 0;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Animation reference pose comparison failed for animation {AnimationAssetPath} and mesh {ReferenceMeshAssetPath}", animationAssetPath, referenceMeshAssetPath);
            return 1;
        }
    }

    public static async Task<int> RunExportMeshAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetMeshExporter>(configuration);

        var (logger, exporter, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetMeshExporter>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return 1;
        }

        var outputDirectory = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output-dir") ?? configuredOptions.RenderAssetOutputDirectory,
            "output-dir",
            "FoxWatch:RenderAssetOutputDirectory",
            "mesh export output directory");
        if (outputDirectory == null)
        {
            return 1;
        }

        var assetPath = parsedArguments.GetValueOrDefault("asset-path");
        if (string.IsNullOrWhiteSpace(assetPath))
        {
            logger.LogError("Missing mesh asset path. Use --asset-path <package path>.");
            return 1;
        }

        try
        {
            var result = await exporter.ExportMeshAsync(assetPath, outputDirectory);
            logger.LogInformation(
                "Exported {MeshType} from {AssetPath} to {SavedFilePath}",
                result.MeshType,
                result.AssetPath,
                result.SavedFilePath);
            return 0;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Mesh export failed for {AssetPath}", assetPath);
            return 1;
        }
    }

    public static async Task<int> RunExportMeshDirectoryAsync(string[] args)
    {
        var parsedArguments = FoxWatchCliArguments.Parse(args);
        var verbose = parsedArguments.ContainsKey("verbose");

        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetMeshExporter>(
            configuration,
            builder => FoxWatchCliSupport.ApplyStandardLoggingFilters(builder, verbose));

        var (logger, exporter, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetMeshExporter>(provider);

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return 1;
        }

        var outputDirectory = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output-dir") ?? configuredOptions.RenderAssetOutputDirectory,
            "output-dir",
            "FoxWatch:RenderAssetOutputDirectory",
            "mesh export output directory");
        if (outputDirectory == null)
        {
            return 1;
        }

        var pathPrefix = parsedArguments.GetValueOrDefault("path-prefix") ?? parsedArguments.GetValueOrDefault("directory");
        if (string.IsNullOrWhiteSpace(pathPrefix))
        {
            logger.LogError("Missing mesh directory prefix. Use --path-prefix <War/Content/.../>.");
            return 1;
        }

        var normalizedPrefix = pathPrefix.Replace('\\', '/').Trim();
        var packagePaths = exporter.ListPackagesByPrefixes(normalizedPrefix)
            .Where(path => path.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        var maxConcurrency = int.TryParse(parsedArguments.GetValueOrDefault("max-concurrency"), out var parsedConcurrency)
            ? Math.Max(1, parsedConcurrency)
            : Math.Min(16, Environment.ProcessorCount);

        if (packagePaths.Length == 0)
        {
            logger.LogWarning("No mesh packages found under {PathPrefix}", normalizedPrefix);
            return 0;
        }

        var stopwatch = Stopwatch.StartNew();
        var failures = new ConcurrentBag<string>();
        var successCount = 0;
        var completedCount = 0;
        var totalCount = packagePaths.Length;
        logger.LogInformation(
            "Exporting {PackageCount} mesh packages under {PathPrefix} with max concurrency {MaxConcurrency}",
            packagePaths.Length,
            normalizedPrefix,
            maxConcurrency);

        await Parallel.ForEachAsync(
            packagePaths,
            new ParallelOptions { MaxDegreeOfParallelism = maxConcurrency },
            async (packagePath, cancellationToken) =>
        {
            try
            {
                var result = await exporter.ExportMeshAsync(packagePath, outputDirectory, cancellationToken);
                Interlocked.Increment(ref successCount);
                var completed = Interlocked.Increment(ref completedCount);
                if (verbose)
                {
                    logger.LogInformation(
                        "{Completed}/{Total} exported {MeshType} from {AssetPath} to {SavedFilePath}",
                        completed,
                        totalCount,
                        result.MeshType,
                        result.AssetPath,
                        result.SavedFilePath);
                }
            }
            catch (Exception exception)
            {
                failures.Add(packagePath);
                var completed = Interlocked.Increment(ref completedCount);
                logger.LogError("{Completed}/{Total} failed {AssetPath}", completed, totalCount, packagePath);
                logger.LogError(exception, "Mesh export failed for {AssetPath}", packagePath);
            }
        });

        stopwatch.Stop();

        logger.LogInformation(
            "Mesh directory export complete: {SuccessCount} succeeded, {FailureCount} failed in {Elapsed} at {OutputDirectory}",
            successCount,
            failures.Count,
            stopwatch.Elapsed,
            outputDirectory);

        return failures.IsEmpty ? 0 : 1;
    }

    public static async Task<int> RunDumpPackageFilesAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetMeshExporter>(configuration);

        var (logger, exporter, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetMeshExporter>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return 1;
        }

        var outputDirectory = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output-dir") ?? configuredOptions.RenderAssetOutputDirectory,
            "output-dir",
            "FoxWatch:RenderAssetOutputDirectory",
            "dump output directory");
        if (outputDirectory == null)
        {
            return 1;
        }

        var assetPath = parsedArguments.GetValueOrDefault("asset-path");
        if (string.IsNullOrWhiteSpace(assetPath))
        {
            logger.LogError("Missing mesh asset path. Use --asset-path <package path>.");
            return 1;
        }

        try
        {
            var writtenFiles = await exporter.DumpPackageFilesAsync(assetPath, outputDirectory);
            foreach (var writtenFile in writtenFiles)
            {
                logger.LogInformation("Dumped package file: {DumpedPackageFile}", writtenFile);
            }

            return 0;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Package dump failed for {AssetPath}", assetPath);
            return 1;
        }
    }

    public static async Task<int> RunDumpMatchingPackagesAsync(string[] args)
    {
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider<FoxWatchAssetMeshExporter>(configuration);

        var (logger, exporter, configuredOptions) = FoxWatchCliSupport.ResolveCommand<FoxWatchAssetMeshExporter>(provider);
        var parsedArguments = FoxWatchCliArguments.Parse(args);

        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
        {
            return 1;
        }

        var outputDirectory = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output-dir") ?? FoxWatchWorkspace.DefaultPackageDumpOutputRelativePath,
            "output-dir",
            "FoxWatch:RenderAssetOutputDirectory",
            "dump output directory");
        if (outputDirectory == null)
        {
            return 1;
        }

        var queryValues = parsedArguments.GetListValues("query");
        if (queryValues.Count == 0)
        {
            logger.LogError("Missing asset search query. Use --query <substring[,substring...]>.");
            return 1;
        }

        var pathPrefix = parsedArguments.GetValueOrDefault("path-prefix");
        var limitText = parsedArguments.GetValueOrDefault("limit");
        var limit = int.TryParse(limitText, out var parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;

        var matchedPackagePaths = queryValues
            .SelectMany(query => exporter.FindPackages(query, limit, pathPrefix))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToArray();

        if (matchedPackagePaths.Length == 0)
        {
            logger.LogWarning(
                "No packages matched query={QueryValues} under prefix={PathPrefix}",
                string.Join(", ", queryValues),
                pathPrefix ?? "<any>");
            return 0;
        }

        logger.LogInformation(
            "Dumping {PackageCount} packages for query={QueryValues} under prefix={PathPrefix} to {OutputDirectory}",
            matchedPackagePaths.Length,
            string.Join(", ", queryValues),
            pathPrefix ?? "<any>",
            outputDirectory);

        foreach (var matchedPackagePath in matchedPackagePaths)
        {
            try
            {
                var writtenFiles = await exporter.DumpPackageFilesAsync(matchedPackagePath, outputDirectory);
                logger.LogInformation(
                    "Dumped {FileCount} files for {PackagePath}",
                    writtenFiles.Count,
                    matchedPackagePath);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Package dump failed for {AssetPath}", matchedPackagePath);
                return 1;
            }
        }

        return 0;
    }
}
