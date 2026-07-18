namespace FoxWatchService;

using System.Collections.Concurrent;
using System.Diagnostics;
using CUE4Parse.FileProvider;
using CUE4Parse.FileProvider.Objects;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Component.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.Engine;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Objects.Engine;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Animations;
using CUE4Parse_Conversion.Animations.PSA;
using CUE4Parse_Conversion.Materials;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Textures;
using CUE4Parse_Conversion.UEFormat.Enums;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Globalization;
using System.Text.RegularExpressions;

public sealed class FoxWatchAssetMeshExporter
{
    private static readonly Regex VectorPattern = new(@"X=(?<x>-?\d+(?:\.\d+)?)\s+Y=(?<y>-?\d+(?:\.\d+)?)\s+Z=(?<z>-?\d+(?:\.\d+)?)", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex RotatorPattern = new(@"P=(?<pitch>-?\d+(?:\.\d+)?)\s+Y=(?<yaw>-?\d+(?:\.\d+)?)\s+R=(?<roll>-?\d+(?:\.\d+)?)", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly EMeshFormat[] PreferredMeshFormats = [
        EMeshFormat.Gltf2,
        EMeshFormat.OBJ,
        EMeshFormat.ActorX,
        EMeshFormat.UEFormat,
    ];
    private const EGame EngineVersion = EGame.GAME_UE4_24;

    private readonly ILogger<FoxWatchAssetMeshExporter> _logger;
    private readonly string? _pakDirectoryPath;
    private DefaultFileProvider? _fileProvider;
    private DefaultFileProvider FileProvider => EnsureMounted();
    private readonly Dictionary<string, IReadOnlyList<FoxWatchBlueprintComponentReference>> _blueprintComponentReferencesByPackagePath = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, FoxWatchBlueprintComponentReference?> _pickupMeshFallbackByItemComponentClassPath = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _meshTypeByPackagePath = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, double?> _meshLengthCentimetersByPackagePathAndAxis = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, byte> _exportedMaterialSidecarKeys = new(StringComparer.OrdinalIgnoreCase);
    private bool _mounted;

    public FoxWatchAssetMeshExporter(ILogger<FoxWatchAssetMeshExporter> logger, IOptions<FoxWatchOptions> options)
    {
        _logger = logger;
        _pakDirectoryPath = FoxWatchWorkspace.ResolvePakDirectoryPath(options.Value.PakDirectoryPath);
    }

    public IReadOnlyList<string> FindMeshPackages(string query, int limit = 20)
    {
        return EnsureMounted().Files
            .Where(entry => entry.Value.IsUePackage)
            .Select(entry => entry.Key)
            .Where(path => path.StartsWith("War/Content/Meshes/", StringComparison.Ordinal))
            .Where(path => path.Contains(query, StringComparison.OrdinalIgnoreCase))
            .OrderBy(path => path, StringComparer.Ordinal)
            .Take(limit)
            .ToList();
    }

    public IReadOnlyList<string> FindPackages(string query, int limit = 20, string? pathPrefix = null)
    {
        return EnsureMounted().Files
            .Where(entry => entry.Value.IsUePackage)
            .Select(entry => entry.Key)
            .Where(path => string.IsNullOrWhiteSpace(pathPrefix) || path.StartsWith(pathPrefix, StringComparison.OrdinalIgnoreCase))
            .Where(path => path.Contains(query, StringComparison.OrdinalIgnoreCase))
            .OrderBy(path => path, StringComparer.Ordinal)
            .Take(limit)
            .ToList();
    }

    public IReadOnlyList<string> ListPackagesByPrefixes(params string[] pathPrefixes)
    {
        EnsureMounted();

        var normalizedPrefixes = pathPrefixes
            .Where(prefix => !string.IsNullOrWhiteSpace(prefix))
            .Select(prefix => prefix.Replace('\\', '/').Trim())
            .ToArray();

        return FileProvider.Files
            .Where(entry => entry.Value.IsUePackage)
            .Select(entry => entry.Key)
            .Where(path => normalizedPrefixes.Length == 0 || normalizedPrefixes.Any(prefix => path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();
    }

    public Task<IReadOnlyList<FoxWatchBlueprintComponentReference>> InspectBlueprintComponentsAsync(string assetPath, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMounted();

        var packagePath = ResolvePackagePath(assetPath)
            ?? throw new FileNotFoundException($"Could not resolve blueprint package '{assetPath}' from mounted Foxhole pak files.");

        if (_blueprintComponentReferencesByPackagePath.TryGetValue(packagePath, out var cachedReferences))
        {
            return Task.FromResult(cachedReferences);
        }

        _logger.LogInformation("Loading blueprint package {PackagePath}", packagePath);
        var package = FileProvider.LoadPackage(packagePath);
        var exports = package.GetExports().ToArray();

        var blueprintClass = exports.OfType<UBlueprintGeneratedClass>().FirstOrDefault();
        if (blueprintClass == null)
        {
            throw new InvalidOperationException($"Package '{packagePath}' does not contain a BlueprintGeneratedClass export.");
        }

        var references = new List<FoxWatchBlueprintComponentReference>();
        var inspectedBlueprintPackagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            packagePath,
        };
        AddPackageExportComponentReferences(blueprintClass, exports, references);
        AddBlueprintConstructionScriptExportComponentReferences(blueprintClass, exports, references);
        var currentStruct = (UStruct?) blueprintClass;
        while (currentStruct != null)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (currentStruct is UBlueprintGeneratedClass currentBlueprintClass)
            {
                try
                {
                    AddBlueprintClassComponentReferences(currentBlueprintClass, references);
                    AddBlueprintPackageExportComponentReferences(currentBlueprintClass, references, inspectedBlueprintPackagePaths);
                }
                catch (Exception exception)
                {
                    _logger.LogWarning(exception, "Skipping inherited blueprint class {BlueprintClassName} during component inspection", currentBlueprintClass.Name);
                }
            }

            try
            {
                var parentStruct = currentStruct.SuperStruct;
                currentStruct = parentStruct != null && parentStruct.TryLoad<UStruct>(out var superStruct)
                    ? superStruct
                    : null;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Stopping blueprint superclass traversal at {StructName}", currentStruct?.Name);
                currentStruct = null;
            }
        }

        _logger.LogInformation("Blueprint package {PackagePath} resolved {ComponentCount} component templates", packagePath, references.Count);
        var resolvedReferences = references.AsReadOnly();
        _blueprintComponentReferencesByPackagePath[packagePath] = resolvedReferences;
        return Task.FromResult<IReadOnlyList<FoxWatchBlueprintComponentReference>>(resolvedReferences);
    }

    public Task<FoxWatchBlueprintComponentReference?> TryInspectBlueprintComponentAsync(string assetPath, string componentName, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMounted();

        if (string.IsNullOrWhiteSpace(componentName))
        {
            return Task.FromResult<FoxWatchBlueprintComponentReference?>(null);
        }

        var packagePath = ResolvePackagePath(assetPath)
            ?? throw new FileNotFoundException($"Could not resolve blueprint package '{assetPath}' from mounted Foxhole pak files.");

        var package = FileProvider.LoadPackage(packagePath);
        var exports = package.GetExports().ToArray();
        var blueprintClass = exports.OfType<UBlueprintGeneratedClass>().FirstOrDefault();
        if (blueprintClass == null)
        {
            throw new InvalidOperationException($"Package '{packagePath}' does not contain a BlueprintGeneratedClass export.");
        }

        var references = new List<FoxWatchBlueprintComponentReference>();
        var inspectedBlueprintPackagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            packagePath,
        };
        AddPackageExportComponentReferences(blueprintClass, exports, references);
        AddBlueprintConstructionScriptExportComponentReferences(blueprintClass, exports, references);
        var currentStruct = (UStruct?)blueprintClass;
        while (currentStruct != null)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (currentStruct is UBlueprintGeneratedClass currentBlueprintClass)
            {
                try
                {
                    AddBlueprintClassComponentReferences(currentBlueprintClass, references);
                    AddBlueprintPackageExportComponentReferences(currentBlueprintClass, references, inspectedBlueprintPackagePaths);
                }
                catch (Exception exception)
                {
                    _logger.LogWarning(exception, "Skipping inherited blueprint class {BlueprintClassName} during targeted component inspection", currentBlueprintClass.Name);
                }
            }

            try
            {
                var parentStruct = currentStruct.SuperStruct;
                currentStruct = parentStruct != null && parentStruct.TryLoad<UStruct>(out var superStruct)
                    ? superStruct
                    : null;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Stopping targeted component superclass traversal at {StructName}", currentStruct?.Name);
                currentStruct = null;
            }
        }

        var matchedReference = references.FirstOrDefault(reference =>
            string.Equals(reference.ComponentName, componentName, StringComparison.OrdinalIgnoreCase));
        if (matchedReference != null)
        {
            return Task.FromResult<FoxWatchBlueprintComponentReference?>(matchedReference);
        }

        var defaultObjectName = $"Default__{blueprintClass.Name}";
        foreach (var export in exports)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (export is UBlueprintGeneratedClass)
            {
                continue;
            }

            var outerName = export.Outer?.Name.Text ?? string.Empty;
            if (!string.Equals(outerName, defaultObjectName, StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(export.Name, componentName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var reference = CreateBlueprintComponentReference(componentName, export, allowTransformTemplate: true);
            if (reference != null)
            {
                return Task.FromResult<FoxWatchBlueprintComponentReference?>(reference);
            }
        }

        return Task.FromResult<FoxWatchBlueprintComponentReference?>(null);
    }

    public Task<IReadOnlyList<FoxWatchModificationVariantReference>> InspectModificationVariantsAsync(string assetPath, CancellationToken cancellationToken = default, int? preferredTier = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMounted();

        var packagePath = ResolvePackagePath(assetPath)
            ?? throw new FileNotFoundException($"Could not resolve modification data package '{assetPath}' from mounted Foxhole pak files.");

        _logger.LogInformation("Loading modification data package {PackagePath}", packagePath);
        var package = FileProvider.LoadPackage(packagePath);
        var exports = package.GetExports().ToArray();
        var exportsJson = JsonConvert.SerializeObject(exports, Formatting.None);
        var exportTokens = JArray.Parse(exportsJson);
        var defaultObjectToken = exportTokens
            .OfType<JObject>()
            .FirstOrDefault(token => token.Value<string>("Name")?.StartsWith("Default__", StringComparison.OrdinalIgnoreCase) == true);

        var modificationsToken = defaultObjectToken?["Properties"]?["Modifications"] as JArray;
        if (modificationsToken == null)
        {
            _logger.LogWarning("Modification data package {PackagePath} did not expose a Modifications array", packagePath);
            return Task.FromResult<IReadOnlyList<FoxWatchModificationVariantReference>>([]);
        }

        var variants = new List<FoxWatchModificationVariantReference>();
        foreach (var modificationToken in modificationsToken.OfType<JObject>())
        {
            cancellationToken.ThrowIfCancellationRequested();

            var rawKey = modificationToken.Value<string>("Key");
            var variantId = NormalizeModificationVariantId(rawKey);
            if (string.IsNullOrWhiteSpace(variantId))
            {
                continue;
            }

            var valueToken = modificationToken["Value"] as JObject;
            var displayName = valueToken?["DisplayName"]?["LocalizedString"]?.Value<string>()
                ?? valueToken?["DisplayName"]?["SourceString"]?.Value<string>()
                ?? ToDisplayName(variantId);

            var tierValueToken = ResolveModificationTierValueToken(valueToken, preferredTier);

            variants.Add(new FoxWatchModificationVariantReference
            {
                Id = variantId,
                Name = displayName,
                UseTemplateActor = tierValueToken?["bUseTemplateActor"]?.Value<bool>() == true,
                TemplateMeshPath = ConvertObjectPathToPackagePath(ReadObjectPath(tierValueToken, "TemplateMesh")),
                TemplateActorPath = ConvertObjectPathToPackagePath(ReadObjectPath(tierValueToken, "TemplateActor")),
            });
        }

        _logger.LogInformation("Modification data package {PackagePath} resolved {VariantCount} modification variants", packagePath, variants.Count);
        return Task.FromResult<IReadOnlyList<FoxWatchModificationVariantReference>>(variants);
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

    public Task<FoxWatchMeshExportResult> ExportMeshAsync(string assetPath, string outputDirectory, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMounted();

        var packagePath = ResolvePackagePath(assetPath)
            ?? throw new FileNotFoundException($"Could not resolve mesh package '{assetPath}' from mounted Foxhole pak files.");

        var packageStopwatch = Stopwatch.StartNew();
        _logger.LogInformation("Loading mesh package {PackagePath}", packagePath);
        var package = FileProvider.LoadPackage(packagePath);
        _logger.LogInformation("Loaded mesh package {PackagePath} in {ElapsedMs} ms", packagePath, packageStopwatch.ElapsedMilliseconds);
        if (package is AbstractUePackage uePackage && !uePackage.Summary.PackageFlags.HasFlag(EPackageFlags.PKG_FilterEditorOnly))
        {
            uePackage.Summary.PackageFlags |= EPackageFlags.PKG_FilterEditorOnly;
            _logger.LogInformation("Enabled PKG_FilterEditorOnly for {PackagePath} before mesh export deserialization", packagePath);
        }

        packageStopwatch.Restart();
        var exports = package.GetExports().ToArray();
        _logger.LogInformation("Enumerated exports for {PackagePath} in {ElapsedMs} ms", packagePath, packageStopwatch.ElapsedMilliseconds);
        var preferredObjectName = Path.GetFileNameWithoutExtension(packagePath);

        _logger.LogInformation(
            "Package {PackagePath} contains {ExportCount} exports. Preferred object name: {PreferredObjectName}",
            packagePath,
            exports.Length,
            preferredObjectName);

        var staticMeshExport = SelectPreferredExport(exports.OfType<UStaticMesh>().ToArray(), preferredObjectName);
        if (staticMeshExport != null)
        {
            LogSelectedExport(packagePath, staticMeshExport, exports);
            return Task.FromResult(ExportStaticMesh(packagePath, staticMeshExport.Name, staticMeshExport, outputDirectory));
        }

        var skeletalMeshExport = SelectPreferredExport(exports.OfType<USkeletalMesh>().ToArray(), preferredObjectName);
        if (skeletalMeshExport != null)
        {
            LogSelectedExport(packagePath, skeletalMeshExport, exports);
            return Task.FromResult(ExportSkeletalMesh(packagePath, skeletalMeshExport.Name, skeletalMeshExport, outputDirectory));
        }

        var exportSummary = string.Join(", ", exports.Select(export => $"{export.ExportType}:{export.Name}").Take(20));
        throw new InvalidOperationException($"Package '{packagePath}' did not contain a UStaticMesh or USkeletalMesh export. Exports: {exportSummary}");
    }

    public Task<IReadOnlyList<string>> DumpPackageFilesAsync(string assetPath, string outputDirectory, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMounted();

        var packagePath = ResolvePackagePath(assetPath)
            ?? throw new FileNotFoundException($"Could not resolve mesh package '{assetPath}' from mounted Foxhole pak files.");

        var package = FileProvider.LoadPackage(packagePath);
        var packageFiles = FileProvider.SavePackage(packagePath);
        var writtenFiles = new List<string>(packageFiles.Count + 1);

        foreach (var entry in packageFiles.OrderBy(entry => entry.Key, StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var relativePath = entry.Key.Replace('/', Path.DirectorySeparatorChar);
            var destinationPath = Path.Combine(outputDirectory, relativePath);
            var destinationDirectory = Path.GetDirectoryName(destinationPath);
            if (!string.IsNullOrWhiteSpace(destinationDirectory))
            {
                Directory.CreateDirectory(destinationDirectory);
            }

            File.WriteAllBytes(destinationPath, entry.Value);
            writtenFiles.Add(destinationPath);
        }

        var exportJsonPath = Path.Combine(
            outputDirectory,
            packagePath.Replace('/', Path.DirectorySeparatorChar).Replace(".uasset", ".exports.json", StringComparison.OrdinalIgnoreCase));
        var exportJsonDirectory = Path.GetDirectoryName(exportJsonPath);
        if (!string.IsNullOrWhiteSpace(exportJsonDirectory))
        {
            Directory.CreateDirectory(exportJsonDirectory);
        }

        var exports = package.GetExports().ToArray();
        var exportJson = JsonConvert.SerializeObject(exports, Formatting.Indented);
        File.WriteAllText(exportJsonPath, exportJson + Environment.NewLine);
        writtenFiles.Add(exportJsonPath);

        _logger.LogInformation(
            "Dumped {FileCount} package files plus JSON exports for {PackagePath} to {OutputDirectory}",
            writtenFiles.Count,
            packagePath,
            outputDirectory);

        return Task.FromResult<IReadOnlyList<string>>(writtenFiles);
    }

    public Task<FoxWatchAnimationPoseSample> SampleAnimationPoseAsync(string assetPath, string? referenceMeshAssetPath = null, int frameIndex = 0, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMounted();

        var packagePath = ResolvePackagePath(assetPath)
            ?? throw new FileNotFoundException($"Could not resolve animation package '{assetPath}' from mounted Foxhole pak files.");

        var package = FileProvider.LoadPackage(packagePath);
        var exports = package.GetExports().ToArray();
        var preferredObjectName = Path.GetFileNameWithoutExtension(packagePath);
        var animationExport = SelectPreferredExport(exports.OfType<UAnimSequence>().ToArray(), preferredObjectName)
            ?? exports.OfType<UAnimSequence>().FirstOrDefault()
            ?? throw new InvalidOperationException($"Package '{packagePath}' did not contain a UAnimSequence export.");

        var skeleton = animationExport.Skeleton.Load<USkeleton>()
            ?? throw new InvalidOperationException($"Animation '{packagePath}' could not load its skeleton.");
        var animSet = skeleton.ConvertAnims(animationExport);
        var sequence = animSet.Sequences.FirstOrDefault()
            ?? throw new InvalidOperationException($"Animation '{packagePath}' did not yield a converted pose sequence.");

        var clampedFrameIndex = Math.Clamp(frameIndex, 0, Math.Max(sequence.NumFrames - 1, 0));
        var sampledPose = FAnimationRuntime.LoadAsPoses(sequence, skeleton, clampedFrameIndex).FirstOrDefault()
            ?? throw new InvalidOperationException($"Animation '{packagePath}' did not yield a sampled compact pose.");
        var referenceTransformsByBoneName = LoadReferenceTransformsByBoneName(skeleton);
        var boneCount = sampledPose.Bones.Length;
        var bones = new List<FoxWatchAnimationPoseBone>(boneCount);
        for (var boneIndex = 0; boneIndex < boneCount; boneIndex++)
        {
            var poseBone = sampledPose.Bones[boneIndex];
            var originalTransform = poseBone.Transform;
            var transform = originalTransform;
            FVector? referenceScale = null;
            if (referenceTransformsByBoneName != null && referenceTransformsByBoneName.TryGetValue(poseBone.Name, out var referenceTransform))
            {
                transform = transform.GetRelativeTransform(referenceTransform);
                referenceScale = referenceTransform.Scale3D;
            }

            var location = SwapYzAndScale(transform.Translation);
            var rotation = SwapYz(transform.Rotation);
            rotation.Normalize();
            var scale = NormalizeSerializedRelativeBoneScale(
                SwapYz(transform.Scale3D),
                SwapYz(originalTransform.Scale3D),
                referenceScale == null ? null : SwapYz(referenceScale.Value));

            bones.Add(new FoxWatchAnimationPoseBone
            {
                Name = poseBone.Name,
                ParentIndex = poseBone.ParentIndex,
                Location = [location.X, location.Y, location.Z],
                RotationQuaternion = [rotation.X, rotation.Y, rotation.Z, rotation.W],
                Scale = [scale.X, scale.Y, scale.Z],
            });
        }

        return Task.FromResult(new FoxWatchAnimationPoseSample
        {
            AssetPath = packagePath,
            FrameIndex = clampedFrameIndex,
            BoneCount = bones.Count,
            Bones = bones,
        });
    }

    private static FVector NormalizeSerializedRelativeBoneScale(FVector relativeScale, FVector originalScale, FVector? referenceScale)
    {
        if (referenceScale == null)
        {
            return new FVector(
                NormalizeSerializedRelativeBoneScaleAxis(relativeScale.X, originalScale.X, null),
                NormalizeSerializedRelativeBoneScaleAxis(relativeScale.Y, originalScale.Y, null),
                NormalizeSerializedRelativeBoneScaleAxis(relativeScale.Z, originalScale.Z, null));
        }

        return new FVector(
            NormalizeSerializedRelativeBoneScaleAxis(relativeScale.X, originalScale.X, referenceScale.Value.X),
            NormalizeSerializedRelativeBoneScaleAxis(relativeScale.Y, originalScale.Y, referenceScale.Value.Y),
            NormalizeSerializedRelativeBoneScaleAxis(relativeScale.Z, originalScale.Z, referenceScale.Value.Z));
    }

    private static float NormalizeSerializedRelativeBoneScaleAxis(float relativeValue, float originalValue, float? referenceValue)
    {
        var relativeIsFinite = !float.IsNaN(relativeValue) && !float.IsInfinity(relativeValue);
        if (!relativeIsFinite)
        {
            return 1.0f;
        }

        if (referenceValue == null)
        {
            return relativeValue;
        }

        if (Math.Abs(relativeValue) <= UnrealMath.KindaSmallNumber && Math.Abs(originalValue - referenceValue.Value) <= UnrealMath.KindaSmallNumber)
        {
            return 1.0f;
        }

        return relativeValue;
    }

    public Task<FoxWatchSkeletonReferenceComparison> CompareAnimationSkeletonReferencePoseAsync(string animationAssetPath, string referenceMeshAssetPath, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMounted();

        var animationPackagePath = ResolvePackagePath(animationAssetPath)
            ?? throw new FileNotFoundException($"Could not resolve animation package '{animationAssetPath}' from mounted Foxhole pak files.");

        var animationPackage = FileProvider.LoadPackage(animationPackagePath);
        var animationExports = animationPackage.GetExports().ToArray();
        var preferredAnimationObjectName = Path.GetFileNameWithoutExtension(animationPackagePath);
        var animationExport = SelectPreferredExport(animationExports.OfType<UAnimSequence>().ToArray(), preferredAnimationObjectName)
            ?? animationExports.OfType<UAnimSequence>().FirstOrDefault()
            ?? throw new InvalidOperationException($"Package '{animationPackagePath}' did not contain a UAnimSequence export.");

        var animationSkeleton = animationExport.Skeleton.Load<USkeleton>()
            ?? throw new InvalidOperationException($"Animation '{animationPackagePath}' could not load its skeleton.");

        var animationReferenceTransformsByBoneName = new Dictionary<string, FTransform>(animationSkeleton.ReferenceSkeleton.FinalRefBoneInfo.Length, StringComparer.OrdinalIgnoreCase);
        var animationParentNamesByBoneName = new Dictionary<string, string>(animationSkeleton.ReferenceSkeleton.FinalRefBoneInfo.Length, StringComparer.OrdinalIgnoreCase);
        for (var boneIndex = 0; boneIndex < animationSkeleton.ReferenceSkeleton.FinalRefBoneInfo.Length; boneIndex++)
        {
            var boneInfo = animationSkeleton.ReferenceSkeleton.FinalRefBoneInfo[boneIndex];
            var boneName = boneInfo.Name.Text;
            animationReferenceTransformsByBoneName[boneName] = animationSkeleton.ReferenceSkeleton.FinalRefBonePose[boneIndex];
            animationParentNamesByBoneName[boneName] = boneInfo.ParentIndex >= 0
                ? animationSkeleton.ReferenceSkeleton.FinalRefBoneInfo[boneInfo.ParentIndex].Name.Text
                : string.Empty;
        }

        var normalizedMeshAssetPath = NormalizeMeshAssetPath(referenceMeshAssetPath);
        var meshPackagePath = ResolvePackagePath(normalizedMeshAssetPath)
            ?? throw new FileNotFoundException($"Could not resolve reference mesh package '{referenceMeshAssetPath}' from mounted Foxhole pak files.");

        var meshPackage = FileProvider.LoadPackage(meshPackagePath);
        var meshExports = meshPackage.GetExports().ToArray();
        var preferredMeshObjectName = Path.GetFileNameWithoutExtension(meshPackagePath);
        var skeletalMeshExport = SelectPreferredExport(meshExports.OfType<USkeletalMesh>().ToArray(), preferredMeshObjectName)
            ?? meshExports.OfType<USkeletalMesh>().FirstOrDefault()
            ?? throw new InvalidOperationException($"Package '{meshPackagePath}' did not contain a skeletal mesh export.");

        var meshReferenceSkeleton = skeletalMeshExport.ReferenceSkeleton;
        var meshReferenceTransformsByBoneName = new Dictionary<string, FTransform>(meshReferenceSkeleton.FinalRefBoneInfo.Length, StringComparer.OrdinalIgnoreCase);
        var meshParentNamesByBoneName = new Dictionary<string, string>(meshReferenceSkeleton.FinalRefBoneInfo.Length, StringComparer.OrdinalIgnoreCase);
        for (var boneIndex = 0; boneIndex < meshReferenceSkeleton.FinalRefBoneInfo.Length; boneIndex++)
        {
            var boneInfo = meshReferenceSkeleton.FinalRefBoneInfo[boneIndex];
            var boneName = boneInfo.Name.Text;
            meshReferenceTransformsByBoneName[boneName] = meshReferenceSkeleton.FinalRefBonePose[boneIndex];
            meshParentNamesByBoneName[boneName] = boneInfo.ParentIndex >= 0
                ? meshReferenceSkeleton.FinalRefBoneInfo[boneInfo.ParentIndex].Name.Text
                : string.Empty;
        }

        var missingInMeshBones = animationReferenceTransformsByBoneName.Keys
            .Except(meshReferenceTransformsByBoneName.Keys, StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();
        var missingInAnimationBones = meshReferenceTransformsByBoneName.Keys
            .Except(animationReferenceTransformsByBoneName.Keys, StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        var boneDifferences = new List<FoxWatchSkeletonReferenceBoneDifference>();
        foreach (var boneName in animationReferenceTransformsByBoneName.Keys.OrderBy(name => name, StringComparer.Ordinal))
        {
            if (!meshReferenceTransformsByBoneName.TryGetValue(boneName, out var meshTransform))
            {
                continue;
            }

            var animationTransform = animationReferenceTransformsByBoneName[boneName];
            var scaleDelta = new FVector(
                Math.Abs(animationTransform.Scale3D.X - meshTransform.Scale3D.X),
                Math.Abs(animationTransform.Scale3D.Y - meshTransform.Scale3D.Y),
                Math.Abs(animationTransform.Scale3D.Z - meshTransform.Scale3D.Z));

            boneDifferences.Add(new FoxWatchSkeletonReferenceBoneDifference
            {
                Name = boneName,
                AnimationParentName = animationParentNamesByBoneName.GetValueOrDefault(boneName, string.Empty),
                MeshParentName = meshParentNamesByBoneName.GetValueOrDefault(boneName, string.Empty),
                TranslationDeltaCentimeters = (animationTransform.Translation - meshTransform.Translation).Size(),
                RotationDeltaDegrees = CalculateRotationDeltaDegrees(animationTransform.Rotation, meshTransform.Rotation),
                ScaleDelta = [scaleDelta.X, scaleDelta.Y, scaleDelta.Z],
            });
        }

        var orderedDifferences = boneDifferences
            .OrderByDescending(difference => difference.TranslationDeltaCentimeters)
            .ThenByDescending(difference => difference.RotationDeltaDegrees)
            .ThenByDescending(difference => difference.ScaleDelta?.Count > 0 ? difference.ScaleDelta.Max() : 0.0)
            .ThenBy(difference => difference.Name, StringComparer.Ordinal)
            .ToList();

        return Task.FromResult(new FoxWatchSkeletonReferenceComparison
        {
            AnimationAssetPath = animationPackagePath,
            ReferenceMeshAssetPath = meshPackagePath,
            AnimationBoneCount = animationReferenceTransformsByBoneName.Count,
            MeshBoneCount = meshReferenceTransformsByBoneName.Count,
            ComparedBoneCount = orderedDifferences.Count,
            MissingInMeshBones = missingInMeshBones,
            MissingInAnimationBones = missingInAnimationBones,
            MaxTranslationDeltaCentimeters = orderedDifferences.Count == 0 ? 0.0 : orderedDifferences.Max(difference => difference.TranslationDeltaCentimeters),
            MaxRotationDeltaDegrees = orderedDifferences.Count == 0 ? 0.0 : orderedDifferences.Max(difference => difference.RotationDeltaDegrees),
            MaxScaleDelta = orderedDifferences.Count == 0
                ? 0.0
                : orderedDifferences.Max(difference => difference.ScaleDelta?.Count > 0 ? difference.ScaleDelta.Max() : 0.0),
            BoneDifferences = orderedDifferences,
        });
    }

    private static Dictionary<string, FTransform> LoadReferenceTransformsByBoneName(USkeleton skeleton)
    {
        var referenceSkeleton = skeleton.ReferenceSkeleton;
        var referenceTransformsByBoneName = new Dictionary<string, FTransform>(referenceSkeleton.FinalRefBoneInfo.Length, StringComparer.OrdinalIgnoreCase);
        for (var boneIndex = 0; boneIndex < referenceSkeleton.FinalRefBoneInfo.Length; boneIndex++)
        {
            referenceTransformsByBoneName[referenceSkeleton.FinalRefBoneInfo[boneIndex].Name.Text] = referenceSkeleton.FinalRefBonePose[boneIndex];
        }

        return referenceTransformsByBoneName;
    }

    private static double CalculateRotationDeltaDegrees(FQuat first, FQuat second)
    {
        first.Normalize();
        second.Normalize();

        var delta = first.Inverse() * second;
        delta.Normalize();

        var clampedW = Math.Clamp(Math.Abs(delta.W), 0.0f, 1.0f);
        return Math.Acos(clampedW) * 360.0 / Math.PI;
    }

    public Task<IReadOnlyList<string>> DumpPackageFilesRawAsync(string assetPath, string outputDirectory, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMounted();

        var packagePath = ResolvePackagePath(assetPath)
            ?? throw new FileNotFoundException($"Could not resolve package '{assetPath}' from mounted Foxhole pak files.");

        var packageFiles = FileProvider.SavePackage(packagePath);
        var writtenFiles = new List<string>(packageFiles.Count);

        foreach (var entry in packageFiles.OrderBy(entry => entry.Key, StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var relativePath = entry.Key.Replace('/', Path.DirectorySeparatorChar);
            var destinationPath = Path.Combine(outputDirectory, relativePath);
            var destinationDirectory = Path.GetDirectoryName(destinationPath);
            if (!string.IsNullOrWhiteSpace(destinationDirectory))
            {
                Directory.CreateDirectory(destinationDirectory);
            }

            File.WriteAllBytes(destinationPath, entry.Value);
            writtenFiles.Add(destinationPath);
        }

        return Task.FromResult<IReadOnlyList<string>>(writtenFiles);
    }

    private FoxWatchMeshExportResult ExportStaticMesh(string packagePath, string objectName, UStaticMesh mesh, string outputDirectory)
    {
        var geometryStopwatch = Stopwatch.StartNew();
        var result = ExportWithFallbacks(
            packagePath,
            objectName,
            outputDirectory,
            "static",
            () => ProbeStaticMeshConversion(packagePath, objectName, mesh),
            format => new MeshExporter(mesh, CreateExporterOptions(format)));
        _logger.LogInformation("Mesh geometry export for {PackagePath} completed in {ElapsedMs} ms", packagePath, geometryStopwatch.ElapsedMilliseconds);

        var materialStopwatch = Stopwatch.StartNew();
        var materialExportStats = ExportReferencedMaterials(mesh.Materials, outputDirectory, result.MeshFormat);
        _logger.LogInformation(
            "Extra material export for {PackagePath} completed in {ElapsedMs} ms ({ExportedCount} exported, {CachedCount} cached, {ExistingCount} existing)",
            packagePath,
            materialStopwatch.ElapsedMilliseconds,
            materialExportStats.ExportedCount,
            materialExportStats.CachedCount,
            materialExportStats.ExistingCount);
        return result;
    }

    private FoxWatchMeshExportResult ExportSkeletalMesh(string packagePath, string objectName, USkeletalMesh mesh, string outputDirectory)
    {
        var geometryStopwatch = Stopwatch.StartNew();
        var result = ExportWithFallbacks(
            packagePath,
            objectName,
            outputDirectory,
            "skeletal",
            () => ProbeSkeletalMeshConversion(packagePath, objectName, mesh),
            format => new MeshExporter(mesh, CreateExporterOptions(format)));
        _logger.LogInformation("Mesh geometry export for {PackagePath} completed in {ElapsedMs} ms", packagePath, geometryStopwatch.ElapsedMilliseconds);

        var materialStopwatch = Stopwatch.StartNew();
        var materialExportStats = ExportReferencedMaterials(mesh.Materials, outputDirectory, result.MeshFormat);
        _logger.LogInformation(
            "Extra material export for {PackagePath} completed in {ElapsedMs} ms ({ExportedCount} exported, {CachedCount} cached, {ExistingCount} existing)",
            packagePath,
            materialStopwatch.ElapsedMilliseconds,
            materialExportStats.ExportedCount,
            materialExportStats.CachedCount,
            materialExportStats.ExistingCount);
        return result;
    }

    private FoxWatchMeshExportResult ExportWithFallbacks(string packagePath, string objectName, string outputDirectory, string meshType, Func<string> conversionProbeFactory, Func<EMeshFormat, MeshExporter> exporterFactory)
    {
        var failures = new List<string>();

        foreach (var meshFormat in PreferredMeshFormats)
        {
            try
            {
                var formatStopwatch = Stopwatch.StartNew();
                var exporter = exporterFactory(meshFormat);
                _logger.LogInformation(
                    "Constructed {MeshFormat} exporter for {PackagePath} in {ElapsedMs} ms",
                    meshFormat,
                    packagePath,
                    formatStopwatch.ElapsedMilliseconds);

                formatStopwatch.Restart();
                if (TryWriteExport(exporter, packagePath, outputDirectory, meshType, meshFormat, out var result))
                {
                    _logger.LogInformation(
                        "Wrote {MeshFormat} export for {PackagePath} in {ElapsedMs} ms",
                        meshFormat,
                        packagePath,
                        formatStopwatch.ElapsedMilliseconds);
                    result.ObjectName = objectName;
                    return result;
                }

                _logger.LogInformation(
                    "{MeshFormat} export for {PackagePath} returned false after {ElapsedMs} ms",
                    meshFormat,
                    packagePath,
                    formatStopwatch.ElapsedMilliseconds);

                failures.Add($"{meshFormat}: exporter returned false");
            }
            catch (Exception exception)
            {
                failures.Add($"{meshFormat}: {exception.GetType().Name}: {exception.Message}");
            }
        }

        var conversionProbe = conversionProbeFactory();
        throw new InvalidOperationException($"Mesh export failed for '{packagePath}' (object '{objectName}'). Conversion probe: {conversionProbe}. Attempts: {string.Join(" | ", failures)}");
    }

    private static ExporterOptions CreateExporterOptions(EMeshFormat meshFormat)
    {
        return new ExporterOptions
        {
            AnimFormat = meshFormat == EMeshFormat.UEFormat ? EAnimFormat.UEFormat : EAnimFormat.ActorX,
            CompressionFormat = EFileCompressionFormat.ZSTD,
            ExportMaterials = false,
            ExportMorphTargets = true,
            LodFormat = ELodFormat.FirstLod,
            MaterialFormat = EMaterialFormat.AllLayers,
            MeshFormat = meshFormat,
            Platform = ETexturePlatform.DesktopMobile,
            SocketFormat = meshFormat == EMeshFormat.ActorX ? ESocketFormat.Bone : ESocketFormat.None,
            TextureFormat = ETextureFormat.Png,
        };
    }

    private (int ExportedCount, int CachedCount, int ExistingCount) ExportReferencedMaterials(IEnumerable<ResolvedObject?> materials, string outputDirectory, string meshFormatName)
    {
        var exportOptions = CreateExporterOptions(ParseMeshFormat(meshFormatName));
        var outputDirectoryInfo = new DirectoryInfo(outputDirectory);
        outputDirectoryInfo.Create();
        var exportedMaterialNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var exportedCount = 0;
        var cachedCount = 0;
        var existingCount = 0;

        foreach (var materialReference in materials)
        {
            if (materialReference?.Load<UMaterialInterface>() is not { } material)
            {
                continue;
            }

            var materialName = material.Name;
            if (string.IsNullOrWhiteSpace(materialName) || !exportedMaterialNames.Add(materialName))
            {
                continue;
            }

            var materialCacheKey = CreateMaterialCacheKey(outputDirectory, material);
            if (!_exportedMaterialSidecarKeys.TryAdd(materialCacheKey, 0))
            {
                cachedCount += 1;
                continue;
            }

            if (IsMaterialAlreadyExported(outputDirectory, material, exportOptions))
            {
                existingCount += 1;
                continue;
            }

            try
            {
                var materialStopwatch = Stopwatch.StartNew();
                var exporter = new MaterialExporter2(material, exportOptions);
                exporter.TryWriteToDir(outputDirectoryInfo, out _, out _);
                exportedCount += 1;
                if (materialStopwatch.ElapsedMilliseconds >= 250)
                {
                    _logger.LogInformation(
                        "Exported material sidecar {MaterialKey} in {ElapsedMs} ms",
                        materialCacheKey,
                        materialStopwatch.ElapsedMilliseconds);
                }
            }
            catch (Exception exception)
            {
                _exportedMaterialSidecarKeys.TryRemove(materialCacheKey, out _);
                _logger.LogWarning(exception, "Skipping material sidecar export for {MaterialName}", materialName);
            }
        }

        return (exportedCount, cachedCount, existingCount);
    }

    private static string CreateMaterialCacheKey(string outputDirectory, UMaterialInterface material)
    {
        return $"{outputDirectory}|{GetMaterialInternalPath(material)}";
    }

    private static bool IsMaterialAlreadyExported(string outputDirectory, UMaterialInterface material, ExporterOptions exportOptions)
    {
        var materialOutputPath = BuildMaterialSidecarPath(outputDirectory, material);
        if (!File.Exists(materialOutputPath))
        {
            return false;
        }

        var parameters = new CMaterialParams2();
        material.GetParams(parameters, exportOptions.MaterialFormat);

        foreach (var texture in parameters.Textures.Values.OfType<UTexture2D>())
        {
            if (!TextureOutputExists(outputDirectory, texture, exportOptions))
            {
                return false;
            }
        }

        return true;
    }

    private static bool TextureOutputExists(string outputDirectory, UTexture2D texture, ExporterOptions exportOptions)
    {
        var textureInternalPath = GetTextureInternalPath(texture);
        var preferredExtension = exportOptions.ExportHdrTexturesAsHdr && PixelFormatUtils.IsHDR(texture.Format)
            ? "hdr"
            : GetTextureFileExtension(exportOptions.TextureFormat);

        if (File.Exists(BuildOutputPath(outputDirectory, textureInternalPath, preferredExtension)))
        {
            return true;
        }

        if (string.Equals(preferredExtension, "hdr", StringComparison.OrdinalIgnoreCase))
        {
            return File.Exists(BuildOutputPath(outputDirectory, textureInternalPath, "png"));
        }

        return File.Exists(BuildOutputPath(outputDirectory, textureInternalPath, "hdr"));
    }

    private static string BuildMaterialSidecarPath(string outputDirectory, UMaterialInterface material)
    {
        return BuildOutputPath(outputDirectory, GetMaterialInternalPath(material), "json");
    }

    private static string BuildOutputPath(string outputDirectory, string internalPath, string extension)
    {
        var normalizedPath = internalPath.Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
        return Path.Combine(outputDirectory, normalizedPath) + $".{extension}";
    }

    private static string GetMaterialInternalPath(UMaterialInterface material)
    {
        var materialPath = material.Owner?.Provider?.FixPath(material.Owner?.Name ?? material.GetPathName())
            ?? material.GetPathName();
        return TrimObjectSuffix(materialPath);
    }

    private static string GetTextureInternalPath(UTexture2D texture)
    {
        var texturePath = texture.Owner?.Provider?.FixPath(texture.Owner?.Name ?? texture.GetPathName())
            ?? texture.GetPathName();
        return TrimObjectSuffix(texturePath);
    }

    private static string TrimObjectSuffix(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return string.Empty;
        }

        var trimmed = path.Trim().TrimStart('/');
        var dotIndex = trimmed.LastIndexOf('.');
        return dotIndex > 0 ? trimmed[..dotIndex] : trimmed;
    }

    private static string GetTextureFileExtension(ETextureFormat textureFormat)
    {
        return textureFormat switch
        {
            ETextureFormat.Png => "png",
            ETextureFormat.Jpeg => "jpg",
            ETextureFormat.Tga => "tga",
            ETextureFormat.Dds => "dds",
            _ => "png",
        };
    }

    private static EMeshFormat ParseMeshFormat(string meshFormatName)
    {
        return Enum.TryParse<EMeshFormat>(meshFormatName, ignoreCase: true, out var parsedFormat)
            ? parsedFormat
            : EMeshFormat.Gltf2;
    }

    private static FVector SwapYzAndScale(FVector vector)
    {
        var swapped = SwapYz(vector);
        swapped.Scale(0.01f);
        return swapped;
    }

    private static FVector SwapYz(FVector vector)
    {
        return new FVector(vector.X, vector.Z, vector.Y);
    }

    private static FQuat SwapYz(FQuat quaternion)
    {
        return new FQuat(-quaternion.X, -quaternion.Z, -quaternion.Y, quaternion.W);
    }

    private string ProbeStaticMeshConversion(string packagePath, string objectName, UStaticMesh mesh)
    {
        try
        {
            if (mesh.RenderData == null)
            {
                var renderDataDetail = $"RenderData is null (bCooked={mesh.bCooked})";
                _logger.LogInformation("Static mesh conversion probe for {PackagePath} ({ObjectName}): {Detail}", packagePath, objectName, renderDataDetail);
                return renderDataDetail;
            }

            if (mesh.RenderData.Bounds == null)
            {
                const string boundsDetail = "RenderData.Bounds is null";
                _logger.LogInformation("Static mesh conversion probe for {PackagePath} ({ObjectName}): {Detail}", packagePath, objectName, boundsDetail);
                return boundsDetail;
            }

            if (mesh.RenderData.LODs == null)
            {
                const string lodsDetail = "RenderData.LODs is null";
                _logger.LogInformation("Static mesh conversion probe for {PackagePath} ({ObjectName}): {Detail}", packagePath, objectName, lodsDetail);
                return lodsDetail;
            }

            var converted = MeshConverter.TryConvert(mesh, out var convertedMesh);
            var detail = converted
                ? $"TryConvert succeeded ({convertedMesh?.GetType().Name ?? "null"}; source LODs={mesh.RenderData.LODs.Length}; converted LODs={convertedMesh?.LODs.Count ?? 0})"
                : $"TryConvert returned false (source LODs={mesh.RenderData.LODs.Length})";

            _logger.LogInformation("Static mesh conversion probe for {PackagePath} ({ObjectName}): {Detail}", packagePath, objectName, detail);
            return detail;
        }
        catch (Exception exception)
        {
            var detail = $"TryConvert threw {exception.GetType().Name}: {exception.Message}";
            _logger.LogWarning(exception, "Static mesh conversion probe failed for {PackagePath} ({ObjectName})", packagePath, objectName);
            return detail;
        }
    }

    private string ProbeSkeletalMeshConversion(string packagePath, string objectName, USkeletalMesh mesh)
    {
        try
        {
            var converted = MeshConverter.TryConvert(mesh, out var convertedMesh);
            var detail = converted
                ? $"TryConvert succeeded ({convertedMesh?.GetType().Name ?? "null"})"
                : "TryConvert returned false";

            _logger.LogInformation("Skeletal mesh conversion probe for {PackagePath} ({ObjectName}): {Detail}", packagePath, objectName, detail);
            return detail;
        }
        catch (Exception exception)
        {
            var detail = $"TryConvert threw {exception.GetType().Name}: {exception.Message}";
            _logger.LogWarning(exception, "Skeletal mesh conversion probe failed for {PackagePath} ({ObjectName})", packagePath, objectName);
            return detail;
        }
    }

    private bool TryWriteExport(MeshExporter exporter, string packagePath, string outputDirectory, string meshType, EMeshFormat meshFormat, out FoxWatchMeshExportResult result)
    {
        var directory = new DirectoryInfo(outputDirectory);
        directory.Create();

        if (!exporter.TryWriteToDir(directory, out var label, out var savedFilePath))
        {
            result = new FoxWatchMeshExportResult();
            return false;
        }

        result = new FoxWatchMeshExportResult
        {
            AssetPath = packagePath,
            MeshType = meshType,
            MeshFormat = meshFormat.ToString(),
            Label = label,
            SavedFilePath = savedFilePath,
        };

        return true;
    }

    private void LogSelectedExport(string packagePath, UObject selectedExport, IReadOnlyCollection<UObject> allExports)
    {
        var candidates = string.Join(", ", allExports
            .Where(export => export is UStaticMesh or USkeletalMesh)
            .Select(export => $"{export.ExportType}:{export.Name}")
            .Take(10));

        _logger.LogInformation(
            "Selected export {ExportType}:{ObjectName} from {PackagePath}. Mesh candidates: {Candidates}",
            selectedExport.ExportType,
            selectedExport.Name,
            packagePath,
            string.IsNullOrWhiteSpace(candidates) ? "<none>" : candidates);
    }

    private static TMesh? SelectPreferredExport<TMesh>(IReadOnlyList<TMesh> exports, string preferredObjectName)
        where TMesh : UObject
    {
        if (exports.Count == 0)
        {
            return null;
        }

        return exports.FirstOrDefault(export => string.Equals(export.Name, preferredObjectName, StringComparison.OrdinalIgnoreCase))
            ?? exports.FirstOrDefault(export => string.Equals(export.Name, $"Default__{preferredObjectName}", StringComparison.OrdinalIgnoreCase))
            ?? exports[0];
    }

    private string? ResolvePackagePath(string assetPath)
    {
        var normalized = assetPath.Replace('\\', '/').Trim();
        if (FileProvider.Files.ContainsKey(normalized))
        {
            return normalized;
        }

        if (!normalized.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
        {
            var withExtension = $"{normalized}.uasset";
            if (FileProvider.Files.ContainsKey(withExtension))
            {
                return withExtension;
            }
        }

        return FileProvider.Files.Keys.FirstOrDefault(path => string.Equals(path, normalized, StringComparison.OrdinalIgnoreCase))
            ?? FileProvider.Files.Keys.FirstOrDefault(path => string.Equals(path, $"{normalized}.uasset", StringComparison.OrdinalIgnoreCase));
    }

    private static string NormalizeMeshAssetPath(string assetPath)
    {
        var normalized = assetPath.Replace('\\', '/').Trim();
        return normalized.EndsWith(".glb", StringComparison.OrdinalIgnoreCase)
            ? $"{normalized[..^4]}.uasset"
            : normalized;
    }

    private DefaultFileProvider EnsureMounted()
    {
        if (_mounted)
        {
            return _fileProvider ?? throw new InvalidOperationException("FoxWatch pak file provider is not initialized.");
        }

        if (string.IsNullOrWhiteSpace(_pakDirectoryPath) || !Directory.Exists(_pakDirectoryPath))
        {
            throw new DirectoryNotFoundException($"Foxhole pak directory is unavailable: {_pakDirectoryPath}");
        }

        _fileProvider ??= CreateFileProvider(_pakDirectoryPath);
        _fileProvider.Mount();
        _mounted = true;
        return _fileProvider;
    }

    private DefaultFileProvider CreateFileProvider(string pakDirectoryPath)
    {
        var fileProvider = new DefaultFileProvider(
            pakDirectoryPath,
            SearchOption.TopDirectoryOnly,
            new VersionContainer(EngineVersion),
            StringComparer.OrdinalIgnoreCase);
        fileProvider.Initialize();

        _logger.LogInformation("Initialized mesh asset exporter with engine version {EngineVersion}", EngineVersion);
        return fileProvider;
    }

    private FoxWatchBlueprintComponentReference? CreateBlueprintComponentReference(string componentName, UActorComponent component)
    {
        switch (component)
        {
            case UStaticMeshComponent staticMeshComponent:
            {
                var mesh = staticMeshComponent.GetLoadedStaticMesh();
                if (mesh == null)
                {
                    return null;
                }

                var componentReference = new FoxWatchBlueprintComponentReference
                {
                    SourceClassName = component.Class?.Name.Text ?? string.Empty,
                    ComponentName = componentName,
                    ComponentType = component.ExportType,
                    DataClassPath = GetReferencedPackagePath(component, "DataClass"),
                    MeshType = "static",
                    MeshName = mesh.Name,
                    MeshPath = GetPackagePath(mesh),
                    AttachParentName = staticMeshComponent.GetAttachParent()?.Name ?? string.Empty,
                    AttachSocketName = GetAttachSocketName(staticMeshComponent),
                    RelativeLocation = staticMeshComponent.GetRelativeLocation().ToString(),
                    RelativeRotation = staticMeshComponent.GetRelativeRotation().ToString(),
                    RelativeScale = staticMeshComponent.GetRelativeScale3D().ToString(),
                    AbsoluteLocation = staticMeshComponent.GetAbsoluteTransform().Translation.ToString(),
                    AbsoluteRotation = staticMeshComponent.GetAbsoluteTransform().Rotator().ToString(),
                    AbsoluteScale = staticMeshComponent.GetAbsoluteTransform().Scale3D.ToString(),
                    IsVisible = IsComponentVisible(component),
                    IsHiddenInGame = IsComponentHiddenInGame(component),
                };
                ApplyComponentMetadata(componentReference, component);
                return componentReference;
            }
            case USkeletalMeshComponent skeletalMeshComponent:
            {
                var meshIndex = skeletalMeshComponent.GetSkeletalMesh();
                if (meshIndex.IsNull)
                {
                    return null;
                }

                var mesh = meshIndex.Load<USkeletalMesh>();
                if (mesh == null)
                {
                    return null;
                }

                var componentReference = new FoxWatchBlueprintComponentReference
                {
                    SourceClassName = component.Class?.Name.Text ?? string.Empty,
                    ComponentName = componentName,
                    ComponentType = component.ExportType,
                    DataClassPath = GetReferencedPackagePath(component, "DataClass"),
                    AnimationClassPath = GetReferencedPackagePath(component, "AnimClass"),
                    MeshType = "skeletal",
                    MeshName = mesh.Name,
                    MeshPath = GetPackagePath(mesh),
                    AttachParentName = skeletalMeshComponent.GetAttachParent()?.Name ?? string.Empty,
                    AttachSocketName = GetAttachSocketName(skeletalMeshComponent),
                    RelativeLocation = skeletalMeshComponent.GetRelativeLocation().ToString(),
                    RelativeRotation = skeletalMeshComponent.GetRelativeRotation().ToString(),
                    RelativeScale = skeletalMeshComponent.GetRelativeScale3D().ToString(),
                    AbsoluteLocation = skeletalMeshComponent.GetAbsoluteTransform().Translation.ToString(),
                    AbsoluteRotation = skeletalMeshComponent.GetAbsoluteTransform().Rotator().ToString(),
                    AbsoluteScale = skeletalMeshComponent.GetAbsoluteTransform().Scale3D.ToString(),
                    IsVisible = IsComponentVisible(component),
                    IsHiddenInGame = IsComponentHiddenInGame(component),
                };
                ApplyComponentMetadata(componentReference, component);
                return componentReference;
            }
            case USceneComponent sceneComponent:
            {
                var meshPath = GetAircraftPartSlotMeshPath(component);
                var componentReference = new FoxWatchBlueprintComponentReference
                {
                    SourceClassName = component.Class?.Name.Text ?? string.Empty,
                    ComponentName = componentName,
                    ComponentType = component.ExportType,
                    DataClassPath = GetReferencedPackagePath(component, "DataClass"),
                    MeshType = string.IsNullOrWhiteSpace(meshPath) ? string.Empty : "skeletal",
                    MeshName = GetObjectNameFromPackagePath(meshPath),
                    MeshPath = meshPath,
                    AttachParentName = sceneComponent.GetAttachParent()?.Name ?? string.Empty,
                    AttachSocketName = GetAttachSocketName(sceneComponent),
                    RelativeLocation = sceneComponent.GetRelativeLocation().ToString(),
                    RelativeRotation = sceneComponent.GetRelativeRotation().ToString(),
                    RelativeScale = sceneComponent.GetRelativeScale3D().ToString(),
                    AbsoluteLocation = sceneComponent.GetAbsoluteTransform().Translation.ToString(),
                    AbsoluteRotation = sceneComponent.GetAbsoluteTransform().Rotator().ToString(),
                    AbsoluteScale = sceneComponent.GetAbsoluteTransform().Scale3D.ToString(),
                    IsVisible = IsComponentVisible(component),
                    IsHiddenInGame = IsComponentHiddenInGame(component),
                };

                ApplyComponentMetadata(componentReference, component);
                ApplyClassDefaultTransformFallback(componentReference, component);
                return componentReference;
            }
            default:
                return null;
        }
    }

    private FoxWatchBlueprintComponentReference? CreateBlueprintComponentReference(string componentName, UObject export, bool allowTransformTemplate = false)
    {
        if (export is UActorComponent actorComponent)
        {
            var actorComponentReference = CreateBlueprintComponentReference(componentName, actorComponent);
            if (actorComponentReference != null || !allowTransformTemplate)
            {
                return actorComponentReference;
            }
        }

        if (!allowTransformTemplate && HasRenderRelevantTransformlessComponentData(export))
        {
            allowTransformTemplate = true;
        }

        if (!allowTransformTemplate &&
            !export.ExportType.EndsWith("Component", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var hasRelativeLocation = TryReadVector(export, "RelativeLocation", out var relativeLocation);
        var hasRelativeRotation = TryReadRotator(export, "RelativeRotation", out var relativeRotation);

        var staticMeshPath = GetReferencedPackagePath(export, "StaticMesh");
        var skeletalMeshPath = GetReferencedPackagePath(export, "SkeletalMesh");
        var genericMeshPath = GetReferencedPackagePath(export, "Mesh");
        var itemMeshPath = GetReferencedPackagePath(export, "ItemMesh");
        var attachedItemMeshPath = GetReferencedPackagePath(export, "AttachedItemMesh");
        var animationClassPath = GetReferencedPackagePath(export, "AnimClass");
        var meshPath = !string.IsNullOrWhiteSpace(staticMeshPath)
            ? staticMeshPath
            : !string.IsNullOrWhiteSpace(skeletalMeshPath)
                ? skeletalMeshPath
                : !string.IsNullOrWhiteSpace(genericMeshPath)
                    ? genericMeshPath
                    : !string.IsNullOrWhiteSpace(itemMeshPath)
                        ? itemMeshPath
                        : attachedItemMeshPath;
        var meshType = !string.IsNullOrWhiteSpace(staticMeshPath)
            ? "static"
            : !string.IsNullOrWhiteSpace(skeletalMeshPath)
                ? "skeletal"
                : string.Empty;

        if (string.IsNullOrWhiteSpace(meshType) && !string.IsNullOrWhiteSpace(genericMeshPath))
        {
            meshType = ResolveMeshType(genericMeshPath);
        }

        if (string.IsNullOrWhiteSpace(meshPath))
        {
            meshPath = GetAircraftPartSlotMeshPath(export);
            if (!string.IsNullOrWhiteSpace(meshPath))
            {
                meshType = "skeletal";
            }
        }

        if (!hasRelativeLocation && !hasRelativeRotation)
        {
            if (!allowTransformTemplate)
            {
                return null;
            }

            var transformTemplateReference = new FoxWatchBlueprintComponentReference
            {
                SourceClassName = export.Class?.Name.Text ?? string.Empty,
                ComponentName = componentName,
                ComponentType = export.ExportType,
                DataClassPath = GetReferencedPackagePath(export, "DataClass"),
                AnimationClassPath = animationClassPath,
                MeshType = meshType,
                MeshName = GetObjectNameFromPackagePath(meshPath),
                MeshPath = meshPath,
                AttachParentName = export.GetOrDefault<ResolvedObject?>("AttachParent")?.Name.Text ?? string.Empty,
                AttachSocketName = GetAttachSocketName(export),
                RelativeLocation = string.Empty,
                RelativeRotation = string.Empty,
                RelativeScale = string.Empty,
                AbsoluteLocation = string.Empty,
                AbsoluteRotation = string.Empty,
                AbsoluteScale = string.Empty,
                IsVisible = IsComponentVisible(export),
                IsHiddenInGame = IsComponentHiddenInGame(export),
            };

            ApplyComponentMetadata(transformTemplateReference, export);
            ApplyClassDefaultTransformFallback(transformTemplateReference, export);
            return transformTemplateReference;
        }

        TryReadVector(export, "RelativeScale3D", out var relativeScale);
        if (relativeScale == default)
        {
            relativeScale = new FVector(1.0f, 1.0f, 1.0f);
        }

        var attachParent = export.GetOrDefault<ResolvedObject?>("AttachParent");

        var componentReference = new FoxWatchBlueprintComponentReference
        {
            SourceClassName = export.Class?.Name.Text ?? string.Empty,
            ComponentName = componentName,
            ComponentType = export.ExportType,
            DataClassPath = GetReferencedPackagePath(export, "DataClass"),
            MeshType = meshType,
            MeshName = GetObjectNameFromPackagePath(meshPath),
            MeshPath = meshPath,
            AttachParentName = attachParent?.Name.Text ?? string.Empty,
            AttachSocketName = GetAttachSocketName(export),
            RelativeLocation = hasRelativeLocation ? relativeLocation.ToString() : string.Empty,
            RelativeRotation = hasRelativeRotation ? relativeRotation.ToString() : string.Empty,
            RelativeScale = relativeScale.ToString(),
            AbsoluteLocation = string.Empty,
            AbsoluteRotation = string.Empty,
            AbsoluteScale = string.Empty,
            IsVisible = IsComponentVisible(export),
            IsHiddenInGame = IsComponentHiddenInGame(export),
        };

        ApplyComponentMetadata(componentReference, export);
        ApplyClassDefaultTransformFallback(componentReference, export);
        return componentReference;
    }

    private void ApplyClassDefaultTransformFallback(FoxWatchBlueprintComponentReference targetReference, UObject export)
    {
        var shouldApplyTransform = ShouldApplyClassDefaultTransformFallback(targetReference);
        var shouldFillEmptySocketTags = targetReference.SocketTags.Count == 0 &&
            LooksLikeBuildSocketReference(targetReference);
        if (!shouldApplyTransform && !shouldFillEmptySocketTags)
        {
            return;
        }

        var classPackagePath = ConvertObjectPathToPackagePath(export.Class?.GetPathName());
        if (string.IsNullOrWhiteSpace(classPackagePath))
        {
            return;
        }

        try
        {
            var package = FileProvider.LoadPackage(classPackagePath);
            var exports = package.GetExports().OfType<UObject>().ToArray();
            var blueprintClass = exports.OfType<UBlueprintGeneratedClass>().FirstOrDefault();
            if (blueprintClass == null)
            {
                return;
            }

            var defaultObjectName = $"Default__{blueprintClass.Name}";
            var defaultObject = exports.FirstOrDefault(candidate =>
                string.Equals(candidate.Name, defaultObjectName, StringComparison.OrdinalIgnoreCase));
            if (defaultObject == null)
            {
                return;
            }

            if (shouldApplyTransform)
            {
                if (ShouldReplaceRelativeLocationFromClassDefault(targetReference) &&
                    TryReadVector(defaultObject, "RelativeLocation", out var relativeLocation))
                {
                    targetReference.RelativeLocation = relativeLocation.ToString();
                }

                if (ShouldReplaceRelativeRotationFromClassDefault(targetReference) &&
                    TryReadRotator(defaultObject, "RelativeRotation", out var relativeRotation))
                {
                    targetReference.RelativeRotation = relativeRotation.ToString();
                }

                if (string.IsNullOrWhiteSpace(targetReference.RelativeScale) &&
                    TryReadVector(defaultObject, "RelativeScale3D", out var relativeScale))
                {
                    targetReference.RelativeScale = relativeScale.ToString();
                }

                ApplyBuildSocketMetadata(targetReference, defaultObject);
            }
            else if (shouldFillEmptySocketTags)
            {
                ApplyBuildSocketMetadata(targetReference, defaultObject);
            }
        }
        catch
        {
        }
    }

    private static bool ShouldApplyClassDefaultTransformFallback(FoxWatchBlueprintComponentReference targetReference)
    {
        if (string.IsNullOrWhiteSpace(targetReference.RelativeLocation) &&
            string.IsNullOrWhiteSpace(targetReference.RelativeRotation))
        {
            return true;
        }

        if (!LooksLikeBuildSocketReference(targetReference))
        {
            return false;
        }

        return (ShouldReplaceRelativeLocationFromClassDefault(targetReference) ||
                ShouldReplaceRelativeRotationFromClassDefault(targetReference)) &&
            IsIdentityVectorText(targetReference.AbsoluteLocation);
    }

    private static bool ShouldReplaceRelativeLocationFromClassDefault(FoxWatchBlueprintComponentReference targetReference)
    {
        if (string.IsNullOrWhiteSpace(targetReference.RelativeLocation))
        {
            return true;
        }

        return LooksLikeBuildSocketReference(targetReference) &&
            IsIdentityVectorText(targetReference.RelativeLocation) &&
            IsIdentityVectorText(targetReference.AbsoluteLocation);
    }

    private static bool ShouldReplaceRelativeRotationFromClassDefault(FoxWatchBlueprintComponentReference targetReference)
    {
        if (string.IsNullOrWhiteSpace(targetReference.RelativeRotation))
        {
            return true;
        }

        return LooksLikeBuildSocketReference(targetReference) &&
            IsIdentityRotatorText(targetReference.RelativeRotation) &&
            IsIdentityVectorText(targetReference.AbsoluteLocation);
    }

    private static bool LooksLikeBuildSocketReference(FoxWatchBlueprintComponentReference targetReference)
    {
        return ContainsBuildSocketToken(targetReference.ComponentType) ||
            ContainsBuildSocketToken(targetReference.ComponentName) ||
            ContainsBuildSocketToken(targetReference.SourceClassName);
    }

    private static bool ContainsBuildSocketToken(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return value.Contains("Socket", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("PipelineInput", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("PipelineOutput", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("PipeInput", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("PipeOutput", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsIdentityVectorText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return true;
        }

        return TryParseVector(value, out var vector) &&
            Math.Abs(vector.X) <= 0.0001f &&
            Math.Abs(vector.Y) <= 0.0001f &&
            Math.Abs(vector.Z) <= 0.0001f;
    }

    private static bool IsIdentityRotatorText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return true;
        }

        return TryParseRotator(value, out var rotator) &&
            Math.Abs(rotator.Pitch) <= 0.0001f &&
            Math.Abs(rotator.Yaw) <= 0.0001f &&
            Math.Abs(rotator.Roll) <= 0.0001f;
    }

    private static bool TryParseVector(string value, out FVector parsedVector)
    {
        var match = VectorPattern.Match(value ?? string.Empty);
        if (!match.Success)
        {
            parsedVector = default;
            return false;
        }

        parsedVector = new FVector(
            (float)ParseInvariantDouble(match.Groups["x"].Value),
            (float)ParseInvariantDouble(match.Groups["y"].Value),
            (float)ParseInvariantDouble(match.Groups["z"].Value));
        return true;
    }

    private static bool TryParseRotator(string value, out FRotator parsedRotator)
    {
        var match = RotatorPattern.Match(value ?? string.Empty);
        if (!match.Success)
        {
            parsedRotator = default;
            return false;
        }

        parsedRotator = new FRotator(
            (float)ParseInvariantDouble(match.Groups["pitch"].Value),
            (float)ParseInvariantDouble(match.Groups["yaw"].Value),
            (float)ParseInvariantDouble(match.Groups["roll"].Value));
        return true;
    }

    private static double ParseInvariantDouble(string value)
    {
        return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : 0;
    }

    private static bool HasRenderRelevantTransformlessComponentData(UObject export)
    {
        return export.ExportType.Contains("SplineConnectorComponent", StringComparison.OrdinalIgnoreCase) ||
            export.Class?.Name.Text.Contains("SplineConnectorComponent", StringComparison.OrdinalIgnoreCase) == true ||
            export.ExportType.Contains("StaticMeshOverrideComponent", StringComparison.OrdinalIgnoreCase) ||
            export.Class?.Name.Text.Contains("StaticMeshOverrideComponent", StringComparison.OrdinalIgnoreCase) == true;
    }

    private void ApplyComponentMetadata(FoxWatchBlueprintComponentReference targetReference, UObject export)
    {
        ApplyBuildSocketMetadata(targetReference, export);
        ApplyComponentTagsMetadata(targetReference, export);
        ApplySplineConnectorMetadata(targetReference, export);
        ApplyStaticMeshOverrideMetadata(targetReference, export);
    }

    private static void ApplyComponentTagsMetadata(FoxWatchBlueprintComponentReference targetReference, UObject export)
    {
        var componentTags = new List<string>();
        foreach (var tag in export.GetOrDefault<string[]>("ComponentTags", []))
        {
            var normalized = tag?.Trim() ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(normalized) &&
                !string.Equals(normalized, "None", StringComparison.OrdinalIgnoreCase))
            {
                componentTags.Add(normalized);
            }
        }

        if (componentTags.Count == 0)
        {
            foreach (var tag in export.GetOrDefault<FName[]>("ComponentTags", []))
            {
                var normalized = tag.Text?.Trim() ?? string.Empty;
                if (!string.IsNullOrWhiteSpace(normalized) &&
                    !string.Equals(normalized, "None", StringComparison.OrdinalIgnoreCase))
                {
                    componentTags.Add(normalized);
                }
            }
        }

        targetReference.ComponentTags = componentTags;
    }

    private static void ApplyBuildSocketMetadata(FoxWatchBlueprintComponentReference targetReference, UObject export)
    {
        var socketTags = export.GetOrDefault<FStructFallback[]>("SocketTags", []);
        if (socketTags.Length == 0)
        {
            return;
        }

        targetReference.SocketTags =
        [
            .. socketTags
                .Select(tag => new FoxWatchBlueprintSocketTagReference
                {
                    Mask = tag.GetOrDefault<long?>("SocketTypeMask"),
                    Category = tag.GetOrDefault<long?>("SocketTypeCategory"),
                    Tag = NormalizeOptionalNameTag(
                        tag.GetOrDefault<string>("Tag")
                        ?? tag.GetOrDefault<FName>("Tag").Text),
                })
                .Where(tag => tag.Mask != null || tag.Category != null || !string.IsNullOrWhiteSpace(tag.Tag))
        ];
    }

    private void ApplySplineConnectorMetadata(FoxWatchBlueprintComponentReference targetReference, UObject export)
    {
        if (!targetReference.ComponentType.Contains("SplineConnectorComponent", StringComparison.OrdinalIgnoreCase) &&
            !targetReference.SourceClassName.Contains("SplineConnectorComponent", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        if (export.TryGetValue(out FStructFallback defaultTarget, "DefaultTarget") &&
            TryReadStructVector(defaultTarget, "Translation", out var defaultTargetTranslation))
        {
            targetReference.SplineDefaultTargetUnrealLocationCentimeters =
            [
                defaultTargetTranslation.X,
                defaultTargetTranslation.Y,
                defaultTargetTranslation.Z,
            ];
        }

        targetReference.SplinePathMode = export.GetOrDefault<string>("PathMode");
        targetReference.SplineMinBufferCentimeters = export.GetOrDefault<float?>("MinBuffer");
        targetReference.SplineMinRadiusCentimeters = export.GetOrDefault<float?>("MinRadius");
        targetReference.SplineMaxRadiusCentimeters = export.GetOrDefault<float?>("MaxRadius");
        targetReference.SplineMaxBufferCentimeters = export.GetOrDefault<float?>("MaxBuffer");
        targetReference.SplineEnforceCornerRadius = export.GetOrDefault<bool?>("bEnforceSplineModeCornerRadius");
        targetReference.SplineMaxArcAngleDegrees = export.GetOrDefault<float?>("MaxArcAngle");
        targetReference.SplineMaxTargetAngleDegrees = export.GetOrDefault<float?>("MaxTargetAngle");
        targetReference.SplineMaxSlopeAngleDegrees = export.GetOrDefault<float?>("MaxSlopeAngle");

        targetReference.SplineConnectorMeshConfigs =
        [
            .. export.GetOrDefault<FStructFallback[]>("MeshConfigs", [])
                .Select(fallback => CreateSplineConnectorMeshConfigReference(fallback))
                .Where(config => config.MeshPaths.Count > 0 && !config.IsCollisionOnly)
        ];

        targetReference.SplineComponentConfigs =
        [
            .. export.GetOrDefault<FStructFallback[]>("ComponentConfigs", [])
                .Select(CreateSplineConnectorComponentConfigReference)
                .Where(config => !string.IsNullOrWhiteSpace(config.ComponentName))
        ];
    }

    private static void ApplyStaticMeshOverrideMetadata(FoxWatchBlueprintComponentReference targetReference, UObject export)
    {
        if (!targetReference.ComponentType.Contains("StaticMeshOverrideComponent", StringComparison.OrdinalIgnoreCase) &&
            !targetReference.SourceClassName.Contains("StaticMeshOverrideComponent", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        targetReference.StaticMeshOverrides =
        [
            .. export.GetOrDefault<FStructFallback[]>("StaticMeshOverrides", [])
                .Select(CreateStaticMeshOverrideReference)
                .Where(overrideReference =>
                    !string.IsNullOrWhiteSpace(overrideReference.TargetMeshPath) &&
                    !string.IsNullOrWhiteSpace(overrideReference.OverrideMeshPath))
        ];
    }

    private static FoxWatchStaticMeshOverrideReference CreateStaticMeshOverrideReference(FStructFallback fallback)
    {
        return new FoxWatchStaticMeshOverrideReference
        {
            TargetMeshPath = ReadResolvedObjectPackagePath(fallback, "Target") ?? string.Empty,
            OverrideMeshPath = ReadResolvedObjectPackagePath(fallback, "Override") ?? string.Empty,
        };
    }

    private static FoxWatchSplineConnectorComponentConfigReference CreateSplineConnectorComponentConfigReference(FStructFallback fallback)
    {
        List<double>? relativeLocation = TryReadStructTransformTranslation(fallback, "RelativeTransform", out var translation)
            ? [translation.X, translation.Y, translation.Z]
            : null;
        List<double>? relativeRotation = TryReadStructTransformRotationDegrees(fallback, "RelativeTransform", out var rotation)
            ? [rotation.Pitch, rotation.Yaw, rotation.Roll]
            : null;

        return new FoxWatchSplineConnectorComponentConfigReference
        {
            ComponentName = ReadFallbackString(fallback, "ComponentName"),
            Distance = fallback.GetOrDefault<float?>("Distance"),
            RelativeLocation = relativeLocation,
            RelativeRotation = relativeRotation,
        };
    }

    private FoxWatchSplineConnectorMeshConfigReference CreateSplineConnectorMeshConfigReference(FStructFallback fallback)
    {
        var meshPaths = new List<string>();
        var primaryMeshPath = ReadResolvedObjectPackagePath(fallback, "Mesh");
        if (!string.IsNullOrWhiteSpace(primaryMeshPath))
        {
            meshPaths.Add(primaryMeshPath);
        }

        foreach (var meshReference in fallback.GetOrDefault<ResolvedObject[]>("Meshes", []))
        {
            var meshPath = ConvertObjectPathToPackagePath(meshReference?.GetPathName());
            if (!string.IsNullOrWhiteSpace(meshPath))
            {
                meshPaths.Add(meshPath);
            }
        }

        List<double>? relativeLocation = TryReadStructTransformTranslation(fallback, "RelativeTransform", out var translation)
            ? [translation.X, translation.Y, translation.Z]
            : null;
        List<double>? relativeScale = TryReadStructTransformScale(fallback, "RelativeTransform", out var scale)
            ? [scale.X, scale.Y, scale.Z]
            : null;
        var splineMeshAxis = ReadFallbackString(fallback, "SplineMeshAxis");
        var nativeMeshLengthCentimeters = ResolveMeshAxisLengthCentimeters(meshPaths.FirstOrDefault(), NormalizeSplineMeshAxis(splineMeshAxis));

        return new FoxWatchSplineConnectorMeshConfigReference
        {
            Mode = ReadFallbackString(fallback, "Mode"),
            MeshPaths = [.. meshPaths.Distinct(StringComparer.OrdinalIgnoreCase)],
            IsCollisionOnly = fallback.GetOrDefault<bool>("bCollisionOnly"),
            SplineMeshAxis = splineMeshAxis,
            NativeMeshLengthCentimeters = nativeMeshLengthCentimeters,
            Interval = fallback.GetOrDefault<float>("Interval"),
            StartOffset = fallback.GetOrDefault<float>("StartOffset"),
            EndOffset = fallback.GetOrDefault<float>("EndOffset"),
            FillRemainder = fallback.GetOrDefault<bool?>("bFillRemainder"),
            ExtendSplineToMinLength = fallback.GetOrDefault<bool?>("bExtendSplineToMinLength"),
            SplineStartOffset = TryReadVector2(fallback, "SplineStartOffset"),
            SplineEndOffset = TryReadVector2(fallback, "SplineEndOffset"),
            SplineBoundaryMin = fallback.GetOrDefault<float?>("SplineBoundaryMin"),
            SplineBoundaryMax = fallback.GetOrDefault<float?>("SplineBoundaryMax"),
            SplineMaterialScaling = TryReadVector2(fallback, "SplineMaterialScaling"),
            RelativeLocation = relativeLocation,
            RelativeScale = relativeScale,
        };
    }

    private static List<double>? TryReadVector2(FStructFallback fallback, string propertyName)
    {
        if (!fallback.TryGetValue(out FStructFallback vectorFallback, propertyName))
        {
            return null;
        }

        return
        [
            vectorFallback.GetOrDefault<double>("X"),
            vectorFallback.GetOrDefault<double>("Y"),
        ];
    }

    internal double? ResolveMeshAxisLengthCentimeters(string? assetPath, char axis)
    {
        var packagePath = ResolvePackagePath(assetPath ?? string.Empty);
        if (string.IsNullOrWhiteSpace(packagePath))
        {
            return null;
        }

        var normalizedAxis = axis is 'Y' or 'Z' ? axis : 'X';
        var cacheKey = $"{packagePath}|{normalizedAxis}";
        if (_meshLengthCentimetersByPackagePathAndAxis.TryGetValue(cacheKey, out var cachedLength))
        {
            return cachedLength;
        }

        try
        {
            EnsureMounted();
            var package = FileProvider.LoadPackage(packagePath);
            var exports = package.GetExports().ToArray();
            var preferredObjectName = Path.GetFileNameWithoutExtension(packagePath);
            var staticMeshExport = SelectPreferredExport(exports.OfType<UStaticMesh>().ToArray(), preferredObjectName);
            var bounds = staticMeshExport?.RenderData?.Bounds;
            if (bounds == null)
            {
                var skeletalMeshExport = SelectPreferredExport(exports.OfType<USkeletalMesh>().ToArray(), preferredObjectName);
                bounds = skeletalMeshExport?.ImportedBounds;
            }
            if (bounds == null)
            {
                _meshLengthCentimetersByPackagePathAndAxis[cacheKey] = null;
                return null;
            }

            var extent = normalizedAxis switch
            {
                'Y' => bounds.BoxExtent.Y,
                'Z' => bounds.BoxExtent.Z,
                _ => bounds.BoxExtent.X,
            };
            var length = Math.Abs(extent) * 2.0d;
            _meshLengthCentimetersByPackagePathAndAxis[cacheKey] = length > 0.001d ? length : null;
            return _meshLengthCentimetersByPackagePathAndAxis[cacheKey];
        }
        catch (Exception exception)
        {
            _logger.LogDebug(exception, "Unable to resolve static mesh axis length for {PackagePath}", packagePath);
            _meshLengthCentimetersByPackagePathAndAxis[cacheKey] = null;
            return null;
        }
    }

    private static char NormalizeSplineMeshAxis(string? splineMeshAxis)
    {
        if (string.IsNullOrWhiteSpace(splineMeshAxis))
        {
            return 'X';
        }

        var normalized = splineMeshAxis.Trim();
        var separatorIndex = normalized.LastIndexOf(':');
        if (separatorIndex >= 0 && separatorIndex + 1 < normalized.Length)
        {
            normalized = normalized[(separatorIndex + 1)..];
        }

        return normalized.Length > 0 ? char.ToUpperInvariant(normalized[0]) : 'X';
    }

    private static string? NormalizeOptionalNameTag(string? value)
    {
        var normalized = value?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(normalized) ||
            string.Equals(normalized, "None", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return normalized;
    }

    private static string ReadFallbackString(FStructFallback fallback, string propertyName)
    {
        if (fallback.TryGetValue(out string stringValue, propertyName) &&
            !string.IsNullOrWhiteSpace(stringValue))
        {
            return stringValue;
        }

        if (fallback.TryGetValue(out FName nameValue, propertyName) &&
            !string.IsNullOrWhiteSpace(nameValue.Text))
        {
            return nameValue.Text;
        }

        return string.Empty;
    }

    private static string? ReadResolvedObjectPackagePath(FStructFallback fallback, string propertyName)
    {
        var resolvedObject = fallback.GetOrDefault<ResolvedObject?>(propertyName);
        return resolvedObject == null
            ? null
            : ConvertObjectPathToPackagePath(resolvedObject.GetPathName());
    }

    private static bool TryReadStructVector(FStructFallback fallback, string propertyName, out FVector value)
    {
        if (fallback.TryGetValue(out FVector typedValue, propertyName))
        {
            value = typedValue;
            return true;
        }

        if (fallback.TryGetValue(out FStructFallback nestedFallback, propertyName))
        {
            value = new FVector(
                nestedFallback.GetOrDefault<float>("X"),
                nestedFallback.GetOrDefault<float>("Y"),
                nestedFallback.GetOrDefault<float>("Z"));
            return true;
        }

        value = default;
        return false;
    }

    private static bool TryReadStructTransformTranslation(FStructFallback fallback, string propertyName, out FVector value)
    {
        if (fallback.TryGetValue(out FStructFallback transformFallback, propertyName))
        {
            return TryReadStructVector(transformFallback, "Translation", out value);
        }

        value = default;
        return false;
    }

    private static bool TryReadStructTransformScale(FStructFallback fallback, string propertyName, out FVector value)
    {
        if (fallback.TryGetValue(out FStructFallback transformFallback, propertyName))
        {
            return TryReadStructVector(transformFallback, "Scale3D", out value);
        }

        value = default;
        return false;
    }

    private static bool TryReadStructTransformRotationDegrees(FStructFallback fallback, string propertyName, out FRotator value)
    {
        if (!fallback.TryGetValue(out FStructFallback transformFallback, propertyName))
        {
            value = default;
            return false;
        }

        if (TryReadRotator(transformFallback, "Rotation", out value))
        {
            return true;
        }

        if (!transformFallback.TryGetValue(out FStructFallback rotationFallback, "Rotation"))
        {
            value = default;
            return false;
        }

        var quaternion = new FQuat(
            (float)rotationFallback.GetOrDefault<double>("X"),
            (float)rotationFallback.GetOrDefault<double>("Y"),
            (float)rotationFallback.GetOrDefault<double>("Z"),
            (float)rotationFallback.GetOrDefault<double>("W"));
        value = quaternion.Rotator();
        return true;
    }

    private static string GetObjectNameFromPackagePath(string packagePath)
    {
        return string.IsNullOrWhiteSpace(packagePath)
            ? string.Empty
            : Path.GetFileNameWithoutExtension(packagePath);
    }

    private void AddBlueprintClassComponentReferences(UBlueprintGeneratedClass blueprintClass, List<FoxWatchBlueprintComponentReference> references)
    {
        var sourceClassName = blueprintClass.Name;
        var constructionScript = blueprintClass.SimpleConstructionScript?.Load<USimpleConstructionScript>();
        var constructionNodeOverrides = constructionScript != null
            ? GetConstructionNodeOverrides(constructionScript)
            : new Dictionary<string, ScsNodeOverride>(StringComparer.OrdinalIgnoreCase);
        if (constructionScript != null)
        {
            var constructionNodes = GetConstructionNodes(constructionScript);
            foreach (var (node, inferredParentName) in constructionNodes)
            {
                var componentTemplate = node.GetComponentTemplateAsResolvedObject();
                if (componentTemplate != null &&
                    componentTemplate.TryLoad<UObject>(out var resolvedTemplate) &&
                    resolvedTemplate != null)
                {
                    AddBlueprintReference(references, sourceClassName, node, resolvedTemplate, inferredParentName);
                    continue;
                }

                var componentTemplateIndex = node.GetComponentTemplateAsIndex();
                if (componentTemplateIndex.TryLoad<UObject>(out var indexedTemplate) && indexedTemplate != null)
                {
                    AddBlueprintReference(references, sourceClassName, node, indexedTemplate, inferredParentName);
                }
            }
        }

        foreach (var templateIndex in blueprintClass.ComponentTemplates)
        {
            var componentTemplate = templateIndex?.Load<UObject>();
            if (componentTemplate == null)
            {
                continue;
            }

            var componentName = componentTemplate.Name;
            var reference = CreateBlueprintComponentReference(componentName, componentTemplate, allowTransformTemplate: true);
            if (reference == null)
            {
                continue;
            }

            ApplyScsNodeOverrides(reference, constructionNodeOverrides, componentName);
            AddBlueprintReference(references, sourceClassName, reference, componentTemplate);
        }

        var inheritableComponentHandler = blueprintClass.InheritableComponentHandler?.Load<UInheritableComponentHandler>();
        if (inheritableComponentHandler == null)
        {
            return;
        }

        foreach (var record in inheritableComponentHandler.GetRecords())
        {
            var componentTemplate = record.ComponentTemplate?.Load<UObject>();
            if (componentTemplate == null)
            {
                continue;
            }

            var componentName = string.IsNullOrWhiteSpace(record.ComponentKey.SCSVariableName.Text)
                ? componentTemplate.Name
                : record.ComponentKey.SCSVariableName.Text;
            var reference = CreateBlueprintComponentReference(componentName, componentTemplate, allowTransformTemplate: true);
            if (reference == null)
            {
                continue;
            }

            ApplyScsNodeOverrides(reference, constructionNodeOverrides, componentName, componentTemplate.Name);
            AddBlueprintReference(references, sourceClassName, reference, componentTemplate);
        }
    }

    private void AddPackageExportComponentReferences(UBlueprintGeneratedClass blueprintClass, IEnumerable<UObject> exports, List<FoxWatchBlueprintComponentReference> references)
    {
        var exportArray = exports as UObject[] ?? [.. exports];
        var defaultObjectName = $"Default__{blueprintClass.Name}";
        var defaultObject = exportArray.FirstOrDefault(export =>
            string.Equals(export.Name, defaultObjectName, StringComparison.OrdinalIgnoreCase));
        var pickupMeshFallback = ResolvePickupMeshFallbackReference(defaultObject);
        var hasExplicitPickupMeshComponent = exportArray.Any(export =>
        {
            if (!export.ExportType.EndsWith("Component", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var explicitReference = CreateBlueprintComponentReference(export.Name, export);
            return explicitReference != null && !string.IsNullOrWhiteSpace(explicitReference.MeshPath);
        });

        foreach (var export in exportArray)
        {
            if (export is UBlueprintGeneratedClass)
            {
                continue;
            }

            var outerName = export.Outer?.Name.Text ?? string.Empty;
            if (!string.Equals(outerName, defaultObjectName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var reference = CreateBlueprintComponentReference(export.Name, export);
            if (reference == null)
            {
                reference = CreateBlueprintComponentReference(export.Name, export, allowTransformTemplate: true);
            }

            if (reference != null &&
                pickupMeshFallback != null &&
                IsPickupItemMeshComponent(export) &&
                !hasExplicitPickupMeshComponent &&
                string.IsNullOrWhiteSpace(reference.MeshPath))
            {
                ApplyPickupMeshFallback(reference, pickupMeshFallback);
            }

            AddBlueprintReference(references, blueprintClass.Name, reference);
        }
    }

    private void AddBlueprintPackageExportComponentReferences(
        UBlueprintGeneratedClass blueprintClass,
        List<FoxWatchBlueprintComponentReference> references,
        ISet<string> inspectedBlueprintPackagePaths)
    {
        var packagePath = GetPackagePath(blueprintClass);
        if (string.IsNullOrWhiteSpace(packagePath) || !inspectedBlueprintPackagePaths.Add(packagePath))
        {
            return;
        }

        try
        {
            var package = FileProvider.LoadPackage(packagePath);
            var exports = package.GetExports().ToArray();
            AddPackageExportComponentReferences(blueprintClass, exports, references);
            AddBlueprintConstructionScriptExportComponentReferences(blueprintClass, exports, references);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Skipping package export component inspection for blueprint class {BlueprintClassName} from {PackagePath}",
                blueprintClass.Name,
                packagePath);
        }
    }

    private void AddBlueprintReference(List<FoxWatchBlueprintComponentReference> references, string sourceClassName, string componentName, UActorComponent component)
    {
        var reference = CreateBlueprintComponentReference(componentName, component);
        AddBlueprintReference(references, sourceClassName, reference, component);
    }

    private void AddBlueprintReference(List<FoxWatchBlueprintComponentReference> references, string sourceClassName, USCS_Node node, UActorComponent component, string? inferredParentName)
    {
        var componentName = string.IsNullOrWhiteSpace(node.InternalVariableName.Text)
            ? component.Name
            : node.InternalVariableName.Text;
        var reference = CreateBlueprintComponentReference(componentName, component);
        if (reference == null)
        {
            return;
        }

        ApplyScsNodeOverrides(reference, node, inferredParentName);
        AddBlueprintReference(references, sourceClassName, reference, component);
    }

    private void AddBlueprintReference(List<FoxWatchBlueprintComponentReference> references, string sourceClassName, USCS_Node node, UObject componentTemplate, string? inferredParentName)
    {
        var componentName = string.IsNullOrWhiteSpace(node.InternalVariableName.Text)
            ? componentTemplate.Name
            : node.InternalVariableName.Text;
        var reference = CreateBlueprintComponentReference(componentName, componentTemplate, allowTransformTemplate: true);
        if (reference == null)
        {
            return;
        }

        ApplyScsNodeOverrides(reference, node, inferredParentName);
        AddBlueprintReference(references, sourceClassName, reference, componentTemplate);
    }

    private void AddBlueprintReference(List<FoxWatchBlueprintComponentReference> references, string sourceClassName, string componentName, UObject export)
    {
        var reference = CreateBlueprintComponentReference(componentName, export);
        AddBlueprintReference(references, sourceClassName, reference, export);
    }

    private FoxWatchBlueprintComponentReference? ResolvePickupMeshFallbackReference(UObject? defaultObject)
    {
        if (defaultObject == null)
        {
            return null;
        }

        var itemComponentClassPath = GetReferencedPackagePath(defaultObject, "ItemComponentClass");
        if (string.IsNullOrWhiteSpace(itemComponentClassPath))
        {
            return ResolveLargeAircraftPartPickupMeshFallbackReference(defaultObject);
        }

        if (_pickupMeshFallbackByItemComponentClassPath.TryGetValue(itemComponentClassPath, out var cachedReference))
        {
            return cachedReference;
        }

        FoxWatchBlueprintComponentReference? resolvedReference = null;
        try
        {
            var packagePath = ResolvePackagePath(itemComponentClassPath) ?? itemComponentClassPath;
            var package = FileProvider.LoadPackage(packagePath);
            var itemComponentExports = package.GetExports().ToArray();
            var itemComponentDefaultObject = itemComponentExports.FirstOrDefault(export =>
                export.Name.StartsWith("Default__", StringComparison.OrdinalIgnoreCase));
            if (itemComponentDefaultObject != null)
            {
                resolvedReference = CreateBlueprintComponentReference(itemComponentDefaultObject.Name, itemComponentDefaultObject, allowTransformTemplate: true);
            }
        }
        catch (Exception exception)
        {
            _logger.LogDebug(
                exception,
                "Failed to resolve pickup mesh fallback from item component class {ItemComponentClassPath}",
                itemComponentClassPath);
        }

        resolvedReference ??= ResolveLargeAircraftPartPickupMeshFallbackReference(defaultObject);
        _pickupMeshFallbackByItemComponentClassPath[itemComponentClassPath] = resolvedReference;
        return resolvedReference;
    }

    private FoxWatchBlueprintComponentReference? ResolveLargeAircraftPartPickupMeshFallbackReference(UObject defaultObject)
    {
        var codeName = defaultObject.GetOrDefault<string>("CodeName")?.Trim();
        if (string.IsNullOrWhiteSpace(codeName))
        {
            var packageFileName = Path.GetFileNameWithoutExtension(GetPackagePath(defaultObject));
            if (packageFileName.StartsWith("BP", StringComparison.OrdinalIgnoreCase) &&
                packageFileName.EndsWith("Pickup", StringComparison.OrdinalIgnoreCase) &&
                packageFileName.Length > "BPPickup".Length)
            {
                codeName = packageFileName[2..^"Pickup".Length];
            }
        }

        if (string.IsNullOrWhiteSpace(codeName) ||
            !codeName.StartsWith("AircraftPartLarge", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        foreach (var meshPackagePathCandidate in GetLargeAircraftPartMeshPackagePathCandidates(codeName))
        {
            var resolvedMeshPackagePath = ResolvePackagePath(meshPackagePathCandidate);
            if (string.IsNullOrWhiteSpace(resolvedMeshPackagePath))
            {
                continue;
            }

            var meshType = ResolveMeshType(resolvedMeshPackagePath);
            if (string.IsNullOrWhiteSpace(meshType))
            {
                continue;
            }

            return new FoxWatchBlueprintComponentReference
            {
                SourceClassName = defaultObject.Class?.Name.Text ?? string.Empty,
                ComponentType = defaultObject.ExportType,
                MeshType = meshType,
                MeshName = GetObjectNameFromPackagePath(resolvedMeshPackagePath),
                MeshPath = resolvedMeshPackagePath,
                IsVisible = true,
            };
        }

        return null;
    }

    private static IEnumerable<string> GetLargeAircraftPartMeshPackagePathCandidates(string codeName)
    {
        var normalizedCodeName = codeName.Trim();
        if (string.IsNullOrWhiteSpace(normalizedCodeName))
        {
            yield break;
        }

        yield return $"War/Content/Meshes/Vehicles/{normalizedCodeName}.uasset";

        if (normalizedCodeName.EndsWith("C", StringComparison.OrdinalIgnoreCase))
        {
            yield return $"War/Content/Meshes/Vehicles/{normalizedCodeName[..^1]}W.uasset";
        }
    }

    private static bool IsPickupItemMeshComponent(UObject export)
    {
        return export.ExportType.EndsWith("MeshComponent", StringComparison.OrdinalIgnoreCase)
            && export.Name.StartsWith("ItemMesh", StringComparison.OrdinalIgnoreCase);
    }

    private static void ApplyPickupMeshFallback(FoxWatchBlueprintComponentReference targetReference, FoxWatchBlueprintComponentReference fallbackReference)
    {
        if (string.IsNullOrWhiteSpace(targetReference.MeshType))
        {
            targetReference.MeshType = fallbackReference.MeshType;
        }

        if (string.IsNullOrWhiteSpace(targetReference.MeshName))
        {
            targetReference.MeshName = fallbackReference.MeshName;
        }

        if (string.IsNullOrWhiteSpace(targetReference.MeshPath))
        {
            targetReference.MeshPath = fallbackReference.MeshPath;
        }

        if (string.IsNullOrWhiteSpace(targetReference.AnimationClassPath))
        {
            targetReference.AnimationClassPath = fallbackReference.AnimationClassPath;
        }
    }

    private void AddBlueprintConstructionScriptExportComponentReferences(
        UBlueprintGeneratedClass blueprintClass,
        IReadOnlyList<UObject> exports,
        List<FoxWatchBlueprintComponentReference> references)
    {
        var constructionNodes = blueprintClass.SimpleConstructionScript?.Load<USimpleConstructionScript>() is { } constructionScript
            ? GetConstructionNodes(constructionScript).ToArray()
            : exports
                .OfType<USCS_Node>()
                .Select(node => (Node: node, InferredParentName: (string?) null))
                .ToArray();
        if (constructionNodes.Length == 0)
        {
            return;
        }

        var exportsByName = exports
            .GroupBy(export => export.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);

        foreach (var (node, inferredParentName) in constructionNodes)
        {
            var componentName = node.InternalVariableName.Text;
            if (string.IsNullOrWhiteSpace(componentName))
            {
                continue;
            }

            UObject? componentExport = null;
            foreach (var lookupName in GetConstructionNodeOverrideLookupNames(componentName))
            {
                if (!exportsByName.TryGetValue(lookupName, out var matches))
                {
                    continue;
                }

                componentExport = matches.FirstOrDefault(export =>
                    export.ExportType.EndsWith("Component", StringComparison.OrdinalIgnoreCase));
                if (componentExport != null)
                {
                    break;
                }
            }

            if (componentExport == null)
            {
                continue;
            }

            var reference = CreateBlueprintComponentReference(componentName, componentExport, allowTransformTemplate: true);
            if (reference == null)
            {
                continue;
            }

            ApplyScsNodeOverrides(reference, node, inferredParentName);
            AddBlueprintReference(references, blueprintClass.Name, reference);
        }
    }

    private void AddBlueprintReference(
        List<FoxWatchBlueprintComponentReference> references,
        string sourceClassName,
        FoxWatchBlueprintComponentReference? reference,
        UObject? sourceExport = null)
    {
        if (reference == null)
        {
            return;
        }

        reference.SourceClassName = sourceClassName;

        var existingWithSameName = references.FindIndex(existing =>
            string.Equals(existing.ComponentName, reference.ComponentName, StringComparison.OrdinalIgnoreCase));

        if (existingWithSameName < 0)
        {
            references.Add(reference);
            AddChildActorBlueprintReferences(references, sourceClassName, reference, sourceExport);
            return;
        }

        var existingReference = references[existingWithSameName];
        if (!string.Equals(existingReference.SourceClassName, reference.SourceClassName, StringComparison.OrdinalIgnoreCase))
        {
            MergeInheritedReference(existingReference, reference);
            AddChildActorBlueprintReferences(references, sourceClassName, existingReference, sourceExport);
            return;
        }

        if (ShouldReplaceReference(existingReference, reference))
        {
            MergeInheritedReference(reference, existingReference);
            references[existingWithSameName] = reference;
            AddChildActorBlueprintReferences(references, sourceClassName, reference, sourceExport);
            return;
        }

        MergeInheritedReference(existingReference, reference);
        AddChildActorBlueprintReferences(references, sourceClassName, existingReference, sourceExport);
    }

    private void AddChildActorBlueprintReferences(
        List<FoxWatchBlueprintComponentReference> references,
        string sourceClassName,
        FoxWatchBlueprintComponentReference parentReference,
        UObject? sourceExport)
    {
        if (sourceExport == null)
        {
            return;
        }

        var childActorBlueprintPath = GetReferencedPackagePath(sourceExport, "ChildActorClass");
        if (string.IsNullOrWhiteSpace(childActorBlueprintPath))
        {
            childActorBlueprintPath = GetReferencedPackagePath(sourceExport, "TemplateActor");
        }
        if (string.IsNullOrWhiteSpace(childActorBlueprintPath))
        {
            return;
        }

        IReadOnlyList<FoxWatchBlueprintComponentReference> childReferences;
        try
        {
            childReferences = InspectBlueprintComponentsAsync(childActorBlueprintPath).GetAwaiter().GetResult();
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Skipping child actor component inspection for {ComponentName} from {ChildActorBlueprintPath}",
                parentReference.ComponentName,
                childActorBlueprintPath);
            return;
        }

        if (childReferences.Count == 0)
        {
            return;
        }

        var directChildReference = childReferences.FirstOrDefault(childReference =>
            string.Equals(childReference.ComponentName, parentReference.ComponentName, StringComparison.OrdinalIgnoreCase));
        if (directChildReference != null)
        {
            MergeInheritedReference(parentReference, directChildReference);
        }

        var childComponentNames = childReferences
            .Select(child => child.ComponentName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var childReference in childReferences)
        {
            if (directChildReference != null &&
                string.Equals(childReference.ComponentName, directChildReference.ComponentName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var nestedReference = CloneBlueprintComponentReference(childReference);
            nestedReference.ComponentName = $"{parentReference.ComponentName}:{childReference.ComponentName}";
            nestedReference.AttachParentName = string.IsNullOrWhiteSpace(childReference.AttachParentName)
                ? parentReference.ComponentName
                : childComponentNames.Contains(childReference.AttachParentName)
                    ? $"{parentReference.ComponentName}:{childReference.AttachParentName}"
                    : parentReference.ComponentName;
            AddBlueprintReference(references, sourceClassName, nestedReference);
        }
    }

    private static FoxWatchBlueprintComponentReference CloneBlueprintComponentReference(FoxWatchBlueprintComponentReference reference)
    {
        return new FoxWatchBlueprintComponentReference
        {
            SourceClassName = reference.SourceClassName,
            ComponentName = reference.ComponentName,
            ComponentType = reference.ComponentType,
            DataClassPath = reference.DataClassPath,
            AnimationClassPath = reference.AnimationClassPath,
            MeshType = reference.MeshType,
            MeshName = reference.MeshName,
            MeshPath = reference.MeshPath,
            AttachParentName = reference.AttachParentName,
            AttachSocketName = reference.AttachSocketName,
            RelativeLocation = reference.RelativeLocation,
            RelativeRotation = reference.RelativeRotation,
            RelativeScale = reference.RelativeScale,
            AbsoluteLocation = reference.AbsoluteLocation,
            AbsoluteRotation = reference.AbsoluteRotation,
            AbsoluteScale = reference.AbsoluteScale,
            SocketTags = [.. reference.SocketTags.Select(tag => new FoxWatchBlueprintSocketTagReference
            {
                Mask = tag.Mask,
                Category = tag.Category,
            })],
            SplineDefaultTargetUnrealLocationCentimeters = reference.SplineDefaultTargetUnrealLocationCentimeters == null
                ? null
                : [.. reference.SplineDefaultTargetUnrealLocationCentimeters],
            SplinePathMode = reference.SplinePathMode,
            SplineMinBufferCentimeters = reference.SplineMinBufferCentimeters,
            SplineMinRadiusCentimeters = reference.SplineMinRadiusCentimeters,
            SplineMaxRadiusCentimeters = reference.SplineMaxRadiusCentimeters,
            SplineMaxBufferCentimeters = reference.SplineMaxBufferCentimeters,
            SplineEnforceCornerRadius = reference.SplineEnforceCornerRadius,
            SplineMaxArcAngleDegrees = reference.SplineMaxArcAngleDegrees,
            SplineMaxTargetAngleDegrees = reference.SplineMaxTargetAngleDegrees,
            SplineMaxSlopeAngleDegrees = reference.SplineMaxSlopeAngleDegrees,
            StaticMeshOverrides = [.. reference.StaticMeshOverrides.Select(overrideReference => new FoxWatchStaticMeshOverrideReference
            {
                TargetMeshPath = overrideReference.TargetMeshPath,
                OverrideMeshPath = overrideReference.OverrideMeshPath,
            })],
            SplineConnectorMeshConfigs = [.. reference.SplineConnectorMeshConfigs.Select(config => new FoxWatchSplineConnectorMeshConfigReference
            {
                Mode = config.Mode,
                MeshPaths = [.. config.MeshPaths],
                IsCollisionOnly = config.IsCollisionOnly,
                SplineMeshAxis = config.SplineMeshAxis,
                NativeMeshLengthCentimeters = config.NativeMeshLengthCentimeters,
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
            })],
            SplineComponentConfigs = [.. reference.SplineComponentConfigs.Select(config => new FoxWatchSplineConnectorComponentConfigReference
            {
                ComponentName = config.ComponentName,
                Distance = config.Distance,
                RelativeLocation = config.RelativeLocation == null ? null : [.. config.RelativeLocation],
                RelativeRotation = config.RelativeRotation == null ? null : [.. config.RelativeRotation],
            })],
            IsVisible = reference.IsVisible,
            IsHiddenInGame = reference.IsHiddenInGame,
        };
    }

    private static void MergeInheritedReference(FoxWatchBlueprintComponentReference targetReference, FoxWatchBlueprintComponentReference fallbackReference)
    {
        if (string.IsNullOrWhiteSpace(targetReference.ComponentType))
        {
            targetReference.ComponentType = fallbackReference.ComponentType;
        }

        if (string.IsNullOrWhiteSpace(targetReference.DataClassPath))
        {
            targetReference.DataClassPath = fallbackReference.DataClassPath;
        }

        if (string.IsNullOrWhiteSpace(targetReference.MeshType))
        {
            targetReference.MeshType = fallbackReference.MeshType;
        }

        if (string.IsNullOrWhiteSpace(targetReference.MeshName))
        {
            targetReference.MeshName = fallbackReference.MeshName;
        }

        if (string.IsNullOrWhiteSpace(targetReference.MeshPath))
        {
            targetReference.MeshPath = fallbackReference.MeshPath;
        }

        if (string.IsNullOrWhiteSpace(targetReference.AttachParentName))
        {
            targetReference.AttachParentName = fallbackReference.AttachParentName;
        }

        if (string.IsNullOrWhiteSpace(targetReference.AttachSocketName))
        {
            targetReference.AttachSocketName = fallbackReference.AttachSocketName;
        }

        if (ShouldReplaceRelativeLocationFromFallback(targetReference, fallbackReference))
        {
            targetReference.RelativeLocation = fallbackReference.RelativeLocation;
        }
        else if (string.IsNullOrWhiteSpace(targetReference.RelativeLocation))
        {
            targetReference.RelativeLocation = fallbackReference.RelativeLocation;
        }

        if (ShouldReplaceRelativeRotationFromFallback(targetReference, fallbackReference))
        {
            targetReference.RelativeRotation = fallbackReference.RelativeRotation;
        }
        else if (string.IsNullOrWhiteSpace(targetReference.RelativeRotation))
        {
            targetReference.RelativeRotation = fallbackReference.RelativeRotation;
        }

        if (string.IsNullOrWhiteSpace(targetReference.RelativeScale))
        {
            targetReference.RelativeScale = fallbackReference.RelativeScale;
        }

        if (string.IsNullOrWhiteSpace(targetReference.AbsoluteLocation))
        {
            targetReference.AbsoluteLocation = fallbackReference.AbsoluteLocation;
        }

        if (string.IsNullOrWhiteSpace(targetReference.AbsoluteRotation))
        {
            targetReference.AbsoluteRotation = fallbackReference.AbsoluteRotation;
        }

        if (string.IsNullOrWhiteSpace(targetReference.AbsoluteScale))
        {
            targetReference.AbsoluteScale = fallbackReference.AbsoluteScale;
        }

        if (targetReference.ComponentTags.Count == 0 &&
            fallbackReference.ComponentTags.Count > 0)
        {
            targetReference.ComponentTags = [.. fallbackReference.ComponentTags];
        }

        if (targetReference.SocketTags.Count == 0 &&
            fallbackReference.SocketTags.Count > 0)
        {
            targetReference.SocketTags =
            [
                .. fallbackReference.SocketTags.Select(tag => new FoxWatchBlueprintSocketTagReference
                {
                    Mask = tag.Mask,
                    Category = tag.Category,
                    Tag = tag.Tag,
                })
            ];
        }

        if (targetReference.SplineDefaultTargetUnrealLocationCentimeters == null &&
            fallbackReference.SplineDefaultTargetUnrealLocationCentimeters != null)
        {
            targetReference.SplineDefaultTargetUnrealLocationCentimeters =
            [
                .. fallbackReference.SplineDefaultTargetUnrealLocationCentimeters
            ];
        }

        targetReference.SplinePathMode ??= fallbackReference.SplinePathMode;
        targetReference.SplineMinBufferCentimeters ??= fallbackReference.SplineMinBufferCentimeters;
        targetReference.SplineMinRadiusCentimeters ??= fallbackReference.SplineMinRadiusCentimeters;
        targetReference.SplineMaxRadiusCentimeters ??= fallbackReference.SplineMaxRadiusCentimeters;
        targetReference.SplineMaxBufferCentimeters ??= fallbackReference.SplineMaxBufferCentimeters;
        targetReference.SplineEnforceCornerRadius ??= fallbackReference.SplineEnforceCornerRadius;
        targetReference.SplineMaxArcAngleDegrees ??= fallbackReference.SplineMaxArcAngleDegrees;
        targetReference.SplineMaxTargetAngleDegrees ??= fallbackReference.SplineMaxTargetAngleDegrees;
        targetReference.SplineMaxSlopeAngleDegrees ??= fallbackReference.SplineMaxSlopeAngleDegrees;

        if (targetReference.StaticMeshOverrides.Count == 0 &&
            fallbackReference.StaticMeshOverrides.Count > 0)
        {
            targetReference.StaticMeshOverrides =
            [
                .. fallbackReference.StaticMeshOverrides.Select(overrideReference => new FoxWatchStaticMeshOverrideReference
                {
                    TargetMeshPath = overrideReference.TargetMeshPath,
                    OverrideMeshPath = overrideReference.OverrideMeshPath,
                })
            ];
        }

        if (targetReference.SplineConnectorMeshConfigs.Count == 0 &&
            fallbackReference.SplineConnectorMeshConfigs.Count > 0)
        {
            targetReference.SplineConnectorMeshConfigs =
            [
                .. fallbackReference.SplineConnectorMeshConfigs.Select(config => new FoxWatchSplineConnectorMeshConfigReference
                {
                    Mode = config.Mode,
                    MeshPaths = [.. config.MeshPaths],
                    IsCollisionOnly = config.IsCollisionOnly,
                    SplineMeshAxis = config.SplineMeshAxis,
                    NativeMeshLengthCentimeters = config.NativeMeshLengthCentimeters,
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
                })
            ];
        }

        if (targetReference.SplineComponentConfigs.Count == 0 &&
            fallbackReference.SplineComponentConfigs.Count > 0)
        {
            targetReference.SplineComponentConfigs =
            [
                .. fallbackReference.SplineComponentConfigs.Select(config => new FoxWatchSplineConnectorComponentConfigReference
                {
                    ComponentName = config.ComponentName,
                    Distance = config.Distance,
                    RelativeLocation = config.RelativeLocation == null ? null : [.. config.RelativeLocation],
                    RelativeRotation = config.RelativeRotation == null ? null : [.. config.RelativeRotation],
                })
            ];
        }

        targetReference.IsVisible |= fallbackReference.IsVisible;
        targetReference.IsHiddenInGame &= fallbackReference.IsHiddenInGame;
    }

    private static bool ShouldReplaceReference(FoxWatchBlueprintComponentReference existingReference, FoxWatchBlueprintComponentReference newReference)
    {
        if (string.Equals(existingReference.ComponentType, newReference.ComponentType, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(existingReference.MeshPath, newReference.MeshPath, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(existingReference.AttachParentName, newReference.AttachParentName, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(
                NormalizeOptionalAttachmentReference(existingReference.AttachSocketName),
                NormalizeOptionalAttachmentReference(newReference.AttachSocketName),
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return GetReferenceSpecificityScore(newReference) > GetReferenceSpecificityScore(existingReference);
    }

    private static bool ShouldReplaceRelativeLocationFromFallback(
        FoxWatchBlueprintComponentReference targetReference,
        FoxWatchBlueprintComponentReference fallbackReference)
    {
        return HasCompatibleInheritedAttachment(targetReference, fallbackReference) &&
            IsIdentityVectorText(targetReference.RelativeLocation) &&
            !IsIdentityVectorText(fallbackReference.RelativeLocation) &&
            IsIdentityVectorText(targetReference.AbsoluteLocation);
    }

    private static bool ShouldReplaceRelativeRotationFromFallback(
        FoxWatchBlueprintComponentReference targetReference,
        FoxWatchBlueprintComponentReference fallbackReference)
    {
        return HasCompatibleInheritedAttachment(targetReference, fallbackReference) &&
            IsIdentityRotatorText(targetReference.RelativeRotation) &&
            !IsIdentityRotatorText(fallbackReference.RelativeRotation) &&
            IsIdentityVectorText(targetReference.AbsoluteLocation);
    }

    private static bool HasCompatibleInheritedAttachment(
        FoxWatchBlueprintComponentReference targetReference,
        FoxWatchBlueprintComponentReference fallbackReference)
    {
        return string.Equals(
                NormalizeOptionalAttachmentReference(targetReference.AttachParentName),
                NormalizeOptionalAttachmentReference(fallbackReference.AttachParentName),
                StringComparison.OrdinalIgnoreCase) &&
            string.Equals(
                NormalizeOptionalAttachmentReference(targetReference.AttachSocketName),
                NormalizeOptionalAttachmentReference(fallbackReference.AttachSocketName),
                StringComparison.OrdinalIgnoreCase);
    }

    private static int GetReferenceSpecificityScore(FoxWatchBlueprintComponentReference reference)
    {
        var score = 0;

        if (!string.IsNullOrWhiteSpace(reference.MeshPath))
        {
            score += 8;
        }

        if (!string.IsNullOrWhiteSpace(reference.ComponentType))
        {
            score += 4;
        }

        if (!string.IsNullOrWhiteSpace(reference.AttachParentName))
        {
            score += 2;
        }

        if (!string.IsNullOrWhiteSpace(reference.AttachSocketName))
        {
            score += 1;
        }

        if (!string.IsNullOrWhiteSpace(reference.RelativeLocation) ||
            !string.IsNullOrWhiteSpace(reference.RelativeRotation) ||
            !string.IsNullOrWhiteSpace(reference.RelativeScale))
        {
            score += 2;
        }

        if (!string.IsNullOrWhiteSpace(reference.AbsoluteLocation) ||
            !string.IsNullOrWhiteSpace(reference.AbsoluteRotation) ||
            !string.IsNullOrWhiteSpace(reference.AbsoluteScale))
        {
            score += 1;
        }

        return score;
    }

    private string ResolveMeshType(string meshPackagePath)
    {
        if (string.IsNullOrWhiteSpace(meshPackagePath))
        {
            return string.Empty;
        }

        if (_meshTypeByPackagePath.TryGetValue(meshPackagePath, out var cachedMeshType))
        {
            return cachedMeshType;
        }

        var resolvedMeshType = string.Empty;
        try
        {
            var packagePath = ResolvePackagePath(meshPackagePath) ?? meshPackagePath;
            var package = FileProvider.LoadPackage(packagePath);
            var packageExports = package.GetExports();
            if (packageExports.Any(export => export is USkeletalMesh))
            {
                resolvedMeshType = "skeletal";
            }
            else if (packageExports.Any(export => export is UStaticMesh))
            {
                resolvedMeshType = "static";
            }
        }
        catch (Exception exception)
        {
            _logger.LogDebug(exception, "Failed to resolve mesh type for {MeshPackagePath}", meshPackagePath);
        }

        _meshTypeByPackagePath[meshPackagePath] = resolvedMeshType;
        return resolvedMeshType;
    }

    private static void ApplyScsNodeOverrides(FoxWatchBlueprintComponentReference reference, USCS_Node node, string? inferredParentName)
    {
        ApplyScsNodeOverrides(reference, CreateScsNodeOverride(node, inferredParentName));
    }

    private static void ApplyScsNodeOverrides(
        FoxWatchBlueprintComponentReference reference,
        IReadOnlyDictionary<string, ScsNodeOverride> constructionNodeOverrides,
        params string[] componentNames)
    {
        foreach (var componentName in componentNames)
        {
            if (string.IsNullOrWhiteSpace(componentName))
            {
                continue;
            }

            foreach (var lookupName in GetConstructionNodeOverrideLookupNames(componentName))
            {
                if (!constructionNodeOverrides.TryGetValue(lookupName, out var nodeOverride))
                {
                    continue;
                }

                ApplyScsNodeOverrides(reference, nodeOverride);
                return;
            }
        }
    }

    private static void ApplyScsNodeOverrides(FoxWatchBlueprintComponentReference reference, ScsNodeOverride nodeOverride)
    {
        if (!string.IsNullOrWhiteSpace(nodeOverride.ParentComponentName))
        {
            reference.AttachParentName = nodeOverride.ParentComponentName;
        }

        if (!string.IsNullOrWhiteSpace(nodeOverride.AttachSocketName))
        {
            reference.AttachSocketName = nodeOverride.AttachSocketName;
        }

        if (!string.IsNullOrWhiteSpace(nodeOverride.RelativeLocation) &&
            !ShouldPreserveExistingBuildSocketTransform(reference, reference.RelativeLocation, nodeOverride.RelativeLocation, IsIdentityVectorText))
        {
            reference.RelativeLocation = nodeOverride.RelativeLocation;
        }

        if (!string.IsNullOrWhiteSpace(nodeOverride.RelativeRotation) &&
            !ShouldPreserveExistingBuildSocketTransform(reference, reference.RelativeRotation, nodeOverride.RelativeRotation, IsIdentityRotatorText))
        {
            reference.RelativeRotation = nodeOverride.RelativeRotation;
        }

        if (!string.IsNullOrWhiteSpace(nodeOverride.RelativeScale))
        {
            reference.RelativeScale = nodeOverride.RelativeScale;
        }
    }

    private static bool ShouldPreserveExistingBuildSocketTransform(
        FoxWatchBlueprintComponentReference reference,
        string? existingValue,
        string? overrideValue,
        Func<string?, bool> isIdentityValue)
    {
        return LooksLikeBuildSocketReference(reference) &&
            !isIdentityValue(existingValue) &&
            isIdentityValue(overrideValue);
    }

    private static Dictionary<string, ScsNodeOverride> GetConstructionNodeOverrides(USimpleConstructionScript constructionScript)
    {
        var overrides = new Dictionary<string, ScsNodeOverride>(StringComparer.OrdinalIgnoreCase);
        foreach (var (node, inferredParentName) in GetConstructionNodes(constructionScript))
        {
            var componentName = node.InternalVariableName.Text;
            if (string.IsNullOrWhiteSpace(componentName))
            {
                continue;
            }

            var nodeOverride = CreateScsNodeOverride(node, inferredParentName);
            foreach (var lookupName in GetConstructionNodeOverrideLookupNames(componentName))
            {
                overrides[lookupName] = nodeOverride;
            }
        }

        return overrides;
    }

    private static IEnumerable<string> GetConstructionNodeOverrideLookupNames(string componentName)
    {
        yield return componentName;

        if (componentName.EndsWith("_GEN_VARIABLE", StringComparison.OrdinalIgnoreCase))
        {
            yield return componentName[..^"_GEN_VARIABLE".Length];
            yield break;
        }

        yield return $"{componentName}_GEN_VARIABLE";
    }

    private static ScsNodeOverride CreateScsNodeOverride(USCS_Node node, string? inferredParentName)
    {
        var parentComponentName = node.GetOrDefault<FName>("ParentComponentOrVariableName", new FName()).Text;
        if (string.IsNullOrWhiteSpace(parentComponentName))
        {
            parentComponentName = inferredParentName ?? string.Empty;
        }

        var attachSocketName = node.GetOrDefault<FName>("AttachToName", new FName()).Text;
        return new ScsNodeOverride
        {
            ParentComponentName = parentComponentName,
            AttachSocketName = attachSocketName,
            RelativeLocation = TryReadVector(node, "RelativeLocation", out var relativeLocation)
                ? relativeLocation.ToString()
                : string.Empty,
            RelativeRotation = TryReadRotator(node, "RelativeRotation", out var relativeRotation)
                ? relativeRotation.ToString()
                : string.Empty,
            RelativeScale = TryReadVector(node, "RelativeScale3D", out var relativeScale)
                ? relativeScale.ToString()
                : string.Empty,
        };
    }

    private static IEnumerable<(USCS_Node Node, string? InferredParentName)> GetConstructionNodes(USimpleConstructionScript constructionScript)
    {
        var rootNodes = constructionScript.RootNodes
            .Select(nodeIndex => nodeIndex?.Load<USCS_Node>())
            .Where(node => node != null)
            .Cast<USCS_Node>()
            .ToArray();

        if (rootNodes.Length > 0)
        {
            foreach (var rootNode in rootNodes)
            {
                foreach (var entry in EnumerateConstructionNodes(rootNode, null))
                {
                    yield return entry;
                }
            }

            yield break;
        }

        foreach (var node in constructionScript.AllNodes
                     .Select(nodeIndex => nodeIndex?.Load<USCS_Node>())
                     .Where(node => node != null)
                     .Cast<USCS_Node>())
        {
            yield return (node, null);
        }
    }

    private static IEnumerable<(USCS_Node Node, string? InferredParentName)> EnumerateConstructionNodes(USCS_Node node, string? inferredParentName)
    {
        yield return (node, inferredParentName);

        var currentName = string.IsNullOrWhiteSpace(node.InternalVariableName.Text)
            ? null
            : node.InternalVariableName.Text;

        foreach (var childNode in node.ChildNodes
                     .Select(childIndex => childIndex?.Load<USCS_Node>())
                     .Where(childNode => childNode != null)
                     .Cast<USCS_Node>())
        {
            foreach (var entry in EnumerateConstructionNodes(childNode, currentName))
            {
                yield return entry;
            }
        }
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

    private static bool TryReadRotator(IPropertyHolder holder, string propertyName, out FRotator value)
    {
        if (holder.TryGetValue(out value, propertyName))
        {
            return true;
        }

        if (holder.TryGetValue(out FStructFallback fallback, propertyName))
        {
            value = new FRotator(
                fallback.GetOrDefault<float>("Pitch"),
                fallback.GetOrDefault<float>("Yaw"),
                fallback.GetOrDefault<float>("Roll"));
            return true;
        }

        value = default;
        return false;
    }

    private static string GetAttachSocketName(UObject export)
    {
        if (export.TryGetValue(out FName socketName, "AttachSocketName"))
        {
            return NormalizeOptionalAttachmentReference(socketName.Text);
        }

        return string.Empty;
    }

    private static string GetAttachSocketName(USceneComponent component)
    {
        var socketName = component.GetOrDefault("AttachSocketName", new FName());
        return NormalizeOptionalAttachmentReference(socketName.Text);
    }

    private static string NormalizeOptionalAttachmentReference(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ||
            string.Equals(value, "None", StringComparison.OrdinalIgnoreCase)
            ? string.Empty
            : value;
    }

    private static bool IsComponentVisible(UObject export)
    {
        return !export.TryGetValue(out bool isVisible, "bVisible") || isVisible;
    }

    private static bool IsComponentHiddenInGame(UObject export)
    {
        return export.TryGetValue(out bool hiddenInGame, "bHiddenInGame") && hiddenInGame;
    }

    private static string GetPackagePath(UObject export)
    {
        return export.Owner?.Provider?.FixPath(export.Owner.Name) ?? export.Name;
    }

    private static string GetReferencedPackagePath(UObject export, string propertyName)
    {
        var resolvedObject = export.GetOrDefault<ResolvedObject?>(propertyName);
        return resolvedObject != null
            ? ConvertObjectPathToPackagePath(resolvedObject.GetPathName()) ?? string.Empty
            : string.Empty;
    }

    private static string GetAircraftPartSlotMeshPath(UObject export)
    {
        return export.ExportType.Contains("AircraftPartSlotComponent", StringComparison.OrdinalIgnoreCase)
            ? GetReferencedPackagePath(export, "Mesh")
            : string.Empty;
    }

    private static string? ConvertObjectPathToPackagePath(string? objectPath)
    {
        if (string.IsNullOrWhiteSpace(objectPath))
        {
            return null;
        }

        var normalized = objectPath.Replace('\\', '/').Trim();
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

    private static string ToDisplayName(string variantId)
    {
        if (string.IsNullOrWhiteSpace(variantId))
        {
            return string.Empty;
        }

        return char.ToUpperInvariant(variantId[0]) + variantId[1..];
    }
}

public sealed class FoxWatchAnimationPoseSample
{
    public string AssetPath { get; set; } = string.Empty;

    public int FrameIndex { get; set; }

    public int BoneCount { get; set; }

    public List<FoxWatchAnimationPoseBone> Bones { get; set; } = [];
}

public sealed class FoxWatchAnimationPoseBone
{
    public string Name { get; set; } = string.Empty;

    public int ParentIndex { get; set; } = -1;

    public List<double> Location { get; set; } = [];

    public List<double> RotationQuaternion { get; set; } = [];

    public List<double> Scale { get; set; } = [];
}

public sealed class FoxWatchSkeletonReferenceComparison
{
    public string AnimationAssetPath { get; set; } = string.Empty;

    public string ReferenceMeshAssetPath { get; set; } = string.Empty;

    public int AnimationBoneCount { get; set; }

    public int MeshBoneCount { get; set; }

    public int ComparedBoneCount { get; set; }

    public double MaxTranslationDeltaCentimeters { get; set; }

    public double MaxRotationDeltaDegrees { get; set; }

    public double MaxScaleDelta { get; set; }

    public List<string> MissingInMeshBones { get; set; } = [];

    public List<string> MissingInAnimationBones { get; set; } = [];

    public List<FoxWatchSkeletonReferenceBoneDifference> BoneDifferences { get; set; } = [];
}

public sealed class FoxWatchSkeletonReferenceBoneDifference
{
    public string Name { get; set; } = string.Empty;

    public string AnimationParentName { get; set; } = string.Empty;

    public string MeshParentName { get; set; } = string.Empty;

    public double TranslationDeltaCentimeters { get; set; }

    public double RotationDeltaDegrees { get; set; }

    public List<double> ScaleDelta { get; set; } = [];
}

public sealed class FoxWatchBlueprintComponentReference
{
    public string SourceClassName { get; set; } = string.Empty;
    public string ComponentName { get; set; } = string.Empty;
    public string ComponentType { get; set; } = string.Empty;
    public string DataClassPath { get; set; } = string.Empty;
    public string AnimationClassPath { get; set; } = string.Empty;
    public string MeshType { get; set; } = string.Empty;
    public string MeshName { get; set; } = string.Empty;
    public string MeshPath { get; set; } = string.Empty;
    public string AttachParentName { get; set; } = string.Empty;
    public string AttachSocketName { get; set; } = string.Empty;
    public string RelativeLocation { get; set; } = string.Empty;
    public string RelativeRotation { get; set; } = string.Empty;
    public string RelativeScale { get; set; } = string.Empty;
    public string AbsoluteLocation { get; set; } = string.Empty;
    public string AbsoluteRotation { get; set; } = string.Empty;
    public string AbsoluteScale { get; set; } = string.Empty;
    public List<FoxWatchBlueprintSocketTagReference> SocketTags { get; set; } = [];
    public List<string> ComponentTags { get; set; } = [];
    public List<double>? SplineDefaultTargetUnrealLocationCentimeters { get; set; }
    public string? SplinePathMode { get; set; }
    public double? SplineMinBufferCentimeters { get; set; }
    public double? SplineMinRadiusCentimeters { get; set; }
    public double? SplineMaxRadiusCentimeters { get; set; }
    public double? SplineMaxBufferCentimeters { get; set; }
    public bool? SplineEnforceCornerRadius { get; set; }
    public double? SplineMaxArcAngleDegrees { get; set; }
    public double? SplineMaxTargetAngleDegrees { get; set; }
    public double? SplineMaxSlopeAngleDegrees { get; set; }
    public List<FoxWatchStaticMeshOverrideReference> StaticMeshOverrides { get; set; } = [];
    public List<FoxWatchSplineConnectorMeshConfigReference> SplineConnectorMeshConfigs { get; set; } = [];
    public List<FoxWatchSplineConnectorComponentConfigReference> SplineComponentConfigs { get; set; } = [];
    public string MaterialSidecarNameOverride { get; set; } = string.Empty;
    public bool IsVisible { get; set; } = true;
    public bool IsHiddenInGame { get; set; }
}

public sealed class FoxWatchBlueprintSocketTagReference
{
    public long? Mask { get; set; }

    public long? Category { get; set; }

    public string? Tag { get; set; }
}

public sealed class FoxWatchStaticMeshOverrideReference
{
    public string TargetMeshPath { get; set; } = string.Empty;
    public string OverrideMeshPath { get; set; } = string.Empty;
}

public sealed class FoxWatchSplineConnectorMeshConfigReference
{
    public string Mode { get; set; } = string.Empty;
    public List<string> MeshPaths { get; set; } = [];
    public bool IsCollisionOnly { get; set; }
    public string SplineMeshAxis { get; set; } = string.Empty;
    public double? NativeMeshLengthCentimeters { get; set; }
    public double Interval { get; set; }
    public double StartOffset { get; set; }
    public double EndOffset { get; set; }
    public bool? FillRemainder { get; set; }
    public bool? ExtendSplineToMinLength { get; set; }
    public List<double>? SplineStartOffset { get; set; }
    public List<double>? SplineEndOffset { get; set; }
    public double? SplineBoundaryMin { get; set; }
    public double? SplineBoundaryMax { get; set; }
    public List<double>? SplineMaterialScaling { get; set; }
    public List<double>? RelativeLocation { get; set; }
    public List<double>? RelativeScale { get; set; }
}

public sealed class FoxWatchSplineConnectorComponentConfigReference
{
    public string ComponentName { get; set; } = string.Empty;
    public double? Distance { get; set; }
    public List<double>? RelativeLocation { get; set; }
    public List<double>? RelativeRotation { get; set; }
}

sealed class ScsNodeOverride
{
    public string ParentComponentName { get; set; } = string.Empty;
    public string AttachSocketName { get; set; } = string.Empty;
    public string RelativeLocation { get; set; } = string.Empty;
    public string RelativeRotation { get; set; } = string.Empty;
    public string RelativeScale { get; set; } = string.Empty;
}

public sealed class FoxWatchModificationVariantReference
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool UseTemplateActor { get; set; }

    public string? TemplateMeshPath { get; set; }

    public string? TemplateActorPath { get; set; }
}

public sealed class FoxWatchMeshExportResult
{
    public string AssetPath { get; set; } = string.Empty;

    public string MeshType { get; set; } = string.Empty;

    public string MeshFormat { get; set; } = string.Empty;

    public string? ObjectName { get; set; }

    public string? Label { get; set; }

    public string? SavedFilePath { get; set; }
}
