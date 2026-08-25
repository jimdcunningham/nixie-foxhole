namespace FoxWatchService;

using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

/// <summary>
/// Provides a PAK-versioned, semantically neutral view of decoded Unreal package exports.
/// The cache contains CUE4Parse's generic export JSON, not a FoxWatch manifest or a projection
/// of fields currently used by FoxWatch. Manifest code can therefore change without rebuilding it.
/// </summary>
public sealed class FoxWatchDecodedPackageSource
{
    public const string EnvironmentVariableName = "FOXWATCH_DECODED_PACKAGE_SNAPSHOT";
    public const string PakFingerprintEnvironmentVariableName = "FOXWATCH_DECODED_PACKAGE_PAK_FINGERPRINT";
    public const string MetadataFileName = "foxwatch-decoded-packages.v3.json";
    public const string PackagesDirectoryName = "packages";

    private readonly string? _packagesDirectory;

    public FoxWatchDecodedPackageSource(string packageSourceDirectory)
    {
        var configuredDirectory = Environment.GetEnvironmentVariable(EnvironmentVariableName);
        if (string.IsNullOrWhiteSpace(configuredDirectory))
        {
            return;
        }

        var snapshotDirectory = FoxWatchWorkspace.ResolvePath(configuredDirectory)
            ?? throw new DirectoryNotFoundException("FoxWatch decoded package snapshot path is unavailable.");
        var metadataPath = Path.Combine(snapshotDirectory, MetadataFileName);
        if (!File.Exists(metadataPath))
        {
            throw new FileNotFoundException("FoxWatch decoded package snapshot metadata is unavailable.", metadataPath);
        }

        var metadata = ReadMetadata(metadataPath);
        if (metadata is not { SchemaVersion: 3, Complete: true })
        {
            throw new InvalidDataException($"FoxWatch decoded package snapshot is incomplete or unsupported: {metadataPath}");
        }

        _packagesDirectory = Path.Combine(snapshotDirectory, PackagesDirectoryName);
        if (!Directory.Exists(_packagesDirectory))
        {
            throw new DirectoryNotFoundException($"FoxWatch decoded package files are unavailable: {_packagesDirectory}");
        }

        var resolvedPackageSourceDirectory = FoxWatchWorkspace.ResolvePath(packageSourceDirectory)
            ?? throw new DirectoryNotFoundException("FoxWatch decoded package source path is unavailable.");
        var packageMetadataPath = Path.Combine(
            resolvedPackageSourceDirectory,
            FoxWatchPackageSource.SnapshotMetadataFileName);
        if (File.Exists(packageMetadataPath))
        {
            var packageMetadata = FoxWatchPackageSource.ReadSnapshotMetadata(packageMetadataPath);
            if (packageMetadata is not { SchemaVersion: 1, Complete: true }
                || !string.Equals(packageMetadata.PakFingerprint, metadata.PakFingerprint, StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"FoxWatch decoded package PAK identity does not match its raw package source: {snapshotDirectory}");
            }

            return;
        }

        var expectedPakFingerprint = Environment.GetEnvironmentVariable(PakFingerprintEnvironmentVariableName);
        if (string.IsNullOrWhiteSpace(expectedPakFingerprint)
            || !string.Equals(expectedPakFingerprint, metadata.PakFingerprint, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                "FoxWatch decoded packages require either a matching immutable raw package snapshot or "
                + $"the current PAK fingerprint in {PakFingerprintEnvironmentVariableName}.");
        }
    }

    public bool Enabled => _packagesDirectory != null;

    public IReadOnlyCollection<dynamic> LoadExports(DefaultFileProvider provider, string packagePath)
    {
        if (_packagesDirectory == null)
        {
            return provider.LoadPackage(packagePath).GetExports().Cast<dynamic>().ToArray();
        }

        var decodedPath = ResolveDecodedPackagePath(_packagesDirectory, packagePath);
        if (!File.Exists(decodedPath))
        {
            throw new FileNotFoundException($"Decoded FoxWatch package is missing for {packagePath}.", decodedPath);
        }

        var exports = JArray.Parse(File.ReadAllText(decodedPath));
        return exports.Children().Cast<dynamic>().ToArray();
    }

    public static string ResolveDecodedPackagePath(string packagesDirectory, string packagePath)
    {
        var normalized = NormalizePackagePath(packagePath);
        var relativeJsonPath = $"{Path.ChangeExtension(normalized, null)}.json";
        var fullPackagesDirectory = Path.GetFullPath(packagesDirectory);
        var fullPath = Path.GetFullPath(Path.Combine(fullPackagesDirectory, relativeJsonPath.Replace('/', Path.DirectorySeparatorChar)));
        if (!fullPath.StartsWith($"{fullPackagesDirectory}{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"Decoded package path escaped its snapshot root: {packagePath}");
        }
        return fullPath;
    }

    public static FoxWatchDecodedPackageMetadata ReadMetadata(string metadataPath)
    {
        return System.Text.Json.JsonSerializer.Deserialize<FoxWatchDecodedPackageMetadata>(
            File.ReadAllText(metadataPath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException($"Invalid FoxWatch decoded package metadata: {metadataPath}");
    }

    internal static string NormalizePackagePath(string value)
    {
        var normalized = value.Replace('\\', '/').TrimStart('/');
        if (string.IsNullOrWhiteSpace(normalized)
            || Path.IsPathRooted(normalized)
            || normalized.Split('/').Any(segment => segment is "" or "." or ".."))
        {
            throw new InvalidDataException($"Invalid Unreal package path: {value}");
        }
        return normalized.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase)
            ? normalized
            : $"{normalized}.uasset";
    }
}

public sealed class FoxWatchDecodedPackageSnapshotBuilder(ILogger<FoxWatchDecodedPackageSnapshotBuilder> logger)
{
    private const EGame EngineVersion = EGame.GAME_UE4_24;
    private static readonly TimeSpan ProgressInterval = TimeSpan.FromSeconds(5);

    public async Task<FoxWatchDecodedPackageBuildResult> BuildAsync(
        string packageSourceDirectory,
        string outputDirectory,
        string pakFingerprint,
        CancellationToken cancellationToken = default)
    {
        var resolvedSourceDirectory = FoxWatchWorkspace.ResolvePath(packageSourceDirectory)
            ?? throw new DirectoryNotFoundException("FoxWatch package source path is unavailable.");
        var resolvedOutputDirectory = FoxWatchWorkspace.ResolvePath(outputDirectory)
            ?? throw new ArgumentException("FoxWatch decoded snapshot output directory is required.", nameof(outputDirectory));
        if (!Directory.Exists(resolvedSourceDirectory))
        {
            throw new DirectoryNotFoundException($"FoxWatch package source is unavailable: {resolvedSourceDirectory}");
        }
        if (string.IsNullOrWhiteSpace(pakFingerprint))
        {
            throw new ArgumentException("FoxWatch decoded snapshot requires a PAK fingerprint.", nameof(pakFingerprint));
        }

        var metadataPath = Path.Combine(resolvedOutputDirectory, FoxWatchDecodedPackageSource.MetadataFileName);
        if (File.Exists(metadataPath))
        {
            var metadata = FoxWatchDecodedPackageSource.ReadMetadata(metadataPath);
            if (metadata is { SchemaVersion: 3, Complete: true }
                && string.Equals(metadata.PakFingerprint, pakFingerprint, StringComparison.Ordinal))
            {
                logger.LogInformation(
                    "Reusing decoded package snapshot with {PackageCount} package(s), {TotalGiB:F2} GiB at {OutputDirectory}",
                    metadata.PackageCount,
                    metadata.TotalBytes / 1024d / 1024d / 1024d,
                    resolvedOutputDirectory);
                return new FoxWatchDecodedPackageBuildResult(resolvedOutputDirectory, metadata, true, TimeSpan.Zero);
            }

            throw new InvalidDataException($"Decoded snapshot contains a different PAK identity: {resolvedOutputDirectory}");
        }

        Directory.CreateDirectory(resolvedOutputDirectory);
        var packagesDirectory = Path.Combine(resolvedOutputDirectory, FoxWatchDecodedPackageSource.PackagesDirectoryName);
        Directory.CreateDirectory(packagesDirectory);

        var provider = FoxWatchPackageSource.CreateProvider(
            resolvedSourceDirectory,
            EngineVersion,
            StringComparer.OrdinalIgnoreCase);
        provider.Initialize();
        provider.Mount();

        var packagePaths = provider.Files
            .Where(entry => string.Equals(entry.Value.Extension, "uasset", StringComparison.OrdinalIgnoreCase))
            .Select(entry => FoxWatchDecodedPackageSource.NormalizePackagePath(entry.Key))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToArray();

        logger.LogInformation("Building generic decoded package snapshot for {PackageCount} package(s)", packagePaths.Length);
        var stopwatch = Stopwatch.StartNew();
        var lastProgressAt = TimeSpan.Zero;
        var packageCount = 0;
        var reusedPackageCount = 0;
        var failedPackages = new List<string>();
        var totalBytes = 0L;

        foreach (var packagePath in packagePaths)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var destinationPath = FoxWatchDecodedPackageSource.ResolveDecodedPackagePath(packagesDirectory, packagePath);
            if (File.Exists(destinationPath))
            {
                packageCount += 1;
                reusedPackageCount += 1;
                totalBytes += new FileInfo(destinationPath).Length;
                continue;
            }

            try
            {
                var package = provider.LoadPackage(packagePath);
                var sourceExports = package.GetExports().ToArray();
                var exports = JArray.Parse(JsonConvert.SerializeObject(sourceExports, Formatting.None));
                for (var exportIndex = 0; exportIndex < exports.Count; exportIndex += 1)
                {
                    if (exports[exportIndex] is not JObject export)
                    {
                        continue;
                    }
                    export["$PackagePath"] = packagePath;
                    export["$ClassText"] = sourceExports[exportIndex].Class?.ToString();
                    export["$RuntimeProperties"] = CaptureRuntimeScalarProperties(sourceExports[exportIndex]);
                }
                var json = exports.ToString(Formatting.None);
                Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
                var temporaryPath = $"{destinationPath}.tmp-{Environment.ProcessId}-{Guid.NewGuid():N}";
                await File.WriteAllTextAsync(temporaryPath, json, new UTF8Encoding(false), cancellationToken);
                File.Move(temporaryPath, destinationPath);
                packageCount += 1;
                totalBytes += new FileInfo(destinationPath).Length;
            }
            catch (Exception exception)
            {
                failedPackages.Add(packagePath);
                logger.LogWarning("Unable to decode package {PackagePath}: {Message}", packagePath, exception.Message);
            }

            if (stopwatch.Elapsed - lastProgressAt >= ProgressInterval)
            {
                lastProgressAt = stopwatch.Elapsed;
                logger.LogInformation(
                    "Decoded package progress: {Completed}/{Total} packages, {Failed} failed, {TotalGiB:F2} GiB in {Elapsed}",
                    packageCount + failedPackages.Count,
                    packagePaths.Length,
                    failedPackages.Count,
                    totalBytes / 1024d / 1024d / 1024d,
                    stopwatch.Elapsed);
            }
        }

        var completedMetadata = new FoxWatchDecodedPackageMetadata
        {
            Complete = true,
            PakFingerprint = pakFingerprint,
            SourceDirectory = resolvedSourceDirectory,
            CreatedAt = DateTimeOffset.UtcNow,
            PackageCount = packageCount,
            TotalBytes = totalBytes,
            UnsupportedPackagePaths = failedPackages,
        };
        await File.WriteAllTextAsync(
            metadataPath,
            $"{System.Text.Json.JsonSerializer.Serialize(completedMetadata, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                WriteIndented = true,
            })}{Environment.NewLine}",
            cancellationToken);
        stopwatch.Stop();
        logger.LogInformation(
            "Completed decoded package snapshot: {PackageCount} package(s), {UnsupportedCount} unsupported, {TotalGiB:F2} GiB in {Elapsed} ({ReusedPackageCount} resumed)",
            packageCount,
            failedPackages.Count,
            totalBytes / 1024d / 1024d / 1024d,
            stopwatch.Elapsed,
            reusedPackageCount);
        return new FoxWatchDecodedPackageBuildResult(resolvedOutputDirectory, completedMetadata, false, stopwatch.Elapsed);
    }

    private static JObject CaptureRuntimeScalarProperties(object source)
    {
        var values = new JObject();
        var runtimeType = source.GetType();
        foreach (var property in runtimeType.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (!property.CanRead || property.GetIndexParameters().Length > 0 || !IsScalarType(property.PropertyType))
            {
                continue;
            }

            try
            {
                values[property.Name] = JToken.FromObject(property.GetValue(source)!);
            }
            catch
            {
            }
        }

        foreach (var field in runtimeType.GetFields(BindingFlags.Public | BindingFlags.Instance))
        {
            if (!IsScalarType(field.FieldType) || values.ContainsKey(field.Name))
            {
                continue;
            }

            try
            {
                values[field.Name] = JToken.FromObject(field.GetValue(source)!);
            }
            catch
            {
            }
        }

        return values;
    }

    private static bool IsScalarType(Type type)
    {
        var resolvedType = Nullable.GetUnderlyingType(type) ?? type;
        return resolvedType.IsPrimitive
            || resolvedType.IsEnum
            || resolvedType == typeof(decimal)
            || resolvedType == typeof(string);
    }
}

public sealed class FoxWatchDecodedPackageMetadata
{
    public int SchemaVersion { get; set; } = 3;
    public bool Complete { get; set; }
    public string PakFingerprint { get; set; } = string.Empty;
    public string SourceDirectory { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public int PackageCount { get; set; }
    public long TotalBytes { get; set; }
    public List<string> UnsupportedPackagePaths { get; set; } = [];
}

public sealed record FoxWatchDecodedPackageBuildResult(
    string OutputDirectory,
    FoxWatchDecodedPackageMetadata Metadata,
    bool Reused,
    TimeSpan Elapsed);
