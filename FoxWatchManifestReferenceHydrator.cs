namespace FoxWatchService;

using System.Collections;
using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

public sealed class FoxWatchManifestReferenceHydrator
{
    private const string PublishedManifestRelativePath = "apps/foxhole-planner/public/foxhole/assets/manifest.v1.json";
    private static readonly IReadOnlySet<string> ReservedOverridePropertyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "copyFromStructureId",
        "nameLocalizedValues",
        "descriptionLocalizedValues",
        "categoryNameLocalizedValues",
        "modifications",
        "publishDestroyedVisuals",
    };
    private static readonly IReadOnlyDictionary<string, DestroyedStructureNameFormat> DestroyedStructureNameFormats = new Dictionary<string, DestroyedStructureNameFormat>(StringComparer.OrdinalIgnoreCase)
    {
        ["en"] = new("Destroyed ", string.Empty),
        ["de"] = new("Zerst\u00F6rtes ", string.Empty),
        ["fr"] = new(string.Empty, " d\u00E9truit"),
        ["pt"] = new(string.Empty, " destru\u00EDdo"),
        ["ru"] = new("\u0420\u0430\u0437\u0440\u0443\u0448\u0435\u043D\u043D\u044B\u0439 ", string.Empty),
        ["zh"] = new("\u88AB\u6467\u6BC1\u7684", string.Empty),
    };
    private static readonly IReadOnlyDictionary<string, DestroyedStructureNameFormat> BreachedStructureNameFormats = new Dictionary<string, DestroyedStructureNameFormat>(StringComparer.OrdinalIgnoreCase)
    {
        ["en"] = new("Breached ", string.Empty),
        ["de"] = new("Durchbrochener ", string.Empty),
        ["fr"] = new(string.Empty, " en br\u00E8che"),
        ["pt"] = new(string.Empty, " rompido"),
        ["ru"] = new("\u041F\u0440\u043E\u043B\u043E\u043C\u043B\u0435\u043D\u043D\u044B\u0439 ", string.Empty),
        ["zh"] = new("\u88AB\u7A81\u7834\u7684", string.Empty),
    };
    private static readonly JsonSerializerOptions DeserializeOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };
    private static readonly ConcurrentDictionary<Type, IReadOnlyDictionary<string, PropertyInfo>> WritablePropertyMapCache = new();

    private readonly FoxWatchAssetManifestOverrideLoader _assetManifestOverrideLoader;
    private readonly ILogger<FoxWatchManifestReferenceHydrator> _logger;

    public FoxWatchManifestReferenceHydrator(
        FoxWatchAssetManifestOverrideLoader assetManifestOverrideLoader,
        ILogger<FoxWatchManifestReferenceHydrator> logger)
    {
        _assetManifestOverrideLoader = assetManifestOverrideLoader;
        _logger = logger;
    }

    public FoxWatchManifest Hydrate(FoxWatchManifest manifest)
    {
        var importedCategories = ReadImportedCategoryCatalog();
        if (importedCategories.Count == 0)
        {
            var fallbackOverrideCount = ApplyStructureManifestOverrides(manifest, manifest.Assets);
            var fallbackSharedModificationOverrideCount = ApplySharedModificationManifestOverrides(manifest);
            var fallbackInjectedStructureCount = InjectSyntheticStructureOverrides(manifest);
            var fallbackInheritedCategoryCount = ApplyDestroyedStructureCategoryInheritance(manifest.Assets);
            var fallbackInheritedIconCount = ApplyDestroyedStructureDefaultIconInheritance(manifest.Assets);
            ApplyDestroyedStructureTextInheritance(manifest);
            var fallbackExcludedStructureCount = ApplyExcludedStructureFilter(manifest);
            ApplyDerivedStructureDefaults(manifest.Assets);
            ApplyUpgradePreviewDirectionFallbacks(manifest.Assets);
            EnsureStructureVisualPlaceholders(manifest.Assets);
            ApplyUpgradeVariantStructureVisualInheritance(manifest.Assets);
            fallbackExcludedStructureCount += ApplyExcludedStructureFilter(manifest);
            SynchronizeEnglishCategoryLocalizations(manifest);
            LogRemovedDanglingStructureReferences(RemoveDanglingStructureReferences(manifest.Assets));
            _logger.LogInformation("Skipping manifest hydration because the imported category catalog is unavailable; applied {AppliedStructureOverrideCount} structure manifest overrides, {AppliedSharedModificationOverrideCount} shared modification overrides, injected {InjectedStructureCount} synthetic structures, inherited {InheritedStructureCategoryCount} destroyed structure categories, inherited {InheritedStructureIconCount} destroyed structure default icons, and excluded {ExcludedStructureCount} structures", fallbackOverrideCount, fallbackSharedModificationOverrideCount, fallbackInjectedStructureCount, fallbackInheritedCategoryCount, fallbackInheritedIconCount, fallbackExcludedStructureCount);
            return manifest;
        }

        var appliedStructureOverrideCount = ApplyStructureManifestOverrides(manifest, manifest.Assets);
        var appliedSharedModificationOverrideCount = ApplySharedModificationManifestOverrides(manifest);
        var injectedStructureCount = InjectSyntheticStructureOverrides(manifest);
        var inheritedCategoryCount = ApplyDestroyedStructureCategoryInheritance(manifest.Assets);
        var inheritedIconCount = ApplyDestroyedStructureDefaultIconInheritance(manifest.Assets);
        ApplyDestroyedStructureTextInheritance(manifest);
        var excludedStructureCount = ApplyExcludedStructureFilter(manifest);
        var hydratedCategoryCount = HydrateCategories(manifest, importedCategories);
        ApplyDerivedStructureDefaults(manifest.Assets);
        ApplyUpgradePreviewDirectionFallbacks(manifest.Assets);
        EnsureStructureVisualPlaceholders(manifest.Assets);
        ApplyUpgradeVariantStructureVisualInheritance(manifest.Assets);
        ApplyPublishedUpgradeStructureFallbacks(manifest.Assets, ReadPublishedParentFallbacks());
        excludedStructureCount += ApplyExcludedStructureFilter(manifest);
        SynchronizeEnglishCategoryLocalizations(manifest);
        LogRemovedDanglingStructureReferences(RemoveDanglingStructureReferences(manifest.Assets));

        _logger.LogInformation("Hydrated {HydratedCategoryCount} categories from the imported category catalog, applied {AppliedStructureOverrideCount} structure manifest overrides, {AppliedSharedModificationOverrideCount} shared modification overrides, injected {InjectedStructureCount} synthetic structures, inherited {InheritedStructureCategoryCount} destroyed structure categories, inherited {InheritedStructureIconCount} destroyed structure default icons, and excluded {ExcludedStructureCount} structures", hydratedCategoryCount, appliedStructureOverrideCount, appliedSharedModificationOverrideCount, injectedStructureCount, inheritedCategoryCount, inheritedIconCount, excludedStructureCount);
        return manifest;
    }

    private void LogRemovedDanglingStructureReferences(int removedReferenceCount)
    {
        if (removedReferenceCount <= 0)
        {
            return;
        }

        _logger.LogWarning("Removed {RemovedReferenceCount} dangling structure reference(s) that pointed to missing assets while hydrating the FoxWatch manifest", removedReferenceCount);
    }

    private static int ApplyDestroyedStructureCategoryInheritance(IReadOnlyList<FoxWatchManifestStructure> structures)
    {
        var structuresByCodeName = structures
            .Where(structure => !string.IsNullOrWhiteSpace(structure.CodeName))
            .GroupBy(structure => structure.CodeName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var structuresByDestroyedCodeName = structures
            .Where(structure => !string.IsNullOrWhiteSpace(structure.DestroyedStructureCodeName))
            .GroupBy(structure => structure.DestroyedStructureCodeName!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var publishedParentFallbacks = ReadPublishedParentFallbacks();

        var inheritedCount = 0;
        foreach (var structure in structures)
        {
            if (structure.IsDestroyed != true ||
                !string.Equals(structure.CategoryId, "new", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!TryResolveDestroyedStructureParent(
                    structure,
                    structuresByCodeName,
                    structuresByDestroyedCodeName,
                    publishedParentFallbacks,
                    out var localParentStructure,
                    out var publishedParentFallback))
            {
                continue;
            }

            if (localParentStructure != null)
            {
                structure.CategoryId = localParentStructure.CategoryId;
                structure.CategoryName = new FoxWatchLocalizedText
                {
                    Id = localParentStructure.CategoryName.Id,
                    Fallback = localParentStructure.CategoryName.Fallback,
                };
                structure.CategoryIconUrl = localParentStructure.CategoryIconUrl;
                structure.BuildOrder = localParentStructure.BuildOrder;
                inheritedCount += 1;
                continue;
            }

            structure.CategoryId = publishedParentFallback!.CategoryId;
            structure.BuildOrder = publishedParentFallback.BuildOrder;
            inheritedCount += 1;
        }

        return inheritedCount;
    }

    private static int ApplyDestroyedStructureDefaultIconInheritance(IReadOnlyList<FoxWatchManifestStructure> structures)
    {
        var structuresByCodeName = structures
            .Where(structure => !string.IsNullOrWhiteSpace(structure.CodeName))
            .GroupBy(structure => structure.CodeName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var structuresByDestroyedCodeName = structures
            .Where(structure => !string.IsNullOrWhiteSpace(structure.DestroyedStructureCodeName))
            .GroupBy(structure => structure.DestroyedStructureCodeName!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var publishedParentFallbacks = ReadPublishedParentFallbacks();

        var inheritedCount = 0;
        foreach (var structure in structures)
        {
            if (structure.IsDestroyed != true)
            {
                continue;
            }

            if (!TryResolveLocalDestroyedStructureParent(
                    structure,
                    structuresByCodeName,
                    structuresByDestroyedCodeName,
                    out var localParentStructure))
            {
                localParentStructure = null;
            }

            var inheritedIconUrl = localParentStructure?.IconUrl;
            if (string.IsNullOrWhiteSpace(inheritedIconUrl) &&
                TryResolvePublishedDestroyedStructureParent(structure, publishedParentFallbacks, out var publishedParentFallback))
            {
                inheritedIconUrl = publishedParentFallback?.DefaultIconUrl;
            }

            if (string.IsNullOrWhiteSpace(inheritedIconUrl) ||
                string.Equals(structure.IconUrl, inheritedIconUrl, StringComparison.Ordinal))
            {
                continue;
            }

            structure.IconUrl = inheritedIconUrl;
            inheritedCount += 1;
        }

        return inheritedCount;
    }

    private static void ApplyDestroyedStructureTextInheritance(FoxWatchManifest manifest)
    {
        var structuresByCodeName = manifest.Assets
            .Where(structure => !string.IsNullOrWhiteSpace(structure.CodeName))
            .GroupBy(structure => structure.CodeName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var structuresByDestroyedCodeName = manifest.Assets
            .Where(structure => !string.IsNullOrWhiteSpace(structure.DestroyedStructureCodeName))
            .GroupBy(structure => structure.DestroyedStructureCodeName!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var publishedParentFallbacks = ReadPublishedParentFallbacks();

        foreach (var structure in manifest.Assets)
        {
            if (structure.IsDestroyed != true)
            {
                continue;
            }

            TryResolveLocalDestroyedStructureParent(
                structure,
                structuresByCodeName,
                structuresByDestroyedCodeName,
                out var localParentStructure);
            TryResolvePublishedDestroyedStructureParent(structure, publishedParentFallbacks, out var publishedParentFallback);

            ApplyDestroyedStructureNameInheritance(manifest, structure, localParentStructure, publishedParentFallback, publishedParentFallbacks.LocalizationsByLocale);
            ApplyDestroyedStructureDescriptionInheritance(manifest, structure, localParentStructure, publishedParentFallback, publishedParentFallbacks.LocalizationsByLocale);
        }
    }

    private static void ApplyDestroyedStructureNameInheritance(
        FoxWatchManifest manifest,
        FoxWatchManifestStructure structure,
        FoxWatchManifestStructure? localParentStructure,
        PublishedParentFallback? publishedParentFallback,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> publishedLocalizationsByLocale)
    {
        var localizedParentNames = localParentStructure != null
            ? ResolveManifestLocalizedTextValues(manifest, localParentStructure.Name)
            : ResolvePublishedLocalizedTextValues(publishedLocalizationsByLocale, publishedParentFallback?.NameLocalizationId);
        if (localizedParentNames.Count == 0)
        {
            return;
        }

        var fallbackName = localizedParentNames.GetValueOrDefault("en") ?? localizedParentNames.Values.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(fallbackName))
        {
            return;
        }

        if (!ShouldInheritDestroyedStructureName(structure, fallbackName))
        {
            return;
        }

        structure.Name.Fallback = FormatStateStructureName("en", fallbackName, structure.IsBreached == true);
        if (string.IsNullOrWhiteSpace(structure.Name.Id))
        {
            return;
        }

        var isBunkerStructure = structure.IsBunker == true
            || string.Equals(structure.CategoryId, "bunker", StringComparison.OrdinalIgnoreCase);
        if (isBunkerStructure)
        {
            foreach (var bundle in manifest.Localizations)
            {
                if (string.IsNullOrWhiteSpace(bundle.Locale) ||
                    bundle.Strings == null ||
                    localizedParentNames.ContainsKey(bundle.Locale))
                {
                    continue;
                }

                bundle.Strings.Remove(structure.Name.Id);
            }
        }

        foreach (var localizedParentName in localizedParentNames)
        {
            if (string.IsNullOrWhiteSpace(localizedParentName.Value))
            {
                continue;
            }

            SetLocalizedTextValue(
                manifest,
                localizedParentName.Key,
                structure.Name.Id,
                FormatStateStructureName(localizedParentName.Key, localizedParentName.Value, structure.IsBreached == true));
        }
    }

    private static void ApplyDestroyedStructureDescriptionInheritance(
        FoxWatchManifest manifest,
        FoxWatchManifestStructure structure,
        FoxWatchManifestStructure? localParentStructure,
        PublishedParentFallback? publishedParentFallback,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> publishedLocalizationsByLocale)
    {
        if (!ShouldInheritDestroyedStructureDescription(manifest, structure))
        {
            return;
        }

        var localizedParentDescriptions = localParentStructure != null
            ? ResolveManifestLocalizedTextValues(manifest, localParentStructure.Description)
            : ResolvePublishedLocalizedTextValues(publishedLocalizationsByLocale, publishedParentFallback?.DescriptionLocalizationId);
        if (localizedParentDescriptions.Count == 0)
        {
            return;
        }

        var fallbackDescription = localizedParentDescriptions.GetValueOrDefault("en") ?? localizedParentDescriptions.Values.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(fallbackDescription))
        {
            return;
        }

        structure.Description.Fallback = fallbackDescription;
        if (string.IsNullOrWhiteSpace(structure.Description.Id))
        {
            return;
        }

        foreach (var localizedParentDescription in localizedParentDescriptions)
        {
            if (string.IsNullOrWhiteSpace(localizedParentDescription.Value))
            {
                continue;
            }

            SetLocalizedTextValue(
                manifest,
                localizedParentDescription.Key,
                structure.Description.Id,
                localizedParentDescription.Value);
        }
    }

    private static bool ShouldInheritDestroyedStructureName(FoxWatchManifestStructure structure, string? parentName)
    {
        var isBunkerStructure = structure.IsBunker == true
            || string.Equals(structure.CategoryId, "bunker", StringComparison.OrdinalIgnoreCase);

        if (isBunkerStructure &&
            !string.IsNullOrWhiteSpace(parentName) &&
            !MatchesComparableText(structure.Name.Fallback, FormatStateStructureName("en", parentName, structure.IsBreached == true)))
        {
            return true;
        }

        return MatchesStructureIdentifier(structure.Name.Fallback, structure.CodeName)
            || MatchesStructureIdentifier(structure.Name.Fallback, structure.Id)
            || MatchesComparableText(structure.Name.Fallback, parentName)
            || string.IsNullOrWhiteSpace(structure.Name.Fallback);
    }

    private static bool ShouldInheritDestroyedStructureDescription(FoxWatchManifest manifest, FoxWatchManifestStructure structure)
    {
        if (!string.IsNullOrWhiteSpace(structure.Description.Fallback))
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(structure.Description.Id))
        {
            return true;
        }

        return !manifest.Localizations.Any(bundle =>
            bundle.Strings.TryGetValue(structure.Description.Id, out var localizedValue)
            && !string.IsNullOrWhiteSpace(localizedValue));
    }

    private static bool MatchesStructureIdentifier(string? value, string? identifier)
    {
        if (string.IsNullOrWhiteSpace(value) || string.IsNullOrWhiteSpace(identifier))
        {
            return false;
        }

        return string.Equals(
            NormalizeComparableText(value),
            NormalizeComparableText(identifier),
            StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeComparableText(string? value)
    {
        return string.Concat((value ?? string.Empty).Where(char.IsLetterOrDigit));
    }

    private static bool MatchesComparableText(string? left, string? right)
    {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
        {
            return false;
        }

        return string.Equals(
            NormalizeComparableText(left),
            NormalizeComparableText(right),
            StringComparison.OrdinalIgnoreCase);
    }

    private static IReadOnlyDictionary<string, string> ResolveManifestLocalizedTextValues(FoxWatchManifest manifest, FoxWatchLocalizedText? text)
    {
        var localizedValues = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (text == null)
        {
            return localizedValues;
        }

        if (!string.IsNullOrWhiteSpace(text.Fallback))
        {
            localizedValues["en"] = text.Fallback;
        }

        if (string.IsNullOrWhiteSpace(text.Id))
        {
            return localizedValues;
        }

        foreach (var bundle in manifest.Localizations)
        {
            if (string.IsNullOrWhiteSpace(bundle.Locale) ||
                bundle.Strings == null ||
                !bundle.Strings.TryGetValue(text.Id, out var localizedValue) ||
                string.IsNullOrWhiteSpace(localizedValue))
            {
                continue;
            }

            localizedValues[bundle.Locale] = localizedValue;
        }

        return localizedValues;
    }

    private static IReadOnlyDictionary<string, string> ResolvePublishedLocalizedTextValues(
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> publishedLocalizationsByLocale,
        string? localizationId)
    {
        var localizedValues = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(localizationId))
        {
            return localizedValues;
        }

        foreach (var localizationBundle in publishedLocalizationsByLocale)
        {
            if (!localizationBundle.Value.TryGetValue(localizationId, out var localizedValue) ||
                string.IsNullOrWhiteSpace(localizedValue))
            {
                continue;
            }

            localizedValues[localizationBundle.Key] = localizedValue;
        }

        return localizedValues;
    }

    private static void SetLocalizedTextValue(FoxWatchManifest manifest, string locale, string localizationId, string value)
    {
        if (string.IsNullOrWhiteSpace(locale) ||
            string.IsNullOrWhiteSpace(localizationId) ||
            string.IsNullOrWhiteSpace(value))
        {
            return;
        }

        var bundle = manifest.Localizations.FirstOrDefault(existing => string.Equals(existing.Locale, locale, StringComparison.OrdinalIgnoreCase));
        if (bundle == null)
        {
            bundle = new FoxWatchLocalizationBundle
            {
                Locale = locale,
                Strings = new Dictionary<string, string>(StringComparer.Ordinal),
            };
            manifest.Localizations.Add(bundle);
        }

        bundle.Strings[localizationId] = value;
    }

    private static string FormatDestroyedStructureName(string locale, string baseName)
    {
        if (string.IsNullOrWhiteSpace(baseName))
        {
            return baseName;
        }

        var format = DestroyedStructureNameFormats.GetValueOrDefault(locale)
            ?? DestroyedStructureNameFormats["en"];
        return string.Concat(format.Prefix, baseName, format.Suffix).Trim();
    }

    private static string FormatBreachedStructureName(string locale, string baseName)
    {
        if (string.IsNullOrWhiteSpace(baseName))
        {
            return baseName;
        }

        var format = BreachedStructureNameFormats.GetValueOrDefault(locale)
            ?? BreachedStructureNameFormats["en"];
        return string.Concat(format.Prefix, baseName, format.Suffix).Trim();
    }

    private static string FormatStateStructureName(string locale, string baseName, bool isBreached)
    {
        return isBreached
            ? FormatBreachedStructureName(locale, baseName)
            : FormatDestroyedStructureName(locale, baseName);
    }

    private static IEnumerable<string> EnumerateDestroyedStructureParentCodeNameCandidates(FoxWatchManifestStructure structure)
    {
        var seenCandidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        static void AddCandidate(HashSet<string> seenCandidates, string? value)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                seenCandidates.Add(value.Trim());
            }
        }

        static string? RemoveAffix(string? value, string affix, bool removePrefix)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }

            var trimmedValue = value.Trim();
            if (removePrefix)
            {
                return trimmedValue.StartsWith(affix, StringComparison.OrdinalIgnoreCase)
                    ? trimmedValue[affix.Length..].Trim()
                    : null;
            }

            return trimmedValue.EndsWith(affix, StringComparison.OrdinalIgnoreCase)
                ? trimmedValue[..^affix.Length].Trim()
                : null;
        }

        AddCandidate(seenCandidates, RemoveAffix(structure.CodeName, "Destroyed", removePrefix: true));
        AddCandidate(seenCandidates, RemoveAffix(structure.CodeName, "Destroyed", removePrefix: false));

        foreach (var candidate in seenCandidates)
        {
            yield return candidate;
        }
    }

    private static bool TryResolveLocalDestroyedStructureParent(
        FoxWatchManifestStructure structure,
        IReadOnlyDictionary<string, FoxWatchManifestStructure> structuresByCodeName,
        IReadOnlyDictionary<string, FoxWatchManifestStructure> structuresByDestroyedCodeName,
        out FoxWatchManifestStructure? localParentStructure)
    {
        localParentStructure = null;

        var upgradeStructureCodeName = structure.UpgradeStructureCodeName;
        if (!string.IsNullOrWhiteSpace(upgradeStructureCodeName) &&
            structuresByCodeName.TryGetValue(upgradeStructureCodeName, out var directParentStructure) &&
            !ReferenceEquals(directParentStructure, structure))
        {
            localParentStructure = directParentStructure;
            return true;
        }

        if (!string.IsNullOrWhiteSpace(structure.CodeName) &&
            structuresByDestroyedCodeName.TryGetValue(structure.CodeName, out var reverseParentStructure) &&
            !ReferenceEquals(reverseParentStructure, structure))
        {
            localParentStructure = reverseParentStructure;
            return true;
        }

        foreach (var candidateCodeName in EnumerateDestroyedStructureParentCodeNameCandidates(structure))
        {
            if (structuresByCodeName.TryGetValue(candidateCodeName, out var heuristicParentStructure) &&
                !ReferenceEquals(heuristicParentStructure, structure))
            {
                localParentStructure = heuristicParentStructure;
                return true;
            }
        }

        return false;
    }

    private static bool TryResolvePublishedDestroyedStructureParent(
        FoxWatchManifestStructure structure,
        PublishedParentFallbacks publishedParentFallbacks,
        out PublishedParentFallback? publishedParentFallback)
    {
        publishedParentFallback = null;

        var upgradeStructureCodeName = structure.UpgradeStructureCodeName;
        if (!string.IsNullOrWhiteSpace(upgradeStructureCodeName) &&
            publishedParentFallbacks.ByCodeName.TryGetValue(upgradeStructureCodeName, out var directPublishedParent))
        {
            publishedParentFallback = directPublishedParent;
            return true;
        }

        if (!string.IsNullOrWhiteSpace(structure.CodeName) &&
            publishedParentFallbacks.ByDestroyedCodeName.TryGetValue(structure.CodeName, out var reversePublishedParent))
        {
            publishedParentFallback = reversePublishedParent;
            return true;
        }

        foreach (var candidateCodeName in EnumerateDestroyedStructureParentCodeNameCandidates(structure))
        {
            if (publishedParentFallbacks.ByCodeName.TryGetValue(candidateCodeName, out var heuristicPublishedParent))
            {
                publishedParentFallback = heuristicPublishedParent;
                return true;
            }
        }

        return false;
    }

    private static bool TryResolveDestroyedStructureParent(
        FoxWatchManifestStructure structure,
        IReadOnlyDictionary<string, FoxWatchManifestStructure> structuresByCodeName,
        IReadOnlyDictionary<string, FoxWatchManifestStructure> structuresByDestroyedCodeName,
        PublishedParentFallbacks publishedParentFallbacks,
        out FoxWatchManifestStructure? localParentStructure,
        out PublishedParentFallback? publishedParentFallback)
    {
        localParentStructure = null;
        publishedParentFallback = null;

        var upgradeStructureCodeName = structure.UpgradeStructureCodeName;
        if (TryResolveLocalDestroyedStructureParent(
                structure,
                structuresByCodeName,
                structuresByDestroyedCodeName,
                out var candidateParentStructure) &&
            candidateParentStructure != null &&
            !string.Equals(candidateParentStructure.CategoryId, "new", StringComparison.OrdinalIgnoreCase))
        {
            localParentStructure = candidateParentStructure;
            return true;
        }

        if (TryResolvePublishedDestroyedStructureParent(structure, publishedParentFallbacks, out var candidatePublishedParent) &&
            candidatePublishedParent != null &&
            !string.Equals(candidatePublishedParent.CategoryId, "new", StringComparison.OrdinalIgnoreCase))
        {
            publishedParentFallback = candidatePublishedParent;
            return true;
        }

        if (!string.IsNullOrWhiteSpace(upgradeStructureCodeName) &&
            publishedParentFallbacks.ByCodeName.TryGetValue(upgradeStructureCodeName, out var directPublishedParent) &&
                !string.Equals(directPublishedParent.CategoryId, "new", StringComparison.OrdinalIgnoreCase))
        {
            publishedParentFallback = directPublishedParent;
            return true;
        }

        if (!string.IsNullOrWhiteSpace(structure.CodeName))
        {
            if (publishedParentFallbacks.ByDestroyedCodeName.TryGetValue(structure.CodeName, out var reversePublishedParent) &&
                !string.Equals(reversePublishedParent.CategoryId, "new", StringComparison.OrdinalIgnoreCase))
            {
                publishedParentFallback = reversePublishedParent;
                return true;
            }
        }

        return false;
    }

    private static PublishedParentFallbacks ReadPublishedParentFallbacks()
    {
        var publishedManifestPath = FoxWatchWorkspace.ResolvePath(PublishedManifestRelativePath);
        if (string.IsNullOrWhiteSpace(publishedManifestPath) || !File.Exists(publishedManifestPath))
        {
            return PublishedParentFallbacks.Empty();
        }

        try
        {
            var json = File.ReadAllText(publishedManifestPath);
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty("assets", out var assetsElement) ||
                assetsElement.ValueKind != JsonValueKind.Array)
            {
                return PublishedParentFallbacks.Empty();
            }

            var manifestDirectory = Path.GetDirectoryName(publishedManifestPath) ?? string.Empty;
            var publishedLocalizationsByLocale = ReadPublishedLocalizationLookup(document.RootElement, manifestDirectory);
            var publishedParentsByCodeName = new Dictionary<string, PublishedParentFallback>(StringComparer.OrdinalIgnoreCase);
            var publishedParentsByDestroyedCodeName = new Dictionary<string, PublishedParentFallback>(StringComparer.OrdinalIgnoreCase);
            foreach (var assetElement in assetsElement.EnumerateArray())
            {
                if (!TryReadStringProperty(assetElement, "id", out var structureId) ||
                    string.IsNullOrWhiteSpace(structureId) ||
                    !TryReadStringProperty(assetElement, "codeName", out var codeName) ||
                    string.IsNullOrWhiteSpace(codeName) ||
                    !TryReadStringProperty(assetElement, "categoryId", out var categoryId) ||
                    string.IsNullOrWhiteSpace(categoryId))
                {
                    continue;
                }

                var buildOrder = TryReadIntProperty(assetElement, "buildOrder", out var parsedBuildOrder)
                    ? parsedBuildOrder
                    : 0;
                var defaultIconUrl = TryReadNestedStringProperty(assetElement, "icons", "default", out var publishedDefaultIconUrl)
                    ? publishedDefaultIconUrl
                    : (TryReadStringProperty(assetElement, "iconUrl", out var legacyIconUrl) ? legacyIconUrl : null);
                defaultIconUrl = ResolvePublishedStructureDefaultIconUrl(structureId, defaultIconUrl);
                var nameLocalizationId = TryReadStringProperty(assetElement, "name", out var publishedNameLocalizationId)
                    ? publishedNameLocalizationId
                    : null;
                var descriptionLocalizationId = TryReadStringProperty(assetElement, "description", out var publishedDescriptionLocalizationId)
                    ? publishedDescriptionLocalizationId
                    : null;
                var upgradeStructureCodeName = TryReadStringProperty(assetElement, "upgradeStructureCodeName", out var publishedUpgradeStructureCodeName)
                    ? publishedUpgradeStructureCodeName
                    : null;
                var fallback = new PublishedParentFallback(structureId, categoryId, buildOrder, defaultIconUrl, nameLocalizationId, descriptionLocalizationId, upgradeStructureCodeName);
                publishedParentsByCodeName[codeName] = fallback;

                if (TryReadStringProperty(assetElement, "destroyedStructureCodeName", out var destroyedStructureCodeName) &&
                    !string.IsNullOrWhiteSpace(destroyedStructureCodeName))
                {
                    publishedParentsByDestroyedCodeName[destroyedStructureCodeName] = fallback;
                }
            }

            return new PublishedParentFallbacks(publishedParentsByCodeName, publishedParentsByDestroyedCodeName, publishedLocalizationsByLocale);
        }
        catch
        {
            return PublishedParentFallbacks.Empty();
        }
    }

    private sealed record PublishedParentFallbacks(
        IReadOnlyDictionary<string, PublishedParentFallback> ByCodeName,
        IReadOnlyDictionary<string, PublishedParentFallback> ByDestroyedCodeName,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> LocalizationsByLocale)
    {
        public static PublishedParentFallbacks Empty()
        {
            var empty = new Dictionary<string, PublishedParentFallback>(StringComparer.OrdinalIgnoreCase);
            var emptyLocalizations = new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
            return new PublishedParentFallbacks(empty, empty, emptyLocalizations);
        }
    }

    private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> ReadPublishedLocalizationLookup(JsonElement manifestRoot, string manifestDirectory)
    {
        var localizationsByLocale = new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.OrdinalIgnoreCase);

        if (manifestRoot.TryGetProperty("localizations", out var localizationsElement) &&
            localizationsElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var localizationElement in localizationsElement.EnumerateArray())
            {
                if (!TryReadStringProperty(localizationElement, "locale", out var locale) ||
                    string.IsNullOrWhiteSpace(locale) ||
                    !localizationElement.TryGetProperty("strings", out var stringsElement) ||
                    stringsElement.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                localizationsByLocale[locale] = ReadJsonStringMap(stringsElement);
            }
        }

        if (manifestRoot.TryGetProperty("localizationIndex", out var localizationIndexElement) &&
            localizationIndexElement.TryGetProperty("files", out var localizationFilesElement) &&
            localizationFilesElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var localizationFile in localizationFilesElement.EnumerateObject())
            {
                if (localizationFile.Value.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                var relativeFilePath = localizationFile.Value.GetString();
                if (string.IsNullOrWhiteSpace(relativeFilePath))
                {
                    continue;
                }

                var localizationFilePath = Path.GetFullPath(Path.Combine(
                    manifestDirectory,
                    relativeFilePath.Replace('/', Path.DirectorySeparatorChar)));
                if (!File.Exists(localizationFilePath))
                {
                    continue;
                }

                try
                {
                    var localizationJson = File.ReadAllText(localizationFilePath);
                    using var localizationDocument = JsonDocument.Parse(localizationJson);
                    if (localizationDocument.RootElement.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    localizationsByLocale[localizationFile.Name] = ReadJsonStringMap(localizationDocument.RootElement);
                }
                catch
                {
                }
            }
        }

        return localizationsByLocale;
    }

    private static void ApplyPublishedUpgradeStructureFallbacks(
        IReadOnlyList<FoxWatchManifestStructure> structures,
        PublishedParentFallbacks publishedParentFallbacks)
    {
        foreach (var structure in structures)
        {
            if (!string.IsNullOrWhiteSpace(structure.UpgradeStructureCodeName) ||
                string.IsNullOrWhiteSpace(structure.CodeName) ||
                !publishedParentFallbacks.ByCodeName.TryGetValue(structure.CodeName, out var publishedFallback) ||
                string.IsNullOrWhiteSpace(publishedFallback.UpgradeStructureCodeName))
            {
                continue;
            }

            structure.UpgradeStructureCodeName = publishedFallback.UpgradeStructureCodeName;
        }
    }

    private static string? ResolvePublishedStructureDefaultIconUrl(string structureId, string? explicitIconUrl)
    {
        if (!string.IsNullOrWhiteSpace(explicitIconUrl) || string.IsNullOrWhiteSpace(structureId))
        {
            return explicitIconUrl;
        }

        var relativeIconPath = Path.Combine(
            "apps",
            "foxhole-planner",
            "public",
            "foxhole",
            "assets",
            "types",
            "structures",
            structureId,
            $"{structureId}.icon.default.webp");
        var absoluteIconPath = FoxWatchWorkspace.ResolvePath(relativeIconPath);
        if (string.IsNullOrWhiteSpace(absoluteIconPath) || !File.Exists(absoluteIconPath))
        {
            return null;
        }

        return $"/foxhole/assets/types/structures/{structureId}/{structureId}.icon.default.webp";
    }

    private static IReadOnlyDictionary<string, string> ReadJsonStringMap(JsonElement element)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        if (element.ValueKind != JsonValueKind.Object)
        {
            return values;
        }

        foreach (var property in element.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            values[property.Name] = property.Value.GetString() ?? string.Empty;
        }

        return values;
    }

    private static bool TryReadStringProperty(JsonElement element, string propertyName, out string value)
    {
        value = string.Empty;
        if (!element.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        value = property.GetString() ?? string.Empty;
        return true;
    }

    private static bool TryReadNestedStringProperty(JsonElement element, string objectPropertyName, string nestedPropertyName, out string value)
    {
        value = string.Empty;
        if (!element.TryGetProperty(objectPropertyName, out var objectProperty) || objectProperty.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        return TryReadStringProperty(objectProperty, nestedPropertyName, out value);
    }

    private static bool TryReadIntProperty(JsonElement element, string propertyName, out int value)
    {
        value = 0;
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return false;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out value))
        {
            return true;
        }

        if (property.ValueKind == JsonValueKind.String)
        {
            return int.TryParse(property.GetString(), out value);
        }

        return false;
    }

    private sealed record PublishedParentFallback(
        string StructureId,
        string CategoryId,
        int BuildOrder,
        string? DefaultIconUrl,
        string? NameLocalizationId,
        string? DescriptionLocalizationId,
        string? UpgradeStructureCodeName);

    private sealed record DestroyedStructureNameFormat(string Prefix, string Suffix);

    private static int ApplyExcludedStructureFilter(FoxWatchManifest manifest)
    {
        var excludedStructureIds = manifest.Assets
            .Where(structure => structure.Exclude)
            .Select(structure => structure.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (excludedStructureIds.Count == 0)
        {
            return 0;
        }

        manifest.Assets = manifest.Assets
            .Where(structure => !excludedStructureIds.Contains(structure.Id))
            .ToList();

        return excludedStructureIds.Count;
    }

    private static void SynchronizeEnglishCategoryLocalizations(FoxWatchManifest manifest)
    {
        var englishBundle = manifest.Localizations.FirstOrDefault(bundle => string.Equals(bundle.Locale, "en", StringComparison.OrdinalIgnoreCase));
        if (englishBundle == null)
        {
            englishBundle = new FoxWatchLocalizationBundle
            {
                Locale = "en",
                Strings = new Dictionary<string, string>(StringComparer.Ordinal),
            };
            manifest.Localizations.Add(englishBundle);
        }

        foreach (var category in manifest.Categories)
        {
            if (string.IsNullOrWhiteSpace(category.Name.Id))
            {
                continue;
            }

            englishBundle.Strings[category.Name.Id] = category.Name.Fallback;
        }
    }

    private static void ApplyUpgradePreviewDirectionFallbacks(IReadOnlyList<FoxWatchManifestStructure> structures)
    {
        var structuresById = structures.ToDictionary(structure => structure.Id, StringComparer.OrdinalIgnoreCase);

        foreach (var structure in structures)
        {
            if (!structure.IsUpgrade)
            {
                continue;
            }

            var inheritedPreviewDirection = ResolveInheritedPreviewDirection(structure, structuresById);
            if (!string.IsNullOrWhiteSpace(inheritedPreviewDirection))
            {
                structure.PreviewDirection = inheritedPreviewDirection;
            }
        }
    }

    private static string? ResolveInheritedPreviewDirection(
        FoxWatchManifestStructure structure,
        IReadOnlyDictionary<string, FoxWatchManifestStructure> structuresById)
    {
        var parentStructureId = structure.ParentStructureId;
        if (string.IsNullOrWhiteSpace(parentStructureId))
        {
            return null;
        }

        var visitedStructureIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            structure.Id,
        };

        while (!string.IsNullOrWhiteSpace(parentStructureId) && visitedStructureIds.Add(parentStructureId))
        {
            if (!structuresById.TryGetValue(parentStructureId, out var parentStructure))
            {
                return null;
            }

            if (!string.IsNullOrWhiteSpace(parentStructure.PreviewDirection))
            {
                return parentStructure.PreviewDirection.Trim().ToLowerInvariant();
            }

            parentStructureId = parentStructure.ParentStructureId;
        }

        return null;
    }


    private static bool ImportedCategoryMatchesCanonicalIds(
        FoxWatchImportedCategoryDefinition category,
        IReadOnlySet<string> canonicalCategoryIds)
    {
        var normalizedId = FoxWatchManifestCategoryNormalizer.NormalizeKey(category.Id);
        if (!string.IsNullOrWhiteSpace(normalizedId) && canonicalCategoryIds.Contains(normalizedId))
        {
            return true;
        }

        var normalizedLegacyId = FoxWatchManifestCategoryNormalizer.NormalizeKey(category.LegacyId);
        return !string.IsNullOrWhiteSpace(normalizedLegacyId) && canonicalCategoryIds.Contains(normalizedLegacyId);
    }

    private static bool ImportedCategoryCoversExtractedCategoryId(
        FoxWatchImportedCategoryDefinition category,
        string normalizedExtractedCategoryId)
    {
        if (string.IsNullOrWhiteSpace(normalizedExtractedCategoryId))
        {
            return false;
        }

        return string.Equals(
                FoxWatchManifestCategoryNormalizer.NormalizeKey(category.Id),
                normalizedExtractedCategoryId,
                StringComparison.Ordinal)
            || string.Equals(
                FoxWatchManifestCategoryNormalizer.NormalizeKey(category.LegacyId),
                normalizedExtractedCategoryId,
                StringComparison.Ordinal);
    }

    private int HydrateCategories(FoxWatchManifest manifest, IReadOnlyDictionary<string, FoxWatchImportedCategoryDefinition> importedCategoriesById)
    {
        if (importedCategoriesById.Count == 0)
        {
            return 0;
        }

        foreach (var structure in manifest.Assets)
        {
            if (!importedCategoriesById.TryGetValue(FoxWatchManifestCategoryNormalizer.NormalizeKey(structure.CategoryId), out var importedCategory))
            {
                continue;
            }

            structure.CategoryId = importedCategory.Id;
            structure.CategoryName = new FoxWatchLocalizedText
            {
                Id = $"foxhole:category:{importedCategory.Id}:name",
                Fallback = importedCategory.Name,
            };
            structure.CategoryIconUrl ??= importedCategory.IconUrl;
            structure.IsBunker = importedCategory.IsBunker ? true : null;
            structure.IsFacility = importedCategory.IsFacility ? true : null;
            structure.IsWorldStructure = importedCategory.IsWorldStructure ? true : null;
        }

        var canonicalCategoryIds = new HashSet<string>(
            manifest.Assets
                .Select(structure => FoxWatchManifestCategoryNormalizer.NormalizeKey(structure.CategoryId))
                .Where(categoryId => !string.IsNullOrWhiteSpace(categoryId)),
            StringComparer.Ordinal);

        var importedCategories = importedCategoriesById.Values
            .GroupBy(category => FoxWatchManifestCategoryNormalizer.NormalizeKey(category.Id), StringComparer.Ordinal)
            .Select(group => group.First())
            .ToList();

        var canonicalCategories = importedCategories
            .Where(category => ImportedCategoryMatchesCanonicalIds(category, canonicalCategoryIds))
            .OrderBy(category => category.Order)
            .ThenBy(category => category.Name, StringComparer.Ordinal)
            .Select(category => new FoxWatchManifestCategory
            {
                Id = category.Id,
                Name = new FoxWatchLocalizedText
                {
                    Id = $"foxhole:category:{category.Id}:name",
                    Fallback = category.Name,
                },
                IconUrl = category.IconUrl,
                Order = category.Order,
            })
            .ToList();

        var canonicalCategoryKeys = new HashSet<string>(
            canonicalCategories
                .Select(category => FoxWatchManifestCategoryNormalizer.NormalizeKey(category.Id))
                .Where(categoryId => !string.IsNullOrWhiteSpace(categoryId)),
            StringComparer.Ordinal);

        var passthroughCategories = manifest.Categories
            .Where(category =>
            {
                var normalizedCategoryId = FoxWatchManifestCategoryNormalizer.NormalizeKey(category.Id);
                if (string.IsNullOrWhiteSpace(normalizedCategoryId)
                    || !canonicalCategoryIds.Contains(normalizedCategoryId)
                    || canonicalCategoryKeys.Contains(normalizedCategoryId))
                {
                    return false;
                }

                return !importedCategories.Any(importedCategory =>
                    ImportedCategoryCoversExtractedCategoryId(importedCategory, normalizedCategoryId));
            })
            .GroupBy(category => FoxWatchManifestCategoryNormalizer.NormalizeKey(category.Id), StringComparer.Ordinal)
            .Select(group => group.First())
            .Select(category => new FoxWatchManifestCategory
            {
                Id = category.Id,
                Name = new FoxWatchLocalizedText
                {
                    Id = category.Name.Id,
                    Fallback = category.Name.Fallback,
                },
                IconUrl = category.IconUrl,
                Order = category.Order,
            })
            .ToList();

        manifest.Categories = canonicalCategories
            .Concat(passthroughCategories)
            .OrderBy(category => category.Order)
            .ThenBy(category => category.Name.Fallback, StringComparer.Ordinal)
            .ToList();

        return canonicalCategories.Count;
    }

    private Dictionary<string, FoxWatchImportedCategoryDefinition> ReadImportedCategoryCatalog()
    {
        var categoryCatalogPath = FoxWatchWorkspace.ResolvePath(FoxWatchWorkspace.ImportedCategoryCatalogRelativePath)!;
        if (!File.Exists(categoryCatalogPath))
        {
            return new Dictionary<string, FoxWatchImportedCategoryDefinition>(StringComparer.Ordinal);
        }

        try
        {
            var json = File.ReadAllText(categoryCatalogPath);
            var categoryCatalog = JsonSerializer.Deserialize<FoxWatchImportedCategoryCatalog>(json, DeserializeOptions);
            var categoriesById = new Dictionary<string, FoxWatchImportedCategoryDefinition>(StringComparer.Ordinal);
            foreach (var category in categoryCatalog?.Categories ?? [])
            {
                if (string.IsNullOrWhiteSpace(category.Id))
                {
                    continue;
                }

                categoriesById[FoxWatchManifestCategoryNormalizer.NormalizeKey(category.Id)] = category;
                if (!string.IsNullOrWhiteSpace(category.LegacyId))
                {
                    categoriesById[FoxWatchManifestCategoryNormalizer.NormalizeKey(category.LegacyId)] = category;
                }
            }

            return categoriesById;
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Failed to read imported category catalog from {CategoryCatalogPath}", categoryCatalogPath);
            return new Dictionary<string, FoxWatchImportedCategoryDefinition>(StringComparer.Ordinal);
        }
    }

    private static void ApplyDerivedStructureDefaults(IReadOnlyList<FoxWatchManifestStructure> structures)
    {
        foreach (var structure in structures)
        {
            structure.ClipFloor ??= structure.IsVehicle != true && structure.IsItem != true;

            if (structure.IsVehicle == true &&
                !string.IsNullOrWhiteSpace(structure.Packaged?.ShippableType))
            {
                structure.Packaged.PalletOffset ??= new FoxWatchManifestPackagedPalletOffset();
                structure.Packaged.PalletOffset.RotationDegrees ??= -90;
            }
        }
    }

    private static int RemoveDanglingStructureReferences(IReadOnlyList<FoxWatchManifestStructure> structures)
    {
        var availableCodeNames = BuildAvailableStructureReferenceCodeNameSet(structures);

        var removedReferenceCount = 0;
        foreach (var structure in structures)
        {
            var normalizedUpgradeStructureCodeName = NormalizeStructureReferenceCodeName(structure.UpgradeStructureCodeName);
            if (normalizedUpgradeStructureCodeName is null)
            {
                structure.UpgradeStructureCodeName = null;
            }
            else if (!availableCodeNames.Contains(normalizedUpgradeStructureCodeName))
            {
                structure.UpgradeStructureCodeName = null;
                removedReferenceCount += 1;
            }
            else
            {
                structure.UpgradeStructureCodeName = normalizedUpgradeStructureCodeName;
            }

            if (structure.ConversionCodeNames.Count > 0)
            {
                var cleanedConversionCodeNames = new List<string>(structure.ConversionCodeNames.Count);
                foreach (var codeName in structure.ConversionCodeNames)
                {
                    var normalizedCodeName = NormalizeStructureReferenceCodeName(codeName);
                    if (normalizedCodeName is null)
                    {
                        continue;
                    }

                    if (!availableCodeNames.Contains(normalizedCodeName))
                    {
                        removedReferenceCount += 1;
                        continue;
                    }

                    cleanedConversionCodeNames.Add(normalizedCodeName);
                }

                structure.ConversionCodeNames = cleanedConversionCodeNames;
            }

            var normalizedDestroyedStructureCodeName = NormalizeStructureReferenceCodeName(structure.DestroyedStructureCodeName);
            if (normalizedDestroyedStructureCodeName is null)
            {
                structure.DestroyedStructureCodeName = null;
            }
            else if (!availableCodeNames.Contains(normalizedDestroyedStructureCodeName))
            {
                structure.DestroyedStructureCodeName = null;
                removedReferenceCount += 1;
            }
            else
            {
                structure.DestroyedStructureCodeName = normalizedDestroyedStructureCodeName;
            }
        }

        return removedReferenceCount;
    }

    private static HashSet<string> BuildAvailableStructureReferenceCodeNameSet(IReadOnlyList<FoxWatchManifestStructure> structures)
    {
        var availableCodeNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var structure in structures)
        {
            var normalizedCodeName = NormalizeStructureReferenceCodeName(structure.CodeName);
            if (normalizedCodeName is null)
            {
                continue;
            }

            availableCodeNames.Add(normalizedCodeName);
        }

        foreach (var publishedCodeName in ReadPublishedParentFallbacks().ByCodeName.Keys)
        {
            var normalizedCodeName = NormalizeStructureReferenceCodeName(publishedCodeName);
            if (normalizedCodeName is null)
            {
                continue;
            }

            availableCodeNames.Add(normalizedCodeName);
        }

        return availableCodeNames;
    }

    private static string? NormalizeStructureReferenceCodeName(string? codeName)
    {
        return string.IsNullOrWhiteSpace(codeName)
            ? null
            : codeName.Trim();
    }

    private int ApplyStructureManifestOverrides(
        FoxWatchManifest manifest,
        IReadOnlyList<FoxWatchManifestStructure> structures,
        IReadOnlyDictionary<string, FoxWatchManifestStructure>? localizedTextSourceByStructureId = null)
    {
        var appliedCount = 0;
        foreach (var structure in structures)
        {
            if (!_assetManifestOverrideLoader.TryLoadStructureOverride(structure.Id, out var overrideElement))
            {
                continue;
            }

            var applied = ApplyOverrideObject(structure, overrideElement, _assetManifestOverrideLoader.GetStructureOverridePath(structure.Id), $"structure {structure.Id}");
            if (TryGetOverrideProperty(overrideElement, "modifications", out var structureModificationsElement))
            {
                applied |= ApplyStructureModificationVariantOverrides(
                    structure,
                    structureModificationsElement,
                    _assetManifestOverrideLoader.GetStructureOverridePath(structure.Id));
            }

            FoxWatchManifestStructure? localizedTextSourceStructure = null;
            localizedTextSourceByStructureId?.TryGetValue(structure.Id, out localizedTextSourceStructure);
            applied |= ApplyStructureLocalizedTextOverrides(manifest, structure, overrideElement, localizedTextSourceStructure);
            if (applied)
            {
                appliedCount += 1;
            }
        }

        return appliedCount;
    }

    private int InjectSyntheticStructureOverrides(FoxWatchManifest manifest)
    {
        var existingStructureIds = new HashSet<string>(
            manifest.Assets
                .Select(structure => structure.Id)
                .Where(id => !string.IsNullOrWhiteSpace(id)),
            StringComparer.OrdinalIgnoreCase);
        var structuresById = manifest.Assets
            .Where(structure => !string.IsNullOrWhiteSpace(structure.Id))
            .GroupBy(structure => structure.Id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var injectedStructures = new List<FoxWatchManifestStructure>();
        var localizedTextSourceByStructureId = new Dictionary<string, FoxWatchManifestStructure>(StringComparer.OrdinalIgnoreCase);

        foreach (var structureId in _assetManifestOverrideLoader.GetStructureOverrideIds())
        {
            if (existingStructureIds.Contains(structureId) ||
                !_assetManifestOverrideLoader.TryLoadStructureOverride(structureId, out var overrideElement))
            {
                continue;
            }

            var copyFromStructureId = ReadStringOverrideProperty(overrideElement, "copyFromStructureId");
            if (string.IsNullOrWhiteSpace(copyFromStructureId) ||
                !structuresById.TryGetValue(copyFromStructureId, out var localizedTextSourceStructure))
            {
                continue;
            }

            var syntheticStructure = CreateSyntheticStructure(localizedTextSourceStructure, structureId);
            syntheticStructure.Id = structureId;

            manifest.Assets.Add(syntheticStructure);
            injectedStructures.Add(syntheticStructure);
            existingStructureIds.Add(structureId);
            structuresById[structureId] = syntheticStructure;
            localizedTextSourceByStructureId[structureId] = localizedTextSourceStructure;
        }

        if (injectedStructures.Count > 0)
        {
            ApplyStructureManifestOverrides(manifest, injectedStructures, localizedTextSourceByStructureId);
        }

        return injectedStructures.Count;
    }

    private static FoxWatchManifestStructure CreateSyntheticStructure(
        FoxWatchManifestStructure sourceStructure,
        string structureId)
    {
        var syntheticStructure = CloneStructure(sourceStructure);
        syntheticStructure.Id = structureId;
        return syntheticStructure;
    }

    private static FoxWatchManifestStructure CloneStructure(FoxWatchManifestStructure source)
    {
        var serialized = JsonSerializer.Serialize(source);
        return JsonSerializer.Deserialize<FoxWatchManifestStructure>(serialized, DeserializeOptions)
            ?? new FoxWatchManifestStructure();
    }

    private bool ApplyStructureLocalizedTextOverrides(
        FoxWatchManifest manifest,
        FoxWatchManifestStructure structure,
        JsonElement overrideElement,
        FoxWatchManifestStructure? localizedTextSourceStructure)
    {
        var applied = false;

        if (localizedTextSourceStructure != null)
        {
            applied |= CopyLocalizedTextValues(manifest, localizedTextSourceStructure.Name, structure.Name);
            applied |= CopyLocalizedTextValues(manifest, localizedTextSourceStructure.Description, structure.Description);
            applied |= CopyLocalizedTextValues(manifest, localizedTextSourceStructure.CategoryName, structure.CategoryName);
        }

        applied |= SynchronizeLocalizedTextFallback(manifest, structure.Name);
        applied |= SynchronizeLocalizedTextFallback(manifest, structure.Description);
        applied |= SynchronizeLocalizedTextFallback(manifest, structure.CategoryName);

        if (TryGetOverrideProperty(overrideElement, "nameLocalizedValues", out var nameLocalizedValues))
        {
            applied |= ApplyLocalizedTextValueOverrides(manifest, structure.Name, nameLocalizedValues);
        }

        if (TryGetOverrideProperty(overrideElement, "descriptionLocalizedValues", out var descriptionLocalizedValues))
        {
            applied |= ApplyLocalizedTextValueOverrides(manifest, structure.Description, descriptionLocalizedValues);
        }

        if (TryGetOverrideProperty(overrideElement, "categoryNameLocalizedValues", out var categoryNameLocalizedValues))
        {
            applied |= ApplyLocalizedTextValueOverrides(manifest, structure.CategoryName, categoryNameLocalizedValues);
        }

        return applied;
    }

    private static bool CopyLocalizedTextValues(FoxWatchManifest manifest, FoxWatchLocalizedText? source, FoxWatchLocalizedText? target)
    {
        if (source == null ||
            target == null ||
            string.IsNullOrWhiteSpace(target.Id) ||
            string.Equals(source.Id, target.Id, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var applied = false;
        foreach (var localizedValue in ResolveManifestLocalizedTextValues(manifest, source))
        {
            SetLocalizedTextValue(manifest, localizedValue.Key, target.Id, localizedValue.Value);
            applied = true;
        }

        return applied;
    }

    private static bool SynchronizeLocalizedTextFallback(FoxWatchManifest manifest, FoxWatchLocalizedText? text)
    {
        if (text == null ||
            string.IsNullOrWhiteSpace(text.Id) ||
            string.IsNullOrWhiteSpace(text.Fallback))
        {
            return false;
        }

        SetLocalizedTextValue(manifest, "en", text.Id, text.Fallback);
        return true;
    }

    private bool ApplyLocalizedTextValueOverrides(FoxWatchManifest manifest, FoxWatchLocalizedText? target, JsonElement localizedValuesElement)
    {
        if (target == null || string.IsNullOrWhiteSpace(target.Id))
        {
            return false;
        }

        if (localizedValuesElement.ValueKind != JsonValueKind.Object)
        {
            _logger.LogWarning("Skipping localized text override for {LocalizationId} because the override value must be an object", target.Id);
            return false;
        }

        var applied = false;
        foreach (var localizedValueProperty in localizedValuesElement.EnumerateObject())
        {
            if (localizedValueProperty.Value.ValueKind != JsonValueKind.String)
            {
                _logger.LogWarning("Skipping localized text override for {LocalizationId} locale {Locale} because the value must be a string", target.Id, localizedValueProperty.Name);
                continue;
            }

            var localizedValue = localizedValueProperty.Value.GetString();
            if (string.IsNullOrWhiteSpace(localizedValue))
            {
                continue;
            }

            SetLocalizedTextValue(manifest, localizedValueProperty.Name, target.Id, localizedValue.Trim());
            applied = true;
        }

        return applied;
    }

    private int ApplySharedModificationManifestOverrides(FoxWatchManifest manifest)
    {
        if (!_assetManifestOverrideLoader.TryLoadSharedModificationOverrides(out var overrideElement) ||
            !TryGetOverrideProperty(overrideElement, "modifications", out var modificationsElement))
        {
            return 0;
        }

        return ApplyStructureModificationVariantOverrides(
            manifest.Assets,
            modificationsElement,
            FoxWatchWorkspace.SharedModificationOverrideManifestPath,
            matchSharedModificationVariantIds: true);
    }

    private bool ApplyStructureModificationVariantOverrides(
        FoxWatchManifestStructure structure,
        JsonElement modificationsElement,
        string overridePath)
    {
        return ApplyStructureModificationVariantOverrides(
            [structure],
            modificationsElement,
            overridePath,
            matchSharedModificationVariantIds: false) > 0;
    }

    private int ApplyStructureModificationVariantOverrides(
        IReadOnlyList<FoxWatchManifestStructure> structures,
        JsonElement modificationsElement,
        string overridePath,
        bool matchSharedModificationVariantIds)
    {
        if (modificationsElement.ValueKind != JsonValueKind.Object)
        {
            _logger.LogWarning(
                "Skipping modification overrides from {OverridePath} because modifications must be an object",
                overridePath);
            return 0;
        }

        var overridesByVariantId = modificationsElement.EnumerateObject()
            .Where(property => property.Value.ValueKind == JsonValueKind.Object)
            .ToDictionary(
                property => NormalizeModificationVariantLookupKey(property.Name),
                property => property.Value,
                StringComparer.OrdinalIgnoreCase);
        if (overridesByVariantId.Count == 0)
        {
            return 0;
        }

        var appliedCount = 0;
        foreach (var structure in structures)
        {
            if (structure.ModificationSlots == null || structure.ModificationSlots.Count == 0)
            {
                continue;
            }

            foreach (var slot in structure.ModificationSlots)
            {
                foreach (var (variantId, variant) in slot.Variants)
                {
                    if (!TryResolveModificationVariantOverride(
                        overridesByVariantId,
                        structure.Id,
                        slot.Name,
                        variantId,
                        variant,
                        out var variantOverride))
                    {
                        continue;
                    }

                    if (ApplyModificationVariantOverrideProperties(variant, variantOverride, overridePath, $"{structure.Id}/{variantId}"))
                    {
                        appliedCount += 1;
                    }
                }
            }
        }

        if (matchSharedModificationVariantIds && appliedCount > 0)
        {
            _logger.LogInformation(
                "Applied shared modification overrides from {OverridePath} to {AppliedVariantCount} modification variant(s)",
                overridePath,
                appliedCount);
        }

        return appliedCount;
    }

    private static bool TryGetModificationVariantOverride(
        IReadOnlyDictionary<string, JsonElement> overridesByVariantId,
        string? lookupKey,
        out JsonElement variantOverride)
    {
        return overridesByVariantId.TryGetValue(
            NormalizeModificationVariantLookupKey(lookupKey),
            out variantOverride);
    }

    private static bool TryResolveModificationVariantOverride(
        IReadOnlyDictionary<string, JsonElement> overridesByVariantId,
        string structureId,
        string slotName,
        string variantId,
        FoxWatchManifestModificationSlotVariant variant,
        out JsonElement variantOverride)
    {
        foreach (var lookupKey in EnumerateModificationVariantOverrideLookupKeys(structureId, slotName, variantId, variant))
        {
            if (TryGetModificationVariantOverride(overridesByVariantId, lookupKey, out variantOverride))
            {
                return true;
            }
        }

        variantOverride = default;
        return false;
    }

    private static IEnumerable<string> EnumerateModificationVariantOverrideLookupKeys(
        string structureId,
        string slotName,
        string variantId,
        FoxWatchManifestModificationSlotVariant variant)
    {
        var normalizedStructureId = NormalizeModificationVariantLookupKey(structureId);
        var normalizedSlotName = NormalizeModificationVariantLookupKey(slotName);
        var normalizedVariantId = NormalizeModificationVariantLookupKey(variantId);
        if (!string.IsNullOrWhiteSpace(normalizedStructureId)
            && !string.IsNullOrWhiteSpace(normalizedSlotName)
            && !string.IsNullOrWhiteSpace(normalizedVariantId))
        {
            yield return $"{normalizedStructureId}/{normalizedSlotName}/{normalizedVariantId}";
        }

        if (!string.IsNullOrWhiteSpace(normalizedStructureId) && !string.IsNullOrWhiteSpace(normalizedVariantId))
        {
            yield return $"{normalizedStructureId}/{normalizedVariantId}";
        }

        if (!string.IsNullOrWhiteSpace(variant.RenderId))
        {
            yield return NormalizeModificationVariantLookupKey(variant.RenderId);
        }

        if (!string.IsNullOrWhiteSpace(variant.SharedModificationId))
        {
            yield return NormalizeModificationVariantLookupKey(variant.SharedModificationId);
        }

        if (!string.IsNullOrWhiteSpace(normalizedVariantId))
        {
            yield return normalizedVariantId;
        }

        if (!string.IsNullOrWhiteSpace(variant.CodeName))
        {
            yield return NormalizeModificationVariantLookupKey(variant.CodeName);
        }
    }

    private bool ApplyModificationVariantOverrideProperties(
        FoxWatchManifestModificationSlotVariant variant,
        JsonElement variantOverride,
        string overridePath,
        string targetPath)
    {
        var applied = false;

        if (TryGetOverrideProperty(variantOverride, "previewDirection", out var previewDirectionElement) &&
            previewDirectionElement.ValueKind == JsonValueKind.String)
        {
            var previewDirection = NormalizePreviewDirectionOverride(previewDirectionElement.GetString());
            if (!string.IsNullOrWhiteSpace(previewDirection))
            {
                variant.PreviewDirection = previewDirection;
                applied = true;
            }
            else
            {
                _logger.LogWarning(
                    "Skipping previewDirection override for {TargetPath} from {OverridePath} because the value must be one of ne, nw, se, sw",
                    targetPath,
                    overridePath);
            }
        }

        return applied;
    }

    private static string NormalizeModificationVariantLookupKey(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
    }

    private static string? NormalizePreviewDirectionOverride(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return normalized switch
        {
            "ne" or "nw" or "se" or "sw" => normalized,
            _ => null,
        };
    }

    private bool ApplyOverrideObject(object target, JsonElement overrideElement, string overridePath, string targetPath)
    {
        if (overrideElement.ValueKind != JsonValueKind.Object)
        {
            _logger.LogWarning("Skipping override payload at {OverridePath} for {TargetPath} because the value must be an object", overridePath, targetPath);
            return false;
        }

        var applied = false;
        var propertyMap = GetWritablePropertyMap(target.GetType());

        foreach (var overrideProperty in overrideElement.EnumerateObject())
        {
            if (ReservedOverridePropertyNames.Contains(overrideProperty.Name))
            {
                continue;
            }

            if (!propertyMap.TryGetValue(overrideProperty.Name, out var targetProperty))
            {
                _logger.LogWarning("Skipping unknown override property {PropertyName} at {OverridePath} for {TargetPath}", overrideProperty.Name, overridePath, targetPath);
                continue;
            }

            if (overrideProperty.Value.ValueKind == JsonValueKind.Null)
            {
                _logger.LogWarning("Skipping null override property {PropertyName} at {OverridePath} for {TargetPath}; explicit null clearing is not supported yet", overrideProperty.Name, overridePath, targetPath);
                continue;
            }

            var propertyPath = $"{targetPath}.{targetProperty.Name}";
            if (ShouldMergeNestedObject(targetProperty.PropertyType, overrideProperty.Value.ValueKind))
            {
                var nestedTarget = targetProperty.GetValue(target) ?? CreateNestedTarget(targetProperty.PropertyType);
                if (nestedTarget == null)
                {
                    _logger.LogWarning("Skipping override property {PropertyPath} from {OverridePath} because {PropertyType} cannot be instantiated", propertyPath, overridePath, targetProperty.PropertyType.FullName);
                    continue;
                }

                if (targetProperty.GetValue(target) == null)
                {
                    targetProperty.SetValue(target, nestedTarget);
                }

                applied |= ApplyOverrideObject(nestedTarget, overrideProperty.Value, overridePath, propertyPath);
                continue;
            }

            try
            {
                var replacement = JsonSerializer.Deserialize(overrideProperty.Value.GetRawText(), targetProperty.PropertyType, DeserializeOptions);
                targetProperty.SetValue(target, replacement);
                applied = true;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Failed to apply override property {PropertyPath} from {OverridePath}", propertyPath, overridePath);
            }
        }

        return applied;
    }

    private static bool TryGetOverrideProperty(JsonElement overrideElement, string propertyName, out JsonElement value)
    {
        foreach (var overrideProperty in overrideElement.EnumerateObject())
        {
            if (string.Equals(overrideProperty.Name, propertyName, StringComparison.OrdinalIgnoreCase))
            {
                value = overrideProperty.Value;
                return true;
            }
        }

        value = default;
        return false;
    }

    private static string? ReadStringOverrideProperty(JsonElement overrideElement, string propertyName)
    {
        if (!TryGetOverrideProperty(overrideElement, propertyName, out var value) ||
            value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var stringValue = value.GetString();
        return string.IsNullOrWhiteSpace(stringValue) ? null : stringValue.Trim();
    }

    private static IReadOnlyDictionary<string, PropertyInfo> GetWritablePropertyMap(Type type)
    {
        return WritablePropertyMapCache.GetOrAdd(type, static currentType =>
        {
            var propertyMap = new Dictionary<string, PropertyInfo>(StringComparer.OrdinalIgnoreCase);
            foreach (var property in currentType.GetProperties(BindingFlags.Instance | BindingFlags.Public))
            {
                if (!property.CanWrite || property.GetIndexParameters().Length > 0)
                {
                    continue;
                }

                propertyMap.TryAdd(property.Name, property);
                propertyMap.TryAdd(JsonNamingPolicy.CamelCase.ConvertName(property.Name), property);

                var jsonPropertyName = property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name;
                if (!string.IsNullOrWhiteSpace(jsonPropertyName))
                {
                    propertyMap.TryAdd(jsonPropertyName, property);
                }
            }

            return propertyMap;
        });
    }

    private static bool ShouldMergeNestedObject(Type propertyType, JsonValueKind valueKind)
    {
        if (valueKind != JsonValueKind.Object)
        {
            return false;
        }

        var effectiveType = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (effectiveType == typeof(string))
        {
            return false;
        }

        if (typeof(IDictionary).IsAssignableFrom(effectiveType))
        {
            return false;
        }

        if (typeof(IEnumerable).IsAssignableFrom(effectiveType) && effectiveType != typeof(byte[]))
        {
            return false;
        }

        return effectiveType.IsClass;
    }

    private static object? CreateNestedTarget(Type propertyType)
    {
        var effectiveType = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (effectiveType.IsAbstract || effectiveType.IsInterface)
        {
            return null;
        }

        return Activator.CreateInstance(effectiveType);
    }

    private static void EnsureStructureVisualPlaceholders(IEnumerable<FoxWatchManifestStructure> structures)
    {
        foreach (var structure in structures)
        {
            structure.IconUrl ??= structure.PreviewUrl;
            structure.PreviewUrl ??= structure.IconUrl;

            if (structure.Variants.Default == null && !string.IsNullOrWhiteSpace(structure.PreviewUrl))
            {
                structure.Variants.Default = new FoxWatchTextureVariant { TextureUrl = structure.PreviewUrl };
            }

            if (structure.Variants.C == null)
            {
                structure.Variants.C = structure.Variants.Default != null
                    ? new FoxWatchTextureVariant { TextureUrl = structure.Variants.Default.TextureUrl }
                    : (!string.IsNullOrWhiteSpace(structure.IconUrl) ? new FoxWatchTextureVariant { TextureUrl = structure.IconUrl } : null);
            }

            if (structure.Variants.W == null)
            {
                structure.Variants.W = structure.Variants.Default != null
                    ? new FoxWatchTextureVariant { TextureUrl = structure.Variants.Default.TextureUrl }
                    : (!string.IsNullOrWhiteSpace(structure.IconUrl) ? new FoxWatchTextureVariant { TextureUrl = structure.IconUrl } : null);
            }
        }
    }

    private static void ApplyUpgradeVariantStructureVisualInheritance(IReadOnlyList<FoxWatchManifestStructure> structures)
    {
        var structuresByLookupKey = structures
            .SelectMany(structure => GetLookupKeys(structure)
                .Select(key => new KeyValuePair<string, FoxWatchManifestStructure>(key, structure)))
            .GroupBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First().Value, StringComparer.OrdinalIgnoreCase);

        foreach (var structure in structures)
        {
            if (structure.ModificationSlots == null || structure.ModificationSlots.Count == 0)
            {
                continue;
            }

            foreach (var slot in structure.ModificationSlots)
            {
                foreach (var variant in slot.Variants.Values)
                {
                    if (!structure.Modifications.TryGetValue(variant.CodeName, out var modification) ||
                        !modification.IsUpgrade)
                    {
                        continue;
                    }

                    var normalizedStructureKey = FoxWatchManifestCategoryNormalizer.NormalizeKey(variant.CodeName);
                    if (string.IsNullOrWhiteSpace(normalizedStructureKey) ||
                        !structuresByLookupKey.TryGetValue(normalizedStructureKey, out var targetStructure) ||
                        ReferenceEquals(targetStructure, structure))
                    {
                        continue;
                    }

                    ApplyStructureVisualInheritance(variant, targetStructure);
                }
            }
        }
    }

    private static void ApplyStructureVisualInheritance(
        FoxWatchManifestModificationSlotVariant variant,
        FoxWatchManifestStructure targetStructure)
    {
        variant.IconUrl ??= targetStructure.IconUrl;
        variant.PreviewUrl ??= targetStructure.PreviewUrl;
        variant.PreviewDirection ??= targetStructure.PreviewDirection;
        variant.TextureUrl ??= targetStructure.Variants.Default?.TextureUrl;
        variant.TextureWidth ??= targetStructure.Sprite.Width;
        variant.TextureHeight ??= targetStructure.Sprite.Height;
        variant.AnchorX ??= targetStructure.Sprite.AnchorX;
        variant.AnchorY ??= targetStructure.Sprite.AnchorY;
        variant.OffsetX ??= targetStructure.Sprite.OffsetX;
        variant.OffsetY ??= targetStructure.Sprite.OffsetY;
    }

    private static IEnumerable<string> GetLookupKeys(FoxWatchManifestStructure structure)
    {
        if (!string.IsNullOrWhiteSpace(structure.Id))
        {
            yield return FoxWatchManifestCategoryNormalizer.NormalizeKey(structure.Id);
        }

        if (!string.IsNullOrWhiteSpace(structure.CodeName))
        {
            yield return FoxWatchManifestCategoryNormalizer.NormalizeKey(structure.CodeName);
        }

        if (!string.IsNullOrWhiteSpace(structure.LegacyKey))
        {
            yield return FoxWatchManifestCategoryNormalizer.NormalizeKey(structure.LegacyKey);
        }
    }

    private static bool FillStringProperty(string? currentValue, string? source, Action<string> assign)
    {
        if (!string.IsNullOrWhiteSpace(currentValue) || string.IsNullOrWhiteSpace(source))
        {
            return false;
        }

        assign(source);
        return true;
    }

    private static bool MergeVariants(FoxWatchTextureVariants target, FoxWatchTextureVariants source)
    {
        var changed = false;

        if (target.Default == null && source.Default != null)
        {
            target.Default = new FoxWatchTextureVariant { TextureUrl = source.Default.TextureUrl };
            changed = true;
        }

        if (target.C == null && source.C != null)
        {
            target.C = new FoxWatchTextureVariant { TextureUrl = source.C.TextureUrl };
            changed = true;
        }

        if (target.W == null && source.W != null)
        {
            target.W = new FoxWatchTextureVariant { TextureUrl = source.W.TextureUrl };
            changed = true;
        }

        return changed;
    }

    private static bool MergeSprite(FoxWatchSprite target, FoxWatchSprite source)
    {
        var changed = false;

        if (target.Width == null && source.Width != null)
        {
            target.Width = source.Width;
            changed = true;
        }

        if (target.Height == null && source.Height != null)
        {
            target.Height = source.Height;
            changed = true;
        }

        if (target.OffsetX == 0 && source.OffsetX != 0)
        {
            target.OffsetX = source.OffsetX;
            changed = true;
        }

        if (target.OffsetY == 0 && source.OffsetY != 0)
        {
            target.OffsetY = source.OffsetY;
            changed = true;
        }

        return changed;
    }
}

public sealed class FoxWatchImportedCategoryCatalog
{
    public string SchemaVersion { get; set; } = "1.0.0";

    public List<FoxWatchImportedCategoryDefinition> Categories { get; set; } = [];
}

public sealed class FoxWatchImportedCategoryDefinition
{
    public string Id { get; set; } = string.Empty;

    public string LegacyId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? IconUrl { get; set; }

    public string? IconTexturePath { get; set; }

    public bool IsBunker { get; set; }

    public bool IsFacility { get; set; }

    public bool IsWorldStructure { get; set; }

    public int Order { get; set; }
}
