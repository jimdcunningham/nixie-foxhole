using CUE4Parse.FileProvider;
using CUE4Parse.FileProvider.Objects;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Localization;
using CUE4Parse.UE4.Objects.Core.i18N;
using CUE4Parse.UE4.Objects.Engine;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Collections;
using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Reflection;
using System.Text.RegularExpressions;

namespace FoxWatchService;

public class FoxWatchManifestAssetExtractor
    {
        private const double UnrealUnitsPerMeter = 100.0;
        private const string BlueprintPackagePrefix = "War/Content/Blueprints/";
        private const string ModificationDataPackagePrefix = "War/Content/Blueprints/Structures/Facilities/Modifications/Data/";
        private const string MountDynamicDataPackagePath = "War/Content/Blueprints/Data/BPMountDynamicData.uasset";
        private const string StructureDynamicDataPackagePath = "War/Content/Blueprints/Data/BPStructureDynamicData.uasset";
        private const string VehicleDynamicDataPackagePath = "War/Content/Blueprints/Data/BPVehicleDynamicData.uasset";
        private const string ItemDynamicDataPackagePath = "War/Content/Blueprints/Data/BPItemDynamicData.uasset";
        private const string WreckedSubTypeIconObjectPath = "War/Content/Textures/UI/ItemIcons/SubtypeWreckedIcon.0";
        private const long FacilityLiquidPipeSocketMask = 2048;
        private const long FacilityLiquidPipeSocketCategory = 16384;
        private static readonly string[] InvalidAssetIconPackagePaths =
        [
            "War/Content/Textures/UI/StructureIcons/GarrisonStructureIcon.uasset",
        ];
        private static readonly string[] InvalidAssetIconPackagePathPrefixes =
        [
            "War/Content/Textures/UI/MapIcons/",
        ];
        private static readonly IReadOnlyDictionary<string, ManifestComponentTransform> EmptyAttachPointTransforms =
            new Dictionary<string, ManifestComponentTransform>(StringComparer.OrdinalIgnoreCase);
        private static readonly string[] HelperFootprintVolumeNameHints =
        [
            "Footprint",
            "UseArea",
            "KillVolume",
            "ParkingSpot",
        ];
        private readonly string? _pakDirectoryPath;
        private readonly string? _blueprintTargetIndexPath;
        private readonly string _pakDirectorySignature;
        private readonly DefaultFileProvider _fileProvider;
        private readonly FoxWatchAssetMeshExporter? _meshAssetExporter;
        private readonly FoxWatchNonCodeNameStructureWhitelistLoader? _nonCodeNameStructureWhitelistLoader;
        private readonly Dictionary<string, IReadOnlyList<FoxWatchBlueprintComponentReference>> _blueprintComponentReferencesByPackagePath = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, IReadOnlyList<BlueprintComponentScope>> _blueprintComponentScopesByPackagePath = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, VehicleBodyFrameCorrection?> _vehicleBodyFrameCorrectionsByPackagePath = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, VehicleSeatForwardHints> _vehicleSeatForwardHintsByPackagePath = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, IReadOnlyDictionary<string, ManifestComponentTransform>> _skeletalMeshAttachPointTransformsByPackagePath = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _unknownCategoryTokens = new(StringComparer.Ordinal);
        private IReadOnlyDictionary<string, FoxWatchMountDynamicDataEntry>? _mountDynamicDataEntriesByKey;
        private IReadOnlyDictionary<string, FoxWatchConstructionDynamicDataEntry>? _constructionDynamicDataEntriesByKey;
        private readonly Dictionary<string, FoxWatchMountComponentMetadata?> _mountComponentMetadataByPackagePath = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, FoxWatchReferencedAssetMetadata?> _referencedAssetMetadataByPackagePath = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, FoxWatchLiquidItemComponentMetadata?> _liquidItemComponentMetadataByPackagePath = new(StringComparer.OrdinalIgnoreCase);
        private Dictionary<string, HashSet<string>>? _blueprintPackagePathsByTargetId;
        private bool _blueprintTargetIndexDirty;
        private const string SignedFloatPattern = @"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?";
        private static readonly Regex VectorPattern = new($@"X=(?<x>{SignedFloatPattern})\s+Y=(?<y>{SignedFloatPattern})\s+Z=(?<z>{SignedFloatPattern})", RegexOptions.Compiled | RegexOptions.CultureInvariant);
        private static readonly Regex RotatorPattern = new($@"P=(?<pitch>{SignedFloatPattern})\s+Y=(?<yaw>{SignedFloatPattern})\s+R=(?<roll>{SignedFloatPattern})", RegexOptions.Compiled | RegexOptions.CultureInvariant);
        private static readonly JsonSerializerOptions BlueprintTargetIndexSerializerOptions = new()
        {
            WriteIndented = true,
        };
        private static readonly string[] LocalizationRoots =
        [
            "War/Content/Localization/Foxhole-CodeStrings/",
            "War/Content/Localization/Foxhole-Content/",
        ];
        private static readonly string[] BlueprintTargetWrapperSuffixes =
        [
            "vehicleproxy",
            "proxy",
            "component",
            "pickup",
        ];

        private sealed class ReferencedBuildSiteExtractionRequest
        {
            public ReferencedBuildSiteExtractionRequest(
                string structureId,
                string codeName,
                string blueprintPackagePath,
                string? upgradeStructureCodeName,
                int? upgradeStructureTier,
                int upgradeStructureBuildOrder)
            {
                StructureId = structureId;
                CodeName = codeName;
                BlueprintPackagePath = blueprintPackagePath;
                UpgradeStructureCodeName = upgradeStructureCodeName;
                UpgradeStructureTier = upgradeStructureTier;
                UpgradeStructureBuildOrder = upgradeStructureBuildOrder;
            }

            public string StructureId { get; }

            public string CodeName { get; }

            public string BlueprintPackagePath { get; }

            public string? UpgradeStructureCodeName { get; set; }

            public int? UpgradeStructureTier { get; set; }

            public int UpgradeStructureBuildOrder { get; set; }
        }

        public FoxWatchManifestAssetExtractor(
            string pakFilePath,
            FoxWatchAssetMeshExporter? meshAssetExporter = null,
            FoxWatchNonCodeNameStructureWhitelistLoader? nonCodeNameStructureWhitelistLoader = null)
        {
            const EGame resolvedEngineVersion = EGame.GAME_UE4_24;
            _pakDirectoryPath = FoxWatchWorkspace.ResolvePath(pakFilePath);
            _blueprintTargetIndexPath = FoxWatchWorkspace.ResolvePath(FoxWatchWorkspace.DefaultBlueprintTargetIndexRelativePath);
            _pakDirectorySignature = ComputePakDirectorySignature(_pakDirectoryPath);
            _fileProvider = new DefaultFileProvider(
                pakFilePath,
                SearchOption.TopDirectoryOnly,
                new VersionContainer(resolvedEngineVersion),
                StringComparer.OrdinalIgnoreCase);
            _fileProvider.Initialize();
            _meshAssetExporter = meshAssetExporter;
            _nonCodeNameStructureWhitelistLoader = nonCodeNameStructureWhitelistLoader;
        }

        public FoxWatchManifest BuildStructureManifest(string baseAssetsUrl, string? iconOutputDirectory = null, FoxWatchTargetFilter? targetFilter = null)
        {
            _fileProvider.Mount();

            var englishStrings = new Dictionary<string, string>(StringComparer.Ordinal);
            var localizationReferencesById = new Dictionary<string, FoxWatchLocalizationReference>(StringComparer.Ordinal);
            var categoriesById = new Dictionary<string, FoxWatchManifestCategory>(StringComparer.Ordinal);
            var structuresById = new Dictionary<string, FoxWatchManifestStructure>(StringComparer.Ordinal);
            var referencedBuildSiteRequestsById = new Dictionary<string, ReferencedBuildSiteExtractionRequest>(StringComparer.OrdinalIgnoreCase);

            foreach (var packagePath in EnumerateCandidateBlueprintPackagePaths(targetFilter))
            {
                IReadOnlyCollection<dynamic> objects;
                try
                {
                    var package = _fileProvider.LoadPackage(packagePath);
                    objects = package.GetExports().Cast<dynamic>().ToArray();
                }
                catch
                {
                    continue;
                }

                var blueprint = objects.OfType<UBlueprintGeneratedClass>().FirstOrDefault();
                if (blueprint == null)
                {
                    continue;
                }

                var packageProducedStructure = false;
                foreach (var obj in objects)
                {
                    var structure = TryBuildStructure(obj, objects, blueprint, baseAssetsUrl, iconOutputDirectory, categoriesById, englishStrings, localizationReferencesById);
                    if (structure == null)
                    {
                        continue;
                    }

                    var structureId = structure.Id;
                    if (string.IsNullOrWhiteSpace(structureId))
                    {
                        continue;
                    }

                    FoxWatchManifestStructure resolvedStructure;
                    if (structuresById.TryGetValue(structureId, out FoxWatchManifestStructure existingStructure))
                    {
                        var shouldPreferCandidate = ShouldPreferStructureCandidate(existingStructure, structure);
                        var preferredStructure = shouldPreferCandidate ? structure : existingStructure;
                        var supplementalStructure = shouldPreferCandidate ? existingStructure : structure;
                        MergeStructureCandidateData(preferredStructure, supplementalStructure);
                        structuresById[structureId] = preferredStructure;
                        resolvedStructure = preferredStructure;
                    }
                    else
                    {
                        structuresById[structureId] = structure;
                        resolvedStructure = structure;
                    }

                    RegisterResolvedBlueprintPackagePath(resolvedStructure);
                    RegisterReferencedBuildSiteExtractionRequest(resolvedStructure, referencedBuildSiteRequestsById);
                    packageProducedStructure = true;
                }

                if (!packageProducedStructure && targetFilter != null)
                {
                    var fallbackCodeName = ResolveReferencedStructureCodeName(packagePath);
                    if (!string.IsNullOrWhiteSpace(fallbackCodeName))
                    {
                        var defaultObject = ResolveBlueprintDefaultObject(objects, blueprint);
                        var structure = defaultObject == null
                            ? null
                            : TryBuildStructure(defaultObject, objects, blueprint, baseAssetsUrl, iconOutputDirectory, categoriesById, englishStrings, localizationReferencesById, fallbackCodeName);
                        if (structure != null)
                        {
                            var structureId = structure.Id;
                            if (string.IsNullOrWhiteSpace(structureId))
                            {
                                continue;
                            }

                            FoxWatchManifestStructure resolvedStructure;
                            if (structuresById.TryGetValue(structureId, out FoxWatchManifestStructure existingStructure))
                            {
                                var shouldPreferCandidate = ShouldPreferStructureCandidate(existingStructure, structure);
                                var preferredStructure = shouldPreferCandidate ? structure : existingStructure;
                                var supplementalStructure = shouldPreferCandidate ? existingStructure : structure;
                                MergeStructureCandidateData(preferredStructure, supplementalStructure);
                                structuresById[structureId] = preferredStructure;
                                resolvedStructure = preferredStructure;
                            }
                            else
                            {
                                structuresById[structureId] = structure;
                                resolvedStructure = structure;
                            }

                            RegisterResolvedBlueprintPackagePath(resolvedStructure);
                            RegisterReferencedBuildSiteExtractionRequest(resolvedStructure, referencedBuildSiteRequestsById);
                        }
                    }
                }
            }

            ExtractReferencedBuildSiteStructures(
                referencedBuildSiteRequestsById,
                structuresById,
                baseAssetsUrl,
                iconOutputDirectory,
                categoriesById,
                englishStrings,
                localizationReferencesById);

            AppendFieldModificationCenterVehicleUpgradeConversions(structuresById);

            foreach (var rawCategoryToken in _unknownCategoryTokens.OrderBy(value => value, StringComparer.Ordinal))
            {
                Console.WriteLine($"FoxWatch category fallback -> misc for raw category '{rawCategoryToken}'");
            }

            PersistBlueprintTargetIndex();

            var localizationBundles = BuildLocalizationBundles(englishStrings, localizationReferencesById);

            var manifest = new FoxWatchManifest
            {
                Source = new FoxWatchManifestSource
                {
                    Kind = "foxwatch",
                },
                Categories = categoriesById.Values.OrderBy(category => category.Order).ThenBy(category => category.Name?.Fallback ?? category.Id).ToList(),
                Assets = structuresById.Values.OrderBy(structure => structure.CategoryId).ThenBy(structure => structure.BuildOrder).ThenBy(structure => structure.Name?.Fallback ?? structure.Id).ToList(),
                Items = [],
                Localizations = localizationBundles,
            };
            FoxWatchModificationRenderIdentity.AssignRenderIds(manifest);
            return manifest;
        }

        private IEnumerable<string> EnumerateCandidateBlueprintPackagePaths(FoxWatchTargetFilter? targetFilter)
        {
            var blueprintPackagePaths = _fileProvider.Files
                .Where(file => file.Value.IsUePackage && file.Key.StartsWith(BlueprintPackagePrefix, StringComparison.Ordinal))
                .Select(file => file.Key)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();

            if (targetFilter == null || !targetFilter.HasFilters)
            {
                return blueprintPackagePaths;
            }

            IEnumerable<string> candidatePackagePaths = blueprintPackagePaths;

            if (targetFilter.StructureIds.Count > 0)
            {
                var targetIds = targetFilter.StructureIds
                    .Select(NormalizeStructureTargetToken)
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Distinct(StringComparer.Ordinal)
                    .ToArray();
                if (targetIds.Length == 0)
                {
                    return blueprintPackagePaths;
                }

                var availableBlueprintPackagePaths = blueprintPackagePaths.ToHashSet(StringComparer.Ordinal);
                var resolvedPackagePaths = new HashSet<string>(StringComparer.Ordinal);
                var unresolvedTargetIds = new List<string>();

                foreach (var targetId in targetIds)
                {
                    if (!TryAddResolvedBlueprintPackagePaths(
                        LoadBlueprintTargetIndex(),
                        targetId,
                        availableBlueprintPackagePaths,
                        resolvedPackagePaths))
                    {
                        unresolvedTargetIds.Add(targetId);
                    }
                }

                if (unresolvedTargetIds.Count > 0)
                {
                    var packagePathsByTargetId = BuildBlueprintPackagePathLookup(blueprintPackagePaths);
                    var remainingUnresolvedTargetIds = new List<string>();

                    foreach (var targetId in unresolvedTargetIds)
                    {
                        if (!TryAddResolvedBlueprintPackagePaths(
                            packagePathsByTargetId,
                            targetId,
                            availableBlueprintPackagePaths,
                            resolvedPackagePaths))
                        {
                            remainingUnresolvedTargetIds.Add(targetId);
                        }
                    }

                    unresolvedTargetIds = remainingUnresolvedTargetIds;
                }

                if (resolvedPackagePaths.Count == 0)
                {
                    return blueprintPackagePaths;
                }

                if (unresolvedTargetIds.Count > 0)
                {
                    var unresolvedLabel = string.Join(", ", unresolvedTargetIds.OrderBy(value => value, StringComparer.Ordinal));
                    Console.WriteLine($"FoxWatch target lookup skipped unresolved direct package matches for: {unresolvedLabel}");
                }

                candidatePackagePaths = resolvedPackagePaths;
            }

            return candidatePackagePaths.OrderBy(path => path, StringComparer.Ordinal).ToArray();
        }

        private static string ResolveBlueprintPackageTargetToken(string packagePath)
        {
            var packageName = Path.GetFileNameWithoutExtension(packagePath);
            if (packageName.StartsWith("BP", StringComparison.OrdinalIgnoreCase))
            {
                packageName = packageName[2..];
            }

            return NormalizeStructureTargetToken(packageName);
        }

        private static IEnumerable<string> EnumerateBlueprintPackageTargetTokens(string packageTargetToken)
        {
            if (string.IsNullOrWhiteSpace(packageTargetToken))
            {
                yield break;
            }

            yield return packageTargetToken;

            foreach (var suffix in BlueprintTargetWrapperSuffixes)
            {
                if (packageTargetToken.EndsWith(suffix, StringComparison.Ordinal)
                    && packageTargetToken.Length > suffix.Length)
                {
                    yield return packageTargetToken[..^suffix.Length];
                }
            }
        }

        private static string NormalizeStructureTargetToken(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            return string.Concat(NormalizeString(value)
                .Where(char.IsLetterOrDigit)
                .Select(char.ToLowerInvariant));
        }

        private Dictionary<string, HashSet<string>> BuildBlueprintPackagePathLookup(IEnumerable<string> blueprintPackagePaths)
        {
            var packagePathsByTargetId = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

            foreach (var packagePath in blueprintPackagePaths)
            {
                foreach (var targetToken in EnumerateBlueprintPackageTargetTokens(ResolveBlueprintPackageTargetToken(packagePath)))
                {
                    AddBlueprintTargetIndexEntry(packagePathsByTargetId, targetToken, packagePath);
                }
            }

            return packagePathsByTargetId;
        }

        private Dictionary<string, HashSet<string>> LoadBlueprintTargetIndex()
        {
            if (_blueprintPackagePathsByTargetId != null)
            {
                return _blueprintPackagePathsByTargetId;
            }

            var packagePathsByTargetId = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

            if (!string.IsNullOrWhiteSpace(_blueprintTargetIndexPath) && File.Exists(_blueprintTargetIndexPath))
            {
                try
                {
                    var document = System.Text.Json.JsonSerializer.Deserialize<FoxWatchBlueprintTargetIndexDocument>(File.ReadAllText(_blueprintTargetIndexPath));
                    if (document is not null
                        && document.FormatVersion == 1
                        && string.Equals(document.PakDirectorySignature, _pakDirectorySignature, StringComparison.Ordinal))
                    {
                        foreach (var pair in document.Targets)
                        {
                            foreach (var packagePath in pair.Value)
                            {
                                AddBlueprintTargetIndexEntry(packagePathsByTargetId, pair.Key, packagePath);
                            }
                        }
                    }
                }
                catch
                {
                }
            }

            _blueprintPackagePathsByTargetId = packagePathsByTargetId;
            return packagePathsByTargetId;
        }

        private void RegisterResolvedBlueprintPackagePath(FoxWatchManifestStructure structure)
        {
            var blueprintPackagePath = NormalizeString(structure.BlueprintPackagePath).Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(blueprintPackagePath))
            {
                return;
            }

            var packagePathsByTargetId = LoadBlueprintTargetIndex();
            var updated = false;

            foreach (var targetToken in EnumerateStructureTargetTokens(structure))
            {
                updated |= AddBlueprintTargetIndexEntry(packagePathsByTargetId, targetToken, blueprintPackagePath);
            }

            if (updated)
            {
                _blueprintTargetIndexDirty = true;
            }
        }

        private void PersistBlueprintTargetIndex()
        {
            if (!_blueprintTargetIndexDirty || _blueprintPackagePathsByTargetId == null || string.IsNullOrWhiteSpace(_blueprintTargetIndexPath))
            {
                return;
            }

            try
            {
                var directoryPath = Path.GetDirectoryName(_blueprintTargetIndexPath);
                if (!string.IsNullOrWhiteSpace(directoryPath))
                {
                    Directory.CreateDirectory(directoryPath);
                }

                var document = new FoxWatchBlueprintTargetIndexDocument
                {
                    FormatVersion = 1,
                    PakDirectoryPath = _pakDirectoryPath,
                    PakDirectorySignature = _pakDirectorySignature,
                    Targets = _blueprintPackagePathsByTargetId
                        .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                        .ToDictionary(
                            pair => pair.Key,
                            pair => pair.Value.OrderBy(path => path, StringComparer.Ordinal).ToArray(),
                            StringComparer.Ordinal),
                };

                var json = System.Text.Json.JsonSerializer.Serialize(document, BlueprintTargetIndexSerializerOptions);
                File.WriteAllText(_blueprintTargetIndexPath, $"{json}{Environment.NewLine}");
                _blueprintTargetIndexDirty = false;
            }
            catch
            {
            }
        }

        private static bool TryAddResolvedBlueprintPackagePaths(
            IReadOnlyDictionary<string, HashSet<string>> packagePathsByTargetId,
            string targetId,
            IReadOnlySet<string> availableBlueprintPackagePaths,
            ISet<string> resolvedPackagePaths)
        {
            if (!packagePathsByTargetId.TryGetValue(targetId, out var matchedPackagePaths) || matchedPackagePaths.Count == 0)
            {
                return false;
            }

            var resolved = false;
            foreach (var matchedPackagePath in matchedPackagePaths)
            {
                if (!availableBlueprintPackagePaths.Contains(matchedPackagePath))
                {
                    continue;
                }

                resolvedPackagePaths.Add(matchedPackagePath);
                resolved = true;
            }

            return resolved;
        }

        private static bool AddBlueprintTargetIndexEntry(
            IDictionary<string, HashSet<string>> packagePathsByTargetId,
            string? targetToken,
            string? packagePath)
        {
            var normalizedTargetToken = NormalizeStructureTargetToken(targetToken);
            var normalizedPackagePath = NormalizeString(packagePath).Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(normalizedTargetToken) || string.IsNullOrWhiteSpace(normalizedPackagePath))
            {
                return false;
            }

            if (!packagePathsByTargetId.TryGetValue(normalizedTargetToken, out var packagePaths))
            {
                packagePaths = new HashSet<string>(StringComparer.Ordinal);
                packagePathsByTargetId[normalizedTargetToken] = packagePaths;
            }

            return packagePaths.Add(normalizedPackagePath);
        }

        private static IEnumerable<string> EnumerateStructureTargetTokens(FoxWatchManifestStructure structure)
        {
            foreach (var rawValue in new[]
            {
                structure.Id,
                structure.CodeName,
                structure.LegacyKey,
            })
            {
                var targetToken = NormalizeStructureTargetToken(rawValue);
                if (!string.IsNullOrWhiteSpace(targetToken))
                {
                    yield return targetToken;
                }
            }

            foreach (var targetToken in EnumerateBlueprintPackageTargetTokens(ResolveBlueprintPackageTargetToken(structure.BlueprintPackagePath ?? string.Empty)))
            {
                yield return targetToken;
            }
        }

        private static string ComputePakDirectorySignature(string? pakDirectoryPath)
        {
            if (string.IsNullOrWhiteSpace(pakDirectoryPath) || !Directory.Exists(pakDirectoryPath))
            {
                return string.Empty;
            }

            var signatureBuilder = new StringBuilder();
            foreach (var filePath in Directory.EnumerateFiles(pakDirectoryPath, "*", SearchOption.TopDirectoryOnly)
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
            {
                var fileInfo = new FileInfo(filePath);
                signatureBuilder
                    .Append(Path.GetFileName(filePath))
                    .Append('|')
                    .Append(fileInfo.Length)
                    .Append('|')
                    .Append(fileInfo.LastWriteTimeUtc.Ticks)
                    .AppendLine();
            }

            using var sha256 = SHA256.Create();
            return Convert.ToHexString(sha256.ComputeHash(Encoding.UTF8.GetBytes(signatureBuilder.ToString())));
        }

        private FoxWatchManifestStructure? TryBuildStructure(
            dynamic obj,
            IReadOnlyCollection<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            string baseAssetsUrl,
            string? iconOutputDirectory,
            IDictionary<string, FoxWatchManifestCategory> categoriesById,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById,
            string? fallbackCodeName = null)
        {
            if (obj is UBlueprintGeneratedClass)
            {
                return null;
            }

            var codeNameText = NormalizeString(ExtractText((object?)obj.GetOrDefault<dynamic>("CodeName")));
            if (string.IsNullOrWhiteSpace(codeNameText))
            {
                codeNameText = NormalizeString(fallbackCodeName);
                if (string.IsNullOrWhiteSpace(codeNameText) || !IsWhitelistedNonCodeNameStructure(codeNameText))
                {
                    return null;
                }
            }

            var structureId = codeNameText.ToLowerInvariant();
            object? inheritedProperty(string propertyName) => GetInheritedBlueprintProperty(objects, blueprint, obj, propertyName);

            object? displayNameText = inheritedProperty("DisplayName") ?? (object?)obj.GetOrDefault<dynamic>("DisplayName");
            object? descriptionText = inheritedProperty("Description") ?? (object?)obj.GetOrDefault<dynamic>("Description");
            var displayName = ExtractLocalizedText(
                displayNameText,
                $"foxhole:structure:{structureId}:name",
                codeNameText,
                englishStrings,
                localizationReferencesById);
            var description = ExtractLocalizedText(
                descriptionText,
                $"foxhole:structure:{structureId}:description",
                string.Empty,
                englishStrings,
                localizationReferencesById);
            var blueprintPackagePath = GetPackagePath(blueprint);

            var rawBuildCategory = ExtractText(inheritedProperty("BuildCategory"));
            var itemCategoryId = ResolveItemCategoryId(
                inheritedProperty("ItemCategory"),
                inheritedProperty("ItemProfileType"),
                inheritedProperty("UniformType"));
            var buildOrderValue = ExtractNullableInt(GetNamedValue(obj, "BuildOrder"))
                ?? ExtractNullableInt(inheritedProperty("BuildOrder"));
            var buildOrder = buildOrderValue ?? 0;
            var categoryId = ResolveStructureCategoryId(structureId, codeNameText, rawBuildCategory, itemCategoryId, buildOrderValue);

            var categoryDisplayName = HumanizeCategory(categoryId);
            var categoryLocalizationId = $"foxhole:category:{categoryId}:name";
            if (!categoriesById.ContainsKey(categoryId))
            {
                categoriesById[categoryId] = new FoxWatchManifestCategory
                {
                    Id = categoryId,
                    Name = CreateLocalizedText(categoryLocalizationId, categoryDisplayName, englishStrings),
                    IconUrl = null,
                    Order = int.MaxValue,
                };
            }

            var faction = ExtractText(inheritedProperty("FactionVariant")) switch
            {
                "EFactionId::Colonials" => "c",
                "EFactionId::Wardens" => "w",
                _ => null,
            };

            int? tier = null;
            var tierText = ExtractText(inheritedProperty("Tier"));
            var rawTier = tierText.Split("::", StringSplitOptions.None).LastOrDefault();
            if (!string.IsNullOrWhiteSpace(rawTier))
            {
                var digits = new string(rawTier.Where(character => char.IsDigit(character)).ToArray());
                if (int.TryParse(digits, out var parsedTier))
                {
                    tier = parsedTier;
                }
            }

            string? iconUrl = null;
            string? subTypeIconUrl = null;
            double? spriteWidth = null;
            double? spriteHeight = null;
            var rawIconValue = inheritedProperty("Icon");
            var rawIconPackagePath = ResolveReferencedPackagePath(rawIconValue);
            if (!IsExplicitAssetIconAllowed(rawIconPackagePath))
            {
                rawIconValue = null;
            }
            var iconTexture = ResolveTextureProperty(rawIconValue);
            if (iconTexture != null)
            {
                spriteWidth = iconTexture.ImportedSize.X > 0 ? iconTexture.ImportedSize.X : iconTexture.PlatformData.SizeX;
                spriteHeight = iconTexture.ImportedSize.Y > 0 ? iconTexture.ImportedSize.Y : iconTexture.PlatformData.SizeY;
                iconUrl = ExportStructureIcon(structureId, iconTexture, baseAssetsUrl, iconOutputDirectory);
            }

            var rawSubTypeIconValue = inheritedProperty("SubTypeIcon");
            subTypeIconUrl = ExportReferencedIcon(rawSubTypeIconValue, $"{structureId}-subtype", baseAssetsUrl, iconOutputDirectory);

            var techId = ExtractTechId(inheritedProperty);
            var variants = CreateTextureVariants(null);
            var colors = ExtractStructureColors(inheritedProperty("Colors"));
            var destroyedComponentName = ResolveDestroyedComponentName(inheritedProperty("DestroyedMesh"));
            var packagedMeshPackagePath = ResolveReferencedPackagePath(inheritedProperty("PackagedMesh"));
            var shippableInfoValue = inheritedProperty("ShippableInfo");
            var shippableType = ResolveShippableType(shippableInfoValue);
            var buildSockets = ExtractBuildSockets(objects, blueprint, obj);
            var craneSpawns = ExtractCraneSpawns(objects, blueprint, obj);
            var supportsEmplacedStructures = ExtractBoolValue(inheritedProperty("bSupportsEmplacedStructures")) == true;
            var emplacementLocation = ExtractEmplacementLocation(objects, blueprint, obj);
            var isEmplacedWeapon = IsEmplacedWeaponBlueprint(blueprint);
            var buildFootprintBoxes = ExtractBuildFootprintBoxes(objects, blueprint, obj);
            var structureVolumes = MergeStructureVolumes(
                ExtractStructureVolumes(objects, blueprint, obj),
                BuildFootprintStructureVolumes(buildFootprintBoxes));

            var vehicleSeats = ExtractVehicleSeats(objects, blueprint, baseAssetsUrl, iconOutputDirectory);
            var spotlights = ExtractSpotlights(objects, blueprint);
            var fuelTanks = ExtractFuelTanks(inheritedProperty("FuelTanks"));
            var stockpile = ExtractStockpile(objects, blueprint);
            var specializedFactoryMetadata = ExtractSpecializedFactoryMetadata(objects, blueprint);
            var conversionEntries = ExtractConversionEntries(inheritedProperty("ConversionEntries"));
            conversionEntries.AddRange(ExtractRefinableConversionEntries(inheritedProperty("RefinableItems")));
            conversionEntries.AddRange(specializedFactoryMetadata.ConversionEntries);
            var fortUpgradeCodeNames = EnumerateFortUpgradeStructureCodeNames(inheritedProperty("FortUpgrades")).ToList();
            var modifications = ExtractModifications(
                objects,
                blueprint,
                structureId,
                tier,
                inheritedProperty("Modifications"),
                englishStrings,
                localizationReferencesById);
            var modificationSlots = ExtractModificationSlots(
                objects,
                blueprint,
                structureId,
                tier,
                baseAssetsUrl,
                iconOutputDirectory,
                englishStrings,
                localizationReferencesById);
            var vehicleBuildType = NullIfWhiteSpace(NormalizeEnumValue(inheritedProperty("VehicleBuildType")));
            var profileType = NullIfWhiteSpace(NormalizeEnumValue(inheritedProperty("ProfileType")));
            var isVehicle = HasBlueprintOwnedComponentType(objects, blueprint, "VehicleSeatComponent")
                || IsVehicleProxyProfileType(profileType)
                || HasVehicleCollisionStructureVolume(structureVolumes);
            var armourType = NullIfWhiteSpace(NormalizeEnumValue(inheritedProperty("ArmourType")));
            var hasPackagedVisual = !string.IsNullOrWhiteSpace(packagedMeshPackagePath)
                || !string.IsNullOrWhiteSpace(shippableType);
            var upgradeStructureCodeName = NullIfWhiteSpace(NormalizeString(ExtractText(inheritedProperty("UpgradeStructureCodeName"))));
            var referencedBuildSiteCodeName = ResolveReferencedStructureCodeName(inheritedProperty("BuildSiteClass"));
            var referencedBuildSiteBlueprintPackagePath = ResolveReferencedPackagePath(inheritedProperty("BuildSiteClass"));
            var conversionCodeNames = MergeDistinctCodeNames(
                ExtractCodeNames(inheritedProperty("ConversionCodeNames")),
                fortUpgradeCodeNames);
            var destroyedStructureCodeName = ResolveReferencedStructureCodeName(inheritedProperty("BaseStructureClass"));
            var validBuildTools = ExtractDouble(inheritedProperty("ValidBuildTools"));
            var isDestroyed = ComputeIsDestroyedStructure(obj, blueprint, isVehicle, profileType, armourType);
            var isBreached = ComputeIsBreachedStructure(codeNameText, upgradeStructureCodeName);
            var extractedCost = ExtractStructureCost(inheritedProperty);
            var extractedRepairCost = ExtractNullableIntFromCandidates(inheritedProperty, "RepairCost");
            var constructionDynamicData = ResolveConstructionDynamicDataEntry(codeNameText);
            if (isDestroyed || isBreached)
            {
                // Destroyed/breached husks are not editable hosts — they must not expose
                // modification catalogs or inflate shared-modification consumer counts.
                modifications = new Dictionary<string, FoxWatchManifestModification>(StringComparer.OrdinalIgnoreCase);
                modificationSlots = [];
                subTypeIconUrl = ExportReferencedIcon(WreckedSubTypeIconObjectPath, "subtypewreckedicon", baseAssetsUrl, iconOutputDirectory) ?? subTypeIconUrl;
            }

            var isItem = !string.IsNullOrWhiteSpace(itemCategoryId);
            var ranges = ExtractRanges(objects, blueprint, obj);
            NormalizeKnownVehicleComponentFrames(codeNameText, vehicleSeats, spotlights, ranges);
            var connector = ExtractConnector(blueprint, inheritedProperty);
            buildSockets = EnsureConnectorEndpointBuildSockets(buildSockets, connector);
            buildSockets = CollapseLogicalBuildSocketDuplicates(buildSockets, connector);
            buildSockets = ApplyEntrenchmentSocketVisibilityTags(buildSockets);

            var structure = new FoxWatchManifestStructure
            {
                Id = structureId,
                CodeName = codeNameText,
                Name = CreateLocalizedText($"foxhole:structure:{structureId}:name", displayName, englishStrings),
                Description = CreateLocalizedText($"foxhole:structure:{structureId}:description", description, englishStrings),
                CategoryId = categoryId,
                CategoryName = CreateLocalizedText(categoryLocalizationId, categoryDisplayName, englishStrings),
                CategoryIconUrl = categoriesById[categoryId].IconUrl,
                BuildOrder = buildOrder,
                PreviewIconUrl = null,
                IconUrl = iconUrl,
                SubTypeIconUrl = subTypeIconUrl,
                PreviewUrl = null,
                PreviewDirection = null,
                GenerateDefaultIcon = !isItem && string.IsNullOrWhiteSpace(iconUrl) ? true : null,
                ClipFloor = null,
                ClipFloorZ = null,
                IsVehicle = isVehicle,
                IsDestroyed = isDestroyed ? true : null,
                IsBreached = isBreached ? true : null,
                CanBlueprint = validBuildTools is > 0 ? true : null,
                IsItem = isItem,
                Sprite = new FoxWatchSprite
                {
                    Width = spriteWidth,
                    Height = spriteHeight,
                },
                Variants = variants,
                Colors = colors,
                Destroyed = string.IsNullOrWhiteSpace(destroyedComponentName)
                    ? null
                    : new FoxWatchManifestDestroyedVisual
                    {
                        ComponentName = destroyedComponentName,
                    },
                Packaged = hasPackagedVisual
                    ? new FoxWatchManifestPackagedVisual
                    {
                        MeshPackagePath = packagedMeshPackagePath,
                        ShippableType = shippableType,
                    }
                    : null,
                Faction = faction,
                VehicleBuildType = vehicleBuildType,
                Tier = tier,
                TechId = techId,
                bIsBuiltOnFoundation = ExtractBoolValue(inheritedProperty("bIsBuiltOnFoundation")),
                bBuildOnWater = ExtractBoolValue(inheritedProperty("bBuildOnWater")),
                bIsBuiltOnLandscape = ExtractBoolValue(inheritedProperty("bIsBuiltOnLandscape")),
                SupportsEmplacedStructures = supportsEmplacedStructures,
                IsEmplacedWeapon = isEmplacedWeapon,
                EmplacementLocation = emplacementLocation,
                BuildLocationType = NullIfWhiteSpace(NormalizeEnumValue(inheritedProperty("BuildLocationType"))),
                UpgradeStructureCodeName = upgradeStructureCodeName,
                ConversionCodeNames = conversionCodeNames,
                DestroyedStructureCodeName = destroyedStructureCodeName,
                BlueprintPackagePath = blueprintPackagePath,
                ReferencedBuildSiteCodeName = referencedBuildSiteCodeName,
                ReferencedBuildSiteBlueprintPackagePath = referencedBuildSiteBlueprintPackagePath,
                ProfileType = profileType,
                ArmourType = armourType,
                MapIntelligenceType = NullIfWhiteSpace(NormalizeEnumValue(inheritedProperty("MapIntelligenceType"))),
                PowerGridInfo = ExtractPowerGridInfo(inheritedProperty("PowerGridInfo")),
                Connector = connector,
                Cost = extractedCost.Count > 0
                    ? extractedCost
                    : (constructionDynamicData != null && constructionDynamicData.Cost.Count > 0
                        ? CloneRecipeResources(constructionDynamicData.Cost)
                        : new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal)),
                RepairCost = extractedRepairCost ?? constructionDynamicData?.RepairCost,
                StructuralIntegrity = constructionDynamicData?.StructuralIntegrity,
                InventorySlots = constructionDynamicData?.InventorySlots,
                Stockpile = stockpile,
                HoldProfile = BuildHoldProfile(stockpile, fuelTanks, constructionDynamicData, codeNameText),
                MaxHealth = ExtractNullableInt(inheritedProperty("MaxHealth")),
                MaxOrders = ExtractNullableInt(inheritedProperty("MaxOrders")) ?? specializedFactoryMetadata.MaxQueueSize,
                BuildSockets = buildSockets,
                CraneSpawns = craneSpawns,
                FootprintPolygons = BuildFootprintPolygons(buildFootprintBoxes),
                StructureVolumes = structureVolumes,
                VehicleSeats = vehicleSeats,
                Spotlights = spotlights,
                FuelTanks = fuelTanks,
                ConversionEntries = conversionEntries,
                Ranges = ranges,
                Modifications = modifications,
                ModificationSlots = modificationSlots.Count > 0 ? modificationSlots : null,
                HideInList = false,
                IsUpgrade = false,
                UpgradeName = null,
                RenderLayers = ExtractStructureRenderLayers(structureId, blueprintPackagePath, profileType, buildSockets),
            };

            ApplyModificationUpgradeClassification(structure);

            return structure;
        }

        private static bool IsUpgradeSlotComponentType(string? componentType, string? slotName)
        {
            var normalizedComponentType = NormalizeString(componentType);
            var normalizedSlotName = NormalizeString(slotName);
            return normalizedComponentType.Contains("UpgradeSlotComponent", StringComparison.OrdinalIgnoreCase)
                || normalizedSlotName.Contains("UpgradeSlot", StringComparison.OrdinalIgnoreCase);
        }

        private static void ApplyModificationUpgradeClassification(FoxWatchManifestStructure structure)
        {
            if (structure.Modifications.Count == 0)
            {
                return;
            }

            var hasUpgradeSlot = structure.ModificationSlots?.Any(slot =>
                IsUpgradeSlotComponentType(slot.ComponentType, slot.Name)) == true;

            foreach (var modification in structure.Modifications.Values)
            {
                var isUpgrade = hasUpgradeSlot
                    && !string.Equals(NormalizeModificationVariantId(modification.CodeName), "default", StringComparison.OrdinalIgnoreCase);
                modification.IsUpgrade = isUpgrade;

                if (!isUpgrade)
                {
                    modification.UpgradeName = null;
                    modification.ParentStructureId = null;
                    modification.RootStructureId = null;
                    modification.AppliedModificationId = null;
                }
            }
        }

        private List<FoxWatchManifestStructureRenderLayer>? ExtractStructureRenderLayers(
            string structureId,
            string? blueprintPackagePath,
            string? profileType,
            IReadOnlyList<FoxWatchManifestBuildSocket> buildSockets)
        {
            if (IsStandaloneDestroyedOrBreachedStructure(structureId, profileType))
            {
                return null;
            }

            if (IsFortForwardBaseStructure(structureId))
            {
                return null;
            }

            var foundationRenderLayers = ExtractFoundationStructureRenderLayers(structureId, blueprintPackagePath);
            if (foundationRenderLayers != null)
            {
                return foundationRenderLayers;
            }

            if (string.Equals(profileType, "Trench", StringComparison.OrdinalIgnoreCase))
            {
                return ExtractTrenchStructureRenderLayers(blueprintPackagePath);
            }

            if (!ShouldExtractFortEntrenchmentRenderLayers(profileType, buildSockets, blueprintPackagePath))
            {
                return null;
            }

            return ExtractFortEntrenchmentStructureRenderLayers(structureId, blueprintPackagePath, buildSockets);
        }

        private List<FoxWatchManifestStructureRenderLayer>? ExtractTrenchStructureRenderLayers(string? blueprintPackagePath)
        {
            if (string.IsNullOrWhiteSpace(blueprintPackagePath) || _meshAssetExporter == null)
            {
                return null;
            }

            try
            {
                var componentReferences = _meshAssetExporter
                    .InspectBlueprintComponentsAsync(blueprintPackagePath)
                    .GetAwaiter()
                    .GetResult();
                var renderLayers = new List<FoxWatchManifestStructureRenderLayer>();

                foreach (var componentReference in componentReferences)
                {
                    if (IsTrenchFloorComponentReference(componentReference))
                    {
                        if (!renderLayers.Any(layer =>
                                string.Equals(layer.Id, "floor", StringComparison.OrdinalIgnoreCase)))
                        {
                            renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                            {
                                Id = "floor",
                                ComponentName = componentReference.ComponentName,
                                ComponentTags = [],
                            });
                        }

                        continue;
                    }

                    if (TryResolveTrenchDirectionalWallRenderLayer(
                            componentReference,
                            out var wallLayerId,
                            out var wallTags))
                    {
                        if (renderLayers.Any(layer =>
                                string.Equals(layer.Id, wallLayerId, StringComparison.OrdinalIgnoreCase)))
                        {
                            continue;
                        }

                        renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                        {
                            Id = wallLayerId,
                            ComponentName = componentReference.ComponentName,
                            ComponentTags = wallTags,
                        });
                        continue;
                    }

                    if (TryResolveTrenchCornerRenderLayer(
                            componentReference,
                            out var cornerLayerId,
                            out var cornerTags))
                    {
                        if (renderLayers.Any(layer =>
                                string.Equals(layer.Id, cornerLayerId, StringComparison.OrdinalIgnoreCase)))
                        {
                            continue;
                        }

                        renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                        {
                            Id = cornerLayerId,
                            ComponentName = componentReference.ComponentName,
                            ComponentTags = cornerTags,
                        });
                    }
                }

                return renderLayers.Count > 0 ? renderLayers : null;
            }
            catch
            {
                return null;
            }
        }

        private static bool IsTrenchFloorComponentReference(FoxWatchBlueprintComponentReference componentReference)
        {
            if (string.IsNullOrWhiteSpace(componentReference.MeshPath) ||
                IsFortEntrenchmentDirtFillMesh(componentReference.MeshPath) ||
                IsTrenchNonFloorMeshComponent(componentReference))
            {
                return false;
            }

            return string.Equals(
                GetTrenchComponentShortName(componentReference.ComponentName),
                "Floor",
                StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsTrenchNonFloorMeshComponent(FoxWatchBlueprintComponentReference componentReference)
        {
            var shortName = GetTrenchComponentShortName(componentReference.ComponentName);
            if (shortName.Contains("puddle", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            var meshFileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath ?? string.Empty);
            return meshFileName.Contains("puddle", StringComparison.OrdinalIgnoreCase);
        }

        private static bool TryResolveTrenchDirectionalWallRenderLayer(
            FoxWatchBlueprintComponentReference componentReference,
            out string layerId,
            out List<string> componentTags)
        {
            layerId = string.Empty;
            componentTags = [];

            if (string.IsNullOrWhiteSpace(componentReference.MeshPath) ||
                IsFortEntrenchmentDirtFillMesh(componentReference.MeshPath) ||
                IsTrenchNonFloorMeshComponent(componentReference))
            {
                return false;
            }

            var shortName = GetTrenchComponentShortName(componentReference.ComponentName);
            switch (shortName)
            {
                case "WallBack":
                    layerId = "backwall";
                    componentTags = ["Back"];
                    return true;
                case "WallFront":
                    layerId = "frontwall";
                    componentTags = ["Front"];
                    return true;
                case "WallLeft":
                    layerId = "leftwall";
                    componentTags = ["Left"];
                    return true;
                case "WallRight":
                    layerId = "rightwall";
                    componentTags = ["Right"];
                    return true;
                case "OpenWallLeft":
                    layerId = "openwallleft";
                    componentTags = ["Left"];
                    return true;
                case "OpenWallRight":
                    layerId = "openwallright";
                    componentTags = ["Right"];
                    return true;
                default:
                    return false;
            }
        }

        private static bool TryResolveTrenchCornerRenderLayer(
            FoxWatchBlueprintComponentReference componentReference,
            out string layerId,
            out List<string> componentTags)
        {
            layerId = string.Empty;
            componentTags = [];

            if (string.IsNullOrWhiteSpace(componentReference.MeshPath) ||
                IsFortEntrenchmentDirtFillMesh(componentReference.MeshPath))
            {
                return false;
            }

            var shortName = GetTrenchComponentShortName(componentReference.ComponentName);
            if (!shortName.StartsWith("Corner", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            layerId = shortName.ToLowerInvariant();
            componentTags = DeriveDirectionalTagsFromComponentName(shortName);
            return componentTags.Count > 0;
        }

        private static string GetTrenchComponentShortName(string? componentName)
        {
            var normalizedComponentName = NormalizeComponentReferenceName(componentName);
            var separatorIndex = normalizedComponentName.LastIndexOf(':');
            if (separatorIndex >= 0 && separatorIndex + 1 < normalizedComponentName.Length)
            {
                return normalizedComponentName[(separatorIndex + 1)..];
            }

            return normalizedComponentName;
        }

        private List<FoxWatchManifestStructureRenderLayer>? ExtractFoundationStructureRenderLayers(
            string structureId,
            string? blueprintPackagePath)
        {
            if (string.IsNullOrWhiteSpace(blueprintPackagePath) ||
                !IsFacilityFoundationBlueprintPackagePath(blueprintPackagePath) ||
                _meshAssetExporter == null)
            {
                return null;
            }

            try
            {
                var componentReferences = _meshAssetExporter
                    .InspectBlueprintComponentsAsync(blueprintPackagePath)
                    .GetAwaiter()
                    .GetResult();
                var renderLayers = new List<FoxWatchManifestStructureRenderLayer>();

                foreach (var componentReference in componentReferences)
                {
                    if (IsFoundationFloorComponentReference(componentReference))
                    {
                        renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                        {
                            Id = "floor",
                            ComponentName = componentReference.ComponentName,
                            ComponentTags = [],
                        });
                        continue;
                    }

                    if (!IsFoundationBorderTrimComponentReference(componentReference))
                    {
                        continue;
                    }

                    renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                    {
                        Id = NormalizeFoundationRenderLayerId(componentReference.ComponentName),
                        ComponentName = componentReference.ComponentName,
                        ComponentTags =
                        [
                            .. componentReference.ComponentTags
                                .Select(tag => tag?.Trim() ?? string.Empty)
                                .Where(tag => !string.IsNullOrWhiteSpace(tag)),
                        ],
                    });
                }

                if (renderLayers.Count > 0)
                {
                    ApplyFoundationRenderLayerVisibilityTagCorrections(structureId, renderLayers);
                    return renderLayers;
                }

                return null;
            }
            catch
            {
                return null;
            }
        }

        private static void ApplyFoundationRenderLayerVisibilityTagCorrections(
            string? structureId,
            List<FoxWatchManifestStructureRenderLayer> renderLayers)
        {
            if (!string.Equals(structureId, "foundation011x2t1", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(structureId, "foundation011x2t3", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            foreach (var layer in renderLayers)
            {
                if (string.Equals(layer.Id, "frontleftpillar", StringComparison.OrdinalIgnoreCase))
                {
                    layer.ComponentTags = ["Front", "Left2"];
                }
                else if (string.Equals(layer.Id, "frontrightpillar", StringComparison.OrdinalIgnoreCase))
                {
                    layer.ComponentTags = ["Front", "Right2"];
                }
            }
        }

        private static bool IsFacilityFoundationBlueprintPackagePath(string blueprintPackagePath)
        {
            var normalizedPath = blueprintPackagePath.Replace('\\', '/');
            var fileName = Path.GetFileNameWithoutExtension(normalizedPath);
            return fileName.StartsWith("BPFoundation", StringComparison.OrdinalIgnoreCase) &&
                !fileName.Contains("railtracksplinefoundation", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsFoundationFloorComponentReference(FoxWatchBlueprintComponentReference componentReference)
        {
            return string.Equals(
                NormalizeComponentReferenceName(componentReference.ComponentName),
                "Foundation",
                StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(componentReference.MeshPath);
        }

        private static bool IsFoundationBorderTrimComponentReference(FoxWatchBlueprintComponentReference componentReference)
        {
            if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
            {
                return false;
            }

            var normalizedComponentName = NormalizeComponentReferenceName(componentReference.ComponentName);
            return normalizedComponentName.Contains("border", StringComparison.OrdinalIgnoreCase) ||
                normalizedComponentName.Contains("pillar", StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeFoundationRenderLayerId(string componentName)
        {
            return NormalizeComponentReferenceName(componentName).ToLowerInvariant();
        }

        private static List<FoxWatchManifestBuildSocket> ApplyEntrenchmentSocketVisibilityTags(
            IReadOnlyList<FoxWatchManifestBuildSocket> buildSockets)
        {
            if (buildSockets.Count == 0)
            {
                return [];
            }

            return
            [
                .. buildSockets.Select(socket =>
                {
                    var visibilityTag = ResolveEntrenchmentSocketVisibilityTag(socket.Name, socket.ComponentType);
                    if (string.IsNullOrWhiteSpace(visibilityTag))
                    {
                        return socket;
                    }

                    if (socket.SocketTags.Any(tag => !string.IsNullOrWhiteSpace(tag.Tag)))
                    {
                        return socket;
                    }

                    var socketTags = socket.SocketTags.Count > 0
                        ? socket.SocketTags.Select(CloneSocketTag).ToList()
                        : [new FoxWatchManifestSocketTag()];
                    socketTags[0].Tag = visibilityTag;

                    return new FoxWatchManifestBuildSocket
                    {
                        Name = socket.Name,
                        ComponentType = socket.ComponentType,
                        PipeType = socket.PipeType,
                        SocketTags = socketTags,
                        X = socket.X,
                        Y = socket.Y,
                        Z = socket.Z,
                        Rotation = socket.Rotation,
                    };
                }),
            ];
        }

        private static FoxWatchManifestSocketTag CloneSocketTag(FoxWatchManifestSocketTag tag)
        {
            return new FoxWatchManifestSocketTag
            {
                Mask = tag.Mask,
                Category = tag.Category,
                Tag = tag.Tag,
            };
        }

        private static bool ShouldExtractFortEntrenchmentRenderLayers(
            string? profileType,
            IReadOnlyList<FoxWatchManifestBuildSocket> buildSockets,
            string? blueprintPackagePath)
        {
            if (IsDestroyedOrBreachedEntrenchmentProfileType(profileType))
            {
                return false;
            }

            if (IsFacilityFoundationBlueprintPackagePath(blueprintPackagePath ?? string.Empty))
            {
                return false;
            }

            if (UsesFortEntrenchmentProfileType(profileType))
            {
                return true;
            }

            if (HasFortDirectionalBuildSockets(buildSockets))
            {
                return true;
            }

            return IsFortEntrenchmentBlueprintPackagePath(blueprintPackagePath);
        }

        private static bool UsesFortEntrenchmentProfileType(string? profileType)
        {
            return string.Equals(profileType, "FortBase", StringComparison.OrdinalIgnoreCase)
                || string.Equals(profileType, "Fort", StringComparison.OrdinalIgnoreCase)
                || string.Equals(profileType, "FortRotatableUpgrade", StringComparison.OrdinalIgnoreCase)
                || string.Equals(profileType, "FortForwardBase", StringComparison.OrdinalIgnoreCase);
        }

        private static bool HasFortDirectionalBuildSockets(IReadOnlyList<FoxWatchManifestBuildSocket> buildSockets)
        {
            return buildSockets.Any(socket =>
                !string.IsNullOrWhiteSpace(ResolveFortEntrenchmentSocketVisibilityTag(socket.Name, socket.ComponentType)));
        }

        private static bool IsFortEntrenchmentBlueprintPackagePath(string? blueprintPackagePath)
        {
            if (string.IsNullOrWhiteSpace(blueprintPackagePath))
            {
                return false;
            }

            var normalizedPath = blueprintPackagePath.Replace('\\', '/');
            return normalizedPath.Contains("/FortTrenches/", StringComparison.OrdinalIgnoreCase)
                || normalizedPath.Contains("/Forts/", StringComparison.OrdinalIgnoreCase)
                || normalizedPath.Contains("/Bunker", StringComparison.OrdinalIgnoreCase);
        }

        private List<FoxWatchManifestStructureRenderLayer>? ExtractFortEntrenchmentStructureRenderLayers(
            string structureId,
            string? blueprintPackagePath,
            IReadOnlyList<FoxWatchManifestBuildSocket> buildSockets)
        {
            if (string.IsNullOrWhiteSpace(blueprintPackagePath) || _meshAssetExporter == null)
            {
                return null;
            }

            try
            {
                var componentReferences = _meshAssetExporter
                    .InspectBlueprintComponentsAsync(blueprintPackagePath)
                    .GetAwaiter()
                    .GetResult();
                var renderLayers = new List<FoxWatchManifestStructureRenderLayer>();

                foreach (var componentReference in componentReferences)
                {
                    if (IsFortEntrenchmentFloorComponentReference(componentReference))
                    {
                        if (renderLayers.Any(layer =>
                                string.Equals(layer.Id, "floor", StringComparison.OrdinalIgnoreCase)))
                        {
                            continue;
                        }

                        renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                        {
                            Id = "floor",
                            ComponentName = componentReference.ComponentName,
                            ComponentTags = [],
                        });
                        continue;
                    }

                    if (IsFortEntrenchmentRoofRenderComponent(componentReference))
                    {
                        if (!renderLayers.Any(layer =>
                                string.Equals(layer.Id, "roof", StringComparison.OrdinalIgnoreCase)))
                        {
                            renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                            {
                                Id = "roof",
                                ComponentName = componentReference.ComponentName,
                                ComponentTags = [],
                            });
                        }

                        continue;
                    }

                    if (TryResolveFortModSlotWallRenderLayer(componentReference, out var wallLayerId, out var wallTags))
                    {
                        if (renderLayers.Any(layer =>
                                string.Equals(layer.Id, wallLayerId, StringComparison.OrdinalIgnoreCase)))
                        {
                            continue;
                        }

                        renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                        {
                            Id = wallLayerId,
                            ComponentName = ResolveFortModSlotWallLayerComponentName(componentReference),
                            ComponentTags = wallTags,
                        });
                        continue;
                    }

                    if (!IsFortEntrenchmentVisibilityComponentReference(componentReference))
                    {
                        continue;
                    }

                    renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                    {
                        Id = NormalizeFortEntrenchmentRenderLayerId(componentReference.ComponentName),
                        ComponentName = componentReference.ComponentName,
                        ComponentTags = ResolveFortEntrenchmentRenderLayerComponentTags(
                            componentReference.ComponentName,
                            componentReference.ComponentTags),
                    });
                }

                EnsureFortModSlotWallRenderLayers(renderLayers, buildSockets, componentReferences);
                EnsureFortEntrenchmentRoofRenderLayer(renderLayers, componentReferences);

                return renderLayers.Count > 0 ? renderLayers : null;
            }
            catch
            {
                return null;
            }
        }

        private static bool IsFortEntrenchmentFloorComponentReference(FoxWatchBlueprintComponentReference componentReference)
        {
            if (string.IsNullOrWhiteSpace(componentReference.MeshPath) ||
                IsFortEntrenchmentDirtFillMesh(componentReference.MeshPath))
            {
                return false;
            }

            return string.Equals(
                NormalizeComponentReferenceName(componentReference.ComponentName),
                "Floor",
                StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsFortEntrenchmentVisibilityComponentReference(FoxWatchBlueprintComponentReference componentReference)
        {
            if (string.IsNullOrWhiteSpace(componentReference.MeshPath) ||
                IsFortEntrenchmentDirtFillMesh(componentReference.MeshPath))
            {
                return false;
            }

            var normalizedComponentName = NormalizeComponentReferenceName(componentReference.ComponentName);
            if (string.Equals(normalizedComponentName, "Floor", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(normalizedComponentName, "Roof", StringComparison.OrdinalIgnoreCase) ||
                IsFortEntrenchmentRoofRenderComponent(componentReference))
            {
                return false;
            }

            if (IsFortEntrenchmentBreachedWallComponentReference(componentReference))
            {
                return false;
            }

            if (TryResolveFortModSlotWallRenderLayer(componentReference, out _, out _))
            {
                return false;
            }

            if (componentReference.ComponentTags.Any(tag => MapFortSideTagToVisibilityTag(tag) != null))
            {
                return normalizedComponentName.Contains("corner", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("wall", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("border", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("trim", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("pillar", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("ramp", StringComparison.OrdinalIgnoreCase)
                    || ContainsDirectionalComponentNameToken(normalizedComponentName);
            }

            if (ContainsDirectionalComponentNameToken(normalizedComponentName))
            {
                return normalizedComponentName.Contains("wall", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("corner", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("border", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("trim", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("pillar", StringComparison.OrdinalIgnoreCase)
                    || normalizedComponentName.Contains("ramp", StringComparison.OrdinalIgnoreCase)
                    || IsFortEntrenchmentMeshPath(componentReference.MeshPath);
            }

            return false;
        }

        private static bool IsFortEntrenchmentRoofRenderComponent(FoxWatchBlueprintComponentReference componentReference)
        {
            if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
            {
                return false;
            }

            var normalizedComponentName = NormalizeComponentReferenceName(componentReference.ComponentName);
            if (!string.Equals(normalizedComponentName, "Roof", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var meshFileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath);
            return meshFileName.Contains("roof", StringComparison.OrdinalIgnoreCase)
                && !meshFileName.Contains("dirt", StringComparison.OrdinalIgnoreCase);
        }

        private static void EnsureFortEntrenchmentRoofRenderLayer(
            List<FoxWatchManifestStructureRenderLayer> renderLayers,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            if (renderLayers.Any(layer => string.Equals(layer.Id, "roof", StringComparison.OrdinalIgnoreCase)))
            {
                return;
            }

            var roofModSlotComponentName = ResolveFortRoofModSlotLayerComponentName(componentReferences);
            if (!string.IsNullOrWhiteSpace(roofModSlotComponentName))
            {
                renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                {
                    Id = "roof",
                    ComponentName = roofModSlotComponentName,
                    ComponentTags = [],
                });
                return;
            }

            var roofComponent = componentReferences.FirstOrDefault(IsFortEntrenchmentRoofRenderComponent);
            if (roofComponent != null)
            {
                renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                {
                    Id = "roof",
                    ComponentName = roofComponent.ComponentName,
                    ComponentTags = [],
                });
                return;
            }

            var aiTurretGunComponent = componentReferences.FirstOrDefault(IsFortEntrenchmentAiTurretGunRenderComponent);
            if (aiTurretGunComponent == null)
            {
                return;
            }

            renderLayers.Add(new FoxWatchManifestStructureRenderLayer
            {
                Id = "roof",
                ComponentName = aiTurretGunComponent.ComponentName,
                ComponentTags = [],
            });
        }

        private static bool IsFortEntrenchmentAiTurretGunRenderComponent(FoxWatchBlueprintComponentReference componentReference)
        {
            if (string.IsNullOrWhiteSpace(componentReference.MeshPath) ||
                !componentReference.ComponentType.Contains("SkeletalMeshComponent", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var normalizedMeshPath = componentReference.MeshPath.Replace('\\', '/');
            if (!normalizedMeshPath.Contains("/AIBunkers/", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var meshFileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath);
            if (meshFileName.Contains("husk", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return string.Equals(
                NormalizeComponentReferenceName(componentReference.AttachParentName),
                "StructureArrow",
                StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsDestroyedOrBreachedEntrenchmentProfileType(string? profileType)
        {
            return string.Equals(profileType, "DestroyedFort", StringComparison.OrdinalIgnoreCase)
                || string.Equals(profileType, "DestroyedStructure", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsStandaloneDestroyedOrBreachedStructure(string structureId, string? profileType)
        {
            if (IsDestroyedOrBreachedEntrenchmentProfileType(profileType))
            {
                return true;
            }

            return structureId.Contains("destroyed", StringComparison.OrdinalIgnoreCase)
                || structureId.Contains("breached", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsFortForwardBaseStructure(string structureId)
        {
            return structureId.StartsWith("fortbaset", StringComparison.OrdinalIgnoreCase);
        }

        private static string? ResolveFortRoofModSlotLayerComponentName(
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            foreach (var componentReference in componentReferences)
            {
                var componentName = componentReference.ComponentName ?? string.Empty;
                var roofModSlotIndex = componentName.IndexOf("FortRoofModSlot", StringComparison.OrdinalIgnoreCase);
                if (roofModSlotIndex < 0)
                {
                    continue;
                }

                return componentName[..(roofModSlotIndex + "FortRoofModSlot".Length)];
            }

            return null;
        }

        private static bool IsFortEntrenchmentBreachedWallComponentReference(FoxWatchBlueprintComponentReference componentReference)
        {
            var normalizedComponentName = NormalizeComponentReferenceName(componentReference.ComponentName);
            return normalizedComponentName.Contains("breached", StringComparison.OrdinalIgnoreCase);
        }

        private static bool TryResolveFortModSlotWallRenderLayer(
            FoxWatchBlueprintComponentReference componentReference,
            out string layerId,
            out List<string> componentTags)
        {
            layerId = string.Empty;
            componentTags = [];

            if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
            {
                return false;
            }

            var meshFileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath);
            if (!meshFileName.Contains("wall", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var direction = ResolveFortModSlotDirection(
                componentReference.ComponentName,
                componentReference.AttachParentName);
            if (string.IsNullOrWhiteSpace(direction))
            {
                return false;
            }

            layerId = $"{direction.ToLowerInvariant()}wall";
            componentTags = [direction];
            return true;
        }

        private static string ResolveFortModSlotWallLayerComponentName(FoxWatchBlueprintComponentReference componentReference)
        {
            var direction = ResolveFortModSlotDirection(
                componentReference.ComponentName,
                componentReference.AttachParentName);
            if (string.IsNullOrWhiteSpace(direction))
            {
                return componentReference.ComponentName;
            }

            return $"FortCommonMods:{direction}ModSlot";
        }

        private static string? ResolveFortModSlotDirection(string? componentName, string? attachParentName)
        {
            var context = $"{NormalizeComponentReferenceName(componentName)}:{NormalizeComponentReferenceName(attachParentName)}";
            if (context.Contains("backinframodslot", StringComparison.OrdinalIgnoreCase) ||
                context.Contains("frontinframodslot", StringComparison.OrdinalIgnoreCase) ||
                context.Contains("leftinframodslot", StringComparison.OrdinalIgnoreCase) ||
                context.Contains("rightinframodslot", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            if (context.Contains("backmodslot", StringComparison.OrdinalIgnoreCase))
            {
                return "Back";
            }

            if (context.Contains("frontmodslot", StringComparison.OrdinalIgnoreCase))
            {
                return "Front";
            }

            if (context.Contains("leftmodslot", StringComparison.OrdinalIgnoreCase))
            {
                return "Left";
            }

            if (context.Contains("rightmodslot", StringComparison.OrdinalIgnoreCase))
            {
                return "Right";
            }

            return null;
        }

        private static void EnsureFortModSlotWallRenderLayers(
            List<FoxWatchManifestStructureRenderLayer> renderLayers,
            IReadOnlyList<FoxWatchManifestBuildSocket> buildSockets,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            var directions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (HasFortDirectionalBuildSockets(buildSockets))
            {
                directions.Add("Back");
                directions.Add("Front");
                directions.Add("Left");
                directions.Add("Right");
            }

            foreach (var componentReference in componentReferences)
            {
                var direction = ResolveFortModSlotDirection(
                    componentReference.ComponentName,
                    componentReference.AttachParentName);
                if (!string.IsNullOrWhiteSpace(direction))
                {
                    directions.Add(direction);
                }
            }

            foreach (var direction in directions)
            {
                var slotName = $"{direction}ModSlot";
                var layerId = $"{direction.ToLowerInvariant()}wall";
                if (renderLayers.Any(layer => string.Equals(layer.Id, layerId, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                renderLayers.Add(new FoxWatchManifestStructureRenderLayer
                {
                    Id = layerId,
                    ComponentName = $"FortCommonMods:{slotName}",
                    ComponentTags = [direction],
                });
            }
        }

        private static bool IsFortEntrenchmentDirtFillMesh(string meshPath)
        {
            var meshFileName = Path.GetFileNameWithoutExtension(meshPath);
            if (!meshFileName.Contains("dirt", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return meshFileName.Contains("fort", StringComparison.OrdinalIgnoreCase)
                || meshFileName.Contains("trench", StringComparison.OrdinalIgnoreCase)
                || meshFileName.Contains("corner", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsFortEntrenchmentMeshPath(string meshPath)
        {
            var normalizedPath = meshPath.Replace('\\', '/');
            return normalizedPath.Contains("/FortTrenches/", StringComparison.OrdinalIgnoreCase)
                || normalizedPath.Contains("/Forts/", StringComparison.OrdinalIgnoreCase)
                || normalizedPath.Contains("/Bunker", StringComparison.OrdinalIgnoreCase);
        }

        private static bool ContainsDirectionalComponentNameToken(string normalizedComponentName)
        {
            return normalizedComponentName.Contains("back", StringComparison.OrdinalIgnoreCase)
                || normalizedComponentName.Contains("front", StringComparison.OrdinalIgnoreCase)
                || normalizedComponentName.Contains("left", StringComparison.OrdinalIgnoreCase)
                || normalizedComponentName.Contains("right", StringComparison.OrdinalIgnoreCase)
                || normalizedComponentName.Contains("center", StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeFortEntrenchmentRenderLayerId(string componentName)
        {
            return NormalizeComponentReferenceName(componentName).ToLowerInvariant();
        }

        private static List<string> ResolveFortEntrenchmentRenderLayerComponentTags(
            string componentName,
            IReadOnlyList<string> componentTags)
        {
            var resolvedTags = componentTags
                .Select(MapFortSideTagToVisibilityTag)
                .Where(tag => !string.IsNullOrWhiteSpace(tag))
                .Select(tag => tag!)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (resolvedTags.Count > 0)
            {
                return resolvedTags;
            }

            return DeriveDirectionalTagsFromComponentName(componentName);
        }

        private static string? MapFortSideTagToVisibilityTag(string? tag)
        {
            var normalizedTag = tag?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(normalizedTag))
            {
                return null;
            }

            if (normalizedTag.StartsWith("Side", StringComparison.OrdinalIgnoreCase) && normalizedTag.Length > 4)
            {
                return normalizedTag[4..];
            }

            if (string.Equals(normalizedTag, "Back", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(normalizedTag, "Front", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(normalizedTag, "Left", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(normalizedTag, "Right", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(normalizedTag, "Center", StringComparison.OrdinalIgnoreCase))
            {
                return normalizedTag;
            }

            return null;
        }

        private static List<string> DeriveDirectionalTagsFromComponentName(string componentName)
        {
            var normalizedComponentName = NormalizeComponentReferenceName(componentName);
            var tags = new List<string>();

            if (normalizedComponentName.Contains("back", StringComparison.OrdinalIgnoreCase))
            {
                tags.Add("Back");
            }

            if (normalizedComponentName.Contains("front", StringComparison.OrdinalIgnoreCase))
            {
                tags.Add("Front");
            }

            if (normalizedComponentName.Contains("left", StringComparison.OrdinalIgnoreCase))
            {
                tags.Add("Left");
            }

            if (normalizedComponentName.Contains("right", StringComparison.OrdinalIgnoreCase))
            {
                tags.Add("Right");
            }

            if (normalizedComponentName.Contains("center", StringComparison.OrdinalIgnoreCase))
            {
                tags.Add("Center");
            }

            return tags;
        }

        private static string? ResolveEntrenchmentSocketVisibilityTag(string? socketName, string? componentType)
        {
            var fortTag = ResolveFortEntrenchmentSocketVisibilityTag(socketName, componentType);
            if (!string.IsNullOrWhiteSpace(fortTag))
            {
                return fortTag;
            }

            return ResolveTrenchSocketVisibilityTag(socketName, componentType);
        }

        private static string? ResolveTrenchSocketVisibilityTag(string? socketName, string? componentType)
        {
            var normalizedSocketName = NormalizeComponentReferenceName(socketName);
            if (System.Text.RegularExpressions.Regex.IsMatch(normalizedSocketName, @"\w+Socket\d+$", RegexOptions.IgnoreCase))
            {
                return null;
            }

            var normalizedComponentType = NormalizeComponentReferenceName(componentType);
            var haystack = $"{normalizedSocketName}:{normalizedComponentType}";

            if (haystack.Contains("backsocket", StringComparison.OrdinalIgnoreCase))
            {
                return "Back";
            }

            if (haystack.Contains("frontsocket", StringComparison.OrdinalIgnoreCase))
            {
                return "Front";
            }

            if (haystack.Contains("leftsocket", StringComparison.OrdinalIgnoreCase))
            {
                return "Left";
            }

            if (haystack.Contains("rightsocket", StringComparison.OrdinalIgnoreCase))
            {
                return "Right";
            }

            return null;
        }

        private static string? ResolveFortEntrenchmentSocketVisibilityTag(string? socketName, string? componentType)
        {
            var normalizedSocketName = NormalizeComponentReferenceName(socketName);
            var normalizedComponentType = NormalizeComponentReferenceName(componentType);
            var haystack = $"{normalizedSocketName}:{normalizedComponentType}";

            if (haystack.Contains("backfort", StringComparison.OrdinalIgnoreCase))
            {
                return "Back";
            }

            if (haystack.Contains("frontfort", StringComparison.OrdinalIgnoreCase))
            {
                return "Front";
            }

            if (haystack.Contains("leftfort", StringComparison.OrdinalIgnoreCase))
            {
                return "Left";
            }

            if (haystack.Contains("rightfort", StringComparison.OrdinalIgnoreCase))
            {
                return "Right";
            }

            return null;
        }

        private static bool ComputeIsDestroyedStructure(dynamic obj, UBlueprintGeneratedClass blueprint, bool isVehicle, string? profileType, string? armourType)
        {
            var superStructName = NormalizeString(blueprint.SuperStruct?.Name);
            var superStructReference = NormalizeString(blueprint.SuperStruct?.ToString());
            if (string.Equals(superStructName, "DestroyedStructure", StringComparison.OrdinalIgnoreCase)
                || string.Equals(superStructName, "DestroyedFort", StringComparison.OrdinalIgnoreCase)
                || superStructReference.Contains("DestroyedStructure", StringComparison.OrdinalIgnoreCase)
                || superStructReference.Contains("DestroyedFort", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (string.Equals(profileType, "DestroyedStructure", StringComparison.OrdinalIgnoreCase)
                || string.Equals(profileType, "DestroyedFort", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (string.Equals(superStructName, "ResourceField", StringComparison.OrdinalIgnoreCase)
                || superStructReference.Contains("ResourceField", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (string.Equals(armourType, "WorldStructureHusk", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (isVehicle)
            {
                return false;
            }

            var ruinedComponent = (object?)obj.GetOrDefault<dynamic>("RuinedComponent");
            return ruinedComponent != null;
        }

        private static bool ComputeIsBreachedStructure(string codeName, string? upgradeStructureCodeName)
        {
            return codeName.EndsWith("Breached", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(upgradeStructureCodeName);
        }

        private static FoxWatchTextureVariants CreateTextureVariants(string? textureUrl)
        {
            if (string.IsNullOrWhiteSpace(textureUrl))
            {
                return new FoxWatchTextureVariants();
            }

            return new FoxWatchTextureVariants
            {
                Default = new FoxWatchTextureVariant { TextureUrl = textureUrl },
                C = new FoxWatchTextureVariant { TextureUrl = textureUrl },
                W = new FoxWatchTextureVariant { TextureUrl = textureUrl },
            };
        }

        private static List<FoxWatchManifestColorVariant> ExtractStructureColors(object? value)
        {
            var colors = new List<FoxWatchManifestColorVariant>();
            var seenHexes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in AsEnumerable(value))
            {
                var colorHex = ExtractColorHex(entry);
                if (string.IsNullOrWhiteSpace(colorHex) || !seenHexes.Add(colorHex))
                {
                    continue;
                }

                colors.Add(new FoxWatchManifestColorVariant
                {
                    Hex = colorHex,
                });
            }

            return colors;
        }

        private static string ExtractColorHex(object? value)
        {
            var channelHex = ExtractColorHexFromChannels(value);
            if (!string.IsNullOrWhiteSpace(channelHex))
            {
                return channelHex;
            }

            return NormalizeColorHex(ExtractText(GetNamedValue(value, "Hex")));
        }

        private static string ExtractColorHexFromChannels(object? value)
        {
            var red = NormalizeColorChannel(GetNamedValue(value, "R"));
            var green = NormalizeColorChannel(GetNamedValue(value, "G"));
            var blue = NormalizeColorChannel(GetNamedValue(value, "B"));
            if (red == null || green == null || blue == null)
            {
                return string.Empty;
            }

            return string.Create(CultureInfo.InvariantCulture, $"{red.Value:x2}{green.Value:x2}{blue.Value:x2}");
        }

        private static int? NormalizeColorChannel(object? value)
        {
            var numericValue = ExtractDouble(value);
            if (!numericValue.HasValue || double.IsNaN(numericValue.Value) || double.IsInfinity(numericValue.Value))
            {
                return null;
            }

            var resolvedValue = numericValue.Value <= 1
                ? numericValue.Value * 255
                : numericValue.Value;
            return Math.Clamp((int)Math.Round(resolvedValue, MidpointRounding.AwayFromZero), 0, 255);
        }

        private static string NormalizeColorHex(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            var normalized = string.Concat(value
                .Trim()
                .Replace("0x", string.Empty, StringComparison.OrdinalIgnoreCase)
                .Replace("#", string.Empty, StringComparison.OrdinalIgnoreCase)
                .Where(Uri.IsHexDigit))
                .ToLowerInvariant();

            return normalized.Length is 6 or 8 ? normalized : string.Empty;
        }

        private static string? ExportStructureIcon(string structureId, UTexture2D iconTexture, string baseAssetsUrl, string? iconOutputDirectory)
        {
            var normalizedStructureId = NormalizeString(structureId).ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(normalizedStructureId) || string.IsNullOrWhiteSpace(iconOutputDirectory))
            {
                return null;
            }

            var fileName = $"{normalizedStructureId}.png";
            var outputPath = Path.Combine(iconOutputDirectory, fileName);
            var iconUrl = BuildIconUrl(baseAssetsUrl, fileName);

            try
            {
                Directory.CreateDirectory(iconOutputDirectory);

                var decodedTexture = iconTexture.Decode();
                if (decodedTexture == null)
                {
                    return File.Exists(outputPath) ? iconUrl : null;
                }

                var imageBytes = decodedTexture.Encode(ETextureFormat.Png, saveHdrAsHdr: false, out _);
                File.WriteAllBytes(outputPath, imageBytes);
                return iconUrl;
            }
            catch
            {
                return File.Exists(outputPath) ? iconUrl : null;
            }
        }

        private string? ExportModificationSlotVariantIcon(
            string? iconTextureReference,
            string variantId,
            string baseAssetsUrl,
            string? iconOutputDirectory)
        {
            return ExportReferencedIcon(iconTextureReference, variantId, baseAssetsUrl, iconOutputDirectory);
        }

        private string? ExportReferencedIcon(
            object? iconTextureReference,
            string fallbackId,
            string baseAssetsUrl,
            string? iconOutputDirectory)
        {
            if (iconTextureReference == null)
            {
                return null;
            }

            var iconTexture = ResolveTextureProperty(iconTextureReference);
            if (iconTexture == null)
            {
                return null;
            }

            var iconTexturePath = ResolveReferencedPackagePath(iconTextureReference);
            var normalizedTextureName = NormalizeModificationIdSegment(Path.GetFileNameWithoutExtension(iconTexturePath));
            var normalizedFallbackId = NormalizeModificationIdSegment(fallbackId);
            var fileNameBase = string.IsNullOrWhiteSpace(normalizedTextureName)
                ? normalizedFallbackId
                : normalizedTextureName;

            if (string.IsNullOrWhiteSpace(fileNameBase))
            {
                return null;
            }

            return ExportStructureIcon(fileNameBase, iconTexture, baseAssetsUrl, iconOutputDirectory);
        }

        public int ExportCategoryIcons(
            IReadOnlyList<FoxWatchManifestCategory> categories,
            string? iconOutputDirectory)
        {
            if (categories.Count == 0 || string.IsNullOrWhiteSpace(iconOutputDirectory))
            {
                return 0;
            }

            var importedCategoriesById = LoadImportedCategoryDefinitions();
            if (importedCategoriesById.Count == 0)
            {
                return 0;
            }

            var exportedCount = 0;
            foreach (var category in categories)
            {
                if (string.IsNullOrWhiteSpace(category.Id))
                {
                    continue;
                }

                if (!importedCategoriesById.TryGetValue(
                        FoxWatchManifestCategoryNormalizer.NormalizeKey(category.Id),
                        out var importedCategory))
                {
                    continue;
                }

                var iconTexturePath = ResolveCategoryIconTexturePath(importedCategory);
                if (string.IsNullOrWhiteSpace(iconTexturePath))
                {
                    continue;
                }

                var iconTexture = ResolveTextureProperty(iconTexturePath);
                if (iconTexture == null)
                {
                    continue;
                }

                var fileNameBase = NormalizeModificationIdSegment(Path.GetFileNameWithoutExtension(iconTexturePath));
                if (string.IsNullOrWhiteSpace(fileNameBase))
                {
                    fileNameBase = FoxWatchManifestCategoryNormalizer.NormalizeKey(category.Id);
                }

                if (ExportStructureIcon(fileNameBase, iconTexture, "/foxhole/assets/", iconOutputDirectory) != null)
                {
                    exportedCount += 1;
                }
            }

            return exportedCount;
        }

        private static Dictionary<string, FoxWatchImportedCategoryDefinition> LoadImportedCategoryDefinitions()
        {
            var categoryCatalogPath = FoxWatchWorkspace.ResolvePath(FoxWatchWorkspace.ImportedCategoryCatalogRelativePath);
            if (string.IsNullOrWhiteSpace(categoryCatalogPath) || !File.Exists(categoryCatalogPath))
            {
                return new Dictionary<string, FoxWatchImportedCategoryDefinition>(StringComparer.Ordinal);
            }

            try
            {
                var json = File.ReadAllText(categoryCatalogPath);
                var categoryCatalog = System.Text.Json.JsonSerializer.Deserialize<FoxWatchImportedCategoryCatalog>(
                    json,
                    new System.Text.Json.JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true,
                    });
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
            catch
            {
                return new Dictionary<string, FoxWatchImportedCategoryDefinition>(StringComparer.Ordinal);
            }
        }

        private static string? ResolveCategoryIconTexturePath(FoxWatchImportedCategoryDefinition category)
        {
            if (!string.IsNullOrWhiteSpace(category.IconTexturePath))
            {
                return NormalizeCategoryIconTexturePath(category.IconTexturePath);
            }

            return DeriveCategoryIconTexturePathFromPublishedUrl(category.IconUrl);
        }

        private static string? DeriveCategoryIconTexturePathFromPublishedUrl(string? iconUrl)
        {
            var normalizedIconUrl = NormalizeString(iconUrl)?.Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(normalizedIconUrl))
            {
                return null;
            }

            const string legacyPrefix = "/assets/foxhole/game/";
            if (!normalizedIconUrl.StartsWith(legacyPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var relativePath = normalizedIconUrl[legacyPrefix.Length..];
            var withoutExtension = Path.ChangeExtension(relativePath, null)?.Replace('\\', '/');
            return string.IsNullOrWhiteSpace(withoutExtension)
                ? null
                : NormalizeCategoryIconTexturePath($"War/Content/{withoutExtension}");
        }

        private static string NormalizeCategoryIconTexturePath(string value)
        {
            var normalized = NormalizeString(value)?.Replace('\\', '/').Trim('/') ?? string.Empty;
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return string.Empty;
            }

            if (normalized.StartsWith("War/Textures/", StringComparison.OrdinalIgnoreCase))
            {
                normalized = $"War/Content/{normalized["War/".Length..]}";
            }
            else if (!normalized.StartsWith("War/", StringComparison.OrdinalIgnoreCase))
            {
                normalized = $"War/Content/{normalized}";
            }
            else if (normalized.StartsWith("War/Content/", StringComparison.OrdinalIgnoreCase) == false)
            {
                normalized = $"War/Content/{normalized["War/".Length..]}";
            }

            if (!normalized.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            {
                normalized += ".uasset";
            }

            return normalized;
        }

        private static bool IsExplicitAssetIconAllowed(string? packagePath)
        {
            var normalizedPackagePath = NormalizePackageComparisonPath(packagePath);
            if (string.IsNullOrWhiteSpace(normalizedPackagePath))
            {
                return true;
            }

            foreach (var invalidPackagePath in InvalidAssetIconPackagePaths)
            {
                if (normalizedPackagePath.Equals(invalidPackagePath, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }

            foreach (var invalidPrefix in InvalidAssetIconPackagePathPrefixes)
            {
                if (normalizedPackagePath.StartsWith(invalidPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }

            return true;
        }

        private static string? NormalizePackageComparisonPath(string? value)
        {
            var normalized = NormalizeString(value)?.Replace('\\', '/').Trim();
            return string.IsNullOrWhiteSpace(normalized)
                ? null
                : normalized;
        }

        private UTexture2D? ResolveTextureProperty(object? value)
        {
            if (value is UTexture2D texture)
            {
                return texture;
            }

            if (value is FPackageIndex packageIndex && packageIndex.TryLoad<UTexture2D>(out var indexedTexture))
            {
                return indexedTexture;
            }

            var objectPath = ResolveReferencedObjectPath(value);
            if (!string.IsNullOrWhiteSpace(objectPath) && _fileProvider.TryLoadPackageObject<UTexture2D>(objectPath, out var objectPathTexture))
            {
                return objectPathTexture;
            }

            var packagePath = ResolveReferencedPackagePath(value);
            if (string.IsNullOrWhiteSpace(packagePath))
            {
                return null;
            }

            foreach (var candidatePackagePath in EnumerateCandidateTexturePackagePaths(packagePath))
            {
                var packageObjectPath = BuildPackageObjectPath(candidatePackagePath);
                if (!string.IsNullOrWhiteSpace(packageObjectPath) &&
                    _fileProvider.TryLoadPackageObject<UTexture2D>(packageObjectPath, out var packageObjectTexture))
                {
                    return packageObjectTexture;
                }

                try
                {
                    var package = _fileProvider.LoadPackage(candidatePackagePath);
                    var exportedTexture = package.GetExports().OfType<UTexture2D>().FirstOrDefault();
                    if (exportedTexture != null)
                    {
                        return exportedTexture;
                    }
                }
                catch
                {
                }

                if (_fileProvider.TryLoadPackageObject<UTexture2D>(candidatePackagePath, out var loadedTexture))
                {
                    return loadedTexture;
                }
            }

            return null;
        }

        private static string? BuildPackageObjectPath(string? packagePath)
        {
            if (string.IsNullOrWhiteSpace(packagePath))
            {
                return null;
            }

            var normalized = packagePath.Replace('\\', '/').Trim();
            var packageName = Path.GetFileNameWithoutExtension(normalized);
            if (string.IsNullOrWhiteSpace(packageName))
            {
                return null;
            }

            var packagePathWithoutExtension = normalized.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase)
                ? normalized[..^".uasset".Length]
                : normalized;
            return $"{packagePathWithoutExtension}.{packageName}";
        }

        private IEnumerable<string> EnumerateCandidateTexturePackagePaths(string packagePath)
        {
            yield return packagePath;

            var packageName = Path.GetFileName(packagePath.Replace('\\', '/'));
            if (string.IsNullOrWhiteSpace(packageName))
            {
                yield break;
            }

            foreach (var candidatePath in _fileProvider.Files.Keys
                .Where(path => path.EndsWith($"/{packageName}", StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (!string.Equals(candidatePath, packagePath, StringComparison.OrdinalIgnoreCase))
                {
                    yield return candidatePath;
                }
            }
        }

        private static string? ResolveReferencedObjectPath(object? resolvedValue)
        {
            if (resolvedValue == null)
            {
                return null;
            }

            var getPathNameMethod = resolvedValue.GetType().GetMethod("GetPathName", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (getPathNameMethod != null)
            {
                try
                {
                    var path = NormalizeReferencedObjectPath(getPathNameMethod.Invoke(resolvedValue, null) as string);
                    if (!string.IsNullOrWhiteSpace(path))
                    {
                        return path;
                    }
                }
                catch
                {
                }
            }

            var objectPath = NormalizeReferencedObjectPath(ExtractText(GetNamedValue(resolvedValue, "ObjectPath")));
            if (!string.IsNullOrWhiteSpace(objectPath))
            {
                return objectPath;
            }

            var resourceObjectPath = ResolveReferencedObjectPath(GetNamedValue(resolvedValue, "ResourceObject"));
            if (!string.IsNullOrWhiteSpace(resourceObjectPath))
            {
                return resourceObjectPath;
            }

            var rawText = NormalizeReferencedObjectPath(ExtractText(resolvedValue));
            return string.IsNullOrWhiteSpace(rawText) ? null : rawText;
        }

        private static string? NormalizeReferencedObjectPath(string? value)
        {
            var normalized = NormalizeString(value);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return null;
            }

            var firstQuoteIndex = normalized.IndexOf('\'');
            var lastQuoteIndex = normalized.LastIndexOf('\'');
            if (firstQuoteIndex >= 0 && lastQuoteIndex > firstQuoteIndex)
            {
                normalized = normalized[(firstQuoteIndex + 1)..lastQuoteIndex];
            }

            return normalized.Replace('\\', '/').Trim();
        }

        private static string? ResolveReferencedPackagePath(object? resolvedValue)
        {
            if (resolvedValue == null)
            {
                return null;
            }

            var getPathNameMethod = resolvedValue.GetType().GetMethod("GetPathName", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (getPathNameMethod != null)
            {
                try
                {
                    var path = getPathNameMethod.Invoke(resolvedValue, null) as string;
                    var packagePath = ConvertObjectPathToPackagePath(path);
                    if (!string.IsNullOrWhiteSpace(packagePath))
                    {
                        return packagePath;
                    }
                }
                catch
                {
                }
            }

            var objectPath = GetNamedValue(resolvedValue, "ObjectPath");
            var normalizedObjectPath = ConvertObjectPathToPackagePath(ExtractText(objectPath));
            if (!string.IsNullOrWhiteSpace(normalizedObjectPath))
            {
                return normalizedObjectPath;
            }

            var resourceObjectPath = ResolveReferencedPackagePath(GetNamedValue(resolvedValue, "ResourceObject"));
            if (!string.IsNullOrWhiteSpace(resourceObjectPath))
            {
                return resourceObjectPath;
            }

            return ConvertObjectPathToPackagePath(ExtractText(resolvedValue));
        }

        private static string? ResolveDestroyedComponentName(object? value)
        {
            if (value == null)
            {
                return null;
            }

            var objectName = NormalizeString(ExtractText(GetNamedValue(value, "ObjectName")));
            if (!string.IsNullOrWhiteSpace(objectName))
            {
                var componentName = ExtractReferencedComponentName(objectName);
                if (!string.IsNullOrWhiteSpace(componentName))
                {
                    return componentName;
                }
            }

            var objectPath = NormalizeString(ExtractText(GetNamedValue(value, "ObjectPath")));
            if (!string.IsNullOrWhiteSpace(objectPath))
            {
                var componentName = ExtractReferencedComponentName(objectPath);
                if (!string.IsNullOrWhiteSpace(componentName))
                {
                    return componentName;
                }
            }

            return ExtractReferencedComponentName(ExtractText(value));
        }

        private static string? ResolveShippableType(object? value)
        {
            foreach (var candidate in new[]
            {
                GetNamedValue(value, "Type"),
                GetNamedValue(GetNamedValue(value, "Type"), "Value"),
                GetNamedValue(GetNamedValue(value, "Type"), "EnumValue"),
                value is string ? value : null,
            })
            {
                var normalized = NullIfWhiteSpace(NormalizeEnumValue(candidate));
                if (string.IsNullOrWhiteSpace(normalized))
                {
                    continue;
                }

                if (string.Equals(normalized, "none", StringComparison.OrdinalIgnoreCase))
                {
                    return null;
                }

                if (string.Equals(normalized, "small", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalized, "normal", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalized, "large", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalized, "extralarge", StringComparison.OrdinalIgnoreCase))
                {
                    return normalized;
                }
            }

            return null;
        }

        private static string? ResolveReferencedStructureCodeName(object? value)
        {
            var packagePath = ResolveReferencedPackagePath(value);
            if (string.IsNullOrWhiteSpace(packagePath))
            {
                return null;
            }

            var packageName = Path.GetFileNameWithoutExtension(packagePath);
            if (string.IsNullOrWhiteSpace(packageName))
            {
                return null;
            }

            if (packageName.StartsWith("BP", StringComparison.OrdinalIgnoreCase))
            {
                packageName = packageName[2..];
            }

            if (packageName.EndsWith("_C", StringComparison.OrdinalIgnoreCase))
            {
                packageName = packageName[..^2];
            }

            packageName = NormalizeString(packageName);
            return string.IsNullOrWhiteSpace(packageName) ? null : packageName;
        }

        private static string? ExtractReferencedComponentName(string? value)
        {
            var normalized = NormalizeString(value);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return null;
            }

            var colonIndex = normalized.LastIndexOf(':');
            if (colonIndex < 0 || colonIndex >= normalized.Length - 1)
            {
                return null;
            }

            var componentName = normalized[(colonIndex + 1)..].Trim().Trim('\'', '"');
            return string.IsNullOrWhiteSpace(componentName)
                ? null
                : componentName;
        }

        private static string BuildIconUrl(string baseAssetsUrl, string fileName)
        {
            var normalizedBaseAssetsUrl = string.IsNullOrWhiteSpace(baseAssetsUrl)
                ? "/foxhole/assets/"
                : baseAssetsUrl.Trim();

            if (!normalizedBaseAssetsUrl.EndsWith("/", StringComparison.Ordinal))
            {
                normalizedBaseAssetsUrl += "/";
            }

            return $"{normalizedBaseAssetsUrl}icons/{fileName}";
        }

        private static bool ShouldPreferStructureCandidate(
            FoxWatchManifestStructure existingStructure,
            FoxWatchManifestStructure candidateStructure)
        {
            var existingHasResolvedCategory = !string.Equals(existingStructure.CategoryId, "new", StringComparison.Ordinal);
            var candidateHasResolvedCategory = !string.Equals(candidateStructure.CategoryId, "new", StringComparison.Ordinal);
            if (existingHasResolvedCategory != candidateHasResolvedCategory)
            {
                return candidateHasResolvedCategory;
            }

            var existingVehicleSeatCount = existingStructure.VehicleSeats?.Count ?? 0;
            var candidateVehicleSeatCount = candidateStructure.VehicleSeats?.Count ?? 0;
            if (existingVehicleSeatCount != candidateVehicleSeatCount)
            {
                return candidateVehicleSeatCount > existingVehicleSeatCount;
            }

            var existingRangeCount = existingStructure.Ranges?.Count ?? 0;
            var candidateRangeCount = candidateStructure.Ranges?.Count ?? 0;
            if (existingRangeCount != candidateRangeCount)
            {
                return candidateRangeCount > existingRangeCount;
            }

            var existingIsVehicleProxy = IsVehicleProxyProfileType(existingStructure.ProfileType);
            var candidateIsVehicleProxy = IsVehicleProxyProfileType(candidateStructure.ProfileType);
            if (existingIsVehicleProxy != candidateIsVehicleProxy)
            {
                return candidateIsVehicleProxy;
            }

            return false;
        }

        private static bool IsVehicleProxyProfileType(string? profileType)
        {
            return string.Equals(profileType, "VehicleProxy", StringComparison.OrdinalIgnoreCase);
        }

        private static bool HasVehicleCollisionStructureVolume(IEnumerable<FoxWatchManifestStructureVolume> structureVolumes)
        {
            return structureVolumes.Any(volume =>
                string.Equals(volume.Name, "VehicleCollision", StringComparison.OrdinalIgnoreCase));
        }

        private static void MergeStructureCandidateData(
            FoxWatchManifestStructure preferredStructure,
            FoxWatchManifestStructure supplementalStructure)
        {
            if (string.IsNullOrWhiteSpace(preferredStructure.BlueprintPackagePath) &&
                !string.IsNullOrWhiteSpace(supplementalStructure.BlueprintPackagePath))
            {
                preferredStructure.BlueprintPackagePath = supplementalStructure.BlueprintPackagePath;
            }
            else if (IsVehicleProxyProfileType(preferredStructure.ProfileType)
                && !IsVehicleProxyProfileType(supplementalStructure.ProfileType)
                && !string.IsNullOrWhiteSpace(supplementalStructure.BlueprintPackagePath))
            {
                preferredStructure.BlueprintPackagePath = supplementalStructure.BlueprintPackagePath;
            }

            if (preferredStructure.IsVehicle != true && supplementalStructure.IsVehicle == true)
            {
                preferredStructure.IsVehicle = true;
            }

            if (string.IsNullOrWhiteSpace(preferredStructure.VehicleBuildType) &&
                !string.IsNullOrWhiteSpace(supplementalStructure.VehicleBuildType))
            {
                preferredStructure.VehicleBuildType = supplementalStructure.VehicleBuildType;
            }

            if (preferredStructure.VehicleSeats.Count == 0 && supplementalStructure.VehicleSeats.Count > 0)
            {
                preferredStructure.VehicleSeats = [.. supplementalStructure.VehicleSeats];
            }

            if (preferredStructure.Ranges.Count == 0 && supplementalStructure.Ranges.Count > 0)
            {
                preferredStructure.Ranges = [.. supplementalStructure.Ranges];
            }

            if (preferredStructure.Spotlights.Count == 0 && supplementalStructure.Spotlights.Count > 0)
            {
                preferredStructure.Spotlights = [.. supplementalStructure.Spotlights];
            }

            if (preferredStructure.FuelTanks.Count == 0 && supplementalStructure.FuelTanks.Count > 0)
            {
                preferredStructure.FuelTanks = [.. supplementalStructure.FuelTanks];
            }

            if (preferredStructure.ConversionEntries.Count == 0 && supplementalStructure.ConversionEntries.Count > 0)
            {
                preferredStructure.ConversionEntries = [.. supplementalStructure.ConversionEntries];
            }

            if (preferredStructure.ConversionCodeNames.Count == 0 && supplementalStructure.ConversionCodeNames.Count > 0)
            {
                preferredStructure.ConversionCodeNames = [.. supplementalStructure.ConversionCodeNames];
            }

            if (string.IsNullOrWhiteSpace(preferredStructure.ReferencedBuildSiteCodeName) &&
                !string.IsNullOrWhiteSpace(supplementalStructure.ReferencedBuildSiteCodeName))
            {
                preferredStructure.ReferencedBuildSiteCodeName = supplementalStructure.ReferencedBuildSiteCodeName;
            }

            if (string.IsNullOrWhiteSpace(preferredStructure.ReferencedBuildSiteBlueprintPackagePath) &&
                !string.IsNullOrWhiteSpace(supplementalStructure.ReferencedBuildSiteBlueprintPackagePath))
            {
                preferredStructure.ReferencedBuildSiteBlueprintPackagePath = supplementalStructure.ReferencedBuildSiteBlueprintPackagePath;
            }
        }

        private void ExtractReferencedBuildSiteStructures(
            IReadOnlyDictionary<string, ReferencedBuildSiteExtractionRequest> referencedBuildSiteRequestsById,
            IDictionary<string, FoxWatchManifestStructure> structuresById,
            string baseAssetsUrl,
            string? iconOutputDirectory,
            IDictionary<string, FoxWatchManifestCategory> categoriesById,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            foreach (var request in referencedBuildSiteRequestsById.Values.OrderBy(value => value.StructureId, StringComparer.OrdinalIgnoreCase))
            {
                if (!structuresById.TryGetValue(request.StructureId, out var structure))
                {
                    structure = TryBuildReferencedStructure(
                        request.BlueprintPackagePath,
                        request.CodeName,
                        baseAssetsUrl,
                        iconOutputDirectory,
                        categoriesById,
                        englishStrings,
                        localizationReferencesById);
                    if (structure == null)
                    {
                        continue;
                    }

                    structuresById[structure.Id] = structure;
                }

                ApplyReferencedBuildSiteUpgradeTarget(structure, request);
                RegisterResolvedBlueprintPackagePath(structure);
            }
        }

        private void AppendFieldModificationCenterVehicleUpgradeConversions(
            IDictionary<string, FoxWatchManifestStructure> structuresById)
        {
            if (!structuresById.TryGetValue("facilitymodificationcenter", out var fieldModificationCenter))
            {
                return;
            }

            var addedConversionCodeNames = new List<string>();
            foreach (var targetStructure in structuresById.Values
                .Where(structure =>
                    structure.IsVehicle == true &&
                    string.Equals(structure.VehicleBuildType, "VehicleFacility", StringComparison.OrdinalIgnoreCase))
                .OrderBy(structure => structure.Id, StringComparer.OrdinalIgnoreCase))
            {
                var dynamicData = ResolveConstructionDynamicDataEntry(targetStructure.CodeName);
                if (dynamicData?.HasTierUpgrades != true || dynamicData.UpgradeCost.Count == 0)
                {
                    continue;
                }

                var baseStructure = ResolveFieldModificationCenterBaseVehicle(targetStructure, structuresById.Values);
                if (baseStructure == null)
                {
                    continue;
                }

                var conversionEntry = CreateFieldModificationCenterVehicleUpgradeConversionEntry(
                    baseStructure.CodeName,
                    targetStructure.CodeName,
                    dynamicData.UpgradeCost);
                if (conversionEntry == null)
                {
                    continue;
                }

                fieldModificationCenter.ConversionEntries.Add(conversionEntry);
                addedConversionCodeNames.Add(targetStructure.CodeName);
            }

            if (addedConversionCodeNames.Count > 0)
            {
                fieldModificationCenter.ConversionCodeNames = MergeDistinctCodeNames(
                    fieldModificationCenter.ConversionCodeNames,
                    addedConversionCodeNames);
            }
        }

        private static FoxWatchManifestStructure? ResolveFieldModificationCenterBaseVehicle(
            FoxWatchManifestStructure targetStructure,
            IEnumerable<FoxWatchManifestStructure> candidateStructures)
        {
            var targetDirectory = GetBlueprintPackageDirectory(targetStructure.BlueprintPackagePath);
            if (string.IsNullOrWhiteSpace(targetDirectory))
            {
                return null;
            }

            var targetFactionKey = ResolveVehicleFactionKey(targetStructure);
            var targetStem = TrimVehicleFactionSuffix(targetStructure.CodeName, targetFactionKey);
            if (string.IsNullOrWhiteSpace(targetStem))
            {
                return null;
            }

            var scoredCandidates = candidateStructures
                .Where(candidate =>
                    candidate.IsVehicle == true &&
                    !string.Equals(candidate.Id, targetStructure.Id, StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(candidate.VehicleBuildType, "VehicleFacility", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(GetBlueprintPackageDirectory(candidate.BlueprintPackagePath), targetDirectory, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(ResolveVehicleFactionKey(candidate), targetFactionKey, StringComparison.OrdinalIgnoreCase))
                .Select(candidate =>
                {
                    var candidateStem = TrimVehicleFactionSuffix(candidate.CodeName, ResolveVehicleFactionKey(candidate));
                    return new
                    {
                        Structure = candidate,
                        CandidateStem = candidateStem,
                        CommonPrefixLength = ComputeCommonPrefixLength(targetStem, candidateStem),
                    };
                })
                .Where(candidate =>
                    !string.IsNullOrWhiteSpace(candidate.CandidateStem) &&
                    candidate.CommonPrefixLength >= 5)
                .Select(candidate => new
                {
                    candidate.Structure,
                    candidate.CandidateStem,
                    candidate.CommonPrefixLength,
                    IsPrefix = targetStem.StartsWith(candidate.CandidateStem, StringComparison.OrdinalIgnoreCase),
                })
                .OrderByDescending(candidate => candidate.CommonPrefixLength)
                .ThenByDescending(candidate => candidate.IsPrefix)
                .ThenBy(candidate => candidate.CandidateStem.Length)
                .ThenBy(candidate => candidate.Structure.CodeName, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (scoredCandidates.Count == 0)
            {
                return null;
            }

            var bestCandidate = scoredCandidates[0];
            if (scoredCandidates.Count > 1)
            {
                var runnerUp = scoredCandidates[1];
                if (runnerUp.CommonPrefixLength == bestCandidate.CommonPrefixLength &&
                    runnerUp.IsPrefix == bestCandidate.IsPrefix &&
                    runnerUp.CandidateStem.Length == bestCandidate.CandidateStem.Length)
                {
                    return null;
                }
            }

            return bestCandidate.Structure;
        }

        private FoxWatchManifestStructure? TryBuildReferencedStructure(
            string blueprintPackagePath,
            string fallbackCodeName,
            string baseAssetsUrl,
            string? iconOutputDirectory,
            IDictionary<string, FoxWatchManifestCategory> categoriesById,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            if (!IsWhitelistedNonCodeNameStructure(fallbackCodeName))
            {
                return null;
            }

            IReadOnlyCollection<dynamic> objects;
            try
            {
                var package = _fileProvider.LoadPackage(blueprintPackagePath);
                objects = package.GetExports().Cast<dynamic>().ToArray();
            }
            catch
            {
                return null;
            }

            var blueprint = objects.OfType<UBlueprintGeneratedClass>().FirstOrDefault();
            if (blueprint == null)
            {
                return null;
            }

            var defaultObject = ResolveBlueprintDefaultObject(objects, blueprint);
            if (defaultObject == null)
            {
                return null;
            }

            return TryBuildStructure(
                defaultObject,
                objects,
                blueprint,
                baseAssetsUrl,
                iconOutputDirectory,
                categoriesById,
                englishStrings,
                localizationReferencesById,
                fallbackCodeName);
        }

        private bool IsWhitelistedNonCodeNameStructure(string? codeName)
        {
            return !string.IsNullOrWhiteSpace(codeName)
                && (_nonCodeNameStructureWhitelistLoader?.Contains(codeName) ?? false);
        }

        private static dynamic? ResolveBlueprintDefaultObject(IReadOnlyCollection<dynamic> objects, UBlueprintGeneratedClass blueprint)
        {
            var defaultObjectName = NormalizeString($"Default__{blueprint.Name}");
            var matchedDefaultObject = objects.FirstOrDefault(candidate =>
                string.Equals(
                    NormalizeString(ExtractText(GetNamedValue(candidate, "Name"))),
                    defaultObjectName,
                    StringComparison.OrdinalIgnoreCase));
            if (matchedDefaultObject != null)
            {
                return matchedDefaultObject;
            }

            return objects.FirstOrDefault(candidate =>
                NormalizeString(ExtractText(GetNamedValue(candidate, "Name"))).StartsWith("Default__", StringComparison.OrdinalIgnoreCase));
        }

        private static void ApplyReferencedBuildSiteUpgradeTarget(
            FoxWatchManifestStructure structure,
            ReferencedBuildSiteExtractionRequest request)
        {
            if (string.IsNullOrWhiteSpace(structure.UpgradeStructureCodeName) &&
                !string.IsNullOrWhiteSpace(request.UpgradeStructureCodeName))
            {
                structure.UpgradeStructureCodeName = request.UpgradeStructureCodeName;
            }
        }

        private static void RegisterReferencedBuildSiteExtractionRequest(
            FoxWatchManifestStructure structure,
            IDictionary<string, ReferencedBuildSiteExtractionRequest> referencedBuildSiteRequestsById)
        {
            var referencedBuildSiteCodeName = NormalizeString(structure.ReferencedBuildSiteCodeName);
            var referencedBuildSiteBlueprintPackagePath = NormalizeString(structure.ReferencedBuildSiteBlueprintPackagePath).Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(referencedBuildSiteCodeName) ||
                string.IsNullOrWhiteSpace(referencedBuildSiteBlueprintPackagePath) ||
                string.IsNullOrWhiteSpace(structure.CodeName))
            {
                return;
            }

            var structureId = referencedBuildSiteCodeName.ToLowerInvariant();
            if (!referencedBuildSiteRequestsById.TryGetValue(structureId, out var request))
            {
                referencedBuildSiteRequestsById[structureId] = new ReferencedBuildSiteExtractionRequest(
                    structureId,
                    referencedBuildSiteCodeName,
                    referencedBuildSiteBlueprintPackagePath,
                    structure.CodeName,
                    structure.Tier,
                    structure.BuildOrder);
                return;
            }

            if (ShouldPreferReferencedBuildSiteUpgradeTarget(request, structure))
            {
                request.UpgradeStructureCodeName = structure.CodeName;
                request.UpgradeStructureTier = structure.Tier;
                request.UpgradeStructureBuildOrder = structure.BuildOrder;
            }
        }

        private static bool ShouldPreferReferencedBuildSiteUpgradeTarget(
            ReferencedBuildSiteExtractionRequest existingRequest,
            FoxWatchManifestStructure candidateStructure)
        {
            var existingMatchesBuildSiteFamily = MatchesReferencedBuildSiteUpgradeTarget(existingRequest.CodeName, existingRequest.UpgradeStructureCodeName);
            var candidateMatchesBuildSiteFamily = MatchesReferencedBuildSiteUpgradeTarget(existingRequest.CodeName, candidateStructure.CodeName);
            if (existingMatchesBuildSiteFamily != candidateMatchesBuildSiteFamily)
            {
                return candidateMatchesBuildSiteFamily;
            }

            var existingTier = existingRequest.UpgradeStructureTier;
            var candidateTier = candidateStructure.Tier;
            if (existingTier.HasValue != candidateTier.HasValue)
            {
                return candidateTier.HasValue;
            }

            if (existingTier.HasValue && candidateTier.HasValue && existingTier.Value != candidateTier.Value)
            {
                return candidateTier.Value < existingTier.Value;
            }

            if (existingRequest.UpgradeStructureBuildOrder != candidateStructure.BuildOrder)
            {
                return candidateStructure.BuildOrder < existingRequest.UpgradeStructureBuildOrder;
            }

            return string.Compare(candidateStructure.CodeName, existingRequest.UpgradeStructureCodeName, StringComparison.OrdinalIgnoreCase) < 0;
        }

        private static bool MatchesReferencedBuildSiteUpgradeTarget(string? buildSiteCodeName, string? targetCodeName)
        {
            var normalizedBuildSiteFamily = NormalizeReferencedBuildSiteFamilyCodeName(buildSiteCodeName);
            var normalizedTargetFamily = NormalizeReferencedBuildSiteFamilyCodeName(targetCodeName);
            return !string.IsNullOrWhiteSpace(normalizedBuildSiteFamily)
                && string.Equals(normalizedBuildSiteFamily, normalizedTargetFamily, StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeReferencedBuildSiteFamilyCodeName(string? codeName)
        {
            var normalizedCodeName = NormalizeString(codeName);
            if (string.IsNullOrWhiteSpace(normalizedCodeName))
            {
                return string.Empty;
            }

            const string buildSiteSuffix = "BuildSite";
            if (normalizedCodeName.EndsWith(buildSiteSuffix, StringComparison.OrdinalIgnoreCase))
            {
                normalizedCodeName = normalizedCodeName[..^buildSiteSuffix.Length];
            }

            var suffixIndex = normalizedCodeName.Length - 1;
            while (suffixIndex >= 0 && char.IsDigit(normalizedCodeName[suffixIndex]))
            {
                suffixIndex -= 1;
            }

            if (suffixIndex >= 0 && suffixIndex < normalizedCodeName.Length - 1 && normalizedCodeName[suffixIndex] is 'T' or 't')
            {
                normalizedCodeName = normalizedCodeName[..suffixIndex];
            }

            return normalizedCodeName;
        }

        private static string NormalizeModificationIdSegment(string? value)
        {
            var normalized = NormalizeString(value).ToLowerInvariant();
            var characters = normalized.Where(character => char.IsLetterOrDigit(character)).ToArray();
            return characters.Length == 0 ? string.Empty : new string(characters);
        }

        private static string BuildPascalIdentifier(string? value)
        {
            var normalized = NormalizeString(value);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return string.Empty;
            }

            var segments = normalized
                .Split([' ', '-', '_'], StringSplitOptions.RemoveEmptyEntries)
                .Select(segment => new string(segment.Where(char.IsLetterOrDigit).ToArray()))
                .Where(segment => !string.IsNullOrWhiteSpace(segment))
                .ToList();
            if (segments.Count == 0)
            {
                var compact = new string(normalized.Where(char.IsLetterOrDigit).ToArray());
                return string.IsNullOrWhiteSpace(compact)
                    ? string.Empty
                    : char.ToUpperInvariant(compact[0]) + compact[1..];
            }

            return string.Concat(segments.Select(segment => char.ToUpperInvariant(segment[0]) + segment[1..]));
        }

        private static FoxWatchLocalizedText CloneLocalizedText(FoxWatchLocalizedText value)
        {
            return new FoxWatchLocalizedText
            {
                Id = value.Id,
                Fallback = value.Fallback,
            };
        }

        private static FoxWatchSprite CloneSprite(FoxWatchSprite value)
        {
            return new FoxWatchSprite
            {
                Width = value.Width,
                Height = value.Height,
                AnchorX = value.AnchorX,
                AnchorY = value.AnchorY,
                OffsetX = value.OffsetX,
                OffsetY = value.OffsetY,
            };
        }

        private static FoxWatchTextureVariants CloneTextureVariants(FoxWatchTextureVariants value)
        {
            return new FoxWatchTextureVariants
            {
                Default = value.Default == null ? null : new FoxWatchTextureVariant { TextureUrl = value.Default.TextureUrl },
                C = value.C == null ? null : new FoxWatchTextureVariant { TextureUrl = value.C.TextureUrl },
                W = value.W == null ? null : new FoxWatchTextureVariant { TextureUrl = value.W.TextureUrl },
            };
        }

        private static FoxWatchManifestPowerGridInfo? MergePowerGridInfo(FoxWatchManifestPowerGridInfo? baseValue, FoxWatchManifestPowerGridInfo? overlay)
        {
            if (baseValue == null && overlay == null)
            {
                return null;
            }

            return new FoxWatchManifestPowerGridInfo
            {
                PowerDelta = overlay?.PowerDelta ?? baseValue?.PowerDelta,
                MaxConnections = overlay?.MaxConnections ?? baseValue?.MaxConnections,
            };
        }

        private static List<FoxWatchManifestBuildSocket> MergeBuildSockets(
            IEnumerable<FoxWatchManifestBuildSocket> baseSockets,
            IEnumerable<FoxWatchManifestBuildSocket> overlaySockets)
        {
            return [
                .. baseSockets.Select(CloneBuildSocket),
                .. overlaySockets.Select(CloneBuildSocket),
            ];
        }

        private static List<FoxWatchManifestBuildSocket> MergeDistinctBuildSockets(
            IEnumerable<FoxWatchManifestBuildSocket> baseSockets,
            IEnumerable<FoxWatchManifestBuildSocket> overlaySockets)
        {
            var merged = new List<FoxWatchManifestBuildSocket>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var socket in baseSockets.Concat(overlaySockets))
            {
                var key = BuildBuildSocketKey(socket);
                if (!seen.Add(key))
                {
                    continue;
                }

                merged.Add(CloneBuildSocket(socket));
            }

            return merged;
        }

        private static FoxWatchManifestBuildSocket CloneBuildSocket(FoxWatchManifestBuildSocket value)
        {
            return new FoxWatchManifestBuildSocket
            {
                Name = value.Name,
                ComponentType = value.ComponentType,
                PipeType = value.PipeType,
                SocketTags = value.SocketTags.Select(CloneSocketTag).ToList(),
                X = value.X,
                Y = value.Y,
                Z = value.Z,
                Rotation = value.Rotation,
            };
        }

        private static List<FoxWatchManifestCraneSpawn> CloneCraneSpawns(IEnumerable<FoxWatchManifestCraneSpawn> value)
        {
            return value.Select(entry => new FoxWatchManifestCraneSpawn
            {
                Name = entry.Name,
                ComponentType = entry.ComponentType,
                StructureId = entry.StructureId,
                X = entry.X,
                Y = entry.Y,
                Z = entry.Z,
                Rotation = entry.Rotation,
            }).ToList();
        }

        private static List<FoxWatchManifestStructureVolume> CloneStructureVolumes(IEnumerable<FoxWatchManifestStructureVolume> value)
        {
            return value.Select(entry => new FoxWatchManifestStructureVolume
            {
                Name = entry.Name,
                Label = entry.Label,
                Category = entry.Category,
                ComponentType = entry.ComponentType,
                X = entry.X,
                Y = entry.Y,
                Z = entry.Z,
                Width = entry.Width,
                Length = entry.Length,
                Height = entry.Height,
                Rotation = entry.Rotation,
            }).ToList();
        }

        private static List<FoxWatchManifestStructureVolume> MergeStructureVolumes(
            IEnumerable<FoxWatchManifestStructureVolume> primaryVolumes,
            IEnumerable<FoxWatchManifestStructureVolume> additionalVolumes)
        {
            var merged = new List<FoxWatchManifestStructureVolume>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var volume in primaryVolumes.Concat(additionalVolumes))
            {
                var key = BuildStructureVolumeGeometryKey(volume);
                if (!seen.Add(key))
                {
                    continue;
                }

                merged.Add(new FoxWatchManifestStructureVolume
                {
                    Name = volume.Name,
                    Label = volume.Label,
                    Category = volume.Category,
                    ComponentType = volume.ComponentType,
                    X = volume.X,
                    Y = volume.Y,
                    Z = volume.Z,
                    Width = volume.Width,
                    Length = volume.Length,
                    Height = volume.Height,
                    Rotation = volume.Rotation,
                });
            }

            return merged;
        }

        private static List<FoxWatchManifestHitPolygon> MergeFootprintPolygons(
            IEnumerable<FoxWatchManifestHitPolygon> basePolygons,
            IEnumerable<FoxWatchManifestHitPolygon> overlayPolygons)
        {
            var merged = basePolygons.Select(CloneHitPolygon).ToList();
            if (!merged.Any())
            {
                merged.AddRange(overlayPolygons.Select(CloneHitPolygon));
            }
            return merged;
        }

        private static FoxWatchManifestHitPolygon CloneHitPolygon(FoxWatchManifestHitPolygon value)
        {
            return new FoxWatchManifestHitPolygon
            {
                Shape = [.. value.Shape],
            };
        }

        private static List<FoxWatchManifestFuelTank> MergeFuelTanks(
            IEnumerable<FoxWatchManifestFuelTank> baseFuelTanks,
            IEnumerable<FoxWatchManifestFuelTank> overlayFuelTanks)
        {
            return [
                .. baseFuelTanks.Select(CloneFuelTank),
                .. overlayFuelTanks.Select(CloneFuelTank),
            ];
        }

        private static FoxWatchManifestFuelTank CloneFuelTank(FoxWatchManifestFuelTank value)
        {
            return new FoxWatchManifestFuelTank
            {
                CodeName = value.CodeName,
                Capacity = value.Capacity,
            };
        }

        private static List<FoxWatchManifestConversionEntry> CloneConversionEntries(IEnumerable<FoxWatchManifestConversionEntry> entries)
        {
            return entries.Select(entry => new FoxWatchManifestConversionEntry
            {
                ItemInput = CloneRecipeResources(entry.ItemInput),
                CrateInput = CloneRecipeResources(entry.CrateInput),
                LiquidInput = CloneRecipeResources(entry.LiquidInput),
                ItemOutput = CloneRecipeResources(entry.ItemOutput),
                CrateOutput = CloneRecipeResources(entry.CrateOutput),
                LiquidOutput = CloneRecipeResources(entry.LiquidOutput),
                Duration = entry.Duration,
                PowerDelta = entry.PowerDelta,
                bConsumeResourceNodes = entry.bConsumeResourceNodes,
            }).ToList();
        }

        private static List<FoxWatchManifestModificationSlot> CloneModificationSlots(IEnumerable<FoxWatchManifestModificationSlot> slots)
        {
            return slots.Select(slot => new FoxWatchManifestModificationSlot
            {
                Name = slot.Name,
                ComponentType = slot.ComponentType,
                DataClassPath = slot.DataClassPath,
                X = slot.X,
                Y = slot.Y,
                Z = slot.Z,
                Rotation = slot.Rotation,
                IsLinkedToSocket = slot.IsLinkedToSocket,
                LinkedSocketNames = [.. slot.LinkedSocketNames],
                BlockedByModSlotNames = [.. slot.BlockedByModSlotNames],
                Variants = slot.Variants.ToDictionary(
                    pair => pair.Key,
                    pair => CloneModificationSlotVariant(pair.Value),
                    StringComparer.Ordinal),
            }).ToList();
        }

        private static FoxWatchManifestModificationSlotVariant CloneModificationSlotVariant(FoxWatchManifestModificationSlotVariant variant)
        {
            return new FoxWatchManifestModificationSlotVariant
            {
                Name = variant.Name,
                CodeName = variant.CodeName,
                Description = variant.Description,
                IconTexturePath = variant.IconTexturePath,
                SubTypeIconUrl = variant.SubTypeIconUrl,
                IconUrl = variant.IconUrl,
                RequiredSocketConnectionMask = variant.RequiredSocketConnectionMask,
                HiddenBySocketConnectionMask = variant.HiddenBySocketConnectionMask,
                ShowInBuildSite = variant.ShowInBuildSite,
                BuildFootprintTemplatePath = variant.BuildFootprintTemplatePath,
                Cost = CloneRecipeResources(variant.Cost),
                UseTemplateActor = variant.UseTemplateActor,
                TemplateMeshPath = variant.TemplateMeshPath,
                TemplateActorPath = variant.TemplateActorPath,
                PreviewMeshPath = variant.PreviewMeshPath,
                TextureUrl = variant.TextureUrl,
                PreviewUrl = variant.PreviewUrl,
                PreviewDirection = variant.PreviewDirection,
                TextureWidth = variant.TextureWidth,
                TextureHeight = variant.TextureHeight,
                AnchorX = variant.AnchorX,
                AnchorY = variant.AnchorY,
                OffsetX = variant.OffsetX,
                OffsetY = variant.OffsetY,
                RenderId = variant.RenderId,
            };
        }

        private static Dictionary<string, FoxWatchManifestRecipeResource> CloneRecipeResources(
            IReadOnlyDictionary<string, FoxWatchManifestRecipeResource> resources)
        {
            return resources.ToDictionary(
                pair => pair.Key,
                pair => new FoxWatchManifestRecipeResource
                {
                    Quantity = pair.Value.Quantity,
                    Limit = pair.Value.Limit,
                },
                StringComparer.Ordinal);
        }

        private static Dictionary<string, FoxWatchManifestRecipeResource> ExtractRecipeResourcesFromCandidates(
            Func<string, object?> propertyResolver,
            params string[] propertyNames)
        {
            foreach (var propertyName in propertyNames)
            {
                var resources = ExtractRecipeResources(propertyResolver(propertyName));
                if (resources.Count > 0)
                {
                    return resources;
                }
            }

            return new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal);
        }

        private static Dictionary<string, FoxWatchManifestRecipeResource> ExtractStructureCost(Func<string, object?> propertyResolver)
        {
            var resources = ExtractRecipeResourcesFromCandidates(
                propertyResolver,
                "ResourceAmounts",
                "AltResourceAmounts",
                "Cost",
                "BuildCost",
                "ConstructionCost");

            return resources.Count > 0
                ? resources
                : new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal);
        }

        private static int? ExtractNullableIntFromCandidates(
            Func<string, object?> propertyResolver,
            params string[] propertyNames)
        {
            foreach (var propertyName in propertyNames)
            {
                var value = ExtractNullableInt(propertyResolver(propertyName));
                if (value != null)
                {
                    return value;
                }
            }

            return null;
        }

        private string ResolveStructureCategoryId(string structureId, string codeName, string? rawBuildCategory, string? itemCategoryId, int? buildOrder)
        {
            var normalizedItemCategoryId = NormalizeCategoryToken(itemCategoryId ?? string.Empty);
            if (!string.IsNullOrWhiteSpace(normalizedItemCategoryId) &&
                !string.Equals(normalizedItemCategoryId, "new", StringComparison.Ordinal))
            {
                return normalizedItemCategoryId;
            }

            var normalizedCategoryId = NormalizeCategoryToken(rawBuildCategory ?? string.Empty);
            if (!string.IsNullOrWhiteSpace(normalizedCategoryId) &&
                !string.Equals(normalizedCategoryId, "new", StringComparison.Ordinal))
            {
                return normalizedCategoryId;
            }

            if (buildOrder.HasValue)
            {
                return "misc";
            }

            return normalizedCategoryId;
        }

        private static string ResolveItemCategoryId(object? itemCategoryValue, object? itemProfileTypeValue, object? uniformTypeValue)
        {
            var itemProfileType = NormalizeEnumValue(itemProfileTypeValue);
            if (!string.Equals(itemProfileType, "UniqueItem", StringComparison.OrdinalIgnoreCase))
            {
                var normalizedItemCategoryId = NormalizeCategoryToken(NormalizeEnumValue(itemCategoryValue));
                if (!string.IsNullOrWhiteSpace(normalizedItemCategoryId) &&
                    !string.Equals(normalizedItemCategoryId, "new", StringComparison.Ordinal))
                {
                    return normalizedItemCategoryId;
                }
            }

            return string.IsNullOrWhiteSpace(ExtractText(uniformTypeValue))
                ? string.Empty
                : "uniforms";
        }

        private static string? ExtractTechId(Func<string, object?> propertyResolver)
        {
            var candidates = new[]
            {
                ExtractText(propertyResolver("TechId")),
                ExtractText(propertyResolver("TechID")),
                ExtractText(propertyResolver("RequiredTechId")),
                ExtractText(propertyResolver("RequiredTechID")),
            };

            return candidates
                .Select(NormalizeString)
                .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
        }

        private static FoxWatchManifestPowerGridInfo? ExtractPowerGridInfo(object? value)
        {
            if (value == null)
            {
                return null;
            }

            var powerDelta = ExtractNullableInt(GetNamedValue(value, "PowerDelta"));
            var maxConnections = ExtractNullableInt(GetNamedValue(value, "MaxConnections"));
            if (powerDelta == null && maxConnections == null)
            {
                return null;
            }

            return new FoxWatchManifestPowerGridInfo
            {
                PowerDelta = powerDelta,
                MaxConnections = maxConnections,
            };
        }

        private FoxWatchManifestConnector? ExtractConnector(
            UBlueprintGeneratedClass blueprint,
            Func<string, object?> inheritedProperty)
        {
            var isConnector = ExtractBoolValue(inheritedProperty("bIsConnector"));
            var isManualConnector = ExtractBoolValue(inheritedProperty("bIsManualConnector"));
            var frontSocketName = ExtractReferencedComponentName(ExtractText(inheritedProperty("FrontSocket")));
            var backSocketName = ExtractReferencedComponentName(ExtractText(inheritedProperty("BackSocket")));
            var minLengthCm = ExtractDouble(inheritedProperty("ConnectorMinLength"));
            var maxLengthCm = ExtractDouble(inheritedProperty("ConnectorMaxLength"));
            var minWidthCm = ExtractDouble(inheritedProperty("ConnectorMinWidth"))
                ?? ExtractDouble(inheritedProperty("MinWidth"));
            var pathMode = NullIfWhiteSpace(NormalizeEnumValue(inheritedProperty("PathMode")));
            var componentReference = ResolveConnectorComponentReference(blueprint);
            pathMode ??= NullIfWhiteSpace(NormalizeEnumValue(componentReference?.SplinePathMode));
            List<double>? defaultTarget = componentReference?.SplineDefaultTargetUnrealLocationCentimeters is { Count: > 0 } target
                ? [.. target]
                : null;
            List<FoxWatchManifestConnectorMeshConfig> meshConfigs = componentReference?.SplineConnectorMeshConfigs.Count > 0
                ? [.. componentReference.SplineConnectorMeshConfigs.Select(CreateConnectorMeshConfig)]
                : [];
            List<FoxWatchManifestSplineComponentConfig> componentConfigs = componentReference?.SplineComponentConfigs.Count > 0
                ? [.. componentReference.SplineComponentConfigs.Select(CreateSplineComponentConfig)]
                : [];

            if (isConnector != true &&
                isManualConnector != true &&
                string.IsNullOrWhiteSpace(frontSocketName) &&
                string.IsNullOrWhiteSpace(backSocketName) &&
                minLengthCm == null &&
                maxLengthCm == null &&
                minWidthCm == null &&
                string.IsNullOrWhiteSpace(pathMode) &&
                componentReference == null)
            {
                return null;
            }

            return new FoxWatchManifestConnector
            {
                Kind = isManualConnector == true ? "manual" : isConnector == true ? "connector" : null,
                IsConnector = isConnector,
                IsManualConnector = isManualConnector,
                SplineComponentName = NullIfWhiteSpace(NormalizeString(componentReference?.ComponentName)),
                FrontSocketName = frontSocketName,
                BackSocketName = backSocketName,
                MinLengthCm = minLengthCm,
                MaxLengthCm = maxLengthCm,
                MinWidthCm = minWidthCm,
                PathMode = pathMode,
                DefaultTargetUnrealLocationCm = defaultTarget,
                MinRadiusCm = componentReference?.SplineMinRadiusCentimeters,
                MaxRadiusCm = componentReference?.SplineMaxRadiusCentimeters,
                MaxBufferCm = componentReference?.SplineMaxBufferCentimeters,
                MinBufferCm = componentReference?.SplineMinBufferCentimeters,
                EnforceSplineModeCornerRadius = componentReference?.SplineEnforceCornerRadius,
                MaxArcAngleDeg = componentReference?.SplineMaxArcAngleDegrees,
                MaxTargetAngleDeg = componentReference?.SplineMaxTargetAngleDegrees,
                MaxSlopeAngleDeg = componentReference?.SplineMaxSlopeAngleDegrees,
                PathStyle = InferConnectorPathStyle(
                    pathMode,
                    minLengthCm,
                    componentReference?.SplineMaxBufferCentimeters,
                    componentReference?.SplineMinRadiusCentimeters,
                    meshConfigs),
                MeshConfigs = meshConfigs,
                ComponentConfigs = componentConfigs,
            };
        }

        private static string? InferConnectorPathStyle(
            string? pathMode,
            double? minLengthCm,
            double? maxBufferCm,
            double? minRadiusCm,
            IReadOnlyList<FoxWatchManifestConnectorMeshConfig> meshConfigs)
        {
            if (meshConfigs.Count == 0)
            {
                return "endpoints-only";
            }

            var normalizedPathMode = NormalizeString(pathMode);
            if (normalizedPathMode.Contains("Arc", StringComparison.OrdinalIgnoreCase))
            {
                var arcHasCurveConstraints = (maxBufferCm ?? 0) > 0.001d && (minRadiusCm ?? 0) > 0.001d;
                return arcHasCurveConstraints ? "spline" : "straight-telescoping";
            }

            var primaryMeshConfig = meshConfigs.FirstOrDefault(config =>
                NormalizeString(config.Mode).Contains("Spline", StringComparison.OrdinalIgnoreCase))
                ?? meshConfigs[0];
            var startOffset = primaryMeshConfig?.StartOffset ?? 0;
            var endOffset = primaryMeshConfig?.EndOffset ?? 0;
            var hasCurveConstraints = (maxBufferCm ?? 0) > 0.001d && (minRadiusCm ?? 0) > 0.001d;
            var hasTelescopingOffsets = startOffset > 1d && endOffset > 1d;

            if (!hasCurveConstraints && hasTelescopingOffsets)
            {
                return "straight-telescoping";
            }

            if (hasCurveConstraints)
            {
                return "spline";
            }

            if (string.Equals(NormalizeString(primaryMeshConfig?.Mode), "Spline", StringComparison.OrdinalIgnoreCase))
            {
                return "spline";
            }

            return meshConfigs.Count > 0 ? "interval" : null;
        }

        private FoxWatchBlueprintComponentReference? ResolveConnectorComponentReference(UBlueprintGeneratedClass blueprint)
        {
            if (_meshAssetExporter == null)
            {
                return null;
            }

            try
            {
                var componentReferences = _meshAssetExporter
                    .InspectBlueprintComponentsAsync(GetPackagePath(blueprint))
                    .GetAwaiter()
                    .GetResult();

                return componentReferences.FirstOrDefault(reference =>
                           reference.SplineConnectorMeshConfigs.Count > 0 ||
                           reference.SplineDefaultTargetUnrealLocationCentimeters is { Count: >= 3 })
                    ?? componentReferences.FirstOrDefault(reference =>
                        reference.ComponentType.Contains("Spline", StringComparison.OrdinalIgnoreCase) &&
                        reference.ComponentName.Contains("Spline", StringComparison.OrdinalIgnoreCase));
            }
            catch
            {
                return null;
            }
        }

        private static FoxWatchManifestConnectorMeshConfig CreateConnectorMeshConfig(
            FoxWatchSplineConnectorMeshConfigReference config)
        {
            return new FoxWatchManifestConnectorMeshConfig
            {
                Mode = NullIfWhiteSpace(NormalizeString(config.Mode)),
                MeshPaths = [.. config.MeshPaths
                    .Select(NormalizeReferencedObjectPath)
                    .Where(path => !string.IsNullOrWhiteSpace(path))],
                SplineMeshAxis = NullIfWhiteSpace(NormalizeString(config.SplineMeshAxis)),
                NativeMeshLengthCm = config.NativeMeshLengthCentimeters,
                Interval = config.Interval,
                StartOffset = config.StartOffset,
                EndOffset = config.EndOffset,
                FillRemainder = config.FillRemainder,
                ExtendSplineToMinLength = config.ExtendSplineToMinLength,
                SplineStartOffset = config.SplineStartOffset == null ? null : [.. config.SplineStartOffset],
                SplineEndOffset = config.SplineEndOffset == null ? null : [.. config.SplineEndOffset],
                SplineBoundaryMin = config.SplineBoundaryMin,
                SplineBoundaryMax = config.SplineBoundaryMax,
                SplineMaterialScaling = config.SplineMaterialScaling == null ? null : [.. config.SplineMaterialScaling],
                RelativeLocation = config.RelativeLocation == null ? null : [.. config.RelativeLocation],
                RelativeScale = config.RelativeScale == null ? null : [.. config.RelativeScale],
            };
        }

        private static FoxWatchManifestSplineComponentConfig CreateSplineComponentConfig(
            FoxWatchSplineConnectorComponentConfigReference config)
        {
            return new FoxWatchManifestSplineComponentConfig
            {
                ComponentName = NullIfWhiteSpace(NormalizeString(config.ComponentName)) ?? string.Empty,
                Distance = config.Distance,
                RelativeLocation = config.RelativeLocation == null ? null : [.. config.RelativeLocation],
                RelativeRotation = config.RelativeRotation == null ? null : [.. config.RelativeRotation],
            };
        }

        private List<FoxWatchManifestVehicleSeat> ExtractVehicleSeats(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            string baseAssetsUrl,
            string? iconOutputDirectory)
        {
            if (!HasBlueprintOwnedComponentType(objects, blueprint, "VehicleSeatComponent"))
            {
                return [];
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));
            var seats = new List<FoxWatchManifestVehicleSeat>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var seat = ExtractVehicleSeat(objects, blueprint, item, componentLookup, baseAssetsUrl, iconOutputDirectory);
                    if (seat == null)
                    {
                        continue;
                    }

                    var key = BuildVehicleSeatKey(seat);
                    if (seen.Add(key))
                    {
                        seats.Add(seat);
                    }
                }
            }

            return seats;
        }

        private FoxWatchManifestVehicleSeat? ExtractVehicleSeat(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup,
            string baseAssetsUrl,
            string? iconOutputDirectory)
        {
            var componentType = GetObjectTypeName(component);
            if (!componentType.Contains("VehicleSeatComponent", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            if (string.IsNullOrWhiteSpace(componentName))
            {
                return null;
            }

            var seatDirection = NormalizeSeatDirection(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "Direction"));
            var mountCodeNameValue = NormalizeString(ExtractText(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MountCodeName")));
            var mountCodeName = string.IsNullOrWhiteSpace(mountCodeNameValue) ? null : mountCodeNameValue;
            var mountComponentPackagePath = GetReferencedPackagePath(component, "MountComponent");
            var mountComponentMetadata = ReadMountComponentMetadata(mountComponentPackagePath, baseAssetsUrl, iconOutputDirectory);
            var transform = ResolveBlueprintComponentTransform(rootObjects, blueprint, component, componentLookup);
            var facingYawDegrees = ResolveVehicleSeatFacingYawDegrees(rootObjects, blueprint, component, seatDirection, transform, preferVehicleForwardWhenUnspecified: true);

            return new FoxWatchManifestVehicleSeat
            {
                Name = componentName,
                ComponentType = componentType,
                SeatType = ClassifyVehicleSeatType(componentName, mountCodeName),
                SeatDirection = seatDirection,
                MountCodeName = mountCodeName,
                MountComponent = mountComponentMetadata == null
                    ? null
                    : new FoxWatchManifestVehicleSeatMountComponent
                    {
                        PackagePath = mountComponentMetadata.PackagePath,
                        CodeName = mountComponentMetadata.CodeName,
                        DisplayName = mountComponentMetadata.DisplayName,
                        IconUrl = mountComponentMetadata.IconUrl,
                        AmmoName = mountComponentMetadata.AmmoName,
                        CompatibleAmmoNames = [.. mountComponentMetadata.CompatibleAmmoNames],
                        IsMultiWeapon = mountComponentMetadata.IsMultiWeapon,
                    },
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Rotation = facingYawDegrees,
            };
        }

        private List<FoxWatchManifestSpotlight> ExtractSpotlights(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint)
        {
            if (!HasBlueprintOwnedComponentType(objects, blueprint, "SpotLightComponent"))
            {
                return [];
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));
            var spotlights = new List<FoxWatchManifestSpotlight>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var spotlight = ExtractSpotlight(objects, blueprint, item, componentLookup);
                    if (spotlight == null)
                    {
                        continue;
                    }

                    var key = BuildSpotlightKey(spotlight);
                    if (seen.Add(key))
                    {
                        spotlights.Add(spotlight);
                    }
                }
            }

            return NormalizeVehicleSpotlights(blueprint, spotlights);
        }

        private List<FoxWatchManifestSpotlight> NormalizeVehicleSpotlights(
            UBlueprintGeneratedClass blueprint,
            List<FoxWatchManifestSpotlight> extractedSpotlights)
        {
            if (extractedSpotlights.Count <= 1)
            {
                return extractedSpotlights;
            }

            var normalizedSpotlights = extractedSpotlights
                .GroupBy(BuildSpotlightNormalizationKey, StringComparer.OrdinalIgnoreCase)
                .Select(group => group
                    .OrderByDescending(GetSpotlightSignalScore)
                    .First())
                .ToList();

            ApplyKnownSpotlightPairCorrections(GetPackagePath(blueprint), normalizedSpotlights);
            return normalizedSpotlights;
        }

        private static void ApplyKnownSpotlightPairCorrections(
            string? blueprintPackagePath,
            List<FoxWatchManifestSpotlight> spotlights)
        {
            if (spotlights.Count != 2 || string.IsNullOrWhiteSpace(blueprintPackagePath))
            {
                return;
            }

            if (blueprintPackagePath.Contains("BPBusW", StringComparison.OrdinalIgnoreCase))
            {
                MirrorBrokenSpotlightPair(
                    spotlights,
                    spotlight => NormalizeString(spotlight.Name).Contains("Headlight_L", StringComparison.OrdinalIgnoreCase),
                    spotlight => NormalizeString(spotlight.Name).Contains("Headlight_R", StringComparison.OrdinalIgnoreCase));
                return;
            }

            if (blueprintPackagePath.Contains("BPTruckLiquidW", StringComparison.OrdinalIgnoreCase))
            {
                MirrorBrokenSpotlightPair(
                    spotlights,
                    spotlight => NormalizeString(spotlight.Name).Contains("SpotLight2", StringComparison.OrdinalIgnoreCase),
                    spotlight => NormalizeString(spotlight.Name).Contains("SpotLight", StringComparison.OrdinalIgnoreCase) &&
                        !NormalizeString(spotlight.Name).Contains("SpotLight2", StringComparison.OrdinalIgnoreCase));
            }
        }

        private static void MirrorBrokenSpotlightPair(
            List<FoxWatchManifestSpotlight> spotlights,
            Func<FoxWatchManifestSpotlight, bool> leftPredicate,
            Func<FoxWatchManifestSpotlight, bool> rightPredicate)
        {
            var leftSpotlight = spotlights.FirstOrDefault(leftPredicate);
            var rightSpotlight = spotlights.FirstOrDefault(rightPredicate);
            if (leftSpotlight == null || rightSpotlight == null || leftSpotlight == rightSpotlight)
            {
                return;
            }

            if (!ShouldMirrorBrokenSpotlight(leftSpotlight, rightSpotlight))
            {
                return;
            }

            leftSpotlight.X = rightSpotlight.X;
            leftSpotlight.Y = -Math.Abs(rightSpotlight.Y ?? 0);
            leftSpotlight.Z = rightSpotlight.Z;
            leftSpotlight.Rotation = rightSpotlight.Rotation;
            leftSpotlight.PlanarProjectionScale = rightSpotlight.PlanarProjectionScale;
        }

        private static bool ShouldMirrorBrokenSpotlight(
            FoxWatchManifestSpotlight leftSpotlight,
            FoxWatchManifestSpotlight rightSpotlight)
        {
            var leftX = leftSpotlight.X ?? 0;
            var rightX = rightSpotlight.X ?? 0;
            var leftY = leftSpotlight.Y ?? 0;
            var rightY = rightSpotlight.Y ?? 0;
            var leftZ = leftSpotlight.Z ?? 0;
            var rightZ = rightSpotlight.Z ?? 0;

            return (rightX - leftX) > 150 ||
                Math.Abs(Math.Abs(rightY) - Math.Abs(leftY)) > 40 ||
                Math.Abs(rightZ - leftZ) > 20;
        }

        private FoxWatchManifestSpotlight? ExtractSpotlight(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var componentType = GetObjectTypeName(component);
            if (!componentType.Contains("SpotLightComponent", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            if (string.IsNullOrWhiteSpace(componentName) || IsRemovedGeneratedComponentName(componentName))
            {
                return null;
            }

            var transform = ResolveBlueprintComponentTransform(rootObjects, blueprint, component, componentLookup);
            var spotlightPlanarHeading = ResolveSpotlightPlanarHeading(transform.Rotation);
            var spotlightYawDegrees = ResolveVehicleSpotlightFacingYawDegrees(
                blueprint,
                component,
                spotlightPlanarHeading.YawDegrees);
            var intensity = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "Intensity"))
                ?? ExtractDouble(GetNamedValue(component, "IntensityNits"));
            var lightColor = ExtractColorHex(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "LightColor"));

            return new FoxWatchManifestSpotlight
            {
                Name = componentName,
                ComponentType = componentType,
                LightType = "spot",
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Rotation = spotlightYawDegrees,
                PlanarProjectionScale = spotlightPlanarHeading.PlanarProjectionScale,
                OuterConeAngle = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "OuterConeAngle")),
                InnerConeAngle = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "InnerConeAngle")),
                AttenuationRadius = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "AttenuationRadius")),
                Intensity = intensity,
                LightColor = string.IsNullOrWhiteSpace(lightColor) ? null : lightColor,
                SourceRadius = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "SourceRadius")),
                SoftSourceRadius = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "SoftSourceRadius")),
                SourceLength = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "SourceLength")),
            };
        }

        private double? ResolveVehicleSpotlightFacingYawDegrees(
            UBlueprintGeneratedClass blueprint,
            object component,
            double? extractedYawDegrees)
        {
            var blueprintPackagePath = GetPackagePath(blueprint);
            if (string.IsNullOrWhiteSpace(blueprintPackagePath) ||
                !TryGetBlueprintComponentReference(blueprintPackagePath, component, out var componentReference, out var componentReferences))
            {
                return extractedYawDegrees;
            }

            var isVehicleAttachedSpotlight = IsComponentReferenceAttachedToAncestor(componentReference, componentReferences, "CharacterMesh0") ||
                TryResolveKnownRootSpotlightYawOffset(componentReference, componentReferences, out _);
            if (!isVehicleAttachedSpotlight)
            {
                return extractedYawDegrees;
            }

            if (!HasMeaningfulRelativeComponentReferenceRotation(componentReference))
            {
                return ResolveCanonicalVehicleForwardYawDegrees(GetVehicleSeatForwardHints(blueprintPackagePath, componentReferences).SeatYawDegrees) ?? 0;
            }

            if (ShouldTreatQuarterTurnVehicleSpotlightAsVehicleForward(componentReference))
            {
                return ResolveCanonicalVehicleForwardYawDegrees(GetVehicleSeatForwardHints(blueprintPackagePath, componentReferences).SeatYawDegrees) ?? 0;
            }

            return extractedYawDegrees;
        }

        private List<FoxWatchManifestRange> ExtractRanges(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            object defaultObject)
        {
            var ranges = new List<FoxWatchManifestRange>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var range in ExtractVehicleWeaponRanges(objects, blueprint, defaultObject))
            {
                if (seen.Add(BuildManifestRangeKey(range)))
                {
                    ranges.Add(range);
                }
            }

            foreach (var range in ExtractAiTurretRanges(objects, blueprint, defaultObject))
            {
                if (seen.Add(BuildManifestRangeKey(range)))
                {
                    ranges.Add(range);
                }
            }

            foreach (var range in ExtractFortArtilleryRanges(objects, blueprint, defaultObject))
            {
                if (seen.Add(BuildManifestRangeKey(range)))
                {
                    ranges.Add(range);
                }
            }

            foreach (var range in ExtractCraneRanges(objects, blueprint, defaultObject))
            {
                if (seen.Add(BuildManifestRangeKey(range)))
                {
                    ranges.Add(range);
                }
            }

            foreach (var range in ExtractOverlapRanges(defaultObject))
            {
                if (seen.Add(BuildManifestRangeKey(range)))
                {
                    ranges.Add(range);
                }
            }

            foreach (var range in ExtractMapIntelligenceRanges(objects, blueprint, defaultObject))
            {
                if (seen.Add(BuildManifestRangeKey(range)))
                {
                    ranges.Add(range);
                }
            }

            return ranges;
        }

        private List<FoxWatchManifestRange> ExtractVehicleWeaponRanges(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            object defaultObject)
        {
            if (!HasBlueprintOwnedComponentType(objects, blueprint, "VehicleSeatComponent") &&
                !HasBlueprintOwnedComponentType(objects, blueprint, "StructureSeatComponent"))
            {
                return [];
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));
            var ranges = new List<FoxWatchManifestRange>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenComponentNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    if (!componentType.Contains("VehicleSeatComponent", StringComparison.OrdinalIgnoreCase) &&
                        !componentType.Contains("StructureSeatComponent", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var componentName = NormalizeString(ExtractText(GetNamedValue(item, "Name")));
                    if (!string.IsNullOrWhiteSpace(componentName) && !seenComponentNames.Add(componentName))
                    {
                        continue;
                    }

                    var range = ExtractVehicleWeaponRange(objects, blueprint, item, componentLookup);
                    if (range == null)
                    {
                        continue;
                    }

                    var rangeKey = BuildManifestRangeKey(range);
                    if (seen.Add(rangeKey))
                    {
                        ranges.Add(range);
                    }
                }
            }

            return ranges;
        }

        private List<FoxWatchManifestRange> ExtractAiTurretRanges(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            object defaultObject)
        {
            if (!HasBlueprintOwnedAiTurretComponent(objects, blueprint))
            {
                return [];
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));
            var ranges = new List<FoxWatchManifestRange>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenComponentNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    if (!IsAiTurretComponentType(componentType))
                    {
                        continue;
                    }

                    var componentName = NormalizeString(ExtractText(GetNamedValue(item, "Name")));
                    if (!string.IsNullOrWhiteSpace(componentName) && !seenComponentNames.Add(componentName))
                    {
                        continue;
                    }

                    var range = ExtractAiTurretRange(objects, blueprint, item, componentLookup);
                    if (range == null)
                    {
                        continue;
                    }

                    var rangeKey = BuildManifestRangeKey(range);
                    if (seen.Add(rangeKey))
                    {
                        ranges.Add(range);
                    }
                }
            }

            return ranges;
        }

        private List<FoxWatchManifestRange> ExtractMapIntelligenceRanges(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            object defaultObject)
        {
            if (!HasBlueprintOwnedComponentType(objects, blueprint, "MapIntelligenceSourceComponent"))
            {
                return [];
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));
            var ranges = new List<FoxWatchManifestRange>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenComponentNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    if (!componentType.Contains("MapIntelligenceSourceComponent", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var componentName = NormalizeString(ExtractText(GetNamedValue(item, "Name")));
                    if (!string.IsNullOrWhiteSpace(componentName) && !seenComponentNames.Add(componentName))
                    {
                        continue;
                    }

                    var range = ExtractMapIntelligenceRange(objects, blueprint, defaultObject, item, componentLookup);
                    if (range == null)
                    {
                        continue;
                    }

                    var rangeKey = BuildManifestRangeKey(range);
                    if (seen.Add(rangeKey))
                    {
                        ranges.Add(range);
                    }
                }
            }

            return ranges;
        }

        private List<FoxWatchManifestRange> ExtractCraneRanges(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            object defaultObject)
        {
            if (!HasBlueprintOwnedComponentType(objects, blueprint, "CraneComponent"))
            {
                return [];
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var ranges = new List<FoxWatchManifestRange>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenComponentNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    if (!componentType.Contains("CraneComponent", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var componentName = NormalizeString(ExtractText(GetNamedValue(item, "Name")));
                    if (!string.IsNullOrWhiteSpace(componentName) && !seenComponentNames.Add(componentName))
                    {
                        continue;
                    }

                    var range = ExtractCraneRange(objects, blueprint, item);
                    if (range == null)
                    {
                        continue;
                    }

                    var rangeKey = BuildManifestRangeKey(range);
                    if (seen.Add(rangeKey))
                    {
                        ranges.Add(range);
                    }
                }
            }

            return ranges;
        }

        private static List<FoxWatchManifestRange> ExtractOverlapRanges(object defaultObject)
        {
            var minDistanceToSameStructure = ExtractDouble(GetNamedValue(defaultObject, "MinDistanceToSameStructure"));
            if (minDistanceToSameStructure is not > 0)
            {
                return [];
            }

            return
            [
                new FoxWatchManifestRange
                {
                    Type = "overlap",
                    Overlap = RoundRangeDistance(minDistanceToSameStructure),
                }
            ];
        }

        private FoxWatchManifestRange? ExtractVehicleWeaponRange(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var isEnabled = ExtractBoolValue(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "bIsEnabled"));
            if (isEnabled == false)
            {
                return null;
            }

            var mountCodeName = NormalizeString(ExtractText(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MountCodeName")));
            if (string.IsNullOrWhiteSpace(mountCodeName))
            {
                return null;
            }

            var seatDirection = NormalizeSeatDirection(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "Direction"));
            var mountDynamicData = ResolveMountDynamicDataEntry(mountCodeName, seatDirection);
            if (mountDynamicData == null || !mountDynamicData.HasWeaponRange)
            {
                return null;
            }

            var mountComponentPackagePath = GetReferencedPackagePath(component, "MountComponent");
            var mountComponentMetadata = ReadMountComponentMetadata(mountComponentPackagePath);
            var rangeType = ClassifyVehicleWeaponRangeType(mountCodeName, mountDynamicData, mountComponentMetadata);
            if (string.IsNullOrWhiteSpace(rangeType))
            {
                return null;
            }

            var transform = ResolveBlueprintComponentTransform(rootObjects, blueprint, component, componentLookup);
            var facingYawDegrees = ResolveVehicleSeatFacingYawDegrees(rootObjects, blueprint, component, seatDirection, transform);
            var yawCenter = ComputeYawCenterDegrees(mountDynamicData.MinYaw, mountDynamicData.MaxYaw);
            var arc = ComputeYawArcDegrees(mountDynamicData.MinYaw, mountDynamicData.MaxYaw);
            var rotation = NormalizeDegrees(facingYawDegrees + (mountDynamicData.YawOffset ?? 0) + yawCenter);

            var maxDistance = mountComponentMetadata?.ExtendedMaxDistance is > 0
                ? mountComponentMetadata.ExtendedMaxDistance
                : mountDynamicData.MaxDistance;

            return new FoxWatchManifestRange
            {
                Type = rangeType,
                CodeName = mountDynamicData.Key,
                X = RoundRangeDistance(transform.X),
                Y = RoundRangeDistance(transform.Y),
                Rotation = arc is > 0 and < 360 ? RoundRangeValue(rotation) : null,
                Arc = arc is > 0 and < 360 ? RoundRangeValue(arc.Value) : null,
                Min = RoundRangeDistance(mountDynamicData.MinDistance),
                Max = RoundRangeDistance(maxDistance),
                Reach = RoundRangeDistance(mountDynamicData.MaxReachability),
            };
        }

        private FoxWatchManifestRange? ExtractAiTurretRange(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var maximumRange = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MaximumRange"));
            if (maximumRange is not > 0)
            {
                return null;
            }

            var damageAttributes = GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "DamageAttributes");
            var alternateDamageAttributes = GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "DamageAttributesAlternate");
            var rangeType = ClassifyAiTurretRangeType(blueprint, component, damageAttributes, alternateDamageAttributes);
            if (string.IsNullOrWhiteSpace(rangeType))
            {
                return null;
            }

            var transform = ResolveBlueprintComponentTransform(rootObjects, blueprint, component, componentLookup);
            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            var rangeCodeName = string.Equals(componentName, "AITurretComponent", StringComparison.OrdinalIgnoreCase)
                ? null
                : componentName;
            var arc = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "FiringConeAngle"));

            return new FoxWatchManifestRange
            {
                Type = rangeType,
                CodeName = string.IsNullOrWhiteSpace(rangeCodeName) ? null : rangeCodeName,
                X = RoundRangeDistance(transform.X),
                Y = RoundRangeDistance(transform.Y),
                Rotation = arc is > 0 and < 360 ? RoundRangeValue(NormalizeDegrees(transform.YawDegrees)) : null,
                Arc = arc is > 0 and < 360 ? RoundRangeValue(arc.Value) : null,
                Max = RoundRangeDistance(maximumRange),
            };
        }

        private List<FoxWatchManifestRange> ExtractFortArtilleryRanges(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            object defaultObject)
        {
            var maxDistance = ExtractDouble(GetNamedValue(defaultObject, "MaxDistance"));
            var minDistance = ExtractDouble(GetNamedValue(defaultObject, "MinDistance"));
            if (maxDistance is not > 0 && minDistance is not > 0)
            {
                return [];
            }

            var rangeType = ClassifyFortArtilleryRangeType(blueprint, defaultObject);
            if (string.IsNullOrWhiteSpace(rangeType))
            {
                return [];
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));
            object? structureArrow = null;

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentName = NormalizeString(ExtractText(GetNamedValue(item, "Name")));
                    if (!string.Equals(componentName, "StructureArrow", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    structureArrow = item;
                    break;
                }

                if (structureArrow != null)
                {
                    break;
                }
            }

            var firingAngle = ExtractDouble(GetNamedValue(defaultObject, "FiringAngle"));
            var originX = 0.0;
            var originY = 0.0;
            double? rotation = null;

            if (structureArrow != null)
            {
                var transform = ResolveBlueprintComponentTransform(objects, blueprint, structureArrow, componentLookup);
                originX = transform.X;
                originY = transform.Y;
                rotation = firingAngle is > 0 and < 360 ? RoundRangeValue(NormalizeDegrees(transform.YawDegrees)) : null;
            }

            return
            [
                new FoxWatchManifestRange
                {
                    Type = rangeType,
                    X = RoundRangeDistance(originX),
                    Y = RoundRangeDistance(originY),
                    Rotation = rotation,
                    Arc = firingAngle is > 0 and < 360 ? RoundRangeValue(firingAngle.Value) : null,
                    Min = RoundRangeDistance(minDistance),
                    Max = RoundRangeDistance(maxDistance),
                }
            ];
        }

        private FoxWatchManifestRange? ExtractMapIntelligenceRange(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object defaultObject,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var mapIntelligenceType = NullIfWhiteSpace(NormalizeEnumValue(GetNamedValue(defaultObject, "MapIntelligenceType")));
            var detectionRadius = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "DetectionRadius"))
                ?? GetDefaultMapIntelligenceDetectionRadius(mapIntelligenceType);
            if (detectionRadius is not > 0)
            {
                return null;
            }

            var transform = ResolveBlueprintComponentTransform(rootObjects, blueprint, component, componentLookup);
            var halfDetectionAngle = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "HalfDetectionAngle"));
            var defaultViewDirectionOffset = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "DefaultViewDirectionOffset")) ?? 0;
            double? arc = halfDetectionAngle is > 0 and < 180
                ? halfDetectionAngle.Value * 2.0
                : null;
            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            var rangeCodeName = mapIntelligenceType;

            if (string.IsNullOrWhiteSpace(rangeCodeName) &&
                !string.Equals(componentName, "MapIntelligenceSource", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(componentName, "MapIntelligenceSourceComponent", StringComparison.OrdinalIgnoreCase))
            {
                rangeCodeName = componentName;
            }

            return new FoxWatchManifestRange
            {
                Type = "intel",
                CodeName = rangeCodeName,
                X = RoundRangeDistance(transform.X),
                Y = RoundRangeDistance(transform.Y),
                Rotation = arc is > 0 and < 360
                    ? RoundRangeValue(NormalizeDegrees(transform.YawDegrees + defaultViewDirectionOffset))
                    : null,
                Arc = arc is > 0 and < 360 ? RoundRangeValue(arc.Value) : null,
                Max = RoundRangeDistance(detectionRadius),
            };
        }

        private FoxWatchManifestRange? ExtractCraneRange(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component)
        {
            var config = GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "Config");
            if (config == null)
            {
                return null;
            }

            var minHorizontalDistanceToTarget = ExtractDouble(GetNamedValue(config, "MinHorizontalDistanceToTarget"));
            var maxHorizontalDistanceToTarget = ExtractDouble(GetNamedValue(config, "MaxHorizontalDistanceToTarget"));
            if (minHorizontalDistanceToTarget is not > 0 && maxHorizontalDistanceToTarget is not > 0)
            {
                return null;
            }

            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            var rangeCodeName = string.Equals(componentName, "CraneComponent", StringComparison.OrdinalIgnoreCase)
                ? null
                : componentName;

            return new FoxWatchManifestRange
            {
                Type = "crane",
                CodeName = string.IsNullOrWhiteSpace(rangeCodeName) ? null : rangeCodeName,
                Min = RoundRangeDistance(minHorizontalDistanceToTarget),
                Max = RoundRangeDistance(maxHorizontalDistanceToTarget),
            };
        }

        private static double? GetDefaultMapIntelligenceDetectionRadius(string? mapIntelligenceType)
        {
            return NormalizeString(mapIntelligenceType) switch
            {
                // Native watchtower coverage is not serialized onto the cooked component export.
                "Watchtower" => 8000,
                _ => null,
            };
        }

        private object? GetInheritedBlueprintComponentProperty(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            string propertyName)
        {
            var resolvedValue = GetNamedValue(component, propertyName);
            if (resolvedValue != null)
            {
                return resolvedValue;
            }

            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            if (string.IsNullOrWhiteSpace(componentName))
            {
                return null;
            }

            foreach (var scope in EnumerateBlueprintComponentScopes(rootObjects, blueprint))
            {
                var matchingComponent = scope.Objects.FirstOrDefault(item =>
                    string.Equals(
                        NormalizeString(ExtractText(GetNamedValue(item, "Name"))),
                        componentName,
                        StringComparison.OrdinalIgnoreCase));
                if (matchingComponent == null)
                {
                    continue;
                }

                resolvedValue = GetNamedValue(matchingComponent, propertyName);
                if (resolvedValue != null)
                {
                    return resolvedValue;
                }
            }

            return null;
        }

        private double ResolveVehicleSeatFacingYawDegrees(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            string? seatDirection,
            ManifestComponentTransform transform,
            bool preferVehicleForwardWhenUnspecified = false)
        {
            if (ShouldUseHalftrackRearBenchTransformedYaw(blueprint, component))
            {
                return transform.YawDegrees;
            }

            if (ShouldUseSemanticVehicleSeatDirection(rootObjects, blueprint, component, seatDirection) &&
                TryResolveSeatDirectionYawDegrees(seatDirection, out var semanticSeatYawDegrees))
            {
                return semanticSeatYawDegrees;
            }

            var resolvedVehicleForwardYawDegrees = ResolveVehicleSeatForwardYawDegrees(blueprint, component);
            if (ShouldTreatQuarterTurnVehicleSeatAsVehicleForward(rootObjects, blueprint, component, seatDirection))
            {
                return resolvedVehicleForwardYawDegrees ?? 0;
            }

            if (ShouldUseVehicleForwardForQuarterTurnSeatDirection(seatDirection) &&
                IsQuarterTurnYawDegrees(transform.YawDegrees, toleranceDegrees: 5.0))
            {
                return resolvedVehicleForwardYawDegrees ?? 0;
            }

            if (HasMeaningfulVehicleSeatRelativeRotation(rootObjects, blueprint, component))
            {
                return transform.YawDegrees;
            }

            if (ShouldTreatVehicleSeatAsVehicleForward(rootObjects, blueprint, component, seatDirection))
            {
                return resolvedVehicleForwardYawDegrees ?? 0;
            }

            if (TryResolveSeatDirectionYawDegrees(seatDirection, out var semanticYawDegrees))
            {
                return semanticYawDegrees;
            }

            return preferVehicleForwardWhenUnspecified
                ? resolvedVehicleForwardYawDegrees ?? 0
                : transform.YawDegrees;
        }

        private double? ResolveVehicleSeatForwardYawDegrees(
            UBlueprintGeneratedClass blueprint,
            object component)
        {
            var blueprintPackagePath = GetPackagePath(blueprint);
            if (string.IsNullOrWhiteSpace(blueprintPackagePath) ||
                !TryGetBlueprintComponentReference(blueprintPackagePath, component, out var componentReference, out var componentReferences))
            {
                return null;
            }

            var forwardHints = GetVehicleSeatForwardHints(blueprintPackagePath, componentReferences);

            if (forwardHints.SeatYawDegrees != null)
            {
                return ResolveCanonicalVehicleForwardYawDegrees(forwardHints.SeatYawDegrees);
            }

            var attachSocketName = NormalizeComponentReferenceName(componentReference.AttachSocketName);
            if (string.IsNullOrWhiteSpace(attachSocketName) ||
                string.Equals(attachSocketName, "None", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            return ResolveCanonicalVehicleForwardYawDegrees(forwardHints.SpotlightYawDegrees);
        }

        private static double? ResolveCanonicalVehicleForwardYawDegrees(double? yawDegrees)
        {
            if (yawDegrees == null)
            {
                return null;
            }

            return IsQuarterTurnYawDegrees(yawDegrees.Value, toleranceDegrees: 5.0)
                ? 0
                : yawDegrees;
        }

        private VehicleSeatForwardHints GetVehicleSeatForwardHints(
            string blueprintPackagePath,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            if (_vehicleSeatForwardHintsByPackagePath.TryGetValue(blueprintPackagePath, out var forwardHints))
            {
                return forwardHints;
            }

            forwardHints = new VehicleSeatForwardHints(
                ResolveConsistentComponentReferenceYawDegrees(
                    blueprintPackagePath,
                    componentReferences,
                    reference => reference.ComponentType.Contains("VehicleSeatComponent", StringComparison.OrdinalIgnoreCase) &&
                        HasMeaningfulRelativeComponentReferenceRotation(reference)),
                ResolveConsistentComponentReferenceYawDegrees(
                    blueprintPackagePath,
                    componentReferences,
                    reference => reference.ComponentType.Contains("SpotLightComponent", StringComparison.OrdinalIgnoreCase) &&
                        HasMeaningfulRelativeComponentReferenceRotation(reference)));
            _vehicleSeatForwardHintsByPackagePath[blueprintPackagePath] = forwardHints;
            return forwardHints;
        }

        private double? ResolveConsistentComponentReferenceYawDegrees(
            string blueprintPackagePath,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
            Func<FoxWatchBlueprintComponentReference, bool> predicate)
        {
            double? resolvedYawDegrees = null;
            foreach (var componentReference in componentReferences)
            {
                if (!predicate(componentReference))
                {
                    continue;
                }

                var transform = ResolveComponentReferenceTransform(componentReference, componentReferences);
                var correctedTransform = ShouldBypassBlueprintReferenceFrameCorrections(blueprintPackagePath)
                    ? transform
                    : ApplyKnownBlueprintReferenceFrameCorrections(
                        componentReference,
                        componentReferences,
                        transform);
                var componentYawDegrees = NormalizeDegrees(
                    componentReference.ComponentType.Contains("SpotLightComponent", StringComparison.OrdinalIgnoreCase)
                        ? ResolveSpotlightPlanarHeading(correctedTransform.Rotation).YawDegrees ?? 0
                        : correctedTransform.YawDegrees);
                if (resolvedYawDegrees == null)
                {
                    resolvedYawDegrees = componentYawDegrees;
                    continue;
                }

                if (Math.Abs(NormalizeDegrees(componentYawDegrees - resolvedYawDegrees.Value)) > 1.0)
                {
                    return null;
                }
            }

            return resolvedYawDegrees;
        }

        private static bool HasMeaningfulRelativeComponentReferenceRotation(FoxWatchBlueprintComponentReference componentReference)
        {
            return Math.Abs(ParseRotatorValue(componentReference.RelativeRotation, "pitch") ?? 0) > 0.0001 ||
                Math.Abs(ParseRotatorValue(componentReference.RelativeRotation, "yaw") ?? 0) > 0.0001 ||
                Math.Abs(ParseRotatorValue(componentReference.RelativeRotation, "roll") ?? 0) > 0.0001;
        }

        private static bool IsRemovedGeneratedComponentName(string componentName)
        {
            return componentName.Contains("_REMOVED_", StringComparison.OrdinalIgnoreCase);
        }

        private bool ShouldTreatVehicleSeatAsVehicleForward(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            string? seatDirection)
        {
            var normalizedSeatDirection = NormalizeString(seatDirection);
            if (ShouldTreatMountedLateralSeatAsVehicleForward(rootObjects, blueprint, component, normalizedSeatDirection))
            {
                return true;
            }

            var blueprintPackagePath = NormalizeString(GetPackagePath(blueprint));
            if (!blueprintPackagePath.Contains("/Vehicles/FieldWeapons/", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return string.IsNullOrWhiteSpace(normalizedSeatDirection) ||
                IsLateralSeatDirection(normalizedSeatDirection);
        }

        private bool ShouldUseSemanticVehicleSeatDirection(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            string? seatDirection)
        {
            if (string.IsNullOrWhiteSpace(seatDirection))
            {
                return false;
            }

            var mountCodeName = NormalizeString(ExtractText(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MountCodeName")));
            var mountComponentPath = NormalizeString(ResolveReferencedObjectPath(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MountComponent")));
            return string.IsNullOrWhiteSpace(mountCodeName) && string.IsNullOrWhiteSpace(mountComponentPath);
        }

        private bool ShouldTreatQuarterTurnVehicleSeatAsVehicleForward(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            string? seatDirection)
        {
            if (!ShouldUseVehicleForwardForQuarterTurnSeatDirection(seatDirection))
            {
                return false;
            }

            var relativeRotation = ResolveInheritedTransformProperty(
                rootObjects,
                blueprint,
                component,
                "RelativeRotation",
                value => IsIdentityTransformRotator(value));
            return HasQuarterTurnPlanarRotation(relativeRotation, toleranceDegrees: 5.0);
        }

        private static bool ShouldUseVehicleForwardForQuarterTurnSeatDirection(string? seatDirection)
        {
            if (string.IsNullOrWhiteSpace(seatDirection))
            {
                return true;
            }

            return string.Equals(seatDirection, "Front", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(seatDirection, "Center", StringComparison.OrdinalIgnoreCase);
        }

        private bool ShouldUseHalftrackRearBenchTransformedYaw(
            UBlueprintGeneratedClass blueprint,
            object component)
        {
            var blueprintPackagePath = NormalizeString(GetPackagePath(blueprint));
            if (!blueprintPackagePath.Contains("/Vehicles/Halftrack/", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            return componentName.StartsWith("RearSeat", StringComparison.OrdinalIgnoreCase);
        }

        private bool ShouldTreatMountedLateralSeatAsVehicleForward(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            string? seatDirection)
        {
            if (!IsLateralSeatDirection(seatDirection))
            {
                return false;
            }

            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            var mountCodeName = NormalizeString(ExtractText(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MountCodeName")));
            var mountComponentPath = NormalizeString(ResolveReferencedObjectPath(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MountComponent")));

            if (string.IsNullOrWhiteSpace(mountCodeName) && string.IsNullOrWhiteSpace(mountComponentPath))
            {
                return false;
            }

            return !HasExplicitLateralSeatDirectionHint(componentName, seatDirection) &&
                !HasExplicitLateralSeatDirectionHint(mountCodeName, seatDirection) &&
                !HasExplicitLateralSeatDirectionHint(mountComponentPath, seatDirection);
        }

        private static bool IsLateralSeatDirection(string? seatDirection)
        {
            return string.Equals(seatDirection, "Left", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(seatDirection, "Right", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(seatDirection, "Port", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(seatDirection, "Starboard", StringComparison.OrdinalIgnoreCase);
        }

        private static bool HasExplicitLateralSeatDirectionHint(string? identifier, string? seatDirection)
        {
            var normalizedIdentifier = NormalizeString(identifier);
            if (string.IsNullOrWhiteSpace(normalizedIdentifier) || string.IsNullOrWhiteSpace(seatDirection))
            {
                return false;
            }

            return NormalizeString(seatDirection) switch
            {
                "Left" => normalizedIdentifier.Contains("Left", StringComparison.OrdinalIgnoreCase),
                "Right" => normalizedIdentifier.Contains("Right", StringComparison.OrdinalIgnoreCase),
                "Port" => normalizedIdentifier.Contains("Port", StringComparison.OrdinalIgnoreCase),
                "Starboard" => normalizedIdentifier.Contains("Starboard", StringComparison.OrdinalIgnoreCase) ||
                    normalizedIdentifier.Contains("Star", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        private bool HasMeaningfulVehicleSeatRelativeRotation(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component)
        {
            var relativeRotation = ResolveInheritedTransformProperty(
                rootObjects,
                blueprint,
                component,
                "RelativeRotation",
                value => IsIdentityTransformRotator(value));

            return relativeRotation != null && !IsIdentityTransformRotator(relativeRotation);
        }

        private static bool ShouldTreatQuarterTurnVehicleSpotlightAsVehicleForward(
            FoxWatchBlueprintComponentReference componentReference)
        {
            if (!NormalizeString(componentReference.ComponentType).Contains("SpotLightComponent", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var pitchDegrees = ParseRotatorValue(componentReference.RelativeRotation, "pitch") ?? 0;
            var yawDegrees = NormalizeDegrees(ParseRotatorValue(componentReference.RelativeRotation, "yaw") ?? 0);
            var rollDegrees = ParseRotatorValue(componentReference.RelativeRotation, "roll") ?? 0;
            return Math.Abs(pitchDegrees) <= 0.0001 &&
                Math.Abs(rollDegrees) <= 0.0001 &&
                IsQuarterTurnYawDegrees(yawDegrees, toleranceDegrees: 5.0);
        }

        private static bool HasQuarterTurnPlanarRotation(object? relativeRotation, double toleranceDegrees = 1.0)
        {
            var pitchDegrees = ExtractVectorComponent(relativeRotation, "Pitch") ?? 0;
            var yawDegrees = NormalizeDegrees(ExtractVectorComponent(relativeRotation, "Yaw") ?? 0);
            var rollDegrees = ExtractVectorComponent(relativeRotation, "Roll") ?? 0;
            return Math.Abs(pitchDegrees) <= 0.0001 &&
                Math.Abs(rollDegrees) <= 0.0001 &&
                IsQuarterTurnYawDegrees(yawDegrees, toleranceDegrees);
        }

        private static bool IsQuarterTurnYawDegrees(double yawDegrees, double toleranceDegrees = 1.0)
        {
            var normalizedYawDegrees = NormalizeDegrees(yawDegrees);
            return Math.Abs(Math.Abs(normalizedYawDegrees) - 90.0) <= toleranceDegrees;
        }

        private ManifestComponentTransform ResolveBlueprintComponentTransform(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            ManifestComponentTransform transform;
            var blueprintPackagePath = GetPackagePath(blueprint);
            if (!string.IsNullOrWhiteSpace(blueprintPackagePath) &&
                TryGetBlueprintComponentReference(blueprintPackagePath, component, out var componentReference, out var componentReferences))
            {
                transform = ResolveComponentReferenceTransform(componentReference, componentReferences);
                if (ShouldBypassBlueprintReferenceFrameCorrections(blueprintPackagePath))
                {
                    return transform;
                }

                return ApplyKnownBlueprintReferenceFrameCorrections(
                    componentReference,
                    componentReferences,
                    transform);
            }

            transform = ResolveInheritedBuildSocketComponentTransform(rootObjects, blueprint, component, componentLookup);
            return ApplyKnownBlueprintFrameCorrections(rootObjects, blueprint, component, componentLookup, transform);
        }

        private static bool ShouldBypassBlueprintReferenceFrameCorrections(string blueprintPackagePath)
        {
            return blueprintPackagePath.Contains("/Vehicles/FieldWeapons/", StringComparison.OrdinalIgnoreCase);
        }

        private ManifestComponentTransform ApplyKnownBlueprintReferenceFrameCorrections(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
            ManifestComponentTransform transform)
        {
            if (TryResolveKnownReferenceCharacterMeshYawOffset(
                    componentReference,
                    componentReferences,
                    out var yawOffsetDegrees))
            {
                var characterMeshReference = componentReferences.FirstOrDefault(reference =>
                    string.Equals(
                        NormalizeComponentReferenceName(reference.ComponentName),
                        "CharacterMesh0",
                        StringComparison.OrdinalIgnoreCase));
                if (characterMeshReference == null)
                {
                    return transform;
                }

                var pivotTransform = ResolveComponentReferenceTransform(characterMeshReference, componentReferences);
                return RotateComponentTransformAroundPivot(transform, pivotTransform.X, pivotTransform.Y, yawOffsetDegrees);
            }

            if (TryResolveKnownRootSpotlightYawOffset(
                    componentReference,
                    componentReferences,
                    out yawOffsetDegrees))
            {
                var characterMeshReference = componentReferences.FirstOrDefault(reference =>
                    string.Equals(
                        NormalizeComponentReferenceName(reference.ComponentName),
                        "CharacterMesh0",
                        StringComparison.OrdinalIgnoreCase));
                if (characterMeshReference == null)
                {
                    return transform;
                }

                var pivotTransform = ResolveComponentReferenceTransform(characterMeshReference, componentReferences);
                return RotateComponentTransformAroundPivot(transform, pivotTransform.X, pivotTransform.Y, yawOffsetDegrees);
            }

            return transform;
        }

        private bool TryResolveKnownRootSpotlightYawOffset(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
            out double yawOffsetDegrees)
        {
            yawOffsetDegrees = 0;

            if (!NormalizeString(componentReference.ComponentType).Contains("SpotLightComponent", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var normalizedAttachParentName = NormalizeComponentReferenceName(componentReference.AttachParentName);
            if (!string.IsNullOrWhiteSpace(normalizedAttachParentName) &&
                !string.Equals(normalizedAttachParentName, "None", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return TryResolveKnownVehicleBodyYawOffset(componentReferences, out yawOffsetDegrees);
        }

        private bool TryResolveKnownReferenceCharacterMeshYawOffset(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
            out double yawOffsetDegrees)
        {
            yawOffsetDegrees = 0;

            if (!TryResolveKnownVehicleBodyYawOffset(componentReferences, out yawOffsetDegrees))
            {
                return false;
            }

            var normalizedComponentName = NormalizeComponentReferenceName(componentReference.ComponentName);
            if (string.IsNullOrWhiteSpace(normalizedComponentName) ||
                string.Equals(normalizedComponentName, "CharacterMesh0", StringComparison.OrdinalIgnoreCase) ||
                IsPrimaryTrackedVehicleBodyReference(componentReference))
            {
                return false;
            }

            return true;
        }

        private static bool IsComponentReferenceAttachedToAncestor(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
            string ancestorName)
        {
            var normalizedAncestorName = NormalizeComponentReferenceName(ancestorName);
            if (string.IsNullOrWhiteSpace(normalizedAncestorName))
            {
                return false;
            }

            var componentByName = componentReferences
                .Where(reference => !string.IsNullOrWhiteSpace(reference.ComponentName))
                .GroupBy(reference => NormalizeComponentReferenceName(reference.ComponentName), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var currentReference = componentReference;

            while (true)
            {
                var currentName = NormalizeComponentReferenceName(currentReference.ComponentName);
                if (string.IsNullOrWhiteSpace(currentName) || !visited.Add(currentName))
                {
                    return false;
                }

                if (string.Equals(currentName, normalizedAncestorName, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                var parentName = NormalizeComponentReferenceName(currentReference.AttachParentName);
                if (string.IsNullOrWhiteSpace(parentName) ||
                    !componentByName.TryGetValue(parentName, out currentReference))
                {
                    return false;
                }
            }
        }

        private bool TryResolveKnownVehicleBodyYawOffset(
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
            out double yawOffsetDegrees)
        {
            yawOffsetDegrees = 0;

            if (TryResolveMeshBoundsVehicleBodyYawOffset(componentReferences, out yawOffsetDegrees))
            {
                return true;
            }

            return FoxWatchVehicleBodyFrameResolver.TryResolveQuarterTurnVehicleBodyYawOffset(
                componentReferences,
                out _,
                out yawOffsetDegrees);
        }

        private bool TryResolveMeshBoundsVehicleBodyYawOffset(
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
            out double yawOffsetDegrees)
        {
            yawOffsetDegrees = 0;

            if (_meshAssetExporter == null)
            {
                return false;
            }

            var characterMeshReference = componentReferences.FirstOrDefault(reference =>
                string.Equals(
                    NormalizeComponentReferenceName(reference.ComponentName),
                    "CharacterMesh0",
                    StringComparison.OrdinalIgnoreCase));
            if (characterMeshReference == null || !IsCollisionAnchoredVehicleBodyReference(characterMeshReference, componentReferences))
            {
                return false;
            }

            var visualBodyReference = componentReferences.FirstOrDefault(reference =>
                    string.Equals(NormalizeComponentReferenceName(reference.AttachParentName), "CharacterMesh0", StringComparison.OrdinalIgnoreCase) &&
                    IsPrimaryTrackedVehicleBodyReference(reference));
            if (visualBodyReference == null)
            {
                return false;
            }

            var xLengthCentimeters = _meshAssetExporter.ResolveMeshAxisLengthCentimeters(visualBodyReference.MeshPath, 'X');
            var yLengthCentimeters = _meshAssetExporter.ResolveMeshAxisLengthCentimeters(visualBodyReference.MeshPath, 'Y');
            if (xLengthCentimeters is not > 0 || yLengthCentimeters is not > 0 || yLengthCentimeters <= (xLengthCentimeters * 1.05))
            {
                return false;
            }

            yawOffsetDegrees = FoxWatchVehicleBodyFrameResolver.QuarterTurnYawDegrees;
            return true;
        }

        private static bool IsCollisionAnchoredVehicleBodyReference(
            FoxWatchBlueprintComponentReference characterMeshReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            var normalizedAttachParentName = NormalizeComponentReferenceName(characterMeshReference.AttachParentName);
            if (string.Equals(normalizedAttachParentName, "collisioncylinder", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(normalizedAttachParentName, "collision", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(normalizedAttachParentName, "vehiclecollision", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return componentReferences.Any(reference =>
                string.Equals(NormalizeComponentReferenceName(reference.AttachParentName), "CharacterMesh0", StringComparison.OrdinalIgnoreCase) &&
                IsPrimaryTrackedVehicleBodyReference(reference));
        }

        private bool TryGetBlueprintComponentReference(
            string blueprintPackagePath,
            object component,
            out FoxWatchBlueprintComponentReference componentReference,
            out IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            componentReferences = GetBlueprintComponentReferences(blueprintPackagePath);
            componentReference = null!;
            if (componentReferences.Count == 0)
            {
                return false;
            }

            var componentName = NormalizeTemplateComponentName(ExtractText(GetNamedValue(component, "Name")));
            if (string.IsNullOrWhiteSpace(componentName))
            {
                return false;
            }

            componentReference = componentReferences.FirstOrDefault(reference =>
                string.Equals(
                    NormalizeTemplateComponentName(NormalizeComponentReferenceName(reference.ComponentName)),
                    componentName,
                    StringComparison.OrdinalIgnoreCase))!;

            if (componentReference != null)
            {
                return true;
            }

            var normalizedComponentName = StripRemovedGeneratedComponentSuffix(componentName);
            componentReference = componentReferences
                .Where(reference => string.Equals(
                    StripRemovedGeneratedComponentSuffix(
                        NormalizeTemplateComponentName(NormalizeComponentReferenceName(reference.ComponentName))),
                    normalizedComponentName,
                    StringComparison.OrdinalIgnoreCase))
                .OrderBy(reference => IsRemovedGeneratedComponentName(NormalizeComponentReferenceName(reference.ComponentName)) ? 1 : 0)
                .FirstOrDefault()!;

            return componentReference != null;
        }

        private IReadOnlyList<FoxWatchBlueprintComponentReference> GetBlueprintComponentReferences(string blueprintPackagePath)
        {
            if (string.IsNullOrWhiteSpace(blueprintPackagePath) || _meshAssetExporter == null)
            {
                return [];
            }

            if (_blueprintComponentReferencesByPackagePath.TryGetValue(blueprintPackagePath, out var cachedReferences))
            {
                return cachedReferences;
            }

            try
            {
                cachedReferences = _meshAssetExporter
                    .InspectBlueprintComponentsAsync(blueprintPackagePath)
                    .GetAwaiter()
                    .GetResult();
            }
            catch
            {
                cachedReferences = [];
            }

            _blueprintComponentReferencesByPackagePath[blueprintPackagePath] = cachedReferences;
            return cachedReferences;
        }

        private FoxWatchMountDynamicDataEntry? ResolveMountDynamicDataEntry(string mountCodeName, string? seatDirection)
        {
            var entriesByKey = LoadMountDynamicDataEntries();
            if (entriesByKey.Count == 0)
            {
                return null;
            }

            if (entriesByKey.TryGetValue(mountCodeName, out var directMatch))
            {
                return directMatch;
            }

            foreach (var suffix in EnumerateSeatDirectionSuffixes(seatDirection))
            {
                if (entriesByKey.TryGetValue($"{mountCodeName}{suffix}", out var directionalMatch))
                {
                    return directionalMatch;
                }
            }

            var prefixMatches = entriesByKey.Values
                .Where(entry => entry.Key.StartsWith(mountCodeName, StringComparison.OrdinalIgnoreCase))
                .ToArray();
            if (prefixMatches.Length == 1)
            {
                return prefixMatches[0];
            }

            foreach (var suffix in EnumerateSeatDirectionSuffixes(seatDirection))
            {
                var directionalPrefixMatch = prefixMatches.FirstOrDefault(entry =>
                    entry.Key.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
                if (directionalPrefixMatch != null)
                {
                    return directionalPrefixMatch;
                }
            }

            return null;
        }

        private FoxWatchConstructionDynamicDataEntry? ResolveConstructionDynamicDataEntry(string codeName)
        {
            var entriesByKey = LoadConstructionDynamicDataEntries();
            if (entriesByKey.Count == 0)
            {
                return null;
            }

            return entriesByKey.TryGetValue(NormalizeString(codeName), out var entry)
                ? entry
                : null;
        }

        private IReadOnlyDictionary<string, FoxWatchMountDynamicDataEntry> LoadMountDynamicDataEntries()
        {
            if (_mountDynamicDataEntriesByKey != null)
            {
                return _mountDynamicDataEntriesByKey;
            }

            var entries = new Dictionary<string, FoxWatchMountDynamicDataEntry>(StringComparer.OrdinalIgnoreCase);

            try
            {
                var package = _fileProvider.LoadPackage(MountDynamicDataPackagePath);
                var exportTokens = JArray.Parse(JsonConvert.SerializeObject(package.GetExports().ToArray(), Formatting.None));
                var rows = exportTokens
                    .OfType<JObject>()
                    .FirstOrDefault(token =>
                        token.Value<string>("Type")?.Contains("DataTable", StringComparison.OrdinalIgnoreCase) == true ||
                        string.Equals(token.Value<string>("Name"), "BPMountDynamicData", StringComparison.OrdinalIgnoreCase))?
                    .Value<JObject>("Rows");
                if (rows == null)
                {
                    _mountDynamicDataEntriesByKey = entries;
                    return _mountDynamicDataEntriesByKey;
                }

                foreach (var row in rows.Properties())
                {
                    var key = NormalizeString(row.Name);
                    var value = row.Value as JObject;
                    if (string.IsNullOrWhiteSpace(key) || value == null)
                    {
                        continue;
                    }

                    entries[key] = new FoxWatchMountDynamicDataEntry
                    {
                        Key = key,
                        MinDistance = value.Value<double?>("MinDistance"),
                        MaxDistance = value.Value<double?>("MaxDistance"),
                        MaxReachability = value.Value<double?>("MaxReachability"),
                        MinYaw = value.Value<double?>("MinYaw"),
                        MaxYaw = value.Value<double?>("MaxYaw"),
                        YawOffset = value.Value<double?>("YawOffset"),
                    };
                }
            }
            catch
            {
                entries.Clear();
            }

            _mountDynamicDataEntriesByKey = entries;
            return _mountDynamicDataEntriesByKey;
        }

        private IReadOnlyDictionary<string, FoxWatchConstructionDynamicDataEntry> LoadConstructionDynamicDataEntries()
        {
            if (_constructionDynamicDataEntriesByKey != null)
            {
                return _constructionDynamicDataEntriesByKey;
            }

            var entries = new Dictionary<string, FoxWatchConstructionDynamicDataEntry>(StringComparer.OrdinalIgnoreCase);

            try
            {
                AppendConstructionDynamicDataEntries(entries, StructureDynamicDataPackagePath, "BPStructureDynamicData");
            }
            catch
            {
            }

            try
            {
                AppendConstructionDynamicDataEntries(entries, VehicleDynamicDataPackagePath, "BPVehicleDynamicData");
            }
            catch
            {
            }

            try
            {
                AppendConstructionDynamicDataEntries(entries, ItemDynamicDataPackagePath, "BPItemDynamicData");
            }
            catch
            {
            }

            _constructionDynamicDataEntriesByKey = entries;
            return _constructionDynamicDataEntriesByKey;
        }

        private void AppendConstructionDynamicDataEntries(
            IDictionary<string, FoxWatchConstructionDynamicDataEntry> entries,
            string packagePath,
            string tableName)
        {
            var package = _fileProvider.LoadPackage(packagePath);
            var exportTokens = JArray.Parse(JsonConvert.SerializeObject(package.GetExports().ToArray(), Formatting.None));
            var rows = exportTokens
                .OfType<JObject>()
                .FirstOrDefault(token =>
                    token.Value<string>("Type")?.Contains("DataTable", StringComparison.OrdinalIgnoreCase) == true ||
                    string.Equals(token.Value<string>("Name"), tableName, StringComparison.OrdinalIgnoreCase))?
                .Value<JObject>("Rows");
            if (rows == null)
            {
                return;
            }

            foreach (var row in rows.Properties())
            {
                var key = NormalizeString(row.Name);
                var value = row.Value as JObject;
                if (string.IsNullOrWhiteSpace(key) || value == null)
                {
                    continue;
                }

                var resourceAmounts = ExtractRecipeResourcesFromJsonToken(value["ResourceAmounts"]);
                var cost = resourceAmounts.Count > 0
                    ? resourceAmounts
                    : ExtractRecipeResourcesFromJsonToken(value["AltResourceAmounts"]);
                var crateCost = ExtractRecipeResourcesFromJsonToken(value["CostPerCrate"]);
                var upgradeCost = ExtractRecipeResourcesFromJsonToken(value["UpgradeResourceAmounts"]);
                var hasTierUpgrades = value.Value<bool?>("bHasTierUpgrades") == true;
                var repairCost = value.Value<int?>("RepairCost");
                if (repairCost == 0)
                {
                    repairCost = null;
                }

                var structuralIntegrity = value.Value<double?>("StructuralIntegrity");
                if (structuralIntegrity == 1)
                {
                    structuralIntegrity = null;
                }

                var inventorySlots = value.Value<int?>("StoredItemCapacity") ?? value.Value<int?>("ItemHolderCapacity");
                if (inventorySlots == 0)
                {
                    inventorySlots = null;
                }

                var itemSlotFilters = ExtractItemSlotFiltersFromJsonToken(value["ItemSlotFilters"]);

                var crateQuantity = value.Value<double?>("QuantityPerCrate");
                if (crateQuantity == 0)
                {
                    crateQuantity = null;
                }

                var crateProductionTime = value.Value<double?>("CrateProductionTime");
                if (crateProductionTime == 0)
                {
                    crateProductionTime = null;
                }

                var singleRetrieveTime = value.Value<double?>("SingleRetrieveTime");
                if (singleRetrieveTime == 0)
                {
                    singleRetrieveTime = null;
                }

                var crateRetrieveTime = value.Value<double?>("CrateRetrieveTime");
                if (crateRetrieveTime == 0)
                {
                    crateRetrieveTime = null;
                }

                if (!entries.TryGetValue(key, out var existingEntry))
                {
                    entries[key] = new FoxWatchConstructionDynamicDataEntry
                    {
                        Key = key,
                        Cost = cost,
                        CrateCost = crateCost,
                        UpgradeCost = upgradeCost,
                        HasTierUpgrades = hasTierUpgrades,
                        CrateQuantity = crateQuantity,
                        CrateProductionTime = crateProductionTime,
                        SingleRetrieveTime = singleRetrieveTime,
                        CrateRetrieveTime = crateRetrieveTime,
                        RepairCost = repairCost,
                        StructuralIntegrity = structuralIntegrity,
                        InventorySlots = inventorySlots,
                        ItemSlotFilters = itemSlotFilters,
                    };
                    continue;
                }

                if (existingEntry.Cost.Count == 0 && cost.Count > 0)
                {
                    existingEntry.Cost = cost;
                }

                if (existingEntry.CrateCost.Count == 0 && crateCost.Count > 0)
                {
                    existingEntry.CrateCost = crateCost;
                }

                if (existingEntry.UpgradeCost.Count == 0 && upgradeCost.Count > 0)
                {
                    existingEntry.UpgradeCost = upgradeCost;
                }

                if (!existingEntry.HasTierUpgrades && hasTierUpgrades)
                {
                    existingEntry.HasTierUpgrades = true;
                }

                if (existingEntry.CrateQuantity == null && crateQuantity is > 0)
                {
                    existingEntry.CrateQuantity = crateQuantity;
                }

                if (existingEntry.CrateProductionTime == null && crateProductionTime is > 0)
                {
                    existingEntry.CrateProductionTime = crateProductionTime;
                }

                if (existingEntry.SingleRetrieveTime == null && singleRetrieveTime is > 0)
                {
                    existingEntry.SingleRetrieveTime = singleRetrieveTime;
                }

                if (existingEntry.CrateRetrieveTime == null && crateRetrieveTime is > 0)
                {
                    existingEntry.CrateRetrieveTime = crateRetrieveTime;
                }

                if (existingEntry.RepairCost == null && repairCost != null)
                {
                    existingEntry.RepairCost = repairCost;
                }

                if (existingEntry.StructuralIntegrity == null && structuralIntegrity != null)
                {
                    existingEntry.StructuralIntegrity = structuralIntegrity;
                }

                if (existingEntry.InventorySlots == null && inventorySlots != null)
                {
                    existingEntry.InventorySlots = inventorySlots;
                }

                if (existingEntry.ItemSlotFilters.Count == 0 && itemSlotFilters.Count > 0)
                {
                    existingEntry.ItemSlotFilters = itemSlotFilters;
                }
            }
        }

        private static List<FoxWatchConstructionDynamicDataItemSlotFilter> ExtractItemSlotFiltersFromJsonToken(JToken? value)
        {
            var filters = new List<FoxWatchConstructionDynamicDataItemSlotFilter>();
            if (value is not JArray array)
            {
                return filters;
            }

            foreach (var entry in array.OfType<JObject>())
            {
                var codeName = NormalizeString(entry.Value<string>("CodeName"));
                var extraCodeNames = entry["ExtraCodeNames"]?
                    .ToObject<List<string>>()?
                    .Select(NormalizeString)
                    .Where(candidate =>
                        !string.IsNullOrWhiteSpace(candidate)
                        && !string.Equals(candidate, "None", StringComparison.OrdinalIgnoreCase))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList() ?? [];
                var stackLimit = entry.Value<int?>("StackLimit");
                if (stackLimit == 0)
                {
                    stackLimit = null;
                }

                if (string.IsNullOrWhiteSpace(codeName) && extraCodeNames.Count == 0)
                {
                    continue;
                }

                filters.Add(new FoxWatchConstructionDynamicDataItemSlotFilter
                {
                    CodeName = codeName,
                    ExtraCodeNames = extraCodeNames,
                    StackLimit = stackLimit,
                });
            }

            return filters;
        }

        private FoxWatchSpecializedFactoryMetadata ExtractSpecializedFactoryMetadata(
            IReadOnlyCollection<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint)
        {
            var component = FindBlueprintOwnedComponentByType(rootObjects, blueprint, "SpecializedFactoryComponent");
            if (component == null)
            {
                return new FoxWatchSpecializedFactoryMetadata();
            }

            var metadata = new FoxWatchSpecializedFactoryMetadata
            {
                MaxQueueSize = ExtractNullableInt(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MaxQueueSize")),
            };

            var itemCodeNames = AsEnumerable(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "ProductionCategories"))
                .SelectMany(category => AsEnumerable(GetNamedValue(category, "CategoryItems")))
                .Select(categoryItem => NormalizeString(ExtractText(GetNamedValue(categoryItem, "CodeName"))))
                .Where(codeName => !string.IsNullOrWhiteSpace(codeName))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (itemCodeNames.Count == 0)
            {
                return metadata;
            }

            var isMassProductionSupported = ExtractBoolValue(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "bIsMassProductionSupported")) == true;
            var maxOrderSize = Math.Max(1, ExtractNullableInt(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MaxOrderSize")) ?? 1);
            var productionTimeMultiplier = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "ProductionTimeMultiplier")) ?? 1.0;
            if (productionTimeMultiplier <= 0)
            {
                productionTimeMultiplier = 1.0;
            }

            var massProductionDiscountPerItem = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MassProductionDiscountPerItem")) ?? 0;
            var massProductionMaxDiscount = ExtractDouble(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "MassProductionMaxDiscount")) ?? 0;

            foreach (var itemCodeName in itemCodeNames)
            {
                var dynamicDataEntry = ResolveConstructionDynamicDataEntry(itemCodeName);
                if (dynamicDataEntry == null || dynamicDataEntry.CrateQuantity is not > 0 || dynamicDataEntry.CrateProductionTime is not > 0)
                {
                    continue;
                }

                metadata.ConversionEntries.AddRange(BuildSpecializedFactoryConversionEntries(
                    itemCodeName,
                    dynamicDataEntry,
                    isMassProductionSupported,
                    maxOrderSize,
                    productionTimeMultiplier,
                    massProductionDiscountPerItem,
                    massProductionMaxDiscount));
            }

            return metadata;
        }

        private FoxWatchMountComponentMetadata? ReadMountComponentMetadata(
            string? packagePath,
            string? baseAssetsUrl = null,
            string? iconOutputDirectory = null)
        {
            if (string.IsNullOrWhiteSpace(packagePath))
            {
                return null;
            }

            if (_mountComponentMetadataByPackagePath.TryGetValue(packagePath, out var cachedMetadata))
            {
                if (cachedMetadata?.IconUrl != null || string.IsNullOrWhiteSpace(baseAssetsUrl))
                {
                    return cachedMetadata;
                }
            }

            FoxWatchMountComponentMetadata? metadata = null;
            try
            {
                var package = _fileProvider.LoadPackage(packagePath);
                var exports = package.GetExports().Cast<object>().ToArray();
                var defaultObject = exports
                    .FirstOrDefault(export => NormalizeString(ExtractText(GetNamedValue(export, "Name"))).StartsWith("Default__", StringComparison.OrdinalIgnoreCase));
                if (defaultObject != null)
                {
                    var codeName = NormalizeString(Path.GetFileNameWithoutExtension(packagePath));
                    var displayName = NormalizeString(ExtractText(GetNamedValue(defaultObject, "DisplayName")));
                    var multiAmmo = GetNamedValue(defaultObject, "MultiAmmo");
                    var compatibleAmmoNames = AsEnumerable(GetNamedValue(multiAmmo, "CompatibleAmmoNames"))
                        .Select(ExtractText)
                        .Select(NormalizeString)
                        .Where(value => !string.IsNullOrWhiteSpace(value) && !string.Equals(value, "None", StringComparison.OrdinalIgnoreCase))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToArray();
                    var iconTextureReference = GetNamedValue(defaultObject, "IconTexture")
                        ?? GetNamedValue(defaultObject, "Icon")
                        ?? GetNamedValue(defaultObject, "DisplayIcon")
                        ?? GetNamedValue(defaultObject, "ItemIcon");
                    var ammoName = NormalizeString(ExtractText(GetNamedValue(defaultObject, "AmmoName")));

                    metadata = new FoxWatchMountComponentMetadata
                    {
                        PackagePath = packagePath,
                        CodeName = codeName,
                        DisplayName = string.IsNullOrWhiteSpace(displayName) ? codeName : displayName,
                        IconUrl = string.IsNullOrWhiteSpace(baseAssetsUrl)
                            ? null
                            : ExportReferencedIcon(iconTextureReference, $"{codeName}-mount", baseAssetsUrl, iconOutputDirectory),
                        AmmoName = ammoName,
                        CompatibleAmmoNames = compatibleAmmoNames,
                        IsMultiWeapon = ExtractBoolValue(GetNamedValue(defaultObject, "bIsMultiWeapon")) == true,
                        ExtendedMaxDistance = ExtractDouble(GetNamedValue(defaultObject, "ExtendedMaxDistance")),
                    };
                }
            }
            catch
            {
                metadata = null;
            }

            _mountComponentMetadataByPackagePath[packagePath] = metadata;
            return metadata;
        }

        private static string? ClassifyVehicleWeaponRangeType(
            string mountCodeName,
            FoxWatchMountDynamicDataEntry mountDynamicData,
            FoxWatchMountComponentMetadata? mountComponentMetadata)
        {
            var descriptor = string.Join(
                " ",
                new[]
                {
                    mountCodeName,
                    mountComponentMetadata?.AmmoName,
                    mountComponentMetadata?.IsMultiWeapon == true ? "MultiWeapon" : null,
                }.Concat(mountComponentMetadata?.CompatibleAmmoNames ?? [])
                .Where(value => !string.IsNullOrWhiteSpace(value)));

            if (ContainsAny(descriptor, "artillery", "mortar", "indirect", "howitzer", "heavyartillery", "longrangeartillery", "150", "120"))
            {
                return "killboxArty";
            }

            if (ContainsAny(descriptor, "rocket", "rpg", "grenade", "launcher"))
            {
                return "killboxRocket";
            }

            if (ContainsAny(descriptor, "aa", "antiair", "aircraft", "flak"))
            {
                return "killboxAA";
            }

            if (ContainsAny(descriptor, "machine", "mg", "hmg", "12.7", "792", "infantry"))
            {
                return "killboxMG";
            }

            if (ContainsAny(descriptor, "at", "tank", "cannon", "68", "75", "94", "battletankammo", "shell"))
            {
                return "killboxAT";
            }

            return mountDynamicData.MaxDistance is > 0 ? "killbox" : null;
        }

        private static string? ClassifyAiTurretRangeType(
            UBlueprintGeneratedClass blueprint,
            object component,
            object? damageAttributes,
            object? alternateDamageAttributes)
        {
            var descriptor = string.Join(
                " ",
                new[]
                {
                    NormalizeString(blueprint.Name),
                    NormalizeString(ExtractText(GetNamedValue(component, "Name"))),
                    ExtractText(GetNamedValue(GetNamedValue(damageAttributes, "DamageType"), "ObjectName")),
                    ExtractText(GetNamedValue(GetNamedValue(damageAttributes, "DamageType"), "ObjectPath")),
                    ExtractText(GetNamedValue(GetNamedValue(alternateDamageAttributes, "DamageType"), "ObjectName")),
                    ExtractText(GetNamedValue(GetNamedValue(alternateDamageAttributes, "DamageType"), "ObjectPath")),
                    ExtractText(GetNamedValue(GetNamedValue(damageAttributes, "ShotSoundCue"), "ObjectName")),
                    ExtractText(GetNamedValue(GetNamedValue(damageAttributes, "ShotSoundCue"), "ObjectPath")),
                    ExtractText(GetNamedValue(GetNamedValue(damageAttributes, "WeaponFireFXClass"), "ObjectName")),
                    ExtractText(GetNamedValue(GetNamedValue(damageAttributes, "WeaponFireFXClass"), "ObjectPath")),
                }.Where(value => !string.IsNullOrWhiteSpace(value)));

            if (ContainsAny(descriptor, "artillery", "mortar", "indirect", "howitzer", "heavyartillery", "longrangeartillery", "150", "120"))
            {
                return "killboxArty";
            }

            if (ContainsAny(descriptor, "rocket", "rpg", "grenade", "launcher"))
            {
                return "killboxRocket";
            }

            if (ContainsAny(descriptor, "antiair", "anti-air", "aa", "aircraft", "flak"))
            {
                return "killboxAA";
            }

            if (ContainsAny(descriptor, "machine", "heavymg", "mgshot", " hmg", "mgpillbox", "12.7", "792"))
            {
                return "killboxMG";
            }

            if (ContainsAny(descriptor, "antitank", "anti-tank", "atpillbox", "atgun", "tank", "kinetic", "armourpiercing", "armorpiercing", "20mm", "68", "75", "94", "shell", "cannon"))
            {
                return "killboxAT";
            }

            return "killbox";
        }

        private static string? ClassifyFortArtilleryRangeType(
            UBlueprintGeneratedClass blueprint,
            object defaultObject)
        {
            var damageParams = GetNamedValue(defaultObject, "DamageParams");
            var descriptor = string.Join(
                " ",
                new[]
                {
                    NormalizeString(blueprint.Name),
                    NormalizeString(ExtractText(GetNamedValue(defaultObject, "CodeName"))),
                    ExtractText(GetNamedValue(GetNamedValue(damageParams, "Type"), "ObjectName")),
                    ExtractText(GetNamedValue(GetNamedValue(damageParams, "Type"), "ObjectPath")),
                    ExtractText(GetNamedValue(GetNamedValue(damageParams, "ShotSoundCue"), "ObjectName")),
                    ExtractText(GetNamedValue(GetNamedValue(damageParams, "ShotSoundCue"), "ObjectPath")),
                }.Where(value => !string.IsNullOrWhiteSpace(value)));

            return ContainsAny(descriptor, "artillery", "mortar", "indirect", "howitzer", "heavyartillery", "longrangeartillery", "150", "120")
                ? "killboxArty"
                : null;
        }

        private bool HasBlueprintOwnedAiTurretComponent(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint)
        {
            foreach (var scope in EnumerateBlueprintComponentScopes(rootObjects, blueprint))
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    if (IsAiTurretComponentType(GetObjectTypeName(item)))
                    {
                        return true;
                    }
                }
            }

            return false;
        }

        private static bool IsAiTurretComponentType(string? componentType)
        {
            return NormalizeString(componentType) switch
            {
                var value when value.Contains("AITurretComponent", StringComparison.OrdinalIgnoreCase) => true,
                var value when value.Contains("AIGunTurretComponent", StringComparison.OrdinalIgnoreCase) => true,
                _ => false,
            };
        }

        private static bool ContainsAny(string? value, params string[] needles)
        {
            var haystack = NormalizeString(value);
            return needles.Any(needle => haystack.Contains(needle, StringComparison.OrdinalIgnoreCase));
        }

        private static IEnumerable<string> EnumerateSeatDirectionSuffixes(string? seatDirection)
        {
            switch (NormalizeString(seatDirection))
            {
                case "Left":
                    yield return "L";
                    yield return "Left";
                    yield return "Port";
                    break;
                case "Right":
                    yield return "R";
                    yield return "Right";
                    yield return "Starboard";
                    break;
                case "Front":
                    yield return "Front";
                    yield return "Forward";
                    yield return "Bow";
                    break;
                case "Rear":
                    yield return "Rear";
                    yield return "Back";
                    yield return "Aft";
                    yield return "Stern";
                    break;
            }
        }

        private static string? NormalizeSeatDirection(object? value)
        {
            var normalized = NormalizeEnumValue(value);
            return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
        }

        private static bool TryResolveSeatDirectionYawDegrees(string? seatDirection, out double yawDegrees)
        {
            switch (NormalizeString(seatDirection))
            {
                case "Front":
                case "Forward":
                    yawDegrees = 0;
                    return true;
                case "Rear":
                case "Back":
                    yawDegrees = 180;
                    return true;
                case "Left":
                case "Port":
                    yawDegrees = -90;
                    return true;
                case "Right":
                case "Starboard":
                    yawDegrees = 90;
                    return true;
                default:
                    yawDegrees = 0;
                    return false;
            }
        }

        private static double ComputeYawCenterDegrees(double? minYaw, double? maxYaw)
        {
            if (minYaw == null || maxYaw == null)
            {
                return 0;
            }

            return minYaw.Value + ((maxYaw.Value - minYaw.Value) / 2.0);
        }

        private static double? ComputeYawArcDegrees(double? minYaw, double? maxYaw)
        {
            if (minYaw == null || maxYaw == null)
            {
                return null;
            }

            var span = maxYaw.Value - minYaw.Value;
            if (span < 0)
            {
                span += 360.0;
            }

            return span <= 0 ? null : span;
        }

        private static double NormalizeDegrees(double value)
        {
            var normalized = value % 360.0;
            if (normalized <= -180.0)
            {
                normalized += 360.0;
            }
            else if (normalized > 180.0)
            {
                normalized -= 360.0;
            }

            return normalized;
        }

        private static double? RoundRangeDistance(double? value)
        {
            return value == null ? null : Math.Round(value.Value / UnrealUnitsPerMeter, 3);
        }

        private static double? RoundRangeValue(double? value)
        {
            return value == null ? null : Math.Round(value.Value, 3);
        }

        private static string BuildManifestRangeKey(FoxWatchManifestRange range)
        {
            return string.Join(
                "|",
                range.Type,
                range.CodeName ?? string.Empty,
                range.X?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                range.Y?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                range.Rotation?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                range.Arc?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                range.Min?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                range.Max?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                range.Reach?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                range.Overlap?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty);
        }

        private List<FoxWatchManifestBuildSocket> ExtractBuildSockets(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            dynamic defaultObject)
        {
            var sockets = new List<FoxWatchManifestBuildSocket>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (_meshAssetExporter != null)
            {
                try
                {
                    var componentReferences = _meshAssetExporter
                        .InspectBlueprintComponentsAsync(GetPackagePath(blueprint))
                        .GetAwaiter()
                        .GetResult();

                    foreach (var componentReference in componentReferences)
                    {
                        var socket = ExtractBuildSocket(componentReference, componentReferences);
                        if (socket == null)
                        {
                            continue;
                        }

                        var key = BuildBuildSocketKey(socket);
                        if (seen.Add(key))
                        {
                            sockets.Add(socket);
                        }
                    }
                }
                catch
                {
                }
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var socket = ExtractBuildSocket(objects, blueprint, item, componentLookup);
                    if (socket == null)
                    {
                        continue;
                    }

                    var key = BuildBuildSocketKey(socket);
                    if (seen.Add(key))
                    {
                        sockets.Add(socket);
                    }
                }
            }

            foreach (var socket in ResolveStructureTemplateBuildSockets(GetPackagePath(blueprint)))
            {
                var key = BuildBuildSocketKey(socket);
                if (seen.Add(key))
                {
                    sockets.Add(socket);
                }
            }

            return sockets;
        }

        private FoxWatchManifestBuildSocket? ExtractBuildSocket(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            var componentType = NormalizeManifestBuildSocketComponentType(NormalizeString(componentReference.ComponentType));
            var componentName = NormalizeString(componentReference.ComponentName);
            if (!IsManifestBuildSocketComponentType(componentType, componentName))
            {
                return null;
            }

            var pipeType = InferPipeType(componentReference);
            if (!LooksLikeManifestBuildSocket(componentType, componentName, hasSocketTags: false, pipeType))
            {
                return null;
            }

            var transform = ResolveComponentReferenceTransform(componentReference, componentReferences);

            var socket = new FoxWatchManifestBuildSocket
            {
                Name = componentName,
                ComponentType = componentType,
                PipeType = pipeType,
                SocketTags =
                [
                    .. componentReference.SocketTags.Select(tag => new FoxWatchManifestSocketTag
                    {
                        Mask = tag.Mask,
                        Category = tag.Category,
                        Tag = tag.Tag,
                    })
                ],
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Rotation = transform.YawDegrees,
            };
            EnsureFacilityLiquidPipeSocketTags(socket);
            return socket;
        }

        private FoxWatchManifestBuildSocket? ExtractBuildSocket(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var componentType = NormalizeManifestBuildSocketComponentType(GetObjectTypeName(component));
            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            if (!IsManifestBuildSocketComponentType(componentType, componentName))
            {
                return null;
            }

            var socketTags = ExtractSocketTags(GetNamedValue(component, "SocketTags"));
            var pipeType = NormalizeEnumValue(GetNamedValue(GetNamedValue(component, "PipeInfo"), "Type"));

            if (!LooksLikeManifestBuildSocket(componentType, componentName, socketTags.Count > 0, pipeType))
            {
                return null;
            }

            if (!HasInheritedComponentRelativeLocation(rootObjects, blueprint, component))
            {
                return null;
            }

            var transform = ResolveComponentTransform(component, componentLookup);

            var socket = new FoxWatchManifestBuildSocket
            {
                Name = componentName,
                ComponentType = componentType,
                PipeType = pipeType,
                SocketTags = socketTags,
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Rotation = transform.YawDegrees,
            };
            EnsureFacilityLiquidPipeSocketTags(socket);
            return socket;
        }

        private static List<FoxWatchManifestSocketTag> ExtractSocketTags(object? value)
        {
            return AsEnumerable(value)
                .Select(entry => new FoxWatchManifestSocketTag
                {
                    Mask = ExtractNullableLong(GetNamedValue(entry, "SocketTypeMask")),
                    Category = ExtractNullableLong(GetNamedValue(entry, "SocketTypeCategory")),
                    Tag = NullIfWhiteSpace(NormalizeString(ExtractText(GetNamedValue(entry, "Tag")))),
                })
                .Where(entry => entry.Mask != null || entry.Category != null || !string.IsNullOrWhiteSpace(entry.Tag))
                .ToList();
        }

        private List<FoxWatchManifestCraneSpawn> ExtractCraneSpawns(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            dynamic defaultObject)
        {
            var craneSpawns = new List<FoxWatchManifestCraneSpawn>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (_meshAssetExporter != null)
            {
                try
                {
                    var componentReferences = _meshAssetExporter
                        .InspectBlueprintComponentsAsync(GetPackagePath(blueprint))
                        .GetAwaiter()
                        .GetResult();
                    foreach (var componentReference in componentReferences)
                    {
                        var craneSpawn = ExtractCraneSpawn(componentReference, componentReferences);
                        if (craneSpawn == null)
                        {
                            continue;
                        }

                        var key = BuildCraneSpawnKey(craneSpawn);
                        if (seen.Add(key))
                        {
                            craneSpawns.Add(craneSpawn);
                        }
                    }

                    if (craneSpawns.Count > 0)
                    {
                        return craneSpawns;
                    }
                }
                catch
                {
                }
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var craneSpawn = ExtractCraneSpawn(objects, blueprint, item, componentLookup);
                    if (craneSpawn == null)
                    {
                        continue;
                    }

                    var key = BuildCraneSpawnKey(craneSpawn);
                    if (seen.Add(key))
                    {
                        craneSpawns.Add(craneSpawn);
                    }
                }
            }

            return craneSpawns;
        }

        private FoxWatchManifestCraneSpawn? ExtractCraneSpawn(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            var componentType = NormalizeString(componentReference.ComponentType);
            var componentName = NormalizeString(componentReference.ComponentName);
            if (!IsCraneSpawnComponent(componentType, componentName))
            {
                return null;
            }

            if (!HasComponentReferenceRelativeLocation(componentReference))
            {
                return null;
            }

            var transform = ResolveComponentReferenceTransform(componentReference, componentReferences);

            return new FoxWatchManifestCraneSpawn
            {
                Name = componentName,
                ComponentType = componentType,
                StructureId = InferCraneSpawnStructureId(componentType, componentName),
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Rotation = transform.YawDegrees,
            };
        }

        private FoxWatchManifestCraneSpawn? ExtractCraneSpawn(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var componentType = GetObjectTypeName(component);
            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            if (!IsCraneSpawnComponent(componentType, componentName))
            {
                return null;
            }

            if (!HasInheritedComponentRelativeLocation(rootObjects, blueprint, component))
            {
                return null;
            }

            var transform = ResolveComponentTransform(component, componentLookup);

            return new FoxWatchManifestCraneSpawn
            {
                Name = componentName,
                ComponentType = componentType,
                StructureId = InferCraneSpawnStructureId(componentType, componentName),
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Rotation = transform.YawDegrees,
            };
        }

        private List<FoxWatchManifestBuildFootprintBox> ExtractBuildFootprintBoxes(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            dynamic defaultObject)
        {
            var boxes = new List<FoxWatchManifestBuildFootprintBox>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    var componentType = GetObjectTypeName(item);
                    if (!componentType.Contains("BuildFootprintBoxComponent", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var box = ExtractBuildFootprintBox(objects, blueprint, item, componentLookup);
                    if (box == null)
                    {
                        continue;
                    }

                    var key = BuildBuildFootprintBoxKey(box);
                    if (seen.Add(key))
                    {
                        boxes.Add(box);
                    }
                }
            }

            if (boxes.Count == 0)
            {
                foreach (var scope in scopes)
                {
                    foreach (var item in scope.Objects)
                    {
                        if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                        {
                            continue;
                        }

                        if (!IsHelperFootprintVolumeComponent(item))
                        {
                            continue;
                        }

                        var box = ExtractBuildFootprintBox(objects, blueprint, item, componentLookup);
                        if (box == null)
                        {
                            continue;
                        }

                        var key = BuildBuildFootprintBoxKey(box);
                        if (seen.Add(key))
                        {
                            boxes.Add(box);
                        }
                    }
                }
            }

            return boxes;
        }

        private List<FoxWatchManifestStructureVolume> ExtractStructureVolumes(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            dynamic defaultObject)
        {
            var volumes = new List<FoxWatchManifestStructureVolume>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var volume = ExtractStructureVolume(objects, blueprint, item, componentLookup);
                    if (volume == null)
                    {
                        continue;
                    }

                    var key = BuildStructureVolumeKey(volume);
                    if (seen.Add(key))
                    {
                        volumes.Add(volume);
                    }
                }
            }

            return volumes;
        }

        private IReadOnlyList<BlueprintComponentScope> EnumerateBlueprintComponentScopes(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint)
        {
            var blueprintPackagePath = GetPackagePath(blueprint);
            if (!string.IsNullOrWhiteSpace(blueprintPackagePath) &&
                _blueprintComponentScopesByPackagePath.TryGetValue(blueprintPackagePath, out var cachedScopes))
            {
                return cachedScopes;
            }

            var resolvedScopes = new List<BlueprintComponentScope>();
            var yieldedPackagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var currentStruct = (UStruct?)blueprint;
            var useRootObjects = true;

            while (currentStruct != null)
            {
                if (currentStruct is UBlueprintGeneratedClass currentBlueprint)
                {
                    IReadOnlyList<object> scopeObjects;
                    var packagePath = GetPackagePath(currentBlueprint);
                    if (useRootObjects)
                    {
                        scopeObjects = rootObjects
                            .Select(item => item as object)
                            .Where(item => item != null)
                            .Cast<object>()
                            .ToArray();
                        useRootObjects = false;
                    }
                    else if (!string.IsNullOrWhiteSpace(packagePath) && yieldedPackagePaths.Add(packagePath))
                    {
                        try
                        {
                            var package = _fileProvider.LoadPackage(packagePath);
                            scopeObjects = package.GetExports().Cast<object>().ToArray();
                        }
                        catch
                        {
                            scopeObjects = [];
                        }
                    }
                    else
                    {
                        scopeObjects = [];
                    }

                    if (!string.IsNullOrWhiteSpace(packagePath))
                    {
                        yieldedPackagePaths.Add(packagePath);
                    }

                    resolvedScopes.Add(CreateBlueprintComponentScope(
                        currentBlueprint.Name,
                        $"Default__{currentBlueprint.Name}",
                        scopeObjects));
                }

                try
                {
                    var parentStruct = currentStruct.SuperStruct;
                    currentStruct = parentStruct != null && parentStruct.TryLoad<UStruct>(out var superStruct)
                        ? superStruct
                        : null;
                }
                catch
                {
                    currentStruct = null;
                }
            }

            var readOnlyScopes = resolvedScopes.AsReadOnly();
            if (!string.IsNullOrWhiteSpace(blueprintPackagePath))
            {
                _blueprintComponentScopesByPackagePath[blueprintPackagePath] = readOnlyScopes;
            }

            return readOnlyScopes;
        }

        private static BlueprintComponentScope CreateBlueprintComponentScope(
            string blueprintName,
            string defaultObjectName,
            IReadOnlyList<object> objects)
        {
            var firstObjectByNormalizedName = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in objects)
            {
                var itemName = NormalizeString(ExtractText(GetNamedValue(item, "Name")));
                if (string.IsNullOrWhiteSpace(itemName) || firstObjectByNormalizedName.ContainsKey(itemName))
                {
                    continue;
                }

                firstObjectByNormalizedName[itemName] = item;
            }

            return new BlueprintComponentScope(
                blueprintName,
                defaultObjectName,
                objects,
                firstObjectByNormalizedName);
        }

        private object? GetInheritedBlueprintProperty(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object defaultObject,
            string propertyName)
        {
            var resolvedValue = GetNamedValue(defaultObject, propertyName);
            if (resolvedValue != null)
            {
                return resolvedValue;
            }

            foreach (var scope in EnumerateBlueprintComponentScopes(rootObjects, blueprint))
            {
                if (!scope.FirstObjectByNormalizedName.TryGetValue(scope.NormalizedDefaultObjectName, out var scopeDefaultObject))
                {
                    continue;
                }

                resolvedValue = GetNamedValue(scopeDefaultObject, propertyName);
                if (resolvedValue != null)
                {
                    return resolvedValue;
                }
            }

            return null;
        }

        private static bool IsObjectOwnedByBlueprintScope(object component, string blueprintName, string defaultObjectName)
        {
            var outerName = NormalizeString(ExtractText(GetNamedValue(component, "Outer")));
            return outerName.Contains(blueprintName, StringComparison.OrdinalIgnoreCase)
                || outerName.Contains(defaultObjectName, StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsHelperFootprintVolumeComponent(object component)
        {
            var componentType = GetObjectTypeName(component);
            if (!componentType.Contains("BoxComponent", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var name = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            return HelperFootprintVolumeNameHints.Any(hint => name.Contains(hint, StringComparison.OrdinalIgnoreCase));
        }

        private static bool IsStructureVolumeComponent(object component)
        {
            var componentType = GetObjectTypeName(component);
            if (!componentType.Contains("BoxComponent", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (componentType.Contains("BuildFootprintBoxComponent", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return GetNamedValue(component, "BoxExtent") != null;
        }

        private static bool IsCraneSpawnComponent(string? componentType, string? componentName)
        {
            return NormalizeString(componentType).Contains("CraneSpawn", StringComparison.OrdinalIgnoreCase)
                || NormalizeString(componentName).Contains("CraneSpawn", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsEmplacedWeaponBlueprint(UBlueprintGeneratedClass blueprint)
        {
            var superStructName = NormalizeString(blueprint.SuperStruct?.Name);
            var superStructReference = NormalizeString(blueprint.SuperStruct?.ToString());
            return string.Equals(superStructName, "EmplacedWeapon", StringComparison.OrdinalIgnoreCase)
                || superStructReference.Contains("EmplacedWeapon", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsEmplacementLocationComponent(string? componentType, string? componentName)
        {
            return string.Equals(NormalizeString(componentName), "EmplacementLocation", StringComparison.OrdinalIgnoreCase)
                && (
                    string.IsNullOrWhiteSpace(componentType)
                    || componentType.Contains("BoxComponent", StringComparison.OrdinalIgnoreCase)
                    || componentType.Contains("SceneComponent", StringComparison.OrdinalIgnoreCase));
        }

        private FoxWatchManifestEmplacementLocation? ExtractEmplacementLocation(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            dynamic defaultObject)
        {
            if (_meshAssetExporter != null)
            {
                try
                {
                    var componentReferences = _meshAssetExporter
                        .InspectBlueprintComponentsAsync(GetPackagePath(blueprint))
                        .GetAwaiter()
                        .GetResult();
                    foreach (var componentReference in componentReferences)
                    {
                        var location = ExtractEmplacementLocation(componentReference, componentReferences);
                        if (location != null)
                        {
                            return location;
                        }
                    }
                }
                catch
                {
                }
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var location = ExtractEmplacementLocation(objects, blueprint, item, componentLookup);
                    if (location != null)
                    {
                        return location;
                    }
                }
            }

            return null;
        }

        private FoxWatchManifestEmplacementLocation? ExtractEmplacementLocation(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            var componentType = NormalizeString(componentReference.ComponentType);
            var componentName = NormalizeString(componentReference.ComponentName);
            if (!IsEmplacementLocationComponent(componentType, componentName))
            {
                return null;
            }

            var transform = ResolveComponentReferenceTransform(componentReference, componentReferences);
            return new FoxWatchManifestEmplacementLocation
            {
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
            };
        }

        private FoxWatchManifestEmplacementLocation? ExtractEmplacementLocation(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var componentType = GetObjectTypeName(component);
            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            if (!IsEmplacementLocationComponent(componentType, componentName))
            {
                return null;
            }

            var transform = ResolveComponentTransform(component, componentLookup);
            return new FoxWatchManifestEmplacementLocation
            {
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
            };
        }

        private static string InferCraneSpawnStructureId(string? componentType, string? componentName)
        {
            var componentDescriptor = $"{NormalizeString(componentType)} {NormalizeString(componentName)}";
            return componentDescriptor.Contains("LargeCrane", StringComparison.OrdinalIgnoreCase)
                ? "largecrane"
                : "staticcrane";
        }

        private bool HasBlueprintOwnedComponentType(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            string componentTypeName)
        {
            foreach (var scope in EnumerateBlueprintComponentScopes(rootObjects, blueprint))
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    if (componentType.Contains(componentTypeName, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
            }

            return false;
        }

        private object? FindBlueprintOwnedComponentByType(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            string componentTypeName)
        {
            foreach (var scope in EnumerateBlueprintComponentScopes(rootObjects, blueprint))
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    if (componentType.Contains(componentTypeName, StringComparison.OrdinalIgnoreCase))
                    {
                        return item;
                    }
                }
            }

            return null;
        }

        private static string NormalizeBuildSocketName(string? value)
        {
            var normalized = NormalizeString(value);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return string.Empty;
            }

            if (normalized.EndsWith("_GEN_VARIABLE", StringComparison.OrdinalIgnoreCase))
            {
                normalized = normalized[..^"_GEN_VARIABLE".Length];
            }

            return normalized;
        }

        private static string BuildBuildSocketKey(FoxWatchManifestBuildSocket socket)
        {
            var tags = string.Join(
                ",",
                socket.SocketTags.Select(tag => $"{tag.Mask?.ToString(CultureInfo.InvariantCulture) ?? "null"}:{tag.Category?.ToString(CultureInfo.InvariantCulture) ?? "null"}"));
            return string.Join(
                "|",
                NormalizeBuildSocketName(socket.Name),
                NormalizeManifestBuildSocketComponentType(socket.ComponentType) ?? string.Empty,
                socket.PipeType ?? string.Empty,
                socket.X?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                socket.Y?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                socket.Z?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                socket.Rotation?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                tags);
        }

        private static string BuildLogicalBuildSocketKey(FoxWatchManifestBuildSocket socket)
        {
            return string.Join(
                "|",
                NormalizeBuildSocketName(socket.Name),
                socket.PipeType ?? string.Empty,
                Math.Round(socket.X ?? 0, 0).ToString("0", CultureInfo.InvariantCulture),
                Math.Round(socket.Y ?? 0, 0).ToString("0", CultureInfo.InvariantCulture),
                Math.Round(socket.Z ?? 0, 0).ToString("0", CultureInfo.InvariantCulture),
                Math.Round(socket.Rotation ?? 0, 0).ToString("0", CultureInfo.InvariantCulture));
        }

        private static int ScoreBuildSocketCandidate(FoxWatchManifestBuildSocket socket)
        {
            var score = 0;
            var name = NormalizeString(socket.Name);
            if (!name.EndsWith("_GEN_VARIABLE", StringComparison.OrdinalIgnoreCase))
            {
                score += 8;
            }

            if (socket.SocketTags.Count > 0)
            {
                score += 4;
            }

            if (!string.IsNullOrWhiteSpace(socket.PipeType))
            {
                score += 2;
            }

            var componentType = NormalizeManifestBuildSocketComponentType(socket.ComponentType) ?? string.Empty;
            if (componentType.Contains("BuildSocketComponent", StringComparison.OrdinalIgnoreCase))
            {
                score += 1;
            }

            return score;
        }

        private static bool IsSpuriousConnectorSideSocket(
            FoxWatchManifestBuildSocket socket,
            FoxWatchManifestConnector? connector)
        {
            var name = NormalizeString(socket.Name);
            if (!name.Equals("LeftSocket", StringComparison.OrdinalIgnoreCase)
                && !name.Equals("RightSocket", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (Math.Abs(socket.Y ?? 0) > 5000 || Math.Abs(socket.X ?? 0) > 5000)
            {
                return true;
            }

            if (socket.SocketTags.Count > 0 || !string.IsNullOrWhiteSpace(socket.PipeType))
            {
                return false;
            }

            if (connector == null || string.IsNullOrWhiteSpace(connector.BackSocketName))
            {
                return false;
            }

            return Math.Abs(socket.X ?? 0) < 0.01 && Math.Abs(socket.Y ?? 0) < 0.01;
        }

        private static bool AreNearDuplicateBuildSockets(
            FoxWatchManifestBuildSocket left,
            FoxWatchManifestBuildSocket right)
        {
            if (!string.Equals(
                    NormalizeBuildSocketName(left.Name),
                    NormalizeBuildSocketName(right.Name),
                    StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var leftNearOrigin = IsNearOriginBuildSocket(left);
            var rightNearOrigin = IsNearOriginBuildSocket(right);

            // Many blueprints leak "same socket, default transform" duplicates from the
            // CDO scope. When we see an origin socket with no tags/pipe data, collapse it
            // into the positioned socket (even if far outside the < 1 unit tolerance).
            if (leftNearOrigin != rightNearOrigin)
            {
                var originSocket = leftNearOrigin ? left : right;
                var originIsPlain = originSocket.SocketTags.Count == 0
                    && string.IsNullOrWhiteSpace(originSocket.PipeType);
                return originIsPlain;
            }

            return Math.Abs((left.X ?? 0) - (right.X ?? 0)) < 1
                && Math.Abs((left.Y ?? 0) - (right.Y ?? 0)) < 1
                && Math.Abs((left.Z ?? 0) - (right.Z ?? 0)) < 1;
        }

        private static List<FoxWatchManifestBuildSocket> CollapseLogicalBuildSocketDuplicates(
            List<FoxWatchManifestBuildSocket> buildSockets,
            FoxWatchManifestConnector? connector)
        {
            var filtered = buildSockets
                .Where(socket => !IsSpuriousConnectorSideSocket(socket, connector))
                .ToList();
            var collapsed = new List<FoxWatchManifestBuildSocket>();

            foreach (var socket in filtered)
            {
                var duplicateIndex = collapsed.FindIndex(existing => AreNearDuplicateBuildSockets(existing, socket));
                if (duplicateIndex < 0)
                {
                    collapsed.Add(socket);
                    continue;
                }

                var existing = collapsed[duplicateIndex];
                var newScore = ScoreBuildSocketCandidate(socket);
                var existingScore = ScoreBuildSocketCandidate(existing);

                if (newScore > existingScore)
                {
                    collapsed[duplicateIndex] = socket;
                }
                else if (newScore == existingScore)
                {
                    // If one candidate is an origin leak, prefer the positioned socket.
                    var newNearOrigin = IsNearOriginBuildSocket(socket);
                    var existingNearOrigin = IsNearOriginBuildSocket(existing);

                    if (existingNearOrigin && !newNearOrigin)
                    {
                        collapsed[duplicateIndex] = socket;
                    }
                }
            }

            return collapsed;
        }

        private static bool IsNearOriginBuildSocket(FoxWatchManifestBuildSocket socket)
        {
            return Math.Abs(socket.X ?? 0) < 0.01
                && Math.Abs(socket.Y ?? 0) < 0.01
                && Math.Abs(socket.Z ?? 0) < 0.01;
        }

        private static List<FoxWatchManifestBuildSocket> EnsureConnectorEndpointBuildSockets(
            List<FoxWatchManifestBuildSocket> buildSockets,
            FoxWatchManifestConnector? connector)
        {
            if (connector == null)
            {
                return buildSockets;
            }

            var sockets = buildSockets.Count == 0
                ? new List<FoxWatchManifestBuildSocket>()
                : [.. buildSockets];
            var existingByName = sockets
                .Where(socket => !string.IsNullOrWhiteSpace(socket.Name))
                .GroupBy(socket => NormalizeString(socket.Name), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

            var fallbackSocket = sockets.FirstOrDefault(socket =>
                socket.SocketTags.Count > 0
                || string.Equals(NormalizeManifestBuildSocketComponentType(socket.ComponentType), "Class'/Script/War.BuildSocketComponent'", StringComparison.OrdinalIgnoreCase));

            if (!string.IsNullOrWhiteSpace(connector.BackSocketName) && !existingByName.ContainsKey(connector.BackSocketName))
            {
                var synthesizedBackSocket = new FoxWatchManifestBuildSocket
                {
                    Name = connector.BackSocketName,
                    ComponentType = NormalizeManifestBuildSocketComponentType(fallbackSocket?.ComponentType),
                    PipeType = fallbackSocket?.PipeType,
                    SocketTags = fallbackSocket?.SocketTags.Select(tag => new FoxWatchManifestSocketTag
                    {
                        Mask = tag.Mask,
                        Category = tag.Category,
                    }).ToList() ?? [],
                    X = 0,
                    Y = 0,
                    Z = 0,
                    Rotation = 0,
                };

                if (existingByName.TryGetValue(NormalizeString(connector.FrontSocketName), out var frontSocket) &&
                    frontSocket.ComponentType is { Length: > 0 } frontComponentType)
                {
                    synthesizedBackSocket.ComponentType = frontComponentType;
                    synthesizedBackSocket.PipeType = frontSocket.PipeType;
                    synthesizedBackSocket.SocketTags = frontSocket.SocketTags.Select(tag => new FoxWatchManifestSocketTag
                    {
                        Mask = tag.Mask,
                        Category = tag.Category,
                    }).ToList();
                }

                var key = BuildBuildSocketKey(synthesizedBackSocket);
                if (sockets.All(existing => !string.Equals(BuildBuildSocketKey(existing), key, StringComparison.OrdinalIgnoreCase)))
                {
                    sockets.Add(synthesizedBackSocket);
                    existingByName[NormalizeString(synthesizedBackSocket.Name)] = synthesizedBackSocket;
                }
            }

            if (!string.IsNullOrWhiteSpace(connector.FrontSocketName) && !existingByName.ContainsKey(connector.FrontSocketName))
            {
                var synthesizedFrontSocket = new FoxWatchManifestBuildSocket
                {
                    Name = connector.FrontSocketName,
                    ComponentType = NormalizeManifestBuildSocketComponentType(fallbackSocket?.ComponentType),
                    PipeType = fallbackSocket?.PipeType,
                    SocketTags = fallbackSocket?.SocketTags.Select(tag => new FoxWatchManifestSocketTag
                    {
                        Mask = tag.Mask,
                        Category = tag.Category,
                    }).ToList() ?? [],
                    X = connector.DefaultTargetUnrealLocationCm is { Count: >= 1 } target ? target[0] : 0,
                    Y = connector.DefaultTargetUnrealLocationCm is { Count: >= 2 } frontTarget ? frontTarget[1] : 0,
                    Z = connector.DefaultTargetUnrealLocationCm is { Count: >= 3 } frontTargetZ ? frontTargetZ[2] : 0,
                    Rotation = 0,
                };

                var key = BuildBuildSocketKey(synthesizedFrontSocket);
                if (sockets.All(existing => !string.Equals(BuildBuildSocketKey(existing), key, StringComparison.OrdinalIgnoreCase)))
                {
                    sockets.Add(synthesizedFrontSocket);
                }
            }

            return sockets;
        }

        private static string NormalizeManifestBuildSocketComponentType(string? componentType)
        {
            var normalized = NormalizeString(componentType);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return string.Empty;
            }

            return normalized.Contains("BuildSocketComponent", StringComparison.OrdinalIgnoreCase)
                ? "Class'/Script/War.BuildSocketComponent'"
                : normalized;
        }

        private static string BuildBuildFootprintBoxKey(FoxWatchManifestBuildFootprintBox box)
        {
            return string.Join(
                "|",
                box.bCheckForLandscape?.ToString() ?? string.Empty,
                box.X?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                box.Y?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                box.Z?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                box.Width?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                box.Length?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                box.Height?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                box.Rotation?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty);
        }

            private static string BuildCraneSpawnKey(FoxWatchManifestCraneSpawn craneSpawn)
            {
                return string.Join(
                "|",
                craneSpawn.Name ?? string.Empty,
                craneSpawn.ComponentType ?? string.Empty,
                craneSpawn.StructureId,
                craneSpawn.X?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                craneSpawn.Y?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                craneSpawn.Z?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                craneSpawn.Rotation?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty);
            }

        private static string BuildStructureVolumeKey(FoxWatchManifestStructureVolume volume)
        {
            return string.Join(
                "|",
                volume.Name,
                volume.Label,
                volume.Category,
                volume.ComponentType ?? string.Empty,
                volume.X?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Y?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Z?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Width?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Length?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Height?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Rotation?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty);
        }

        private static string BuildVehicleSeatKey(FoxWatchManifestVehicleSeat seat)
        {
            return string.Join(
                "|",
                seat.Name ?? string.Empty,
                seat.ComponentType ?? string.Empty,
                seat.X?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                seat.Y?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                seat.Z?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                seat.Rotation?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty);
        }

        private static string BuildSpotlightKey(FoxWatchManifestSpotlight spotlight)
        {
            return string.Join(
                "|",
                spotlight.Name ?? string.Empty,
                spotlight.ComponentType ?? string.Empty,
                spotlight.LightType ?? string.Empty,
                spotlight.X?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                spotlight.Y?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                spotlight.Z?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                spotlight.Rotation?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                spotlight.OuterConeAngle?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                spotlight.InnerConeAngle?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                spotlight.AttenuationRadius?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty);
        }

        private static void NormalizeKnownVehicleComponentFrames(
            string codeName,
            List<FoxWatchManifestVehicleSeat> vehicleSeats,
            List<FoxWatchManifestSpotlight> spotlights,
            List<FoxWatchManifestRange> ranges)
        {
            if (codeName.StartsWith("HalftrackMulti", StringComparison.OrdinalIgnoreCase))
            {
                RotateVehicleComponentFrames(vehicleSeats, spotlights, ranges, 90.0, 14.601, -14.601);
                return;
            }

            if (IsQuarterTurnColonialHalftrack(codeName))
            {
                RotateQuarterTurnHalftrackFrames(vehicleSeats, spotlights, ranges, 90.0, 0.773, 0.0, useXAxisForRearSeatFacing: false, invertRearSeatFacing: true);
                return;
            }

            if (IsQuarterTurnWardenHalftrack(codeName))
            {
                RotateQuarterTurnHalftrackFrames(vehicleSeats, spotlights, ranges, -90.0, -8.563, 1.55, useXAxisForRearSeatFacing: true, invertRearSeatFacing: false);
                return;
            }

            if (!codeName.StartsWith("Ambulance", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            RotateVehicleComponentFrames(vehicleSeats, spotlights, ranges, 90.0, 5.0, -5.0);
        }

        private static bool IsQuarterTurnColonialHalftrack(string codeName)
        {
            return codeName.StartsWith("HalfTrack", StringComparison.OrdinalIgnoreCase) &&
                codeName.EndsWith("C", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsQuarterTurnWardenHalftrack(string codeName)
        {
            return codeName.StartsWith("HalfTrack", StringComparison.OrdinalIgnoreCase) &&
                codeName.EndsWith("W", StringComparison.OrdinalIgnoreCase);
        }

        private static void RotateQuarterTurnHalftrackFrames(
            List<FoxWatchManifestVehicleSeat> vehicleSeats,
            List<FoxWatchManifestSpotlight> spotlights,
            List<FoxWatchManifestRange> ranges,
            double yawOffsetDegrees,
            double offsetX,
            double offsetY,
            bool useXAxisForRearSeatFacing,
            bool invertRearSeatFacing)
        {
            foreach (var seat in vehicleSeats)
            {
                var rotatedPosition = RotatePlanarCoordinates(seat.X, seat.Y, yawOffsetDegrees, offsetX, offsetY);
                seat.X = rotatedPosition.X;
                seat.Y = rotatedPosition.Y;
            }

            NormalizeHalftrackRearBenchSeatFacing(vehicleSeats, useXAxisForRearSeatFacing, invertRearSeatFacing);

            foreach (var spotlight in spotlights)
            {
                var rotatedPosition = RotatePlanarCoordinates(spotlight.X, spotlight.Y, yawOffsetDegrees, offsetX, offsetY);
                spotlight.X = rotatedPosition.X;
                spotlight.Y = rotatedPosition.Y;
            }

            var rangeOffsetX = offsetX / UnrealUnitsPerMeter;
            var rangeOffsetY = offsetY / UnrealUnitsPerMeter;
            foreach (var range in ranges)
            {
                var rotatedPosition = RotatePlanarCoordinates(range.X, range.Y, yawOffsetDegrees, rangeOffsetX, rangeOffsetY);
                range.X = rotatedPosition.X;
                range.Y = rotatedPosition.Y;
                if (range.Rotation != null)
                {
                    range.Rotation = NormalizeDegrees(range.Rotation.Value + yawOffsetDegrees);
                }
            }
        }

        private static void NormalizeHalftrackRearBenchSeatFacing(
            List<FoxWatchManifestVehicleSeat> vehicleSeats,
            bool useXAxisForRearSeatFacing,
            bool invertRearSeatFacing)
        {
            foreach (var seat in vehicleSeats)
            {
                if (!NormalizeString(seat.Name).StartsWith("RearSeat", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var lateralCoordinate = useXAxisForRearSeatFacing ? seat.X : seat.Y;
                if (lateralCoordinate == null)
                {
                    continue;
                }

                seat.Rotation = lateralCoordinate >= 0
                    ? (invertRearSeatFacing ? -90.0 : 90.0)
                    : (invertRearSeatFacing ? 90.0 : -90.0);
            }
        }

        private static void RotateVehicleComponentFrames(
            List<FoxWatchManifestVehicleSeat> vehicleSeats,
            List<FoxWatchManifestSpotlight> spotlights,
            List<FoxWatchManifestRange> ranges,
            double yawOffsetDegrees,
            double offsetX,
            double offsetY)
        {
            foreach (var seat in vehicleSeats)
            {
                var rotatedPosition = RotatePlanarCoordinates(seat.X, seat.Y, yawOffsetDegrees, offsetX, offsetY);
                seat.X = rotatedPosition.X;
                seat.Y = rotatedPosition.Y;
                if (seat.Rotation is < -45.0)
                {
                    seat.Rotation = NormalizeDegrees(seat.Rotation.Value + yawOffsetDegrees);
                }
            }

            foreach (var spotlight in spotlights)
            {
                var rotatedPosition = RotatePlanarCoordinates(spotlight.X, spotlight.Y, yawOffsetDegrees, offsetX, offsetY);
                spotlight.X = rotatedPosition.X;
                spotlight.Y = rotatedPosition.Y;
                spotlight.Rotation = NormalizeDegrees((spotlight.Rotation ?? 0) + yawOffsetDegrees);
            }

            var rangeOffsetX = offsetX / UnrealUnitsPerMeter;
            var rangeOffsetY = offsetY / UnrealUnitsPerMeter;
            foreach (var range in ranges)
            {
                var rotatedPosition = RotatePlanarCoordinates(range.X, range.Y, yawOffsetDegrees, rangeOffsetX, rangeOffsetY);
                range.X = rotatedPosition.X;
                range.Y = rotatedPosition.Y;
                if (range.Rotation != null)
                {
                    range.Rotation = NormalizeDegrees(range.Rotation.Value + yawOffsetDegrees);
                }
            }
        }

        private static (double? X, double? Y) RotatePlanarCoordinates(
            double? x,
            double? y,
            double yawOffsetDegrees,
            double offsetX = 0,
            double offsetY = 0)
        {
            if (x == null || y == null)
            {
                return (x, y);
            }

            var radians = yawOffsetDegrees * (Math.PI / 180.0);
            var cosine = Math.Cos(radians);
            var sine = Math.Sin(radians);

            return (
                (x.Value * cosine) - (y.Value * sine) + offsetX,
                (x.Value * sine) + (y.Value * cosine) + offsetY);
        }

            private static string BuildSpotlightNormalizationKey(FoxWatchManifestSpotlight spotlight)
            {
                return string.Join(
                "|",
                spotlight.Name ?? string.Empty,
                spotlight.ComponentType ?? string.Empty,
                spotlight.LightType ?? string.Empty,
                spotlight.X?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                spotlight.Y?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                spotlight.Z?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                spotlight.Rotation?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty);
            }

            private static double GetSpotlightSignalScore(FoxWatchManifestSpotlight spotlight)
            {
                return (spotlight.AttenuationRadius ?? 0) +
                (spotlight.Intensity ?? 0) +
                (spotlight.SourceRadius ?? 0) +
                (spotlight.SoftSourceRadius ?? 0) +
                (spotlight.OuterConeAngle ?? 0) +
                (spotlight.InnerConeAngle ?? 0);
            }

        private static string? ClassifyVehicleSeatType(string? componentName, string? mountCodeName)
        {
            var descriptor = $"{NormalizeString(componentName)} {NormalizeString(mountCodeName)}";
            if (descriptor.Contains("Driver", StringComparison.OrdinalIgnoreCase))
            {
                return "driver";
            }

            if (descriptor.Contains("Commander", StringComparison.OrdinalIgnoreCase))
            {
                return "commander";
            }

            if (descriptor.Contains("Gunner", StringComparison.OrdinalIgnoreCase))
            {
                return "gunner";
            }

            if (descriptor.Contains("Loader", StringComparison.OrdinalIgnoreCase))
            {
                return "loader";
            }

            if (descriptor.Contains("Spotter", StringComparison.OrdinalIgnoreCase))
            {
                return "spotter";
            }

            if (descriptor.Contains("Passenger", StringComparison.OrdinalIgnoreCase))
            {
                return "passenger";
            }

            return null;
        }

            private static string BuildStructureVolumeGeometryKey(FoxWatchManifestStructureVolume volume)
            {
                return string.Join(
                "|",
                volume.Category,
                volume.ComponentType ?? string.Empty,
                volume.X?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Y?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Z?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Width?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Length?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Height?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty,
                volume.Rotation?.ToString("0.###", CultureInfo.InvariantCulture) ?? string.Empty);
            }

        private static string GetPackagePath(UObject export)
        {
            return export.Owner?.Provider?.FixPath(export.Owner.Name) ?? export.Name;
        }

        private static FoxWatchManifestBuildFootprintBox? ExtractBuildFootprintBox(
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var boxExtent = GetNamedValue(component, "BoxExtent");
            if (boxExtent == null)
            {
                return null;
            }

            var transform = ResolveComponentTransform(component, componentLookup);

            return new FoxWatchManifestBuildFootprintBox
            {
                bCheckForLandscape = ExtractBoolValue(GetNamedValue(GetNamedValue(component, "Info"), "bCheckForLandscape")),
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Width = ExtractVectorComponent(boxExtent, "X"),
                Length = ExtractVectorComponent(boxExtent, "Y"),
                Height = ExtractVectorComponent(boxExtent, "Z"),
                Rotation = transform.YawDegrees,
            };
        }

        private FoxWatchManifestBuildFootprintBox? ExtractBuildFootprintBox(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var boxExtent = GetNamedValue(component, "BoxExtent");
            if (boxExtent == null)
            {
                return null;
            }

            var transform = ResolveCorrectedComponentTransform(rootObjects, blueprint, component, componentLookup);

            return new FoxWatchManifestBuildFootprintBox
            {
                bCheckForLandscape = ExtractBoolValue(GetNamedValue(GetNamedValue(component, "Info"), "bCheckForLandscape")),
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Width = ExtractVectorComponent(boxExtent, "X"),
                Length = ExtractVectorComponent(boxExtent, "Y"),
                Height = ExtractVectorComponent(boxExtent, "Z"),
                Rotation = transform.YawDegrees,
            };
        }

        private static List<FoxWatchManifestStructureVolume> BuildFootprintStructureVolumes(
            IEnumerable<FoxWatchManifestBuildFootprintBox> boxes)
        {
            return boxes
                .Select((box, index) => new FoxWatchManifestStructureVolume
                {
                    Name = $"BuildFootprintBox{index + 1}",
                    Label = "Footprint",
                    Category = "footprint",
                    ComponentType = "BuildFootprintBoxComponent",
                    X = box.X,
                    Y = box.Y,
                    Z = box.Z,
                    Width = box.Width,
                    Length = box.Length,
                    Height = box.Height,
                    Rotation = box.Rotation,
                })
                .ToList();
        }

        private FoxWatchManifestStructureVolume? ExtractStructureVolume(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            if (!IsStructureVolumeComponent(component))
            {
                return null;
            }

            var boxExtent = GetNamedValue(component, "BoxExtent");
            if (boxExtent == null)
            {
                return null;
            }

            var rawName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            var transform = ResolveCorrectedComponentTransform(rootObjects, blueprint, component, componentLookup);

            return new FoxWatchManifestStructureVolume
            {
                Name = rawName,
                Label = HumanizeStructureVolumeLabel(rawName),
                Category = ClassifyStructureVolumeCategory(rawName),
                ComponentType = GetObjectTypeName(component),
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Width = ExtractVectorComponent(boxExtent, "X"),
                Length = ExtractVectorComponent(boxExtent, "Y"),
                Height = ExtractVectorComponent(boxExtent, "Z"),
                Rotation = transform.YawDegrees,
            };
        }

        private static string HumanizeStructureVolumeLabel(string? name)
        {
            var normalized = NormalizeString(name);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return "Volume";
            }

            normalized = Regex.Replace(normalized, @"^BP", string.Empty, RegexOptions.CultureInvariant);
            normalized = Regex.Replace(normalized, @"Component$", string.Empty, RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
            normalized = Regex.Replace(normalized, @"\d+$", string.Empty, RegexOptions.CultureInvariant);

            return ClassifyStructureVolumeCategory(normalized) switch
            {
                "useArea" => "Use Area",
                "killVolume" => "Kill Volume",
                "garageFootprint" => "Garage Footprint",
                "parkingSpot" => "Parking Spot",
                "loadingArea" => "Loading Area",
                "interiorArea" => "Interior Area",
                "noBuild" => "No Build",
                "docking" => "Docking",
                "temperature" => "Temperature",
                "passenger" => "Passenger",
                "iceBlocker" => "Ice Blocker",
                "footprint" => "Footprint",
                _ => HumanizeLooseVolumeName(normalized),
            };
        }

        private static string HumanizeLooseVolumeName(string normalized)
        {
            var humanized = Regex.Replace(normalized, @"(?<!^)([A-Z])", " $1", RegexOptions.CultureInvariant);
            humanized = Regex.Replace(humanized, @"\bBoxs\b", "Boxes", RegexOptions.CultureInvariant);
            humanized = Regex.Replace(humanized, @"\bBox\b", string.Empty, RegexOptions.CultureInvariant).Trim();
            humanized = Regex.Replace(humanized, @"\bVolume\b", string.Empty, RegexOptions.CultureInvariant).Trim();
            return string.IsNullOrWhiteSpace(humanized) ? "Volume" : humanized;
        }

        private static string ClassifyStructureVolumeCategory(string? name)
        {
            var normalized = NormalizeString(name);

            if (normalized.Contains("UseArea", StringComparison.OrdinalIgnoreCase))
            {
                return "useArea";
            }

            if (normalized.Contains("KillVolume", StringComparison.OrdinalIgnoreCase))
            {
                return "killVolume";
            }

            if (normalized.Contains("GarageFootprint", StringComparison.OrdinalIgnoreCase))
            {
                return "garageFootprint";
            }

            if (normalized.Contains("ParkingSpot", StringComparison.OrdinalIgnoreCase))
            {
                return "parkingSpot";
            }

            if (normalized.Contains("LoadingArea", StringComparison.OrdinalIgnoreCase))
            {
                return "loadingArea";
            }

            if (normalized.Contains("InteriorArea", StringComparison.OrdinalIgnoreCase))
            {
                return "interiorArea";
            }

            if (normalized.Contains("NoBuild", StringComparison.OrdinalIgnoreCase))
            {
                return "noBuild";
            }

            if (normalized.Contains("Docking", StringComparison.OrdinalIgnoreCase))
            {
                return "docking";
            }

            if (normalized.Contains("TemperatureModifier", StringComparison.OrdinalIgnoreCase))
            {
                return "temperature";
            }

            if (normalized.Contains("PassengerBase", StringComparison.OrdinalIgnoreCase))
            {
                return "passenger";
            }

            if (normalized.Contains("IceBlocker", StringComparison.OrdinalIgnoreCase))
            {
                return "iceBlocker";
            }

            if (normalized.Contains("Footprint", StringComparison.OrdinalIgnoreCase))
            {
                return "footprint";
            }

            return "other";
        }

        private static List<FoxWatchManifestHitPolygon> BuildFootprintPolygons(IEnumerable<FoxWatchManifestBuildFootprintBox> boxes)
        {
            var polygons = new List<FoxWatchManifestHitPolygon>();
            foreach (var box in boxes)
            {
                if (box.Width == null || box.Length == null)
                {
                    continue;
                }

                var halfWidth = box.Width.Value / UnrealUnitsPerMeter;
                var halfLength = box.Length.Value / UnrealUnitsPerMeter;
                var centerX = (box.X ?? 0) / UnrealUnitsPerMeter;
                var centerY = (box.Y ?? 0) / UnrealUnitsPerMeter;
                var radians = ((box.Rotation ?? 0) * Math.PI) / 180.0;
                var cos = Math.Cos(radians);
                var sin = Math.Sin(radians);

                var corners = new (double X, double Y)[]
                {
                    (-halfWidth, -halfLength),
                    (halfWidth, -halfLength),
                    (halfWidth, halfLength),
                    (-halfWidth, halfLength),
                };

                var shape = new List<double>(corners.Length * 2);
                foreach (var corner in corners)
                {
                    var rotatedX = (corner.X * cos) - (corner.Y * sin);
                    var rotatedY = (corner.X * sin) + (corner.Y * cos);
                    shape.Add(Math.Round(centerX + rotatedX, 3));
                    shape.Add(Math.Round(centerY + rotatedY, 3));
                }

                polygons.Add(new FoxWatchManifestHitPolygon
                {
                    Shape = shape,
                });
            }

            return polygons;
        }

        private static List<FoxWatchManifestFuelTank> ExtractFuelTanks(object? value)
        {
            return AsEnumerable(value)
                .Select(entry => new FoxWatchManifestFuelTank
                {
                    CodeName = NormalizeString(ExtractText(GetNamedValue(entry, "FuelItemCodeName"))),
                    Capacity = ExtractDouble(GetNamedValue(entry, "FuelCapacity")),
                })
                .Where(entry => !string.IsNullOrWhiteSpace(entry.CodeName) || entry.Capacity != null)
                .ToList();
        }

        private static FoxWatchManifestHoldProfile? BuildHoldProfile(
            FoxWatchManifestStockpile? stockpile,
            IReadOnlyList<FoxWatchManifestFuelTank> fuelTanks,
            FoxWatchConstructionDynamicDataEntry? constructionDynamicData,
            string? structureCodeName = null)
        {
            if (stockpile?.TotalCrateCapacity is int crateCapacity && crateCapacity > 0)
            {
                var hasExplicitCrateItems = stockpile.ValidItems is { Count: > 0 };
                return new FoxWatchManifestHoldProfile
                {
                    Mode = "crate-stockpile",
                    Capacity = crateCapacity,
                    AllowedItems = hasExplicitCrateItems ? stockpile.ValidItems : null,
                    ItemQuantityLimits = stockpile.ItemQuantityLimits is { Count: > 0 } ? stockpile.ItemQuantityLimits : null,
                    AllowsAnyItem = !hasExplicitCrateItems ? true : null,
                };
            }

            // Must run before the generic ValidItems stockpile branch (TrailerLiquid / SmallTrainLiquid
            // already list liquids in ValidItems but still only hold one type at a time).
            if (ShouldUseSingleTypeLiquidHoldProfile(structureCodeName)
                && stockpile?.TotalItemCapacity is int singleTypeLiquidCapacity
                && singleTypeLiquidCapacity > 0)
            {
                var allowedItems = stockpile.ValidItems is { Count: > 0 }
                    ? stockpile.ValidItems
                    : GetStandardLiquidItemCodeNames();
                return new FoxWatchManifestHoldProfile
                {
                    Mode = "fuel-tank",
                    Capacity = singleTypeLiquidCapacity,
                    AllowedItems = allowedItems,
                    ItemQuantityLimits = stockpile.ItemQuantityLimits is { Count: > 0 }
                        ? stockpile.ItemQuantityLimits
                        : null,
                };
            }

            if (stockpile?.ValidItems is { Count: > 0 } || stockpile?.ItemQuantityLimits is { Count: > 0 })
            {
                return new FoxWatchManifestHoldProfile
                {
                    Mode = "stockpile",
                    Capacity = stockpile.TotalItemCapacity,
                    AllowedItems = stockpile.ValidItems,
                    ItemQuantityLimits = stockpile.ItemQuantityLimits,
                };
            }

            if (fuelTanks.Count > 0)
            {
                var allowedItems = fuelTanks
                    .Select(tank => NormalizeString(tank.CodeName))
                    .Where(codeName => !string.IsNullOrWhiteSpace(codeName))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                var itemQuantityLimits = fuelTanks
                    .Select(tank => new
                    {
                        CodeName = NormalizeString(tank.CodeName),
                        Capacity = tank.Capacity,
                    })
                    .Where(entry => !string.IsNullOrWhiteSpace(entry.CodeName) && entry.Capacity is > 0)
                    .GroupBy(entry => entry.CodeName!, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(
                        group => group.Key,
                        group => (int)Math.Round(group.First().Capacity!.Value),
                        StringComparer.Ordinal);

                return new FoxWatchManifestHoldProfile
                {
                    Mode = "fuel-tank",
                    AllowedItems = allowedItems.Count > 0 ? allowedItems : null,
                    ItemQuantityLimits = itemQuantityLimits.Count > 0 ? itemQuantityLimits : null,
                };
            }

            if (stockpile?.TotalItemCapacity is int itemCapacity && itemCapacity > 0)
            {
                if (ShouldUseFacilityTransferLiquidHoldProfile(stockpile, structureCodeName))
                {
                    return new FoxWatchManifestHoldProfile
                    {
                        Mode = "stockpile",
                        Capacity = itemCapacity,
                        AllowedItems = GetStandardLiquidItemCodeNames(),
                    };
                }

                return new FoxWatchManifestHoldProfile
                {
                    Mode = "stockpile",
                    Capacity = itemCapacity,
                    ItemQuantityLimits = stockpile.ItemQuantityLimits is { Count: > 0 } ? stockpile.ItemQuantityLimits : null,
                };
            }

            var slotFilters = constructionDynamicData?.ItemSlotFilters;
            if (slotFilters is { Count: > 0 })
            {
                var allowedItems = new List<string>();
                var itemQuantityLimits = new Dictionary<string, int>(StringComparer.Ordinal);
                int? stackLimit = null;

                foreach (var filter in slotFilters)
                {
                    var codes = new[] { filter.CodeName }
                        .Concat(filter.ExtraCodeNames)
                        .Select(NormalizeString)
                        .Where(codeName =>
                            !string.IsNullOrWhiteSpace(codeName)
                            && !string.Equals(codeName, "None", StringComparison.OrdinalIgnoreCase))
                        .Distinct(StringComparer.OrdinalIgnoreCase);

                    foreach (var codeName in codes)
                    {
                        if (!allowedItems.Contains(codeName, StringComparer.OrdinalIgnoreCase))
                        {
                            allowedItems.Add(codeName);
                        }

                        if (filter.StackLimit is int filterStackLimit && filterStackLimit > 0)
                        {
                            itemQuantityLimits.TryAdd(codeName, filterStackLimit);
                        }
                    }

                    stackLimit ??= filter.StackLimit;
                }

                return new FoxWatchManifestHoldProfile
                {
                    Mode = "inventory",
                    Capacity = constructionDynamicData?.InventorySlots,
                    StackLimit = stackLimit,
                    AllowedItems = allowedItems.Count > 0 ? allowedItems : null,
                    ItemQuantityLimits = itemQuantityLimits.Count > 0 ? itemQuantityLimits : null,
                };
            }

            if (stockpile?.TotalItemCapacity == 0)
            {
                return new FoxWatchManifestHoldProfile
                {
                    Mode = "stockpile",
                    Capacity = 0,
                    AllowsAnyItem = true,
                };
            }

            if (constructionDynamicData?.InventorySlots is int inventorySlots && inventorySlots > 0)
            {
                return new FoxWatchManifestHoldProfile
                {
                    Mode = "inventory",
                    Capacity = inventorySlots,
                    // No ItemSlotFilters means any inventory item is allowed (e.g. StorageBox).
                    AllowsAnyItem = true,
                };
            }

            return null;
        }

        private static bool ShouldUseSingleTypeLiquidHoldProfile(string? structureCodeName)
        {
            // Wiki: Liquid Container, Rooster-Lamploader, and BMS Tinderbox only hold one liquid type at a time.
            return string.Equals(structureCodeName, "LiquidContainer", StringComparison.OrdinalIgnoreCase)
                || string.Equals(structureCodeName, "TrailerLiquid", StringComparison.OrdinalIgnoreCase)
                || string.Equals(structureCodeName, "SmallTrainLiquid", StringComparison.OrdinalIgnoreCase);
        }

        private static bool ShouldUseFacilityTransferLiquidHoldProfile(
            FoxWatchManifestStockpile stockpile,
            string? structureCodeName)
        {
            if (!string.Equals(structureCodeName, "FacilityTransferLiquid", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return ShouldInjectStandardLiquidAllowedItems(stockpile);
        }

        private static bool ShouldInjectStandardLiquidAllowedItems(FoxWatchManifestStockpile stockpile)
        {
            if (stockpile.ValidItems is { Count: > 0 })
            {
                return false;
            }

            if (stockpile.ItemQuantityLimits is { Count: > 0 })
            {
                return false;
            }

            return stockpile.TotalItemCapacity is > 0;
        }

        private static List<string> GetStandardLiquidItemCodeNames()
        {
            return
            [
                "Water",
                "Diesel",
                "FacilityOil1",
                "FacilityOil2",
                "Oil",
                "Petrol",
            ];
        }

        private FoxWatchManifestStockpile? ExtractStockpile(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint)
        {
            FoxWatchManifestStockpile? stockpile = null;
            var seenComponentNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var scope in EnumerateBlueprintComponentScopes(rootObjects, blueprint))
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    var isItemStockpile = componentType.Contains("ReplicatedGenericStockpileComponent", StringComparison.OrdinalIgnoreCase)
                        || componentType.Contains("GenericStockpileComponent", StringComparison.OrdinalIgnoreCase);
                    var isCrateStockpile = componentType.Contains("GenericCrateStockpileComponent", StringComparison.OrdinalIgnoreCase);
                    if (!isItemStockpile && !isCrateStockpile)
                    {
                        continue;
                    }

                    var componentName = NormalizeString(ExtractText(GetNamedValue(item, "Name")));
                    if (!string.IsNullOrWhiteSpace(componentName) && !seenComponentNames.Add(componentName))
                    {
                        continue;
                    }

                    var config = AsEnumerable(GetInheritedBlueprintComponentProperty(rootObjects, blueprint, item, "Configs"))
                        .FirstOrDefault();
                    if (config == null)
                    {
                        continue;
                    }

                    stockpile ??= new FoxWatchManifestStockpile();

                    var totalQuantityLimit = ExtractNullableInt(GetNamedValue(config, "TotalQuantityLimit"));
                    if (isItemStockpile && stockpile.TotalItemCapacity == null && totalQuantityLimit != null)
                    {
                        stockpile.TotalItemCapacity = totalQuantityLimit;
                    }

                    var itemCategoryFilter = ExtractNullableInt(GetNamedValue(config, "ItemCategoryFilter"));
                    if (itemCategoryFilter != null && stockpile.ItemCategoryFilter == null)
                    {
                        stockpile.ItemCategoryFilter = itemCategoryFilter;
                    }

                    if (isCrateStockpile && stockpile.TotalCrateCapacity == null && totalQuantityLimit != null)
                    {
                        stockpile.TotalCrateCapacity = totalQuantityLimit;
                    }

                    if (!isItemStockpile)
                    {
                        continue;
                    }

                    var itemQuantityLimits = new Dictionary<string, int>(StringComparer.Ordinal);
                    foreach (var entry in AsEnumerable(GetNamedValue(config, "TotalQuantityOverrides")))
                    {
                        var key = NormalizeString(ExtractText(GetNamedValue(entry, "Key")));
                        if (string.IsNullOrWhiteSpace(key) || string.Equals(key, "None", StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        var quantityLimit = ExtractNullableInt(GetNamedValue(entry, "Value"));
                        if (quantityLimit != null)
                        {
                            itemQuantityLimits[key] = quantityLimit.Value;
                        }
                    }

                    if (itemQuantityLimits.Count > 0 && (stockpile.ItemQuantityLimits == null || stockpile.ItemQuantityLimits.Count == 0))
                    {
                        stockpile.ItemQuantityLimits = itemQuantityLimits;
                    }

                    var validItems = AsEnumerable(GetNamedValue(config, "ValidEntriesOverride"))
                        .Select(ExtractText)
                        .Select(NormalizeString)
                        .Where(value => !string.IsNullOrWhiteSpace(value) && !string.Equals(value, "None", StringComparison.OrdinalIgnoreCase))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();
                    if (validItems.Count > 0 && (stockpile.ValidItems == null || stockpile.ValidItems.Count == 0))
                    {
                        stockpile.ValidItems = validItems;
                    }
                }
            }

            if (stockpile == null)
            {
                return null;
            }

            if (stockpile.ItemQuantityLimits is { Count: 0 })
            {
                stockpile.ItemQuantityLimits = null;
            }

            if (stockpile.ValidItems is { Count: 0 })
            {
                stockpile.ValidItems = null;
            }

            return stockpile.TotalItemCapacity == null
                && stockpile.TotalCrateCapacity == null
                && stockpile.ItemQuantityLimits == null
                && stockpile.ValidItems == null
                ? null
                : stockpile;
        }

        private List<FoxWatchManifestConversionEntry> ExtractRefinableConversionEntries(object? value)
        {
            var entries = new List<FoxWatchManifestConversionEntry>();

            foreach (var refinableItem in AsEnumerable(value))
            {
                var sourceMetadata = ResolveReferencedAssetMetadata(GetNamedValue(refinableItem, "SourceItemClass"));
                var refinedMetadata = ResolveReferencedAssetMetadata(GetNamedValue(refinableItem, "RefinedItemClass"));
                var yieldModifier = ExtractDouble(GetNamedValue(refinableItem, "YieldModifier"));
                var speedModifier = ExtractDouble(GetNamedValue(refinableItem, "SpeedModifier"));
                var maxRefinedItemCount = ExtractDouble(GetNamedValue(refinableItem, "MaxRefinedItemCount"));

                if (sourceMetadata == null ||
                    refinedMetadata == null ||
                    yieldModifier is null or <= 0 ||
                    speedModifier is null or <= 0)
                {
                    continue;
                }

                var inputQuantity = NormalizeRecipeQuantity(1.0 / yieldModifier.Value);
                var outputQuantity = NormalizeRecipeQuantity(ResolveRefinableOutputQuantity(refinedMetadata));
                var durationSeconds = NormalizeRecipeQuantity((inputQuantity / speedModifier.Value) * 60.0);
                if (inputQuantity <= 0 || outputQuantity <= 0 || durationSeconds <= 0)
                {
                    continue;
                }

                var entry = new FoxWatchManifestConversionEntry
                {
                    Duration = durationSeconds,
                };

                var inputMap = new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal)
                {
                    [sourceMetadata.CodeName] = new FoxWatchManifestRecipeResource
                    {
                        Quantity = inputQuantity,
                    },
                };
                var outputMap = new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal)
                {
                    [refinedMetadata.CodeName] = new FoxWatchManifestRecipeResource
                    {
                        Quantity = outputQuantity,
                        Limit = maxRefinedItemCount,
                    },
                };

                if (sourceMetadata.IsLiquid)
                {
                    entry.LiquidInput = inputMap;
                }
                else
                {
                    entry.ItemInput = inputMap;
                }

                if (refinedMetadata.IsLiquid)
                {
                    entry.LiquidOutput = outputMap;
                }
                else
                {
                    entry.ItemOutput = outputMap;
                }

                entries.Add(entry);
            }

            return entries;
        }

        private List<FoxWatchManifestConversionEntry> BuildSpecializedFactoryConversionEntries(
            string itemCodeName,
            FoxWatchConstructionDynamicDataEntry dynamicDataEntry,
            bool isMassProductionSupported,
            int maxOrderSize,
            double productionTimeMultiplier,
            double massProductionDiscountPerItem,
            double massProductionMaxDiscount)
        {
            var entries = new List<FoxWatchManifestConversionEntry>();
            if (string.IsNullOrWhiteSpace(itemCodeName) || dynamicDataEntry.CrateProductionTime is not > 0)
            {
                return entries;
            }

            if (!isMassProductionSupported)
            {
                var factoryEntry = CreateSpecializedFactoryConversionEntry(
                    itemCodeName,
                    dynamicDataEntry,
                    crateCount: 1,
                    costMultiplier: 1,
                    durationSeconds: dynamicDataEntry.CrateProductionTime.Value);
                if (factoryEntry != null)
                {
                    entries.Add(factoryEntry);
                }

                return entries;
            }

            var minimumOrderSize = maxOrderSize >= 3 ? 3 : 1;
            for (var crateCount = minimumOrderSize; crateCount <= maxOrderSize; crateCount++)
            {
                var costMultiplier = GetMassProductionCostMultiplier(crateCount, massProductionDiscountPerItem, massProductionMaxDiscount);
                var durationSeconds = dynamicDataEntry.CrateProductionTime.Value * productionTimeMultiplier * crateCount;
                var recipe = CreateSpecializedFactoryConversionEntry(itemCodeName, dynamicDataEntry, crateCount, costMultiplier, durationSeconds);
                if (recipe != null)
                {
                    entries.Add(recipe);
                }
            }

            return entries;
        }

        private static double GetMassProductionCostMultiplier(
            int crateCount,
            double massProductionDiscountPerItem,
            double massProductionMaxDiscount)
        {
            if (crateCount <= 0)
            {
                return 0;
            }

            var normalizedDiscountPerItem = Math.Max(0, massProductionDiscountPerItem);
            var normalizedMaxDiscount = Math.Max(0, massProductionMaxDiscount);
            var totalMultiplier = 0d;

            for (var crateIndex = 1; crateIndex <= crateCount; crateIndex++)
            {
                var crateDiscount = Math.Min(normalizedMaxDiscount, crateIndex * normalizedDiscountPerItem);
                totalMultiplier += Math.Max(0, 1.0 - crateDiscount);
            }

            return totalMultiplier;
        }

        private static FoxWatchManifestConversionEntry? CreateSpecializedFactoryConversionEntry(
            string itemCodeName,
            FoxWatchConstructionDynamicDataEntry dynamicDataEntry,
            int crateCount,
            double costMultiplier,
            double durationSeconds)
        {
            if (string.IsNullOrWhiteSpace(itemCodeName) || crateCount <= 0 || !double.IsFinite(durationSeconds) || durationSeconds <= 0)
            {
                return null;
            }

            return new FoxWatchManifestConversionEntry
            {
                ItemInput = ScaleRecipeResources(dynamicDataEntry.CrateCost, costMultiplier),
                CrateOutput = new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal)
                {
                    [itemCodeName] = new FoxWatchManifestRecipeResource
                    {
                        Quantity = NormalizeRecipeQuantity(crateCount),
                    },
                },
                Duration = NormalizeRecipeQuantity(durationSeconds),
            };
        }

        private static FoxWatchManifestConversionEntry? CreateFieldModificationCenterVehicleUpgradeConversionEntry(
            string inputVehicleCodeName,
            string outputVehicleCodeName,
            IReadOnlyDictionary<string, FoxWatchManifestRecipeResource> upgradeCost)
        {
            if (string.IsNullOrWhiteSpace(inputVehicleCodeName) ||
                string.IsNullOrWhiteSpace(outputVehicleCodeName))
            {
                return null;
            }

            var itemInput = CloneRecipeResources(upgradeCost);
            itemInput[inputVehicleCodeName] = new FoxWatchManifestRecipeResource
            {
                Quantity = 1,
            };

            return new FoxWatchManifestConversionEntry
            {
                ItemInput = itemInput,
                ItemOutput = new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal)
                {
                    [outputVehicleCodeName] = new FoxWatchManifestRecipeResource
                    {
                        Quantity = 1,
                    },
                },
            };
        }

        private FoxWatchReferencedAssetMetadata? ResolveReferencedAssetMetadata(object? value)
        {
            var packagePath = ResolvePackagePath(ResolveReferencedPackagePath(value))
                ?? ResolveReferencedPackagePath(value);
            if (string.IsNullOrWhiteSpace(packagePath))
            {
                return null;
            }

            if (_referencedAssetMetadataByPackagePath.TryGetValue(packagePath, out var cachedMetadata))
            {
                return cachedMetadata;
            }

            FoxWatchReferencedAssetMetadata? metadata = null;
            try
            {
                var package = _fileProvider.LoadPackage(packagePath);
                var defaultObject = package.GetExports()
                    .Cast<object>()
                    .FirstOrDefault(export => NormalizeString(ExtractText(GetNamedValue(export, "Name"))).StartsWith("Default__", StringComparison.OrdinalIgnoreCase));
                if (defaultObject != null)
                {
                    var codeName = NormalizeString(ExtractText(GetNamedValue(defaultObject, "CodeName")));
                    var liquidItemComponentMetadata = ResolveLiquidItemComponentMetadata(GetReferencedPackagePath(defaultObject, "ItemComponentClass"));
                    if (string.IsNullOrWhiteSpace(codeName))
                    {
                        codeName = liquidItemComponentMetadata?.CodeName ?? string.Empty;
                    }

                    if (!string.IsNullOrWhiteSpace(codeName))
                    {
                        metadata = new FoxWatchReferencedAssetMetadata
                        {
                            PackagePath = packagePath,
                            CodeName = codeName,
                            IsLiquid = ExtractBoolValue(GetNamedValue(defaultObject, "bIsLiquid")) == true
                                || liquidItemComponentMetadata?.Capacity is > 0,
                            LiquidUnitQuantity = liquidItemComponentMetadata?.Capacity,
                        };
                    }
                }
            }
            catch
            {
                metadata = null;
            }

            metadata ??= CreateReferencedAssetMetadataFallback(packagePath);
            _referencedAssetMetadataByPackagePath[packagePath] = metadata;
            return metadata;
        }

        private FoxWatchLiquidItemComponentMetadata? ResolveLiquidItemComponentMetadata(string? itemComponentClassPackagePath)
        {
            var packagePath = ResolvePackagePath(itemComponentClassPackagePath) ?? NormalizePackageComparisonPath(itemComponentClassPackagePath);
            if (string.IsNullOrWhiteSpace(packagePath))
            {
                return null;
            }

            if (_liquidItemComponentMetadataByPackagePath.TryGetValue(packagePath, out var cachedMetadata))
            {
                return cachedMetadata;
            }

            FoxWatchLiquidItemComponentMetadata? metadata = null;
            try
            {
                var package = _fileProvider.LoadPackage(packagePath);
                var defaultObject = package.GetExports()
                    .Cast<object>()
                    .FirstOrDefault(export => NormalizeString(ExtractText(GetNamedValue(export, "Name"))).StartsWith("Default__", StringComparison.OrdinalIgnoreCase));
                if (defaultObject != null)
                {
                    var codeName = NormalizeString(ExtractText(GetNamedValue(defaultObject, "FuelItemCodeName")));
                    var capacity = ExtractDouble(GetNamedValue(defaultObject, "FuelCapacity"));
                    if (!string.IsNullOrWhiteSpace(codeName) || capacity is > 0)
                    {
                        metadata = new FoxWatchLiquidItemComponentMetadata
                        {
                            CodeName = codeName,
                            Capacity = capacity,
                        };
                    }
                }
            }
            catch
            {
                metadata = null;
            }

            _liquidItemComponentMetadataByPackagePath[packagePath] = metadata;
            return metadata;
        }

        private static FoxWatchReferencedAssetMetadata? CreateReferencedAssetMetadataFallback(string packagePath)
        {
            var codeName = ResolveReferencedAssetFallbackCodeName(packagePath);
            return string.IsNullOrWhiteSpace(codeName)
                ? null
                : new FoxWatchReferencedAssetMetadata
                {
                    PackagePath = packagePath,
                    CodeName = codeName,
                    IsLiquid = false,
                };
        }

        private static string? ResolveReferencedAssetFallbackCodeName(string packagePath)
        {
            var packageName = Path.GetFileNameWithoutExtension(packagePath);
            if (string.IsNullOrWhiteSpace(packageName))
            {
                return null;
            }

            if (packageName.StartsWith("BP", StringComparison.OrdinalIgnoreCase))
            {
                packageName = packageName[2..];
            }

            if (packageName.EndsWith("_C", StringComparison.OrdinalIgnoreCase))
            {
                packageName = packageName[..^2];
            }

            foreach (var suffix in BlueprintTargetWrapperSuffixes)
            {
                if (packageName.EndsWith(suffix, StringComparison.OrdinalIgnoreCase) && packageName.Length > suffix.Length)
                {
                    packageName = packageName[..^suffix.Length];
                    break;
                }
            }

            packageName = NormalizeString(packageName);
            return string.IsNullOrWhiteSpace(packageName) ? null : packageName;
        }

        private static double ResolveRefinableOutputQuantity(FoxWatchReferencedAssetMetadata metadata)
        {
            return metadata.IsLiquid && metadata.LiquidUnitQuantity is > 0
                ? metadata.LiquidUnitQuantity.Value
                : 100.0;
        }

        private static double NormalizeRecipeQuantity(double value)
        {
            if (!double.IsFinite(value))
            {
                return 0;
            }

            var roundedInteger = Math.Round(value, MidpointRounding.AwayFromZero);
            if (Math.Abs(value - roundedInteger) <= 0.001)
            {
                return roundedInteger;
            }

            return Math.Round(value, 3, MidpointRounding.AwayFromZero);
        }

        private static Dictionary<string, FoxWatchManifestRecipeResource> ScaleRecipeResources(
            IReadOnlyDictionary<string, FoxWatchManifestRecipeResource> resources,
            double multiplier)
        {
            if (resources.Count == 0 || !double.IsFinite(multiplier) || multiplier == 0)
            {
                return new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal);
            }

            return resources.ToDictionary(
                pair => pair.Key,
                pair => new FoxWatchManifestRecipeResource
                {
                    Quantity = NormalizeRecipeQuantity(pair.Value.Quantity * multiplier),
                    Limit = pair.Value.Limit,
                },
                StringComparer.Ordinal);
        }

        private static List<string> ExtractCodeNames(object? value)
        {
            return AsEnumerable(value)
                .Select(ExtractText)
                .Select(NormalizeString)
                .Where(codeName => !string.IsNullOrWhiteSpace(codeName) && !string.Equals(codeName, "None", StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static List<string> MergeDistinctCodeNames(IEnumerable<string> primary, IEnumerable<string> secondary)
        {
            var merged = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var codeName in primary.Concat(secondary).Select(NormalizeString))
            {
                if (string.IsNullOrWhiteSpace(codeName) ||
                    string.Equals(codeName, "None", StringComparison.OrdinalIgnoreCase) ||
                    !seen.Add(codeName))
                {
                    continue;
                }

                merged.Add(codeName);
            }

            return merged;
        }

        private static string? GetBlueprintPackageDirectory(string? blueprintPackagePath)
        {
            var normalizedPath = NormalizeString(blueprintPackagePath);
            if (string.IsNullOrWhiteSpace(normalizedPath))
            {
                return null;
            }

            var separatorIndex = normalizedPath.LastIndexOf('/');
            return separatorIndex > 0
                ? normalizedPath[..separatorIndex]
                : null;
        }

        private static string? ResolveVehicleFactionKey(FoxWatchManifestStructure structure)
        {
            var explicitFaction = NullIfWhiteSpace(structure.Faction);
            if (!string.IsNullOrWhiteSpace(explicitFaction))
            {
                return explicitFaction;
            }

            var codeName = NormalizeString(structure.CodeName);
            if (codeName.EndsWith("W", StringComparison.OrdinalIgnoreCase))
            {
                return "w";
            }

            if (codeName.EndsWith("C", StringComparison.OrdinalIgnoreCase))
            {
                return "c";
            }

            return null;
        }

        private static string TrimVehicleFactionSuffix(string codeName, string? factionKey)
        {
            var normalizedCodeName = NormalizeString(codeName);
            if (string.IsNullOrWhiteSpace(normalizedCodeName))
            {
                return string.Empty;
            }

            if (string.Equals(factionKey, "w", StringComparison.OrdinalIgnoreCase) &&
                normalizedCodeName.EndsWith("W", StringComparison.OrdinalIgnoreCase))
            {
                return normalizedCodeName[..^1];
            }

            if (string.Equals(factionKey, "c", StringComparison.OrdinalIgnoreCase) &&
                normalizedCodeName.EndsWith("C", StringComparison.OrdinalIgnoreCase))
            {
                return normalizedCodeName[..^1];
            }

            return normalizedCodeName;
        }

        private static int ComputeCommonPrefixLength(string left, string right)
        {
            if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
            {
                return 0;
            }

            var prefixLength = 0;
            var comparisonLength = Math.Min(left.Length, right.Length);
            while (prefixLength < comparisonLength &&
                char.ToUpperInvariant(left[prefixLength]) == char.ToUpperInvariant(right[prefixLength]))
            {
                prefixLength++;
            }

            return prefixLength;
        }

        private static List<FoxWatchManifestConversionEntry> ExtractConversionEntries(object? value)
        {
            return AsEnumerable(value)
                .Select(ExtractConversionEntry)
                .Where(entry => entry != null)
                .Cast<FoxWatchManifestConversionEntry>()
                .ToList();
        }

        private static FoxWatchManifestConversionEntry? ExtractConversionEntry(object? value)
        {
            if (value == null)
            {
                return null;
            }

            var entry = new FoxWatchManifestConversionEntry
            {
                ItemInput = ExtractRecipeResources(GetNamedValue(value, "ItemInput")),
                CrateInput = ExtractRecipeResources(GetNamedValue(value, "CrateInput")),
                LiquidInput = ExtractRecipeResources(GetNamedValue(value, "LiquidInput")),
                ItemOutput = ExtractRecipeResources(GetNamedValue(value, "ItemOutput")),
                CrateOutput = ExtractRecipeResources(GetNamedValue(value, "CrateOutput")),
                LiquidOutput = ExtractRecipeResources(GetNamedValue(value, "LiquidOutput")),
                Duration = ExtractDouble(GetNamedValue(value, "Duration")),
                PowerDelta = ExtractNullableInt(GetNamedValue(value, "PowerDelta")),
                bConsumeResourceNodes = ExtractBoolValue(GetNamedValue(value, "bConsumeResourceNodes")),
            };

            if (entry.ItemInput.Count == 0 &&
                entry.CrateInput.Count == 0 &&
                entry.LiquidInput.Count == 0 &&
                entry.ItemOutput.Count == 0 &&
                entry.CrateOutput.Count == 0 &&
                entry.LiquidOutput.Count == 0 &&
                entry.Duration == null &&
                entry.PowerDelta == null &&
                entry.bConsumeResourceNodes == null)
            {
                return null;
            }

            return entry;
        }

        private static Dictionary<string, FoxWatchManifestRecipeResource> ExtractRecipeResources(object? value)
        {
            var resources = new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal);

            var primaryResource = GetNamedValue(value, "Resource");
            if (primaryResource != null)
            {
                AddRecipeResource(resources, primaryResource);
            }

            foreach (var otherResource in AsEnumerable(GetNamedValue(value, "OtherResources")))
            {
                AddRecipeResource(resources, otherResource);
            }

            if (resources.Count > 0)
            {
                return resources;
            }

            foreach (var entry in AsEnumerable(value))
            {
                var resourceValue = entry;
                var codeName = NormalizeResourceCodeName(
                    ExtractText(GetNamedValue(entry, "CodeName"))
                    ?? ExtractText(GetNamedValue(entry, "ItemCodeName")));
                if (entry is FoxWatchScriptMapEntry mapEntry)
                {
                    resourceValue = mapEntry.Value;
                    codeName = NormalizeResourceCodeName(
                        ExtractText(GetNamedValue(mapEntry.Key, "CodeName"))
                        ?? ExtractText(GetNamedValue(mapEntry.Key, "ItemCodeName"))
                        ?? ExtractText(mapEntry.Key));
                }

                if (string.IsNullOrWhiteSpace(codeName))
                {
                    continue;
                }

                var quantity = ExtractDouble(GetNamedValue(resourceValue, "Quantity"))
                    ?? ExtractDouble(resourceValue)
                    ?? 0;
                var limit = ExtractDouble(GetNamedValue(resourceValue, "Limit"));

                resources[codeName] = new FoxWatchManifestRecipeResource
                {
                    Quantity = quantity,
                    Limit = limit,
                };
            }

            return resources;
        }

        private static void AddRecipeResource(
            IDictionary<string, FoxWatchManifestRecipeResource> resources,
            object? value)
        {
            var codeName = NormalizeResourceCodeName(
                ExtractText(GetNamedValue(value, "CodeName"))
                ?? ExtractText(GetNamedValue(value, "ItemCodeName")));
            if (string.IsNullOrWhiteSpace(codeName))
            {
                return;
            }

            var quantity = ExtractDouble(GetNamedValue(value, "Quantity")) ?? 0;
            var limit = ExtractDouble(GetNamedValue(value, "Limit"));
            if (resources.TryGetValue(codeName, out var existingResource))
            {
                existingResource.Quantity += quantity;
                if (existingResource.Limit == null)
                {
                    existingResource.Limit = limit;
                }

                return;
            }

            resources[codeName] = new FoxWatchManifestRecipeResource
            {
                Quantity = quantity,
                Limit = limit,
            };
        }

        private static string NormalizeResourceCodeName(string? value)
        {
            var normalizedCodeName = NormalizeString(value);
            return string.Equals(normalizedCodeName, "None", StringComparison.OrdinalIgnoreCase)
                || string.Equals(normalizedCodeName, "Excavation", StringComparison.OrdinalIgnoreCase)
                || string.Equals(normalizedCodeName, "StrongMaterials", StringComparison.OrdinalIgnoreCase)
                || string.Equals(normalizedCodeName, "RFuel", StringComparison.OrdinalIgnoreCase)
                ? string.Empty
                : normalizedCodeName;
        }

        private static Dictionary<string, FoxWatchManifestRecipeResource> ExtractRecipeResourcesFromJsonToken(JToken? value)
        {
            var resources = new Dictionary<string, FoxWatchManifestRecipeResource>(StringComparer.Ordinal);
            if (value == null || value.Type == JTokenType.Null)
            {
                return resources;
            }

            if (value is JObject objectToken)
            {
                if (objectToken.TryGetValue("Resource", StringComparison.OrdinalIgnoreCase, out var primaryResourceToken))
                {
                    AddRecipeResourceFromJsonToken(resources, primaryResourceToken);
                }

                if (objectToken.TryGetValue("OtherResources", StringComparison.OrdinalIgnoreCase, out var otherResourcesToken) &&
                    otherResourcesToken is JArray otherResources)
                {
                    foreach (var otherResourceToken in otherResources)
                    {
                        AddRecipeResourceFromJsonToken(resources, otherResourceToken);
                    }
                }

                if (resources.Count > 0)
                {
                    return resources;
                }
            }

            if (value is JArray arrayToken)
            {
                foreach (var entryToken in arrayToken)
                {
                    AddRecipeResourceFromJsonToken(resources, entryToken);
                }
            }

            return resources;
        }

        private static Dictionary<string, FoxWatchManifestRecipeResource> ExtractRecipeCostFromJsonObject(JObject? value)
        {
            var resourceAmounts = ExtractRecipeResourcesFromJsonToken(value?["ResourceAmounts"]);
            return resourceAmounts.Count > 0
                ? resourceAmounts
                : ExtractRecipeResourcesFromJsonToken(value?["AltResourceAmounts"]);
        }

        private static Dictionary<string, FoxWatchManifestRecipeResource> ExtractModificationTierCost(JObject? valueToken, int? preferredTier)
        {
            var tierEntries = valueToken?["Tiers"]?
                .OfType<JObject>()
                .ToList();
            if (tierEntries == null || tierEntries.Count == 0)
            {
                return [];
            }

            if (preferredTier.HasValue)
            {
                var matchingEntry = tierEntries.FirstOrDefault(entry => ModificationTierMatches(entry["Key"], preferredTier.Value));
                var matchingCost = ExtractRecipeCostFromJsonObject(matchingEntry?["Value"] as JObject);
                if (matchingCost.Count > 0)
                {
                    return matchingCost;
                }
            }

            foreach (var tierEntry in tierEntries)
            {
                var tierCost = ExtractRecipeCostFromJsonObject(tierEntry["Value"] as JObject);
                if (tierCost.Count > 0)
                {
                    return tierCost;
                }
            }

            return [];
        }

        private static void AddRecipeResourceFromJsonToken(
            IDictionary<string, FoxWatchManifestRecipeResource> resources,
            JToken? value)
        {
            if (value is not JObject objectToken)
            {
                return;
            }

            var codeName = NormalizeResourceCodeName(
                objectToken.Value<string>("CodeName")
                ?? objectToken.Value<string>("ItemCodeName"));
            if (string.IsNullOrWhiteSpace(codeName))
            {
                return;
            }

            var quantity = objectToken.Value<double?>("Quantity") ?? 0;
            var limit = objectToken.Value<double?>("Limit");
            if (resources.TryGetValue(codeName, out var existingResource))
            {
                existingResource.Quantity += quantity;
                if (existingResource.Limit == null)
                {
                    existingResource.Limit = limit;
                }

                return;
            }

            resources[codeName] = new FoxWatchManifestRecipeResource
            {
                Quantity = quantity,
                Limit = limit,
            };
        }

        private Dictionary<string, FoxWatchManifestModification> ExtractModifications(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            string structureId,
            int? structureTier,
            object? value,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            var modifications = new Dictionary<string, FoxWatchManifestModification>(StringComparer.Ordinal);
            foreach (var entry in AsEnumerable(value))
            {
                var rawKey = NormalizeString(ExtractText(GetNamedValue(entry, "Key")));
                var normalizedKey = NormalizeEnumValue(rawKey);
                if (string.IsNullOrWhiteSpace(normalizedKey))
                {
                    continue;
                }

                var modValue = GetNamedValue(entry, "Value");
                var tierValueToken = ResolveModificationTierValueToken(modValue as JObject, structureTier);
                var displayName = ExtractLocalizedText(
                    GetNamedValue(modValue, "DisplayName"),
                    CreateModificationLocalizationId(structureId, normalizedKey, "name"),
                    HumanizeCategory(normalizedKey),
                    englishStrings,
                    localizationReferencesById);
                var description = ExtractLocalizedText(
                    GetNamedValue(modValue, "Description"),
                    CreateModificationLocalizationId(structureId, normalizedKey, "description"),
                    string.Empty,
                    englishStrings,
                    localizationReferencesById);
                var cost = ExtractModificationTierCost(modValue as JObject, structureTier);
                if (cost.Count == 0)
                {
                    cost = ExtractRecipeCostFromJsonObject(modValue as JObject);
                }

                modifications[normalizedKey] = new FoxWatchManifestModification
                {
                    Name = displayName,
                    CodeName = normalizedKey,
                    Description = description,
                    PowerGridInfo = ExtractPowerGridInfo(GetNamedValue(modValue, "PowerGridInfo")),
                    BuildSockets = ExtractNestedBuildSockets(modValue),
                    FootprintPolygons = BuildFootprintPolygons(ExtractNestedBuildFootprintBoxes(modValue)),
                    FuelTanks = ExtractFuelTanks(GetNamedValue(modValue, "FuelTanks")),
                    ConversionEntries = ExtractConversionEntries(GetNamedValue(modValue, "ConversionEntries")),
                    Cost = cost,
                    IsUpgrade = false,
                    UpgradeName = displayName,
                    ParentStructureId = structureId,
                    RootStructureId = structureId,
                    AppliedModificationId = normalizedKey,
                };
            }

            var modificationKeysByNormalizedId = modifications.Keys.ToDictionary(
                key => NormalizeModificationVariantId(key),
                key => key,
                StringComparer.Ordinal);

            var variantOverlays = ResolveModificationVariantOverlays(objects, blueprint, structureId, structureTier);
            foreach (var pair in variantOverlays)
            {
                if (!modificationKeysByNormalizedId.TryGetValue(pair.Key, out var modificationKey) ||
                    !modifications.TryGetValue(modificationKey, out var modification))
                {
                    continue;
                }

                modification.BuildSockets = MergeDistinctBuildSockets(modification.BuildSockets, pair.Value.BuildSockets);
                if (modification.FootprintPolygons.Count == 0 && pair.Value.FootprintPolygons.Count > 0)
                {
                    modification.FootprintPolygons = pair.Value.FootprintPolygons.Select(CloneHitPolygon).ToList();
                }
            }

            return modifications;
        }

        private List<FoxWatchManifestModificationSlot> ExtractModificationSlots(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            string structureId,
            int? structureTier,
            string baseAssetsUrl,
            string? iconOutputDirectory,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            var slots = new List<FoxWatchManifestModificationSlot>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var blueprintPackagePath = GetPackagePath(blueprint);

            AppendModificationSlots(
                slots,
                seen,
                ExtractOwnedModificationSlots(
                    objects,
                    blueprint,
                    structureId,
                    structureTier,
                    baseAssetsUrl,
                    iconOutputDirectory,
                    englishStrings,
                    localizationReferencesById));

            var templateActorPackagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var scope in EnumerateBlueprintComponentScopes(objects, blueprint))
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    if (!GetObjectTypeName(item).Contains("TemplateComponent", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var templateComponentName = NormalizeTemplateComponentName(ExtractText(GetNamedValue(item, "Name")));
                    if (string.IsNullOrWhiteSpace(templateComponentName) ||
                        !templateComponentName.Contains("Mods", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var templateActorPackagePath = GetReferencedPackagePath(item, "TemplateActor");
                    if (!string.IsNullOrWhiteSpace(templateActorPackagePath))
                    {
                        templateActorPackagePaths.Add(templateActorPackagePath);
                        continue;
                    }

                    var inferredTemplateActorPackagePath = InferTemplateActorPackagePath(templateComponentName, blueprintPackagePath);
                    if (!string.IsNullOrWhiteSpace(inferredTemplateActorPackagePath))
                    {
                        templateActorPackagePaths.Add(inferredTemplateActorPackagePath);
                    }
                }
            }

            foreach (var templateActorPackagePath in InferTemplateActorPackagePathsFromBlueprintComponents(blueprintPackagePath))
            {
                templateActorPackagePaths.Add(templateActorPackagePath);
            }

            foreach (var templateActorPackagePath in templateActorPackagePaths)
            {
                AppendModificationSlots(
                    slots,
                    seen,
                    ExtractModificationSlotsFromTemplateActor(
                        templateActorPackagePath,
                        structureId,
                        structureTier,
                        baseAssetsUrl,
                        iconOutputDirectory,
                        englishStrings,
                        localizationReferencesById));
            }

            return slots;
        }

        private IEnumerable<string> EnumerateFortUpgradeStructureCodeNames(object? fortUpgradesValue)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);

            foreach (var entry in AsEnumerable(fortUpgradesValue))
            {
                var fortUpgradeCodeName = ResolveFortUpgradeStructureCodeName(entry)
                    ?? ResolveFortUpgradeStructureCodeName(GetNamedValue(entry, "Value"));
                if (string.IsNullOrWhiteSpace(fortUpgradeCodeName) ||
                    !seen.Add(fortUpgradeCodeName))
                {
                    continue;
                }

                yield return fortUpgradeCodeName;
            }
        }

        private static string? ResolveFortUpgradeStructureCodeName(object? value)
        {
            foreach (var rawStructureCodeName in new[]
            {
                NormalizeString(ExtractText(GetNamedValue(value, "UpgradedStructureCodeName"))),
                NormalizeString(ExtractText(GetNamedValue(value, "UpgradeStructureCodeName"))),
                ResolveReferencedStructureCodeName(GetNamedValue(value, "UpgradedStructure")),
                ResolveReferencedStructureCodeName(GetNamedValue(value, "UpgradedStructureClass")),
                ResolveReferencedStructureCodeName(GetNamedValue(value, "UpgradeStructureClass")),
            })
            {
                if (!string.IsNullOrWhiteSpace(rawStructureCodeName))
                {
                    return rawStructureCodeName;
                }
            }

            return null;
        }

        private IEnumerable<string> InferTemplateActorPackagePathsFromBlueprintComponents(string? blueprintPackagePath)
        {
            if (_meshAssetExporter == null || string.IsNullOrWhiteSpace(blueprintPackagePath))
            {
                return [];
            }

            try
            {
                return _meshAssetExporter
                    .InspectBlueprintComponentsAsync(blueprintPackagePath)
                    .GetAwaiter()
                    .GetResult()
                    .Where(reference => reference.ComponentType.Contains("TemplateComponent", StringComparison.OrdinalIgnoreCase))
                        .Select(reference => InferTemplateActorPackagePath(reference.ComponentName, blueprintPackagePath, modsOnly: true))
                    .Where(path => !string.IsNullOrWhiteSpace(path))
                    .Cast<string>()
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray();
            }
            catch
            {
                return [];
            }
        }

        private string? InferTemplateActorPackagePath(string? templateComponentName, string? blueprintPackagePath, bool modsOnly = false)
        {
            var normalizedBlueprintPackagePath = NormalizeString(blueprintPackagePath).Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(normalizedBlueprintPackagePath))
            {
                return null;
            }

            var normalizedTemplateComponentName = NormalizeTemplateComponentName(templateComponentName);
            if (string.IsNullOrWhiteSpace(normalizedTemplateComponentName) ||
                (modsOnly && !normalizedTemplateComponentName.Contains("Mods", StringComparison.OrdinalIgnoreCase)))
            {
                return null;
            }

            var blueprintDirectory = Path.GetDirectoryName(normalizedBlueprintPackagePath)?.Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(blueprintDirectory))
            {
                return null;
            }

            var blueprintName = normalizedTemplateComponentName.StartsWith("BP", StringComparison.OrdinalIgnoreCase)
                ? normalizedTemplateComponentName
                : $"BP{normalizedTemplateComponentName}";

            var candidatePaths = new[]
            {
                $"{blueprintDirectory}/{blueprintName}.uasset",
                $"{blueprintDirectory}/Templates/{blueprintName}.uasset",
            };

            foreach (var candidatePath in candidatePaths)
            {
                var resolvedPath = ResolvePackagePath(candidatePath);
                if (!string.IsNullOrWhiteSpace(resolvedPath))
                {
                    return resolvedPath;
                }
            }

            return null;
        }

        private List<FoxWatchManifestBuildSocket> ResolveStructureTemplateBuildSockets(string? blueprintPackagePath)
        {
            if (_meshAssetExporter == null || string.IsNullOrWhiteSpace(blueprintPackagePath))
            {
                return [];
            }

            try
            {
                var componentReferences = _meshAssetExporter
                    .InspectBlueprintComponentsAsync(blueprintPackagePath)
                    .GetAwaiter()
                    .GetResult();

                var sockets = new List<FoxWatchManifestBuildSocket>();
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var reference in componentReferences)
                {
                    if (!reference.ComponentType.Contains("TemplateComponent", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var templateActorPackagePath = InferTemplateActorPackagePath(reference.ComponentName, blueprintPackagePath, modsOnly: false);
                    if (string.IsNullOrWhiteSpace(templateActorPackagePath))
                    {
                        continue;
                    }

                    FoxWatchManifestModificationOverlay? overlay = null;
                    try
                    {
                        overlay = TryExtractModificationOverlay(templateActorPackagePath);
                    }
                    catch
                    {
                    }

                    if (overlay == null || overlay.BuildSockets.Count == 0)
                    {
                        continue;
                    }

                    var templateTransform = ResolveComponentReferenceTransform(reference, componentReferences);
                    var transformedSockets = overlay.BuildSockets
                        .Select(socket => TransformBuildSocket(socket, templateTransform));

                    foreach (var socket in transformedSockets)
                    {
                        var key = BuildBuildSocketKey(socket);
                        if (!seen.Add(key))
                        {
                            continue;
                        }

                        sockets.Add(socket);
                    }
                }

                return sockets;
            }
            catch
            {
                return [];
            }
        }

        private static string NormalizeTemplateComponentName(string? value)
        {
            var normalized = NormalizeString(value);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return string.Empty;
            }

            if (normalized.EndsWith("_GEN_VARIABLE", StringComparison.OrdinalIgnoreCase))
            {
                normalized = normalized[..^"_GEN_VARIABLE".Length];
            }

            return normalized;
        }

        private static string StripRemovedGeneratedComponentSuffix(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            var removedMarkerIndex = value.IndexOf("_REMOVED_", StringComparison.OrdinalIgnoreCase);
            return removedMarkerIndex >= 0
                ? value[..removedMarkerIndex]
                : value;
        }

        private List<FoxWatchManifestModificationSlot> ExtractOwnedModificationSlots(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            string structureId,
            int? structureTier,
            string baseAssetsUrl,
            string? iconOutputDirectory,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            var slots = new List<FoxWatchManifestModificationSlot>();

            foreach (var scope in EnumerateBlueprintComponentScopes(objects, blueprint))
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    if (!IsModificationSlotComponentType(componentType))
                    {
                        continue;
                    }

                    var name = NormalizeTemplateComponentName(ExtractText(GetNamedValue(item, "Name")));
                    var dataClassPath = GetReferencedPackagePath(item, "DataClass");
                    var linkedSocketNames = AsEnumerable(GetNamedValue(item, "LinkedSocketNames"))
                        .Select(ExtractText)
                        .Select(NormalizeString)
                        .Where(value => !string.IsNullOrWhiteSpace(value) && !string.Equals(value, "None", StringComparison.OrdinalIgnoreCase))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();
                    var blockedByModSlotNames = AsEnumerable(GetNamedValue(item, "BlockedByModSlotNames"))
                        .Select(ExtractText)
                        .Select(NormalizeString)
                        .Where(value => !string.IsNullOrWhiteSpace(value) && !string.Equals(value, "None", StringComparison.OrdinalIgnoreCase))
                        .Distinct(StringComparer.Ordinal)
                        .ToList();
                    var transform = ResolveComponentTransform(item, BuildComponentLookup(scope.Objects));

                    var slot = new FoxWatchManifestModificationSlot
                    {
                        Name = name,
                        ComponentType = NormalizeComponentTypeName(componentType),
                        DataClassPath = NullIfWhiteSpace(dataClassPath),
                        X = transform.X,
                        Y = transform.Y,
                        Z = transform.Z,
                        Rotation = transform.YawDegrees,
                        IsLinkedToSocket = ExtractBoolValue(GetNamedValue(item, "bIsLinkedToSocket")) == true,
                        LinkedSocketNames = linkedSocketNames,
                        BlockedByModSlotNames = blockedByModSlotNames,
                        Variants = InspectModificationSlotVariants(
                            dataClassPath,
                            structureId,
                            structureTier,
                            baseAssetsUrl,
                            iconOutputDirectory,
                            englishStrings,
                            localizationReferencesById),
                    };

                    slots.Add(slot);
                }
            }

            return slots;
        }

        private List<FoxWatchManifestModificationSlot> ExtractModificationSlotsFromTemplateActor(
            string templateActorPackagePath,
            string structureId,
            int? structureTier,
            string baseAssetsUrl,
            string? iconOutputDirectory,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            try
            {
                var package = _fileProvider.LoadPackage(templateActorPackagePath);
                var exports = package.GetExports().Cast<dynamic>().ToArray();
                var blueprint = exports.OfType<UBlueprintGeneratedClass>().FirstOrDefault();
                if (blueprint == null)
                {
                    return ExtractModificationSlotsFromComponentReferences(
                        templateActorPackagePath,
                        structureId,
                        structureTier,
                        baseAssetsUrl,
                        iconOutputDirectory,
                        englishStrings,
                        localizationReferencesById);
                }

                var ownedSlots = ExtractOwnedModificationSlots(
                    exports,
                    blueprint,
                    structureId,
                    structureTier,
                    baseAssetsUrl,
                    iconOutputDirectory,
                    englishStrings,
                    localizationReferencesById);
                return ownedSlots.Count > 0
                    ? ownedSlots
                    : ExtractModificationSlotsFromComponentReferences(
                        templateActorPackagePath,
                        structureId,
                        structureTier,
                        baseAssetsUrl,
                        iconOutputDirectory,
                        englishStrings,
                        localizationReferencesById);
            }
            catch
            {
                return ExtractModificationSlotsFromComponentReferences(
                    templateActorPackagePath,
                    structureId,
                    structureTier,
                    baseAssetsUrl,
                    iconOutputDirectory,
                    englishStrings,
                    localizationReferencesById);
            }
        }

        private List<FoxWatchManifestModificationSlot> ExtractModificationSlotsFromComponentReferences(
            string templateActorPackagePath,
            string structureId,
            int? structureTier,
            string baseAssetsUrl,
            string? iconOutputDirectory,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            if (_meshAssetExporter == null)
            {
                return [];
            }

            try
            {
                var componentReferences = _meshAssetExporter
                    .InspectBlueprintComponentsAsync(templateActorPackagePath)
                    .GetAwaiter()
                    .GetResult();

                return componentReferences
                    .Where(reference => IsModificationSlotComponentType(reference.ComponentType))
                    .Select(reference =>
                    {
                        var transform = ResolveComponentReferenceTransform(reference, componentReferences);
                        return new FoxWatchManifestModificationSlot
                        {
                            Name = NormalizeString(reference.ComponentName),
                            ComponentType = NormalizeString(reference.ComponentType),
                            DataClassPath = NullIfWhiteSpace(reference.DataClassPath),
                            X = transform.X,
                            Y = transform.Y,
                            Z = transform.Z,
                            Rotation = transform.YawDegrees,
                            IsLinkedToSocket = false,
                            LinkedSocketNames = [],
                            BlockedByModSlotNames = [],
                            Variants = InspectModificationSlotVariants(
                                reference.DataClassPath,
                                structureId,
                                structureTier,
                                baseAssetsUrl,
                                iconOutputDirectory,
                                englishStrings,
                                localizationReferencesById),
                        };
                    })
                    .ToList();
            }
            catch
            {
                return [];
            }
        }

        private static bool IsModificationSlotComponentType(string? componentType)
        {
            var normalizedComponentType = NormalizeString(componentType);
            return normalizedComponentType.Contains("ModSlot", StringComparison.OrdinalIgnoreCase)
                || normalizedComponentType.Contains("ModificationSlotComponent", StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeComponentTypeName(string? componentType)
        {
            var normalizedComponentType = NormalizeString(componentType);
            if (string.IsNullOrWhiteSpace(normalizedComponentType))
            {
                return string.Empty;
            }

            var firstQuoteIndex = normalizedComponentType.IndexOf('\'');
            var lastQuoteIndex = normalizedComponentType.LastIndexOf('\'');
            if (firstQuoteIndex >= 0 && lastQuoteIndex > firstQuoteIndex)
            {
                normalizedComponentType = normalizedComponentType[(firstQuoteIndex + 1)..lastQuoteIndex];
            }

            var dotIndex = normalizedComponentType.LastIndexOf('.');
            if (dotIndex >= 0 && dotIndex + 1 < normalizedComponentType.Length)
            {
                normalizedComponentType = normalizedComponentType[(dotIndex + 1)..];
            }
            else
            {
                var slashIndex = normalizedComponentType.LastIndexOf('/');
                if (slashIndex >= 0 && slashIndex + 1 < normalizedComponentType.Length)
                {
                    normalizedComponentType = normalizedComponentType[(slashIndex + 1)..];
                }
            }

            return normalizedComponentType.TrimEnd('\'');
        }

        private static void AppendModificationSlots(
            List<FoxWatchManifestModificationSlot> destination,
            HashSet<string> seen,
            IEnumerable<FoxWatchManifestModificationSlot> source)
        {
            foreach (var slot in source)
            {
                var key = string.Join("|", slot.Name, slot.ComponentType, slot.DataClassPath ?? string.Empty);
                if (seen.Add(key))
                {
                    destination.Add(slot);
                }
            }
        }

        private Dictionary<string, FoxWatchManifestModificationSlotVariant> InspectModificationSlotVariants(
            string? assetPath,
            string structureId,
            int? preferredTier,
            string baseAssetsUrl,
            string? iconOutputDirectory,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            if (string.IsNullOrWhiteSpace(assetPath))
            {
                return new Dictionary<string, FoxWatchManifestModificationSlotVariant>(StringComparer.Ordinal);
            }

            try
            {
                var package = _fileProvider.LoadPackage(assetPath);
                var exports = package.GetExports().ToArray();
                var exportsJson = JsonConvert.SerializeObject(exports, Formatting.None);
                var exportTokens = JArray.Parse(exportsJson);
                var defaultObjectToken = exportTokens
                    .OfType<JObject>()
                    .FirstOrDefault(token => token.Value<string>("Name")?.StartsWith("Default__", StringComparison.OrdinalIgnoreCase) == true);

                var modificationsToken = defaultObjectToken?["Properties"]?["Modifications"] as JArray;
                if (modificationsToken == null)
                {
                    return new Dictionary<string, FoxWatchManifestModificationSlotVariant>(StringComparer.Ordinal);
                }

                var variants = new Dictionary<string, FoxWatchManifestModificationSlotVariant>(StringComparer.Ordinal);
                foreach (var modificationToken in modificationsToken.OfType<JObject>())
                {
                    var rawKey = modificationToken.Value<string>("Key");
                    var variantId = NormalizeModificationVariantId(rawKey);
                    if (string.IsNullOrWhiteSpace(variantId))
                    {
                        continue;
                    }

                    var valueToken = modificationToken["Value"] as JObject;
                    var displayName = ExtractLocalizedText(
                        valueToken?["DisplayName"],
                        CreateModificationLocalizationId(structureId, variantId, "name"),
                        HumanizeCategory(variantId) ?? variantId,
                        englishStrings,
                        localizationReferencesById);
                    var description = ExtractLocalizedText(
                        valueToken?["Description"],
                        CreateModificationLocalizationId(structureId, variantId, "description"),
                        string.Empty,
                        englishStrings,
                        localizationReferencesById);
                    var tierValueToken = ResolveModificationTierValueToken(valueToken, preferredTier);
                    var cost = ExtractModificationTierCost(valueToken, preferredTier);
                    if (cost.Count == 0)
                    {
                        cost = ExtractRecipeCostFromJsonObject(valueToken);
                    }

                    var iconTextureReference = ReadObjectPath(valueToken?["Icon"] as JObject, "ResourceObject");
                    var iconTexturePath = ConvertObjectPathToPackagePath(iconTextureReference);
                    var subTypeIconReference = ReadObjectPath(valueToken?["SubTypeIcon"] as JObject, "ResourceObject");

                    variants[variantId] = new FoxWatchManifestModificationSlotVariant
                    {
                        Name = displayName,
                        CodeName = variantId,
                        Description = description,
                        IconTexturePath = iconTexturePath,
                        SubTypeIconUrl = ExportModificationSlotVariantIcon(subTypeIconReference, $"{variantId}-subtype", baseAssetsUrl, iconOutputDirectory),
                        IconUrl = ExportModificationSlotVariantIcon(iconTextureReference ?? iconTexturePath, variantId, baseAssetsUrl, iconOutputDirectory),
                        RequiredSocketConnectionMask = valueToken?["RequiredSocketConnectionMask"]?.Value<long?>(),
                        HiddenBySocketConnectionMask = valueToken?["HiddenBySocketConnectionMask"]?.Value<long?>(),
                        ShowInBuildSite = valueToken?["bShowInBuildSite"]?.Value<bool?>(),
                        BuildFootprintTemplatePath = ConvertObjectPathToPackagePath(ReadObjectPath(valueToken, "BuildFootprintTemplate")),
                        Cost = cost,
                        UseTemplateActor = tierValueToken?["bUseTemplateActor"]?.Value<bool>() == true,
                        TemplateMeshPath = ConvertObjectPathToPackagePath(ReadObjectPath(tierValueToken, "TemplateMesh")),
                        TemplateActorPath = ConvertObjectPathToPackagePath(ReadObjectPath(tierValueToken, "TemplateActor")),
                        PreviewMeshPath = ConvertObjectPathToPackagePath(ReadObjectPath(tierValueToken, "PreviewMesh")),
                    };
                }

                return variants;
            }
            catch
            {
                return new Dictionary<string, FoxWatchManifestModificationSlotVariant>(StringComparer.Ordinal);
            }
        }

        private Dictionary<string, FoxWatchManifestModificationOverlay> ResolveModificationVariantOverlays(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            string structureId,
            int? structureTier)
        {
            var modificationDataClassPath = ResolveModificationDataClassPath(objects, blueprint, structureId);
            if (string.IsNullOrWhiteSpace(modificationDataClassPath))
            {
                return new Dictionary<string, FoxWatchManifestModificationOverlay>(StringComparer.Ordinal);
            }

            var modificationSlotTransform = ResolveModificationSlotTransform(objects, blueprint, modificationDataClassPath);

            var variants = InspectModificationVariants(modificationDataClassPath, structureTier);
            if (variants.Count == 0)
            {
                return new Dictionary<string, FoxWatchManifestModificationOverlay>(StringComparer.Ordinal);
            }

            var overlays = new Dictionary<string, FoxWatchManifestModificationOverlay>(StringComparer.Ordinal);
            foreach (var variant in variants)
            {
                if (!variant.UseTemplateActor || string.IsNullOrWhiteSpace(variant.TemplateActorPath))
                {
                    continue;
                }

                var overlay = TryExtractModificationOverlay(variant.TemplateActorPath);
                if (overlay == null)
                {
                    continue;
                }

                if (modificationSlotTransform != null)
                {
                    overlay = ApplyModificationOverlayTransform(overlay, modificationSlotTransform.Value);
                }

                overlays[variant.Id] = overlay;
            }

            return overlays;
        }

        private ManifestComponentTransform? ResolveModificationSlotTransform(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            string modificationDataClassPath)
        {
            if (_meshAssetExporter != null)
            {
                try
                {
                    var componentReferences = _meshAssetExporter
                        .InspectBlueprintComponentsAsync(GetPackagePath(blueprint))
                        .GetAwaiter()
                        .GetResult();
                    var slotReference = FindModificationSlotReference(componentReferences, modificationDataClassPath);
                    if (slotReference != null)
                    {
                        return ResolveComponentReferenceTransform(slotReference, componentReferences);
                    }
                }
                catch
                {
                }
            }

            var scopes = EnumerateBlueprintComponentScopes(objects, blueprint).ToArray();
            var componentLookup = BuildComponentLookup(scopes.SelectMany(scope => scope.Objects));
            object? fallbackSlot = null;

            foreach (var scope in scopes)
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    if (!componentType.Contains("ModificationSlotComponent", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    fallbackSlot ??= item;

                    var dataClassPath = GetReferencedPackagePath(item, "DataClass");
                    if (PackagePathsEqual(dataClassPath, modificationDataClassPath))
                    {
                        return ResolveComponentTransform(item, componentLookup);
                    }
                }
            }

            return fallbackSlot != null
                ? ResolveComponentTransform(fallbackSlot, componentLookup)
                : null;
        }

        private string? ResolveModificationDataClassPath(
            IEnumerable<dynamic> objects,
            UBlueprintGeneratedClass blueprint,
            string structureId)
        {
            if (_meshAssetExporter != null)
            {
                try
                {
                    var componentReferences = _meshAssetExporter
                        .InspectBlueprintComponentsAsync(GetPackagePath(blueprint))
                        .GetAwaiter()
                        .GetResult();
                    var dataClassPath = componentReferences
                        .FirstOrDefault(reference =>
                            reference.ComponentType.Contains("ModificationSlotComponent", StringComparison.OrdinalIgnoreCase) &&
                            !string.IsNullOrWhiteSpace(reference.DataClassPath))
                        ?.DataClassPath;
                    if (!string.IsNullOrWhiteSpace(dataClassPath))
                    {
                        return dataClassPath;
                    }
                }
                catch
                {
                }
            }

            foreach (var scope in EnumerateBlueprintComponentScopes(objects, blueprint))
            {
                foreach (var item in scope.Objects)
                {
                    if (!IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))
                    {
                        continue;
                    }

                    var componentType = GetObjectTypeName(item);
                    if (!componentType.Contains("ModificationSlotComponent", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var packagePath = GetReferencedPackagePath(item, "DataClass");
                    if (!string.IsNullOrWhiteSpace(packagePath))
                    {
                        return packagePath;
                    }
                }
            }

            return InferModificationDataClassPath(GetPackagePath(blueprint));
        }

        private string? InferModificationDataClassPath(string? blueprintPackagePath)
        {
            var normalizedBlueprintPath = NormalizeString(blueprintPackagePath).Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(normalizedBlueprintPath) ||
                !normalizedBlueprintPath.StartsWith(BlueprintPackagePrefix, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var blueprintName = Path.GetFileNameWithoutExtension(normalizedBlueprintPath);
            if (string.IsNullOrWhiteSpace(blueprintName))
            {
                return null;
            }

            var candidatePath = $"{ModificationDataPackagePrefix}{blueprintName}_UpgradeSlotComponent.uasset";
            return ResolvePackagePath(candidatePath);
        }

        private string? ResolvePackagePath(string? candidatePath)
        {
            var normalizedCandidatePath = NormalizeString(candidatePath).Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(normalizedCandidatePath))
            {
                return null;
            }

            return _fileProvider.Files.ContainsKey(normalizedCandidatePath)
                ? normalizedCandidatePath
                : _fileProvider.Files.Keys.FirstOrDefault(path => string.Equals(path, normalizedCandidatePath, StringComparison.OrdinalIgnoreCase));
        }

        private List<FoxWatchManifestModificationVariantReference> InspectModificationVariants(string assetPath, int? preferredTier)
        {
            if (_meshAssetExporter != null)
            {
                try
                {
                    return _meshAssetExporter
                        .InspectModificationVariantsAsync(assetPath, preferredTier: preferredTier)
                        .GetAwaiter()
                        .GetResult()
                        .Select(variant => new FoxWatchManifestModificationVariantReference
                        {
                            Id = variant.Id,
                            UseTemplateActor = variant.UseTemplateActor,
                            TemplateActorPath = variant.TemplateActorPath,
                        })
                        .ToList();
                }
                catch
                {
                }
            }

            try
            {
                var package = _fileProvider.LoadPackage(assetPath);
                var exports = package.GetExports().ToArray();
                var exportsJson = JsonConvert.SerializeObject(exports, Formatting.None);
                var exportTokens = JArray.Parse(exportsJson);
                var defaultObjectToken = exportTokens
                    .OfType<JObject>()
                    .FirstOrDefault(token => token.Value<string>("Name")?.StartsWith("Default__", StringComparison.OrdinalIgnoreCase) == true);

                var modificationsToken = defaultObjectToken?["Properties"]?["Modifications"] as JArray;
                if (modificationsToken == null)
                {
                    return [];
                }

                var variants = new List<FoxWatchManifestModificationVariantReference>();
                foreach (var modificationToken in modificationsToken.OfType<JObject>())
                {
                    var rawKey = modificationToken.Value<string>("Key");
                    var variantId = NormalizeModificationVariantId(rawKey);
                    if (string.IsNullOrWhiteSpace(variantId))
                    {
                        continue;
                    }

                    var valueToken = modificationToken["Value"] as JObject;
                    var tierValueToken = ResolveModificationTierValueToken(valueToken, preferredTier);

                    variants.Add(new FoxWatchManifestModificationVariantReference
                    {
                        Id = variantId,
                        UseTemplateActor = tierValueToken?["bUseTemplateActor"]?.Value<bool>() == true,
                        TemplateActorPath = ConvertObjectPathToPackagePath(
                            (tierValueToken?["TemplateActor"] as JObject)?["ObjectPath"]?.Value<string>()),
                    });
                }

                return variants;
            }
            catch
            {
                return [];
            }
        }

        private static JObject? ResolveModificationTierValueToken(JObject? valueToken, int? preferredTier)
        {
            var tierEntries = valueToken?["Tiers"]?
                .OfType<JObject>()
                .ToList();
            if (tierEntries == null || tierEntries.Count == 0)
            {
                return null;
            }

            if (preferredTier.HasValue)
            {
                var matchingEntry = tierEntries.FirstOrDefault(entry => ModificationTierMatches(entry["Key"], preferredTier.Value));
                if (matchingEntry?["Value"] is JObject matchingValue)
                {
                    return matchingValue;
                }
            }

            return tierEntries
                .Select(entry => entry["Value"] as JObject)
                .FirstOrDefault(entry => entry != null);
        }

        private static bool ModificationTierMatches(JToken? keyToken, int preferredTier)
        {
            if (keyToken == null)
            {
                return false;
            }

            if (keyToken.Type == JTokenType.Integer)
            {
                return keyToken.Value<int>() == preferredTier;
            }

            var key = keyToken.Type == JTokenType.String
                ? keyToken.Value<string>()
                : keyToken["Value"]?.Value<string>()
                    ?? keyToken["Name"]?.Value<string>()
                    ?? keyToken["EnumName"]?.Value<string>()
                    ?? keyToken.ToString(Formatting.None);
            if (string.IsNullOrWhiteSpace(key))
            {
                return false;
            }

            if (int.TryParse(key, out var numericTier))
            {
                return numericTier == preferredTier;
            }

            var digits = new string(key.Where(char.IsDigit).ToArray());
            return int.TryParse(digits, out numericTier) && numericTier == preferredTier;
        }

        private FoxWatchManifestModificationOverlay? TryExtractModificationOverlay(string templateActorPath)
        {
            if (_meshAssetExporter != null)
            {
                try
                {
                    var componentReferences = _meshAssetExporter
                        .InspectBlueprintComponentsAsync(templateActorPath)
                        .GetAwaiter()
                        .GetResult();
                    var sockets = componentReferences
                        .Select(reference => CreateBuildSocketFromComponentReference(reference, componentReferences))
                        .Where(socket => socket != null)
                        .Cast<FoxWatchManifestBuildSocket>()
                        .ToList();
                    if (sockets.Count > 0)
                    {
                        return new FoxWatchManifestModificationOverlay
                        {
                            BuildSockets = sockets,
                            FootprintPolygons = [],
                        };
                    }
                }
                catch
                {
                }
            }

            try
            {
                var package = _fileProvider.LoadPackage(templateActorPath);
                var exports = package.GetExports().Cast<dynamic>().ToArray();
                var blueprint = exports.OfType<UBlueprintGeneratedClass>().FirstOrDefault();
                if (blueprint == null)
                {
                    return null;
                }

                var sockets = ExtractBuildSockets(exports, blueprint, exports[0]);
                var boxes = ExtractBuildFootprintBoxes(exports, blueprint, exports[0]);
                return new FoxWatchManifestModificationOverlay
                {
                    BuildSockets = sockets,
                    FootprintPolygons = BuildFootprintPolygons(boxes),
                };
            }
            catch
            {
                return null;
            }
        }

        private FoxWatchManifestBuildSocket? CreateBuildSocketFromComponentReference(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            var componentType = NormalizeManifestBuildSocketComponentType(NormalizeString(componentReference.ComponentType));
            var componentName = NormalizeString(componentReference.ComponentName);
            if (!IsManifestBuildSocketComponentType(componentType, componentName))
            {
                return null;
            }

            var pipeType = InferPipeType(componentReference);
            if (!LooksLikeManifestBuildSocket(componentType, componentName, hasSocketTags: false, pipeType))
            {
                return null;
            }

            var transform = ResolveComponentReferenceTransform(componentReference, componentReferences);

            var socket = new FoxWatchManifestBuildSocket
            {
                Name = componentName,
                ComponentType = componentType,
                PipeType = pipeType,
                SocketTags =
                [
                    .. componentReference.SocketTags.Select(tag => new FoxWatchManifestSocketTag
                    {
                        Mask = tag.Mask,
                        Category = tag.Category,
                    })
                ],
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Rotation = transform.YawDegrees,
            };
            EnsureFacilityLiquidPipeSocketTags(socket);
            return socket;
        }

        private static void EnsureFacilityLiquidPipeSocketTags(FoxWatchManifestBuildSocket socket)
        {
            if (socket.SocketTags.Count > 0 || !IsFacilityLiquidPipeSocket(socket))
            {
                return;
            }

            // Facility liquid inputs/outputs snap against pipe-network sockets via cross-bit
            // mask/category overlap. Game data often omits SocketTags on PipelineOutput CDOs.
            socket.SocketTags.Add(new FoxWatchManifestSocketTag
            {
                Mask = FacilityLiquidPipeSocketMask,
                Category = FacilityLiquidPipeSocketCategory,
            });
        }

        private static bool IsFacilityLiquidPipeSocket(FoxWatchManifestBuildSocket socket)
        {
            if (string.Equals(socket.PipeType, "Input", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(socket.PipeType, "Output", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            var componentType = socket.ComponentType ?? string.Empty;
            var componentName = socket.Name ?? string.Empty;
            return componentType.Contains("PipelineInput", StringComparison.OrdinalIgnoreCase) ||
                componentType.Contains("PipelineOutput", StringComparison.OrdinalIgnoreCase) ||
                componentName.Contains("PipeInput", StringComparison.OrdinalIgnoreCase) ||
                componentName.Contains("PipeOutput", StringComparison.OrdinalIgnoreCase);
        }

        private bool HasInheritedComponentRelativeLocation(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component)
        {
            if (GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "RelativeLocation") != null)
            {
                return true;
            }

            if (GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "RelativeRotation") != null)
            {
                return true;
            }

            // Only allow fallback for non-crane components
            var componentType = GetObjectTypeName(component);
            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            if (!IsCraneSpawnComponent(componentType, componentName))
            {
                return !string.IsNullOrWhiteSpace(ResolveAttachParentName(component));
            }

            // For cranes, require actual RelativeLocation/Rotation
            return false;
        }

        private static bool HasComponentReferenceRelativeLocation(FoxWatchBlueprintComponentReference componentReference)
        {
            return !string.IsNullOrWhiteSpace(componentReference.RelativeLocation)
                || !string.IsNullOrWhiteSpace(componentReference.AbsoluteLocation);
        }

        private static string? InferPipeType(FoxWatchBlueprintComponentReference componentReference)
        {
            var haystack = $"{componentReference.ComponentType} {componentReference.ComponentName}";
            if (haystack.Contains("PipelineInput", StringComparison.OrdinalIgnoreCase) ||
                haystack.Contains("PipeInput", StringComparison.OrdinalIgnoreCase))
            {
                return "Input";
            }

            if (haystack.Contains("PipelineOutput", StringComparison.OrdinalIgnoreCase) ||
                haystack.Contains("PipeOutput", StringComparison.OrdinalIgnoreCase))
            {
                return "Output";
            }

            return null;
        }

        private static bool IsManifestBuildSocketComponentType(string? componentType, string? componentName = null)
        {
            if (string.IsNullOrWhiteSpace(componentType) && string.IsNullOrWhiteSpace(componentName))
            {
                return false;
            }

            return (!string.IsNullOrWhiteSpace(componentType) && (
                    componentType.Contains("BuildSocketComponent", StringComparison.OrdinalIgnoreCase)
                    || componentType.Contains("PipelineInput", StringComparison.OrdinalIgnoreCase)
                    || componentType.Contains("PipelineOutput", StringComparison.OrdinalIgnoreCase)
                    || componentType.Contains("SceneComponent", StringComparison.OrdinalIgnoreCase)
                    || componentType.Contains("ArrowComponent", StringComparison.OrdinalIgnoreCase)))
                || (!string.IsNullOrWhiteSpace(componentName)
                    && componentName.Contains("Socket", StringComparison.OrdinalIgnoreCase));
        }

        private static bool LooksLikeManifestBuildSocket(
            string? componentType,
            string? componentName,
            bool hasSocketTags,
            string? pipeType)
        {
            if (hasSocketTags || !string.IsNullOrWhiteSpace(pipeType))
            {
                return true;
            }

            return (!string.IsNullOrWhiteSpace(componentType) && (
                    componentType.Contains("Socket", StringComparison.OrdinalIgnoreCase)
                    || componentType.Contains("Pipeline", StringComparison.OrdinalIgnoreCase)))
                || (!string.IsNullOrWhiteSpace(componentName) && (
                    componentName.Contains("Socket", StringComparison.OrdinalIgnoreCase)
                    || componentName.Contains("Pipe", StringComparison.OrdinalIgnoreCase)));
        }

        private static FoxWatchBlueprintComponentReference? FindModificationSlotReference(
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
            string modificationDataClassPath)
        {
            FoxWatchBlueprintComponentReference? fallbackSlot = null;
            foreach (var componentReference in componentReferences)
            {
                if (!componentReference.ComponentType.Contains("ModificationSlotComponent", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                fallbackSlot ??= componentReference;
                if (PackagePathsEqual(componentReference.DataClassPath, modificationDataClassPath))
                {
                    return componentReference;
                }
            }

            return fallbackSlot;
        }

        private static FoxWatchManifestModificationOverlay ApplyModificationOverlayTransform(
            FoxWatchManifestModificationOverlay overlay,
            ManifestComponentTransform slotTransform)
        {
            return new FoxWatchManifestModificationOverlay
            {
                BuildSockets = overlay.BuildSockets
                    .Select(socket => TransformBuildSocket(socket, slotTransform))
                    .ToList(),
                FootprintPolygons = overlay.FootprintPolygons
                    .Select(polygon => TransformHitPolygon(polygon, slotTransform))
                    .ToList(),
            };
        }

        private static FoxWatchManifestBuildSocket TransformBuildSocket(
            FoxWatchManifestBuildSocket socket,
            ManifestComponentTransform slotTransform)
        {
            var composedTransform = ComposeComponentTransforms(
                slotTransform,
                CreateComponentTransform(
                    socket.X ?? 0,
                    socket.Y ?? 0,
                    socket.Z ?? 0,
                    yawDegrees: socket.Rotation ?? 0));

            return new FoxWatchManifestBuildSocket
            {
                Name = socket.Name,
                ComponentType = socket.ComponentType,
                PipeType = socket.PipeType,
                SocketTags = socket.SocketTags
                    .Select(tag => new FoxWatchManifestSocketTag
                    {
                        Mask = tag.Mask,
                        Category = tag.Category,
                    })
                    .ToList(),
                X = composedTransform.X,
                Y = composedTransform.Y,
                Z = composedTransform.Z,
                Rotation = composedTransform.YawDegrees,
            };
        }

        private static FoxWatchManifestHitPolygon TransformHitPolygon(
            FoxWatchManifestHitPolygon polygon,
            ManifestComponentTransform slotTransform)
        {
            if (polygon.Shape == null || polygon.Shape.Count < 2)
            {
                return CloneHitPolygon(polygon);
            }

            var radians = slotTransform.YawDegrees * (Math.PI / 180.0);
            var cosine = Math.Cos(radians);
            var sine = Math.Sin(radians);
            var translateX = slotTransform.X / UnrealUnitsPerMeter;
            var translateY = slotTransform.Y / UnrealUnitsPerMeter;
            var shape = new List<double>(polygon.Shape.Count);

            for (var index = 0; index + 1 < polygon.Shape.Count; index += 2)
            {
                var x = polygon.Shape[index];
                var y = polygon.Shape[index + 1];
                var rotatedX = (x * cosine) - (y * sine);
                var rotatedY = (x * sine) + (y * cosine);
                shape.Add(Math.Round(translateX + rotatedX, 3));
                shape.Add(Math.Round(translateY + rotatedY, 3));
            }

            return new FoxWatchManifestHitPolygon
            {
                Shape = shape,
            };
        }

        private static double? ParseVectorValue(string? text, string axisName)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return null;
            }

            var match = VectorPattern.Match(text);
            if (!match.Success)
            {
                return null;
            }

            return double.TryParse(match.Groups[axisName].Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : null;
        }

        private static double? ParseRotatorValue(string? text, string componentName)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return null;
            }

            var match = RotatorPattern.Match(text);
            if (!match.Success)
            {
                return null;
            }

            return double.TryParse(match.Groups[componentName].Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : null;
        }

        private static List<FoxWatchManifestBuildSocket> ExtractNestedBuildSockets(object? value)
        {
            var components = AsEnumerable(GetNamedValue(value, "Sockets")).ToArray();
            var componentLookup = BuildComponentLookup(components);

            return components
                .Select(component => ExtractBuildSocketWithoutInheritedLocation(component, componentLookup))
                .Where(entry => entry != null)
                .Cast<FoxWatchManifestBuildSocket>()
                .ToList();
        }

        private static FoxWatchManifestBuildSocket? ExtractBuildSocketWithoutInheritedLocation(
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var componentType = GetObjectTypeName(component);
            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            if (!IsManifestBuildSocketComponentType(componentType, componentName))
            {
                return null;
            }

            if (GetNamedValue(component, "RelativeLocation") == null)
            {
                return null;
            }

            var socketTags = ExtractSocketTags(GetNamedValue(component, "SocketTags"));
            var pipeType = NormalizeEnumValue(GetNamedValue(GetNamedValue(component, "PipeInfo"), "Type"));

            if (!LooksLikeManifestBuildSocket(componentType, componentName, socketTags.Count > 0, pipeType))
            {
                return null;
            }

            var transform = ResolveComponentTransform(component, componentLookup);

            var socket = new FoxWatchManifestBuildSocket
            {
                Name = componentName,
                ComponentType = componentType,
                PipeType = pipeType,
                SocketTags = socketTags,
                X = transform.X,
                Y = transform.Y,
                Z = transform.Z,
                Rotation = transform.YawDegrees,
            };
            EnsureFacilityLiquidPipeSocketTags(socket);
            return socket;
        }

        private static List<FoxWatchManifestBuildFootprintBox> ExtractNestedBuildFootprintBoxes(object? value)
        {
            var components = AsEnumerable(GetNamedValue(value, "BuildFootprintBoxes")).ToArray();
            var componentLookup = BuildComponentLookup(components);

            return components
                .Select(component => ExtractBuildFootprintBox(component, componentLookup))
                .Where(entry => entry != null)
                .Cast<FoxWatchManifestBuildFootprintBox>()
                .ToList();
        }

        private static FoxWatchLocalizedText CreateLocalizedText(string id, string fallback, IDictionary<string, string> englishStrings)
        {
            englishStrings[id] = fallback;
            return new FoxWatchLocalizedText
            {
                Id = id,
                Fallback = fallback,
            };
        }

        private static string CreateModificationLocalizationId(string structureId, string modificationId, string field)
        {
            var normalizedField = string.Equals(field, "description", StringComparison.OrdinalIgnoreCase)
                ? "desc"
                : "name";
            return $"asset:{NormalizeString(structureId).ToLowerInvariant()}:mod:{NormalizeModificationVariantId(modificationId)}:{normalizedField}";
        }

        private static string CreateStructureLocalizationId(string structureId, string field)
        {
            var normalizedField = string.Equals(field, "description", StringComparison.OrdinalIgnoreCase)
                || string.Equals(field, "desc", StringComparison.OrdinalIgnoreCase)
                ? "desc"
                : "name";
            return $"asset:{NormalizeString(structureId).ToLowerInvariant()}:{normalizedField}";
        }

        private static string ExtractLocalizedText(
            object? value,
            string localizationId,
            string fallback,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            return value switch
            {
                FText text => ExtractLocalizedText(text, localizationId, fallback, englishStrings, localizationReferencesById),
                JToken token => ExtractLocalizedText(token, localizationId, fallback, englishStrings, localizationReferencesById),
                _ => CreateLocalizedFallback(localizationId, NormalizeLocalizedText(ExtractText(value)) ?? fallback, englishStrings),
            };
        }

        private static string ExtractLocalizedText(
            FText? text,
            string localizationId,
            string fallback,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            var normalizedFallback = NormalizeLocalizedText(text?.Text) ?? fallback;
            englishStrings[localizationId] = normalizedFallback;

            if (text?.TextHistory is FTextHistory.Base history &&
                !string.IsNullOrWhiteSpace(history.Key))
            {
                localizationReferencesById[localizationId] = new FoxWatchLocalizationReference
                {
                    Id = localizationId,
                    Namespace = history.Namespace,
                    Key = history.Key,
                    Source = normalizedFallback,
                };
            }

            return normalizedFallback;
        }

        private static string ExtractLocalizedText(
            JToken? token,
            string localizationId,
            string fallback,
            IDictionary<string, string> englishStrings,
            IDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            if (token == null)
            {
                return CreateLocalizedFallback(localizationId, fallback, englishStrings);
            }

            var normalizedFallback = NormalizeLocalizedText(token.Type == JTokenType.String
                ? token.Value<string>()
                : token["LocalizedString"]?.Value<string>()
                    ?? token["SourceString"]?.Value<string>()
                    ?? token["Text"]?.Value<string>()
                    ?? token["Value"]?.Value<string>())
                ?? fallback;
            englishStrings[localizationId] = normalizedFallback;

            var historyToken = token["TextHistory"] ?? token["History"];
            var key = NormalizeLocalizedText(
                token["Key"]?.Value<string>()
                ?? historyToken?["Key"]?.Value<string>()
                ?? historyToken?["Base"]?["Key"]?.Value<string>());
            if (!string.IsNullOrWhiteSpace(key))
            {
                localizationReferencesById[localizationId] = new FoxWatchLocalizationReference
                {
                    Id = localizationId,
                    Namespace = NormalizeLocalizedText(
                        token["Namespace"]?.Value<string>()
                        ?? historyToken?["Namespace"]?.Value<string>()
                        ?? historyToken?["Base"]?["Namespace"]?.Value<string>())
                        ?? string.Empty,
                    Key = key,
                    Source = normalizedFallback,
                };
            }

            return normalizedFallback;
        }

        private static string CreateLocalizedFallback(string localizationId, string fallback, IDictionary<string, string> englishStrings)
        {
            var normalizedFallback = NormalizeLocalizedText(fallback) ?? string.Empty;
            englishStrings[localizationId] = normalizedFallback;
            return normalizedFallback;
        }

        private List<FoxWatchLocalizationBundle> BuildLocalizationBundles(
            IDictionary<string, string> englishStrings,
            IReadOnlyDictionary<string, FoxWatchLocalizationReference> localizationReferencesById)
        {
            var bundlesByLocale = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase)
            {
                ["en"] = new Dictionary<string, string>(englishStrings, StringComparer.Ordinal),
            };

            if (localizationReferencesById.Count == 0)
            {
                return bundlesByLocale
                    .OrderBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase)
                    .Select(entry => new FoxWatchLocalizationBundle
                    {
                        Locale = entry.Key,
                        Strings = entry.Value,
                    })
                    .ToList();
            }

            var localizationTablesByLocale = LoadLocalizationTablesByLocale();
            foreach (var culture in localizationTablesByLocale.Keys
                         .Where(value => !string.IsNullOrWhiteSpace(value))
                         .Distinct(StringComparer.OrdinalIgnoreCase)
                         .OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
            {
                if (string.Equals(culture, "en", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var localizedEntries = localizationTablesByLocale[culture];

                foreach (var reference in localizationReferencesById.Values)
                {
                    if (!TryResolveLocalizedValue(localizedEntries, reference, out var localizedValue))
                    {
                        continue;
                    }

                    if (string.IsNullOrWhiteSpace(localizedValue) ||
                        string.Equals(localizedValue, reference.Source, StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var bundle = bundlesByLocale.GetValueOrDefault(culture);
                    if (bundle == null)
                    {
                        bundle = new Dictionary<string, string>(StringComparer.Ordinal);
                        bundlesByLocale[culture] = bundle;
                    }

                    bundle[reference.Id] = localizedValue;
                }
            }

            return bundlesByLocale
                .Where(entry => entry.Value.Count > 0)
                .OrderBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase)
                .Select(entry => new FoxWatchLocalizationBundle
                {
                    Locale = entry.Key,
                    Strings = entry.Value,
                })
                .ToList();
        }

        private Dictionary<string, Dictionary<string, Dictionary<string, string>>> LoadLocalizationTablesByLocale()
        {
            var tablesByLocale = new Dictionary<string, Dictionary<string, Dictionary<string, string>>>(StringComparer.OrdinalIgnoreCase);

            foreach (var file in _fileProvider.Files)
            {
                if (!string.Equals(file.Value.Extension, "locres", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (!TryGetLocalizationCulture(file.Key, out var culture))
                {
                    continue;
                }

                if (!file.Value.TryCreateReader(out var archive))
                {
                    continue;
                }

                var localeTables = tablesByLocale.GetValueOrDefault(culture);
                if (localeTables == null)
                {
                    localeTables = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
                    tablesByLocale[culture] = localeTables;
                }

                var locres = new FTextLocalizationResource(archive);
                foreach (var namespaceEntries in locres.Entries)
                {
                    var namespaceKey = namespaceEntries.Key.Str ?? string.Empty;
                    var keyTable = localeTables.GetValueOrDefault(namespaceKey);
                    if (keyTable == null)
                    {
                        keyTable = new Dictionary<string, string>(StringComparer.Ordinal);
                        localeTables[namespaceKey] = keyTable;
                    }

                    foreach (var entry in namespaceEntries.Value)
                    {
                        var key = entry.Key.Str ?? string.Empty;
                        keyTable[key] = entry.Value.LocalizedString;
                    }
                }
            }

            return tablesByLocale;
        }

        private static bool TryGetLocalizationCulture(string path, out string culture)
        {
            foreach (var root in LocalizationRoots)
            {
                if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var relativePath = path[root.Length..];
                var separatorIndex = relativePath.IndexOf('/');
                if (separatorIndex <= 0)
                {
                    break;
                }

                culture = relativePath[..separatorIndex].Trim();
                return !string.IsNullOrWhiteSpace(culture);
            }

            culture = string.Empty;
            return false;
        }

        private static bool TryResolveLocalizedValue(
            IReadOnlyDictionary<string, Dictionary<string, string>> localizedEntries,
            FoxWatchLocalizationReference reference,
            out string? localizedValue)
        {
            if (localizedEntries.TryGetValue(reference.Namespace, out var namespaceEntries) &&
                namespaceEntries.TryGetValue(reference.Key, out var exactMatch))
            {
                localizedValue = NormalizeLocalizedText(exactMatch);
                return !string.IsNullOrWhiteSpace(localizedValue);
            }

            if (string.IsNullOrEmpty(reference.Namespace))
            {
                foreach (var fallbackNamespaceEntries in localizedEntries.Values)
                {
                    if (fallbackNamespaceEntries.TryGetValue(reference.Key, out var fallbackMatch))
                    {
                        localizedValue = NormalizeLocalizedText(fallbackMatch);
                        return !string.IsNullOrWhiteSpace(localizedValue);
                    }
                }
            }

            localizedValue = null;
            return false;
        }

        private static string NormalizeCategoryToken(string value)
        {
            var normalized = NormalizeString(value.Split("::").LastOrDefault())
                .Replace(" ", string.Empty, StringComparison.Ordinal);
            return string.IsNullOrWhiteSpace(normalized) ? "new" : normalized.ToLowerInvariant();
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

        private static int ExtractInt(object? value)
        {
            if (value == null)
            {
                return 0;
            }

            if (value is byte byteValue)
            {
                return byteValue;
            }

            if (value is int intValue)
            {
                return intValue;
            }

            var text = ExtractText(value);
            return int.TryParse(text, out int parsed) ? parsed : 0;
        }

        private static int? ExtractNullableInt(object? value)
        {
            if (value == null)
            {
                return null;
            }

            if (value is byte byteValue)
            {
                return byteValue;
            }

            if (value is int intValue)
            {
                return intValue;
            }

            if (value is long longValue && longValue <= int.MaxValue && longValue >= int.MinValue)
            {
                return (int)longValue;
            }

            var text = ExtractText(value);
            return int.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : null;
        }

        private static long? ExtractNullableLong(object? value)
        {
            if (value == null)
            {
                return null;
            }

            if (value is long longValue)
            {
                return longValue;
            }

            if (value is int intValue)
            {
                return intValue;
            }

            var text = ExtractText(value);
            return long.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : null;
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

        private static bool? ExtractBoolValue(object? value)
        {
            if (value == null)
            {
                return null;
            }

            if (value is bool boolValue)
            {
                return boolValue;
            }

            var text = ExtractText(value);
            return bool.TryParse(text, out var parsed) ? parsed : null;
        }

        private static double? ExtractVectorComponent(object? value, string propertyName)
        {
            return ExtractDouble(GetNamedValue(value, propertyName));
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

        private static string NormalizeEnumValue(object? value)
        {
            var text = NormalizeString(ExtractText(value));
            if (string.IsNullOrWhiteSpace(text))
            {
                return string.Empty;
            }

            var parts = text.Split("::", StringSplitOptions.RemoveEmptyEntries);
            return parts.Length == 0 ? text : NormalizeString(parts[^1]);
        }

        private static string NormalizeModificationVariantId(string? rawKey)
        {
            if (string.IsNullOrWhiteSpace(rawKey))
            {
                return string.Empty;
            }

            var normalized = rawKey;
            var separatorIndex = normalized.LastIndexOf("::", StringComparison.Ordinal);
            if (separatorIndex >= 0 && separatorIndex + 2 < normalized.Length)
            {
                normalized = normalized[(separatorIndex + 2)..];
            }

            return string.Concat(normalized
                .Where(char.IsLetterOrDigit)
                .Select(char.ToLowerInvariant));
        }

        private static string? GetReferencedPackagePath(object? source, string propertyName)
        {
            var resolvedValue = GetNamedValue(source, propertyName);
            if (resolvedValue == null)
            {
                return null;
            }

            var getPathNameMethod = resolvedValue.GetType().GetMethod("GetPathName", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (getPathNameMethod != null)
            {
                try
                {
                    var path = getPathNameMethod.Invoke(resolvedValue, null) as string;
                    var packagePath = ConvertObjectPathToPackagePath(path);
                    if (!string.IsNullOrWhiteSpace(packagePath))
                    {
                        return packagePath;
                    }
                }
                catch
                {
                }
            }

            var objectPath = GetNamedValue(resolvedValue, "ObjectPath");
            var normalizedObjectPath = ConvertObjectPathToPackagePath(ExtractText(objectPath));
            if (!string.IsNullOrWhiteSpace(normalizedObjectPath))
            {
                return normalizedObjectPath;
            }

            return ConvertObjectPathToPackagePath(ExtractText(resolvedValue));
        }

        private static string? ConvertObjectPathToPackagePath(string? objectPath)
        {
            if (string.IsNullOrWhiteSpace(objectPath))
            {
                return null;
            }

            var normalized = objectPath.Replace('\\', '/').Trim();
            var firstQuoteIndex = normalized.IndexOf('\'');
            var lastQuoteIndex = normalized.LastIndexOf('\'');
            if (firstQuoteIndex >= 0 && lastQuoteIndex > firstQuoteIndex)
            {
                normalized = normalized[(firstQuoteIndex + 1)..lastQuoteIndex];
            }

            var separatorIndex = normalized.LastIndexOf('.');
            if (separatorIndex > 0)
            {
                normalized = normalized[..separatorIndex];
            }

            return normalized.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase)
                ? normalized
                : $"{normalized}.uasset";
        }

        private static string? ReadObjectPath(JObject? parentToken, string propertyName)
        {
            return parentToken?[propertyName] is JObject propertyToken
                ? propertyToken["ObjectPath"]?.Value<string>()
                : null;
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
                    string.Equals(method.Name, "GetOrDefault", StringComparison.Ordinal) &&
                    method.IsGenericMethodDefinition &&
                    method.GetParameters().Length >= 1 &&
                    method.GetParameters()[0].ParameterType == typeof(string));
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

            var tryGetValueMethod = runtimeType
                .GetMethods(BindingFlags.Public | BindingFlags.Instance)
                .FirstOrDefault(method =>
                    string.Equals(method.Name, "TryGetValue", StringComparison.Ordinal) &&
                    method.IsGenericMethodDefinition &&
                    method.GetParameters().Length == 2 &&
                    method.GetParameters()[1].ParameterType == typeof(string));
            if (tryGetValueMethod != null)
            {
                try
                {
                    var genericMethod = tryGetValueMethod.MakeGenericMethod(typeof(object));
                    var args = new object?[] { null, propertyName };
                    var success = genericMethod.Invoke(source, args);
                    if (success is true && args[0] != null)
                    {
                        return args[0];
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
                var nestedValue = GetNamedValueFromContainer(propertiesContainer, propertyName);
                if (nestedValue != null)
                {
                    return nestedValue;
                }
            }

            return null;
        }

        private static object? GetNamedValueFromContainer(object source, string propertyName)
        {
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

            var runtimeType = source.GetType();
            var property = runtimeType.GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (property != null)
            {
                return UnwrapScriptValue(property.GetValue(source));
            }

            var field = runtimeType.GetField(propertyName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            return UnwrapScriptValue(field?.GetValue(source));
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

        private static IEnumerable<object> AsEnumerable(object? value)
        {
            if (value is null || value is string)
            {
                yield break;
            }

            if (value is UScriptArray scriptArray)
            {
                foreach (var property in scriptArray.Properties)
                {
                    var resolved = UnwrapScriptValue(property.GetValue(typeof(object)));
                    if (resolved != null)
                    {
                        yield return resolved;
                    }
                }

                yield break;
            }

            if (value is UScriptMap scriptMap)
            {
                foreach (var entry in scriptMap.Properties)
                {
                    yield return new FoxWatchScriptMapEntry
                    {
                        Key = UnwrapScriptValue(entry.Key.GetValue(typeof(object))),
                        Value = UnwrapScriptValue(entry.Value?.GetValue(typeof(object))),
                    };
                }

                yield break;
            }

            if (value is IEnumerable enumerable)
            {
                foreach (var entry in enumerable)
                {
                    if (entry != null)
                    {
                        var resolved = UnwrapScriptValue(entry);
                        if (resolved != null)
                        {
                            yield return resolved;
                        }
                    }
                }
            }
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

        private static string HumanizeCategory(string categoryToken)
        {
            if (string.IsNullOrWhiteSpace(categoryToken))
            {
                return "Misc";
            }

            var spaced = string.Concat(categoryToken.Select((character, index) =>
                index > 0 && char.IsUpper(character)
                    ? $" {character}"
                    : character.ToString()
            ));
            return CultureInfo.InvariantCulture.TextInfo.ToTitleCase(spaced);
        }

        private static string NormalizeString(string? value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        private static IReadOnlyDictionary<string, object> BuildComponentLookup(IEnumerable<object> objects)
        {
            var lookup = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (var component in objects)
            {
                foreach (var key in GetComponentLookupKeys(component))
                {
                    lookup.TryAdd(key, component);
                }
            }

            return lookup;
        }

        private static IEnumerable<string> GetComponentLookupKeys(object component)
        {
            var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            void add(string? rawValue)
            {
                var normalized = NormalizeComponentReferenceName(rawValue);
                if (!string.IsNullOrWhiteSpace(normalized))
                {
                    keys.Add(normalized);
                }
            }

            add(ExtractText(GetNamedValue(component, "Name")));
            add(ExtractText(GetNamedValue(component, "ObjectName")));
            add(ExtractText(GetNamedValue(component, "ObjectPath")));

            return keys;
        }

        private static ManifestComponentTransform ResolveComponentTransform(
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            return ResolveComponentTransform(component, componentLookup, new HashSet<string>(StringComparer.OrdinalIgnoreCase));
        }

        private static ManifestComponentTransform ResolveComponentTransform(
            object component,
            IReadOnlyDictionary<string, object> componentLookup,
            ISet<string> ancestry)
        {
            var localTransform = ExtractLocalComponentTransform(component);
            var componentName = GetComponentLookupKeys(component).FirstOrDefault();
            var addedToAncestry = !string.IsNullOrWhiteSpace(componentName) && ancestry.Add(componentName);

            try
            {
                var parentName = ResolveAttachParentName(component);
                if (string.IsNullOrWhiteSpace(parentName) ||
                    ancestry.Contains(parentName) ||
                    !componentLookup.TryGetValue(parentName, out var parentComponent))
                {
                    return localTransform;
                }

                var parentTransform = ResolveComponentTransform(parentComponent, componentLookup, ancestry);
                return ComposeComponentTransforms(parentTransform, localTransform);
            }
            finally
            {
                if (addedToAncestry)
                {
                    ancestry.Remove(componentName!);
                }
            }
        }

        private ManifestComponentTransform ResolveCorrectedComponentTransform(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var transform = ResolveComponentTransform(component, componentLookup);
            return ApplyKnownBlueprintFrameCorrections(rootObjects, blueprint, component, componentLookup, transform);
        }

        private ManifestComponentTransform ApplyKnownBlueprintFrameCorrections(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup,
            ManifestComponentTransform transform)
        {
            if (TryResolveKnownComponentCharacterMeshYawOffset(
                    rootObjects,
                    blueprint,
                    component,
                    componentLookup,
                    out var yawOffsetDegrees))
            {
                if (!componentLookup.TryGetValue("CharacterMesh0", out var characterMeshComponent))
                {
                    return transform;
                }

                var pivotTransform = ResolveComponentTransform(characterMeshComponent, componentLookup);
                return RotateComponentTransformAroundPivot(transform, pivotTransform.X, pivotTransform.Y, yawOffsetDegrees);
            }

            if (TryResolveKnownRootSpotlightYawOffset(
                    rootObjects,
                    blueprint,
                    component,
                    componentLookup,
                    out yawOffsetDegrees))
            {
                if (!componentLookup.TryGetValue("CharacterMesh0", out var characterMeshComponent))
                {
                    return transform;
                }

                var pivotTransform = ResolveComponentTransform(characterMeshComponent, componentLookup);
                return RotateComponentTransformAroundPivot(transform, pivotTransform.X, pivotTransform.Y, yawOffsetDegrees);
            }

            return transform;
        }

        private bool TryResolveKnownComponentCharacterMeshYawOffset(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup,
            out double yawOffsetDegrees)
        {
            yawOffsetDegrees = 0;

            if (!TryGetVehicleBodyFrameCorrection(rootObjects, blueprint, componentLookup, out var frameCorrection))
            {
                return false;
            }

            yawOffsetDegrees = frameCorrection.YawOffsetDegrees;
            return frameCorrection.ApplicableAncestorNames.Any(ancestorName =>
                IsComponentAttachedToAncestor(component, componentLookup, ancestorName));
        }

        private bool TryResolveKnownRootSpotlightYawOffset(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup,
            out double yawOffsetDegrees)
        {
            yawOffsetDegrees = 0;

            if (!NormalizeString(GetObjectTypeName(component)).Contains("SpotLightComponent", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var normalizedAttachParentName = NormalizeComponentReferenceName(ResolveInheritedAttachParentName(rootObjects, blueprint, component));
            if (!string.IsNullOrWhiteSpace(normalizedAttachParentName) &&
                !string.Equals(normalizedAttachParentName, "None", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return TryResolveKnownVehicleBodyYawOffset(rootObjects, blueprint, componentLookup, out yawOffsetDegrees);
        }

        private bool TryResolveKnownVehicleBodyYawOffset(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            IReadOnlyDictionary<string, object> componentLookup,
            out double yawOffsetDegrees)
        {
            if (TryGetVehicleBodyFrameCorrection(rootObjects, blueprint, componentLookup, out var frameCorrection))
            {
                yawOffsetDegrees = frameCorrection.YawOffsetDegrees;
                return true;
            }

            yawOffsetDegrees = 0;
            return false;
        }

        private bool TryGetVehicleBodyFrameCorrection(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            IReadOnlyDictionary<string, object> componentLookup,
            out VehicleBodyFrameCorrection frameCorrection)
        {
            var blueprintPackagePath = GetPackagePath(blueprint);
            if (!string.IsNullOrWhiteSpace(blueprintPackagePath) &&
                _vehicleBodyFrameCorrectionsByPackagePath.TryGetValue(blueprintPackagePath, out var cachedCorrection))
            {
                frameCorrection = cachedCorrection!;
                return frameCorrection != null;
            }

                var componentReferences = BuildVehicleBodyFrameResolverReferences(rootObjects, blueprint, componentLookup);
            if (FoxWatchVehicleBodyFrameResolver.TryResolveQuarterTurnVehicleBodyYawOffset(
                    componentReferences,
                    out _,
                    out var yawOffsetDegrees))
            {
                var applicableAncestorNames = EnumerateKnownVehicleBodyFrameCorrectionAncestors(componentReferences)
                    .Select(NormalizeComponentReferenceName)
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                frameCorrection = new VehicleBodyFrameCorrection(yawOffsetDegrees, applicableAncestorNames);
                if (!string.IsNullOrWhiteSpace(blueprintPackagePath))
                {
                    _vehicleBodyFrameCorrectionsByPackagePath[blueprintPackagePath] = frameCorrection;
                }

                return true;
            }

            frameCorrection = null!;
            if (!string.IsNullOrWhiteSpace(blueprintPackagePath))
            {
                _vehicleBodyFrameCorrectionsByPackagePath[blueprintPackagePath] = null;
            }

            return false;
        }

        private List<FoxWatchBlueprintComponentReference> BuildVehicleBodyFrameResolverReferences(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            var componentReferences = new List<FoxWatchBlueprintComponentReference>(componentLookup.Count);

            foreach (var entry in componentLookup)
            {
                var component = entry.Value;
                var componentName = GetComponentLookupKeys(component).FirstOrDefault() ?? entry.Key;
                var relativeLocation = ResolveInheritedTransformProperty(
                    rootObjects,
                    blueprint,
                    component,
                    "RelativeLocation",
                    value => IsIdentityTransformVector(value));
                var relativeRotation = ResolveInheritedTransformProperty(
                    rootObjects,
                    blueprint,
                    component,
                    "RelativeRotation",
                    value => IsIdentityTransformRotator(value));

                componentReferences.Add(new FoxWatchBlueprintComponentReference
                {
                    ComponentName = componentName,
                    ComponentType = GetObjectTypeName(component),
                    MeshPath = GetReferencedPackagePath(component, "SkeletalMesh")
                        ?? GetReferencedPackagePath(component, "StaticMesh")
                        ?? string.Empty,
                    AttachParentName = ResolveInheritedAttachParentName(rootObjects, blueprint, component)
                        ?? ResolveAttachParentName(component)
                        ?? string.Empty,
                    RelativeLocation = FormatInheritedTransformVector(relativeLocation),
                    RelativeRotation = FormatInheritedTransformRotator(relativeRotation),
                });
            }

            return componentReferences;
        }

        private static string FormatInheritedTransformVector(object? value)
        {
            return $"X={(ExtractVectorComponent(value, "X") ?? 0):0.###} Y={(ExtractVectorComponent(value, "Y") ?? 0):0.###} Z={(ExtractVectorComponent(value, "Z") ?? 0):0.###}";
        }

        private static string FormatInheritedTransformRotator(object? value)
        {
            return $"P={(ExtractVectorComponent(value, "Pitch") ?? 0):0.###} Y={(ExtractVectorComponent(value, "Yaw") ?? 0):0.###} R={(ExtractVectorComponent(value, "Roll") ?? 0):0.###}";
        }

        private static IEnumerable<string> EnumerateKnownVehicleBodyFrameCorrectionAncestors(
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            var yieldedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (componentReferences.Any(reference =>
                    string.Equals(NormalizeComponentReferenceName(reference.ComponentName), "CharacterMesh0", StringComparison.OrdinalIgnoreCase)) &&
                yieldedNames.Add("CharacterMesh0"))
            {
                yield return "CharacterMesh0";
            }

            foreach (var componentReference in componentReferences.Where(reference =>
                         IsPrimaryTrackedVehicleBodyReference(reference) &&
                         string.IsNullOrWhiteSpace(NormalizeComponentReferenceName(reference.AttachParentName))))
            {
                var normalizedName = NormalizeComponentReferenceName(componentReference.ComponentName);
                if (string.IsNullOrWhiteSpace(normalizedName) || !yieldedNames.Add(normalizedName))
                {
                    continue;
                }

                yield return componentReference.ComponentName;
            }
        }

        private static bool IsPrimaryTrackedVehicleBodyReference(FoxWatchBlueprintComponentReference componentReference)
        {
            if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
            {
                return false;
            }

            if (string.Equals(componentReference.ComponentName, "MainBody", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(componentReference.ComponentName, "Mainbody", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(componentReference.ComponentName, "Chassis", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            var fileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath);
            return fileName.Contains("chassis", StringComparison.OrdinalIgnoreCase) ||
                fileName.Contains("body", StringComparison.OrdinalIgnoreCase) ||
                fileName.Contains("hull", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsComponentAttachedToAncestor(
            object component,
            IReadOnlyDictionary<string, object> componentLookup,
            string ancestorName)
        {
            var normalizedAncestorName = NormalizeComponentReferenceName(ancestorName);
            if (string.IsNullOrWhiteSpace(normalizedAncestorName))
            {
                return false;
            }

            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var currentComponent = component;

            while (true)
            {
                var currentName = GetComponentLookupKeys(currentComponent).FirstOrDefault();
                if (string.IsNullOrWhiteSpace(currentName) || !visited.Add(currentName))
                {
                    return false;
                }

                if (string.Equals(currentName, normalizedAncestorName, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                var parentName = ResolveAttachParentName(currentComponent);
                if (string.IsNullOrWhiteSpace(parentName) ||
                    !componentLookup.TryGetValue(parentName, out currentComponent))
                {
                    return false;
                }
            }
        }

        private ManifestComponentTransform RotateComponentTransformAroundPivot(
            ManifestComponentTransform transform,
            double pivotX,
            double pivotY,
            double yawOffsetDegrees)
        {
            var radians = yawOffsetDegrees * (Math.PI / 180.0);
            var cosine = Math.Cos(radians);
            var sine = Math.Sin(radians);
            var relativeX = transform.X - pivotX;
            var relativeY = transform.Y - pivotY;
            var rotatedX = pivotX + (relativeX * cosine) - (relativeY * sine);
            var rotatedY = pivotY + (relativeX * sine) + (relativeY * cosine);
            var yawRotation = CreateUnrealRotatorQuaternion(0, yawOffsetDegrees, 0);

            return new ManifestComponentTransform(
                rotatedX,
                rotatedY,
                transform.Z,
                Quaternion.Normalize(yawRotation * transform.Rotation));
        }

        private ManifestComponentTransform ResolveInheritedBuildSocketComponentTransform(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup)
        {
            return ResolveInheritedBuildSocketComponentTransform(
                rootObjects,
                blueprint,
                component,
                componentLookup,
                new HashSet<string>(StringComparer.OrdinalIgnoreCase));
        }

        private ManifestComponentTransform ResolveInheritedBuildSocketComponentTransform(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            IReadOnlyDictionary<string, object> componentLookup,
            ISet<string> ancestry)
        {
            var relativeLocation = ResolveInheritedTransformProperty(
                rootObjects,
                blueprint,
                component,
                "RelativeLocation",
                value => IsIdentityTransformVector(value));
            var relativeRotation = ResolveInheritedTransformProperty(
                rootObjects,
                blueprint,
                component,
                "RelativeRotation",
                value => IsIdentityTransformRotator(value));

            var localTransform = CreateComponentTransform(
                ExtractVectorComponent(relativeLocation, "X") ?? 0,
                ExtractVectorComponent(relativeLocation, "Y") ?? 0,
                ExtractVectorComponent(relativeLocation, "Z") ?? 0,
                pitchDegrees: ExtractVectorComponent(relativeRotation, "Pitch") ?? 0,
                yawDegrees: ExtractVectorComponent(relativeRotation, "Yaw") ?? 0,
                rollDegrees: ExtractVectorComponent(relativeRotation, "Roll") ?? 0);

            var componentName = GetComponentLookupKeys(component).FirstOrDefault();
            var addedToAncestry = !string.IsNullOrWhiteSpace(componentName) && ancestry.Add(componentName);

            try
            {
                var parentName = ResolveInheritedAttachParentName(rootObjects, blueprint, component);
                if (string.IsNullOrWhiteSpace(parentName) ||
                    ancestry.Contains(parentName) ||
                    !componentLookup.TryGetValue(parentName, out var parentComponent))
                {
                    return localTransform;
                }

                var parentTransform = ResolveInheritedBuildSocketComponentTransform(rootObjects, blueprint, parentComponent, componentLookup, ancestry);
                return ComposeComponentTransforms(parentTransform, localTransform);
            }
            finally
            {
                if (addedToAncestry)
                {
                    ancestry.Remove(componentName!);
                }
            }
        }

        private string? ResolveInheritedAttachParentName(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component)
        {
            var attachParent = GetInheritedBlueprintComponentProperty(rootObjects, blueprint, component, "AttachParent");
            return ResolveAttachParentName(attachParent, defaultToDirectValue: true);
        }

        private object? ResolveInheritedTransformProperty(
            IEnumerable<dynamic> rootObjects,
            UBlueprintGeneratedClass blueprint,
            object component,
            string propertyName,
            Func<object?, bool> isIdentityValue)
        {
            var localValue = GetNamedValue(component, propertyName);
            if (localValue != null && !isIdentityValue(localValue))
            {
                return localValue;
            }

            var componentName = NormalizeString(ExtractText(GetNamedValue(component, "Name")));
            if (string.IsNullOrWhiteSpace(componentName))
            {
                return localValue;
            }

            foreach (var scope in EnumerateBlueprintComponentScopes(rootObjects, blueprint))
            {
                if (!scope.FirstObjectByNormalizedName.TryGetValue(componentName, out var matchingComponent))
                {
                    continue;
                }

                var candidateValue = GetNamedValue(matchingComponent, propertyName);
                if (candidateValue != null && !isIdentityValue(candidateValue))
                {
                    return candidateValue;
                }
            }

            return localValue;
        }

        private static bool IsIdentityTransformVector(object? value)
        {
            return Math.Abs(ExtractVectorComponent(value, "X") ?? 0) <= 0.0001 &&
                Math.Abs(ExtractVectorComponent(value, "Y") ?? 0) <= 0.0001 &&
                Math.Abs(ExtractVectorComponent(value, "Z") ?? 0) <= 0.0001;
        }

        private static bool IsIdentityTransformRotator(object? value)
        {
            return Math.Abs(ExtractVectorComponent(value, "Pitch") ?? 0) <= 0.0001 &&
                Math.Abs(ExtractVectorComponent(value, "Yaw") ?? 0) <= 0.0001 &&
                Math.Abs(ExtractVectorComponent(value, "Roll") ?? 0) <= 0.0001;
        }

        private static ManifestComponentTransform ExtractLocalComponentTransform(object component)
        {
            var relativeLocation = GetNamedValue(component, "RelativeLocation");
            var relativeRotation = GetNamedValue(component, "RelativeRotation");

            return CreateComponentTransform(
                ExtractVectorComponent(relativeLocation, "X") ?? 0,
                ExtractVectorComponent(relativeLocation, "Y") ?? 0,
                ExtractVectorComponent(relativeLocation, "Z") ?? 0,
                pitchDegrees: ExtractVectorComponent(relativeRotation, "Pitch") ?? 0,
                yawDegrees: ExtractVectorComponent(relativeRotation, "Yaw") ?? 0,
                rollDegrees: ExtractVectorComponent(relativeRotation, "Roll") ?? 0);
        }

        private static ManifestComponentTransform ComposeComponentTransforms(
            ManifestComponentTransform parent,
            ManifestComponentTransform local)
        {
            return new ManifestComponentTransform(
                parent.X + Vector3.Transform(new Vector3((float)local.X, (float)local.Y, (float)local.Z), parent.Rotation).X,
                parent.Y + Vector3.Transform(new Vector3((float)local.X, (float)local.Y, (float)local.Z), parent.Rotation).Y,
                parent.Z + Vector3.Transform(new Vector3((float)local.X, (float)local.Y, (float)local.Z), parent.Rotation).Z,
                Quaternion.Normalize(parent.Rotation * local.Rotation));
        }

        private static string? ResolveAttachParentName(object component)
        {
            return ResolveAttachParentName(GetNamedValue(component, "AttachParent"), defaultToDirectValue: true);
        }

        private static string? ResolveAttachParentName(object? attachParent, bool defaultToDirectValue)
        {
            if (attachParent == null)
            {
                return null;
            }

            var candidates = new[]
            {
                ExtractText(GetNamedValue(attachParent, "Name")),
                ExtractText(GetNamedValue(attachParent, "ObjectName")),
                ExtractText(GetNamedValue(attachParent, "ObjectPath")),
                defaultToDirectValue ? ExtractText(attachParent) : string.Empty,
            };

            return candidates
                .Select(NormalizeComponentReferenceName)
                .FirstOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate));
        }

        private static string NormalizeComponentReferenceName(string? value)
        {
            var normalized = NormalizeString(value).Trim('"', '\'');
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return string.Empty;
            }

            var apostropheIndex = normalized.LastIndexOf('\'');
            if (apostropheIndex >= 0 && apostropheIndex + 1 < normalized.Length)
            {
                normalized = normalized[(apostropheIndex + 1)..];
            }

            var colonIndex = normalized.LastIndexOf(':');
            if (colonIndex >= 0 && colonIndex + 1 < normalized.Length)
            {
                normalized = normalized[(colonIndex + 1)..];
            }

            var dotIndex = normalized.LastIndexOf('.');
            if (dotIndex >= 0 && dotIndex + 1 < normalized.Length)
            {
                normalized = normalized[(dotIndex + 1)..];
            }

            return NormalizeString(normalized.Trim('"', '\''));
        }

        private static bool PackagePathsEqual(string? left, string? right)
        {
            return string.Equals(
                NormalizeString(left).Replace('\\', '/'),
                NormalizeString(right).Replace('\\', '/'),
                StringComparison.OrdinalIgnoreCase);
        }

        private sealed class FoxWatchBlueprintTargetIndexDocument
        {
            public int FormatVersion { get; set; }

            public string? PakDirectoryPath { get; set; }

            public string? PakDirectorySignature { get; set; }

            public Dictionary<string, string[]> Targets { get; set; } = new(StringComparer.Ordinal);
        }

        private ManifestComponentTransform ResolveComponentReferenceTransform(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
        {
            var lookup = new Dictionary<string, FoxWatchBlueprintComponentReference>(StringComparer.OrdinalIgnoreCase);
            foreach (var reference in componentReferences)
            {
                var normalizedName = NormalizeComponentReferenceName(reference.ComponentName);
                if (!string.IsNullOrWhiteSpace(normalizedName))
                {
                    lookup.TryAdd(normalizedName, reference);
                }
            }

            return ResolveComponentReferenceTransform(
                componentReference,
                lookup,
                new HashSet<string>(StringComparer.OrdinalIgnoreCase));
        }

        private ManifestComponentTransform ResolveComponentReferenceTransform(
            FoxWatchBlueprintComponentReference componentReference,
            IReadOnlyDictionary<string, FoxWatchBlueprintComponentReference> componentLookup,
            ISet<string> ancestry)
        {
            var absoluteTransform = ExtractAbsoluteComponentReferenceTransform(componentReference);
            var localTransform = ExtractRelativeComponentReferenceTransform(componentReference);
            var parentName = NormalizeComponentReferenceName(componentReference.AttachParentName);
            FoxWatchBlueprintComponentReference? parentReference = null;
            var hasParentReference = !string.IsNullOrWhiteSpace(parentName) && componentLookup.TryGetValue(parentName, out parentReference);
            var attachSocketTransform = CreateComponentTransform(0, 0, 0);
            var hasAttachSocketTransform = hasParentReference &&
                TryResolveAttachSocketTransform(parentReference!, componentReference.AttachSocketName, out attachSocketTransform);

            if (absoluteTransform != null &&
                !hasParentReference &&
                !hasAttachSocketTransform &&
                !ShouldPreferRelativeComponentReferenceTransform(componentReference, localTransform, absoluteTransform.Value))
            {
                return absoluteTransform.Value;
            }

            var componentName = NormalizeComponentReferenceName(componentReference.ComponentName);
            var addedToAncestry = !string.IsNullOrWhiteSpace(componentName) && ancestry.Add(componentName);

            try
            {
                if (string.IsNullOrWhiteSpace(parentName) ||
                    ancestry.Contains(parentName) ||
                    !hasParentReference)
                {
                    return localTransform;
                }

                var parentTransform = ResolveComponentReferenceTransform(parentReference!, componentLookup, ancestry);
                if (hasAttachSocketTransform)
                {
                    parentTransform = ComposeComponentTransforms(parentTransform, attachSocketTransform);
                }

                return ComposeComponentTransforms(parentTransform, localTransform);
            }
            finally
            {
                if (addedToAncestry)
                {
                    ancestry.Remove(componentName!);
                }
            }
        }

        private bool TryResolveAttachSocketTransform(
            FoxWatchBlueprintComponentReference parentReference,
            string? attachSocketName,
            out ManifestComponentTransform attachSocketTransform)
        {
            attachSocketTransform = CreateComponentTransform(0, 0, 0);

            var normalizedAttachSocketName = NormalizeComponentReferenceName(attachSocketName);
            if (string.IsNullOrWhiteSpace(normalizedAttachSocketName))
            {
                return false;
            }

            var attachPointTransforms = GetSkeletalMeshAttachPointTransforms(parentReference.MeshPath);
            return attachPointTransforms.TryGetValue(normalizedAttachSocketName, out attachSocketTransform);
        }

        private IReadOnlyDictionary<string, ManifestComponentTransform> GetSkeletalMeshAttachPointTransforms(string? meshPath)
        {
            var resolvedMeshPath = ResolvePackagePath(meshPath);
            if (string.IsNullOrWhiteSpace(resolvedMeshPath))
            {
                return EmptyAttachPointTransforms;
            }

            if (_skeletalMeshAttachPointTransformsByPackagePath.TryGetValue(resolvedMeshPath, out var cachedTransforms))
            {
                return cachedTransforms;
            }

            cachedTransforms = LoadSkeletalMeshAttachPointTransforms(resolvedMeshPath);
            _skeletalMeshAttachPointTransformsByPackagePath[resolvedMeshPath] = cachedTransforms;
            return cachedTransforms;
        }

        private IReadOnlyDictionary<string, ManifestComponentTransform> LoadSkeletalMeshAttachPointTransforms(string meshPath)
        {
            try
            {
                var package = _fileProvider.LoadPackage(meshPath);
                var preferredObjectName = Path.GetFileNameWithoutExtension(meshPath);
                var mesh = package.GetExports().OfType<USkeletalMesh>().FirstOrDefault(export =>
                        string.Equals(export.Name, preferredObjectName, StringComparison.OrdinalIgnoreCase))
                    ?? package.GetExports().OfType<USkeletalMesh>().FirstOrDefault();
                if (mesh == null)
                {
                    return EmptyAttachPointTransforms;
                }

                var attachPointTransforms = BuildSkeletalMeshBoneTransforms(mesh);
                AppendSkeletalMeshSocketTransforms(attachPointTransforms, mesh, attachPointTransforms);
                AppendSkeletalMeshSocketTransforms(
                    attachPointTransforms,
                    package.GetExports().Cast<object>().Where(IsSkeletalMeshSocketExport),
                    attachPointTransforms);

                var skeleton = ResolveObjectReference<USkeleton>(GetNamedValue(mesh, "Skeleton"));
                if (skeleton != null)
                {
                    AppendSkeletalMeshSocketTransforms(attachPointTransforms, skeleton, attachPointTransforms);
                }

                var skeletonPackagePath = ResolvePackagePath(ResolveReferencedPackagePath(GetNamedValue(mesh, "Skeleton")));
                if (!string.IsNullOrWhiteSpace(skeletonPackagePath))
                {
                    var skeletonPackage = _fileProvider.LoadPackage(skeletonPackagePath);
                    AppendSkeletalMeshSocketTransforms(
                        attachPointTransforms,
                        skeletonPackage.GetExports().Cast<object>().Where(IsSkeletalMeshSocketExport),
                        attachPointTransforms);
                }

                return attachPointTransforms;
            }
            catch
            {
                return EmptyAttachPointTransforms;
            }
        }

        private static Dictionary<string, ManifestComponentTransform> BuildSkeletalMeshBoneTransforms(USkeletalMesh mesh)
        {
            var referenceSkeleton = mesh.ReferenceSkeleton;
            var boneTransformsByName = new Dictionary<string, ManifestComponentTransform>(referenceSkeleton.FinalRefBoneInfo.Length, StringComparer.OrdinalIgnoreCase);
            var boneTransformsByIndex = new ManifestComponentTransform[referenceSkeleton.FinalRefBoneInfo.Length];

            for (var boneIndex = 0; boneIndex < referenceSkeleton.FinalRefBoneInfo.Length; boneIndex++)
            {
                var boneInfo = referenceSkeleton.FinalRefBoneInfo[boneIndex];
                var localTransform = CreateComponentTransform(referenceSkeleton.FinalRefBonePose[boneIndex]);
                var absoluteTransform = boneInfo.ParentIndex >= 0
                    ? ComposeComponentTransforms(boneTransformsByIndex[boneInfo.ParentIndex], localTransform)
                    : localTransform;

                boneTransformsByIndex[boneIndex] = absoluteTransform;

                var boneName = NormalizeComponentReferenceName(boneInfo.Name.Text);
                if (!string.IsNullOrWhiteSpace(boneName))
                {
                    boneTransformsByName[boneName] = absoluteTransform;
                }
            }

            return boneTransformsByName;
        }

        private static void AppendSkeletalMeshSocketTransforms(
            IDictionary<string, ManifestComponentTransform> attachPointTransforms,
            object socketOwner,
            IReadOnlyDictionary<string, ManifestComponentTransform> boneTransforms)
        {
            AppendSkeletalMeshSocketTransforms(
                attachPointTransforms,
                AsEnumerable(GetNamedValue(socketOwner, "Sockets")),
                boneTransforms);
        }

        private static void AppendSkeletalMeshSocketTransforms(
            IDictionary<string, ManifestComponentTransform> attachPointTransforms,
            IEnumerable<object> socketDefinitions,
            IReadOnlyDictionary<string, ManifestComponentTransform> boneTransforms)
        {
            foreach (var socket in socketDefinitions)
            {
                var socketName = NormalizeComponentReferenceName(
                    ExtractText(GetNamedValue(socket, "SocketName")) ??
                    ExtractText(GetNamedValue(socket, "Name")));
                if (string.IsNullOrWhiteSpace(socketName))
                {
                    continue;
                }

                var relativeLocation = GetNamedValue(socket, "RelativeLocation") ?? GetNamedValue(socket, "RelativePosition");
                var relativeRotation = GetNamedValue(socket, "RelativeRotation");
                var socketTransform = CreateComponentTransform(
                    ExtractVectorComponent(relativeLocation, "X") ?? 0,
                    ExtractVectorComponent(relativeLocation, "Y") ?? 0,
                    ExtractVectorComponent(relativeLocation, "Z") ?? 0,
                    pitchDegrees: ExtractVectorComponent(relativeRotation, "Pitch") ?? 0,
                    yawDegrees: ExtractVectorComponent(relativeRotation, "Yaw") ?? 0,
                    rollDegrees: ExtractVectorComponent(relativeRotation, "Roll") ?? 0);

                var boneName = NormalizeComponentReferenceName(ExtractText(GetNamedValue(socket, "BoneName")));
                if (!string.IsNullOrWhiteSpace(boneName) && boneTransforms.TryGetValue(boneName, out var boneTransform))
                {
                    socketTransform = ComposeComponentTransforms(boneTransform, socketTransform);
                }

                attachPointTransforms[socketName] = socketTransform;
            }
        }

        private static bool IsSkeletalMeshSocketExport(object value)
        {
            return GetObjectTypeName(value).Contains("SkeletalMeshSocket", StringComparison.OrdinalIgnoreCase);
        }

        private T? ResolveObjectReference<T>(object? value)
            where T : UObject
        {
            if (value is T directValue)
            {
                return directValue;
            }

            if (value is FPackageIndex packageIndex && packageIndex.TryLoad<T>(out var indexedValue))
            {
                return indexedValue;
            }

            var objectPath = ResolveReferencedObjectPath(value);
            if (!string.IsNullOrWhiteSpace(objectPath) && _fileProvider.TryLoadPackageObject<T>(objectPath, out var objectPathValue))
            {
                return objectPathValue;
            }

            var packagePath = ResolvePackagePath(ResolveReferencedPackagePath(value));
            if (string.IsNullOrWhiteSpace(packagePath))
            {
                return null;
            }

            try
            {
                var package = _fileProvider.LoadPackage(packagePath);
                var preferredObjectName = Path.GetFileNameWithoutExtension(packagePath);
                return package.GetExports().OfType<T>().FirstOrDefault(export =>
                        string.Equals(export.Name, preferredObjectName, StringComparison.OrdinalIgnoreCase))
                    ?? package.GetExports().OfType<T>().FirstOrDefault();
            }
            catch
            {
                return null;
            }
        }

        private static ManifestComponentTransform ExtractRelativeComponentReferenceTransform(FoxWatchBlueprintComponentReference componentReference)
        {
            return CreateComponentTransform(
                ParseVectorValue(componentReference.RelativeLocation, "x") ?? 0,
                ParseVectorValue(componentReference.RelativeLocation, "y") ?? 0,
                ParseVectorValue(componentReference.RelativeLocation, "z") ?? 0,
                pitchDegrees: ParseRotatorValue(componentReference.RelativeRotation, "pitch") ?? 0,
                yawDegrees: ParseRotatorValue(componentReference.RelativeRotation, "yaw") ?? 0,
                rollDegrees: ParseRotatorValue(componentReference.RelativeRotation, "roll") ?? 0);
        }

        private static ManifestComponentTransform? ExtractAbsoluteComponentReferenceTransform(FoxWatchBlueprintComponentReference componentReference)
        {
            if (string.IsNullOrWhiteSpace(componentReference.AbsoluteLocation) &&
                string.IsNullOrWhiteSpace(componentReference.AbsoluteRotation))
            {
                return null;
            }

            return CreateComponentTransform(
                ParseVectorValue(componentReference.AbsoluteLocation, "x") ?? 0,
                ParseVectorValue(componentReference.AbsoluteLocation, "y") ?? 0,
                ParseVectorValue(componentReference.AbsoluteLocation, "z") ?? 0,
                pitchDegrees: ParseRotatorValue(componentReference.AbsoluteRotation, "pitch") ?? 0,
                yawDegrees: ParseRotatorValue(componentReference.AbsoluteRotation, "yaw") ?? 0,
                rollDegrees: ParseRotatorValue(componentReference.AbsoluteRotation, "roll") ?? 0);
        }

        private static bool ShouldPreferRelativeComponentReferenceTransform(
            FoxWatchBlueprintComponentReference componentReference,
            ManifestComponentTransform relativeTransform,
            ManifestComponentTransform absoluteTransform)
        {
            if (string.IsNullOrWhiteSpace(componentReference.RelativeLocation) &&
                string.IsNullOrWhiteSpace(componentReference.RelativeRotation))
            {
                return false;
            }

            var hasMeaningfulRelativeTranslation = Math.Abs(relativeTransform.X) > 0.0001 ||
                Math.Abs(relativeTransform.Y) > 0.0001 ||
                Math.Abs(relativeTransform.Z) > 0.0001;
            if (!hasMeaningfulRelativeTranslation)
            {
                return false;
            }

            var hasIdentityAbsoluteTranslation = Math.Abs(absoluteTransform.X) <= 0.0001 &&
                Math.Abs(absoluteTransform.Y) <= 0.0001 &&
                Math.Abs(absoluteTransform.Z) <= 0.0001;

            return hasIdentityAbsoluteTranslation;
        }

        private static ManifestComponentTransform CreateComponentTransform(
            double x,
            double y,
            double z,
            double pitchDegrees = 0,
            double yawDegrees = 0,
            double rollDegrees = 0)
        {
            return new ManifestComponentTransform(
                x,
                y,
                z,
                CreateUnrealRotatorQuaternion(pitchDegrees, yawDegrees, rollDegrees));
        }

        private static ManifestComponentTransform CreateComponentTransform(FTransform transform)
        {
            var rotation = transform.Rotation;
            rotation.Normalize();

            return new ManifestComponentTransform(
                transform.Translation.X,
                transform.Translation.Y,
                transform.Translation.Z,
                Quaternion.Normalize(new Quaternion(rotation.X, rotation.Y, rotation.Z, rotation.W)));
        }

        private static Quaternion CreateUnrealRotatorQuaternion(double pitchDegrees, double yawDegrees, double rollDegrees)
        {
            var yaw = Quaternion.CreateFromAxisAngle(Vector3.UnitZ, (float)(yawDegrees * Math.PI / 180.0));
            var pitch = Quaternion.CreateFromAxisAngle(Vector3.UnitY, (float)(pitchDegrees * Math.PI / 180.0));
            var roll = Quaternion.CreateFromAxisAngle(Vector3.UnitX, (float)(rollDegrees * Math.PI / 180.0));
            return Quaternion.Normalize(yaw * pitch * roll);
        }

        private static SpotlightPlanarHeading ResolveSpotlightPlanarHeading(Quaternion rotation)
        {
            var forward = Vector3.Transform(Vector3.UnitX, rotation);
            var planarMagnitude = Math.Sqrt((forward.X * forward.X) + (forward.Y * forward.Y));
            var planarProjectionScale = Math.Clamp(planarMagnitude, 0.0, 1.0);

            if (planarProjectionScale > 0.01)
            {
                return new SpotlightPlanarHeading(
                    Math.Atan2(forward.Y, forward.X) * (180.0 / Math.PI),
                    planarProjectionScale);
            }

            return new SpotlightPlanarHeading(null, planarProjectionScale);
        }

        private static double ExtractYawDegrees(Quaternion rotation)
        {
            var forward = Vector3.Transform(Vector3.UnitX, rotation);
            return Math.Atan2(forward.Y, forward.X) * (180.0 / Math.PI);
        }

        private static string? NullIfWhiteSpace(string? value)
        {
            var normalized = NormalizeString(value);
            return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
        }

        private static string? NormalizeLocalizedText(string? value)
        {
            var normalized = NormalizeString(value);
            return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
        }

        private sealed class BlueprintComponentScope
        {
            public BlueprintComponentScope(
                string blueprintName,
                string defaultObjectName,
                IReadOnlyList<object> objects,
                IReadOnlyDictionary<string, object> firstObjectByNormalizedName)
            {
                BlueprintName = blueprintName;
                DefaultObjectName = defaultObjectName;
                NormalizedDefaultObjectName = NormalizeString(defaultObjectName);
                Objects = objects;
                FirstObjectByNormalizedName = firstObjectByNormalizedName;
            }

            public string BlueprintName { get; }

            public string DefaultObjectName { get; }

            public string NormalizedDefaultObjectName { get; }

            public IReadOnlyList<object> Objects { get; }

            public IReadOnlyDictionary<string, object> FirstObjectByNormalizedName { get; }
        }

        private sealed class VehicleBodyFrameCorrection
        {
            public VehicleBodyFrameCorrection(double yawOffsetDegrees, IReadOnlySet<string> applicableAncestorNames)
            {
                YawOffsetDegrees = yawOffsetDegrees;
                ApplicableAncestorNames = applicableAncestorNames;
            }

            public double YawOffsetDegrees { get; }

            public IReadOnlySet<string> ApplicableAncestorNames { get; }
        }

        private sealed class FoxWatchLocalizationReference
        {
            public string Id { get; set; } = string.Empty;

            public string Namespace { get; set; } = string.Empty;

            public string Key { get; set; } = string.Empty;

            public string Source { get; set; } = string.Empty;
        }

        private sealed class FoxWatchManifestModificationVariantReference
        {
            public string Id { get; set; } = string.Empty;

            public bool UseTemplateActor { get; set; }

            public string? TemplateActorPath { get; set; }
        }

        private sealed class FoxWatchManifestModificationOverlay
        {
            public List<FoxWatchManifestBuildSocket> BuildSockets { get; set; } = [];

            public List<FoxWatchManifestHitPolygon> FootprintPolygons { get; set; } = [];
        }

        private sealed class FoxWatchMountDynamicDataEntry
        {
            public string Key { get; set; } = string.Empty;

            public double? MinDistance { get; set; }

            public double? MaxDistance { get; set; }

            public double? MaxReachability { get; set; }

            public double? MinYaw { get; set; }

            public double? MaxYaw { get; set; }

            public double? YawOffset { get; set; }

            public bool HasWeaponRange => (MaxDistance ?? 0) > 0 || (MinDistance ?? 0) > 0;
        }

        private sealed class FoxWatchConstructionDynamicDataEntry
        {
            public string Key { get; set; } = string.Empty;

            public Dictionary<string, FoxWatchManifestRecipeResource> Cost { get; set; } = new(StringComparer.Ordinal);

            public Dictionary<string, FoxWatchManifestRecipeResource> CrateCost { get; set; } = new(StringComparer.Ordinal);

            public Dictionary<string, FoxWatchManifestRecipeResource> UpgradeCost { get; set; } = new(StringComparer.Ordinal);

            public bool HasTierUpgrades { get; set; }

            public double? CrateQuantity { get; set; }

            public double? CrateProductionTime { get; set; }

            public double? SingleRetrieveTime { get; set; }

            public double? CrateRetrieveTime { get; set; }

            public int? RepairCost { get; set; }

            public double? StructuralIntegrity { get; set; }

            public int? InventorySlots { get; set; }

            public List<FoxWatchConstructionDynamicDataItemSlotFilter> ItemSlotFilters { get; set; } = [];
        }

        private sealed class FoxWatchConstructionDynamicDataItemSlotFilter
        {
            public string? CodeName { get; set; }

            public List<string> ExtraCodeNames { get; set; } = [];

            public int? StackLimit { get; set; }
        }

        private sealed class FoxWatchSpecializedFactoryMetadata
        {
            public List<FoxWatchManifestConversionEntry> ConversionEntries { get; } = [];

            public int? MaxQueueSize { get; set; }
        }

        private sealed class FoxWatchMountComponentMetadata
        {
            public string? PackagePath { get; set; }

            public string? CodeName { get; set; }

            public string? DisplayName { get; set; }

            public string? IconUrl { get; set; }

            public string? AmmoName { get; set; }

            public IReadOnlyList<string> CompatibleAmmoNames { get; set; } = [];

            public bool IsMultiWeapon { get; set; }

            public double? ExtendedMaxDistance { get; set; }
        }

        private sealed class FoxWatchReferencedAssetMetadata
        {
            public string PackagePath { get; set; } = string.Empty;

            public string CodeName { get; set; } = string.Empty;

            public bool IsLiquid { get; set; }

            public double? LiquidUnitQuantity { get; set; }
        }

        private sealed class FoxWatchLiquidItemComponentMetadata
        {
            public string CodeName { get; set; } = string.Empty;

            public double? Capacity { get; set; }
        }

        private readonly record struct VehicleSeatForwardHints(
            double? SeatYawDegrees,
            double? SpotlightYawDegrees);

        private readonly record struct ManifestComponentTransform(
            double X,
            double Y,
            double Z,
            Quaternion Rotation)
        {
            public double YawDegrees => ExtractYawDegrees(Rotation);
        }

        private readonly record struct SpotlightPlanarHeading(
            double? YawDegrees,
            double PlanarProjectionScale);

        private sealed class FoxWatchScriptMapEntry
        {
            public object? Key { get; set; }

            public object? Value { get; set; }
        }
    }
