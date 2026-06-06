namespace FoxWatchService;

using Microsoft.Extensions.Options;

public sealed class FoxWatchOptionsValidator : IValidateOptions<FoxWatchOptions>
{
    public ValidateOptionsResult Validate(string? name, FoxWatchOptions options)
    {
        var failures = new List<string>();

        ValidateOptionalPath(options.ManifestOutputPath, nameof(options.ManifestOutputPath), failures);
        ValidateOptionalPath(options.MapDataOutputPath, nameof(options.MapDataOutputPath), failures);
        ValidateOptionalPath(options.IconOutputDirectory, nameof(options.IconOutputDirectory), failures);
        ValidateOptionalPath(options.TextureOutputDirectory, nameof(options.TextureOutputDirectory), failures);
        ValidateOptionalPath(options.RenderSceneOutputDirectory, nameof(options.RenderSceneOutputDirectory), failures);
        ValidateOptionalPath(options.RenderAssetOutputDirectory, nameof(options.RenderAssetOutputDirectory), failures);
        ValidateOptionalPath(options.MeshProbeOutputPath, nameof(options.MeshProbeOutputPath), failures);
        ValidateOptionalPath(options.PakDirectoryPath, nameof(options.PakDirectoryPath), failures);

        if (string.IsNullOrWhiteSpace(options.BaseAssetsUrl))
        {
            failures.Add($"{nameof(options.BaseAssetsUrl)} must not be empty.");
        }
        else
        {
            if (!options.BaseAssetsUrl.StartsWith("/", StringComparison.Ordinal))
            {
                failures.Add($"{nameof(options.BaseAssetsUrl)} must start with '/'.");
            }

            if (options.BaseAssetsUrl.Contains(' '))
            {
                failures.Add($"{nameof(options.BaseAssetsUrl)} must not contain spaces.");
            }
        }

        return failures.Count > 0
            ? ValidateOptionsResult.Fail(failures)
            : ValidateOptionsResult.Success;
    }

    private static void ValidateOptionalPath(string? value, string propertyName, List<string> failures)
    {
        if (value == null)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(value))
        {
            failures.Add($"{propertyName} must not be blank when provided.");
            return;
        }

        if (value.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
        {
            failures.Add($"{propertyName} contains invalid path characters.");
        }
    }
}