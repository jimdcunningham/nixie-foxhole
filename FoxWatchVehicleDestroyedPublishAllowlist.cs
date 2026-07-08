namespace FoxWatchService;

using System.Text.Json;

public static class FoxWatchVehicleDestroyedPublishAllowlist
{
    private const string WhitelistFileName = "vehicle-destroyed-whitelist.json";

    public static HashSet<string> LoadAllowlistedStructureIds()
    {
        var allowlist = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        LoadCentralWhitelist(allowlist);
        LoadPerStructureOverrideFlags(allowlist);
        return allowlist;
    }

    public static bool ShouldPublishDestroyedVisuals(string? structureId, ISet<string>? allowlist = null)
    {
        if (string.IsNullOrWhiteSpace(structureId))
        {
            return false;
        }

        allowlist ??= LoadAllowlistedStructureIds();
        return allowlist.Contains(structureId.Trim());
    }

    private static void LoadCentralWhitelist(ISet<string> allowlist)
    {
        var whitelistPath = Path.Combine(FoxWatchWorkspace.OverrideRoot, WhitelistFileName);
        if (!File.Exists(whitelistPath))
        {
            return;
        }

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(whitelistPath));
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("structureIds", out var structureIdsElement) ||
                structureIdsElement.ValueKind != JsonValueKind.Array)
            {
                return;
            }

            foreach (var structureIdElement in structureIdsElement.EnumerateArray())
            {
                if (structureIdElement.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                var structureId = structureIdElement.GetString()?.Trim();
                if (!string.IsNullOrWhiteSpace(structureId))
                {
                    allowlist.Add(structureId);
                }
            }
        }
        catch (JsonException)
        {
        }
        catch (IOException)
        {
        }
    }

    private static void LoadPerStructureOverrideFlags(ISet<string> allowlist)
    {
        if (!Directory.Exists(FoxWatchWorkspace.OverrideRoot))
        {
            return;
        }

        foreach (var directoryPath in Directory.EnumerateDirectories(FoxWatchWorkspace.OverrideRoot))
        {
            var structureId = Path.GetFileName(directoryPath)?.Trim();
            if (string.IsNullOrWhiteSpace(structureId))
            {
                continue;
            }

            var manifestPath = Path.Combine(directoryPath, "manifest.json");
            if (!File.Exists(manifestPath))
            {
                continue;
            }

            try
            {
                using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
                if (document.RootElement.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                foreach (var property in document.RootElement.EnumerateObject())
                {
                    if (!string.Equals(property.Name, "publishDestroyedVisuals", StringComparison.OrdinalIgnoreCase) ||
                        property.Value.ValueKind != JsonValueKind.True)
                    {
                        continue;
                    }

                    allowlist.Add(structureId);
                    break;
                }
            }
            catch (JsonException)
            {
            }
            catch (IOException)
            {
            }
        }
    }
}
