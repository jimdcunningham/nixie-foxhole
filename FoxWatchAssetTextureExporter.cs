namespace FoxWatchService;

using CUE4Parse.FileProvider;
using CUE4Parse.FileProvider.Objects;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;
using Microsoft.Extensions.Options;

public sealed class FoxWatchAssetTextureExporter
{
    private const EGame EngineVersion = EGame.GAME_UE4_24;

    private readonly ILogger<FoxWatchAssetTextureExporter> _logger;
    private readonly string? _pakDirectoryPath;
    private DefaultFileProvider? _fileProvider;
    private bool _mounted;

    public FoxWatchAssetTextureExporter(ILogger<FoxWatchAssetTextureExporter> logger, IOptions<FoxWatchOptions> options)
    {
        _logger = logger;
        _pakDirectoryPath = FoxWatchWorkspace.ResolvePakDirectoryPath(options.Value.PakDirectoryPath);
    }

    public Task<IReadOnlyList<string>> ExportTexturesByPathPrefixesAsync(
        IEnumerable<string> pathPrefixes,
        string outputDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMounted();

        var normalizedPrefixes = pathPrefixes
            .Select(NormalizePrefix)
            .Where(prefix => !string.IsNullOrWhiteSpace(prefix))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (normalizedPrefixes.Length == 0)
        {
            throw new ArgumentException("At least one non-empty texture path prefix is required.", nameof(pathPrefixes));
        }

        Directory.CreateDirectory(outputDirectory);

        var exportedPaths = new List<string>();
        var packagePaths = _fileProvider!.Files
            .Where(entry => entry.Value.IsUePackage)
            .Select(entry => entry.Key)
            .Where(packagePath => normalizedPrefixes.Any(prefix => packagePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(packagePath => packagePath, StringComparer.Ordinal)
            .ToArray();

        foreach (var packagePath in packagePaths)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                var exportedPath = ExportTexturePackage(packagePath, outputDirectory);
                if (!string.IsNullOrWhiteSpace(exportedPath))
                {
                    exportedPaths.Add(exportedPath);
                }
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Skipping texture export for {PackagePath}", packagePath);
            }
        }

        _logger.LogInformation(
            "Exported {ExportedTextureCount} texture packages across {PrefixCount} path prefixes to {OutputDirectory}",
            exportedPaths.Count,
            normalizedPrefixes.Length,
            outputDirectory);

        return Task.FromResult<IReadOnlyList<string>>(exportedPaths);
    }

    private string? ExportTexturePackage(string packagePath, string outputDirectory)
    {
        var package = _fileProvider!.LoadPackage(packagePath);
        var textureExports = package.GetExports().OfType<UTexture2D>().ToArray();
        if (textureExports.Length == 0)
        {
            return null;
        }

        var preferredExportName = Path.GetFileNameWithoutExtension(packagePath);
        var textureExport = textureExports.FirstOrDefault(export => string.Equals(export.Name, preferredExportName, StringComparison.OrdinalIgnoreCase))
            ?? textureExports.First();

        var decodedTexture = textureExport.Decode();
        if (decodedTexture == null)
        {
            return null;
        }

        var relativeOutputPath = packagePath
            .Replace('/', Path.DirectorySeparatorChar)
            .Replace(".uasset", ".png", StringComparison.OrdinalIgnoreCase);
        var outputPath = Path.Combine(outputDirectory, relativeOutputPath);
        var outputPathDirectory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(outputPathDirectory))
        {
            Directory.CreateDirectory(outputPathDirectory);
        }

        var imageBytes = decodedTexture.Encode(ETextureFormat.Png, saveHdrAsHdr: false, out _);
        File.WriteAllBytes(outputPath, imageBytes);
        return outputPath;
    }

    private void EnsureMounted()
    {
        if (_mounted)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(_pakDirectoryPath) || !Directory.Exists(_pakDirectoryPath))
        {
            throw new DirectoryNotFoundException($"Foxhole pak directory is unavailable: '{_pakDirectoryPath}'.");
        }

        _fileProvider = FoxWatchPackageSource.CreateProvider(
            _pakDirectoryPath,
            EngineVersion,
            StringComparer.OrdinalIgnoreCase);
        _fileProvider.Initialize();
        _fileProvider.Mount();
        _mounted = true;

        _logger.LogInformation("Initialized texture asset exporter with engine version {EngineVersion}", EngineVersion);
    }

    private static string NormalizePrefix(string pathPrefix)
    {
        return string.IsNullOrWhiteSpace(pathPrefix)
            ? string.Empty
            : pathPrefix.Replace('\\', '/').Trim();
    }
}
