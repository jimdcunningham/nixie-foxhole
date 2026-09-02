namespace FoxWatchService;

public static class FoxWatchManifestCategoryNormalizer
{
    private static readonly Dictionary<string, string> RawToCanonicalCategoryId = new(StringComparer.Ordinal)
    {
        ["defense"] = "defenses",
        ["bunker"] = "entrenchments",
        ["facility"] = "factories",
        ["foundation"] = "foundations",
        ["mining"] = "harvesters",
        ["misc"] = "misc",
        ["shippables"] = "shippables",
        ["liquids"] = "liquids",
        ["power"] = "power",
    };

    private static readonly Dictionary<string, int> CategoryOrderById = new(StringComparer.Ordinal)
    {
        ["defenses"] = 10,
        ["entrenchments"] = 20,
        ["factories"] = 30,
        ["foundations"] = 40,
        ["harvesters"] = 50,
        ["liquids"] = 60,
        ["power"] = 70,
        ["shippables"] = 80,
        ["misc"] = 90,
    };

    public static string NormalizeCategoryId(string? rawCategoryId)
    {
        var normalized = NormalizeKey(rawCategoryId);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return "misc";
        }

        return RawToCanonicalCategoryId.GetValueOrDefault(normalized, "misc");
    }

    public static bool IsKnownCategory(string? rawCategoryId)
    {
        var normalized = NormalizeKey(rawCategoryId);
        return !string.IsNullOrWhiteSpace(normalized) && RawToCanonicalCategoryId.ContainsKey(normalized);
    }

    public static int GetCategoryOrder(string? categoryId)
    {
        var normalized = NormalizeKey(categoryId);
        return CategoryOrderById.GetValueOrDefault(normalized, 999);
    }

    public static string NormalizeKey(string? value)
    {
        return string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : value.Trim().Replace("_", string.Empty, StringComparison.Ordinal).ToLowerInvariant();
    }
}