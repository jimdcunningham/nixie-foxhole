namespace FoxWatchService;

using System.Diagnostics;
using System.Text.Json;
using CUE4Parse.FileProvider;
using CUE4Parse.FileProvider.Objects;
using CUE4Parse.UE4.Versions;
using Microsoft.Extensions.Logging;

public sealed class FoxWatchPakSnapshotBuilder(ILogger<FoxWatchPakSnapshotBuilder> logger)
{
    private const EGame EngineVersion = EGame.GAME_UE4_24;
    private static readonly TimeSpan ProgressInterval = TimeSpan.FromSeconds(5);

    public async Task<FoxWatchPakSnapshotBuildResult> BuildAsync(
        string pakDirectory,
        string outputDirectory,
        string pakFingerprint,
        CancellationToken cancellationToken = default)
    {
        var resolvedPakDirectory = FoxWatchWorkspace.ResolvePath(pakDirectory)
            ?? throw new DirectoryNotFoundException("FoxWatch PAK directory is unavailable.");
        var resolvedOutputDirectory = FoxWatchWorkspace.ResolvePath(outputDirectory)
            ?? throw new ArgumentException("FoxWatch package snapshot output directory is required.", nameof(outputDirectory));
        if (!Directory.Exists(resolvedPakDirectory))
        {
            throw new DirectoryNotFoundException($"FoxWatch PAK directory is unavailable: {resolvedPakDirectory}");
        }
        if (string.IsNullOrWhiteSpace(pakFingerprint))
        {
            throw new ArgumentException("FoxWatch package snapshot requires a PAK fingerprint.", nameof(pakFingerprint));
        }

        var metadataPath = Path.Combine(resolvedOutputDirectory, FoxWatchPackageSource.SnapshotMetadataFileName);
        if (File.Exists(metadataPath))
        {
            var metadata = FoxWatchPackageSource.ReadSnapshotMetadata(metadataPath);
            if (metadata is { SchemaVersion: 1, Complete: true }
                && string.Equals(metadata.PakFingerprint, pakFingerprint, StringComparison.Ordinal))
            {
                logger.LogInformation(
                    "Reusing complete FoxWatch package snapshot with {FileCount} file(s), {TotalGiB:F2} GiB at {OutputDirectory}",
                    metadata.FileCount,
                    metadata.TotalBytes / 1024d / 1024d / 1024d,
                    resolvedOutputDirectory);
                return new FoxWatchPakSnapshotBuildResult(resolvedOutputDirectory, metadata, Reused: true, TimeSpan.Zero);
            }

            throw new InvalidDataException(
                $"Snapshot directory already contains a different PAK identity: {resolvedOutputDirectory}");
        }
        if (Directory.Exists(resolvedOutputDirectory))
        {
            throw new InvalidDataException(
                $"Snapshot output already exists without complete metadata: {resolvedOutputDirectory}");
        }

        var provider = new DefaultFileProvider(
            resolvedPakDirectory,
            SearchOption.TopDirectoryOnly,
            new VersionContainer(EngineVersion),
            StringComparer.OrdinalIgnoreCase);
        var mountStopwatch = Stopwatch.StartNew();
        provider.Initialize();
        provider.Mount();
        mountStopwatch.Stop();

        var sourceFiles = provider.Files
            .Where(entry => GameFile.UeKnownExtensionsSet.Contains(entry.Value.Extension))
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .ToArray();
        var expectedBytes = sourceFiles.Sum(entry => entry.Value.Size);
        EnsureFreeDiskSpace(resolvedOutputDirectory, expectedBytes);

        var parentDirectory = Path.GetDirectoryName(resolvedOutputDirectory)
            ?? throw new InvalidOperationException($"Snapshot output has no parent directory: {resolvedOutputDirectory}");
        Directory.CreateDirectory(parentDirectory);
        var stagingDirectory = $"{resolvedOutputDirectory}.building-{Environment.ProcessId}-{Guid.NewGuid():N}";
        var filesDirectory = Path.Combine(stagingDirectory, FoxWatchPackageSource.SnapshotFilesDirectoryName);
        Directory.CreateDirectory(filesDirectory);

        logger.LogInformation(
            "Building FoxWatch package snapshot from {SourceFileCount} recognized file(s), approximately {ExpectedGiB:F2} GiB (PAK mount {MountMs:F0} ms)",
            sourceFiles.Length,
            expectedBytes / 1024d / 1024d / 1024d,
            mountStopwatch.Elapsed.TotalMilliseconds);

        var stopwatch = Stopwatch.StartNew();
        var lastProgressAt = TimeSpan.Zero;
        var writtenBytes = 0L;
        var writtenFiles = 0;
        var extensionCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var (virtualPath, sourceFile) in sourceFiles)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var safeRelativePath = NormalizeSafeVirtualPath(virtualPath);
                var destinationPath = Path.GetFullPath(Path.Combine(filesDirectory, safeRelativePath.Replace('/', Path.DirectorySeparatorChar)));
                if (!destinationPath.StartsWith($"{Path.GetFullPath(filesDirectory)}{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException($"PAK entry escaped the snapshot root: {virtualPath}");
                }

                Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
                var bytes = sourceFile.Read();
                await File.WriteAllBytesAsync(destinationPath, bytes, cancellationToken);
                writtenBytes += bytes.LongLength;
                writtenFiles += 1;
                extensionCounts[sourceFile.Extension] = extensionCounts.GetValueOrDefault(sourceFile.Extension) + 1;

                if (stopwatch.Elapsed - lastProgressAt >= ProgressInterval)
                {
                    lastProgressAt = stopwatch.Elapsed;
                    logger.LogInformation(
                        "Package snapshot progress: {WrittenFiles}/{TotalFiles} files, {WrittenGiB:F2}/{ExpectedGiB:F2} GiB in {Elapsed}",
                        writtenFiles,
                        sourceFiles.Length,
                        writtenBytes / 1024d / 1024d / 1024d,
                        expectedBytes / 1024d / 1024d / 1024d,
                        stopwatch.Elapsed);
                }
            }

            var metadata = new FoxWatchPakSnapshotMetadata
            {
                Complete = true,
                PakFingerprint = pakFingerprint,
                SourceDirectory = resolvedPakDirectory,
                CreatedAt = DateTimeOffset.UtcNow,
                FileCount = writtenFiles,
                TotalBytes = writtenBytes,
                ExtensionCounts = extensionCounts,
            };
            var stagingMetadataPath = Path.Combine(stagingDirectory, FoxWatchPackageSource.SnapshotMetadataFileName);
            await File.WriteAllTextAsync(
                stagingMetadataPath,
                $"{JsonSerializer.Serialize(metadata, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = true,
                })}{Environment.NewLine}",
                cancellationToken);
            Directory.Move(stagingDirectory, resolvedOutputDirectory);
            stopwatch.Stop();
            logger.LogInformation(
                "Completed FoxWatch package snapshot: {WrittenFiles} file(s), {WrittenGiB:F2} GiB in {Elapsed}",
                writtenFiles,
                writtenBytes / 1024d / 1024d / 1024d,
                stopwatch.Elapsed);
            return new FoxWatchPakSnapshotBuildResult(resolvedOutputDirectory, metadata, Reused: false, stopwatch.Elapsed);
        }
        catch
        {
            if (Directory.Exists(stagingDirectory))
            {
                Directory.Delete(stagingDirectory, recursive: true);
            }
            throw;
        }
    }

    private static string NormalizeSafeVirtualPath(string value)
    {
        var normalized = value.Replace('\\', '/').TrimStart('/');
        if (string.IsNullOrWhiteSpace(normalized)
            || Path.IsPathRooted(normalized)
            || normalized.Split('/').Any(segment => segment is "" or "." or ".."))
        {
            throw new InvalidDataException($"Invalid PAK entry path: {value}");
        }
        return normalized;
    }

    private static void EnsureFreeDiskSpace(string outputDirectory, long expectedBytes)
    {
        var root = Path.GetPathRoot(Path.GetFullPath(outputDirectory))
            ?? throw new InvalidOperationException($"Unable to determine drive for {outputDirectory}");
        var drive = new DriveInfo(root);
        const long reserveBytes = 10L * 1024 * 1024 * 1024;
        if (drive.AvailableFreeSpace < expectedBytes + reserveBytes)
        {
            throw new IOException(
                $"Package snapshot needs approximately {expectedBytes / 1024d / 1024d / 1024d:F2} GiB plus a 10 GiB reserve, "
                + $"but only {drive.AvailableFreeSpace / 1024d / 1024d / 1024d:F2} GiB is available on {root}.");
        }
    }
}

public sealed record FoxWatchPakSnapshotBuildResult(
    string OutputDirectory,
    FoxWatchPakSnapshotMetadata Metadata,
    bool Reused,
    TimeSpan Elapsed);
