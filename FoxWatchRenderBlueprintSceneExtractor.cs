namespace FoxWatchService;

using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;

public sealed class FoxWatchRenderBlueprintSceneExtractor
{
    private const string BlueprintPackagePrefix = "War/Content/Blueprints/";
    private const string ModificationDataPackagePrefix = "War/Content/Blueprints/Structures/Facilities/Modifications/Data/";
    private const string VehicleMeshPackagePrefix = "War/Content/Meshes/Vehicles/";
    private const string ShippableMeshPackagePrefix = "War/Content/Meshes/Shippables/";
    private const string CraneRailTrackMeshPackagePath = "War/Content/Meshes/Structures/CraneRailTrack.uasset";
    private const string StructureArrowComponentName = "StructureArrow";
    private const string FacilityFoundationDirtMaterialSidecarName = "FacilityFoundationDirt";
    private const string FacilityFoundationConcreteMaterialSidecarName = "FacilityFoundationConcrete";
    private static readonly List<double> PowerSocketDebugColor = [0.85, 0.15, 0.15, 1.0];
    private static readonly List<double> PipeSocketDebugColor = [0.15, 0.55, 0.95, 1.0];
    private static readonly List<double> GenericSocketDebugColor = [0.95, 0.65, 0.15, 1.0];
    private static readonly IReadOnlyDictionary<string, string> PackagedPalletMeshPackagePathByShippableType =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["small"] = $"{ShippableMeshPackagePrefix}ShippingContainerNormalExposed.uasset",
            ["normal"] = $"{ShippableMeshPackagePrefix}ShippingContainerNormalExposed.uasset",
            ["large"] = $"{ShippableMeshPackagePrefix}ShippingContainerLargeExposed.uasset",
            ["extralarge"] = $"{ShippableMeshPackagePrefix}ShippingContainerExtraLargeExposed.uasset",
        };

    private static readonly Regex VectorPattern = new(@"X=(?<x>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s+Y=(?<y>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s+Z=(?<z>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex RotatorPattern = new(@"P=(?<pitch>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s+Y=(?<yaw>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s+R=(?<roll>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly FoxWatchAssetMeshExporter _meshAssetExporter;
    private readonly ILogger<FoxWatchRenderBlueprintSceneExtractor> _logger;

    public FoxWatchRenderBlueprintSceneExtractor(
        FoxWatchAssetMeshExporter meshAssetExporter,
        ILogger<FoxWatchRenderBlueprintSceneExtractor> logger)
    {
        _meshAssetExporter = meshAssetExporter;
        _logger = logger;
    }

    public async Task<FoxWatchBlueprintSceneExtraction?> TryExtractAsync(FoxWatchManifestStructure structure, CancellationToken cancellationToken = default)
    {
        var blueprintPackagePath = ResolveBlueprintPackagePath(structure);
        if (string.IsNullOrWhiteSpace(blueprintPackagePath))
        {
            return null;
        }

        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences;
        try
        {
            componentReferences = await _meshAssetExporter.InspectBlueprintComponentsAsync(blueprintPackagePath, cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Skipping blueprint scene extraction for {StructureId} from {BlueprintPackagePath}", structure.Id, blueprintPackagePath);
            return null;
        }

        if (componentReferences.Count == 0)
        {
            return null;
        }

        var normalizedComponentReferences = componentReferences.ToList();
        await ApplyFoundationStructureBlueprintCorrectionsAsync(
            structure,
            blueprintPackagePath,
            normalizedComponentReferences,
            cancellationToken);

        var includeDestroyedComponents =
            structure.IsDestroyed == true
            || string.Equals(structure.ProfileType, "DestroyedStructure", StringComparison.OrdinalIgnoreCase)
            || string.Equals(structure.ProfileType, "DestroyedFort", StringComparison.OrdinalIgnoreCase)
            || structure.Id.Contains("destroyed", StringComparison.OrdinalIgnoreCase)
            || structure.CodeName.Contains("Destroyed", StringComparison.OrdinalIgnoreCase);

        var extraction = BuildExtraction(
            structure.Id,
            structure.CodeName,
            blueprintPackagePath,
            normalizedComponentReferences,
            allowDestroyedComponents: includeDestroyedComponents);
        await AppendModificationSlotVariantsAsync(structure, extraction, normalizedComponentReferences, cancellationToken);

        return extraction;
    }

    public async Task<FoxWatchBlueprintSceneExtraction?> TryExtractDestroyedVehicleAsync(FoxWatchManifestStructure structure, CancellationToken cancellationToken = default)
    {
        if (structure.IsVehicle != true || string.IsNullOrWhiteSpace(structure.Destroyed?.ComponentName))
        {
            return null;
        }

        var blueprintPackagePath = ResolveBlueprintPackagePath(structure);
        if (string.IsNullOrWhiteSpace(blueprintPackagePath))
        {
            return null;
        }

        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences;
        try
        {
            componentReferences = await _meshAssetExporter.InspectBlueprintComponentsAsync(blueprintPackagePath, cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Skipping destroyed vehicle scene extraction for {StructureId} from {BlueprintPackagePath}", structure.Id, blueprintPackagePath);
            return null;
        }

        if (componentReferences.Count == 0)
        {
            return null;
        }

        var destroyedComponentName = structure.Destroyed.ComponentName;
        var currentBlueprintComponentReferences = FilterCurrentBlueprintComponentReferences(componentReferences, blueprintPackagePath);
        var destroyedMeshReference = currentBlueprintComponentReferences.FirstOrDefault(reference =>
            string.Equals(reference.ComponentName, destroyedComponentName, StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(reference.MeshPath));
        if (destroyedMeshReference == null)
        {
            return null;
        }

        var extraction = BuildExtraction(
            structure.Id,
            structure.CodeName,
            blueprintPackagePath,
            [destroyedMeshReference],
            allowDestroyedComponents: true);

        var normalizedDestroyedNodeIdSuffix = string.Concat(destroyedComponentName
            .Trim()
            .Select(character => char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : '-'))
            .Trim('-');
        var destroyedNode = FindFirstMatchingNode(
            extraction.Roots,
            node => string.Equals(node.Name, destroyedComponentName, StringComparison.OrdinalIgnoreCase)
                || node.Name.EndsWith($":{destroyedComponentName}", StringComparison.OrdinalIgnoreCase)
                || node.Id.EndsWith($":{NormalizeReferenceName(destroyedComponentName)}", StringComparison.OrdinalIgnoreCase)
                || (!string.IsNullOrWhiteSpace(normalizedDestroyedNodeIdSuffix)
                    && node.Id.EndsWith($"-{normalizedDestroyedNodeIdSuffix}", StringComparison.OrdinalIgnoreCase)));
        if (destroyedNode == null)
        {
            return null;
        }

        if (!SubtreeContainsMesh(destroyedNode))
        {
            return null;
        }

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = [CloneNode(destroyedNode)],
            Meshes = extraction.Meshes.Select(CloneMeshAsset).ToList(),
            Variants = null,
        };
    }

    public Task<FoxWatchBlueprintSceneExtraction?> TryExtractPackagedAsync(
        FoxWatchManifestStructure structure,
        CancellationToken cancellationToken = default)
    {
        var packagedMeshPackagePath = structure.Packaged?.MeshPackagePath;
        if (string.IsNullOrWhiteSpace(packagedMeshPackagePath))
        {
            return Task.FromResult<FoxWatchBlueprintSceneExtraction?>(null);
        }

        return Task.FromResult<FoxWatchBlueprintSceneExtraction?>(CreateStandaloneMeshExtraction(
            $"{structure.Id}:packaged",
            structure.CodeName,
            new[] { packagedMeshPackagePath }));
    }

    public FoxWatchBlueprintSceneExtraction? CreateSharedPackagedPalletExtraction(string shippableType)
    {
        var palletMeshPackagePath = ResolvePackagedPalletMeshPackagePath(shippableType);
        var normalizedShippableType = NormalizeShippableType(shippableType);
        if (string.IsNullOrWhiteSpace(palletMeshPackagePath) || string.IsNullOrWhiteSpace(normalizedShippableType))
        {
            return null;
        }

        return CreateStandaloneMeshExtraction(
            $"packaged-pallets:{normalizedShippableType}",
            $"{normalizedShippableType}-pallet",
            [palletMeshPackagePath]);
    }

    private static IReadOnlyList<FoxWatchBlueprintComponentReference> FilterCurrentBlueprintComponentReferences(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        string blueprintPackagePath)
    {
        var currentBlueprintClassId = NormalizeBlueprintClassId(blueprintPackagePath);
        if (string.IsNullOrWhiteSpace(currentBlueprintClassId))
        {
            return componentReferences;
        }

        return componentReferences
            .Where(reference => string.Equals(NormalizeBlueprintClassId(reference.SourceClassName), currentBlueprintClassId, StringComparison.OrdinalIgnoreCase))
            .ToList();
    }

    private static string? ResolvePackagedPalletMeshPackagePath(string? shippableType)
    {
        var normalizedShippableType = NormalizeShippableType(shippableType);
        if (string.IsNullOrWhiteSpace(normalizedShippableType))
        {
            return null;
        }

        return PackagedPalletMeshPackagePathByShippableType.TryGetValue(normalizedShippableType, out var packagePath)
            ? packagePath
            : null;
    }

    private static string? NormalizeShippableType(string? shippableType)
    {
        var normalizedShippableType = string.Concat((shippableType ?? string.Empty)
            .Trim()
            .Where(char.IsLetterOrDigit)
            .Select(char.ToLowerInvariant));
        if (string.Equals(normalizedShippableType, "small", StringComparison.OrdinalIgnoreCase))
        {
            return "normal";
        }

        return string.IsNullOrWhiteSpace(normalizedShippableType)
            ? null
            : normalizedShippableType;
    }

    private static FoxWatchBlueprintSceneExtraction? CreateStandaloneMeshExtraction(
        string nodeIdPrefix,
        string rootNodeName,
        IReadOnlyList<string> meshPackagePaths)
    {
        var normalizedMeshPackagePaths = meshPackagePaths
            .Where(meshPackagePath => !string.IsNullOrWhiteSpace(meshPackagePath))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (normalizedMeshPackagePaths.Length == 0)
        {
            return null;
        }

        var meshIdBySourcePath = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var rootNode = new FoxWatchRenderSceneNode
        {
            Id = $"{nodeIdPrefix}:root",
            Name = rootNodeName,
        };
        rootNode.UnrealRotationDegrees = [0.0, 0.0, 0.0];

        for (var index = 0; index < normalizedMeshPackagePaths.Length; index += 1)
        {
            var meshPackagePath = normalizedMeshPackagePaths[index];
            var meshSourcePath = ConvertPackagePathToMeshSourcePath(meshPackagePath);
            rootNode.Children.Add(new FoxWatchRenderSceneNode
            {
                Id = $"{nodeIdPrefix}:mesh-{index + 1}",
                Name = Path.GetFileNameWithoutExtension(meshPackagePath),
                MeshId = GetOrAddMeshId(meshIdBySourcePath, meshSourcePath),
            });
        }

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = [rootNode],
            Meshes = meshIdBySourcePath
                .OrderBy(entry => entry.Value, StringComparer.Ordinal)
                .Select(entry => new FoxWatchRenderSceneMeshAsset
                {
                    Id = entry.Value,
                    SourcePath = entry.Key,
                })
                .ToList(),
            Variants = null,
        };
    }

    private static string NormalizeBlueprintClassId(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var normalizedValue = value.Replace('\\', '/').Trim();
        if (string.IsNullOrWhiteSpace(normalizedValue))
        {
            return string.Empty;
        }

        var classId = Path.GetFileNameWithoutExtension(normalizedValue);
        if (classId.EndsWith("_C", StringComparison.OrdinalIgnoreCase))
        {
            classId = classId[..^2];
        }

        return classId;
    }

    private FoxWatchBlueprintSceneExtraction? TryBuildStandaloneDestroyedVehicleExtraction(
        FoxWatchManifestStructure structure,
        string blueprintPackagePath,
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        FoxWatchRenderSceneNode templateNode)
    {
        var destroyedMeshPackagePath = ResolveDestroyedVehicleMeshPackagePath(structure, blueprintPackagePath, componentReferences);
        if (string.IsNullOrWhiteSpace(destroyedMeshPackagePath))
        {
            return null;
        }

        var meshSourcePath = ConvertPackagePathToMeshSourcePath(destroyedMeshPackagePath);
        var meshIdBySourcePath = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var meshId = GetOrAddMeshId(meshIdBySourcePath, meshSourcePath);
        var root = CloneNode(templateNode);
        root.MeshId = meshId;

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = [root],
            Meshes = [
                new FoxWatchRenderSceneMeshAsset
                {
                    Id = meshId,
                    SourcePath = meshSourcePath,
                },
            ],
            Variants = null,
        };
    }

    private string? ResolveDestroyedVehicleMeshPackagePath(
        FoxWatchManifestStructure structure,
        string blueprintPackagePath,
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        foreach (var candidatePath in BuildDestroyedVehicleMeshCandidatePaths(structure, blueprintPackagePath, componentReferences))
        {
            var packageName = Path.GetFileNameWithoutExtension(candidatePath);
            if (string.IsNullOrWhiteSpace(packageName))
            {
                continue;
            }

            var resolvedPath = _meshAssetExporter
                .FindPackages(packageName, limit: 32, pathPrefix: VehicleMeshPackagePrefix)
                .FirstOrDefault(path =>
                    !path.Contains("MapAsset", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(path, candidatePath, StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrWhiteSpace(resolvedPath))
            {
                return resolvedPath;
            }
        }

        return null;
    }

    private static IReadOnlyList<string> BuildDestroyedVehicleMeshCandidatePaths(
        FoxWatchManifestStructure structure,
        string blueprintPackagePath,
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var candidatePaths = new List<string>();
        var seenCandidatePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var meshPath in componentReferences
            .Select(reference => reference.MeshPath)
            .Where(meshPath => !string.IsNullOrWhiteSpace(meshPath)))
        {
            AddDestroyedVehicleMeshCandidatePaths(candidatePaths, seenCandidatePaths, meshPath);
        }

        AddDestroyedVehicleMeshCandidatePaths(candidatePaths, seenCandidatePaths, structure.CodeName);
        AddDestroyedVehicleMeshCandidatePaths(candidatePaths, seenCandidatePaths, structure.Id);

        var blueprintStem = Path.GetFileNameWithoutExtension(blueprintPackagePath);
        if (!string.IsNullOrWhiteSpace(blueprintStem))
        {
            AddDestroyedVehicleMeshCandidatePaths(candidatePaths, seenCandidatePaths, blueprintStem);
        }

        return candidatePaths;
    }

    private static void AddDestroyedVehicleMeshCandidatePaths(
        IList<string> candidatePaths,
        ISet<string> seenCandidatePaths,
        string? value)
    {
        foreach (var stem in EnumerateDestroyedVehicleCandidateStems(value))
        {
            var candidatePath = $"{VehicleMeshPackagePrefix}{stem}Destroyed.uasset";
            if (seenCandidatePaths.Add(candidatePath))
            {
                candidatePaths.Add(candidatePath);
            }
        }
    }

    private static IReadOnlyList<string> EnumerateDestroyedVehicleCandidateStems(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        var normalizedValue = value.Replace('\\', '/').Trim();
        if (string.IsNullOrWhiteSpace(normalizedValue))
        {
            return [];
        }

        var stems = new List<string>();
        var seenStems = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void AddStem(string? stem)
        {
            if (string.IsNullOrWhiteSpace(stem))
            {
                return;
            }

            var trimmedStem = stem.Trim();
            if (trimmedStem.EndsWith("Destroyed", StringComparison.OrdinalIgnoreCase))
            {
                trimmedStem = trimmedStem[..^"Destroyed".Length];
            }

            if (seenStems.Add(trimmedStem))
            {
                stems.Add(trimmedStem);
            }
        }

        var fileStem = Path.GetFileNameWithoutExtension(normalizedValue);
        AddStem(fileStem);

        if (!string.IsNullOrWhiteSpace(fileStem) && fileStem.Length > 3 && fileStem[2] == '_')
        {
            AddStem(fileStem[3..]);
        }

        if (!string.IsNullOrWhiteSpace(fileStem) && fileStem.StartsWith("BP", StringComparison.OrdinalIgnoreCase) && fileStem.Length > 2)
        {
            AddStem(fileStem[2..]);
        }

        return stems;
    }

    private static bool SubtreeContainsMesh(FoxWatchRenderSceneNode node)
    {
        if (!string.IsNullOrWhiteSpace(node.MeshId))
        {
            return true;
        }

        return node.Children.Any(SubtreeContainsMesh);
    }

    private FoxWatchBlueprintSceneExtraction BuildExtraction(
        string nodeIdPrefix,
        string rootNodeName,
        string blueprintPackagePath,
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        bool allowDestroyedComponents = false)
    {
        PopulateFallbackSplineConnectorMeshPaths(blueprintPackagePath, componentReferences);
        PopulateFallbackSplineConnectorTargets(componentReferences);
        NormalizeTrackedVehicleBodyHierarchy(componentReferences);
        NormalizeShipBodyHierarchy(componentReferences);
        NormalizeVehicleBodyFrameHierarchy(componentReferences);
        NormalizeEmplacedWeaponBodyHierarchy(componentReferences);
        NormalizeAircraftPartSlotBodyHierarchy(componentReferences);
        NormalizeAircraftHiddenRoofHierarchy(componentReferences);
        NormalizeAircraftPartSlotGroupTransforms(componentReferences);
        NormalizeDetachedFortRoofShellHierarchy(componentReferences);

        var deduplicatedComponentReferences = DeduplicateEquivalentMeshReferences(componentReferences);
        var hiddenSubtreeComponentNames = BuildHiddenSubtreeComponentNames(deduplicatedComponentReferences);

        var meshIdBySourcePath = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var materialSidecarOverrideByMeshId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var poseAnimationPackagePathsBySourcePath = BuildPoseAnimationPackagePathsBySourcePath(deduplicatedComponentReferences);
        var nodesByComponentName = new Dictionary<string, FoxWatchRenderSceneNode>(StringComparer.OrdinalIgnoreCase);
        var rootNode = new FoxWatchRenderSceneNode
        {
            Id = $"{nodeIdPrefix}:root",
            Name = rootNodeName,
        };

        foreach (var componentReference in deduplicatedComponentReferences)
        {
            if (hiddenSubtreeComponentNames.Contains(componentReference.ComponentName) ||
                ShouldSkipComponentInDefaultScene(nodeIdPrefix, componentReference, allowDestroyedComponents))
            {
                continue;
            }

            var node = CreateNode(nodeIdPrefix, componentReference, meshIdBySourcePath);
            if (!string.IsNullOrWhiteSpace(componentReference.MaterialSidecarNameOverride) &&
                !string.IsNullOrWhiteSpace(node.MeshId))
            {
                materialSidecarOverrideByMeshId[node.MeshId] = componentReference.MaterialSidecarNameOverride;
            }

            nodesByComponentName[componentReference.ComponentName] = node;
        }

        foreach (var componentReference in deduplicatedComponentReferences)
        {
            if (!nodesByComponentName.TryGetValue(componentReference.ComponentName, out var node))
            {
                continue;
            }

            var attachParentName = ResolveAttachParentName(componentReference, nodesByComponentName);
            if (!string.IsNullOrWhiteSpace(attachParentName) &&
                nodesByComponentName.TryGetValue(attachParentName, out var parentNode) &&
                !ReferenceEquals(parentNode, node))
            {
                parentNode.Children.Add(node);
                continue;
            }

            rootNode.Children.Add(node);
        }

        RepairKnownHospitalCurtainHierarchy(nodeIdPrefix, deduplicatedComponentReferences, nodesByComponentName, rootNode);

        var meshAssets = meshIdBySourcePath
            .OrderBy(entry => entry.Value, StringComparer.Ordinal)
            .Select(entry =>
            {
                poseAnimationPackagePathsBySourcePath.TryGetValue(entry.Key, out var poseAnimationPackagePaths);
                return new FoxWatchRenderSceneMeshAsset
                {
                    Id = entry.Value,
                    SourcePath = entry.Key,
                    DefaultPoseAnimationPackagePath = SelectDefaultPoseAnimationPackagePath(poseAnimationPackagePaths),
                    PoseAnimationPackagePaths = poseAnimationPackagePaths?.Count > 0
                        ? [.. poseAnimationPackagePaths]
                        : null,
                    MaterialSidecarNameOverride = materialSidecarOverrideByMeshId.TryGetValue(entry.Value, out var materialSidecarNameOverride)
                        ? materialSidecarNameOverride
                        : null,
                };
            })
            .ToList();

        _logger.LogInformation(
            "Extracted blueprint scene for {SceneIdPrefix} from {BlueprintPackagePath} with {NodeCount} nodes and {MeshCount} mesh assets",
            nodeIdPrefix,
            blueprintPackagePath,
            nodesByComponentName.Count,
            meshAssets.Count);

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = [rootNode],
            Meshes = meshAssets,
        };
    }

    private static void RepairKnownHospitalCurtainHierarchy(
        string nodeIdPrefix,
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        IReadOnlyDictionary<string, FoxWatchRenderSceneNode> nodesByComponentName,
        FoxWatchRenderSceneNode rootNode)
    {
        if (!string.Equals(nodeIdPrefix, "hospital", StringComparison.OrdinalIgnoreCase) ||
            !nodesByComponentName.TryGetValue("Curtains", out var curtainsNode))
        {
            return;
        }

        foreach (var componentReference in componentReferences)
        {
            if (string.IsNullOrWhiteSpace(componentReference.MeshPath) ||
                componentReference.MeshPath.IndexOf("/HospitalCurtains", StringComparison.OrdinalIgnoreCase) < 0 ||
                !nodesByComponentName.TryGetValue(componentReference.ComponentName, out var curtainMeshNode) ||
                ReferenceEquals(curtainMeshNode, curtainsNode))
            {
                continue;
            }

            rootNode.Children.Remove(curtainMeshNode);
            if (!curtainsNode.Children.Contains(curtainMeshNode))
            {
                curtainsNode.Children.Add(curtainMeshNode);
            }
        }
    }

    private async Task ApplyFoundationStructureBlueprintCorrectionsAsync(
        FoxWatchManifestStructure structure,
        string blueprintPackagePath,
        List<FoxWatchBlueprintComponentReference> componentReferences,
        CancellationToken cancellationToken)
    {
        if (!IsFacilityFoundationStructure(structure) ||
            !TryResolveFoundationTier(structure, out var foundationTier))
        {
            return;
        }

        var currentBlueprintReferences = FilterCurrentBlueprintComponentReferences(componentReferences, blueprintPackagePath);
        if (string.Equals(foundationTier, "t3", StringComparison.OrdinalIgnoreCase))
        {
            var siblingBlueprintPackagePath = ResolveFoundationTierSiblingBlueprintPackagePath(structure);
            if (!string.IsNullOrWhiteSpace(siblingBlueprintPackagePath))
            {
                try
                {
                    var siblingComponentReferences = await _meshAssetExporter.InspectBlueprintComponentsAsync(
                        siblingBlueprintPackagePath,
                        cancellationToken);
                    ApplyFoundationBorderRotationCorrections(
                        currentBlueprintReferences,
                        FilterCurrentBlueprintComponentReferences(siblingComponentReferences, siblingBlueprintPackagePath));
                }
                catch (Exception exception)
                {
                    _logger.LogWarning(
                        exception,
                        "Skipping foundation border rotation correction for {StructureId} because sibling blueprint {SiblingBlueprintPackagePath} could not be inspected",
                        structure.Id,
                        siblingBlueprintPackagePath);
                }
            }
        }

        foreach (var componentReference in currentBlueprintReferences)
        {
            if (!IsFoundationFloorComponent(componentReference))
            {
                continue;
            }

            if (string.Equals(foundationTier, "t3", StringComparison.OrdinalIgnoreCase) &&
                UsesDirtFoundationFloorMesh(componentReference.MeshPath))
            {
                componentReference.MaterialSidecarNameOverride = FacilityFoundationConcreteMaterialSidecarName;
            }
            else if (string.Equals(foundationTier, "t1", StringComparison.OrdinalIgnoreCase))
            {
                componentReference.MaterialSidecarNameOverride = FacilityFoundationDirtMaterialSidecarName;
            }
        }
    }

    private static bool IsFacilityFoundationStructure(FoxWatchManifestStructure structure)
    {
        var structureId = structure.Id ?? string.Empty;
        return structureId.StartsWith("foundation", StringComparison.OrdinalIgnoreCase) &&
            !structureId.Contains("railtracksplinefoundation", StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryResolveFoundationTier(FoxWatchManifestStructure structure, out string foundationTier)
    {
        foundationTier = string.Empty;

        var structureId = structure.Id ?? string.Empty;
        if (structureId.EndsWith("t3", StringComparison.OrdinalIgnoreCase))
        {
            foundationTier = "t3";
            return true;
        }

        if (structureId.EndsWith("t1", StringComparison.OrdinalIgnoreCase))
        {
            foundationTier = "t1";
            return true;
        }

        return false;
    }

    private static string? ResolveFoundationTierSiblingBlueprintPackagePath(FoxWatchManifestStructure structure)
    {
        var codeName = structure.CodeName ?? string.Empty;
        if (codeName.EndsWith("T3", StringComparison.OrdinalIgnoreCase))
        {
            return $"War/Content/Blueprints/Structures/Facilities/BP{codeName[..^2]}T1.uasset";
        }

        if (codeName.EndsWith("T1", StringComparison.OrdinalIgnoreCase))
        {
            return $"War/Content/Blueprints/Structures/Facilities/BP{codeName[..^2]}T3.uasset";
        }

        return null;
    }

    private static bool IsFoundationBorderTrimComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
        {
            return false;
        }

        var normalizedComponentName = NormalizeReferenceName(componentReference.ComponentName);
        if (string.IsNullOrWhiteSpace(normalizedComponentName))
        {
            return false;
        }

        return normalizedComponentName.Contains("border", StringComparison.OrdinalIgnoreCase) ||
            normalizedComponentName.Contains("pillar", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsFoundationFloorComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        return string.Equals(
            NormalizeReferenceName(componentReference.ComponentName),
            "Foundation",
            StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(componentReference.MeshPath);
    }

    private static bool UsesDirtFoundationFloorMesh(string? meshPath)
    {
        if (string.IsNullOrWhiteSpace(meshPath))
        {
            return false;
        }

        var meshFileName = Path.GetFileNameWithoutExtension(meshPath);
        return string.Equals(meshFileName, "Foundation012x2T1", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(meshFileName, "Foundation01_1x2_T1", StringComparison.OrdinalIgnoreCase);
    }

    private static bool UsesConcreteFoundationFloorMesh(string? meshPath)
    {
        if (string.IsNullOrWhiteSpace(meshPath))
        {
            return false;
        }

        return meshPath.Contains("ConcreteFoundation", StringComparison.OrdinalIgnoreCase);
    }

    private static void ApplyFoundationBorderRotationCorrections(
        IEnumerable<FoxWatchBlueprintComponentReference> targetComponentReferences,
        IReadOnlyList<FoxWatchBlueprintComponentReference> referenceComponentReferences)
    {
        var referenceRotationsByComponentName = referenceComponentReferences
            .Where(IsFoundationBorderTrimComponent)
            .Where(reference => HasMeaningfulRotation(reference.RelativeRotation))
            .GroupBy(reference => reference.ComponentName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First().RelativeRotation, StringComparer.OrdinalIgnoreCase);

        foreach (var componentReference in targetComponentReferences.Where(IsFoundationBorderTrimComponent))
        {
            if (HasMeaningfulRotation(componentReference.RelativeRotation) ||
                !referenceRotationsByComponentName.TryGetValue(componentReference.ComponentName, out var referenceRotation) ||
                string.IsNullOrWhiteSpace(referenceRotation))
            {
                continue;
            }

            componentReference.RelativeRotation = referenceRotation;
        }
    }

    private static IReadOnlyList<FoxWatchBlueprintComponentReference> DeduplicateEquivalentMeshReferences(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var deduplicated = new List<FoxWatchBlueprintComponentReference>();

        foreach (var componentReference in componentReferences)
        {
            if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
            {
                deduplicated.Add(componentReference);
                continue;
            }

            var duplicateIndex = deduplicated.FindIndex(existing =>
                !string.IsNullOrWhiteSpace(existing.MeshPath) &&
                string.Equals(existing.MeshPath, componentReference.MeshPath, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(existing.AttachParentName, componentReference.AttachParentName, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(existing.AttachSocketName, componentReference.AttachSocketName, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(existing.RelativeLocation, componentReference.RelativeLocation, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(existing.RelativeRotation, componentReference.RelativeRotation, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(existing.RelativeScale, componentReference.RelativeScale, StringComparison.OrdinalIgnoreCase));

            if (duplicateIndex < 0)
            {
                deduplicated.Add(componentReference);
                continue;
            }

            if (GetMeshReferencePriority(componentReference) > GetMeshReferencePriority(deduplicated[duplicateIndex]))
            {
                deduplicated[duplicateIndex] = componentReference;
            }
        }

        return deduplicated;
    }

    private static int GetMeshReferencePriority(FoxWatchBlueprintComponentReference componentReference)
    {
        var priority = 0;

        if (componentReference.ComponentType.Contains("SkeletalMeshComponent", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(componentReference.MeshType, "skeletal", StringComparison.OrdinalIgnoreCase))
        {
            priority += 30;
        }

        if (componentReference.ComponentType.Contains("StaticMeshComponent", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(componentReference.MeshType, "static", StringComparison.OrdinalIgnoreCase))
        {
            priority += 30;
        }

        if (!string.Equals(componentReference.ComponentName, "ItemMesh", StringComparison.OrdinalIgnoreCase))
        {
            priority += 20;
        }

        if (!string.IsNullOrWhiteSpace(componentReference.RelativeLocation) ||
            !string.IsNullOrWhiteSpace(componentReference.RelativeRotation) ||
            !string.IsNullOrWhiteSpace(componentReference.RelativeScale))
        {
            priority += 10;
        }

        if (!string.IsNullOrWhiteSpace(componentReference.SourceClassName))
        {
            priority += 5;
        }

        return priority;
    }

    private static void NormalizeTrackedVehicleBodyHierarchy(IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var characterMesh = componentReferences.FirstOrDefault(reference =>
            string.Equals(reference.ComponentName, "CharacterMesh0", StringComparison.OrdinalIgnoreCase) &&
            (IsTrackedRunningGearMesh(reference.MeshPath) || IsTankLikeVehicleMesh(reference.MeshPath)));
        if (characterMesh == null)
        {
            return;
        }

        var nestedBodyMeshes = componentReferences.Where(reference =>
            string.Equals(reference.AttachParentName, "CharacterMesh0", StringComparison.OrdinalIgnoreCase) &&
            IsPrimaryTrackedVehicleBodyMesh(reference))
            .ToArray();

        var primaryBodyMesh = nestedBodyMeshes.FirstOrDefault()
            ?? componentReferences.FirstOrDefault(reference =>
                !ReferenceEquals(reference, characterMesh) &&
                IsPrimaryTrackedVehicleBodyMesh(reference));
        if (primaryBodyMesh == null)
        {
            NormalizeSingleMeshTrackedVehicle(characterMesh);
            return;
        }

        var primaryBodyMeshName = primaryBodyMesh.ComponentName;

        foreach (var attachedChild in componentReferences.Where(reference =>
                     !nestedBodyMeshes.Contains(reference) &&
                     string.Equals(reference.AttachParentName, "CharacterMesh0", StringComparison.OrdinalIgnoreCase) &&
                     !string.IsNullOrWhiteSpace(reference.AttachSocketName)))
        {
            attachedChild.AttachParentName = primaryBodyMeshName;
        }

        if (ShouldResetTrackedRunningGearTransform(characterMesh))
        {
            characterMesh.RelativeLocation = "X=0.000 Y=0.000 Z=0.000";
            characterMesh.RelativeRotation = "P=0 Y=0 R=0";
            characterMesh.RelativeScale = "X=1.000 Y=1.000 Z=1.000";
            characterMesh.AbsoluteLocation = string.Empty;
            characterMesh.AbsoluteRotation = string.Empty;
            characterMesh.AbsoluteScale = string.Empty;
        }

        characterMesh.AttachParentName = ResolveTrackedRunningGearParentName(componentReferences, characterMesh);
    }

    private static void NormalizeSingleMeshTrackedVehicle(FoxWatchBlueprintComponentReference characterMesh)
    {
        if (!IsTankLikeVehicleMesh(characterMesh.MeshPath) ||
            !ShouldResetTrackedRunningGearTransform(characterMesh))
        {
            return;
        }

        characterMesh.RelativeLocation = "X=0.000 Y=0.000 Z=0.000";
        characterMesh.RelativeRotation = "P=0 Y=0 R=0";
        characterMesh.RelativeScale = "X=1.000 Y=1.000 Z=1.000";
        characterMesh.AbsoluteLocation = string.Empty;
        characterMesh.AbsoluteRotation = string.Empty;
        characterMesh.AbsoluteScale = string.Empty;
    }

    private static void NormalizeShipBodyHierarchy(IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var componentLookup = componentReferences
            .Where(reference => !string.IsNullOrWhiteSpace(reference.ComponentName))
            .ToDictionary(reference => reference.ComponentName, StringComparer.OrdinalIgnoreCase);

        foreach (var componentReference in componentReferences)
        {
            var componentName = NormalizeReferenceName(componentReference.ComponentName);
            if ((!string.Equals(componentName, "CharacterMesh0", StringComparison.OrdinalIgnoreCase) &&
                 !string.Equals(componentName, "DestroyedMesh", StringComparison.OrdinalIgnoreCase)) ||
                string.IsNullOrWhiteSpace(componentReference.MeshPath))
            {
                continue;
            }

            var attachParentName = NormalizeReferenceName(componentReference.AttachParentName);
            if (!FoxWatchVehicleBodyFrameResolver.ShouldDetachNavalBodyFromCollision(componentReference.MeshPath, attachParentName))
            {
                continue;
            }

            if (!string.IsNullOrWhiteSpace(attachParentName) &&
                componentLookup.TryGetValue(attachParentName, out var parentReference))
            {
                BakeDetachedShipParentLocation(componentReference, parentReference);
            }

            if (FoxWatchVehicleBodyFrameResolver.ShouldQuarterTurnDetachedNavalBody(
                    componentReference.MeshPath,
                    attachParentName,
                    componentReference.RelativeRotation))
            {
                componentReference.RelativeRotation = "P=0.000 Y=270.000 R=0.000";
            }

            componentReference.AttachParentName = string.Empty;
            componentReference.AbsoluteLocation = string.Empty;
            componentReference.AbsoluteRotation = string.Empty;
            componentReference.AbsoluteScale = string.Empty;
        }
    }

    private void NormalizeVehicleBodyFrameHierarchy(IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        if (!TryResolveMeshBoundsVehicleBodyQuarterTurn(
                componentReferences,
                out var bodyComponentName,
                out var yawOffsetDegrees) &&
            !FoxWatchVehicleBodyFrameResolver.TryResolveQuarterTurnVehicleBodyYawOffset(
                componentReferences,
                out bodyComponentName,
                out yawOffsetDegrees))
        {
            return;
        }

        foreach (var bodyReference in EnumerateVehicleBodyFrameRotationTargets(componentReferences, bodyComponentName))
        {
            bodyReference.RelativeRotation = $"P=0.000 Y={yawOffsetDegrees:0.000} R=0.000";
        }
    }

    private static void NormalizeEmplacedWeaponBodyHierarchy(IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        if (!TryResolveQuarterTurnEmplacedBodyReference(componentReferences, out var bodyReference) ||
            !TryParseRotator(bodyReference.RelativeRotation, out var bodyRotation) ||
            bodyRotation.Count < 3)
        {
            return;
        }

        bodyReference.RelativeRotation = FormatRotator([
            bodyRotation[0],
            0.0,
            bodyRotation[2],
        ]);
    }

    private static bool TryResolveQuarterTurnEmplacedBodyReference(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        out FoxWatchBlueprintComponentReference bodyReference)
    {
        bodyReference = null!;

        var foundationReference = componentReferences.FirstOrDefault(reference =>
            string.Equals(NormalizeReferenceName(reference.ComponentName), "FoundationMesh", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(reference.MeshPath));
        var candidateBodyReference = componentReferences.FirstOrDefault(reference =>
            string.Equals(NormalizeReferenceName(reference.ComponentName), "SkeletalMesh", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(reference.MeshPath));
        if (foundationReference == null || candidateBodyReference == null)
        {
            return false;
        }

        bodyReference = candidateBodyReference;

        var normalizedBodyParentName = NormalizeReferenceName(bodyReference.AttachParentName);
        var normalizedBodyComponentName = NormalizeReferenceName(bodyReference.ComponentName);
        if (!string.Equals(normalizedBodyParentName, StructureArrowComponentName, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(normalizedBodyParentName, NormalizeReferenceName(foundationReference.AttachParentName), StringComparison.OrdinalIgnoreCase) ||
            HasMeaningfulRotation(foundationReference.RelativeRotation) ||
            string.IsNullOrWhiteSpace(normalizedBodyComponentName) ||
            !TryParseRotator(bodyReference.RelativeRotation, out var bodyRotation) ||
            bodyRotation.Count < 2 ||
            !TryNormalizeQuarterTurnYawDegrees(bodyRotation[1], out _) ||
            !componentReferences.Any(reference =>
                string.Equals(NormalizeReferenceName(reference.AttachParentName), normalizedBodyComponentName, StringComparison.OrdinalIgnoreCase) &&
                reference.ComponentType.Contains("StructureSeatComponent", StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        return true;
    }

    private static IEnumerable<FoxWatchBlueprintComponentReference> EnumerateVehicleBodyFrameRotationTargets(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        string bodyComponentName)
    {
        var yieldedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var bodyReference = componentReferences.FirstOrDefault(reference =>
            string.Equals(
                NormalizeReferenceName(reference.ComponentName),
                NormalizeReferenceName(bodyComponentName),
                StringComparison.OrdinalIgnoreCase));
        if (bodyReference != null && yieldedNames.Add(bodyReference.ComponentName))
        {
            yield return bodyReference;
        }

        foreach (var componentReference in componentReferences.Where(reference =>
                     IsPrimaryTrackedVehicleBodyMesh(reference) &&
                     string.IsNullOrWhiteSpace(NormalizeReferenceName(reference.AttachParentName)) &&
                     yieldedNames.Add(reference.ComponentName)))
        {
            yield return componentReference;
        }
    }

    private bool TryResolveMeshBoundsVehicleBodyQuarterTurn(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        out string bodyComponentName,
        out double yawOffsetDegrees)
    {
        bodyComponentName = string.Empty;
        yawOffsetDegrees = 0;

        var characterMeshReference = componentReferences.FirstOrDefault(reference =>
            string.Equals(NormalizeReferenceName(reference.ComponentName), "CharacterMesh0", StringComparison.OrdinalIgnoreCase));
        if (characterMeshReference == null || !IsCollisionAnchoredVehicleBody(characterMeshReference, componentReferences))
        {
            return false;
        }

        var visualBodyReference = componentReferences.FirstOrDefault(reference =>
                string.Equals(NormalizeReferenceName(reference.AttachParentName), "CharacterMesh0", StringComparison.OrdinalIgnoreCase) &&
                IsPrimaryTrackedVehicleBodyMesh(reference))
            ?? characterMeshReference;
        var xLengthCentimeters = _meshAssetExporter.ResolveMeshAxisLengthCentimeters(visualBodyReference.MeshPath, 'X');
        var yLengthCentimeters = _meshAssetExporter.ResolveMeshAxisLengthCentimeters(visualBodyReference.MeshPath, 'Y');
        if (xLengthCentimeters is not > 0 || yLengthCentimeters is not > 0 || yLengthCentimeters <= (xLengthCentimeters * 1.05))
        {
            return false;
        }

        bodyComponentName = characterMeshReference.ComponentName;
        yawOffsetDegrees = FoxWatchVehicleBodyFrameResolver.QuarterTurnYawDegrees;
        return true;
    }

    private static bool IsCollisionAnchoredVehicleBody(
        FoxWatchBlueprintComponentReference characterMeshReference,
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var normalizedAttachParentName = NormalizeReferenceName(characterMeshReference.AttachParentName);
        if (string.Equals(normalizedAttachParentName, "collisioncylinder", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(normalizedAttachParentName, "collision", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(normalizedAttachParentName, "vehiclecollision", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return componentReferences.Any(reference =>
            string.Equals(NormalizeReferenceName(reference.AttachParentName), "CharacterMesh0", StringComparison.OrdinalIgnoreCase) &&
            IsPrimaryTrackedVehicleBodyMesh(reference));
    }

    private static void BakeDetachedShipParentLocation(
        FoxWatchBlueprintComponentReference componentReference,
        FoxWatchBlueprintComponentReference parentReference)
    {
        var parentLocation = TryParseVector(parentReference.RelativeLocation, out var parsedParentLocation)
            ? parsedParentLocation
            : [0.0, 0.0, 0.0];
        var childLocation = TryParseVector(componentReference.RelativeLocation, out var parsedChildLocation)
            ? parsedChildLocation
            : [0.0, 0.0, 0.0];

        componentReference.RelativeLocation = FormatVector([
            childLocation[0] + parentLocation[0],
            childLocation[1] + parentLocation[1],
            childLocation[2] + parentLocation[2],
        ]);
    }

    private static void NormalizeAircraftPartSlotBodyHierarchy(IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        if (!componentReferences.Any(IsAircraftPartSlotGroupComponent) ||
            !componentReferences.Any(reference => string.Equals(reference.ComponentName, "FuselageGroup", StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        foreach (var componentReference in componentReferences.Where(ShouldReparentAircraftBodyShellToFuselageGroup))
        {
            componentReference.AttachParentName = "FuselageGroup";
        }
    }

    private static void NormalizeAircraftHiddenRoofHierarchy(IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        if (!componentReferences.Any(IsAircraftPartSlotGroupComponent))
        {
            return;
        }

        var availableComponentNames = componentReferences
            .Select(reference => reference.ComponentName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var componentReference in componentReferences)
        {
            var targetParentName = ResolveAircraftHiddenRoofParentName(componentReference, availableComponentNames);
            if (!string.IsNullOrWhiteSpace(targetParentName))
            {
                componentReference.AttachParentName = targetParentName;
                if (!IsSegmentedAircraftRoofShell(componentReference))
                {
                    ApplyAircraftHiddenRoofSlotTransform(componentReferences, componentReference);
                }
            }
        }
    }

    private static void ApplyAircraftHiddenRoofSlotTransform(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        FoxWatchBlueprintComponentReference roofComponentReference)
    {
        var matchingSlotReference = ResolveAircraftHiddenRoofSlotReference(componentReferences, roofComponentReference);
        if (matchingSlotReference == null)
        {
            return;
        }

        roofComponentReference.RelativeLocation = matchingSlotReference.RelativeLocation;
        roofComponentReference.RelativeRotation = matchingSlotReference.RelativeRotation;
        roofComponentReference.RelativeScale = matchingSlotReference.RelativeScale;
        roofComponentReference.AbsoluteLocation = string.Empty;
        roofComponentReference.AbsoluteRotation = string.Empty;
        roofComponentReference.AbsoluteScale = string.Empty;
    }

    private static void NormalizeAircraftPartSlotGroupTransforms(IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var shouldSynthesizeQuarterTurnYaw = ShouldSynthesizeAircraftPartSlotGroupQuarterTurn(componentReferences);

        foreach (var groupReference in componentReferences.Where(IsAircraftPartSlotGroupComponent))
        {
            var childSlotReferences = componentReferences
                .Where(reference =>
                    IsAircraftPartSlotComponent(reference) &&
                    string.Equals(reference.AttachParentName, groupReference.ComponentName, StringComparison.OrdinalIgnoreCase))
                .ToArray();
            if (childSlotReferences.Length == 0)
            {
                continue;
            }

            var shouldClearTranslation = HasMeaningfulTranslation(groupReference.RelativeLocation) &&
                !HasMeaningfulRotation(groupReference.RelativeRotation) &&
                !HasNonIdentityScale(groupReference.RelativeScale) &&
                !childSlotReferences.Any(HasExplicitLocalTransform);
            if (shouldClearTranslation)
            {
                groupReference.RelativeLocation = string.Empty;
                groupReference.AbsoluteLocation = string.Empty;
            }

            if (!shouldSynthesizeQuarterTurnYaw || HasMeaningfulRotation(groupReference.RelativeRotation))
            {
                continue;
            }

            groupReference.RelativeRotation = FormatRotator([0.0, -90.0, 0.0]);
            if (!TryParseVector(groupReference.RelativeScale, out _))
            {
                groupReference.RelativeScale = FormatVector([1.0, 1.0, 1.0]);
            }

            groupReference.AbsoluteRotation = string.Empty;
            groupReference.AbsoluteScale = string.Empty;
        }
    }

    private static bool ShouldSynthesizeAircraftPartSlotGroupQuarterTurn(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var aircraftPartGroupNames = componentReferences
            .Where(IsAircraftPartSlotGroupComponent)
            .Select(reference => reference.ComponentName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (aircraftPartGroupNames.Count == 0)
        {
            return false;
        }

        if (componentReferences.Any(reference =>
                IsAircraftPartSlotGroupComponent(reference) &&
                HasMeaningfulRotation(reference.RelativeRotation)))
        {
            return false;
        }

        var slotLocations = componentReferences
            .Where(reference =>
                IsAircraftPartSlotComponent(reference) &&
                aircraftPartGroupNames.Contains(reference.AttachParentName) &&
                TryParseVector(reference.RelativeLocation, out _))
            .Select(reference =>
            {
                TryParseVector(reference.RelativeLocation, out var relativeLocation);
                return relativeLocation;
            })
            .ToArray();
        if (slotLocations.Length < 3)
        {
            return false;
        }

        var xSpan = slotLocations.Max(location => location[0]) - slotLocations.Min(location => location[0]);
        var ySpan = slotLocations.Max(location => location[1]) - slotLocations.Min(location => location[1]);
        return xSpan > (ySpan * 1.1);
    }

    private async Task AppendModificationSlotVariantsAsync(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction extraction,
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        CancellationToken cancellationToken)
    {
        var structureId = structure.Id;
        var renderVariants = new List<FoxWatchRenderSceneVariant>();
        var registeredVariantIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var slotCandidates = new List<(string? ComponentName, string? DataClassPath)>();

        foreach (var componentReference in componentReferences.Where(reference =>
            reference.ComponentType.Contains("ModificationSlotComponent", StringComparison.OrdinalIgnoreCase)))
        {
            slotCandidates.Add((componentReference.ComponentName, componentReference.DataClassPath));
        }

        foreach (var slot in structure.ModificationSlots ?? [])
        {
            slotCandidates.Add((slot.Name, slot.DataClassPath));
        }

        if (!slotCandidates.Any(candidate => !string.IsNullOrWhiteSpace(candidate.DataClassPath)))
        {
            slotCandidates.Add((slotCandidates.FirstOrDefault().ComponentName, InferModificationDataClassPath(ResolveBlueprintPackagePath(structure))));
        }

        foreach (var slotCandidate in slotCandidates
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.DataClassPath))
            .Distinct())
        {
            IReadOnlyList<FoxWatchModificationVariantReference> modificationVariants;
            try
            {
                modificationVariants = await _meshAssetExporter.InspectModificationVariantsAsync(
                    slotCandidate.DataClassPath!,
                    cancellationToken,
                    structure.Tier);
            }

            catch (Exception exception)
            {
                _logger.LogWarning(
                    exception,
                    "Skipping modification slot overlays for {StructureId} because modification data inspection failed for {DataClassPath}",
                    structureId,
                    slotCandidate.DataClassPath);
                continue;
            }

            if (modificationVariants.Count == 0)
            {
                continue;
            }

            var attachNode = FindModificationSlotAttachNode(extraction.Roots, slotCandidate.ComponentName)
                ?? FindNodeByName(extraction.Roots, StructureArrowComponentName)
                ?? extraction.Roots.FirstOrDefault();
            if (attachNode == null)
            {
                _logger.LogWarning("Skipping modification slot overlays for {StructureId} because no attach node was found", structureId);
                continue;
            }

            foreach (var modificationVariant in modificationVariants)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var variantExtraction = await TryBuildModificationVariantExtractionAsync(structureId, modificationVariant, extraction, attachNode, cancellationToken);
                if (variantExtraction == null)
                {
                    // Default slot variants are the base host meshes — no overlay/icons/renders expected.
                    if (!string.Equals(modificationVariant.Id, "default", StringComparison.OrdinalIgnoreCase))
                    {
                        _logger.LogWarning(
                            "Skipping modification slot variant {VariantId} for {StructureId} because no scene overlay could be built",
                            modificationVariant.Id,
                            structureId);
                    }

                    continue;
                }

                if (registeredVariantIds.Add(modificationVariant.Id))
                {
                    renderVariants.Add(new FoxWatchRenderSceneVariant
                    {
                        Id = modificationVariant.Id,
                        Name = string.IsNullOrWhiteSpace(modificationVariant.Name) ? modificationVariant.Id : modificationVariant.Name,
                        IsDefault = string.Equals(modificationVariant.Id, "default", StringComparison.OrdinalIgnoreCase),
                    });
                }

                MergeMeshAssets(extraction, variantExtraction);
                foreach (var variantRoot in variantExtraction.Roots)
                {
                    if (!string.IsNullOrWhiteSpace(modificationVariant.Id))
                    {
                        variantRoot.VariantIds = [modificationVariant.Id];
                    }

                    attachNode.Children.Add(variantRoot);
                }
            }
        }

        if (renderVariants.Count > 0)
        {
            extraction.Variants = renderVariants;
        }
    }

    private string? InferModificationDataClassPath(string? blueprintPackagePath)
    {
        var normalizedBlueprintPath = string.IsNullOrWhiteSpace(blueprintPackagePath)
            ? string.Empty
            : blueprintPackagePath.Replace('\\', '/').Trim();
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
        var packages = _meshAssetExporter.FindPackages(candidatePath, limit: 1);
        if (packages.Count > 0)
        {
            return packages[0];
        }

        packages = _meshAssetExporter.FindPackages($"{blueprintName}_UpgradeSlotComponent", limit: 1, pathPrefix: ModificationDataPackagePrefix);
        return packages.Count > 0 ? packages[0] : null;
    }

    private async Task<FoxWatchBlueprintSceneExtraction?> TryBuildModificationVariantExtractionAsync(
        string structureId,
        FoxWatchModificationVariantReference modificationVariant,
        FoxWatchBlueprintSceneExtraction baseExtraction,
        FoxWatchRenderSceneNode attachNode,
        CancellationToken cancellationToken)
    {
        var variantNodeIdPrefix = $"{structureId}:upgrade:{modificationVariant.Id}";
        if (modificationVariant.UseTemplateActor && !string.IsNullOrWhiteSpace(modificationVariant.TemplateActorPath))
        {
            IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences;
            try
            {
                componentReferences = await _meshAssetExporter.InspectBlueprintComponentsAsync(modificationVariant.TemplateActorPath, cancellationToken);
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Skipping overlay blueprint extraction for {BlueprintPackagePath}", modificationVariant.TemplateActorPath);
                return null;
            }

            if (componentReferences.Count == 0)
            {
                return null;
            }

            var blueprintExtraction = BuildExtraction(
                variantNodeIdPrefix,
                modificationVariant.Name,
                modificationVariant.TemplateActorPath,
                componentReferences);
            if (blueprintExtraction.Meshes.Count > 0)
            {
                return blueprintExtraction;
            }

            return TryBuildStaticMeshOverrideVariantExtraction(
                variantNodeIdPrefix,
                modificationVariant.Name,
                attachNode,
                baseExtraction,
                componentReferences);
        }

        if (!string.IsNullOrWhiteSpace(modificationVariant.TemplateMeshPath))
        {
            var meshSourcePath = ConvertPackagePathToMeshSourcePath(modificationVariant.TemplateMeshPath);
            var meshIdBySourcePath = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var meshId = GetOrAddMeshId(meshIdBySourcePath, meshSourcePath);
            return new FoxWatchBlueprintSceneExtraction
            {
                Roots = [
                    new FoxWatchRenderSceneNode
                    {
                        Id = $"{variantNodeIdPrefix}:root",
                        Name = modificationVariant.Name,
                        MeshId = meshId,
                    },
                ],
                Meshes = [
                    new FoxWatchRenderSceneMeshAsset
                    {
                        Id = meshId,
                        SourcePath = meshSourcePath,
                    },
                ],
            };
        }

        return null;
    }

    private static FoxWatchBlueprintSceneExtraction? TryBuildStaticMeshOverrideVariantExtraction(
        string variantNodeIdPrefix,
        string variantName,
        FoxWatchRenderSceneNode attachNode,
        FoxWatchBlueprintSceneExtraction baseExtraction,
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var overrideMeshSourcePathByTargetMeshSourcePath = componentReferences
            .SelectMany(reference => reference.StaticMeshOverrides)
            .Where(overrideReference =>
                !string.IsNullOrWhiteSpace(overrideReference.TargetMeshPath) &&
                !string.IsNullOrWhiteSpace(overrideReference.OverrideMeshPath))
            .GroupBy(
                overrideReference => ConvertPackagePathToMeshSourcePath(overrideReference.TargetMeshPath),
                StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => ConvertPackagePathToMeshSourcePath(group.Last().OverrideMeshPath),
                StringComparer.OrdinalIgnoreCase);
        if (overrideMeshSourcePathByTargetMeshSourcePath.Count == 0)
        {
            return null;
        }

        var baseMeshSourcePathByMeshId = baseExtraction.Meshes
            .Where(meshAsset => !string.IsNullOrWhiteSpace(meshAsset.Id) && !string.IsNullOrWhiteSpace(meshAsset.SourcePath))
            .ToDictionary(meshAsset => meshAsset.Id, meshAsset => meshAsset.SourcePath!, StringComparer.OrdinalIgnoreCase);
        var meshIdBySourcePath = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var variantChildren = attachNode.Children
            .Select(child => CloneStaticMeshOverrideSubtree(
                variantNodeIdPrefix,
                child,
                baseMeshSourcePathByMeshId,
                overrideMeshSourcePathByTargetMeshSourcePath,
                meshIdBySourcePath))
            .Where(clone => clone != null)
            .Cast<FoxWatchRenderSceneNode>()
            .ToList();
        if (variantChildren.Count == 0)
        {
            return null;
        }

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = [
                new FoxWatchRenderSceneNode
                {
                    Id = $"{variantNodeIdPrefix}:root",
                    Name = variantName,
                    Children = variantChildren,
                },
            ],
            Meshes = meshIdBySourcePath
                .OrderBy(entry => entry.Value, StringComparer.Ordinal)
                .Select(entry => new FoxWatchRenderSceneMeshAsset
                {
                    Id = entry.Value,
                    SourcePath = entry.Key,
                })
                .ToList(),
        };
    }

    private static FoxWatchRenderSceneNode? CloneStaticMeshOverrideSubtree(
        string variantNodeIdPrefix,
        FoxWatchRenderSceneNode sourceNode,
        IReadOnlyDictionary<string, string> baseMeshSourcePathByMeshId,
        IReadOnlyDictionary<string, string> overrideMeshSourcePathByTargetMeshSourcePath,
        IDictionary<string, string> meshIdBySourcePath)
    {
        var clonedChildren = sourceNode.Children
            .Select(child => CloneStaticMeshOverrideSubtree(
                variantNodeIdPrefix,
                child,
                baseMeshSourcePathByMeshId,
                overrideMeshSourcePathByTargetMeshSourcePath,
                meshIdBySourcePath))
            .Where(clone => clone != null)
            .Cast<FoxWatchRenderSceneNode>()
            .ToList();

        string? overrideMeshSourcePath = null;
        var hasMatchedMesh = !string.IsNullOrWhiteSpace(sourceNode.MeshId) &&
            baseMeshSourcePathByMeshId.TryGetValue(sourceNode.MeshId, out var sourceMeshPath) &&
            overrideMeshSourcePathByTargetMeshSourcePath.TryGetValue(sourceMeshPath, out overrideMeshSourcePath);
        if (!hasMatchedMesh && clonedChildren.Count == 0)
        {
            return null;
        }

        var clone = CloneRenderSceneNodeForVariant(variantNodeIdPrefix, sourceNode);
        clone.Children = clonedChildren;
        clone.MeshId = hasMatchedMesh && !string.IsNullOrWhiteSpace(overrideMeshSourcePath)
            ? GetOrAddMeshId(meshIdBySourcePath, overrideMeshSourcePath)
            : null;
        return clone;
    }

    private static FoxWatchRenderSceneNode CloneRenderSceneNodeForVariant(string variantNodeIdPrefix, FoxWatchRenderSceneNode sourceNode)
    {
        return new FoxWatchRenderSceneNode
        {
            Id = $"{variantNodeIdPrefix}:{sourceNode.Id.Replace(':', '-')}",
            Name = sourceNode.Name,
            Visible = sourceNode.Visible,
            VariantIds = sourceNode.VariantIds == null ? null : [.. sourceNode.VariantIds],
            MeshId = sourceNode.MeshId,
            Primitive = sourceNode.Primitive,
            MaterialIds = [.. sourceNode.MaterialIds],
            Location = sourceNode.Location == null ? null : [.. sourceNode.Location],
            RotationEulerDegrees = sourceNode.RotationEulerDegrees == null ? null : [.. sourceNode.RotationEulerDegrees],
            Scale = sourceNode.Scale == null ? null : [.. sourceNode.Scale],
            UnrealLocationCentimeters = sourceNode.UnrealLocationCentimeters == null ? null : [.. sourceNode.UnrealLocationCentimeters],
            UnrealSceneLocationCentimeters = sourceNode.UnrealSceneLocationCentimeters == null ? null : [.. sourceNode.UnrealSceneLocationCentimeters],
            UnrealRotationDegrees = sourceNode.UnrealRotationDegrees == null ? null : [.. sourceNode.UnrealRotationDegrees],
            DebugColor = sourceNode.DebugColor == null ? null : [.. sourceNode.DebugColor],
            MarkerColor = sourceNode.MarkerColor == null ? null : [.. sourceNode.MarkerColor],
            MarkerSize = sourceNode.MarkerSize,
            Pose = sourceNode.Pose,
            PoseVariants = sourceNode.PoseVariants,
            AttachBoneName = sourceNode.AttachBoneName,
            TransformMatrix = [.. sourceNode.TransformMatrix],
            Children = [],
        };
    }

    private async Task<FoxWatchBlueprintSceneExtraction?> TryExtractBlueprintByPackagePathAsync(
        string nodeIdPrefix,
        string rootNodeName,
        string blueprintPackagePath,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences;
        try
        {
            componentReferences = await _meshAssetExporter.InspectBlueprintComponentsAsync(blueprintPackagePath, cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Skipping overlay blueprint extraction for {BlueprintPackagePath}", blueprintPackagePath);
            return null;
        }

        if (componentReferences.Count == 0)
        {
            return null;
        }

        return BuildExtraction(nodeIdPrefix, rootNodeName, blueprintPackagePath, componentReferences);
    }

    private static void AppendSplineConnectorNodes(
        string nodeIdPrefix,
        FoxWatchRenderSceneNode parentNode,
        FoxWatchBlueprintComponentReference componentReference,
        IDictionary<string, string> meshIdBySourcePath)
    {
        if (componentReference.SplineConnectorMeshConfigs.Count == 0 ||
            componentReference.SplineDefaultTargetUnrealLocationCentimeters is not { Count: >= 3 } target)
        {
            return;
        }

        var targetVector = new Vector3((float)target[0], (float)target[1], (float)target[2]);
        var targetLength = targetVector.Length();
        if (targetLength <= 0.001f)
        {
            return;
        }

        var forward = Vector3.Normalize(targetVector);
        var referenceUp = Math.Abs(Vector3.Dot(forward, Vector3.UnitZ)) > 0.99f ? Vector3.UnitY : Vector3.UnitZ;
        var right = Vector3.Normalize(Vector3.Cross(referenceUp, forward));
        var up = Vector3.Normalize(Vector3.Cross(forward, right));
        var yawDegrees = Math.Atan2(forward.Y, forward.X) * 180.0 / Math.PI;
        var pitchDegrees = Math.Atan2(forward.Z, Math.Sqrt((forward.X * forward.X) + (forward.Y * forward.Y))) * 180.0 / Math.PI;

        var generatedIndex = 0;
        foreach (var config in componentReference.SplineConnectorMeshConfigs)
        {
            var mode = NormalizeSplineConnectorMeshMode(config.Mode);
            if (string.Equals(mode, "Spline", StringComparison.OrdinalIgnoreCase))
            {
                AppendSplineStretchNode(parentNode, nodeIdPrefix, componentReference.ComponentName, config, meshIdBySourcePath, forward, right, up, targetLength, yawDegrees, pitchDegrees, ref generatedIndex);
                continue;
            }

            if (string.Equals(mode, "Endpoints", StringComparison.OrdinalIgnoreCase))
            {
                AppendSplineEndpointNodes(parentNode, nodeIdPrefix, componentReference.ComponentName, config, meshIdBySourcePath, forward, right, up, targetLength, yawDegrees, pitchDegrees, ref generatedIndex);
                continue;
            }

            if (string.Equals(mode, "Interval", StringComparison.OrdinalIgnoreCase))
            {
                AppendSplineIntervalNodes(parentNode, nodeIdPrefix, componentReference.ComponentName, config, meshIdBySourcePath, forward, right, up, targetLength, yawDegrees, pitchDegrees, ref generatedIndex);
                continue;
            }

            if (string.Equals(mode, "Scale", StringComparison.OrdinalIgnoreCase))
            {
                AppendSplineScaleNode(parentNode, nodeIdPrefix, componentReference.ComponentName, config, meshIdBySourcePath, forward, right, up, targetLength, yawDegrees, pitchDegrees, ref generatedIndex);
            }
        }
    }

    private static string NormalizeSplineConnectorMeshMode(string? mode)
    {
        if (string.IsNullOrWhiteSpace(mode))
        {
            return string.Empty;
        }

        var normalized = mode.Trim();
        var separatorIndex = normalized.LastIndexOf("::", StringComparison.Ordinal);
        if (separatorIndex >= 0 && separatorIndex + 2 < normalized.Length)
        {
            normalized = normalized[(separatorIndex + 2)..];
        }

        return normalized;
    }

    private static void AppendSplineEndpointNodes(
        FoxWatchRenderSceneNode parentNode,
        string nodeIdPrefix,
        string componentName,
        FoxWatchSplineConnectorMeshConfigReference config,
        IDictionary<string, string> meshIdBySourcePath,
        Vector3 forward,
        Vector3 right,
        Vector3 up,
        float targetLength,
        double yawDegrees,
        double pitchDegrees,
        ref int generatedIndex)
    {
        var meshPath = config.MeshPaths.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(meshPath))
        {
            return;
        }

        AppendSplineMeshNode(parentNode, nodeIdPrefix, componentName, meshPath, 0f, config, meshIdBySourcePath, forward, right, up, yawDegrees, pitchDegrees, ref generatedIndex);
        AppendSplineMeshNode(parentNode, nodeIdPrefix, componentName, meshPath, targetLength, config, meshIdBySourcePath, forward, right, up, yawDegrees, pitchDegrees, ref generatedIndex);
    }

    private static void AppendSplineIntervalNodes(
        FoxWatchRenderSceneNode parentNode,
        string nodeIdPrefix,
        string componentName,
        FoxWatchSplineConnectorMeshConfigReference config,
        IDictionary<string, string> meshIdBySourcePath,
        Vector3 forward,
        Vector3 right,
        Vector3 up,
        float targetLength,
        double yawDegrees,
        double pitchDegrees,
        ref int generatedIndex)
    {
        if (config.MeshPaths.Count == 0)
        {
            return;
        }

        var interval = config.Interval > 0.01 ? (float)config.Interval : targetLength;
        var startDistance = (float)Math.Max(0, config.StartOffset);
        var endDistance = Math.Max(startDistance, targetLength - (float)Math.Max(0, config.EndOffset));
        var meshIndex = 0;
        for (var distance = startDistance; distance <= endDistance + 0.001f; distance += interval)
        {
            AppendSplineMeshNode(parentNode, nodeIdPrefix, componentName, config.MeshPaths[meshIndex % config.MeshPaths.Count], distance, config, meshIdBySourcePath, forward, right, up, yawDegrees, pitchDegrees, ref generatedIndex);
            meshIndex += 1;
        }
    }

    private static void AppendSplineScaleNode(
        FoxWatchRenderSceneNode parentNode,
        string nodeIdPrefix,
        string componentName,
        FoxWatchSplineConnectorMeshConfigReference config,
        IDictionary<string, string> meshIdBySourcePath,
        Vector3 forward,
        Vector3 right,
        Vector3 up,
        float targetLength,
        double yawDegrees,
        double pitchDegrees,
        ref int generatedIndex)
    {
        var meshPath = config.MeshPaths.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(meshPath))
        {
            return;
        }

        AppendSplineMeshNode(parentNode, nodeIdPrefix, componentName, meshPath, targetLength * 0.5f, config, meshIdBySourcePath, forward, right, up, yawDegrees, pitchDegrees, ref generatedIndex);
    }

    private static void AppendSplineStretchNode(
        FoxWatchRenderSceneNode parentNode,
        string nodeIdPrefix,
        string componentName,
        FoxWatchSplineConnectorMeshConfigReference config,
        IDictionary<string, string> meshIdBySourcePath,
        Vector3 forward,
        Vector3 right,
        Vector3 up,
        float targetLength,
        double yawDegrees,
        double pitchDegrees,
        ref int generatedIndex)
    {
        var meshPath = config.MeshPaths.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(meshPath))
        {
            return;
        }

        var distanceAlongSpline = UsesCenteredSplineStretchPlacement(meshPath)
            ? targetLength * 0.5f
            : 0f;

        AppendSplineMeshNode(
            parentNode,
            nodeIdPrefix,
            componentName,
            meshPath,
            distanceAlongSpline,
            config,
            meshIdBySourcePath,
            forward,
            right,
            up,
            yawDegrees,
            pitchDegrees,
            ref generatedIndex,
            UsesSplineStretchScale(meshPath)
                ? BuildSplineStretchScale(config, targetLength)
                : null);
    }

    private static bool UsesCenteredSplineStretchPlacement(string meshPath)
    {
        var meshName = Path.GetFileNameWithoutExtension(meshPath);
        return meshName.StartsWith("TrenchBarbedWireT", StringComparison.OrdinalIgnoreCase);
    }

    private static bool UsesSplineStretchScale(string meshPath)
    {
        var meshName = Path.GetFileNameWithoutExtension(meshPath);
        return !meshName.StartsWith("TrenchBarbedWireT", StringComparison.OrdinalIgnoreCase);
    }

    private static bool UsesUnitSplineMeshScale(string meshPath)
    {
        var meshName = Path.GetFileNameWithoutExtension(meshPath);
        return string.Equals(meshName, "TrenchBarbedWireT1", StringComparison.OrdinalIgnoreCase)
            || string.Equals(meshName, "TrenchBarbedWireT2", StringComparison.OrdinalIgnoreCase);
    }

    private static void AppendSplineMeshNode(
        FoxWatchRenderSceneNode parentNode,
        string nodeIdPrefix,
        string componentName,
        string meshPath,
        float distanceAlongSpline,
        FoxWatchSplineConnectorMeshConfigReference config,
        IDictionary<string, string> meshIdBySourcePath,
        Vector3 forward,
        Vector3 right,
        Vector3 up,
        double yawDegrees,
        double pitchDegrees,
        ref int generatedIndex,
        IReadOnlyList<double>? scaleOverride = null)
    {
        var meshFileName = Path.GetFileNameWithoutExtension(meshPath);
        if (ShouldSkipTrenchBuildSiteDirt(nodeIdPrefix, componentName, attachParentName: null, meshFileName))
        {
            return;
        }

        var meshSourcePath = ConvertPackagePathToMeshSourcePath(meshPath);
        var localOffset = config.RelativeLocation is { Count: >= 3 }
            ? new Vector3((float)config.RelativeLocation[0], (float)config.RelativeLocation[1], (float)config.RelativeLocation[2])
            : Vector3.Zero;
        var offset = (forward * localOffset.X) + (right * localOffset.Y) + (up * localOffset.Z);
        var position = (forward * distanceAlongSpline) + offset;

        parentNode.Children.Add(new FoxWatchRenderSceneNode
        {
            Id = $"{nodeIdPrefix}:{NormalizeReferenceName(componentName)}:spline-mesh-{generatedIndex}",
            Name = meshFileName,
            MeshId = GetOrAddMeshId(meshIdBySourcePath, meshSourcePath),
            UnrealLocationCentimeters = [position.X, position.Y, position.Z],
            UnrealRotationDegrees = [pitchDegrees, yawDegrees, 0.0],
            Scale = scaleOverride == null
                ? UsesUnitSplineMeshScale(meshPath)
                    ? [1.0d, 1.0d, 1.0d]
                    : config.RelativeScale == null ? null : [.. config.RelativeScale]
                : [.. scaleOverride],
        });

        generatedIndex += 1;
    }

    private static IReadOnlyList<double>? BuildSplineStretchScale(
        FoxWatchSplineConnectorMeshConfigReference config,
        float targetLength)
    {
        var baseScale = config.RelativeScale is { Count: >= 3 }
            ? new[] { config.RelativeScale[0], config.RelativeScale[1], config.RelativeScale[2] }
            : new[] { 1.0d, 1.0d, 1.0d };

        if (config.NativeMeshLengthCentimeters is not > 0.001d || targetLength <= 0.001f)
        {
            return config.RelativeScale == null ? null : baseScale;
        }

        var lengthScale = targetLength / config.NativeMeshLengthCentimeters.Value;
        var axis = NormalizeSplineMeshAxis(config.SplineMeshAxis);
        switch (axis)
        {
            case 'Y':
                baseScale[1] *= lengthScale;
                break;
            case 'Z':
                baseScale[2] *= lengthScale;
                break;
            default:
                baseScale[0] *= lengthScale;
                break;
        }

        return baseScale;
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

    private static FoxWatchRenderSceneNode? FindNodeByName(IEnumerable<FoxWatchRenderSceneNode> roots, string name)
    {
        foreach (var root in roots)
        {
            if (string.Equals(root.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                return root;
            }

            var descendant = FindNodeByName(root.Children, name);
            if (descendant != null)
            {
                return descendant;
            }
        }

        return null;
    }

    private static void PopulateFallbackSplineConnectorMeshPaths(
        string blueprintPackagePath,
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        if (!blueprintPackagePath.Contains("CraneRail", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        foreach (var componentReference in componentReferences.Where(reference =>
                     string.Equals(reference.ComponentName, "SplineConnector", StringComparison.OrdinalIgnoreCase)))
        {
            if (componentReference.SplineConnectorMeshConfigs.Count == 0)
            {
                componentReference.SplineConnectorMeshConfigs.Add(new FoxWatchSplineConnectorMeshConfigReference
                {
                    Mode = "Endpoints",
                    MeshPaths = [CraneRailTrackMeshPackagePath],
                    NativeMeshLengthCentimeters = 1000d,
                });
                continue;
            }

            foreach (var config in componentReference.SplineConnectorMeshConfigs)
            {
                if (config.MeshPaths.Count > 0)
                {
                    continue;
                }

                config.MeshPaths.Add(CraneRailTrackMeshPackagePath);
                if (config.NativeMeshLengthCentimeters is not > 0.001d)
                {
                    config.NativeMeshLengthCentimeters = 1000d;
                }
            }
        }
    }

    private static void PopulateFallbackSplineConnectorTargets(IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var frontSocket = FindConnectorEndpointReference(componentReferences, "FrontSocket");
        var backSocket = FindConnectorEndpointReference(componentReferences, "BackSocket");

        var frontLocation = frontSocket != null && TryParseVector(frontSocket.RelativeLocation, out var parsedFrontLocation)
            ? parsedFrontLocation
            : [0.0, 0.0, 0.0];
        var backLocation = backSocket != null && TryParseVector(backSocket.RelativeLocation, out var parsedBackLocation)
            ? parsedBackLocation
            : [0.0, 0.0, 0.0];

        var fallbackTarget = new List<double>
        {
            frontLocation[0] - backLocation[0],
            frontLocation[1] - backLocation[1],
            frontLocation[2] - backLocation[2],
        };

        var magnitudeSquared = (fallbackTarget[0] * fallbackTarget[0]) +
            (fallbackTarget[1] * fallbackTarget[1]) +
            (fallbackTarget[2] * fallbackTarget[2]);
        if (magnitudeSquared <= 0.001d)
        {
            var wallTarget = componentReferences.FirstOrDefault(reference =>
                string.Equals(reference.ComponentName, "WallTarget", StringComparison.OrdinalIgnoreCase));
            if (wallTarget != null && TryParseVector(wallTarget.RelativeLocation, out var wallTargetLocation))
            {
                fallbackTarget =
                [
                    wallTargetLocation[0] - backLocation[0],
                    wallTargetLocation[1] - backLocation[1],
                    wallTargetLocation[2] - backLocation[2],
                ];
                magnitudeSquared = (fallbackTarget[0] * fallbackTarget[0]) +
                    (fallbackTarget[1] * fallbackTarget[1]) +
                    (fallbackTarget[2] * fallbackTarget[2]);
            }
        }

        if (magnitudeSquared <= 0.001d)
        {
            var fallbackLength = componentReferences
                .SelectMany(reference => reference.SplineConnectorMeshConfigs)
                .Select(config => config.NativeMeshLengthCentimeters ?? 0d)
                .Where(length => length > 0.001d)
                .DefaultIfEmpty(0d)
                .Max();
            if (fallbackLength <= 0.001d)
            {
                return;
            }

            fallbackTarget =
            [
                fallbackLength,
                0.0,
                0.0,
            ];
        }

        foreach (var componentReference in componentReferences.Where(reference => reference.SplineConnectorMeshConfigs.Count > 0))
        {
            if (componentReference.SplineDefaultTargetUnrealLocationCentimeters is not { Count: >= 3 } existingTarget)
            {
                componentReference.SplineDefaultTargetUnrealLocationCentimeters = [.. fallbackTarget];
                continue;
            }

            var existingMagnitudeSquared = (existingTarget[0] * existingTarget[0]) +
                (existingTarget[1] * existingTarget[1]) +
                (existingTarget[2] * existingTarget[2]);
            if (existingMagnitudeSquared <= 0.001d)
            {
                componentReference.SplineDefaultTargetUnrealLocationCentimeters = [.. fallbackTarget];
            }
        }
    }

    private static FoxWatchBlueprintComponentReference? FindConnectorEndpointReference(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        string socketSuffix)
    {
        return componentReferences.FirstOrDefault(reference =>
            string.Equals(reference.ComponentName, socketSuffix, StringComparison.OrdinalIgnoreCase)
            || reference.ComponentName.EndsWith($":{socketSuffix}", StringComparison.OrdinalIgnoreCase));
    }

    private static FoxWatchRenderSceneNode? FindModificationSlotAttachNode(
        IEnumerable<FoxWatchRenderSceneNode> roots,
        string? componentName)
    {
        var normalizedComponentName = NormalizeReferenceName(componentName);
        if (string.IsNullOrWhiteSpace(normalizedComponentName))
        {
            return null;
        }

        var exactMatch = FindNodeByName(roots, normalizedComponentName);
        if (exactMatch != null)
        {
            return exactMatch;
        }

        var componentSuffix = $":{normalizedComponentName}";
        return FindFirstMatchingNode(roots, node =>
            string.Equals(node.Name, normalizedComponentName, StringComparison.OrdinalIgnoreCase) ||
            node.Name.EndsWith(componentSuffix, StringComparison.OrdinalIgnoreCase));
    }

    private static FoxWatchRenderSceneNode? FindFirstMatchingNode(
        IEnumerable<FoxWatchRenderSceneNode> roots,
        Func<FoxWatchRenderSceneNode, bool> predicate)
    {
        foreach (var root in roots)
        {
            if (predicate(root))
            {
                return root;
            }

            var descendant = FindFirstMatchingNode(root.Children, predicate);
            if (descendant != null)
            {
                return descendant;
            }
        }

        return null;
    }

    private static FoxWatchRenderSceneNode CloneNode(FoxWatchRenderSceneNode node)
    {
        return new FoxWatchRenderSceneNode
        {
            Id = node.Id,
            Name = node.Name,
            Visible = node.Visible,
            VariantIds = node.VariantIds == null ? null : [.. node.VariantIds],
            MeshId = node.MeshId,
            Primitive = node.Primitive == null
                ? null
                : new FoxWatchRenderScenePrimitive
                {
                    Type = node.Primitive.Type,
                    Points = node.Primitive.Points == null ? null : [.. node.Primitive.Points.Select(point => point.ToList())],
                    Color = node.Primitive.Color == null ? null : [.. node.Primitive.Color],
                    Radius = node.Primitive.Radius,
                    Width = node.Primitive.Width,
                    Height = node.Primitive.Height,
                },
            MaterialIds = [.. node.MaterialIds],
            Location = node.Location == null ? null : [.. node.Location],
            RotationEulerDegrees = node.RotationEulerDegrees == null ? null : [.. node.RotationEulerDegrees],
            Scale = node.Scale == null ? null : [.. node.Scale],
            UnrealLocationCentimeters = node.UnrealLocationCentimeters == null ? null : [.. node.UnrealLocationCentimeters],
            UnrealSceneLocationCentimeters = node.UnrealSceneLocationCentimeters == null ? null : [.. node.UnrealSceneLocationCentimeters],
            UnrealRotationDegrees = node.UnrealRotationDegrees == null ? null : [.. node.UnrealRotationDegrees],
            DebugColor = node.DebugColor == null ? null : [.. node.DebugColor],
            MarkerColor = node.MarkerColor == null ? null : [.. node.MarkerColor],
            MarkerSize = node.MarkerSize,
            Pose = node.Pose == null
                ? null
                : new FoxWatchRenderScenePose
                {
                    Type = node.Pose.Type,
                    Profile = node.Pose.Profile,
                    Parameters = node.Pose.Parameters == null ? null : new Dictionary<string, double>(node.Pose.Parameters, StringComparer.OrdinalIgnoreCase),
                    Bones = node.Pose.Bones == null
                        ? null
                        : [.. node.Pose.Bones.Select(bone => new FoxWatchRenderSceneBonePose
                        {
                            Name = bone.Name,
                            ParentIndex = bone.ParentIndex,
                            Location = bone.Location == null ? null : [.. bone.Location],
                            RotationQuaternion = bone.RotationQuaternion == null ? null : [.. bone.RotationQuaternion],
                            Scale = bone.Scale == null ? null : [.. bone.Scale],
                        })],
                },
            PoseVariants = node.PoseVariants == null
                ? null
                : node.PoseVariants.ToDictionary(
                    pair => pair.Key,
                    pair => new FoxWatchRenderScenePose
                    {
                        Type = pair.Value.Type,
                        Profile = pair.Value.Profile,
                        Parameters = pair.Value.Parameters == null ? null : new Dictionary<string, double>(pair.Value.Parameters, StringComparer.OrdinalIgnoreCase),
                        Bones = pair.Value.Bones == null
                            ? null
                            : [.. pair.Value.Bones.Select(bone => new FoxWatchRenderSceneBonePose
                            {
                                Name = bone.Name,
                                ParentIndex = bone.ParentIndex,
                                Location = bone.Location == null ? null : [.. bone.Location],
                                RotationQuaternion = bone.RotationQuaternion == null ? null : [.. bone.RotationQuaternion],
                                Scale = bone.Scale == null ? null : [.. bone.Scale],
                            })],
                    },
                    StringComparer.OrdinalIgnoreCase),
            AttachBoneName = node.AttachBoneName,
            TransformMatrix = [.. node.TransformMatrix],
            Children = [.. node.Children.Select(CloneNode)],
        };
    }

    private static FoxWatchRenderSceneMeshAsset CloneMeshAsset(FoxWatchRenderSceneMeshAsset asset)
    {
        return new FoxWatchRenderSceneMeshAsset
        {
            Id = asset.Id,
            SourcePath = asset.SourcePath,
            ExportUrl = asset.ExportUrl,
            DefaultPoseAnimationPackagePath = asset.DefaultPoseAnimationPackagePath,
            PoseAnimationPackagePaths = asset.PoseAnimationPackagePaths == null ? null : [.. asset.PoseAnimationPackagePaths],
            MaterialSidecarNameOverride = asset.MaterialSidecarNameOverride,
        };
    }

    private static void MergeMeshAssets(FoxWatchBlueprintSceneExtraction target, FoxWatchBlueprintSceneExtraction source)
    {
        var meshAssetsById = target.Meshes.ToDictionary(asset => asset.Id, StringComparer.OrdinalIgnoreCase);
        var meshIdBySourcePath = target.Meshes
            .Where(asset => !string.IsNullOrWhiteSpace(asset.SourcePath))
            .ToDictionary(asset => asset.SourcePath!, asset => asset.Id, StringComparer.OrdinalIgnoreCase);
        var meshIdRemap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var meshAsset in source.Meshes)
        {
            if (!string.IsNullOrWhiteSpace(meshAsset.SourcePath) &&
                meshIdBySourcePath.TryGetValue(meshAsset.SourcePath, out var existingMeshId))
            {
                if (meshAssetsById.TryGetValue(existingMeshId, out var existingMeshAsset))
                {
                    MergeMeshAssetPoseMetadata(existingMeshAsset, meshAsset);
                }

                meshIdRemap[meshAsset.Id] = existingMeshId;
                continue;
            }

            var targetMeshId = meshAsset.Id;
            if (meshAssetsById.TryGetValue(targetMeshId, out var existingTargetMeshAsset) &&
                !string.Equals(existingTargetMeshAsset.SourcePath, meshAsset.SourcePath, StringComparison.OrdinalIgnoreCase))
            {
                targetMeshId = GetUniqueMeshId(meshAssetsById, meshAsset.Id);
            }

            meshIdRemap[meshAsset.Id] = targetMeshId;
            if (!meshAssetsById.ContainsKey(targetMeshId))
            {
                var mergedMeshAsset = new FoxWatchRenderSceneMeshAsset
                {
                    Id = targetMeshId,
                    SourcePath = meshAsset.SourcePath,
                    ExportUrl = meshAsset.ExportUrl,
                    DefaultPoseAnimationPackagePath = meshAsset.DefaultPoseAnimationPackagePath,
                    PoseAnimationPackagePaths = meshAsset.PoseAnimationPackagePaths == null
                        ? null
                        : [.. meshAsset.PoseAnimationPackagePaths],
                };
                target.Meshes.Add(mergedMeshAsset);
                meshAssetsById[targetMeshId] = mergedMeshAsset;
                if (!string.IsNullOrWhiteSpace(mergedMeshAsset.SourcePath))
                {
                    meshIdBySourcePath[mergedMeshAsset.SourcePath] = targetMeshId;
                }
            }
        }

        RebindMeshIds(source.Roots, meshIdRemap);
    }

    private static void MergeMeshAssetPoseMetadata(FoxWatchRenderSceneMeshAsset target, FoxWatchRenderSceneMeshAsset source)
    {
        if (string.IsNullOrWhiteSpace(target.DefaultPoseAnimationPackagePath))
        {
            target.DefaultPoseAnimationPackagePath = source.DefaultPoseAnimationPackagePath;
        }

        if (source.PoseAnimationPackagePaths is not { Count: > 0 })
        {
            return;
        }

        target.PoseAnimationPackagePaths ??= [];
        foreach (var packagePath in source.PoseAnimationPackagePaths)
        {
            if (!target.PoseAnimationPackagePaths.Contains(packagePath, StringComparer.OrdinalIgnoreCase))
            {
                target.PoseAnimationPackagePaths.Add(packagePath);
            }
        }

        target.PoseAnimationPackagePaths.Sort(StringComparer.OrdinalIgnoreCase);
    }

    private static void RebindMeshIds(IEnumerable<FoxWatchRenderSceneNode> roots, IReadOnlyDictionary<string, string> meshIdRemap)
    {
        foreach (var root in roots)
        {
            if (!string.IsNullOrWhiteSpace(root.MeshId) && meshIdRemap.TryGetValue(root.MeshId, out var remappedMeshId))
            {
                root.MeshId = remappedMeshId;
            }

            RebindMeshIds(root.Children, meshIdRemap);
        }
    }

    private static string GetUniqueMeshId(IReadOnlyDictionary<string, FoxWatchRenderSceneMeshAsset> meshAssetsById, string baseMeshId)
    {
        var suffix = 2;
        var uniqueMeshId = $"{baseMeshId}-{suffix}";
        while (meshAssetsById.ContainsKey(uniqueMeshId))
        {
            suffix += 1;
            uniqueMeshId = $"{baseMeshId}-{suffix}";
        }

        return uniqueMeshId;
    }

    private static string? ResolveAttachParentName(
        FoxWatchBlueprintComponentReference componentReference,
        IReadOnlyDictionary<string, FoxWatchRenderSceneNode> nodesByComponentName)
    {
        var explicitParentName = NormalizeReferenceName(componentReference.AttachParentName);
        var resolvedExplicitParentName = ResolveKnownParentAlias(explicitParentName, nodesByComponentName.Keys);
        if (!string.IsNullOrWhiteSpace(resolvedExplicitParentName))
        {
            return resolvedExplicitParentName;
        }

        var implicitParentName = InferImplicitParentName(componentReference.ComponentName);
        return !string.IsNullOrWhiteSpace(implicitParentName) && nodesByComponentName.ContainsKey(implicitParentName)
            ? implicitParentName
            : null;
    }

    private static bool IsTrackedRunningGearMesh(string? meshPath)
    {
        var fileName = Path.GetFileNameWithoutExtension(meshPath ?? string.Empty);
        if (string.IsNullOrWhiteSpace(fileName))
        {
            return false;
        }

        return fileName
            .Split(['_', '-', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(token => token.Equals("track", StringComparison.OrdinalIgnoreCase)
                || token.Equals("tracks", StringComparison.OrdinalIgnoreCase)
                || token.Equals("tread", StringComparison.OrdinalIgnoreCase)
                || token.Equals("treads", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsPrimaryTrackedVehicleBodyMesh(FoxWatchBlueprintComponentReference componentReference)
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

    private static bool IsTankLikeVehicleMesh(string? meshPath)
    {
        var fileName = Path.GetFileNameWithoutExtension(meshPath ?? string.Empty);
        return fileName.Contains("tank", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ShouldResetTrackedRunningGearTransform(FoxWatchBlueprintComponentReference componentReference)
    {
        var fileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath ?? string.Empty);
        return fileName.Equals("SK_BattleTankATC_tracks", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ShouldSkipAutomaticPoseDiscovery(FoxWatchBlueprintComponentReference componentReference)
    {
        var fileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath ?? string.Empty);
        return fileName.Equals("SK_BattleTankATC", StringComparison.OrdinalIgnoreCase)
            || fileName.Equals("SK_BattleTankATC_tracks", StringComparison.OrdinalIgnoreCase);
    }

    private static string ResolveTrackedRunningGearParentName(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        FoxWatchBlueprintComponentReference characterMesh)
    {
        var existingParentName = NormalizeReferenceName(characterMesh.AttachParentName);
        if (!string.IsNullOrWhiteSpace(existingParentName))
        {
            return existingParentName;
        }

        return componentReferences.Any(reference => string.Equals(reference.ComponentName, "CollisionCylinder", StringComparison.OrdinalIgnoreCase))
            ? "CollisionCylinder"
            : string.Empty;
    }

    private static string? NormalizeReferenceName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            string.Equals(value, "None", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return value;
    }

    private static string? InferImplicitParentName(string componentName)
    {
        if (string.IsNullOrWhiteSpace(componentName))
        {
            return null;
        }

        if (string.Equals(componentName, "CabinMesh", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(componentName, "TrailerMesh", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(componentName, "Chassis", StringComparison.OrdinalIgnoreCase))
        {
            return "CharacterMesh0";
        }

        if (componentName.StartsWith("InputMesh", StringComparison.OrdinalIgnoreCase) ||
            componentName.StartsWith("PipeInputMesh", StringComparison.OrdinalIgnoreCase) ||
            componentName.StartsWith("InputDecal", StringComparison.OrdinalIgnoreCase))
        {
            var suffix = componentName.StartsWith("PipeInputMesh", StringComparison.OrdinalIgnoreCase)
                ? componentName["PipeInputMesh".Length..]
                : componentName.StartsWith("InputMesh", StringComparison.OrdinalIgnoreCase)
                    ? componentName["InputMesh".Length..]
                    : componentName["InputDecal".Length..];
            return $"PipeInput{suffix}";
        }

        if (componentName.StartsWith("OutputMesh", StringComparison.OrdinalIgnoreCase) ||
            componentName.StartsWith("PipeOutputMesh", StringComparison.OrdinalIgnoreCase) ||
            componentName.StartsWith("OutputDecal", StringComparison.OrdinalIgnoreCase))
        {
            var suffix = componentName.StartsWith("PipeOutputMesh", StringComparison.OrdinalIgnoreCase)
                ? componentName["PipeOutputMesh".Length..]
                : componentName.StartsWith("OutputMesh", StringComparison.OrdinalIgnoreCase)
                    ? componentName["OutputMesh".Length..]
                    : componentName["OutputDecal".Length..];
            return $"PipeOutput{suffix}";
        }

        return null;
    }

    private static HashSet<string> BuildHiddenSubtreeComponentNames(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var hiddenSubtreeComponentNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var componentNames = componentReferences
            .Select(reference => reference.ComponentName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var componentReference in componentReferences)
        {
            if (IsHiddenFromSceneGraph(componentReference))
            {
                hiddenSubtreeComponentNames.Add(componentReference.ComponentName);
            }
        }

        var changed = true;
        while (changed)
        {
            changed = false;

            foreach (var componentReference in componentReferences)
            {
                if (hiddenSubtreeComponentNames.Contains(componentReference.ComponentName))
                {
                    continue;
                }

                var parentName = ResolveSceneGraphParentName(componentReference, componentNames);
                if (!string.IsNullOrWhiteSpace(parentName) &&
                    !ShouldIncludeHiddenAircraftRoofComponent(componentReference) &&
                    !ShouldIncludeHiddenTrenchOpenWallComponent(componentReference) &&
                    hiddenSubtreeComponentNames.Contains(parentName))
                {
                    hiddenSubtreeComponentNames.Add(componentReference.ComponentName);
                    changed = true;
                }
            }
        }

        return hiddenSubtreeComponentNames;
    }

    private static string? ResolveSceneGraphParentName(
        FoxWatchBlueprintComponentReference componentReference,
        IReadOnlySet<string> componentNames)
    {
        var explicitParentName = NormalizeReferenceName(componentReference.AttachParentName);
        var resolvedExplicitParentName = ResolveKnownParentAlias(explicitParentName, componentNames);
        if (!string.IsNullOrWhiteSpace(resolvedExplicitParentName))
        {
            return resolvedExplicitParentName;
        }

        var implicitParentName = InferImplicitParentName(componentReference.ComponentName);
        if (!string.IsNullOrWhiteSpace(implicitParentName) &&
            componentNames.Contains(implicitParentName))
        {
            return implicitParentName;
        }

        return null;
    }

    private static string? ResolveKnownParentAlias(string? parentName, IEnumerable<string> availableComponentNames)
    {
        var normalizedParentName = NormalizeReferenceName(parentName);
        if (string.IsNullOrWhiteSpace(normalizedParentName))
        {
            return null;
        }

        var availableNames = availableComponentNames as IReadOnlySet<string>
            ?? availableComponentNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (availableNames.Contains(normalizedParentName))
        {
            return normalizedParentName;
        }

        if (normalizedParentName.EndsWith("_GEN_VARIABLE", StringComparison.OrdinalIgnoreCase))
        {
            var trimmedParentName = normalizedParentName[..^"_GEN_VARIABLE".Length];
            if (availableNames.Contains(trimmedParentName))
            {
                return trimmedParentName;
            }
        }

        var generatedParentName = $"{normalizedParentName}_GEN_VARIABLE";
        if (availableNames.Contains(generatedParentName))
        {
            return generatedParentName;
        }

        if (string.Equals(normalizedParentName, "Collision", StringComparison.OrdinalIgnoreCase) &&
            availableNames.Contains("CollisionCylinder"))
        {
            return "CollisionCylinder";
        }

        return null;
    }

    private static bool IsHiddenFromSceneGraph(FoxWatchBlueprintComponentReference componentReference)
    {
        return (!componentReference.IsVisible || componentReference.IsHiddenInGame)
            && !ShouldIncludeHiddenAircraftRoofComponent(componentReference)
            && !ShouldIncludeHiddenTrenchOpenWallComponent(componentReference);
    }

    private static bool HasExplicitLocalTransform(FoxWatchBlueprintComponentReference componentReference)
    {
        return HasMeaningfulTranslation(componentReference.RelativeLocation)
            || HasMeaningfulRotation(componentReference.RelativeRotation)
            || HasNonIdentityScale(componentReference.RelativeScale);
    }

    private static bool HasMeaningfulTranslation(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return TryParseVector(value, out var parsedVector) &&
            parsedVector.Any(component => Math.Abs(component) > 0.001);
    }

    private static bool HasMeaningfulRotation(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return TryParseRotator(value, out var parsedRotator) &&
            parsedRotator.Any(component => Math.Abs(component) > 0.001);
    }

    private static bool TryNormalizeQuarterTurnYawDegrees(double yawDegrees, out double normalizedYawDegrees)
    {
        normalizedYawDegrees = 0;

        var wrappedYawDegrees = yawDegrees % 360.0;
        if (wrappedYawDegrees < 0)
        {
            wrappedYawDegrees += 360.0;
        }

        foreach (var candidateYawDegrees in new[] { 90.0, FoxWatchVehicleBodyFrameResolver.QuarterTurnYawDegrees })
        {
            if (Math.Abs(wrappedYawDegrees - candidateYawDegrees) <= 5.0)
            {
                normalizedYawDegrees = candidateYawDegrees;
                return true;
            }
        }

        return false;
    }

    private static bool HasNonIdentityScale(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return TryParseVector(value, out var parsedScale) &&
            (Math.Abs(parsedScale[0] - 1.0) > 0.001 ||
             Math.Abs(parsedScale[1] - 1.0) > 0.001 ||
             Math.Abs(parsedScale[2] - 1.0) > 0.001);
    }

    private static bool ShouldSkipComponentInDefaultScene(
        string nodeIdPrefix,
        FoxWatchBlueprintComponentReference componentReference,
        bool allowDestroyedComponents)
    {
        if (IsHiddenFromSceneGraph(componentReference))
        {
            return true;
        }

        if (componentReference.ComponentType.Contains("FoliageCullStaticMeshComponent", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!allowDestroyedComponents &&
            componentReference.ComponentName.Contains("destroyed", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (componentReference.ComponentName.Contains("spotlightcone", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (componentReference.ComponentName.Contains("shipcollision", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (componentReference.ComponentName.Contains("stencil", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (componentReference.ComponentName.Contains("anchordropped", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (ShouldSkipDefaultSceneHelperMesh(nodeIdPrefix, componentReference))
        {
            return true;
        }

        return (!allowDestroyedComponents && componentReference.MeshPath.Contains("destroyed", StringComparison.OrdinalIgnoreCase))
            || componentReference.MeshPath.Contains("spotlightcone", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ShouldSkipDefaultSceneHelperMesh(string nodeIdPrefix, FoxWatchBlueprintComponentReference componentReference)
    {
        var meshPath = componentReference.MeshPath;
        if (string.IsNullOrWhiteSpace(meshPath))
        {
            return false;
        }

        var meshFileName = Path.GetFileNameWithoutExtension(meshPath);
        if (meshPath.Contains("/Blueprints/Culling/", StringComparison.OrdinalIgnoreCase) ||
            meshFileName.Contains("cullplane", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        // FoxWatch baseline entrenchment renders hide select FortTrenches dirt fill so wall sockets stay readable.
        // Keep this check explicit and local so it is easy to remove later if we want the mud back in previews/icons.
        if (meshFileName.Equals("fortt1dirt01", StringComparison.OrdinalIgnoreCase) ||
            meshFileName.Equals("trencht1cornerdirt01", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if ((nodeIdPrefix.Contains("fortcornert1", StringComparison.OrdinalIgnoreCase)
                || nodeIdPrefix.Contains("fortcornerbuildsite", StringComparison.OrdinalIgnoreCase))
            && meshFileName.Equals("fortt1cornerdirtangle01", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (ShouldSkipTrenchBuildSiteDirt(nodeIdPrefix, componentReference, meshFileName))
        {
            return true;
        }

        if (nodeIdPrefix.Contains("aircraftparatrooper", StringComparison.OrdinalIgnoreCase) &&
            meshFileName.Equals("lightfreightercrates", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (nodeIdPrefix.Contains("facilityvehiclefactory3", StringComparison.OrdinalIgnoreCase) &&
            meshFileName.Equals("sm_waterplane", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (meshPath.Contains("Engine/Content/BasicShapes/", StringComparison.OrdinalIgnoreCase) &&
            meshFileName.Equals("sphere", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return meshFileName.Contains("shipcollision", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("aircollision", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("physiccollision", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("prototypecollision", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("collisionvolume", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("collisiontest", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("watervolume", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("antiswimvolume", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Equals("unitcirclecullplane", StringComparison.OrdinalIgnoreCase)
            || meshFileName.StartsWith("largeshipengine", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Equals("depthchargeammo", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Equals("factorylight", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Equals("facilityindicatorlight", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Equals("subplane", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ShouldSkipTrenchBuildSiteDirt(
        string nodeIdPrefix,
        FoxWatchBlueprintComponentReference componentReference,
        string meshFileName)
    {
        return ShouldSkipTrenchBuildSiteDirt(
            nodeIdPrefix,
            componentReference.ComponentName,
            componentReference.AttachParentName,
            meshFileName);
    }

    private static bool ShouldSkipTrenchBuildSiteDirt(
        string nodeIdPrefix,
        string? componentName,
        string? attachParentName,
        string meshFileName)
    {
        if (!nodeIdPrefix.Contains("buildsite", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!nodeIdPrefix.Contains("trench", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!(componentName?.Contains("dirt", StringComparison.OrdinalIgnoreCase) ?? false) &&
            !(attachParentName?.Contains("dirt", StringComparison.OrdinalIgnoreCase) ?? false))
        {
            return false;
        }

        if (!meshFileName.Contains("dirt", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return meshFileName.Contains("trench", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("fort", StringComparison.OrdinalIgnoreCase);
    }

    private static void NormalizeDetachedFortRoofShellHierarchy(IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var roofAnchor = componentReferences.FirstOrDefault(reference =>
            string.Equals(reference.ComponentName, "Roof", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(NormalizeReferenceName(reference.AttachParentName), StructureArrowComponentName, StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(reference.MeshPath));
        if (roofAnchor == null)
        {
            return;
        }

        foreach (var componentReference in componentReferences)
        {
            if (!string.IsNullOrWhiteSpace(NormalizeReferenceName(componentReference.AttachParentName)) ||
                string.IsNullOrWhiteSpace(componentReference.MeshPath) ||
                !componentReference.ComponentType.Contains("MeshComponent", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var meshFileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath);
            if (!meshFileName.Contains("roof", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(componentReference.ComponentName, "Roof", StringComparison.OrdinalIgnoreCase) ||
                HasMeaningfulTranslation(componentReference.RelativeLocation) ||
                HasMeaningfulRotation(componentReference.RelativeRotation) ||
                HasNonIdentityScale(componentReference.RelativeScale) ||
                !componentReference.MeshPath.Contains("/Structures/FortTrenches/", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            componentReference.AttachParentName = roofAnchor.AttachParentName;
            componentReference.RelativeLocation = roofAnchor.RelativeLocation;
            componentReference.RelativeRotation = roofAnchor.RelativeRotation;
            componentReference.RelativeScale = roofAnchor.RelativeScale;
            componentReference.AbsoluteLocation = string.Empty;
            componentReference.AbsoluteRotation = string.Empty;
            componentReference.AbsoluteScale = string.Empty;
        }
    }

    private static bool ShouldReparentAircraftBodyShellToFuselageGroup(
        FoxWatchBlueprintComponentReference componentReference)
    {
        if (string.IsNullOrWhiteSpace(componentReference.MeshPath) ||
            !string.Equals(componentReference.ComponentName, "CharacterMesh0", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var meshFileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath);
        if (!meshFileName.Contains("aircraft", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var attachParentName = NormalizeReferenceName(componentReference.AttachParentName);
        return string.Equals(attachParentName, "CollisionCylinder", StringComparison.OrdinalIgnoreCase)
            || string.Equals(attachParentName, "Collision", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ShouldIncludeHiddenAircraftRoofComponent(
        FoxWatchBlueprintComponentReference componentReference)
    {
        if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
        {
            return false;
        }

        var meshFileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath);
        if (meshFileName.Contains("aircraft", StringComparison.OrdinalIgnoreCase) &&
            meshFileName.Contains("fuselage_roof", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return string.Equals(componentReference.ComponentName, "Roof", StringComparison.OrdinalIgnoreCase)
            && meshFileName.Contains("aircraft", StringComparison.OrdinalIgnoreCase)
            && (meshFileName.Contains("upper", StringComparison.OrdinalIgnoreCase)
                || meshFileName.Contains("roof", StringComparison.OrdinalIgnoreCase))
            && !meshFileName.Contains("fuselage_roof", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ShouldIncludeHiddenTrenchOpenWallComponent(
        FoxWatchBlueprintComponentReference componentReference)
    {
        if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
        {
            return false;
        }

        var componentName = NormalizeReferenceName(componentReference.ComponentName);
        if (string.IsNullOrWhiteSpace(componentName))
        {
            return false;
        }

        var separatorIndex = componentName.LastIndexOf(':');
        if (separatorIndex >= 0 && separatorIndex + 1 < componentName.Length)
        {
            componentName = componentName[(separatorIndex + 1)..];
        }

        if (!componentName.StartsWith("OpenWall", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return componentReference.MeshPath.Contains("/Structures/FortTrenches/", StringComparison.OrdinalIgnoreCase);
    }

    private static string? ResolveAircraftHiddenRoofParentName(
        FoxWatchBlueprintComponentReference componentReference,
        IReadOnlySet<string> availableComponentNames)
    {
        if (!ShouldIncludeHiddenAircraftRoofComponent(componentReference) ||
            !string.Equals(NormalizeReferenceName(componentReference.AttachParentName), "CharacterMesh0", StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(componentReference.MeshPath))
        {
            return null;
        }

        return availableComponentNames.Contains("FuselageGroup")
            ? "FuselageGroup"
            : null;
    }

    private static bool IsSegmentedAircraftRoofShell(FoxWatchBlueprintComponentReference componentReference)
    {
        if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
        {
            return false;
        }

        var meshFileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath);
        return meshFileName.Contains("fuselage_roof", StringComparison.OrdinalIgnoreCase);
    }

    private static FoxWatchBlueprintComponentReference? ResolveAircraftHiddenRoofSlotReference(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        FoxWatchBlueprintComponentReference roofComponentReference)
    {
        if (string.IsNullOrWhiteSpace(roofComponentReference.MeshPath))
        {
            return null;
        }

        var meshFileName = Path.GetFileNameWithoutExtension(roofComponentReference.MeshPath);
        var roofSectionMatch = Regex.Match(meshFileName, @"fuselage_roof_(?<index>\d+)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!roofSectionMatch.Success)
        {
            return null;
        }

        if (!int.TryParse(roofSectionMatch.Groups["index"].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var roofSectionIndex) ||
            roofSectionIndex <= 0)
        {
            return null;
        }

        var matchingSlotName = $"MechanicalSlot{roofSectionIndex - 1}";
        return componentReferences.FirstOrDefault(reference =>
            string.Equals(reference.ComponentName, matchingSlotName, StringComparison.OrdinalIgnoreCase) &&
            IsAircraftRoofPartSlotComponent(reference));
    }

    private FoxWatchRenderSceneNode CreateNode(
        string nodeIdPrefix,
        FoxWatchBlueprintComponentReference componentReference,
        IDictionary<string, string> meshIdBySourcePath)
    {
        var node = new FoxWatchRenderSceneNode
        {
            Id = BuildNodeId(nodeIdPrefix, componentReference.ComponentName),
            Name = string.IsNullOrWhiteSpace(componentReference.ComponentName) ? componentReference.ComponentType : componentReference.ComponentName,
        };

        if (TryGetMeshSourcePath(componentReference, out var meshSourcePath))
        {
            node.MeshId = GetOrAddMeshId(meshIdBySourcePath, meshSourcePath);
        }

        if (!UsesEmbeddedAircraftPartMeshPlacement(componentReference) &&
            TryParseVector(componentReference.RelativeLocation, out var relativeLocation))
        {
            node.UnrealLocationCentimeters = relativeLocation;
        }

        if (!UsesEmbeddedAircraftPartMeshPlacement(componentReference) &&
            TryParseRotator(componentReference.RelativeRotation, out var relativeRotation))
        {
            node.UnrealRotationDegrees = relativeRotation;
        }

        if (!UsesEmbeddedAircraftPartMeshPlacement(componentReference) &&
            TryParseVector(componentReference.RelativeScale, out var relativeScale))
        {
            node.Scale = relativeScale;
        }

        if (IsBuildSocketComponent(componentReference) &&
            !IsPowerSocketComponent(componentReference) &&
            !IsPipeSocketComponent(componentReference))
        {
            node.DebugColor = [.. GenericSocketDebugColor];
            node.MarkerColor = [.. GenericSocketDebugColor];
            node.MarkerSize = 0.35;
        }

        AppendSplineConnectorNodes(nodeIdPrefix, node, componentReference, meshIdBySourcePath);

        return node;
    }

    private string? ResolveBlueprintPackagePath(FoxWatchManifestStructure structure)
    {
        if (!string.IsNullOrWhiteSpace(structure.BlueprintPackagePath))
        {
            return structure.BlueprintPackagePath;
        }

        var codeNameCandidates = GetBlueprintCodeNameCandidates(structure).ToList();
        var rankedCandidate = codeNameCandidates
            .SelectMany(codeName => FindBlueprintPackageCandidates(codeName)
                .Select(path => new { Path = path, Score = ScoreBlueprintCandidate(path, codeName) }))
            .Where(candidate => candidate.Score > 0)
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.Path, StringComparer.Ordinal)
            .FirstOrDefault();

        if (rankedCandidate == null)
        {
            _logger.LogDebug("No blueprint package match found for {StructureId} ({CodeName})", structure.Id, structure.CodeName);
            return null;
        }

        return rankedCandidate.Path;
    }

    private IEnumerable<string> FindBlueprintPackageCandidates(string codeName)
    {
        var packagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var packagePath in _meshAssetExporter.FindPackages($"BP{codeName}", 50, BlueprintPackagePrefix))
        {
            if (packagePaths.Add(packagePath))
            {
                yield return packagePath;
            }
        }

        foreach (var packagePath in _meshAssetExporter.FindPackages(codeName, 200, BlueprintPackagePrefix))
        {
            if (packagePaths.Add(packagePath))
            {
                yield return packagePath;
            }
        }
    }

    private static IEnumerable<string> GetBlueprintCodeNameCandidates(FoxWatchManifestStructure structure)
    {
        if (!string.IsNullOrWhiteSpace(structure.ParentStructureId))
        {
            var separatorIndex = structure.CodeName.LastIndexOf('_');
            if (separatorIndex > 0)
            {
                var baseCodeName = structure.CodeName[..separatorIndex];
                if (!string.IsNullOrWhiteSpace(baseCodeName))
                {
                    yield return baseCodeName;
                }
            }
        }

        if (!string.IsNullOrWhiteSpace(structure.CodeName))
        {
            yield return structure.CodeName;
        }
    }

    private static int ScoreBlueprintCandidate(string packagePath, string codeName)
    {
        var fileName = Path.GetFileNameWithoutExtension(packagePath);
        var score = 0;

        if (string.Equals(fileName, $"BP{codeName}", StringComparison.OrdinalIgnoreCase))
        {
            score += 500;
        }
        else if (string.Equals(fileName, $"BP{codeName}Pickup", StringComparison.OrdinalIgnoreCase))
        {
            score += 490;
        }
        else if (string.Equals(fileName, codeName, StringComparison.OrdinalIgnoreCase))
        {
            score += 450;
        }
        else if (string.Equals(fileName, $"{codeName}Pickup", StringComparison.OrdinalIgnoreCase))
        {
            score += 440;
        }
        else if (fileName.Contains(codeName, StringComparison.OrdinalIgnoreCase))
        {
            score += 250;
        }
        else
        {
            return 0;
        }

        if (packagePath.Contains("/Husks/", StringComparison.OrdinalIgnoreCase))
        {
            score -= 250;
        }

        if (packagePath.Contains("/Modifications/", StringComparison.OrdinalIgnoreCase))
        {
            score -= 150;
        }

        if (packagePath.Contains("/Data/", StringComparison.OrdinalIgnoreCase))
        {
            score -= 100;
        }

        if (packagePath.Contains("/Components/", StringComparison.OrdinalIgnoreCase))
        {
            score -= 75;
        }

        return score;
    }

    private static string BuildNodeId(string nodeIdPrefix, string componentName)
    {
        var normalized = string.Concat(componentName
            .Trim()
            .Select(character => char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : '-'));
        normalized = normalized.Trim('-');

        return string.IsNullOrWhiteSpace(normalized)
            ? $"{nodeIdPrefix}:node"
            : $"{nodeIdPrefix}:{normalized}";
    }

    private static string GetOrAddMeshId(IDictionary<string, string> meshIdBySourcePath, string meshSourcePath)
    {
        if (meshIdBySourcePath.TryGetValue(meshSourcePath, out var existingMeshId))
        {
            return existingMeshId;
        }

        var fileStem = Path.GetFileNameWithoutExtension(meshSourcePath);
        var meshId = string.IsNullOrWhiteSpace(fileStem)
            ? $"mesh-{meshIdBySourcePath.Count + 1}"
            : $"mesh-{fileStem.ToLowerInvariant()}";

        var uniqueMeshId = meshId;
        var suffix = 2;
        while (meshIdBySourcePath.Values.Contains(uniqueMeshId, StringComparer.OrdinalIgnoreCase))
        {
            uniqueMeshId = $"{meshId}-{suffix}";
            suffix += 1;
        }

        meshIdBySourcePath[meshSourcePath] = uniqueMeshId;
        return uniqueMeshId;
    }

    private static bool TryGetMeshSourcePath(FoxWatchBlueprintComponentReference componentReference, out string meshSourcePath)
    {
        meshSourcePath = string.Empty;

        if (!string.IsNullOrWhiteSpace(componentReference.MeshPath))
        {
            meshSourcePath = ConvertPackagePathToMeshSourcePath(componentReference.MeshPath);
            return true;
        }

        return false;
    }

    private static bool IsAircraftPartSlotComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        return componentReference.ComponentType.Contains("AircraftPartSlotComponent", StringComparison.OrdinalIgnoreCase)
            || componentReference.ComponentType.Contains("AircraftRoofPartSlotComponent", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsAircraftRoofPartSlotComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        return componentReference.ComponentType.Contains("AircraftRoofPartSlotComponent", StringComparison.OrdinalIgnoreCase);
    }

    private static bool UsesEmbeddedAircraftPartMeshPlacement(FoxWatchBlueprintComponentReference componentReference)
    {
        return IsAircraftPartSlotComponent(componentReference);
    }

    private static bool IsAircraftPartSlotGroupComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        return componentReference.ComponentType.Contains("AircraftPartSlotGroupComponent", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPowerSocketComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        return IsBuildSocketComponent(componentReference)
            && componentReference.ComponentName.Contains("PowerSocket", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPipeSocketComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        return IsBuildSocketComponent(componentReference)
            && componentReference.ComponentName.Contains("Pipe", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPipelineConnectorComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        return !string.IsNullOrWhiteSpace(componentReference.MeshPath)
            && componentReference.MeshPath.Contains("/PipelineI", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsBuildSocketComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        return componentReference.ComponentType.Contains("BuildSocketComponent", StringComparison.OrdinalIgnoreCase);
    }

    private static string ConvertPackagePathToMeshSourcePath(string packagePath)
    {
        var normalized = packagePath.Replace('\\', '/');
        if (normalized.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
        {
            return $"{normalized[..^".uasset".Length]}.glb";
        }

        return normalized;
    }

    private Dictionary<string, List<string>> BuildPoseAnimationPackagePathsBySourcePath(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences)
    {
        var poseAnimationPackagePathsBySourcePath = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var componentReference in componentReferences)
        {
            if (!IsPoseDiscoverableSkeletalComponent(componentReference) ||
                ShouldSkipAutomaticPoseDiscovery(componentReference) ||
                !TryGetMeshSourcePath(componentReference, out var meshSourcePath))
            {
                continue;
            }

            if (!poseAnimationPackagePathsBySourcePath.TryGetValue(meshSourcePath, out var poseAnimationPackagePaths))
            {
                poseAnimationPackagePaths = [];
                poseAnimationPackagePathsBySourcePath[meshSourcePath] = poseAnimationPackagePaths;
            }

            foreach (var animationPackagePath in DiscoverPoseAnimationPackagePaths(componentReference))
            {
                if (!poseAnimationPackagePaths.Contains(animationPackagePath, StringComparer.OrdinalIgnoreCase))
                {
                    poseAnimationPackagePaths.Add(animationPackagePath);
                }
            }
        }

        foreach (var poseAnimationPackagePaths in poseAnimationPackagePathsBySourcePath.Values)
        {
            poseAnimationPackagePaths.Sort(StringComparer.OrdinalIgnoreCase);
        }

        return poseAnimationPackagePathsBySourcePath;
    }

    private IEnumerable<string> DiscoverPoseAnimationPackagePaths(FoxWatchBlueprintComponentReference componentReference)
    {
        var yieldedPackagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var packagePrefix in EnumeratePoseAnimationPackagePrefixes(componentReference))
        {
            foreach (var packagePath in _meshAssetExporter.ListPackagesByPrefixes(packagePrefix))
            {
                if (yieldedPackagePaths.Add(packagePath) && IsPoseAnimationPackagePath(packagePath))
                {
                    yield return packagePath;
                }
            }
        }
    }

    private IEnumerable<string> EnumeratePoseAnimationPackagePrefixes(FoxWatchBlueprintComponentReference componentReference)
    {
        var yieldedPrefixes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (TryGetPackageDirectoryPrefix(componentReference.AnimationClassPath, out var animationDirectoryPrefix) &&
            yieldedPrefixes.Add(animationDirectoryPrefix))
        {
            yield return animationDirectoryPrefix;
        }

        if (TryGetPackageDirectoryPrefix(componentReference.MeshPath, out var meshDirectoryPrefix) &&
            yieldedPrefixes.Add(meshDirectoryPrefix))
        {
            yield return meshDirectoryPrefix;
        }

        foreach (var siblingDirectoryPrefix in EnumerateSiblingPosePackagePrefixes(componentReference.MeshPath))
        {
            if (yieldedPrefixes.Add(siblingDirectoryPrefix))
            {
                yield return siblingDirectoryPrefix;
            }
        }
    }

    private IEnumerable<string> EnumerateSiblingPosePackagePrefixes(string? meshPackagePath)
    {
        if (string.IsNullOrWhiteSpace(meshPackagePath))
        {
            yield break;
        }

        var normalizedPath = meshPackagePath.Replace('\\', '/').Trim();
        var meshDirectoryPath = Path.GetDirectoryName(normalizedPath.Replace('/', Path.DirectorySeparatorChar));
        if (string.IsNullOrWhiteSpace(meshDirectoryPath))
        {
            yield break;
        }

        var parentDirectoryPath = Path.GetDirectoryName(meshDirectoryPath);
        var currentDirectoryName = Path.GetFileName(meshDirectoryPath);
        if (string.IsNullOrWhiteSpace(parentDirectoryPath) || string.IsNullOrWhiteSpace(currentDirectoryName))
        {
            yield break;
        }

        var familyToken = NormalizeVariantFamilyToken(currentDirectoryName);
        if (string.IsNullOrWhiteSpace(familyToken))
        {
            yield break;
        }

        var siblingPrefixes = _meshAssetExporter
            .ListPackagesByPrefixes(parentDirectoryPath.Replace(Path.DirectorySeparatorChar, '/').TrimEnd('/') + "/")
            .Where(IsPoseAnimationPackagePath)
            .Select(packagePath => Path.GetDirectoryName(packagePath.Replace('/', Path.DirectorySeparatorChar)))
            .Where(directoryPath => !string.IsNullOrWhiteSpace(directoryPath))
            .Select(directoryPath => directoryPath!.Replace(Path.DirectorySeparatorChar, '/').TrimEnd('/') + "/")
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase);

        foreach (var siblingPrefix in siblingPrefixes)
        {
            var siblingDirectoryName = Path.GetFileName(siblingPrefix.TrimEnd('/'));
            if (NormalizeVariantFamilyToken(siblingDirectoryName) == familyToken)
            {
                yield return siblingPrefix;
            }
        }
    }

    private static bool TryGetPackageDirectoryPrefix(string? packagePath, out string directoryPrefix)
    {
        var normalizedPath = packagePath?.Replace('\\', '/').Trim() ?? string.Empty;
        var directoryPath = Path.GetDirectoryName(normalizedPath.Replace('/', Path.DirectorySeparatorChar));
        if (string.IsNullOrWhiteSpace(directoryPath))
        {
            directoryPrefix = string.Empty;
            return false;
        }

        directoryPrefix = directoryPath.Replace(Path.DirectorySeparatorChar, '/').TrimEnd('/') + "/";
        return true;
    }

    private static string NormalizeVariantFamilyToken(string? value)
    {
        var normalized = NormalizeVariantToken(value);
        if (normalized.Length > 1)
        {
            var suffix = normalized[^1];
            if ((suffix == 'c' || suffix == 'w') && char.IsLetter(normalized[^2]))
            {
                return normalized[..^1];
            }
        }

        return normalized;
    }

    private static string NormalizeVariantToken(string? value)
    {
        return string.Concat((value ?? string.Empty)
            .Where(char.IsLetterOrDigit)
            .Select(char.ToLowerInvariant));
    }

    private static bool IsPoseDiscoverableSkeletalComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        return string.Equals(componentReference.MeshType, "skeletal", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(componentReference.MeshPath);
    }

    private static bool IsPoseAnimationPackagePath(string packagePath)
    {
        if (string.IsNullOrWhiteSpace(packagePath) ||
            !packagePath.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var fileName = Path.GetFileNameWithoutExtension(packagePath.Replace('/', Path.DirectorySeparatorChar));
        if (!fileName.StartsWith("Anim_", StringComparison.OrdinalIgnoreCase)
            && !fileName.StartsWith("ANIM_", StringComparison.OrdinalIgnoreCase)
            && !fileName.StartsWith("POSE_", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (fileName.StartsWith("ABP_", StringComparison.OrdinalIgnoreCase)
            || fileName.StartsWith("BS_", StringComparison.OrdinalIgnoreCase)
            || fileName.StartsWith("AimOffset", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("movement", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("explode", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("tread_", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("body_", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return fileName.Contains("pose", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("idle", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("neutral", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("hammer", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("_ao_", StringComparison.OrdinalIgnoreCase)
            || fileName.EndsWith("_ao", StringComparison.OrdinalIgnoreCase);
    }

    private static string? SelectDefaultPoseAnimationPackagePath(IReadOnlyList<string>? poseAnimationPackagePaths)
    {
        if (poseAnimationPackagePaths is not { Count: > 0 })
        {
            return null;
        }

        return poseAnimationPackagePaths
                   .OrderByDescending(GetDefaultPoseSelectionPriority)
                   .ThenBy(path => path, StringComparer.OrdinalIgnoreCase)
                   .FirstOrDefault()
               ?? poseAnimationPackagePaths[0];
    }

    private static int GetDefaultPoseSelectionPriority(string poseAnimationPackagePath)
    {
        if (string.IsNullOrWhiteSpace(poseAnimationPackagePath))
        {
            return 0;
        }

        var fileName = Path.GetFileNameWithoutExtension(poseAnimationPackagePath.Replace('/', Path.DirectorySeparatorChar));
        var hasNeutral = fileName.Contains("neutral", StringComparison.OrdinalIgnoreCase);
        var hasDefault = fileName.Contains("default", StringComparison.OrdinalIgnoreCase);
        var hasIdle = fileName.Contains("idle", StringComparison.OrdinalIgnoreCase);
        var hasLevel0 = fileName.Contains("level0", StringComparison.OrdinalIgnoreCase);
        var hasInertiaOffset = fileName.Contains("inertiaoffset", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("inertia_offset", StringComparison.OrdinalIgnoreCase);
        var hasDirectionalSuffix = fileName.Contains("front", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("back", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("left", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("right", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("up", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("down", StringComparison.OrdinalIgnoreCase);

        if (hasNeutral && !hasInertiaOffset && !hasDirectionalSuffix)
        {
            return 400;
        }

        if (hasDefault || hasIdle || hasLevel0)
        {
            return 300;
        }

        if (hasNeutral && !hasDirectionalSuffix)
        {
            return 200;
        }

        if (hasNeutral)
        {
            return 100;
        }

        return 0;
    }

    private static bool TryParseVector(string value, out List<double> parsedValues)
    {
        var match = VectorPattern.Match(value ?? string.Empty);
        if (!match.Success)
        {
            parsedValues = [];
            return false;
        }

        parsedValues = [
            ParseDouble(match.Groups["x"].Value),
            ParseDouble(match.Groups["y"].Value),
            ParseDouble(match.Groups["z"].Value),
        ];

        return true;
    }

    private static bool TryParseRotator(string value, out List<double> parsedValues)
    {
        var match = RotatorPattern.Match(value ?? string.Empty);
        if (!match.Success)
        {
            parsedValues = [];
            return false;
        }

        parsedValues = [
            ParseDouble(match.Groups["pitch"].Value),
            ParseDouble(match.Groups["yaw"].Value),
            ParseDouble(match.Groups["roll"].Value),
        ];

        return true;
    }

    private static string FormatVector(IReadOnlyList<double> value)
    {
        return string.Format(
            CultureInfo.InvariantCulture,
            "X={0:0.###} Y={1:0.###} Z={2:0.###}",
            value.Count > 0 ? value[0] : 0,
            value.Count > 1 ? value[1] : 0,
            value.Count > 2 ? value[2] : 0);
    }

    private static string FormatRotator(IReadOnlyList<double> value)
    {
        return string.Format(
            CultureInfo.InvariantCulture,
            "P={0:0.###} Y={1:0.###} R={2:0.###}",
            value.Count > 0 ? value[0] : 0,
            value.Count > 1 ? value[1] : 0,
            value.Count > 2 ? value[2] : 0);
    }

    private static double ParseDouble(string value)
    {
        return double.Parse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
    }
}

public sealed class FoxWatchBlueprintSceneExtraction
{
    public List<FoxWatchRenderSceneNode> Roots { get; set; } = [];

    public List<FoxWatchRenderSceneMeshAsset> Meshes { get; set; } = [];

    public List<FoxWatchRenderSceneVariant>? Variants { get; set; }
}
