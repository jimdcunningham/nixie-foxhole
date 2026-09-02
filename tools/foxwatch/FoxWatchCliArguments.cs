namespace FoxWatchService;

public sealed class FoxWatchCliArguments
{
    private readonly Dictionary<string, List<string>> _valuesByKey = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _presentKeys = new(StringComparer.OrdinalIgnoreCase);

    private FoxWatchCliArguments()
    {
    }

    public static FoxWatchCliArguments Parse(string[] args)
    {
        var parsed = new FoxWatchCliArguments();

        for (var index = 0; index < args.Length; index += 1)
        {
            var current = args[index];
            if (!current.StartsWith("--", StringComparison.Ordinal))
            {
                continue;
            }

            var key = current[2..];
            parsed._presentKeys.Add(key);

            if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                continue;
            }

            var value = args[++index];
            if (!parsed._valuesByKey.TryGetValue(key, out var values))
            {
                values = [];
                parsed._valuesByKey[key] = values;
            }

            values.Add(value);
        }

        return parsed;
    }

    public bool ContainsKey(string key) => _presentKeys.Contains(key);

    public string? GetValueOrDefault(string key)
    {
        return _valuesByKey.TryGetValue(key, out var values) && values.Count > 0
            ? values[^1]
            : null;
    }

    public IReadOnlyList<string> GetListValues(string key)
    {
        if (!_valuesByKey.TryGetValue(key, out var values) || values.Count == 0)
        {
            return [];
        }

        return values
            .SelectMany(value => value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray();
    }
}