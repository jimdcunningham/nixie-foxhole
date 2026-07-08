namespace FoxWatchService;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Console;
using Microsoft.Extensions.Options;

public static class FoxWatchCliSupport
{
    private static readonly string[] QuietDetailLogCategories =
    [
        "FoxWatchService.FoxWatchAssetMeshExporter",
        "FoxWatchService.FoxWatchRenderBlueprintSceneExtractor",
    ];

    public static void ApplyStandardLoggingFilters(ILoggingBuilder builder, bool verbose)
    {
        if (verbose)
        {
            builder.AddFilter("FoxWatchService.FoxWatchRenderSceneGenerator", LogLevel.Debug);
            return;
        }

        foreach (var category in QuietDetailLogCategories)
        {
            builder.AddFilter(category, LogLevel.Warning);
        }
    }

    public static IConfiguration BuildConfiguration()
    {
        return new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: true)
            .AddEnvironmentVariables()
            .Build();
    }

    public static ServiceProvider BuildProvider(IConfiguration configuration, Action<ILoggingBuilder>? configureLogging = null)
    {
        var services = new ServiceCollection();
        services.AddLogging(builder =>
        {
            builder.AddSimpleConsole(ConfigureConsoleLogging);
            configureLogging?.Invoke(builder);
        });
        services.AddFoxWatchOptions(configuration);
        services.AddFoxWatchCoreServices();
        return services.BuildServiceProvider();
    }

    public static ServiceProvider BuildProvider<TPrimaryService>(IConfiguration configuration, Action<ILoggingBuilder>? configureLogging = null)
        where TPrimaryService : class
    {
        var services = new ServiceCollection();
        services.AddLogging(builder =>
        {
            builder.AddSimpleConsole(ConfigureConsoleLogging);
            configureLogging?.Invoke(builder);
        });
        services.AddFoxWatchOptions(configuration);
        services.AddSingleton<TPrimaryService>();
        return services.BuildServiceProvider();
    }

    private static void ConfigureConsoleLogging(SimpleConsoleFormatterOptions options)
    {
        options.TimestampFormat = "HH:mm:ss.fff ";
        options.UseUtcTimestamp = false;
        options.SingleLine = false;
    }

    public static string? ResolveRequiredPath(
        ILogger logger,
        string? configuredPath,
        string cliOptionName,
        string configPath,
        string description)
    {
        var resolvedPath = FoxWatchWorkspace.ResolvePath(configuredPath);
        if (!string.IsNullOrWhiteSpace(resolvedPath))
        {
            return resolvedPath;
        }

        logger.LogError("Missing {Description}. Use --{CliOptionName} <path> or configure {ConfigPath}.", description, cliOptionName, configPath);
        return null;
    }

    public static string? ResolvePakDirectoryPath(
        ILogger logger,
        FoxWatchCliArguments parsedArguments,
        FoxWatchOptions configuredOptions,
        bool required)
    {
        var pakDirectoryPath = FoxWatchWorkspace.ResolvePakDirectoryPath(parsedArguments.GetValueOrDefault("pak-path") ?? configuredOptions.PakDirectoryPath);
        if (!string.IsNullOrWhiteSpace(pakDirectoryPath) && Directory.Exists(pakDirectoryPath))
        {
            return pakDirectoryPath;
        }

        if (required)
        {
            logger.LogError("Missing pak directory path. Use --pak-path <path> or configure FoxWatch:PakDirectoryPath.");
        }

        return pakDirectoryPath;
    }

    public static (ILogger Logger, T Service, FoxWatchOptions Options) ResolveCommand<T>(ServiceProvider provider)
        where T : class
    {
        return (
            provider.GetRequiredService<ILoggerFactory>().CreateLogger("FoxWatchCli"),
            provider.GetRequiredService<T>(),
            provider.GetRequiredService<IOptions<FoxWatchOptions>>().Value);
    }
}