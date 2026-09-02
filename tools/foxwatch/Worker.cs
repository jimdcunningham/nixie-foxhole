namespace FoxWatchService;

using Microsoft.Extensions.Options;

public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly FoxWatchOptions _options;
    private readonly FoxWatchManifestGenerator _manifestGenerator;

    public Worker(
        ILogger<Worker> logger,
        IOptions<FoxWatchOptions> options,
        FoxWatchManifestGenerator manifestGenerator)
    {
        _logger = logger;
        _options = options.Value;
        _manifestGenerator = manifestGenerator;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("FoxWatchService is starting.");

        var pakDirectoryPath = FoxWatchWorkspace.ResolvePakDirectoryPath(_options.PakDirectoryPath);
        if (!string.IsNullOrWhiteSpace(pakDirectoryPath) && Directory.Exists(pakDirectoryPath))
        {
            _logger.LogInformation("Using Foxhole pak directory at {PakDirectoryPath}", pakDirectoryPath);
        }
        else
        {
            _logger.LogWarning("Configured pak directory was not found: {PakDirectoryPath}", pakDirectoryPath);
        }

        var manifestOutputPath = FoxWatchWorkspace.ResolvePath(_options.ManifestOutputPath);
        if (string.IsNullOrWhiteSpace(manifestOutputPath))
        {
            _logger.LogWarning("No manifest output path is configured.");
            return;
        }

        await _manifestGenerator.GenerateAsync(
            manifestOutputPath,
            _options.BaseAssetsUrl ?? FoxWatchWorkspace.DefaultBaseAssetsUrl,
            pakDirectoryPath,
            targetFilter: null,
            stoppingToken
        );
    }
}
