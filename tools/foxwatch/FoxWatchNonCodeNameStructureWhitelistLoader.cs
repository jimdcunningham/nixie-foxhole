namespace FoxWatchService;

using System.Text.Json;

public sealed class FoxWatchNonCodeNameStructureWhitelistLoader
{
    private readonly ILogger<FoxWatchNonCodeNameStructureWhitelistLoader> _logger;
    private IReadOnlySet<string>? _cachedStructureIds;

    public FoxWatchNonCodeNameStructureWhitelistLoader(ILogger<FoxWatchNonCodeNameStructureWhitelistLoader> logger)
    {
        _logger = logger;
    }

    public bool Contains(string? structureId)
    {
        return !string.IsNullOrWhiteSpace(structureId)
            && GetStructureIds().Contains(structureId.Trim());
    }

    private IReadOnlySet<string> GetStructureIds()
    {
        return _cachedStructureIds ??= LoadStructureIds();
    }

    private IReadOnlySet<string> LoadStructureIds()
    {
        var filePath = FoxWatchWorkspace.ResolvePath(FoxWatchWorkspace.NonCodeNameStructureWhitelistRelativePath);
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(filePath));
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                _logger.LogWarning(
                    "Skipping non-CodeName structure whitelist at {WhitelistPath} because the root value must be an object",
                    filePath);
                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            }

            if (!document.RootElement.TryGetProperty("structureIds", out var structureIdsElement))
            {
                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            }

            if (structureIdsElement.ValueKind != JsonValueKind.Array)
            {
                _logger.LogWarning(
                    "Skipping non-CodeName structure whitelist at {WhitelistPath} because structureIds must be an array",
                    filePath);
                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            }

            var structureIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var structureIdElement in structureIdsElement.EnumerateArray())
            {
                if (structureIdElement.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                var structureId = structureIdElement.GetString()?.Trim();
                if (!string.IsNullOrWhiteSpace(structureId))
                {
                    structureIds.Add(structureId);
                }
            }

            return structureIds;
        }
        catch (JsonException exception)
        {
            _logger.LogWarning(exception, "Failed to parse non-CodeName structure whitelist at {WhitelistPath}", filePath);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Failed to read non-CodeName structure whitelist at {WhitelistPath}", filePath);
        }

        return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }
}