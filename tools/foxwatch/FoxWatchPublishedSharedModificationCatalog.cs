using System.Text.Json;

namespace FoxWatchService;

internal static class FoxWatchPublishedSharedModificationCatalog
{
    private static HashSet<string>? cachedSharedModificationIds;

    public static bool IsSharedModificationRenderId(string? renderId)
    {
        if (string.IsNullOrWhiteSpace(renderId))
        {
            return false;
        }

        cachedSharedModificationIds ??= LoadSharedModificationIds();
        return cachedSharedModificationIds.Contains(NormalizeRenderId(renderId));
    }

    private static HashSet<string> LoadSharedModificationIds()
    {
        var sharedModificationIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        LoadSharedModificationIdsFromOverrideManifest(sharedModificationIds);
        LoadSharedModificationIdsFromPublishedManifest(sharedModificationIds);
        return sharedModificationIds;
    }

    private static void LoadSharedModificationIdsFromOverrideManifest(ISet<string> sharedModificationIds)
    {
        var overridePath = FoxWatchWorkspace.SharedModificationOverrideManifestPath;
        if (!File.Exists(overridePath))
        {
            return;
        }

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(overridePath));
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            foreach (var property in document.RootElement.EnumerateObject())
            {
                var renderId = NormalizeRenderId(property.Name);
                if (!string.IsNullOrWhiteSpace(renderId))
                {
                    sharedModificationIds.Add(renderId);
                }
            }
        }
        catch
        {
        }
    }

    private static void LoadSharedModificationIdsFromPublishedManifest(ISet<string> sharedModificationIds)
    {
        var publishedManifestPath = FoxWatchWorkspace.ResolvePath("packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json");
        if (string.IsNullOrWhiteSpace(publishedManifestPath) || !File.Exists(publishedManifestPath))
        {
            return;
        }

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(publishedManifestPath));
            if (!document.RootElement.TryGetProperty("shared", out var sharedElement)
                || !sharedElement.TryGetProperty("modifications", out var modificationsElement)
                || modificationsElement.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            foreach (var property in modificationsElement.EnumerateObject())
            {
                var renderId = NormalizeRenderId(property.Name);
                if (!string.IsNullOrWhiteSpace(renderId))
                {
                    sharedModificationIds.Add(renderId);
                }
            }
        }
        catch
        {
        }
    }

    private static string NormalizeRenderId(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
    }
}
