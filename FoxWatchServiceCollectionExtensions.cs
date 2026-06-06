namespace FoxWatchService;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

public static class FoxWatchServiceCollectionExtensions
{
    public static IServiceCollection AddFoxWatchOptions(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IValidateOptions<FoxWatchOptions>, FoxWatchOptionsValidator>();
        services.AddOptions<FoxWatchOptions>()
            .Bind(configuration.GetSection(FoxWatchOptions.SectionName))
            .ValidateOnStart();
        return services;
    }

    public static IServiceCollection AddFoxWatchCoreServices(this IServiceCollection services)
    {
        services.AddSingleton<FoxWatchAssetManifestOverrideLoader>();
        services.AddSingleton<FoxWatchNonCodeNameStructureWhitelistLoader>();
        services.AddSingleton<FoxWatchMapDataGenerator>();
        services.AddSingleton<FoxWatchManifestReferenceHydrator>();
        services.AddSingleton<FoxWatchManifestGenerator>();
        services.AddSingleton<FoxWatchAssetMeshExporter>();
        services.AddSingleton<FoxWatchAssetTextureExporter>();
        services.AddSingleton<FoxWatchRenderBlueprintSceneExtractor>();
        services.AddSingleton<FoxWatchAssetMeshExportProbe>();
        services.AddSingleton<FoxWatchPoseOverrideLoader>();
        services.AddSingleton<FoxWatchRenderSceneGenerator>();
        return services;
    }
}