namespace FoxWatchService;

using System.Collections.Concurrent;
using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

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

        var manifest = generator.BuildManifest(
            baseAssetsUrl,
            pakDirectoryPath,
            targetFilter,
            strictExtraction: parsedArguments.ContainsKey("strict"),
            rawCacheKey: parsedArguments.GetValueOrDefault("raw-cache-key"));
        await generator.WriteAsync(manifest, outputPath, targetFilter);
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

    public static async Task<int> RunPrepareRefreshAsync(string[] args)
    {
        var parsedArguments = FoxWatchCliArguments.Parse(args);
        var verbose = parsedArguments.ContainsKey("verbose");
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider(
            configuration,
            builder => FoxWatchCliSupport.ApplyStandardLoggingFilters(builder, verbose));

        var logger = provider.GetRequiredService<ILoggerFactory>().CreateLogger("prepare-refresh");
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
        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: false);
        var stopwatch = Stopwatch.StartNew();
        var manifest = manifestGenerator.BuildManifest(
            baseAssetsUrl,
            pakDirectoryPath,
            targetFilter,
            strictExtraction: parsedArguments.ContainsKey("strict"),
            rawCacheKey: parsedArguments.GetValueOrDefault("raw-cache-key"));
        var extractionElapsed = stopwatch.Elapsed;
        await manifestGenerator.WriteAsync(manifest, outputPath, targetFilter);
        var manifestWriteElapsed = stopwatch.Elapsed - extractionElapsed;
        await renderSceneGenerator.GenerateAsync(
            manifest,
            outputDirectory,
            renderAssetOutputDirectory,
            baseAssetsUrl,
            pakDirectoryPath,
            targetFilter,
            includePoseVariants: parsedArguments.ContainsKey("pose-variants"),
            assetExportPlanPath: parsedArguments.GetValueOrDefault("asset-export-plan"));
        var meshExporter = provider.GetRequiredService<FoxWatchAssetMeshExporter>();
        await meshExporter.WriteInspectionSnapshotAsync();
        var sceneElapsed = stopwatch.Elapsed - extractionElapsed - manifestWriteElapsed;

        logger.LogInformation(
            "Prepared refresh from one hydrated manifest in {ElapsedMs:F0} ms (manifest {ManifestMs:F0} ms, write {ManifestWriteMs:F0} ms, scenes {SceneMs:F0} ms)",
            stopwatch.Elapsed.TotalMilliseconds,
            extractionElapsed.TotalMilliseconds,
            manifestWriteElapsed.TotalMilliseconds,
            sceneElapsed.TotalMilliseconds);
        return 0;
    }

    public static async Task<int> RunSnapshotPakAsync(string[] args)
    {
        var parsedArguments = FoxWatchCliArguments.Parse(args);
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider(configuration);
        var loggerFactory = provider.GetRequiredService<ILoggerFactory>();
        var logger = loggerFactory.CreateLogger("snapshot-pak");
        var configuredOptions = provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<FoxWatchOptions>>().Value;
        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        var outputDirectory = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output-dir"),
            "output-dir",
            "",
            "package snapshot output directory");
        var pakFingerprint = parsedArguments.GetValueOrDefault("pak-fingerprint");
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath)
            || string.IsNullOrWhiteSpace(outputDirectory)
            || string.IsNullOrWhiteSpace(pakFingerprint))
        {
            if (string.IsNullOrWhiteSpace(pakFingerprint))
            {
                logger.LogError("Package snapshot requires --pak-fingerprint <fingerprint>.");
            }
            return 1;
        }

        var builder = new FoxWatchPakSnapshotBuilder(loggerFactory.CreateLogger<FoxWatchPakSnapshotBuilder>());
        await builder.BuildAsync(pakDirectoryPath, outputDirectory, pakFingerprint);
        return 0;
    }

    public static async Task<int> RunSnapshotDecodedPackagesAsync(string[] args)
    {
        var parsedArguments = FoxWatchCliArguments.Parse(args);
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider(configuration);
        var loggerFactory = provider.GetRequiredService<ILoggerFactory>();
        var logger = loggerFactory.CreateLogger("snapshot-decoded-packages");
        var configuredOptions = provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<FoxWatchOptions>>().Value;
        var packageSourcePath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        var outputDirectory = FoxWatchCliSupport.ResolveRequiredPath(
            logger,
            parsedArguments.GetValueOrDefault("output-dir"),
            "output-dir",
            "",
            "decoded package snapshot output directory");
        var pakFingerprint = parsedArguments.GetValueOrDefault("pak-fingerprint");
        if (string.IsNullOrWhiteSpace(packageSourcePath) || !Directory.Exists(packageSourcePath)
            || string.IsNullOrWhiteSpace(outputDirectory)
            || string.IsNullOrWhiteSpace(pakFingerprint))
        {
            if (string.IsNullOrWhiteSpace(pakFingerprint))
            {
                logger.LogError("Decoded package snapshot requires --pak-fingerprint <fingerprint>.");
            }
            return 1;
        }

        var builder = new FoxWatchDecodedPackageSnapshotBuilder(
            loggerFactory.CreateLogger<FoxWatchDecodedPackageSnapshotBuilder>());
        await builder.BuildAsync(packageSourcePath, outputDirectory, pakFingerprint);
        return 0;
    }

    public static async Task<int> RunExportAssetCacheAsync(string[] args)
    {
        var parsedArguments = FoxWatchCliArguments.Parse(args);
        var verbose = parsedArguments.ContainsKey("verbose");
        var configuration = FoxWatchCliSupport.BuildConfiguration();
        using var provider = FoxWatchCliSupport.BuildProvider(
            configuration,
            builder => FoxWatchCliSupport.ApplyStandardLoggingFilters(builder, verbose));

        var loggerFactory = provider.GetRequiredService<ILoggerFactory>();
        var logger = loggerFactory.CreateLogger("asset-cache-worker");
        var configuredOptions = provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<FoxWatchOptions>>().Value;
        var pakDirectoryPath = FoxWatchCliSupport.ResolvePakDirectoryPath(logger, parsedArguments, configuredOptions, required: true);
        var planPath = FoxWatchWorkspace.ResolvePath(parsedArguments.GetValueOrDefault("plan"));
        var outputDirectory = FoxWatchWorkspace.ResolvePath(parsedArguments.GetValueOrDefault("output-dir"));
        var resultPath = FoxWatchWorkspace.ResolvePath(parsedArguments.GetValueOrDefault("result"));
        var claimDirectory = FoxWatchWorkspace.ResolvePath(parsedArguments.GetValueOrDefault("claim-dir"));
        var meshGeometryOnly = parsedArguments.ContainsKey("mesh-geometry-only");
        var materialMetadataOnly = parsedArguments.ContainsKey("material-metadata-only");
        if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath)
            || string.IsNullOrWhiteSpace(planPath) || !File.Exists(planPath)
            || string.IsNullOrWhiteSpace(outputDirectory))
        {
            logger.LogError("Asset cache worker requires readable --pak-path and --plan values plus --output-dir.");
            return 1;
        }

        if (!int.TryParse(parsedArguments.GetValueOrDefault("worker-index"), out var workerIndex)
            || !int.TryParse(parsedArguments.GetValueOrDefault("worker-count"), out var workerCount)
            || workerCount is < 1 or > 4
            || workerIndex < 0
            || workerIndex >= workerCount)
        {
            logger.LogError("Asset cache worker requires --worker-index <0..N-1> and --worker-count <1..4>.");
            return 1;
        }

        var plan = JsonSerializer.Deserialize<FoxWatchAssetExportPlan>(
            await File.ReadAllTextAsync(planPath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException($"Invalid asset cache export plan: {planPath}");
        if (plan.SchemaVersion != 1)
        {
            throw new InvalidDataException($"Unsupported asset cache export plan schema: {plan.SchemaVersion}");
        }

        var allJobs = plan.MeshPackagePaths
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(packagePath => (Kind: "mesh", PackagePath: packagePath))
            .Concat(plan.MaterialPackagePaths
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(packagePath => (Kind: "material", PackagePath: packagePath)))
            .Concat(plan.TexturePackagePaths
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(packagePath => (Kind: "texture", PackagePath: packagePath)))
            .OrderBy(job => StableAssetJobOrder(job.PackagePath), StringComparer.Ordinal)
            .ToArray();
        var jobs = string.IsNullOrWhiteSpace(claimDirectory)
            ? allJobs.Where((_, index) => index % workerCount == workerIndex).ToArray()
            : allJobs;

        Directory.CreateDirectory(outputDirectory);
        if (!string.IsNullOrWhiteSpace(claimDirectory))
        {
            Directory.CreateDirectory(claimDirectory);
        }
        var exporter = new FoxWatchAssetMeshExporter(
            loggerFactory.CreateLogger<FoxWatchAssetMeshExporter>(),
            Microsoft.Extensions.Options.Options.Create(new FoxWatchOptions { PakDirectoryPath = pakDirectoryPath }));
        var stopwatch = Stopwatch.StartNew();
        var lastProgressAt = TimeSpan.Zero;
        var referencedMaterialPackagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var referencedTexturePackagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var canonicalMeshAliases = 0;
        logger.LogInformation(
            "Asset cache worker {WorkerNumber}/{WorkerCount} starting {JobCount} job(s) ({MeshCount} mesh, {MaterialCount} material, {TextureCount} texture, geometry-only {GeometryOnly}, material-metadata-only {MaterialMetadataOnly})",
            workerIndex + 1,
            workerCount,
            string.IsNullOrWhiteSpace(claimDirectory) ? jobs.Length : allJobs.Length,
            allJobs.Count(job => job.Kind == "mesh"),
            allJobs.Count(job => job.Kind == "material"),
            allJobs.Count(job => job.Kind == "texture"),
            meshGeometryOnly,
            materialMetadataOnly);

        var completedJobs = 0;
        while (true)
        {
            (string Kind, string PackagePath) job;
            if (!string.IsNullOrWhiteSpace(claimDirectory))
            {
                if (!TryClaimNextAssetJob(allJobs, claimDirectory, workerIndex, completedJobs, out job))
                {
                    break;
                }
            }
            else
            {
                if (completedJobs >= jobs.Length)
                {
                    break;
                }
                job = jobs[completedJobs];
            }

            var jobStopwatch = Stopwatch.StartNew();
            if (job.Kind == "mesh")
            {
                var result = await exporter.ExportMeshAsync(
                    job.PackagePath,
                    outputDirectory,
                    exportReferencedMaterials: !meshGeometryOnly);
                foreach (var packagePath in result.ReferencedMaterialPackagePaths)
                {
                    referencedMaterialPackagePaths.Add(packagePath);
                }
                if (meshGeometryOnly && EnsureCanonicalMeshOutput(job.PackagePath, outputDirectory, result.SavedFilePath))
                {
                    canonicalMeshAliases += 1;
                }
            }
            else if (job.Kind == "material")
            {
                var result = await exporter.ExportMaterialAsync(
                    job.PackagePath,
                    outputDirectory,
                    exportReferencedTextures: !materialMetadataOnly);
                foreach (var packagePath in result.ReferencedTexturePackagePaths)
                {
                    referencedTexturePackagePaths.Add(packagePath);
                }
            }
            else
            {
                await exporter.ExportTextureAsync(job.PackagePath, outputDirectory);
            }

            if (jobStopwatch.Elapsed >= TimeSpan.FromSeconds(5))
            {
                logger.LogInformation(
                    "Asset cache worker {WorkerNumber}: slow {JobKind} job {PackagePath} took {ElapsedSeconds:F1}s",
                    workerIndex + 1,
                    job.Kind,
                    job.PackagePath,
                    jobStopwatch.Elapsed.TotalSeconds);
            }

            completedJobs += 1;
            if ((!string.IsNullOrWhiteSpace(claimDirectory) && completedJobs == 1)
                || (string.IsNullOrWhiteSpace(claimDirectory) && completedJobs == jobs.Length)
                || completedJobs == 1
                || stopwatch.Elapsed - lastProgressAt >= TimeSpan.FromSeconds(10))
            {
                lastProgressAt = stopwatch.Elapsed;
                logger.LogInformation(
                    "Asset cache worker {WorkerNumber}: {Completed}/{Total} job(s) in {ElapsedSeconds:F1}s ({JobsPerSecond:F2}/s)",
                    workerIndex + 1,
                    completedJobs,
                    string.IsNullOrWhiteSpace(claimDirectory) ? jobs.Length : allJobs.Length,
                    stopwatch.Elapsed.TotalSeconds,
                    completedJobs / Math.Max(stopwatch.Elapsed.TotalSeconds, 0.001));
            }
        }

        logger.LogInformation(
            "Asset cache worker {WorkerNumber}/{WorkerCount} completed {JobCount} job(s) in {ElapsedSeconds:F1}s ({CanonicalMeshAliasCount} canonical mesh alias(es))",
            workerIndex + 1,
            workerCount,
            completedJobs,
            stopwatch.Elapsed.TotalSeconds,
            canonicalMeshAliases);
        if (!string.IsNullOrWhiteSpace(resultPath))
        {
            var resultDirectory = Path.GetDirectoryName(resultPath);
            if (!string.IsNullOrWhiteSpace(resultDirectory))
            {
                Directory.CreateDirectory(resultDirectory);
            }
            var workerResult = new FoxWatchAssetExportWorkerResult
            {
                WorkerIndex = workerIndex,
                CompletedJobs = completedJobs,
                ReferencedMaterialPackagePaths = referencedMaterialPackagePaths
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList(),
                ReferencedTexturePackagePaths = referencedTexturePackagePaths
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList(),
            };
            await File.WriteAllTextAsync(
                resultPath,
                $"{JsonSerializer.Serialize(workerResult, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = true,
                })}{Environment.NewLine}");
            logger.LogInformation(
                "Asset cache worker {WorkerNumber} recorded {MaterialCount} referenced material and {TextureCount} referenced texture package(s) at {ResultPath}",
                workerIndex + 1,
                workerResult.ReferencedMaterialPackagePaths.Count,
                workerResult.ReferencedTexturePackagePaths.Count,
                resultPath);
        }
        return 0;
    }

    private static string StableAssetJobOrder(string packagePath)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(packagePath)));
    }

    private static bool TryClaimNextAssetJob(
        (string Kind, string PackagePath)[] jobs,
        string claimDirectory,
        int workerIndex,
        int completedJobs,
        out (string Kind, string PackagePath) claimedJob)
    {
        for (var offset = 0; offset < jobs.Length; offset++)
        {
            var jobIndex = (workerIndex + completedJobs + offset) % jobs.Length;
            var candidate = jobs[jobIndex];
            var claimKey = Convert.ToHexString(SHA256.HashData(
                Encoding.UTF8.GetBytes($"{candidate.Kind}\n{candidate.PackagePath}"))).ToLowerInvariant();
            var claimPath = Path.Combine(claimDirectory, $"{claimKey}.claim");
            try
            {
                using var stream = new FileStream(claimPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
                using var writer = new StreamWriter(stream, Encoding.UTF8);
                writer.Write($"worker={workerIndex + 1}\nkind={candidate.Kind}\npackage={candidate.PackagePath}\n");
                claimedJob = candidate;
                return true;
            }
            catch (IOException) when (File.Exists(claimPath))
            {
                // Another long-lived worker owns this job. Continue scanning so
                // whichever worker finishes first steals the next unclaimed job.
            }
        }

        claimedJob = default;
        return false;
    }

    private static bool EnsureCanonicalMeshOutput(string packagePath, string outputDirectory, string? savedFilePath)
    {
        if (string.IsNullOrWhiteSpace(savedFilePath) || !File.Exists(savedFilePath))
        {
            throw new InvalidDataException($"Mesh export for '{packagePath}' did not produce a readable output file.");
        }

        var extension = Path.GetExtension(savedFilePath);
        if (!string.Equals(extension, ".glb", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException(
                $"Deferred mesh export for '{packagePath}' produced '{extension}' instead of the GLB path required by render scenes.");
        }

        var normalizedPackagePath = packagePath.Replace('\\', '/').TrimStart('/');
        if (normalizedPackagePath.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
        {
            normalizedPackagePath = normalizedPackagePath[..^".uasset".Length];
        }
        var canonicalPath = Path.Combine(
            outputDirectory,
            normalizedPackagePath.Replace('/', Path.DirectorySeparatorChar)) + extension;
        if (string.Equals(
                Path.GetFullPath(canonicalPath),
                Path.GetFullPath(savedFilePath),
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var canonicalDirectory = Path.GetDirectoryName(canonicalPath);
        if (!string.IsNullOrWhiteSpace(canonicalDirectory))
        {
            Directory.CreateDirectory(canonicalDirectory);
        }
        File.Copy(savedFilePath, canonicalPath, overwrite: true);
        return true;
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
