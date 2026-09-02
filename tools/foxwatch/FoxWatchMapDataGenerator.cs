namespace FoxWatchService;

using CUE4Parse.FileProvider;
using CUE4Parse.FileProvider.Objects;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Versions;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

public sealed class FoxWatchMapDataGenerator
{
    private const EGame EngineVersion = EGame.GAME_UE4_24;
    private const string WarApiStaticEndpoint = "https://war-service-live.foxholeservices.com/api/worldconquest/maps";
    private const string MapListPackagePath = "War/Content/Blueprints/Data/BPMapList.uasset";
    private const string PublishedMapDataRelativePath = "packages/extensions/foxhole/public/foxhole/assets/maps/map-data.v1.json";
    private const string MasterMapPackagePrefix = "War/Content/Maps/Master/";
    private const double WorldMinX = -109199.999997d;
    private const double WorldMinY = -94499.99999580907d;
    private const double WorldMaxX = 109199.999997d;
    private const double WorldMaxY = 94499.99999580907d;
    private static readonly Regex CoverWellTypePattern = new("^BPCoverWell[0-9A-Za-z]*_C$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly ILogger<FoxWatchMapDataGenerator> _logger;
    private readonly string? _pakDirectoryPath;
    private DefaultFileProvider? _fileProvider;
    private bool _mounted;

    public FoxWatchMapDataGenerator(ILogger<FoxWatchMapDataGenerator> logger, IOptions<FoxWatchOptions> options)
    {
        _logger = logger;
        _pakDirectoryPath = FoxWatchWorkspace.ResolvePakDirectoryPath(options.Value.PakDirectoryPath);
    }

    public async Task GenerateAsync(string outputPath, CancellationToken cancellationToken = default)
    {
        var mapRegionsPath = Path.Combine(FoxWatchWorkspace.OverrideRoot, "map-regions.json");
        var mapIconsPath = Path.Combine(FoxWatchWorkspace.OverrideRoot, "map-icons.json");
        var publishedMapDataPath = Path.Combine(FoxWatchWorkspace.RepositoryRoot, PublishedMapDataRelativePath);

        _logger.LogInformation("Loading map-region overrides from {MapRegionsPath}", mapRegionsPath);
        var mapRegionsDocument = await LoadJsonObjectAsync(mapRegionsPath, cancellationToken);
        _logger.LogInformation("Loading map-icon overrides from {MapIconsPath}", mapIconsPath);
        var mapIconsDocument = await LoadJsonObjectAsync(mapIconsPath, cancellationToken);
        var previousPublishedDocument = await LoadOptionalJsonObjectAsync(outputPath, cancellationToken);
        JsonObject? currentPublishedDocument = null;
        if (!string.Equals(Path.GetFullPath(outputPath), Path.GetFullPath(publishedMapDataPath), StringComparison.OrdinalIgnoreCase))
        {
            currentPublishedDocument = await LoadOptionalJsonObjectAsync(publishedMapDataPath, cancellationToken);
        }
        _logger.LogInformation("Loaded previous published map-data document: {HasPreviousDocument}", previousPublishedDocument != null);
        EnsureMounted();

        var overrideMaps = CloneObject(mapRegionsDocument["maps"] as JsonObject) ?? new JsonObject();
        var previousFallbackMaps = currentPublishedDocument?["warApiFallback"]?["maps"] as JsonObject ?? previousPublishedDocument?["warApiFallback"]?["maps"] as JsonObject;
        EnsureOverrideMapsHaveRegionIds(overrideMaps);
        _logger.LogInformation("Building published maps from {OverrideMapCount} override entries", overrideMaps.Count);
        var maps = BuildPublishedMaps(overrideMaps);
        _logger.LogInformation("Fetching War API fallback data for {MapCount} maps", maps.Count);
        var warApiFallbackMaps = await FetchWarApiFallbackForMapsAsync(maps, previousFallbackMaps, cancellationToken);
        _logger.LogInformation("Fetched War API fallback entries for {FallbackMapCount} maps", warApiFallbackMaps.Count);

        var persistedWarApiRegionIds = MergeRegionIdsIntoOverrideMaps(overrideMaps, warApiFallbackMaps, replaceExisting: true);
        if (persistedWarApiRegionIds > 0)
        {
            mapRegionsDocument["maps"] = overrideMaps;
            var overrideJson = System.Text.Json.JsonSerializer.Serialize(mapRegionsDocument, SerializerOptions);
            await File.WriteAllTextAsync(mapRegionsPath, $"{overrideJson}{Environment.NewLine}", cancellationToken);
            _logger.LogInformation("Persisted map-region overrides to {MapRegionsPath} after updating {UpdatedCount} IDs from War API", mapRegionsPath, persistedWarApiRegionIds);
        }

        var warApiRegionIdsApplied = 0;
        var warApiRegionIdsAlreadyMatched = 0;
        var previousManifestRegionIdsRetained = 0;
        var missingPublishedMapsForRegionMerge = 0;
        foreach (var entry in warApiFallbackMaps)
        {
            if (!maps.TryGetPropertyValue(entry.Key, out var mapNode) || mapNode is not JsonObject mapObject)
            {
                missingPublishedMapsForRegionMerge++;
                continue;
            }

            if (entry.Value is not JsonObject fallbackMapObject)
            {
                continue;
            }

            var regionId = TryGetFiniteNumber(fallbackMapObject["regionId"]);
            if (regionId == null)
            {
                continue;
            }

            var existingRegionId = TryGetFiniteNumber(mapObject["regionId"]);
            if (existingRegionId != null && Math.Abs(existingRegionId.Value - regionId.Value) < double.Epsilon)
            {
                warApiRegionIdsAlreadyMatched++;
                continue;
            }

            mapObject["regionId"] = JsonValue.Create((int)regionId.Value);
            warApiRegionIdsApplied++;
        }

        if (missingPublishedMapsForRegionMerge > 0)
        {
            _logger.LogWarning("Skipped regionId merge for {MissingMapCount} maps because no published map node was found", missingPublishedMapsForRegionMerge);
        }

        _logger.LogInformation("Applied War API region IDs to {AppliedCount} maps, found {AlreadyMatchedCount} already matching War API values, and retained previous manifest region IDs for {FallbackCount} maps", warApiRegionIdsApplied, warApiRegionIdsAlreadyMatched, previousManifestRegionIdsRetained);

        var publishedMapIcons = BuildPublishedMapIcons(mapIconsDocument["mapIcons"] as JsonObject);
        _logger.LogInformation("Built {MapIconCount} published map icons", publishedMapIcons.Count);

        var publishedMapData = new JsonObject
        {
            ["schemaVersion"] = "1.0.0",
            ["source"] = new JsonObject
            {
                ["kind"] = "foxwatch",
            },
            ["maps"] = maps,
            ["mapIcons"] = publishedMapIcons,
            ["warApiFallback"] = new JsonObject
            {
                ["maps"] = warApiFallbackMaps,
            },
        };

        var outputDirectory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(outputDirectory))
        {
            Directory.CreateDirectory(outputDirectory);
        }

        _logger.LogInformation("Writing published map data with {MapCount} maps to {OutputPath}", maps.Count, outputPath);
        var json = System.Text.Json.JsonSerializer.Serialize(publishedMapData, SerializerOptions);
        await File.WriteAllTextAsync(outputPath, $"{json}{Environment.NewLine}", cancellationToken);
        _logger.LogInformation("Wrote FoxWatch map data to {OutputPath}", outputPath);
    }

    private JsonObject BuildPublishedMaps(JsonObject overrideMaps)
    {
        var publishedMaps = new JsonObject();
        var mapDatabaseEntries = LoadMapDatabaseEntries();
        var eligibleEntries = mapDatabaseEntries
            .Where(entry => entry.Value?.Value<bool?>("bIsInHexGrid") == true)
            .ToArray();
        var totalStaticIconCount = 0;

        _logger.LogInformation("Loaded {MapDatabaseEntryCount} map database entries; {EligibleMapCount} are in the hex grid", mapDatabaseEntries.Count, eligibleEntries.Length);

        for (var index = 0; index < eligibleEntries.Length; index++)
        {
            var entry = eligibleEntries[index];

            var mapKey = NormalizeString(entry.Key);
            if (string.IsNullOrWhiteSpace(mapKey))
            {
                continue;
            }

            _logger.LogInformation("Processing map {MapIndex}/{MapCount}: {MapKey}", index + 1, eligibleEntries.Length, mapKey);

            var mapValue = entry.Value;
            if (mapValue is null)
            {
                continue;
            }

            var overrideMap = overrideMaps[mapKey] as JsonObject;
            var displayName = mapValue["DisplayName"]?["LocalizedString"]?.Value<string>()
                ?? mapValue["DisplayName"]?["SourceString"]?.Value<string>()
                ?? string.Empty;
            var imageObjectPath = mapValue["Image"]?["ObjectPath"]?.Value<string>() ?? string.Empty;
            var publishedMap = new JsonObject
            {
                ["name"] = !string.IsNullOrWhiteSpace(displayName) ? displayName : overrideMap?["name"]?.GetValue<string>()?.Trim() ?? mapKey,
                ["icon"] = BuildPublishedMapIconPath(imageObjectPath),
                ["textureKey"] = BuildTextureKey(imageObjectPath),
                ["showForResistance"] = CloneNode(overrideMap?["showForResistance"]),
                ["regionId"] = CloneNode(overrideMap?["regionId"]),
                ["gridCoord"] = SanitizeGridCoordinate(mapValue["GridCoord"] as JObject),
            };

            var staticIcons = LoadStaticIconsForMap(mapKey);
            if (staticIcons.Count == 0)
            {
                var existingStaticIcons = CloneArray(overrideMap?["static"]?["icons"] as JsonArray);
                if (existingStaticIcons?.Count > 0)
                {
                    staticIcons = existingStaticIcons;
                }
            }

            if (staticIcons.Count > 0)
            {
                publishedMap["static"] = new JsonObject
                {
                    ["icons"] = staticIcons,
                };
            }

            totalStaticIconCount += staticIcons.Count;
            _logger.LogInformation("Processed map {MapKey}: textureKey={TextureKey}, staticIcons={StaticIconCount}", mapKey, publishedMap["textureKey"]?.GetValue<string>(), staticIcons.Count);

            RemoveNullProperties(publishedMap);
            publishedMaps[mapKey] = publishedMap;
        }

        _logger.LogInformation("Built published map data for {MapCount} maps with {StaticIconCount} total static icons", publishedMaps.Count, totalStaticIconCount);

        return publishedMaps;
    }

    private static int MergeRegionIdsIntoOverrideMaps(JsonObject overrideMaps, JsonObject? sourceMaps, bool replaceExisting)
    {
        if (sourceMaps == null)
        {
            return 0;
        }

        var updatedCount = 0;
        foreach (var entry in sourceMaps)
        {
            if (entry.Value is not JsonObject sourceMap)
            {
                continue;
            }

            var regionId = TryGetFiniteNumber(sourceMap["regionId"]);
            if (regionId == null)
            {
                continue;
            }

            var mapKey = entry.Key;
            if (string.IsNullOrWhiteSpace(mapKey))
            {
                continue;
            }

            if (overrideMaps[mapKey] is not JsonObject overrideMap)
            {
                overrideMap = new JsonObject();
                overrideMaps[mapKey] = overrideMap;
            }

            var existingRegionId = TryGetFiniteNumber(overrideMap["regionId"]);
            if (existingRegionId != null)
            {
                if (!replaceExisting || Math.Abs(existingRegionId.Value - regionId.Value) < double.Epsilon)
                {
                    continue;
                }
            }

            overrideMap["regionId"] = JsonValue.Create((int)regionId.Value);
            updatedCount++;
        }

        return updatedCount;
    }

    private static void EnsureOverrideMapsHaveRegionIds(JsonObject overrideMaps)
    {
        var missingRegionIds = overrideMaps
            .Where(entry => entry.Value is JsonObject overrideMap && TryGetFiniteNumber(overrideMap["regionId"]) == null)
            .Select(entry => entry.Key)
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .OrderBy(key => key, StringComparer.Ordinal)
            .ToArray();

        if (missingRegionIds.Length == 0)
        {
            return;
        }

        throw new InvalidOperationException($"Map-region overrides are missing regionId for {missingRegionIds.Length} maps: {string.Join(", ", missingRegionIds)}");
    }

    private async Task<JsonObject> LoadJsonObjectAsync(string path, CancellationToken cancellationToken)
    {
        var node = await LoadOptionalJsonObjectAsync(path, cancellationToken);
        if (node == null)
        {
            throw new FileNotFoundException($"Expected JSON object at {path}", path);
        }

        return node;
    }

    private static async Task<JsonObject?> LoadOptionalJsonObjectAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            return null;
        }

        var raw = await File.ReadAllTextAsync(path, cancellationToken);
        return JsonNode.Parse(raw) as JsonObject;
    }

    private static JsonObject BuildPublishedMapIcons(JsonObject? iconOverrides)
    {
        var publishedMapIcons = new JsonObject();
        foreach (var entry in iconOverrides ?? [])
        {
            if (entry.Value is not JsonObject iconOverride)
            {
                continue;
            }

            var textureName = entry.Value?["textureName"]?.GetValue<string>()?.Trim();
            if (string.IsNullOrWhiteSpace(textureName))
            {
                continue;
            }

            var publishedIcon = CloneObject(iconOverride) ?? new JsonObject();
            publishedIcon.Remove("textureName");
            publishedIcon["icon"] = textureName;
            publishedMapIcons[entry.Key] = publishedIcon;
        }

        return publishedMapIcons;
    }

    private IReadOnlyList<FoxWatchMapDatabaseEntry> LoadMapDatabaseEntries()
    {
        var packagePath = ResolvePackagePath(MapListPackagePath);
        if (string.IsNullOrWhiteSpace(packagePath))
        {
            throw new FileNotFoundException($"Expected Foxhole map list package at {MapListPackagePath}", MapListPackagePath);
        }

        var package = _fileProvider!.LoadPackage(packagePath);
        var exportTokens = JArray.Parse(JsonConvert.SerializeObject(package.GetExports().ToArray(), Formatting.None));
        var defaultObject = exportTokens
            .OfType<JObject>()
            .FirstOrDefault(export =>
                string.Equals(export.Value<string>("Type"), "BPMapList_C", StringComparison.OrdinalIgnoreCase)
                && export["Properties"]?["MapDatabase"] is JArray)
            ?? exportTokens
                .OfType<JObject>()
                .FirstOrDefault(export =>
                    string.Equals(export.Value<string>("Name"), "Default__BPMapList_C", StringComparison.OrdinalIgnoreCase)
                    && export["Properties"]?["MapDatabase"] is JArray);
        if (defaultObject?["Properties"]?["MapDatabase"] is not JArray mapDatabase)
        {
            return [];
        }

        return mapDatabase
            .OfType<JObject>()
            .Select(entry => new FoxWatchMapDatabaseEntry
            {
                Key = NormalizeString(entry.Value<string>("Key")),
                Value = entry["Value"] as JObject,
            })
            .Where(entry => !string.IsNullOrWhiteSpace(entry.Key) && entry.Value != null)
            .ToArray();
    }

    private JsonArray LoadStaticIconsForMap(string mapKey)
    {
        var staticIcons = new JsonArray();
        var mapPackagePath = ResolvePackagePath($"{MasterMapPackagePrefix}{mapKey}.umap")
            ?? ResolvePackagePath($"{MasterMapPackagePrefix}{mapKey}.uasset")
            ?? ResolvePackagePath($"{MasterMapPackagePrefix}{mapKey}");
        if (string.IsNullOrWhiteSpace(mapPackagePath))
        {
            _logger.LogWarning("Missing master map package for {MapKey}", mapKey);
            return staticIcons;
        }

        try
        {
            var package = _fileProvider!.LoadPackage(mapPackagePath);
            var seen = new HashSet<string>(StringComparer.Ordinal);

            foreach (var export in package.GetExports())
            {
                if (export is not IPropertyHolder holder)
                {
                    continue;
                }

                var type = NormalizeString(export.ExportType);
                var outer = NormalizeString(export.Outer?.Name.Text);
                var isWellSceneComponent = string.Equals(type, "SceneComponent", StringComparison.OrdinalIgnoreCase)
                    && outer.StartsWith("BPCoverWell", StringComparison.OrdinalIgnoreCase);
                if (!isWellSceneComponent)
                {
                    continue;
                }

                if (!TryReadVector(holder, "RelativeLocation", out var relativeLocation))
                {
                    continue;
                }

                var key = string.Create(CultureInfo.InvariantCulture, $"{Math.Round(relativeLocation.X, 3)}:{Math.Round(relativeLocation.Y, 3)}");
                if (!seen.Add(key))
                {
                    continue;
                }

                staticIcons.Add(new JsonObject
                {
                    ["iconType"] = JsonValue.Create(-2),
                    ["x"] = JsonValue.Create(RoundToRelativePercent(relativeLocation.X, WorldMinX, WorldMaxX)),
                    ["y"] = JsonValue.Create(RoundToRelativePercent(relativeLocation.Y, WorldMinY, WorldMaxY)),
                });
            }
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Failed to parse master map package for {MapKey}", mapKey);
        }

        return staticIcons;
    }

    private static string? BuildPublishedMapIconPath(string? imageObjectPath)
    {
        if (string.IsNullOrWhiteSpace(imageObjectPath))
        {
            return null;
        }

        if (!imageObjectPath.StartsWith("War/Content/Textures/", StringComparison.Ordinal))
        {
            return null;
        }

        var basePath = imageObjectPath
            .Replace("/Processed/", "/Icons/", StringComparison.Ordinal)
            .Substring("War/Content/Textures/".Length)
            .TrimEnd('0', '.');

        return $"../{basePath}.webp";
    }

    private static string? BuildTextureKey(string? imageObjectPath)
    {
        if (string.IsNullOrWhiteSpace(imageObjectPath))
        {
            return null;
        }

        var fileName = Path.GetFileNameWithoutExtension(imageObjectPath.Trim());
        return string.IsNullOrWhiteSpace(fileName) ? null : fileName;
    }

    private static JsonObject? SanitizeGridCoordinate(JObject? gridCoordinate)
    {
        var x = gridCoordinate?.Value<double?>("X");
        var y = gridCoordinate?.Value<double?>("Y");
        if (x == null || y == null)
        {
            return null;
        }

        return new JsonObject
        {
            ["x"] = JsonValue.Create(NormalizeUnsignedGridCoordinate(x.Value)),
            ["y"] = JsonValue.Create(NormalizeUnsignedGridCoordinate(y.Value)),
        };
    }

    private static int NormalizeUnsignedGridCoordinate(double value)
    {
        var rounded = (long)Math.Round(value, MidpointRounding.AwayFromZero);
        return rounded > 10 ? (int)(rounded - uint.MaxValue - 1L) : (int)rounded;
    }

    private static bool? TryGetBoolean(object? node)
    {
        if (node == null)
        {
            return null;
        }

        if (node is bool directValue)
        {
            return directValue;
        }

        var text = ExtractText(node);
        if (bool.TryParse(text, out var parsedValue))
        {
            return parsedValue;
        }

        return null;
    }

    private static double RoundToRelativePercent(double value, double minimum, double maximum)
    {
        var percent = (value - minimum) / (maximum - minimum);
        return Math.Round(percent, 8, MidpointRounding.AwayFromZero);
    }

    private static JsonNode? CloneNode(JsonNode? value)
    {
        return value?.DeepClone();
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

        _logger.LogInformation("Initialized map-data generator with engine version {EngineVersion}", EngineVersion);
    }

    private string? ResolvePackagePath(string assetPath)
    {
        var normalized = assetPath.Replace('\\', '/').Trim();
        if (_fileProvider!.Files.ContainsKey(normalized))
        {
            return normalized;
        }

        foreach (var candidate in new[] { normalized, EnsureExtension(normalized, ".uasset"), EnsureExtension(normalized, ".umap") })
        {
            if (string.IsNullOrWhiteSpace(candidate))
            {
                continue;
            }

            if (_fileProvider.Files.ContainsKey(candidate))
            {
                return candidate;
            }

            var caseInsensitiveMatch = _fileProvider.Files.Keys.FirstOrDefault(path => string.Equals(path, candidate, StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrWhiteSpace(caseInsensitiveMatch))
            {
                return caseInsensitiveMatch;
            }
        }

        return null;
    }

    private static string EnsureExtension(string value, string extension)
    {
        return value.EndsWith(extension, StringComparison.OrdinalIgnoreCase) ? value : $"{value}{extension}";
    }

    private static string ExtractLocalizedText(object? value)
    {
        return NormalizeString(
            ExtractText(GetNamedValue(value, "LocalizedString"))
            ?? ExtractText(GetNamedValue(value, "SourceString"))
            ?? ExtractText(value));
    }

    private static string ExtractText(object? value)
    {
        if (value == null)
        {
            return string.Empty;
        }

        var textProperty = value.GetType().GetProperty("Text");
        if (textProperty != null)
        {
            return NormalizeString(textProperty.GetValue(value)?.ToString());
        }

        return NormalizeString(value.ToString());
    }

    private static string NormalizeString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
    }

    private static double? ExtractDouble(object? value)
    {
        if (value == null)
        {
            return null;
        }

        if (value is double doubleValue)
        {
            return doubleValue;
        }

        if (value is float floatValue)
        {
            return floatValue;
        }

        if (value is int intValue)
        {
            return intValue;
        }

        if (value is long longValue)
        {
            return longValue;
        }

        var text = ExtractText(value);
        return double.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static double? ExtractVectorComponent(object? value, string propertyName)
    {
        return ExtractDouble(GetNamedValue(value, propertyName));
    }

    private static bool TryReadVector(IPropertyHolder holder, string propertyName, out FVector value)
    {
        if (holder.TryGetValue(out value, propertyName))
        {
            return true;
        }

        if (holder.TryGetValue(out FStructFallback fallback, propertyName))
        {
            value = new FVector(
                fallback.GetOrDefault<float>("X"),
                fallback.GetOrDefault<float>("Y"),
                fallback.GetOrDefault<float>("Z"));
            return true;
        }

        value = default;
        return false;
    }

    private static string GetObjectTypeName(object? source)
    {
        if (source == null)
        {
            return string.Empty;
        }

        var directType = NormalizeString(ExtractText(GetNamedValue(source, "Type")));
        if (!string.IsNullOrWhiteSpace(directType))
        {
            return directType;
        }

        var classText = NormalizeString(ExtractText(GetNamedValue(source, "Class")));
        if (!string.IsNullOrWhiteSpace(classText))
        {
            return classText;
        }

        return NormalizeString(source.GetType().Name);
    }

    private static object? GetNamedValue(object? source, string propertyName)
    {
        if (source == null)
        {
            return null;
        }

        if (source is IPropertyHolder holder)
        {
            foreach (var propertyEntry in holder.Properties)
            {
                if (string.Equals(propertyEntry.Name.Text, propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    var resolved = UnwrapScriptValue(propertyEntry.Tag?.GetValue(typeof(object)));
                    if (resolved != null)
                    {
                        return resolved;
                    }
                }
            }
        }

        var runtimeType = source.GetType();

        var getOrDefaultMethod = runtimeType
            .GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .FirstOrDefault(method =>
                string.Equals(method.Name, "GetOrDefault", StringComparison.Ordinal)
                && method.IsGenericMethodDefinition
                && method.GetParameters().Length >= 1
                && method.GetParameters()[0].ParameterType == typeof(string));
        if (getOrDefaultMethod != null)
        {
            try
            {
                var genericMethod = getOrDefaultMethod.MakeGenericMethod(typeof(object));
                object?[] parameters = genericMethod.GetParameters().Length == 1
                    ? [propertyName]
                    : [propertyName, null];

                var resolved = genericMethod.Invoke(source, parameters);
                if (resolved != null)
                {
                    return resolved;
                }
            }
            catch
            {
            }
        }

        if (source is IDictionary dictionary)
        {
            foreach (DictionaryEntry entry in dictionary)
            {
                if (string.Equals(entry.Key?.ToString(), propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    return UnwrapScriptValue(entry.Value);
                }
            }
        }

        var property = runtimeType.GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
        if (property != null)
        {
            return UnwrapScriptValue(property.GetValue(source));
        }

        var field = runtimeType.GetField(propertyName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
        if (field != null)
        {
            return UnwrapScriptValue(field.GetValue(source));
        }

        var propertiesContainer = GetPropertiesContainer(source);
        if (propertiesContainer != null && !ReferenceEquals(propertiesContainer, source))
        {
            return GetNamedValue(propertiesContainer, propertyName);
        }

        return null;
    }

    private static object? GetPropertiesContainer(object source)
    {
        var runtimeType = source.GetType();
        var propertiesProperty = runtimeType.GetProperty("Properties", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
        if (propertiesProperty != null)
        {
            return propertiesProperty.GetValue(source);
        }

        var propertiesField = runtimeType.GetField("Properties", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
        return propertiesField?.GetValue(source);
    }

    private static object? UnwrapScriptValue(object? value)
    {
        if (value == null)
        {
            return null;
        }

        var runtimeType = value.GetType();
        var structTypeProperty = runtimeType.GetProperty("StructType", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
        if (structTypeProperty != null)
        {
            var structValue = structTypeProperty.GetValue(value);
            if (structValue != null)
            {
                return structValue;
            }
        }

        var structTypeField = runtimeType.GetField("StructType", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
        if (structTypeField != null)
        {
            var structValue = structTypeField.GetValue(value);
            if (structValue != null)
            {
                return structValue;
            }
        }

        return value;
    }

    private static void RemoveNullProperties(JsonObject value)
    {
        var keysToRemove = value.Where(entry => entry.Value == null).Select(entry => entry.Key).ToArray();
        foreach (var key in keysToRemove)
        {
            value.Remove(key);
        }
    }

    private async Task<JsonObject> FetchWarApiFallbackForMapsAsync(JsonObject publishedMaps, JsonObject? previousFallbackMaps, CancellationToken cancellationToken)
    {
        var mapKeyList = publishedMaps.Select(entry => entry.Key).ToArray();
        using var httpClient = new HttpClient();
        var fetchedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _logger.LogInformation("Starting War API fallback fetch for {MapCount} maps", mapKeyList.Length);
        var entries = await Task.WhenAll(mapKeyList.Select(mapKey => FetchWarApiFallbackEntryAsync(
            httpClient,
            mapKey,
            fetchedAt,
            publishedMaps[mapKey] as JsonObject,
            previousFallbackMaps?[mapKey] as JsonObject,
            cancellationToken)));

        var fallbackMaps = new JsonObject();
        foreach (var (mapKey, entry) in entries)
        {
            if (entry != null)
            {
                fallbackMaps[mapKey] = entry;
            }
        }

        _logger.LogInformation("Completed War API fallback fetch with {FallbackEntryCount} resolved entries", fallbackMaps.Count);

        return fallbackMaps;
    }

    private async Task<(string MapKey, JsonObject? Entry)> FetchWarApiFallbackEntryAsync(HttpClient httpClient, string mapKey, long fetchedAt, JsonObject? publishedMap, JsonObject? previousEntry, CancellationToken cancellationToken)
    {
        var knownRegionId = TryGetFiniteNumber(publishedMap?["regionId"]) ?? TryGetFiniteNumber(previousEntry?["regionId"]);

        try
        {
            _logger.LogInformation("Fetching War API fallback for {MapKey}", mapKey);
            using var response = await httpClient.GetAsync($"{WarApiStaticEndpoint}/{Uri.EscapeDataString(mapKey)}/static", cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"HTTP {(int)response.StatusCode}");
            }

            var payload = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken)) as JsonObject;
            var labels = SanitizeWarApiLabels(payload?["mapTextItems"] as JsonArray);
            var previousLabels = previousEntry?["labels"]?["items"] as JsonArray;
            var effectiveLabels = labels.Count > 0 ? labels : CloneArray(previousLabels) ?? new JsonArray();

            var entry = new JsonObject();
            var regionId = TryGetFiniteNumber(payload?["regionId"]) ?? knownRegionId;
            var version = TryGetFiniteNumber(payload?["version"]) ?? TryGetFiniteNumber(previousEntry?["version"]);
            if (regionId != null)
            {
                entry["regionId"] = JsonValue.Create((int)regionId.Value);
            }
            if (version != null)
            {
                entry["version"] = JsonValue.Create((int)version.Value);
            }
            entry["fetchedAt"] = JsonValue.Create(fetchedAt);

            if (effectiveLabels.Count > 0)
            {
                entry["labels"] = new JsonObject
                {
                    ["version"] = JsonValue.Create((int)(TryGetFiniteNumber(payload?["version"]) ?? TryGetFiniteNumber(previousEntry?["labels"]?["version"]) ?? TryGetFiniteNumber(previousEntry?["version"]) ?? 0)),
                    ["items"] = effectiveLabels,
                };
            }

            _logger.LogInformation("Resolved War API fallback for {MapKey}: regionId={RegionId}, labels={LabelCount}", mapKey, entry["regionId"]?.GetValue<int?>(), effectiveLabels.Count);

            return (mapKey, entry);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Failed to fetch Foxhole map fallback for {MapKey}", mapKey);
            var fallbackEntry = CloneObject(previousEntry) ?? new JsonObject();
            if (knownRegionId != null)
            {
                fallbackEntry["regionId"] = JsonValue.Create((int)knownRegionId.Value);
            }
            return (mapKey, fallbackEntry);
        }
    }

    private static JsonArray SanitizeWarApiLabels(JsonArray? rawLabels)
    {
        var labels = new JsonArray();
        foreach (var rawLabel in rawLabels ?? [])
        {
            if (rawLabel is not JsonObject rawObject)
            {
                continue;
            }

            var text = rawObject["text"]?.GetValue<string>()?.Trim();
            var x = TryGetFiniteNumber(rawObject["x"]);
            var y = TryGetFiniteNumber(rawObject["y"]);
            if (string.IsNullOrWhiteSpace(text) || x == null || y == null)
            {
                continue;
            }

            var label = new JsonObject
            {
                ["text"] = text,
                ["x"] = JsonValue.Create(x.Value),
                ["y"] = JsonValue.Create(y.Value),
            };

            var mapMarkerType = rawObject["mapMarkerType"]?.GetValue<string>()?.Trim();
            if (!string.IsNullOrWhiteSpace(mapMarkerType))
            {
                label["mapMarkerType"] = mapMarkerType;
            }

            labels.Add(label);
        }

        return labels;
    }

    private static double? TryGetFiniteNumber(JsonNode? node)
    {
        if (node == null)
        {
            return null;
        }

        if (node is JsonValue value)
        {
            if (value.TryGetValue<double>(out var number) && !double.IsNaN(number) && !double.IsInfinity(number))
            {
                return number;
            }

            if (value.TryGetValue<int>(out var intNumber))
            {
                return intNumber;
            }

            if (value.TryGetValue<long>(out var longNumber))
            {
                return longNumber;
            }

            if (value.TryGetValue<decimal>(out var decimalNumber))
            {
                number = (double)decimalNumber;
                if (!double.IsNaN(number) && !double.IsInfinity(number))
                {
                    return number;
                }
            }

            var text = value.ToString();
            if (double.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out number)
                && !double.IsNaN(number)
                && !double.IsInfinity(number))
            {
                return number;
            }
        }

        return null;
    }

    private static JsonObject? CloneObject(JsonObject? value)
    {
        return value?.DeepClone() as JsonObject;
    }

    private static JsonArray? CloneArray(JsonArray? value)
    {
        return value?.DeepClone() as JsonArray;
    }

    private sealed class FoxWatchMapDatabaseEntry
    {
        public string Key { get; set; } = string.Empty;

        public JObject? Value { get; set; }
    }
}
