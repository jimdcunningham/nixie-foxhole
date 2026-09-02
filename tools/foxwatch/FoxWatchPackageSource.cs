namespace FoxWatchService;

using System.Text.Json;
using CUE4Parse.FileProvider;
using CUE4Parse.FileProvider.Objects;
using CUE4Parse.UE4.Versions;

public static class FoxWatchPackageSource
{
    public const string SnapshotMetadataFileName = "foxwatch-pak-snapshot.v1.json";
    public const string SnapshotFilesDirectoryName = "files";

    public static DefaultFileProvider CreateProvider(
        string sourceDirectory,
        EGame engineVersion,
        StringComparer? pathComparer = null)
    {
        var resolvedSourceDirectory = FoxWatchWorkspace.ResolvePath(sourceDirectory)
            ?? throw new DirectoryNotFoundException("FoxWatch package source path is unavailable.");
        var versions = new VersionContainer(engineVersion);
        var metadataPath = Path.Combine(resolvedSourceDirectory, SnapshotMetadataFileName);
        if (File.Exists(metadataPath))
        {
            var metadata = ReadSnapshotMetadata(metadataPath);
            if (metadata is not { SchemaVersion: 1, Complete: true })
            {
                throw new InvalidDataException($"FoxWatch package snapshot is incomplete or unsupported: {metadataPath}");
            }

            return new FoxWatchLooseSnapshotFileProvider(
                resolvedSourceDirectory,
                versions,
                pathComparer ?? StringComparer.OrdinalIgnoreCase);
        }

        return new DefaultFileProvider(
            resolvedSourceDirectory,
            SearchOption.TopDirectoryOnly,
            versions,
            pathComparer ?? StringComparer.OrdinalIgnoreCase);
    }

    public static FoxWatchPakSnapshotMetadata ReadSnapshotMetadata(string metadataPath)
    {
        return JsonSerializer.Deserialize<FoxWatchPakSnapshotMetadata>(
            File.ReadAllText(metadataPath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException($"Invalid FoxWatch package snapshot metadata: {metadataPath}");
    }

    private sealed class FoxWatchLooseSnapshotFileProvider : DefaultFileProvider
    {
        private readonly string _snapshotFilesDirectory;

        public FoxWatchLooseSnapshotFileProvider(
            string snapshotDirectory,
            VersionContainer versions,
            StringComparer pathComparer)
            : base(snapshotDirectory, SearchOption.TopDirectoryOnly, versions, pathComparer)
        {
            _snapshotFilesDirectory = Path.Combine(snapshotDirectory, SnapshotFilesDirectoryName);
        }

        public override void Initialize()
        {
            if (!Directory.Exists(_snapshotFilesDirectory))
            {
                throw new DirectoryNotFoundException($"FoxWatch package snapshot files are unavailable: {_snapshotFilesDirectory}");
            }

            var files = new Dictionary<string, GameFile>(PathComparer);
            foreach (var filePath in Directory.EnumerateFiles(_snapshotFilesDirectory, "*", SearchOption.AllDirectories))
            {
                var fileInfo = new FileInfo(filePath);
                var virtualPath = Path.GetRelativePath(_snapshotFilesDirectory, filePath).Replace('\\', '/');
                if (!GameFile.UeKnownExtensionsSet.Contains(fileInfo.Extension.TrimStart('.')))
                {
                    continue;
                }

                files[virtualPath] = new FoxWatchSnapshotGameFile(virtualPath, fileInfo, Versions);
            }

            Files.AddFiles(files);
        }
    }

    private sealed class FoxWatchSnapshotGameFile : OsGameFile
    {
        public FoxWatchSnapshotGameFile(string virtualPath, FileInfo file, VersionContainer versions)
            : base(file, versions)
        {
            Path = virtualPath;
        }
    }
}

public sealed class FoxWatchPakSnapshotMetadata
{
    public int SchemaVersion { get; set; } = 1;

    public bool Complete { get; set; }

    public string PakFingerprint { get; set; } = string.Empty;

    public string SourceDirectory { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    public int FileCount { get; set; }

    public long TotalBytes { get; set; }

    public Dictionary<string, int> ExtensionCounts { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}
