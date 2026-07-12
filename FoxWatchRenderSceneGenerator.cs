namespace FoxWatchService;

using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

public sealed class FoxWatchRenderSceneGenerator
{
    private const string DefaultPoseSceneVariantId = "default-pose";
    private const string SharedModificationHashDiagnosticsRelativeDirectory = "tools/foxwatch/tmp/diagnostics/shared-modification-hash";
    private const string SharedPackagedPalletStructureId = "packaged-pallets";
    private const string LargeCranePoseOverrideEnvironmentVariableName = "FOXWATCH_LARGE_CRANE_POSE";
    private const string DeployableTripodHeightPoseOverrideEnvironmentVariableName = "FOXWATCH_DEPLOYABLE_TRIPOD_HEIGHT_POSE";
    private const string DeployableTripodNeutralPoseOverrideEnvironmentVariableName = "FOXWATCH_DEPLOYABLE_TRIPOD_NEUTRAL_POSE";
    private const string WindsockPoseOverrideEnvironmentVariableName = "FOXWATCH_WINDSOCK_POSE";
    private const string BargePoseOverrideEnvironmentVariableName = "FOXWATCH_BARGE_POSE";
    private const string BargeStructureId = "barge";
    private const string FacilityCraneStructureId = "facilitycrane";
    private const string StaticCraneStructureId = "staticcrane";
    private const string LargeCraneStructureId = "largecrane";
    private const string DeployedTripodStructureId = "deployedtripod";
    private const string BargeMeshId = "mesh-sk_barge_03";
    private const string BargeMeshSourcePath = "War/Content/Meshes/Vehicles/SK_Barge_03.glb";
    private const string FacilityCraneMeshId = "mesh-sk_facilitycrane";
    private const string FacilityCraneMeshSourcePath = "War/Content/Meshes/Structures/SK_FacilityCrane.glb";
    private const string StaticCraneMeshId = "mesh-sk_staticcrane";
    private const string StaticCraneMeshSourcePath = "War/Content/Meshes/Structures/SK_StaticCrane.glb";
    private const string LargeCraneMeshId = "mesh-sk_largecrane";
    private const string LargeCraneMeshSourcePath = "War/Content/Meshes/Vehicles/SK_LargeCrane.glb";
    private const string LargeCraneDefaultArmLocationAnimationPackagePath = "War/Content/Animation/LargeCrane/Anim_LargeCrane_Pose_CraneLocation_1375dist_0height.uasset";
    private const string LargeCraneHookDepthNeutralAnimationPackagePath = "War/Content/Animation/LargeCrane/Anim_LargeCrane_Pose_hookDepth_0.uasset";
    private const string LargeCraneHookRotationFrontAnimationPackagePath = "War/Content/Animation/LargeCrane/Anim_LargeCrane_Pose_hook_front.uasset";
    private const string LargeCraneHorizontalRotationFrontAnimationPackagePath = "War/Content/Animation/LargeCrane/Anim_LargeCrane_Pose_HorizontalRotation_front.uasset";
    private const string DeployableTripodMeshId = "mesh-sk_deployabletripod";
    private const string DeployableTripodMeshSourcePath = "War/Content/Meshes/Weapons/SK_DeployableTripod.glb";
    private const string WindsockMeshId = "mesh-sk_windsock";
    private const string WindsockMeshSourcePath = "War/Content/Meshes/Weapons/SK_Windsock.glb";
    private const string FacilityPipeOverheadSpanMeshSourcePath =
        "War/Content/Meshes/Structures/Facilities/PipelineoverheadConnect.glb";
    private const string FacilityPipeOverheadSpanMeshId = "mesh-pipelineoverheadconnect";
    private const double FacilityCatwalkDeckNativeLengthCm = 260.0;
    private const double FacilityCatwalkDeckMeshScale = 0.95;
    private const double FacilityCatwalkCrossbeamNativeLengthCm = 127.35235595703125;
    private const string DeployableTripodMountedAttachmentBoneName = "vertical_pivot";
    private const string DeployableTripodHeightPoseAnimationPackagePath = "War/Content/Animation/Weapons/DeployableTripod/Tripod_POSE_h200_r60.uasset";
    private const string DeployableTripodNeutralPoseAnimationPackagePath = "War/Content/Animation/Weapons/DeployableTripod/Tripod_POSE_neutral.uasset";
    private const string BargeClosedNeutralPoseAnimationPackagePath = "War/Content/Animation/WaterVehicles/Barge/Anim_Barge_POSE_closedNeutral.uasset";
    private const string WindsockPoseAnimationPackagePath = "War/Content/Animation/Weapons/DeployableTripod/ANIM_Windsock_level0.uasset";
    private static readonly IReadOnlyList<string> SharedPackagedPalletShippableTypes = ["normal", "large", "extralarge"];

    private readonly FoxWatchManifestGenerator _manifestGenerator;
    private readonly FoxWatchRenderBlueprintSceneExtractor _blueprintSceneExtractor;
    private readonly FoxWatchAssetMeshExporter _meshAssetExporter;
    private readonly FoxWatchPoseOverrideLoader _poseOverrideLoader;
    private readonly ILogger<FoxWatchRenderSceneGenerator> _logger;
    private readonly Dictionary<string, string?> _exportUrlByPackagePath = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, FoxWatchCraneRenderAsset?> _craneRenderAssetByStructureId = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<SharedModificationHashDiagnosticEntry> _sharedModificationHashDiagnostics = [];
    private IReadOnlyList<string>? _bargePoseAnimationPackagePaths;
    private IReadOnlyList<string>? _facilityCranePoseAnimationPackagePaths;
    private IReadOnlyList<string>? _deployableTripodPoseAnimationPackagePaths;
    private IReadOnlyList<string>? _windsockPoseAnimationPackagePaths;
    private IReadOnlyList<string>? _largeCranePoseAnimationPackagePaths;
    private FoxWatchRenderScenePose? _bargePose;
    private bool _bargePoseInitialized;
    private FoxWatchRenderScenePose? _deployableTripodNeutralPose;
    private bool _deployableTripodNeutralPoseInitialized;
    private FoxWatchRenderScenePose? _windsockPose;
    private bool _windsockPoseInitialized;

    public FoxWatchRenderSceneGenerator(
        FoxWatchManifestGenerator manifestGenerator,
        FoxWatchRenderBlueprintSceneExtractor blueprintSceneExtractor,
        FoxWatchAssetMeshExporter meshAssetExporter,
        FoxWatchPoseOverrideLoader poseOverrideLoader,
        ILogger<FoxWatchRenderSceneGenerator> logger)
    {
        _manifestGenerator = manifestGenerator;
        _blueprintSceneExtractor = blueprintSceneExtractor;
        _meshAssetExporter = meshAssetExporter;
        _poseOverrideLoader = poseOverrideLoader;
        _logger = logger;
    }

    public async Task GenerateAsync(string outputDirectory, string? renderAssetOutputDirectory, string baseAssetsUrl, string? pakDirectoryPath, FoxWatchTargetFilter? targetFilter = null, bool includePoseVariants = false, CancellationToken cancellationToken = default)
    {
        targetFilter ??= FoxWatchTargetFilter.Empty;
        _sharedModificationHashDiagnostics.Clear();
        var diagnosticsRunId = CreateSharedModificationHashDiagnosticsRunId();

        var serializerOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = true,
        };

        try
        {
            var manifest = _manifestGenerator.BuildManifest(baseAssetsUrl, pakDirectoryPath, targetFilter);
            Directory.CreateDirectory(outputDirectory);
            if (!string.IsNullOrWhiteSpace(renderAssetOutputDirectory))
            {
                Directory.CreateDirectory(renderAssetOutputDirectory);
            }

            var index = new FoxWatchRenderSceneIndex();
            var indexEntriesByOutputPath = new Dictionary<string, FoxWatchRenderSceneIndexEntry>(StringComparer.OrdinalIgnoreCase);
            var generatedSceneDocuments = new List<FoxWatchGeneratedRenderSceneDocument>();
            foreach (var structure in manifest.Assets.OrderBy(entry => entry.Id, StringComparer.Ordinal))
            {
                var sceneDocuments = await CreateSceneDocumentsAsync(
                    structure,
                    renderAssetOutputDirectory,
                    includePoseVariants,
                    cancellationToken);

                generatedSceneDocuments.AddRange(sceneDocuments);
            }

            generatedSceneDocuments.AddRange(await CreateSharedPackagedPalletSceneDocumentsAsync(
                renderAssetOutputDirectory,
                cancellationToken));

            var modificationRenderIndex = await FoxWatchModificationRenderIndexWriter.LoadAsync(
                FoxWatchWorkspace.ResolvePath(FoxWatchWorkspace.DefaultModificationRenderIndexRelativePath)!,
                cancellationToken);

            foreach (var sceneDocument in DeduplicateStandaloneModificationSceneDocuments(
                generatedSceneDocuments,
                modificationRenderIndex).OrderBy(entry => entry.RelativeScenePath, StringComparer.Ordinal))
            {
                var filePath = Path.Combine(outputDirectory, sceneDocument.RelativeScenePath);
                var fileDirectory = Path.GetDirectoryName(filePath);
                if (!string.IsNullOrWhiteSpace(fileDirectory))
                {
                    Directory.CreateDirectory(fileDirectory);
                }

                var json = JsonSerializer.Serialize(sceneDocument.Document, serializerOptions);
                await File.WriteAllTextAsync(filePath, $"{json}{Environment.NewLine}", cancellationToken);

                var outputPath = sceneDocument.RelativeScenePath.Replace(Path.DirectorySeparatorChar, '/');
                if (indexEntriesByOutputPath.TryGetValue(outputPath, out var existingEntry))
                {
                    foreach (var structureId in sceneDocument.AllowedStructureIds)
                    {
                        if (!existingEntry.AllowedStructureIds.Contains(structureId, StringComparer.OrdinalIgnoreCase))
                        {
                            existingEntry.AllowedStructureIds.Add(structureId);
                        }
                    }

                    MergeConsumers(existingEntry.Consumers, sceneDocument.Consumers);
                    continue;
                }

                var indexEntry = new FoxWatchRenderSceneIndexEntry
                {
                    StructureId = sceneDocument.StructureId,
                    AllowedStructureIds = [.. sceneDocument.AllowedStructureIds],
                    Consumers = [.. sceneDocument.Consumers.Select(consumer => new FoxWatchRenderSceneConsumer
                    {
                        StructureId = consumer.StructureId,
                        SlotName = consumer.SlotName,
                        DataClassPath = consumer.DataClassPath,
                        VariantId = consumer.VariantId,
                    })],
                    RenderId = GetDocumentRenderId(sceneDocument),
                    CodeName = sceneDocument.CodeName,
                    Name = sceneDocument.Name,
                    CategoryId = sceneDocument.CategoryId,
                    OutputPath = outputPath,
                    PreviewUrl = sceneDocument.PreviewUrl,
                    IconUrl = sceneDocument.IconUrl,
                };
                indexEntriesByOutputPath[outputPath] = indexEntry;
                index.Scenes.Add(indexEntry);
            }

            var indexPath = Path.Combine(outputDirectory, "index.render-scenes.v1.json");
            var indexJson = JsonSerializer.Serialize(index, serializerOptions);
            await File.WriteAllTextAsync(indexPath, $"{indexJson}{Environment.NewLine}", cancellationToken);
            _logger.LogInformation("Wrote {SceneCount} FoxWatch render bundle scene documents to {OutputDirectory}", index.Scenes.Count, outputDirectory);
        }
        finally
        {
            await WriteSharedModificationHashDiagnosticsAsync(
                diagnosticsRunId,
                outputDirectory,
                renderAssetOutputDirectory,
                baseAssetsUrl,
                pakDirectoryPath,
                serializerOptions,
                cancellationToken);
        }
    }

    private async Task<List<FoxWatchGeneratedRenderSceneDocument>> CreateSceneDocumentsAsync(
        FoxWatchManifestStructure structure,
        string? renderAssetOutputDirectory,
        bool includePoseVariants,
        CancellationToken cancellationToken)
    {
        var blueprintScene = await _blueprintSceneExtractor.TryExtractAsync(structure, cancellationToken);
        blueprintScene = await AppendCraneSpawnVisualsAsync(structure, blueprintScene, cancellationToken);
        if (blueprintScene?.Meshes.Count > 0)
        {
            await PopulateMeshExportsAsync(blueprintScene.Meshes, renderAssetOutputDirectory, cancellationToken);
        }

        var collapsedBlueprint = CollapseBlueprintSceneForBaseRender(
            structure,
            CloneBlueprintSceneExtraction(blueprintScene));

        FoxWatchBlueprintSceneExtraction? collapsedStructureScene;
        IReadOnlyList<string>? baseSceneModes = null;
        if (IsFacilityCatwalkBridgeStructure(structure))
        {
            collapsedStructureScene = PrepareFacilityCatwalkBridgeScene(
                structure,
                collapsedBlueprint,
                shortenSpanForPreview: false);
            baseSceneModes = ["topdown"];
        }
        else if (IsRailTrackSplineStructure(structure))
        {
            collapsedStructureScene = PrepareBlueprintSceneForBaseRender(structure, collapsedBlueprint);
            baseSceneModes = ["topdown"];
        }
        else
        {
            collapsedStructureScene = PrepareBlueprintSceneForBaseRender(structure, collapsedBlueprint);
        }

        var documents = new List<FoxWatchGeneratedRenderSceneDocument>
        {
            new()
            {
                StructureId = structure.Id,
                AllowedStructureIds = GetAllowedStructureIds(structure),
                CodeName = structure.CodeName,
                Name = structure.Name.Fallback,
                CategoryId = structure.CategoryId,
                PreviewUrl = structure.PreviewUrl,
                IconUrl = structure.IconUrl,
                RelativeScenePath = Path.Combine(structure.Id, "scene.json"),
                Document = await CreateDocumentAsync(
                    structure,
                    collapsedStructureScene,
                    structure.Id,
                    baseSceneModes,
                    includePoseVariants,
                    clipFloorOverride: null,
                    cancellationToken),
            },
        };

        if (IsFacilityCatwalkBridgeStructure(structure))
        {
            var previewScene = PrepareFacilityCatwalkBridgeScene(
                structure,
                collapsedBlueprint,
                shortenSpanForPreview: true);
            documents.Add(new FoxWatchGeneratedRenderSceneDocument
            {
                StructureId = structure.Id,
                AllowedStructureIds = GetAllowedStructureIds(structure),
                CodeName = structure.CodeName,
                Name = structure.Name.Fallback,
                CategoryId = structure.CategoryId,
                PreviewUrl = structure.PreviewUrl,
                IconUrl = structure.IconUrl,
                RelativeScenePath = Path.Combine(structure.Id, "preview.scene.json"),
                Document = await CreateDocumentAsync(
                    structure,
                    previewScene,
                    structure.Id,
                    ["preview", "icon"],
                    includePoseVariants,
                    clipFloorOverride: null,
                    cancellationToken),
            });
        }
        else if (IsRailTrackSplineStructure(structure))
        {
            var previewScene = PrepareRailTrackSplineSceneForPreview(structure, collapsedBlueprint);
            documents.Add(new FoxWatchGeneratedRenderSceneDocument
            {
                StructureId = structure.Id,
                AllowedStructureIds = GetAllowedStructureIds(structure),
                CodeName = structure.CodeName,
                Name = structure.Name.Fallback,
                CategoryId = structure.CategoryId,
                PreviewUrl = structure.PreviewUrl,
                IconUrl = structure.IconUrl,
                RelativeScenePath = Path.Combine(structure.Id, "preview.scene.json"),
                Document = await CreateDocumentAsync(
                    structure,
                    previewScene,
                    structure.Id,
                    ["preview", "icon"],
                    includePoseVariants,
                    clipFloorOverride: null,
                    cancellationToken),
            });
        }

        var destroyedVehicleScene = structure.IsVehicle == true
            && !FoxWatchVehicleDestroyedPublishAllowlist.ShouldPublishDestroyedVisuals(structure.Id)
            ? null
            : await _blueprintSceneExtractor.TryExtractDestroyedVehicleAsync(structure, cancellationToken);
        if (destroyedVehicleScene?.Roots.Count > 0)
        {
            if (destroyedVehicleScene.Meshes.Count > 0)
            {
                await PopulateMeshExportsAsync(destroyedVehicleScene.Meshes, renderAssetOutputDirectory, cancellationToken);
            }

            documents.Add(new FoxWatchGeneratedRenderSceneDocument
            {
                StructureId = structure.Id,
                AllowedStructureIds = GetAllowedStructureIds(structure),
                CodeName = structure.CodeName,
                Name = structure.Name.Fallback,
                CategoryId = structure.CategoryId,
                PreviewUrl = structure.PreviewUrl,
                IconUrl = structure.IconUrl,
                RelativeScenePath = Path.Combine(structure.Id, "destroyed.scene.json"),
                Document = await CreateDocumentAsync(
                    structure,
                    destroyedVehicleScene,
                    $"{structure.Id}.destroyed",
                    ["topdown", "preview", "icon"],
                    includePoseVariants: false,
                    clipFloorOverride: null,
                    cancellationToken),
            });
        }

        var packagedScene = await _blueprintSceneExtractor.TryExtractPackagedAsync(structure, cancellationToken);
        if (packagedScene?.Roots.Count > 0)
        {
            if (packagedScene.Meshes.Count > 0)
            {
                await PopulateMeshExportsAsync(packagedScene.Meshes, renderAssetOutputDirectory, cancellationToken);
            }

            documents.Add(new FoxWatchGeneratedRenderSceneDocument
            {
                StructureId = structure.Id,
                AllowedStructureIds = GetAllowedStructureIds(structure),
                CodeName = structure.CodeName,
                Name = structure.Name.Fallback,
                CategoryId = structure.CategoryId,
                PreviewUrl = structure.PreviewUrl,
                IconUrl = structure.IconUrl,
                RelativeScenePath = Path.Combine(structure.Id, "packaged.scene.json"),
                Document = await CreateDocumentAsync(
                    structure,
                    packagedScene,
                    $"{structure.Id}.packaged",
                    ["topdown"],
                    includePoseVariants: false,
                    clipFloorOverride: null,
                    cancellationToken),
            });
        }

        foreach (var layerId in GetStandaloneStructureRenderLayerIds(structure))
        {
            var layerScene = CreateTopdownStructureComponentScene(
                structure,
                CloneBlueprintSceneExtraction(collapsedStructureScene),
                layerId);
            if (layerScene?.Roots.Count is not > 0)
            {
                continue;
            }

            documents.Add(new FoxWatchGeneratedRenderSceneDocument
            {
                StructureId = structure.Id,
                AllowedStructureIds = GetAllowedStructureIds(structure),
                CodeName = structure.CodeName,
                Name = structure.Name.Fallback,
                CategoryId = structure.CategoryId,
                PreviewUrl = structure.PreviewUrl,
                IconUrl = structure.IconUrl,
                RelativeScenePath = Path.Combine(structure.Id, "components", $"{layerId}.scene.json"),
                Document = await CreateDocumentAsync(
                    structure,
                    layerScene,
                    $"components/{layerId}",
                    ["topdown"],
                    includePoseVariants: false,
                    clipFloorOverride: GetClipFloorOverrideForRenderLayer(structure, layerId),
                    cancellationToken,
                    componentLayerId: layerId),
            });
        }

        foreach (var target in GetStandaloneModificationRenderTargets(structure, blueprintScene))
        {
            var requestedVariantIds = CreateRequestedVariantIds(
                blueprintScene?.Variants,
                target.VariantId,
                includeDefaultVariant: !target.IsUpgrade);
            if (requestedVariantIds.Count == 0)
            {
                continue;
            }

            var modificationScene = target.IsUpgrade
                ? CollapseBlueprintSceneVariants(structure, CloneBlueprintSceneExtraction(blueprintScene), requestedVariantIds)
                : CreateTopdownModificationScene(
                    CollapseBlueprintSceneVariants(structure, CloneBlueprintSceneExtraction(blueprintScene), requestedVariantIds),
                    structure.Id,
                    target.VariantId,
                    string.IsNullOrWhiteSpace(target.SlotName) ? null : target.SlotName);

            documents.Add(new FoxWatchGeneratedRenderSceneDocument
            {
                StructureId = structure.Id,
                AllowedStructureIds = GetAllowedStructureIds(structure),
                CodeName = structure.CodeName,
                Name = structure.Name.Fallback,
                CategoryId = structure.CategoryId,
                PreviewUrl = structure.PreviewUrl,
                IconUrl = structure.IconUrl,
                RelativeScenePath = Path.Combine(structure.Id, "modifications", $"{target.OutputKey}.scene.json"),
                RenderId = target.RenderId,
                SharedModificationId = target.RenderId,
                Document = await CreateDocumentAsync(
                    structure,
                    modificationScene,
                    $"modifications/{target.OutputKey}",
                    ["topdown", "preview"],
                    includePoseVariants: false,
                    clipFloorOverride: target.IsUpgrade ? null : false,
                    cancellationToken,
                    previewDirectionOverride: target.PreviewDirection),
                IsStandaloneModification = true,
                Consumers = target.Consumers.Count > 0
                    ? target.Consumers
                    :
                    [
                        new FoxWatchRenderSceneConsumer
                        {
                            StructureId = structure.Id,
                            SlotName = target.SlotName,
                            DataClassPath = target.DataClassPath,
                            VariantId = target.VariantId,
                        },
                    ],
            });
        }

        return documents;
    }

    private async Task<List<FoxWatchGeneratedRenderSceneDocument>> CreateSharedPackagedPalletSceneDocumentsAsync(
        string? renderAssetOutputDirectory,
        CancellationToken cancellationToken)
    {
        var documents = new List<FoxWatchGeneratedRenderSceneDocument>();
        foreach (var shippableType in SharedPackagedPalletShippableTypes)
        {
            var palletScene = _blueprintSceneExtractor.CreateSharedPackagedPalletExtraction(shippableType);
            if (palletScene?.Roots.Count is not > 0)
            {
                continue;
            }

            if (palletScene.Meshes.Count > 0)
            {
                await PopulateMeshExportsAsync(palletScene.Meshes, renderAssetOutputDirectory, cancellationToken);
            }

            var structure = new FoxWatchManifestStructure
            {
                Id = SharedPackagedPalletStructureId,
                CodeName = $"{shippableType}-pallet",
                Name = new FoxWatchLocalizedText
                {
                    Id = $"foxwatch:shared:packaging:{shippableType}:name",
                    Fallback = $"{CultureInfo.InvariantCulture.TextInfo.ToTitleCase(shippableType)} packaged pallet",
                },
                CategoryId = "shared",
                CategoryName = new FoxWatchLocalizedText
                {
                    Id = "foxwatch:shared:packaging:category:name",
                    Fallback = "Shared packaging",
                },
            };

            documents.Add(new FoxWatchGeneratedRenderSceneDocument
            {
                StructureId = SharedPackagedPalletStructureId,
                AllowedStructureIds = [SharedPackagedPalletStructureId],
                CodeName = structure.CodeName,
                Name = structure.Name.Fallback,
                CategoryId = structure.CategoryId,
                RelativeScenePath = Path.Combine(SharedPackagedPalletStructureId, $"{shippableType}.scene.json"),
                Document = await CreateDocumentAsync(
                    structure,
                    palletScene,
                    $"packaging/{shippableType}",
                    ["topdown"],
                    includePoseVariants: false,
                    clipFloorOverride: false,
                    cancellationToken),
            });
        }

        return documents;
    }

    private static List<FoxWatchGeneratedRenderSceneDocument> DeduplicateStandaloneModificationSceneDocuments(
        IReadOnlyList<FoxWatchGeneratedRenderSceneDocument> sceneDocuments,
        FoxWatchModificationRenderIndex? modificationRenderIndex = null)
    {
        var nonModificationDocuments = sceneDocuments
            .Where(document => !document.IsStandaloneModification)
            .ToList();
        var modificationDocuments = sceneDocuments
            .Where(document => document.IsStandaloneModification)
            .ToList();
        if (modificationDocuments.Count == 0)
        {
            return nonModificationDocuments;
        }

        foreach (var renderIdGroup in modificationDocuments
            .GroupBy(document => NormalizeStandaloneModificationKeyComponent(GetDocumentRenderId(document)), StringComparer.OrdinalIgnoreCase)
            .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            var documentsInGroup = renderIdGroup
                .OrderBy(document => document.RelativeScenePath, StringComparer.Ordinal)
                .ToList();
            var fingerprints = documentsInGroup
                .Select(CreateStandaloneModificationSceneFingerprint)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var renderId = NormalizeStandaloneModificationKeyComponent(GetDocumentRenderId(documentsInGroup[0]));

            if (fingerprints.Count == 1
                && (documentsInGroup.Count > 1
                    || FoxWatchModificationRenderIdentity.IsSharedModificationRenderIndexEntry(
                        FoxWatchModificationRenderIdentity.TryGetModificationRenderIndexEntry(modificationRenderIndex, renderId))
                    || FoxWatchPublishedSharedModificationCatalog.IsSharedModificationRenderId(renderId)))
            {
                var representative = documentsInGroup[0];
                representative.StructureId = "mods";
                representative.CodeName = renderId;
                representative.Name = renderId;
                representative.CategoryId = "mods";
                representative.RelativeScenePath = Path.Combine("mods", $"{renderId}.scene.json");
                representative.Document.Render.OutputKey = $"mods/{renderId}";
                representative.AllowedStructureIds = documentsInGroup
                    .SelectMany(document => document.AllowedStructureIds)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
                representative.Consumers = documentsInGroup
                    .SelectMany(document => document.Consumers)
                    .GroupBy(consumer => $"{consumer.StructureId}|{consumer.SlotName}|{consumer.DataClassPath}|{consumer.VariantId}", StringComparer.OrdinalIgnoreCase)
                    .Select(grouping => grouping.First())
                    .OrderBy(consumer => consumer.StructureId, StringComparer.OrdinalIgnoreCase)
                    .ThenBy(consumer => consumer.SlotName, StringComparer.OrdinalIgnoreCase)
                    .ThenBy(consumer => consumer.VariantId, StringComparer.OrdinalIgnoreCase)
                    .ToList();
                MergeConsumersFromModificationRenderIndex(representative, modificationRenderIndex, renderId);
                representative.PreviewUrl = null;
                representative.IconUrl = null;
                nonModificationDocuments.Add(representative);
                continue;
            }

            foreach (var document in documentsInGroup)
            {
                document.RelativeScenePath = Path.Combine(document.StructureId, "modifications", $"{renderId}.scene.json");
                document.Document.Render.OutputKey = $"modifications/{renderId}";
                nonModificationDocuments.Add(document);
            }
        }

        return nonModificationDocuments;
    }

    private static void MergeConsumersFromModificationRenderIndex(
        FoxWatchGeneratedRenderSceneDocument document,
        FoxWatchModificationRenderIndex? modificationRenderIndex,
        string renderId)
    {
        var indexEntry = FoxWatchModificationRenderIdentity.TryGetModificationRenderIndexEntry(modificationRenderIndex, renderId);
        if (indexEntry == null)
        {
            return;
        }

        foreach (var consumer in indexEntry.Consumers)
        {
            if (document.Consumers.Any(existing =>
                string.Equals(existing.StructureId, consumer.StructureId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(existing.SlotName, consumer.SlotName, StringComparison.OrdinalIgnoreCase)
                && string.Equals(existing.DataClassPath, consumer.DataClassPath, StringComparison.OrdinalIgnoreCase)
                && string.Equals(existing.VariantId, consumer.VariantId, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            document.Consumers.Add(new FoxWatchRenderSceneConsumer
            {
                StructureId = consumer.StructureId,
                SlotName = consumer.SlotName,
                DataClassPath = consumer.DataClassPath,
                VariantId = consumer.VariantId,
            });
        }

        document.AllowedStructureIds = document.Consumers
            .Select(consumer => consumer.StructureId)
            .Where(structureId => !string.IsNullOrWhiteSpace(structureId))
            .Concat(document.AllowedStructureIds)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToList();
    }

    private static string GetDocumentRenderId(FoxWatchGeneratedRenderSceneDocument sceneDocument)
    {
        if (!string.IsNullOrWhiteSpace(sceneDocument.RenderId))
        {
            return sceneDocument.RenderId.Trim();
        }

        return sceneDocument.SharedModificationId?.Trim() ?? string.Empty;
    }

    private static string CreateStandaloneModificationDeduplicationKey(FoxWatchGeneratedRenderSceneDocument sceneDocument)
    {
        var sharedModificationId = NormalizeStandaloneModificationIdentityPart(sceneDocument.SharedModificationId);
        if (!string.IsNullOrWhiteSpace(sharedModificationId))
        {
            return sharedModificationId;
        }

        return CreateStandaloneModificationSceneFingerprint(sceneDocument);
    }

    private static string CreateStandaloneModificationSceneFingerprint(FoxWatchGeneratedRenderSceneDocument sceneDocument)
    {
        var document = sceneDocument.Document;
        var meshSignatureById = (document.Assets.Meshes ?? [])
            .ToDictionary(
                mesh => mesh.Id,
                mesh => JsonSerializer.Serialize(new
                {
                    sourcePath = mesh.SourcePath?.Trim(),
                    exportUrl = mesh.ExportUrl?.Trim(),
                    defaultPoseAnimationPackagePath = mesh.DefaultPoseAnimationPackagePath?.Trim(),
                    poseAnimationPackagePaths = (mesh.PoseAnimationPackagePaths ?? [])
                        .Select(path => path?.Trim())
                        .Where(path => !string.IsNullOrWhiteSpace(path))
                        .OrderBy(path => path, StringComparer.Ordinal)
                        .ToList(),
                }),
                StringComparer.OrdinalIgnoreCase);
        var materialSignatureById = (document.Assets.Materials ?? [])
            .ToDictionary(
                material => material.Id,
                material => JsonSerializer.Serialize(new
                {
                    name = material.Name?.Trim(),
                    textures = material.Textures
                        .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                        .Select(entry => new
                        {
                            key = entry.Key,
                            value = entry.Value,
                        })
                        .ToList(),
                }),
                StringComparer.OrdinalIgnoreCase);
        var normalized = new
        {
            render = new
            {
                modes = (document.Render.Modes ?? [])
                    .OrderBy(mode => mode, StringComparer.Ordinal)
                    .ToList(),
                previewDirection = document.Render.PreviewDirection?.Trim().ToLowerInvariant(),
                transparentBackground = document.Render.TransparentBackground,
                clipFloor = document.Render.ClipFloor,
                floorZ = document.Render.FloorZ,
                topdownPaddingFactor = document.Render.TopdownPaddingFactor,
                topdownPaddingMeters = document.Render.TopdownPaddingMeters,
                materialMode = document.Render.MaterialMode?.Trim().ToLowerInvariant(),
            },
            roots = document.Scene.Roots.Select(root => NormalizeStandaloneModificationNode(root, meshSignatureById, materialSignatureById)).ToList(),
        };
        var normalizedJson = JsonSerializer.Serialize(normalized);
        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(normalizedJson));
        return Convert.ToHexString(hashBytes[..8]).ToLowerInvariant();
    }

    private static object NormalizeStandaloneModificationNode(
        FoxWatchRenderSceneNode node,
        IReadOnlyDictionary<string, string> meshSignatureById,
        IReadOnlyDictionary<string, string> materialSignatureById)
    {
        return new
        {
            visible = node.Visible,
            variantIds = (node.VariantIds ?? [])
                .OrderBy(variantId => variantId, StringComparer.Ordinal)
                .ToList(),
            mesh = string.IsNullOrWhiteSpace(node.MeshId)
                ? null
                : meshSignatureById.GetValueOrDefault(node.MeshId, node.MeshId),
            primitive = node.Primitive == null
                ? null
                : new
                {
                    type = node.Primitive.Type,
                    points = node.Primitive.Points,
                    color = node.Primitive.Color,
                    radius = node.Primitive.Radius,
                    width = node.Primitive.Width,
                    height = node.Primitive.Height,
                },
            materials = node.MaterialIds
                .Select(materialId => materialSignatureById.GetValueOrDefault(materialId, materialId))
                .OrderBy(materialId => materialId, StringComparer.Ordinal)
                .ToList(),
            location = node.Location,
            rotationEulerDegrees = node.RotationEulerDegrees,
            scale = node.Scale,
            unrealLocationCentimeters = node.UnrealLocationCentimeters,
            unrealSceneLocationCentimeters = node.UnrealSceneLocationCentimeters,
            unrealRotationDegrees = node.UnrealRotationDegrees,
            debugColor = node.DebugColor,
            markerColor = node.MarkerColor,
            markerSize = node.MarkerSize,
            pose = NormalizeStandaloneModificationPose(node.Pose),
            poseVariants = node.PoseVariants == null
                ? null
                : node.PoseVariants
                    .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                    .Select(entry => new
                    {
                        key = entry.Key,
                        value = NormalizeStandaloneModificationPose(entry.Value),
                    })
                    .ToList(),
            attachBoneName = node.AttachBoneName,
            transformMatrix = node.TransformMatrix,
            children = node.Children.Select(child => NormalizeStandaloneModificationNode(child, meshSignatureById, materialSignatureById)).ToList(),
        };
    }

    private static object? NormalizeStandaloneModificationPose(FoxWatchRenderScenePose? pose)
    {
        if (pose == null)
        {
            return null;
        }

        return new
        {
            type = pose.Type,
            profile = pose.Profile,
            parameters = pose.Parameters?
                .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                .Select(entry => new
                {
                    key = entry.Key,
                    value = entry.Value,
                })
                .ToList(),
            bones = pose.Bones?.Select(bone => new
            {
                name = bone.Name,
                parentIndex = bone.ParentIndex,
                location = bone.Location,
                rotationQuaternion = bone.RotationQuaternion,
                scale = bone.Scale,
            }).ToList(),
        };
    }

    private static string CreateSharedStandaloneModificationOutputKey(
        IReadOnlyList<FoxWatchGeneratedRenderSceneDocument> documents,
        string fingerprint)
    {
        var sharedModificationIds = documents
            .Select(document => NormalizeStandaloneModificationKeyComponent(document.SharedModificationId))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToList();
        if (sharedModificationIds.Count == 1)
        {
            return sharedModificationIds[0];
        }

        var normalizedVariantIds = documents
            .SelectMany(document => document.Consumers)
            .Select(consumer => NormalizeStandaloneModificationKeyComponent(consumer.VariantId))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToList();
        var baseName = normalizedVariantIds.Count == 1
            ? normalizedVariantIds[0]
            : "sharedmod";
        return $"{baseName}-{fingerprint[..12]}";
    }

    private static void MergeConsumers(
        List<FoxWatchRenderSceneConsumer> target,
        IReadOnlyList<FoxWatchRenderSceneConsumer> additions)
    {
        foreach (var consumer in additions)
        {
            if (target.Any(existing =>
                string.Equals(existing.StructureId, consumer.StructureId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(existing.SlotName, consumer.SlotName, StringComparison.OrdinalIgnoreCase)
                && string.Equals(existing.DataClassPath, consumer.DataClassPath, StringComparison.OrdinalIgnoreCase)
                && string.Equals(existing.VariantId, consumer.VariantId, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            target.Add(new FoxWatchRenderSceneConsumer
            {
                StructureId = consumer.StructureId,
                SlotName = consumer.SlotName,
                DataClassPath = consumer.DataClassPath,
                VariantId = consumer.VariantId,
            });
        }
    }

    private async Task<FoxWatchRenderSceneDocument> CreateDocumentAsync(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction? blueprintScene,
        string outputKey,
        IReadOnlyList<string>? modes,
        bool includePoseVariants,
        bool? clipFloorOverride,
        CancellationToken cancellationToken,
        string? previewDirectionOverride = null,
        string? componentLayerId = null)
    {

        var roots = blueprintScene?.Roots.Count > 0
            ? blueprintScene.Roots
            : [
                new FoxWatchRenderSceneNode
                {
                    Id = $"{structure.Id}:root",
                    Name = structure.CodeName,
                },
            ];
        var meshAssetsById = (blueprintScene?.Meshes ?? [])
            .ToDictionary(asset => asset.Id, StringComparer.OrdinalIgnoreCase);
        await ApplyDefaultScenePosesAsync(structure, roots, meshAssetsById, cancellationToken);
        var poseVariants = includePoseVariants
            ? await TryApplyPoseVariantsAsync(structure, roots, meshAssetsById, cancellationToken)
            : null;
        var colorVariants = CreateColorVariants(structure);
        var referencedMeshIds = CollectReferencedMeshIds(roots);
        var prunedMeshAssets = (blueprintScene?.Meshes ?? [])
            .Where(mesh => referencedMeshIds.Contains(mesh.Id))
            .ToList();

        return new FoxWatchRenderSceneDocument
        {
            Structure = new FoxWatchRenderSceneStructure
            {
                Id = structure.Id,
                AssetType = GetAssetTypeName(structure),
                CodeName = structure.CodeName,
                Name = structure.Name.Fallback,
                CategoryId = structure.CategoryId,
                CategoryName = structure.CategoryName.Fallback,
            },
            Variants = poseVariants?.Count > 0
                ? poseVariants
                : blueprintScene?.Variants?.Count > 0
                ? blueprintScene.Variants
                : colorVariants?.Count > 0
                ? colorVariants
                : null,
            Render = new FoxWatchRenderSceneRenderSettings
            {
                OutputKey = outputKey,
                Modes = modes == null ? null : [.. modes],
                PreviewDirection = GetPreviewDirection(structure, previewDirectionOverride),
                GenerateDefaultIcon = structure.GenerateDefaultIcon == true ? true : null,
                ClipFloor = clipFloorOverride ?? GetClipFloor(structure),
                FloorZ = GetFloorZ(structure),
                ClipBounds = GetClipBoundsForRenderLayer(structure, componentLayerId),
                TopdownPaddingFactor = GetTopdownPaddingFactor(structure),
                TopdownPaddingMeters = GetTopdownPaddingMeters(structure),
                MaterialMode = blueprintScene?.Meshes.Count > 0 ? "sidecar" : null,
            },
            Scene = new FoxWatchRenderSceneGraph
            {
                Roots = roots,
            },
            Assets = new FoxWatchRenderSceneAssets
            {
                Meshes = prunedMeshAssets,
            },
        };
    }

    private static HashSet<string> CollectReferencedMeshIds(IEnumerable<FoxWatchRenderSceneNode> roots)
    {
        var meshIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var root in roots)
        {
            CollectReferencedMeshIds(root, meshIds);
        }

        return meshIds;
    }

    private static void CollectReferencedMeshIds(FoxWatchRenderSceneNode node, ISet<string> meshIds)
    {
        if (!string.IsNullOrWhiteSpace(node.MeshId))
        {
            meshIds.Add(node.MeshId);
        }

        foreach (var child in node.Children)
        {
            CollectReferencedMeshIds(child, meshIds);
        }
    }

    private FoxWatchBlueprintSceneExtraction? CollapseBlueprintSceneVariants(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction? blueprintScene,
        IReadOnlySet<string>? requestedVariantIds = null)
    {
        if (blueprintScene?.Variants == null || blueprintScene.Variants.Count == 0)
        {
            return blueprintScene;
        }

        var resolvedVariantIds = requestedVariantIds ?? ResolveRequestedVariantIds(structure, blueprintScene);
        if (resolvedVariantIds.Count == 0)
        {
            return blueprintScene;
        }

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = FilterNodesForVariant(blueprintScene.Roots, resolvedVariantIds),
            Meshes = CloneMeshAssets(blueprintScene.Meshes),
            Variants = null,
        };
    }

    private static FoxWatchBlueprintSceneExtraction? PrepareBlueprintSceneForBaseRender(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction? blueprintScene)
    {
        if (blueprintScene == null)
        {
            return null;
        }

        if (string.Equals(structure.Id, "facilitypipeoverhead", StringComparison.OrdinalIgnoreCase))
        {
            var preparedRoots = AdjustOverheadPipePreviewNodes(
                structure,
                FilterNodesForTopdownStructurePreview(structure, blueprintScene.Roots));
            preparedRoots = AdjustTelescopingSpanPreviewNodes(
                structure,
                preparedRoots,
                ["PipelineoverheadConnect", "PipelineSegment01"]);
            EnsureFacilityPipeOverheadCompositeSpan(structure, preparedRoots);

            return new FoxWatchBlueprintSceneExtraction
            {
                Roots = preparedRoots,
                Meshes = EnsureFacilityPipeOverheadCompositeMeshes(blueprintScene.Meshes),
                Variants = blueprintScene.Variants,
            };
        }

        if (IsFieldBridgeOrPierStructure(structure))
        {
            var spanNodeNames = string.Equals(structure.Id, "fieldpier", StringComparison.OrdinalIgnoreCase)
                ? new[] { "FieldPier" }
                : new[] { "FieldBridge01" };
            var preparedRoots = AdjustTelescopingSpanPreviewNodes(
                structure,
                FilterNodesForTopdownStructurePreview(structure, blueprintScene.Roots),
                spanNodeNames);

            return new FoxWatchBlueprintSceneExtraction
            {
                Roots = preparedRoots,
                Meshes = CloneMeshAssets(blueprintScene.Meshes),
                Variants = blueprintScene.Variants,
            };
        }

        if (string.Equals(structure.Id, "facilitypipeunderground", StringComparison.OrdinalIgnoreCase))
        {
            var preparedRoots = FilterNodesExcludingNormalizedNames(
                FilterNodesForTopdownStructurePreview(structure, blueprintScene.Roots),
                ["FrontMesh"]);

            return new FoxWatchBlueprintSceneExtraction
            {
                Roots = preparedRoots,
                Meshes = CloneMeshAssets(blueprintScene.Meshes),
                Variants = blueprintScene.Variants,
            };
        }

        return blueprintScene;
    }

    private static readonly string[] RailTrackSplineSwitchNodeNames = ["BackSwitchMesh", "FrontSwitchMesh"];

    private static FoxWatchBlueprintSceneExtraction? PrepareRailTrackSplineSceneForPreview(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction? blueprintScene)
    {
        if (blueprintScene == null)
        {
            return null;
        }

        var preparedRoots = FilterNodesExcludingNormalizedNames(
            FilterNodesForTopdownStructurePreview(structure, blueprintScene.Roots),
            RailTrackSplineSwitchNodeNames);

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = preparedRoots,
            Meshes = CloneMeshAssets(blueprintScene.Meshes),
            Variants = blueprintScene.Variants,
        };
    }

    private static FoxWatchBlueprintSceneExtraction? PrepareFacilityCatwalkBridgeScene(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction? blueprintScene,
        bool shortenSpanForPreview)
    {
        if (blueprintScene == null)
        {
            return null;
        }

        var preparedRoots = FilterNodesForTopdownStructurePreview(
            structure,
            FilterNodesExcludingNormalizedNames(
                blueprintScene.Roots,
                ["BackSupport", "FrontSupport"]));

        if (shortenSpanForPreview)
        {
            var forceSpanLengthCm = ResolveConnectorPreviewSpanLengthCm(structure);
            preparedRoots = AdjustTelescopingSpanPreviewNodes(
                structure,
                preparedRoots,
                ["facilitieCatwalkPlatfrom"],
                forceSpanLengthCm: forceSpanLengthCm);
            if (TryResolveTelescopingSpanMetrics(structure, preparedRoots, out var spanMetrics, forceSpanLengthCm))
            {
                preparedRoots = TrimFacilityCatwalkBridgePreviewToSpan(structure, preparedRoots, spanMetrics);
            }
        }

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = preparedRoots,
            Meshes = CloneMeshAssets(blueprintScene.Meshes),
            Variants = blueprintScene.Variants,
        };
    }

    private static double? ResolveConnectorPreviewSpanLengthCm(FoxWatchManifestStructure structure)
    {
        if (structure.Connector?.DefaultTargetUnrealLocationCm is { Count: >= 1 } defaultTarget
            && defaultTarget[0] > 0.001)
        {
            return defaultTarget[0];
        }

        return null;
    }

    private readonly record struct TelescopingSpanMetrics(double CenterX, double StartX, double ScaleX, double SpanLengthCm);

    private static FoxWatchManifestConnectorMeshConfig? ResolvePrimaryConnectorMeshConfig(FoxWatchManifestConnector? connector)
    {
        return connector?.MeshConfigs.FirstOrDefault(config =>
            (config.Mode ?? string.Empty).Contains("Spline", StringComparison.OrdinalIgnoreCase))
            ?? connector?.MeshConfigs.FirstOrDefault();
    }

    private static bool TryResolveTelescopingSpanMetrics(
        FoxWatchManifestStructure structure,
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        out TelescopingSpanMetrics metrics,
        double? forceSpanLengthCm = null)
    {
        metrics = default;
        var connector = structure.Connector;
        var frontSocketName = connector?.FrontSocketName ?? "FrontSocket";
        var backSocketName = connector?.BackSocketName ?? "BackSocket";
        var backSocketX = TryFindNodeUnrealLocationX(nodes, backSocketName)
            ?? TryFindBuildSocketLocationX(structure, backSocketName)
            ?? 0;
        double? frontSocketX = forceSpanLengthCm is > 0
            ? backSocketX + forceSpanLengthCm.Value
            : TryFindNodeUnrealLocationX(nodes, frontSocketName)
                ?? TryFindBuildSocketLocationX(structure, frontSocketName);
        if (frontSocketX == null && connector?.DefaultTargetUnrealLocationCm is { Count: >= 1 } defaultTarget)
        {
            frontSocketX = backSocketX + defaultTarget[0];
        }

        if (frontSocketX == null)
        {
            return false;
        }

        var meshConfig = ResolvePrimaryConnectorMeshConfig(connector);
        var nativeLength = meshConfig?.NativeMeshLengthCm ?? meshConfig?.Interval ?? 0;
        if (nativeLength <= 0.001)
        {
            return false;
        }

        var startOffset = Math.Max(0, meshConfig?.StartOffset ?? 0);
        var endOffset = Math.Max(0, meshConfig?.EndOffset ?? 0);
        var rawLength = Math.Max(0, frontSocketX.Value - backSocketX);
        if (rawLength <= 0.001)
        {
            return false;
        }

        var trimmedLength = Math.Max(0, rawLength - startOffset - endOffset);
        var spanLength = trimmedLength > 0.001 ? trimmedLength : nativeLength;
        var spanStartX = backSocketX + startOffset;
        var spanCenterX = trimmedLength > 0.001
            ? spanStartX + (spanLength * 0.5)
            : backSocketX + (rawLength * 0.5);

        metrics = new TelescopingSpanMetrics(spanCenterX, spanStartX, spanLength / nativeLength, spanLength);
        return true;
    }

    private static List<FoxWatchRenderSceneNode> TrimFacilityCatwalkBridgePreviewToSpan(
        FoxWatchManifestStructure structure,
        List<FoxWatchRenderSceneNode> nodes,
        TelescopingSpanMetrics metrics)
    {
        var spanEndX = metrics.StartX + metrics.SpanLengthCm;
        var railingSpanScale = metrics.SpanLengthCm / ResolveFacilityCatwalkBridgeNativeSpanCm(structure, nodes);
        return [.. nodes
            .Select(node => TrimFacilityCatwalkBridgePreviewSpanNode(node, structure, metrics, spanEndX, railingSpanScale))
            .Where(node => node != null)
            .Cast<FoxWatchRenderSceneNode>()];
    }

    private static FoxWatchRenderSceneNode? TrimFacilityCatwalkBridgePreviewSpanNode(
        FoxWatchRenderSceneNode node,
        FoxWatchManifestStructure structure,
        TelescopingSpanMetrics metrics,
        double spanEndX,
        double railingSpanScale)
    {
        var normalizedNodeName = NormalizeRenderSceneNodeName(node.Name);
        List<double>? unrealLocationCentimeters = node.UnrealLocationCentimeters == null
            ? null
            : [.. node.UnrealLocationCentimeters];
        List<double>? scale = node.Scale == null ? null : [.. node.Scale];
        if (string.Equals(normalizedNodeName, "facilitieCatwalkXBar", StringComparison.OrdinalIgnoreCase))
        {
            var crossbeamX = unrealLocationCentimeters?.FirstOrDefault() ?? 0;
            var halfLength = ResolveCatwalkCrossbeamHalfLengthCm(node);
            var backEdge = crossbeamX - halfLength;
            var frontEdge = crossbeamX + halfLength;
            if (frontEdge <= metrics.StartX + 0.5 || backEdge >= spanEndX - 0.5)
            {
                return null;
            }

            if (frontEdge > spanEndX + 0.5)
            {
                var clippedBack = Math.Max(backEdge, metrics.StartX);
                var clippedLength = spanEndX - clippedBack;
                if (clippedLength <= 0.5)
                {
                    return null;
                }

                var newHalfLength = clippedLength * 0.5;
                var scaleFactor = newHalfLength / halfLength;
                if (unrealLocationCentimeters is { Count: > 0 })
                {
                    unrealLocationCentimeters[0] = clippedBack + newHalfLength;
                }

                if (scale is { Count: > 0 })
                {
                    scale[0] *= scaleFactor;
                }
                else
                {
                    scale = [scaleFactor, 1.0, 1.0];
                }
            }
        }
        else if (IsFacilityCatwalkBridgeRailingNode(normalizedNodeName) && unrealLocationCentimeters is { Count: > 0 })
        {
            unrealLocationCentimeters[0] = metrics.CenterX;
            if (scale is { Count: > 0 })
            {
                for (var index = 0; index < scale.Count; index++)
                {
                    scale[index] *= railingSpanScale;
                }
            }
            else
            {
                scale = [railingSpanScale, railingSpanScale, railingSpanScale];
            }
        }
        else if (IsFacilityCatwalkBridgeCornerNode(normalizedNodeName) && unrealLocationCentimeters is { Count: > 0 })
        {
            unrealLocationCentimeters[0] = normalizedNodeName.StartsWith("Front", StringComparison.OrdinalIgnoreCase)
                ? spanEndX
                : metrics.StartX;
        }

        var filteredChildren = node.Children
            .Select(child => TrimFacilityCatwalkBridgePreviewSpanNode(child, structure, metrics, spanEndX, railingSpanScale))
            .Where(child => child != null)
            .Cast<FoxWatchRenderSceneNode>()
            .ToList();

        return new FoxWatchRenderSceneNode
        {
            Id = node.Id,
            Name = node.Name,
            Visible = node.Visible,
            VariantIds = node.VariantIds == null ? null : [.. node.VariantIds],
            MeshId = node.MeshId,
            Primitive = ClonePrimitive(node.Primitive),
            MaterialIds = [.. node.MaterialIds],
            Location = node.Location == null ? null : [.. node.Location],
            RotationEulerDegrees = node.RotationEulerDegrees == null ? null : [.. node.RotationEulerDegrees],
            Scale = scale,
            UnrealLocationCentimeters = unrealLocationCentimeters,
            UnrealSceneLocationCentimeters = node.UnrealSceneLocationCentimeters == null ? null : [.. node.UnrealSceneLocationCentimeters],
            UnrealRotationDegrees = node.UnrealRotationDegrees == null ? null : [.. node.UnrealRotationDegrees],
            DebugColor = node.DebugColor == null ? null : [.. node.DebugColor],
            MarkerColor = node.MarkerColor == null ? null : [.. node.MarkerColor],
            MarkerSize = node.MarkerSize,
            Pose = ClonePose(node.Pose),
            PoseVariants = ClonePoseVariants(node.PoseVariants),
            AttachBoneName = node.AttachBoneName,
            TransformMatrix = [.. node.TransformMatrix],
            Children = filteredChildren,
        };
    }

    private static double ResolveFacilityCatwalkBridgeNativeSpanCm(
        FoxWatchManifestStructure structure,
        IEnumerable<FoxWatchRenderSceneNode> nodes)
    {
        var backSocketX = TryFindNodeUnrealLocationX(nodes, "BackSocket")
            ?? TryFindBuildSocketLocationX(structure, "BackSocket")
            ?? 0;
        var frontSocketX = TryFindNodeUnrealLocationX(nodes, "FrontSocket")
            ?? TryFindBuildSocketLocationX(structure, "FrontSocket");
        if (frontSocketX.HasValue && frontSocketX.Value > backSocketX + 0.001)
        {
            return frontSocketX.Value - backSocketX;
        }

        var meshConfig = ResolvePrimaryConnectorMeshConfig(structure.Connector);
        return meshConfig?.NativeMeshLengthCm ?? FacilityCatwalkDeckNativeLengthCm;
    }

    private static double ResolveCatwalkCrossbeamHalfLengthCm(FoxWatchRenderSceneNode node)
    {
        var scaleX = node.Scale is { Count: > 0 } ? node.Scale[0] : FacilityCatwalkDeckMeshScale;
        return FacilityCatwalkCrossbeamNativeLengthCm * scaleX * 0.5;
    }

    private static bool IsFacilityCatwalkBridgeRailingNode(string normalizedNodeName)
    {
        return string.Equals(normalizedNodeName, "FrontRailing", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalizedNodeName, "BackRailing", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsFacilityCatwalkBridgeCornerNode(string normalizedNodeName)
    {
        return normalizedNodeName.EndsWith("Corner", StringComparison.OrdinalIgnoreCase);
    }

    private static double? TryFindBuildSocketLocationX(FoxWatchManifestStructure structure, string socketName)
    {
        if (string.IsNullOrWhiteSpace(socketName))
        {
            return null;
        }

        var socket = structure.BuildSockets.FirstOrDefault(candidate =>
            string.Equals(candidate.Name, socketName, StringComparison.OrdinalIgnoreCase));
        return socket?.X;
    }

    private static List<FoxWatchRenderSceneNode> AdjustTelescopingSpanPreviewNodes(
        FoxWatchManifestStructure structure,
        List<FoxWatchRenderSceneNode> nodes,
        IReadOnlyList<string> spanNodeNames,
        double? forceSpanLengthCm = null)
    {
        if (!TryResolveTelescopingSpanMetrics(structure, nodes, out var metrics, forceSpanLengthCm))
        {
            return nodes;
        }

        return [.. nodes.Select(node => AdjustTelescopingSpanPreviewNode(node, spanNodeNames, metrics))];
    }

    private static FoxWatchRenderSceneNode AdjustTelescopingSpanPreviewNode(
        FoxWatchRenderSceneNode node,
        IReadOnlyList<string> spanNodeNames,
        TelescopingSpanMetrics metrics)
    {
        var normalizedNodeName = NormalizeRenderSceneNodeName(node.Name);
        List<double>? unrealLocationCentimeters = node.UnrealLocationCentimeters == null
            ? null
            : [.. node.UnrealLocationCentimeters];
        List<double>? scale = node.Scale == null ? null : [.. node.Scale];
        if (spanNodeNames.Any(spanNodeName =>
                string.Equals(normalizedNodeName, spanNodeName, StringComparison.OrdinalIgnoreCase)) &&
            unrealLocationCentimeters is { Count: > 0 } location)
        {
            var placementX = Math.Abs(location[0]) < 1.0 ? metrics.StartX : metrics.CenterX;
            unrealLocationCentimeters[0] = placementX;
            if (scale is { Count: > 0 })
            {
                scale[0] = metrics.ScaleX;
            }
            else
            {
                scale = [metrics.ScaleX, 1.0, 1.0];
            }
        }

        return new FoxWatchRenderSceneNode
        {
            Id = node.Id,
            Name = node.Name,
            Visible = node.Visible,
            VariantIds = node.VariantIds == null ? null : [.. node.VariantIds],
            MeshId = node.MeshId,
            Primitive = ClonePrimitive(node.Primitive),
            MaterialIds = [.. node.MaterialIds],
            Location = node.Location == null ? null : [.. node.Location],
            RotationEulerDegrees = node.RotationEulerDegrees == null ? null : [.. node.RotationEulerDegrees],
            Scale = scale,
            UnrealLocationCentimeters = unrealLocationCentimeters,
            UnrealSceneLocationCentimeters = node.UnrealSceneLocationCentimeters == null ? null : [.. node.UnrealSceneLocationCentimeters],
            UnrealRotationDegrees = node.UnrealRotationDegrees == null ? null : [.. node.UnrealRotationDegrees],
            DebugColor = node.DebugColor == null ? null : [.. node.DebugColor],
            MarkerColor = node.MarkerColor == null ? null : [.. node.MarkerColor],
            MarkerSize = node.MarkerSize,
            Pose = ClonePose(node.Pose),
            PoseVariants = ClonePoseVariants(node.PoseVariants),
            AttachBoneName = node.AttachBoneName,
            TransformMatrix = [.. node.TransformMatrix],
            Children = [.. node.Children.Select(child => AdjustTelescopingSpanPreviewNode(child, spanNodeNames, metrics))],
        };
    }

    private static List<FoxWatchRenderSceneMeshAsset> EnsureFacilityPipeOverheadCompositeMeshes(
        IReadOnlyList<FoxWatchRenderSceneMeshAsset> meshes)
    {
        if (meshes.Any(mesh => string.Equals(mesh.Id, FacilityPipeOverheadSpanMeshId, StringComparison.OrdinalIgnoreCase)))
        {
            return CloneMeshAssets(meshes);
        }

        var nextMeshes = CloneMeshAssets(meshes);
        nextMeshes.Add(new FoxWatchRenderSceneMeshAsset
        {
            Id = FacilityPipeOverheadSpanMeshId,
            SourcePath = FacilityPipeOverheadSpanMeshSourcePath,
        });
        return nextMeshes;
    }

    private static void EnsureFacilityPipeOverheadCompositeSpan(
        FoxWatchManifestStructure structure,
        List<FoxWatchRenderSceneNode> roots)
    {
        if (!TryResolveTelescopingSpanMetrics(structure, roots, out var metrics))
        {
            return;
        }

        var splineConnector = FindRenderSceneNodeByName(roots, "SplineConnector");
        if (splineConnector == null || RenderSceneSubtreeContainsMesh(splineConnector))
        {
            return;
        }

        splineConnector.Children.Add(new FoxWatchRenderSceneNode
        {
            Id = $"{structure.Id}:composite:spline-span",
            Name = "PipelineoverheadConnect",
            MeshId = FacilityPipeOverheadSpanMeshId,
            Scale = [metrics.ScaleX, 1.0, 1.0],
            UnrealLocationCentimeters = [metrics.StartX, 0.0, 0.0],
            UnrealRotationDegrees = [0.0, 0.0, 0.0],
        });
    }

    private static FoxWatchRenderSceneNode? FindRenderSceneNodeByName(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string nodeName)
    {
        foreach (var node in nodes)
        {
            if (string.Equals(NormalizeRenderSceneNodeName(node.Name), nodeName, StringComparison.OrdinalIgnoreCase))
            {
                return node;
            }

            var descendant = FindRenderSceneNodeByName(node.Children, nodeName);
            if (descendant != null)
            {
                return descendant;
            }
        }

        return null;
    }

    private static bool RenderSceneSubtreeContainsMesh(FoxWatchRenderSceneNode node)
    {
        if (!string.IsNullOrWhiteSpace(node.MeshId))
        {
            return true;
        }

        return node.Children.Any(RenderSceneSubtreeContainsMesh);
    }

    private static List<FoxWatchRenderSceneNode> FilterNodesForTopdownStructurePreview(
        FoxWatchManifestStructure structure,
        IEnumerable<FoxWatchRenderSceneNode> nodes)
    {
        var filteredNodes = new List<FoxWatchRenderSceneNode>();
        foreach (var node in nodes)
        {
            if (ShouldExcludeFromTopdownStructurePreview(structure, node.Name))
            {
                continue;
            }

            var childNodes = FilterNodesForTopdownStructurePreview(structure, node.Children);
            filteredNodes.Add(new FoxWatchRenderSceneNode
            {
                Id = node.Id,
                Name = node.Name,
                Visible = node.Visible,
                VariantIds = node.VariantIds == null ? null : [.. node.VariantIds],
                MeshId = node.MeshId,
                Primitive = ClonePrimitive(node.Primitive),
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
                Pose = ClonePose(node.Pose),
                PoseVariants = ClonePoseVariants(node.PoseVariants),
                AttachBoneName = node.AttachBoneName,
                TransformMatrix = [.. node.TransformMatrix],
                Children = childNodes,
            });
        }

        return filteredNodes;
    }

    private static List<FoxWatchRenderSceneNode> FilterNodesExcludingNormalizedNames(
        List<FoxWatchRenderSceneNode> nodes,
        IReadOnlyList<string> excludedNormalizedNames)
    {
        var excludedNames = excludedNormalizedNames
            .Select(NormalizeRenderSceneNodeName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (excludedNames.Count == 0)
        {
            return nodes;
        }

        return FilterNodesExcludingNormalizedNames(nodes, excludedNames);
    }

    private static List<FoxWatchRenderSceneNode> FilterNodesExcludingNormalizedNames(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        ISet<string> excludedNormalizedNames)
    {
        var filteredNodes = new List<FoxWatchRenderSceneNode>();
        foreach (var node in nodes)
        {
            var normalizedNodeName = NormalizeRenderSceneNodeName(node.Name);
            if (!string.IsNullOrWhiteSpace(normalizedNodeName) &&
                excludedNormalizedNames.Contains(normalizedNodeName))
            {
                continue;
            }

            var childNodes = FilterNodesExcludingNormalizedNames(node.Children, excludedNormalizedNames);
            filteredNodes.Add(new FoxWatchRenderSceneNode
            {
                Id = node.Id,
                Name = node.Name,
                Visible = node.Visible,
                VariantIds = node.VariantIds == null ? null : [.. node.VariantIds],
                MeshId = node.MeshId,
                Primitive = ClonePrimitive(node.Primitive),
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
                Pose = ClonePose(node.Pose),
                PoseVariants = ClonePoseVariants(node.PoseVariants),
                AttachBoneName = node.AttachBoneName,
                TransformMatrix = [.. node.TransformMatrix],
                Children = childNodes,
            });
        }

        return filteredNodes;
    }

    private static bool ShouldExcludeFromTopdownStructurePreview(FoxWatchManifestStructure structure, string? nodeName)
    {
        if (!string.Equals(structure.Id, "facilitypipeoverhead", StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(nodeName))
        {
            return false;
        }

        var normalizedNodeName = NormalizeRenderSceneNodeName(nodeName);
        if (string.IsNullOrWhiteSpace(normalizedNodeName))
        {
            return false;
        }

        return normalizedNodeName.Contains("Connected", StringComparison.OrdinalIgnoreCase)
            || normalizedNodeName.Contains("Piller", StringComparison.OrdinalIgnoreCase)
            || normalizedNodeName.Contains("Pillar", StringComparison.OrdinalIgnoreCase);
    }

    private static List<FoxWatchRenderSceneNode> AdjustOverheadPipePreviewNodes(
        FoxWatchManifestStructure structure,
        List<FoxWatchRenderSceneNode> nodes)
    {
        if (!string.Equals(structure.Id, "facilitypipeoverhead", StringComparison.OrdinalIgnoreCase))
        {
            return nodes;
        }

        var frontSocketName = structure.Connector?.FrontSocketName ?? "FrontSocket";
        var frontSocketX = TryFindNodeUnrealLocationX(nodes, frontSocketName);
        if (frontSocketX == null)
        {
            return nodes;
        }

        var frontMeshOffsetX = ResolveConnectorComponentLocationX(structure.Connector, "FrontMesh")
            ?? -ResolveConnectorGroundedLength(structure.Connector);
        var frontMeshTargetX = frontSocketX.Value + frontMeshOffsetX;

        return [.. nodes.Select(node => AdjustOverheadPipePreviewNode(node, frontMeshTargetX))];
    }

    private static FoxWatchRenderSceneNode AdjustOverheadPipePreviewNode(
        FoxWatchRenderSceneNode node,
        double frontMeshTargetX)
    {
        var normalizedNodeName = NormalizeRenderSceneNodeName(node.Name);
        List<double>? unrealLocationCentimeters = node.UnrealLocationCentimeters == null
            ? null
            : [.. node.UnrealLocationCentimeters];
        if (string.Equals(normalizedNodeName, "FrontMesh", StringComparison.OrdinalIgnoreCase) &&
            unrealLocationCentimeters is { Count: > 0 })
        {
            unrealLocationCentimeters[0] = frontMeshTargetX;
        }

        return new FoxWatchRenderSceneNode
        {
            Id = node.Id,
            Name = node.Name,
            Visible = node.Visible,
            VariantIds = node.VariantIds == null ? null : [.. node.VariantIds],
            MeshId = node.MeshId,
            Primitive = ClonePrimitive(node.Primitive),
            MaterialIds = [.. node.MaterialIds],
            Location = node.Location == null ? null : [.. node.Location],
            RotationEulerDegrees = node.RotationEulerDegrees == null ? null : [.. node.RotationEulerDegrees],
            Scale = node.Scale == null ? null : [.. node.Scale],
            UnrealLocationCentimeters = unrealLocationCentimeters,
            UnrealSceneLocationCentimeters = node.UnrealSceneLocationCentimeters == null ? null : [.. node.UnrealSceneLocationCentimeters],
            UnrealRotationDegrees = node.UnrealRotationDegrees == null ? null : [.. node.UnrealRotationDegrees],
            DebugColor = node.DebugColor == null ? null : [.. node.DebugColor],
            MarkerColor = node.MarkerColor == null ? null : [.. node.MarkerColor],
            MarkerSize = node.MarkerSize,
            Pose = ClonePose(node.Pose),
            PoseVariants = ClonePoseVariants(node.PoseVariants),
            AttachBoneName = node.AttachBoneName,
            TransformMatrix = [.. node.TransformMatrix],
            Children = [.. node.Children.Select(child => AdjustOverheadPipePreviewNode(child, frontMeshTargetX))],
        };
    }

    private static double? TryFindNodeUnrealLocationX(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string nodeName)
    {
        foreach (var node in nodes)
        {
            var normalizedNodeName = NormalizeRenderSceneNodeName(node.Name);
            if (string.Equals(normalizedNodeName, nodeName, StringComparison.OrdinalIgnoreCase) &&
                node.UnrealLocationCentimeters is { Count: > 0 } location)
            {
                return location[0];
            }

            var childLocationX = TryFindNodeUnrealLocationX(node.Children, nodeName);
            if (childLocationX != null)
            {
                return childLocationX;
            }
        }

        return null;
    }

    private static double ResolveConnectorGroundedLength(FoxWatchManifestConnector? connector)
    {
        var meshConfig = ResolvePrimaryConnectorMeshConfig(connector);
        return Math.Max(0, meshConfig?.StartOffset ?? meshConfig?.EndOffset ?? 0);
    }

    private static double? ResolveConnectorComponentLocationX(
        FoxWatchManifestConnector? connector,
        string componentName)
    {
        var componentConfig = connector?.ComponentConfigs.FirstOrDefault(config =>
            string.Equals(config.ComponentName, componentName, StringComparison.OrdinalIgnoreCase));
        if (componentConfig?.RelativeLocation is not { Count: > 0 } relativeLocation)
        {
            return null;
        }

        return relativeLocation[0];
    }

    private static string NormalizeRenderSceneNodeName(string? nodeName)
    {
        if (string.IsNullOrWhiteSpace(nodeName))
        {
            return string.Empty;
        }

        var normalizedNodeName = nodeName;
        var separatorIndex = normalizedNodeName.LastIndexOf(':');
        if (separatorIndex >= 0 && separatorIndex + 1 < normalizedNodeName.Length)
        {
            normalizedNodeName = normalizedNodeName[(separatorIndex + 1)..];
        }

        return normalizedNodeName;
    }

    private FoxWatchBlueprintSceneExtraction? CollapseBlueprintSceneForBaseRender(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction? blueprintScene)
    {
        if (blueprintScene?.Variants == null || blueprintScene.Variants.Count == 0)
        {
            return blueprintScene;
        }

        var resolvedVariantIds = ResolveRequestedVariantIds(structure, blueprintScene);
        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = FilterNodesForVariant(blueprintScene.Roots, resolvedVariantIds),
            Meshes = CloneMeshAssets(blueprintScene.Meshes),
            Variants = null,
        };
    }

    private List<StandaloneModificationRenderTarget> GetStandaloneModificationRenderTargets(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction? blueprintScene)
    {
        if (!string.IsNullOrWhiteSpace(structure.ParentStructureId) ||
            !string.IsNullOrWhiteSpace(structure.AppliedModificationId) ||
            blueprintScene?.Variants == null ||
            blueprintScene.Variants.Count == 0)
        {
            return [];
        }

        var availableVariantIds = blueprintScene.Variants
            .Where(variant => !variant.IsDefault)
            .Select(variant => variant.Id?.Trim())
            .Where(variantId => !string.IsNullOrWhiteSpace(variantId))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var targetsByRenderId = new Dictionary<string, StandaloneModificationRenderTarget>(StringComparer.OrdinalIgnoreCase);

        foreach (var slot in structure.ModificationSlots ?? [])
        {
            if (string.IsNullOrWhiteSpace(slot.Name))
            {
                continue;
            }

            foreach (var entry in slot.Variants ?? [])
            {
                if (string.IsNullOrWhiteSpace(entry.Key))
                {
                    continue;
                }

                var variantId = entry.Key.Trim();
                if (!availableVariantIds.Contains(variantId))
                {
                    continue;
                }

                var isUpgrade = IsUpgradeModificationVariant(structure, variantId);
                var previewDirection = ResolveModificationPreviewDirection(entry.Value, structure);
                var renderId = ResolveModificationRenderId(
                    structure,
                    slot,
                    slot.Name.Trim(),
                    variantId,
                    entry.Value,
                    previewDirection);
                var normalizedRenderId = NormalizeStandaloneModificationKeyComponent(renderId);
                if (!targetsByRenderId.TryGetValue(normalizedRenderId, out var target))
                {
                    target = new StandaloneModificationRenderTarget
                    {
                        VariantId = variantId,
                        SlotName = slot.Name.Trim(),
                        DataClassPath = slot.DataClassPath,
                        OutputKey = normalizedRenderId,
                        IsUpgrade = isUpgrade,
                        RenderId = renderId,
                        SharedModificationId = renderId,
                        PreviewDirection = previewDirection,
                    };
                    targetsByRenderId[normalizedRenderId] = target;
                }

                target.Consumers.Add(new FoxWatchRenderSceneConsumer
                {
                    StructureId = structure.Id,
                    SlotName = slot.Name.Trim(),
                    DataClassPath = slot.DataClassPath,
                    VariantId = variantId,
                });
            }
        }

        foreach (var target in targetsByRenderId.Values)
        {
            if (target.Consumers.Count > 1)
            {
                target.SlotName = string.Empty;
            }
        }

        return [.. targetsByRenderId.Values];
    }

    private string ResolveModificationRenderId(
        FoxWatchManifestStructure structure,
        FoxWatchManifestModificationSlot slot,
        string slotName,
        string variantId,
        FoxWatchManifestModificationSlotVariant variant,
        string previewDirection)
    {
        if (!string.IsNullOrWhiteSpace(variant.RenderId))
        {
            return variant.RenderId.Trim();
        }

        return CreateRenderIdWithDiagnostics(structure, slot, slotName, variantId, variant, previewDirection);
    }

    private string CreateRenderIdWithDiagnostics(
        FoxWatchManifestStructure structure,
        FoxWatchManifestModificationSlot slot,
        string slotName,
        string variantId,
        FoxWatchManifestModificationSlotVariant? variant,
        string previewDirection)
    {
        var computation = FoxWatchModificationRenderIdentity.ComputeRenderIdWithDiagnostics(
            variantId,
            slot.DataClassPath,
            variant);
        _sharedModificationHashDiagnostics.Add(new SharedModificationHashDiagnosticEntry
        {
            StructureId = structure.Id,
            StructureCodeName = structure.CodeName,
            StructureName = structure.Name?.Fallback,
            SlotName = slotName,
            VariantId = variantId,
            RawPreviewDirection = variant?.PreviewDirection,
            ResolvedPreviewDirection = previewDirection,
            GeneratedSharedModificationId = computation.RenderId,
            GeneratedRenderId = computation.RenderId,
            NormalizedVariantId = computation.NormalizedVariantId,
            Identity = computation.Identity,
            FullHashHex = computation.FullHashHex,
            TruncatedHashHex = computation.TruncatedHashHex,
            Inputs = new SharedModificationHashDiagnosticInputs
            {
                VariantId = CreateSharedModificationHashDiagnosticInput(variantId),
                DataClassPath = CreateSharedModificationHashDiagnosticInput(slot.DataClassPath),
                TemplateActorPath = CreateSharedModificationHashDiagnosticInput(variant?.TemplateActorPath),
                TemplateMeshPath = CreateSharedModificationHashDiagnosticInput(variant?.TemplateMeshPath),
                PreviewMeshPath = CreateSharedModificationHashDiagnosticInput(variant?.PreviewMeshPath),
                Name = CreateSharedModificationHashDiagnosticInput(variant?.Name),
                Description = CreateSharedModificationHashDiagnosticInput(variant?.Description),
                PreviewDirection = CreateSharedModificationHashDiagnosticInput(previewDirection),
            },
        });

        return computation.RenderId;
    }

    private static bool IsUpgradeModificationVariant(FoxWatchManifestStructure structure, string variantId)
    {
        if (string.IsNullOrWhiteSpace(variantId) || structure.Modifications.Count == 0)
        {
            return false;
        }

        var normalizedVariantId = NormalizeStandaloneModificationKeyComponent(variantId);
        foreach (var modificationEntry in structure.Modifications)
        {
            var normalizedModificationId = NormalizeStandaloneModificationKeyComponent(
                string.IsNullOrWhiteSpace(modificationEntry.Value.AppliedModificationId)
                    ? modificationEntry.Key
                    : modificationEntry.Value.AppliedModificationId);
            if (string.Equals(normalizedModificationId, normalizedVariantId, StringComparison.OrdinalIgnoreCase))
            {
                return modificationEntry.Value.IsUpgrade;
            }
        }

        return false;
    }

    private static FoxWatchBlueprintSceneExtraction? CreateTopdownModificationScene(
        FoxWatchBlueprintSceneExtraction? blueprintScene,
        string structureId,
        string variantId,
        string? slotName = null)
    {
        if (blueprintScene == null || string.IsNullOrWhiteSpace(structureId) || string.IsNullOrWhiteSpace(variantId))
        {
            return null;
        }

        var variantNodeIdPrefix = $"{structureId}:upgrade:{variantId}:";
        var filteredRoots = ExtractTopdownModificationVariantRoots(blueprintScene.Roots, slotName, variantNodeIdPrefix);
        ApplyStandaloneModificationSlotYawOffset(filteredRoots, -90f);

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = filteredRoots,
            Meshes = CloneMeshAssets(blueprintScene.Meshes),
            Variants = null,
        };
    }

    private static List<FoxWatchRenderSceneNode> ExtractTopdownModificationVariantRoots(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string? slotName,
        string variantNodeIdPrefix)
    {
        if (!string.IsNullOrWhiteSpace(slotName))
        {
            var slotVariantRoots = FindTopdownModificationVariantRootsForSlot(nodes, slotName, variantNodeIdPrefix);
            if (slotVariantRoots.Count > 0)
            {
                return slotVariantRoots;
            }
        }

        return FilterNodesForTopdownModification(nodes, variantNodeIdPrefix);
    }

    private static List<FoxWatchRenderSceneNode> FindTopdownModificationVariantRootsForSlot(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string slotName,
        string variantNodeIdPrefix)
    {
        var normalizedSlotName = NormalizeStandaloneModificationKeyComponent(slotName);
        foreach (var node in nodes)
        {
            if (IsTopdownModificationSlotNode(node, normalizedSlotName))
            {
                var matchedVariantRoots = FindTopdownModificationVariantRoots(node.Children, variantNodeIdPrefix);
                if (matchedVariantRoots.Count > 0)
                {
                    return matchedVariantRoots;
                }
            }

            var childMatch = FindTopdownModificationVariantRootsForSlot(node.Children, slotName, variantNodeIdPrefix);
            if (childMatch.Count > 0)
            {
                return childMatch;
            }
        }

        return [];
    }

    private static bool IsTopdownModificationSlotNode(FoxWatchRenderSceneNode node, string normalizedSlotName)
    {
        if (string.IsNullOrWhiteSpace(normalizedSlotName))
        {
            return false;
        }

        return NormalizeStandaloneModificationKeyComponent(node.Name).Contains(normalizedSlotName, StringComparison.OrdinalIgnoreCase)
            || NormalizeStandaloneModificationKeyComponent(node.Id).Contains(normalizedSlotName, StringComparison.OrdinalIgnoreCase);
    }

    private static List<FoxWatchRenderSceneNode> FindTopdownModificationVariantRoots(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string variantNodeIdPrefix)
    {
        foreach (var node in nodes)
        {
            if (node.Id.StartsWith(variantNodeIdPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return CloneNodes([node]);
            }

            var childMatch = FindTopdownModificationVariantRoots(node.Children, variantNodeIdPrefix);
            if (childMatch.Count > 0)
            {
                return childMatch;
            }
        }

        return [];
    }

    private static IReadOnlyList<string> GetStandaloneStructureRenderLayerIds(FoxWatchManifestStructure structure)
    {
        if (!string.IsNullOrWhiteSpace(structure.ParentStructureId) ||
            !string.IsNullOrWhiteSpace(structure.AppliedModificationId))
        {
            return [];
        }

        if (IsStandaloneDestroyedOrBreachedStructure(structure))
        {
            return [];
        }

        if (string.Equals(structure.ProfileType, "Trench", StringComparison.OrdinalIgnoreCase))
        {
            return structure.RenderLayers?.Count > 0 && HasTrenchComponentRenderLayers(structure)
                ? [.. structure.RenderLayers.Select(layer => layer.Id)]
                : ["floor", "walls", "corners"];
        }

        if (IsFacilityFoundationStructure(structure))
        {
            return structure.RenderLayers?.Count > 0
                ? [.. structure.RenderLayers.Select(layer => layer.Id)]
                : [];
        }

        if (IsFortEntrenchmentStructure(structure))
        {
            return structure.RenderLayers?.Count > 0
                ? [.. structure.RenderLayers.Select(layer => layer.Id)]
                : [];
        }

        if (string.Equals(structure.Id, "facilitypipe", StringComparison.OrdinalIgnoreCase))
        {
            return ["backtrim", "span", "fronttrim"];
        }

        if (string.Equals(structure.Id, "facilitypipeunderground", StringComparison.OrdinalIgnoreCase))
        {
            return ["backtrim", "fronttrim"];
        }

        if (string.Equals(structure.Id, "facilitypipeoverhead", StringComparison.OrdinalIgnoreCase))
        {
            return ["backtrim", "span", "fronttrim"];
        }

        if (IsFieldBridgeOrPierStructure(structure))
        {
            return ["backtrim", "backramp", "span", "frontramp", "fronttrim"];
        }

        if (IsFacilityCatwalkBridgeStructure(structure))
        {
            return ["backtrim", "span", "fronttrim"];
        }

        if (IsTankStopSplineStructure(structure) || IsMineSplineStructure(structure) || IsIntervalMarkerSplineStructure(structure))
        {
            return ["span", "spanalt"];
        }

        if (IsTrimSpanConnectorStructure(structure))
        {
            return ["backtrim", "span", "fronttrim"];
        }

        if (IsFacilityRoadStructure(structure))
        {
            return ["span"];
        }

        if (IsCraneRailTrackSplineStructure(structure))
        {
            return ["span"];
        }

        if (IsRailTrackSplineStructure(structure))
        {
            return IsRailTrackSplineFoundationStructure(structure)
                ? ["backswitch", "span", "frontswitch"]
                : ["backswitch", "underlay", "span", "frontswitch"];
        }

        return [];
    }

    private static bool? GetClipFloorOverrideForRenderLayer(FoxWatchManifestStructure structure, string layerId)
    {
        if (string.Equals(layerId, "floor", StringComparison.OrdinalIgnoreCase)
            || string.Equals(layerId, "underlay", StringComparison.OrdinalIgnoreCase))
        {
            return IsEntrenchmentStructureForFloorClipping(structure)
                ? null
                : false;
        }

        if (IsCraneRailTrackSplineStructure(structure)
            && string.Equals(layerId, "span", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return null;
    }

    private static bool IsEntrenchmentStructureForFloorClipping(FoxWatchManifestStructure structure)
    {
        if (IsStandaloneDestroyedOrBreachedStructure(structure))
        {
            return false;
        }

        return IsTrenchStructureWithComponentLayers(structure) || IsFortEntrenchmentStructure(structure);
    }

    private static bool IsStandaloneDestroyedOrBreachedStructure(FoxWatchManifestStructure structure)
    {
        if (structure.IsDestroyed == true || structure.IsBreached == true)
        {
            return true;
        }

        var structureId = structure.Id ?? string.Empty;
        return string.Equals(structure.ProfileType, "DestroyedFort", StringComparison.OrdinalIgnoreCase)
            || string.Equals(structure.ProfileType, "DestroyedStructure", StringComparison.OrdinalIgnoreCase)
            || structureId.Contains("destroyed", StringComparison.OrdinalIgnoreCase)
            || structureId.Contains("breached", StringComparison.OrdinalIgnoreCase);
    }

    private static FoxWatchBounds3D? GetClipBoundsForRenderLayer(
        FoxWatchManifestStructure structure,
        string? layerId)
    {
        var authoredClipBounds = GetClipBounds(structure);
        if (authoredClipBounds != null)
        {
            return authoredClipBounds;
        }

        if (!string.Equals(layerId, "floor", StringComparison.OrdinalIgnoreCase)
            || !IsEntrenchmentStructureForFloorClipping(structure))
        {
            return null;
        }

        return TryDeriveEntrenchmentFloorClipBoundsFromFootprint(structure);
    }

    private static FoxWatchBounds3D? TryDeriveEntrenchmentFloorClipBoundsFromFootprint(
        FoxWatchManifestStructure structure)
    {
        if (TryGetSmallestFootprintAxisAlignedBounds(structure.FootprintPolygons, out var minX, out var minY, out var maxX, out var maxY))
        {
            return CreateEntrenchmentFloorClipBounds(minX, minY, maxX, maxY);
        }

        if (string.Equals(structure.ProfileType, "Trench", StringComparison.OrdinalIgnoreCase))
        {
            // Trench interior pit is roughly 11m x 4m (long axis x short axis).
            return CreateEntrenchmentFloorClipBounds(-5.5, -2.0, 5.5, 2.0);
        }

        if (IsFortEntrenchmentStructure(structure))
        {
            // Fort interior pit is roughly 4.5m x 4.5m inside the 5m x 5m shell.
            return CreateEntrenchmentFloorClipBounds(-2.25, -2.25, 2.25, 2.25);
        }

        return null;
    }

    private static bool TryGetSmallestFootprintAxisAlignedBounds(
        IReadOnlyList<FoxWatchManifestHitPolygon>? footprintPolygons,
        out double minX,
        out double minY,
        out double maxX,
        out double maxY)
    {
        minX = 0;
        minY = 0;
        maxX = 0;
        maxY = 0;

        if (footprintPolygons == null || footprintPolygons.Count == 0)
        {
            return false;
        }

        var bestArea = double.PositiveInfinity;
        var found = false;

        foreach (var footprintPolygon in footprintPolygons)
        {
            if (!TryGetHitPolygonAxisAlignedBounds(footprintPolygon, out var polygonMinX, out var polygonMinY, out var polygonMaxX, out var polygonMaxY))
            {
                continue;
            }

            var area = (polygonMaxX - polygonMinX) * (polygonMaxY - polygonMinY);
            if (area >= bestArea)
            {
                continue;
            }

            bestArea = area;
            minX = polygonMinX;
            minY = polygonMinY;
            maxX = polygonMaxX;
            maxY = polygonMaxY;
            found = true;
        }

        return found;
    }

    private static bool TryGetHitPolygonAxisAlignedBounds(
        FoxWatchManifestHitPolygon footprintPolygon,
        out double minX,
        out double minY,
        out double maxX,
        out double maxY)
    {
        minX = 0;
        minY = 0;
        maxX = 0;
        maxY = 0;

        var shape = footprintPolygon.Shape;
        if (shape == null || shape.Count < 6)
        {
            return false;
        }

        minX = double.PositiveInfinity;
        minY = double.PositiveInfinity;
        maxX = double.NegativeInfinity;
        maxY = double.NegativeInfinity;

        for (var index = 0; index + 1 < shape.Count; index += 2)
        {
            var x = shape[index];
            var y = shape[index + 1];
            minX = Math.Min(minX, x);
            minY = Math.Min(minY, y);
            maxX = Math.Max(maxX, x);
            maxY = Math.Max(maxY, y);
        }

        return minX <= maxX && minY <= maxY;
    }

    private static FoxWatchBounds3D CreateEntrenchmentFloorClipBounds(
        double minX,
        double minY,
        double maxX,
        double maxY)
    {
        return new FoxWatchBounds3D
        {
            Min = [minX, minY, -5.0],
            Max = [maxX, maxY, 5.0],
        };
    }

    private static bool HasTrenchComponentRenderLayers(FoxWatchManifestStructure structure)
    {
        return structure.RenderLayers?.Any(layer => !string.IsNullOrWhiteSpace(layer.ComponentName)) == true;
    }

    private static bool IsTrenchStructureWithComponentLayers(FoxWatchManifestStructure structure)
    {
        return string.Equals(structure.ProfileType, "Trench", StringComparison.OrdinalIgnoreCase)
            && HasTrenchComponentRenderLayers(structure);
    }

    private static bool IsFacilityFoundationStructure(FoxWatchManifestStructure structure)
    {
        var structureId = structure.Id ?? string.Empty;
        return structureId.StartsWith("foundation", StringComparison.OrdinalIgnoreCase) &&
            !structureId.Contains("railtracksplinefoundation", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsFortEntrenchmentStructure(FoxWatchManifestStructure structure)
    {
        if (string.Equals(structure.ProfileType, "Trench", StringComparison.OrdinalIgnoreCase) ||
            IsFacilityFoundationStructure(structure) ||
            structure.RenderLayers == null ||
            structure.RenderLayers.Count == 0)
        {
            return false;
        }

        return UsesFortEntrenchmentProfileType(structure.ProfileType)
            || structure.RenderLayers.Any(layer => layer.ComponentTags.Count > 0);
    }

    private static bool UsesFortEntrenchmentProfileType(string? profileType)
    {
        return string.Equals(profileType, "FortBase", StringComparison.OrdinalIgnoreCase)
            || string.Equals(profileType, "Fort", StringComparison.OrdinalIgnoreCase)
            || string.Equals(profileType, "FortRotatableUpgrade", StringComparison.OrdinalIgnoreCase)
            || string.Equals(profileType, "FortForwardBase", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsFacilityRoadStructure(FoxWatchManifestStructure structure)
    {
        return string.Equals(structure.Id, "facilityroad", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsFieldBridgeOrPierStructure(FoxWatchManifestStructure structure)
    {
        var id = structure.Id ?? string.Empty;
        return string.Equals(id, "fieldbridge", StringComparison.OrdinalIgnoreCase)
            || string.Equals(id, "fieldpier", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsFacilityCatwalkBridgeStructure(FoxWatchManifestStructure structure)
    {
        return string.Equals(structure.Id, "facilitycatwalkbridge", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsTankStopSplineStructure(FoxWatchManifestStructure structure)
    {
        return (structure.Id ?? string.Empty).StartsWith("tankstopspline", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsMineSplineStructure(FoxWatchManifestStructure structure)
    {
        var id = structure.Id ?? string.Empty;
        return string.Equals(id, "minespline", StringComparison.OrdinalIgnoreCase)
            || string.Equals(id, "infantryminespline", StringComparison.OrdinalIgnoreCase)
            || string.Equals(id, "waterminespline", StringComparison.OrdinalIgnoreCase)
            || string.Equals(id, "surfacewaterminespline", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsIntervalMarkerSplineStructure(FoxWatchManifestStructure structure)
    {
        if (!string.Equals(structure.Connector?.PathStyle, "interval", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var meshConfigs = structure.Connector?.MeshConfigs;
        if (meshConfigs == null || meshConfigs.Count == 0)
        {
            return false;
        }

        return !meshConfigs.Any(config =>
            (config.Mode ?? string.Empty).Contains("Spline", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsTrimSpanConnectorStructure(FoxWatchManifestStructure structure)
    {
        var id = structure.Id ?? string.Empty;
        return IsFieldBridgeOrPierStructure(structure)
            || IsFacilityCatwalkBridgeStructure(structure)
            || string.Equals(id, "barbedwirespline", StringComparison.OrdinalIgnoreCase)
            || id.StartsWith("wallspline", StringComparison.OrdinalIgnoreCase)
            || id.StartsWith("waterwallspline", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsCraneRailTrackSplineStructure(FoxWatchManifestStructure structure)
    {
        var id = structure.Id ?? string.Empty;
        var codeName = structure.CodeName ?? string.Empty;
        return id.Contains("cranerail", StringComparison.OrdinalIgnoreCase)
            || codeName.Contains("CraneRail", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsRailTrackSplineFoundationStructure(FoxWatchManifestStructure structure)
    {
        var id = structure.Id ?? string.Empty;
        return id.Contains("foundation", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsRailTrackSplineStructure(FoxWatchManifestStructure structure)
    {
        if (IsCraneRailTrackSplineStructure(structure))
        {
            return false;
        }

        var id = structure.Id ?? string.Empty;
        var codeName = structure.CodeName ?? string.Empty;
        if (string.IsNullOrWhiteSpace(id) && string.IsNullOrWhiteSpace(codeName))
        {
            return false;
        }

        return id.Contains("railtrackspline", StringComparison.OrdinalIgnoreCase)
            || codeName.Contains("RailTrackSpline", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsSmallGaugeRailTrackSplineStructure(FoxWatchManifestStructure structure)
    {
        var id = structure.Id ?? string.Empty;
        return id.StartsWith("small", StringComparison.OrdinalIgnoreCase);
    }

    private static List<string> GetAllowedStructureIds(FoxWatchManifestStructure structure)
    {
        var ids = new List<string>();

        AddAllowedStructureId(ids, structure.Id);
        AddAllowedStructureId(ids, structure.ParentStructureId);
        AddAllowedStructureId(ids, structure.RootStructureId);

        return ids;
    }

    private static void AddAllowedStructureId(List<string> ids, string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate) || ids.Contains(candidate, StringComparer.OrdinalIgnoreCase))
        {
            return;
        }

        ids.Add(candidate);
    }

    private static FoxWatchBlueprintSceneExtraction? CreateTopdownStructureComponentScene(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction? blueprintScene,
        string layerId)
    {
        if (blueprintScene == null || string.IsNullOrWhiteSpace(layerId))
        {
            return null;
        }

        var filteredRoots = FilterNodesForTopdownStructureComponentLayer(structure, blueprintScene.Roots, layerId, ancestorMatched: false);
        if (filteredRoots.Count == 0)
        {
            return null;
        }

        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = filteredRoots,
            Meshes = CloneMeshAssets(blueprintScene.Meshes),
            Variants = null,
        };
    }

    private static FoxWatchBlueprintSceneExtraction? CloneBlueprintSceneExtraction(FoxWatchBlueprintSceneExtraction? blueprintScene)
    {
        if (blueprintScene == null)
        {
            return null;
        }
        return new FoxWatchBlueprintSceneExtraction
        {
            Roots = CloneNodes(blueprintScene.Roots),
            Meshes = CloneMeshAssets(blueprintScene.Meshes),
            Variants = blueprintScene.Variants == null
                ? null
                : [.. blueprintScene.Variants.Select(CloneVariant)],
        };
    }

    private static HashSet<string> CreateRequestedVariantIds(
        IReadOnlyList<FoxWatchRenderSceneVariant>? variants,
        string variantId,
        bool includeDefaultVariant = true)
    {
        var requestedVariantIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (variants == null || variants.Count == 0 || string.IsNullOrWhiteSpace(variantId))
        {
            return requestedVariantIds;
        }

        var defaultVariant = variants.FirstOrDefault(entry => entry.IsDefault);
        var requestedVariant = variants.FirstOrDefault(entry =>
            string.Equals(entry.Id, variantId, StringComparison.OrdinalIgnoreCase));
        if (requestedVariant != null)
        {
            requestedVariantIds.Add(requestedVariant.Id);
        }

        if (includeDefaultVariant &&
            defaultVariant != null &&
            (requestedVariant == null || !string.Equals(defaultVariant.Id, requestedVariant.Id, StringComparison.OrdinalIgnoreCase)))
        {
            requestedVariantIds.Add(defaultVariant.Id);
        }

        return requestedVariantIds;
    }

    private static List<FoxWatchRenderSceneNode> CloneNodes(IEnumerable<FoxWatchRenderSceneNode> nodes)
    {
        return [.. nodes.Select(node => new FoxWatchRenderSceneNode
        {
            Id = node.Id,
            Name = node.Name,
            Visible = node.Visible,
            VariantIds = node.VariantIds == null ? null : [.. node.VariantIds],
            MeshId = node.MeshId,
            Primitive = ClonePrimitive(node.Primitive),
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
            Pose = ClonePose(node.Pose),
            PoseVariants = ClonePoseVariants(node.PoseVariants),
            AttachBoneName = node.AttachBoneName,
            TransformMatrix = [.. node.TransformMatrix],
            Children = CloneNodes(node.Children),
        })];
    }

    private static List<FoxWatchRenderSceneMeshAsset> CloneMeshAssets(IEnumerable<FoxWatchRenderSceneMeshAsset> meshes)
    {
        return [.. meshes.Select(mesh => new FoxWatchRenderSceneMeshAsset
        {
            Id = mesh.Id,
            SourcePath = mesh.SourcePath,
            ExportUrl = mesh.ExportUrl,
            DefaultPoseAnimationPackagePath = mesh.DefaultPoseAnimationPackagePath,
            PoseAnimationPackagePaths = mesh.PoseAnimationPackagePaths == null ? null : [.. mesh.PoseAnimationPackagePaths],
            MaterialSidecarNameOverride = mesh.MaterialSidecarNameOverride,
        })];
    }

    private static FoxWatchRenderSceneVariant CloneVariant(FoxWatchRenderSceneVariant variant)
    {
        return new FoxWatchRenderSceneVariant
        {
            Id = variant.Id,
            Name = variant.Name,
            IsDefault = variant.IsDefault,
            ColorHex = variant.ColorHex,
            PlaceVariantAfterMode = variant.PlaceVariantAfterMode,
        };
    }

    private static List<FoxWatchRenderSceneVariant>? CreateColorVariants(FoxWatchManifestStructure structure)
    {
        if (structure.Colors.Count == 0)
        {
            return null;
        }

        return [.. structure.Colors
            .Where(entry => !string.IsNullOrWhiteSpace(entry.Hex))
            .Select((entry, index) => new FoxWatchRenderSceneVariant
            {
                Id = entry.Hex,
                Name = $"#{entry.Hex.ToUpperInvariant()}",
                IsDefault = index == 0,
                ColorHex = entry.Hex,
                PlaceVariantAfterMode = true,
            })];
    }

    private static FoxWatchRenderScenePrimitive? ClonePrimitive(FoxWatchRenderScenePrimitive? primitive)
    {
        if (primitive == null)
        {
            return null;
        }

        return new FoxWatchRenderScenePrimitive
        {
            Type = primitive.Type,
            Points = primitive.Points == null
                ? null
                : [.. primitive.Points.Select(point => point == null ? [] : new List<double>(point))],
            Color = primitive.Color == null ? null : [.. primitive.Color],
            Radius = primitive.Radius,
            Width = primitive.Width,
            Height = primitive.Height,
        };
    }

    private sealed class FoxWatchGeneratedRenderSceneDocument
    {
        public string StructureId { get; set; } = string.Empty;

        public List<string> AllowedStructureIds { get; set; } = [];

        public List<FoxWatchRenderSceneConsumer> Consumers { get; set; } = [];

        public string CodeName { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;

        public string CategoryId { get; set; } = string.Empty;

        public string? PreviewUrl { get; set; }

        public string? IconUrl { get; set; }

        public bool IsStandaloneModification { get; set; }

        public string RenderId { get; set; } = string.Empty;

        public string SharedModificationId { get; set; } = string.Empty;

        public string RelativeScenePath { get; set; } = string.Empty;

        public FoxWatchRenderSceneDocument Document { get; set; } = new();
    }

    private sealed class SharedModificationHashDiagnosticsDocument
    {
        public string Source { get; set; } = string.Empty;

        public string RunId { get; set; } = string.Empty;

        public string GeneratedAtUtc { get; set; } = string.Empty;

        public int ProcessId { get; set; }

        public string OutputDirectory { get; set; } = string.Empty;

        public string? RenderAssetOutputDirectory { get; set; }

        public string BaseAssetsUrl { get; set; } = string.Empty;

        public string? PakDirectoryPath { get; set; }

        public int EntryCount { get; set; }

        public List<SharedModificationHashDiagnosticEntry> Entries { get; set; } = [];
    }

    private sealed class SharedModificationHashDiagnosticEntry
    {
        public string StructureId { get; set; } = string.Empty;

        public string? StructureCodeName { get; set; }

        public string? StructureName { get; set; }

        public string SlotName { get; set; } = string.Empty;

        public string VariantId { get; set; } = string.Empty;

        public string? RawPreviewDirection { get; set; }

        public string ResolvedPreviewDirection { get; set; } = string.Empty;

        public string GeneratedSharedModificationId { get; set; } = string.Empty;

        public string GeneratedRenderId { get; set; } = string.Empty;

        public string NormalizedVariantId { get; set; } = string.Empty;

        public string Identity { get; set; } = string.Empty;

        public string FullHashHex { get; set; } = string.Empty;

        public string TruncatedHashHex { get; set; } = string.Empty;

        public SharedModificationHashDiagnosticInputs Inputs { get; set; } = new();
    }

    private sealed class SharedModificationHashDiagnosticInputs
    {
        public SharedModificationHashDiagnosticInput VariantId { get; set; } = new();

        public SharedModificationHashDiagnosticInput DataClassPath { get; set; } = new();

        public SharedModificationHashDiagnosticInput TemplateActorPath { get; set; } = new();

        public SharedModificationHashDiagnosticInput TemplateMeshPath { get; set; } = new();

        public SharedModificationHashDiagnosticInput PreviewMeshPath { get; set; } = new();

        public SharedModificationHashDiagnosticInput Name { get; set; } = new();

        public SharedModificationHashDiagnosticInput Description { get; set; } = new();

        public SharedModificationHashDiagnosticInput PreviewDirection { get; set; } = new();
    }

    private sealed class SharedModificationHashDiagnosticInput
    {
        public string Raw { get; set; } = string.Empty;

        public string Normalized { get; set; } = string.Empty;
    }

    private sealed class SharedModificationHashComputation
    {
        public SharedModificationHashDiagnosticInput VariantId { get; set; } = new();

        public SharedModificationHashDiagnosticInput TemplateActorPath { get; set; } = new();

        public SharedModificationHashDiagnosticInput TemplateMeshPath { get; set; } = new();

        public SharedModificationHashDiagnosticInput PreviewMeshPath { get; set; } = new();

        public SharedModificationHashDiagnosticInput Name { get; set; } = new();

        public SharedModificationHashDiagnosticInput Description { get; set; } = new();

        public SharedModificationHashDiagnosticInput PreviewDirection { get; set; } = new();

        public string Identity { get; set; } = string.Empty;

        public string FullHashHex { get; set; } = string.Empty;

        public string TruncatedHashHex { get; set; } = string.Empty;

        public string NormalizedVariantId { get; set; } = string.Empty;

        public string GeneratedSharedModificationId { get; set; } = string.Empty;
    }

    private HashSet<string> ResolveRequestedVariantIds(FoxWatchManifestStructure structure, FoxWatchBlueprintSceneExtraction blueprintScene)
    {
        var requestedVariantIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var defaultVariant = blueprintScene.Variants?.FirstOrDefault(variant => variant.IsDefault);

        if (!string.IsNullOrWhiteSpace(structure.AppliedModificationId))
        {
            var appliedVariant = blueprintScene.Variants?.FirstOrDefault(variant =>
                string.Equals(variant.Id, structure.AppliedModificationId, StringComparison.OrdinalIgnoreCase));
            if (appliedVariant != null)
            {
                if (ShouldIncludeDefaultVariantForAppliedModification(structure, appliedVariant.Id) &&
                    defaultVariant != null &&
                    !string.Equals(defaultVariant.Id, appliedVariant.Id, StringComparison.OrdinalIgnoreCase))
                {
                    requestedVariantIds.Add(defaultVariant.Id);
                }

                requestedVariantIds.Add(appliedVariant.Id);
                return requestedVariantIds;
            }

            _logger.LogWarning(
                "Upgrade structure {StructureId} requested render variant {VariantId}, but that variant was not present in the extracted scene",
                structure.Id,
                structure.AppliedModificationId);
            return requestedVariantIds;
        }

        if (defaultVariant != null)
        {
            requestedVariantIds.Add(defaultVariant.Id);
        }

        return requestedVariantIds;
    }

    private static bool ShouldIncludeDefaultVariantForAppliedModification(
        FoxWatchManifestStructure structure,
        string? appliedVariantId)
    {
        if (string.IsNullOrWhiteSpace(appliedVariantId))
        {
            return true;
        }

        var normalizedAppliedVariantId = NormalizeStandaloneModificationKeyComponent(appliedVariantId);
        foreach (var modificationEntry in structure.Modifications)
        {
            var normalizedModificationId = NormalizeStandaloneModificationKeyComponent(
                string.IsNullOrWhiteSpace(modificationEntry.Value.AppliedModificationId)
                    ? modificationEntry.Key
                    : modificationEntry.Value.AppliedModificationId);
            if (string.Equals(normalizedModificationId, normalizedAppliedVariantId, StringComparison.OrdinalIgnoreCase))
            {
                return !modificationEntry.Value.IsUpgrade;
            }
        }

        return true;
    }

    private static List<FoxWatchRenderSceneNode> FilterNodesForVariant(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        IReadOnlySet<string> requestedVariantIds)
    {
        var filteredNodes = new List<FoxWatchRenderSceneNode>();
        foreach (var node in nodes)
        {
            if (node.VariantIds is { Count: > 0 } &&
                !node.VariantIds.Any(requestedVariantIds.Contains))
            {
                continue;
            }

            filteredNodes.Add(new FoxWatchRenderSceneNode
            {
                Id = node.Id,
                Name = node.Name,
                Visible = node.Visible,
                VariantIds = null,
                MeshId = node.MeshId,
                Primitive = ClonePrimitive(node.Primitive),
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
                Pose = ClonePose(node.Pose),
                PoseVariants = ClonePoseVariants(node.PoseVariants),
                AttachBoneName = node.AttachBoneName,
                TransformMatrix = [.. node.TransformMatrix],
                Children = FilterNodesForVariant(node.Children, requestedVariantIds),
            });
        }

        return filteredNodes;
    }

    private static List<FoxWatchRenderSceneNode> FilterNodesForTopdownModification(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string variantNodeIdPrefix)
    {
        var matchedVariant = false;
        return FilterNodesForTopdownModification(nodes, variantNodeIdPrefix, ancestorMatched: false, ref matchedVariant);
    }

    private static List<FoxWatchRenderSceneNode> FilterNodesForTopdownModification(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string variantNodeIdPrefix,
        bool ancestorMatched,
        ref bool matchedVariant)
    {
        var filteredNodes = new List<FoxWatchRenderSceneNode>();
        foreach (var node in OrderTopdownModificationNodes(nodes))
        {
            if (matchedVariant && !ancestorMatched)
            {
                break;
            }

            var matchesVariant = node.Id.StartsWith(variantNodeIdPrefix, StringComparison.OrdinalIgnoreCase);
            var includeFullSubtree = ancestorMatched || matchesVariant;
            if (matchesVariant)
            {
                matchedVariant = true;
            }

            var childNodes = FilterNodesForTopdownModification(node.Children, variantNodeIdPrefix, includeFullSubtree, ref matchedVariant);
            if (!includeFullSubtree && childNodes.Count == 0)
            {
                continue;
            }

            filteredNodes.Add(new FoxWatchRenderSceneNode
            {
                Id = node.Id,
                Name = node.Name,
                Visible = node.Visible,
                VariantIds = null,
                MeshId = includeFullSubtree ? node.MeshId : null,
                Primitive = includeFullSubtree ? ClonePrimitive(node.Primitive) : null,
                MaterialIds = includeFullSubtree ? [.. node.MaterialIds] : [],
                Location = node.Location == null ? null : [.. node.Location],
                RotationEulerDegrees = node.RotationEulerDegrees == null ? null : [.. node.RotationEulerDegrees],
                Scale = node.Scale == null ? null : [.. node.Scale],
                UnrealLocationCentimeters = node.UnrealLocationCentimeters == null ? null : [.. node.UnrealLocationCentimeters],
                UnrealSceneLocationCentimeters = node.UnrealSceneLocationCentimeters == null ? null : [.. node.UnrealSceneLocationCentimeters],
                UnrealRotationDegrees = node.UnrealRotationDegrees == null ? null : [.. node.UnrealRotationDegrees],
                DebugColor = node.DebugColor == null ? null : [.. node.DebugColor],
                MarkerColor = node.MarkerColor == null ? null : [.. node.MarkerColor],
                MarkerSize = node.MarkerSize,
                Pose = ClonePose(node.Pose),
                PoseVariants = ClonePoseVariants(node.PoseVariants),
                AttachBoneName = node.AttachBoneName,
                TransformMatrix = [.. node.TransformMatrix],
                Children = childNodes,
            });
        }

        return filteredNodes;
    }

    private static IEnumerable<FoxWatchRenderSceneNode> OrderTopdownModificationNodes(
        IEnumerable<FoxWatchRenderSceneNode> nodes)
    {
        return nodes.OrderBy(GetTopdownModificationNodePriority).ToList();
    }

    private static int GetTopdownModificationNodePriority(FoxWatchRenderSceneNode node)
    {
        if (node.Id.Contains(":leftinframodslot", StringComparison.OrdinalIgnoreCase))
        {
            return 0;
        }

        if (node.Id.Contains(":frontinframodslot", StringComparison.OrdinalIgnoreCase))
        {
            return 1;
        }

        if (node.Id.Contains(":rightinframodslot", StringComparison.OrdinalIgnoreCase))
        {
            return 2;
        }

        if (node.Id.Contains(":backinframodslot", StringComparison.OrdinalIgnoreCase))
        {
            return 3;
        }

        return 10;
    }

    private static bool ApplyStandaloneModificationSlotYawOffset(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        float yawOffsetDegrees)
    {
        foreach (var node in nodes)
        {
            if (node.Id.Contains("inframodslot", StringComparison.OrdinalIgnoreCase))
            {
                if (node.UnrealRotationDegrees is [_, var unrealYaw, _])
                {
                    node.UnrealRotationDegrees[1] = unrealYaw + yawOffsetDegrees;
                }

                if (node.RotationEulerDegrees is [_, var eulerYaw, _])
                {
                    node.RotationEulerDegrees[1] = eulerYaw + yawOffsetDegrees;
                }

                return true;
            }

            if (ApplyStandaloneModificationSlotYawOffset(node.Children, yawOffsetDegrees))
            {
                return true;
            }
        }

        return false;
    }

    private static List<FoxWatchRenderSceneNode> FilterNodesForTopdownStructureComponentLayer(
        FoxWatchManifestStructure structure,
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string layerId,
        bool ancestorMatched)
    {
        var filteredNodes = new List<FoxWatchRenderSceneNode>();
        foreach (var node in nodes)
        {
            var matchesLayer = MatchesTopdownStructureComponentLayer(structure, node.Name, layerId);
            var includeFullSubtree = ancestorMatched || matchesLayer;
            var childNodes = FilterNodesForTopdownStructureComponentLayer(structure, node.Children, layerId, includeFullSubtree);
            if (!includeFullSubtree && childNodes.Count == 0)
            {
                continue;
            }

            var includeMesh = includeFullSubtree && ShouldIncludeFortRoofLayerMesh(structure, layerId, node.Name, node.MeshId);
            filteredNodes.Add(new FoxWatchRenderSceneNode
            {
                Id = node.Id,
                Name = node.Name,
                Visible = node.Visible,
                VariantIds = null,
                MeshId = includeMesh ? node.MeshId : null,
                Primitive = includeMesh ? ClonePrimitive(node.Primitive) : null,
                MaterialIds = includeMesh ? [.. node.MaterialIds] : [],
                Location = node.Location == null ? null : [.. node.Location],
                RotationEulerDegrees = node.RotationEulerDegrees == null ? null : [.. node.RotationEulerDegrees],
                Scale = node.Scale == null ? null : [.. node.Scale],
                UnrealLocationCentimeters = node.UnrealLocationCentimeters == null ? null : [.. node.UnrealLocationCentimeters],
                UnrealSceneLocationCentimeters = node.UnrealSceneLocationCentimeters == null ? null : [.. node.UnrealSceneLocationCentimeters],
                UnrealRotationDegrees = node.UnrealRotationDegrees == null ? null : [.. node.UnrealRotationDegrees],
                DebugColor = node.DebugColor == null ? null : [.. node.DebugColor],
                MarkerColor = node.MarkerColor == null ? null : [.. node.MarkerColor],
                MarkerSize = node.MarkerSize,
                Pose = ClonePose(node.Pose),
                PoseVariants = ClonePoseVariants(node.PoseVariants),
                AttachBoneName = node.AttachBoneName,
                TransformMatrix = [.. node.TransformMatrix],
                Children = childNodes,
            });
        }

        return filteredNodes;
    }

    private static bool ShouldIncludeFortRoofLayerMesh(
        FoxWatchManifestStructure structure,
        string layerId,
        string? nodeName,
        string? meshId)
    {
        if (string.IsNullOrWhiteSpace(meshId))
        {
            return false;
        }

        if (!string.Equals(layerId, "roof", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var normalizedNodeName = nodeName ?? string.Empty;
        var separatorIndex = normalizedNodeName.LastIndexOf(':');
        if (separatorIndex >= 0 && separatorIndex + 1 < normalizedNodeName.Length)
        {
            normalizedNodeName = normalizedNodeName[(separatorIndex + 1)..];
        }

        var roofLayer = structure.RenderLayers?
            .FirstOrDefault(layer => string.Equals(layer.Id, "roof", StringComparison.OrdinalIgnoreCase));
        var roofComponentName = roofLayer?.ComponentName ?? string.Empty;
        var normalizedRoofComponentName = roofComponentName;
        var componentSeparatorIndex = normalizedRoofComponentName.LastIndexOf(':');
        if (componentSeparatorIndex >= 0 && componentSeparatorIndex + 1 < normalizedRoofComponentName.Length)
        {
            normalizedRoofComponentName = normalizedRoofComponentName[(componentSeparatorIndex + 1)..];
        }

        if (string.Equals(normalizedRoofComponentName, "Roof", StringComparison.OrdinalIgnoreCase))
        {
            return string.Equals(normalizedNodeName, "Roof", StringComparison.OrdinalIgnoreCase);
        }

        return string.Equals(normalizedNodeName, normalizedRoofComponentName, StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalizedNodeName, roofComponentName, StringComparison.OrdinalIgnoreCase);
    }

    private static bool MatchesTopdownStructureComponentLayer(FoxWatchManifestStructure structure, string? nodeName, string layerId)
    {
        if (string.IsNullOrWhiteSpace(nodeName) || string.IsNullOrWhiteSpace(layerId))
        {
            return false;
        }

        var normalizedNodeName = nodeName;
        var separatorIndex = normalizedNodeName.LastIndexOf(':');
        if (separatorIndex >= 0 && separatorIndex + 1 < normalizedNodeName.Length)
        {
            normalizedNodeName = normalizedNodeName[(separatorIndex + 1)..];
        }

        if (string.Equals(structure.Id, "facilitypipe", StringComparison.OrdinalIgnoreCase))
        {
            return layerId.ToLowerInvariant() switch
            {
                "backtrim" => string.Equals(normalizedNodeName, "BackTrim", StringComparison.OrdinalIgnoreCase),
                "span" => string.Equals(normalizedNodeName, "PipelineSegment01", StringComparison.OrdinalIgnoreCase),
                "fronttrim" => string.Equals(normalizedNodeName, "FrontTrim", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (string.Equals(structure.Id, "facilitypipeunderground", StringComparison.OrdinalIgnoreCase))
        {
            return layerId.ToLowerInvariant() switch
            {
                "backtrim" => string.Equals(normalizedNodeName, "BackMesh", StringComparison.OrdinalIgnoreCase),
                "fronttrim" => string.Equals(normalizedNodeName, "FrontMesh", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (string.Equals(structure.Id, "facilitypipeoverhead", StringComparison.OrdinalIgnoreCase))
        {
            return layerId.ToLowerInvariant() switch
            {
                "backtrim" => string.Equals(normalizedNodeName, "BackMesh", StringComparison.OrdinalIgnoreCase),
                "span" => string.Equals(normalizedNodeName, "PipelineoverheadConnect", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalizedNodeName, "PipelineSegment01", StringComparison.OrdinalIgnoreCase),
                "fronttrim" => string.Equals(normalizedNodeName, "FrontMesh", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (IsTrimSpanConnectorStructure(structure))
        {
            return MatchesTrimSpanConnectorLayer(structure, normalizedNodeName, layerId);
        }

        if (IsTankStopSplineStructure(structure) || IsMineSplineStructure(structure) || IsIntervalMarkerSplineStructure(structure))
        {
            return MatchesIntervalMarkerSplineLayer(structure, normalizedNodeName, layerId);
        }

        if (IsFacilityRoadStructure(structure))
        {
            return layerId.ToLowerInvariant() switch
            {
                "span" => normalizedNodeName.StartsWith("FacilityRoad", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (IsCraneRailTrackSplineStructure(structure))
        {
            return layerId.ToLowerInvariant() switch
            {
                "span" => string.Equals(normalizedNodeName, "CraneRailTrack", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (IsRailTrackSplineStructure(structure))
        {
            var isSmallGauge = IsSmallGaugeRailTrackSplineStructure(structure);
            return layerId.ToLowerInvariant() switch
            {
                "backswitch" => string.Equals(normalizedNodeName, "BackSwitchMesh", StringComparison.OrdinalIgnoreCase),
                "underlay" => normalizedNodeName.Contains("Trackbed", StringComparison.OrdinalIgnoreCase),
                "span" => isSmallGauge
                    ? string.Equals(normalizedNodeName, "SmallGaugeTrack_Rail", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(normalizedNodeName, "SmallGaugeTrack_Tie", StringComparison.OrdinalIgnoreCase)
                    : string.Equals(normalizedNodeName, "Railway_Rail", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(normalizedNodeName, "Railway_Tie", StringComparison.OrdinalIgnoreCase),
                "frontswitch" => string.Equals(normalizedNodeName, "FrontSwitchMesh", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (IsFacilityFoundationStructure(structure))
        {
            var renderLayer = structure.RenderLayers?
                .FirstOrDefault(layer => string.Equals(layer.Id, layerId, StringComparison.OrdinalIgnoreCase));
            if (renderLayer == null || string.IsNullOrWhiteSpace(renderLayer.ComponentName))
            {
                return false;
            }

            return string.Equals(
                normalizedNodeName,
                renderLayer.ComponentName,
                StringComparison.OrdinalIgnoreCase);
        }

        if (IsTrenchStructureWithComponentLayers(structure))
        {
            var renderLayer = structure.RenderLayers?
                .FirstOrDefault(layer => string.Equals(layer.Id, layerId, StringComparison.OrdinalIgnoreCase));
            if (renderLayer == null || string.IsNullOrWhiteSpace(renderLayer.ComponentName))
            {
                return false;
            }

            var normalizedComponentName = renderLayer.ComponentName;
            var componentSeparatorIndex = normalizedComponentName.LastIndexOf(':');
            if (componentSeparatorIndex >= 0 && componentSeparatorIndex + 1 < normalizedComponentName.Length)
            {
                normalizedComponentName = normalizedComponentName[(componentSeparatorIndex + 1)..];
            }

            return string.Equals(normalizedNodeName, normalizedComponentName, StringComparison.OrdinalIgnoreCase)
                || string.Equals(normalizedNodeName, renderLayer.ComponentName, StringComparison.OrdinalIgnoreCase);
        }

        if (IsFortEntrenchmentStructure(structure))
        {
            var renderLayer = structure.RenderLayers?
                .FirstOrDefault(layer => string.Equals(layer.Id, layerId, StringComparison.OrdinalIgnoreCase));
            if (renderLayer == null || string.IsNullOrWhiteSpace(renderLayer.ComponentName))
            {
                return false;
            }

            var normalizedComponentName = renderLayer.ComponentName;
            var componentSeparatorIndex = normalizedComponentName.LastIndexOf(':');
            if (componentSeparatorIndex >= 0 && componentSeparatorIndex + 1 < normalizedComponentName.Length)
            {
                normalizedComponentName = normalizedComponentName[(componentSeparatorIndex + 1)..];
            }

            return string.Equals(normalizedNodeName, normalizedComponentName, StringComparison.OrdinalIgnoreCase)
                || string.Equals(normalizedNodeName, renderLayer.ComponentName, StringComparison.OrdinalIgnoreCase);
        }

        return layerId.ToLowerInvariant() switch
        {
            "floor" => string.Equals(normalizedNodeName, "Floor", StringComparison.OrdinalIgnoreCase),
            "walls" => normalizedNodeName.StartsWith("Wall", StringComparison.OrdinalIgnoreCase),
            "corners" => normalizedNodeName.StartsWith("Corner", StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }

    private static bool MatchesTrimSpanConnectorLayer(
        FoxWatchManifestStructure structure,
        string normalizedNodeName,
        string layerId)
    {
        var structureId = structure.Id ?? string.Empty;
        if (string.Equals(structureId, "fieldbridge", StringComparison.OrdinalIgnoreCase))
        {
            return layerId.ToLowerInvariant() switch
            {
                "backtrim" => string.Equals(normalizedNodeName, "PillarBack", StringComparison.OrdinalIgnoreCase),
                "backramp" => string.Equals(normalizedNodeName, "BackRamp", StringComparison.OrdinalIgnoreCase),
                "fronttrim" => string.Equals(normalizedNodeName, "PillarFront", StringComparison.OrdinalIgnoreCase),
                "frontramp" => string.Equals(normalizedNodeName, "FrontRamp", StringComparison.OrdinalIgnoreCase),
                "span" => string.Equals(normalizedNodeName, "FieldBridge01", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (string.Equals(structureId, "fieldpier", StringComparison.OrdinalIgnoreCase))
        {
            return layerId.ToLowerInvariant() switch
            {
                "backtrim" => string.Equals(normalizedNodeName, "PillarBack", StringComparison.OrdinalIgnoreCase),
                "backramp" => string.Equals(normalizedNodeName, "BackRamp", StringComparison.OrdinalIgnoreCase),
                "fronttrim" => string.Equals(normalizedNodeName, "PillarFront", StringComparison.OrdinalIgnoreCase),
                "frontramp" => string.Equals(normalizedNodeName, "FrontRamp", StringComparison.OrdinalIgnoreCase),
                "span" => string.Equals(normalizedNodeName, "FieldPier", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (string.Equals(structureId, "facilitycatwalkbridge", StringComparison.OrdinalIgnoreCase))
        {
            return layerId.ToLowerInvariant() switch
            {
                "backtrim" => string.Equals(normalizedNodeName, "BackSupport", StringComparison.OrdinalIgnoreCase),
                "fronttrim" => string.Equals(normalizedNodeName, "FrontSupport", StringComparison.OrdinalIgnoreCase),
                "span" => string.Equals(normalizedNodeName, "facilitieCatwalkPlatfrom", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (string.Equals(structureId, "barbedwirespline", StringComparison.OrdinalIgnoreCase))
        {
            return layerId.ToLowerInvariant() switch
            {
                "backtrim" => string.Equals(normalizedNodeName, "PillarBack", StringComparison.OrdinalIgnoreCase),
                "fronttrim" => string.Equals(normalizedNodeName, "PillarFront", StringComparison.OrdinalIgnoreCase),
                "span" => normalizedNodeName.StartsWith("BarbedWireSpline_", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (structureId.StartsWith("waterwallspline", StringComparison.OrdinalIgnoreCase))
        {
            return layerId.ToLowerInvariant() switch
            {
                "backtrim" => string.Equals(normalizedNodeName, "BackPillar", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalizedNodeName, "BackPIllar", StringComparison.OrdinalIgnoreCase),
                "fronttrim" => string.Equals(normalizedNodeName, "FrontPillar", StringComparison.OrdinalIgnoreCase),
                "span" => string.Equals(normalizedNodeName, "WaterWallSpline", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (structureId.StartsWith("wallspline", StringComparison.OrdinalIgnoreCase))
        {
            return layerId.ToLowerInvariant() switch
            {
                "backtrim" => string.Equals(normalizedNodeName, "BackPillar", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalizedNodeName, "BackPIllar", StringComparison.OrdinalIgnoreCase),
                "fronttrim" => string.Equals(normalizedNodeName, "FrontPillar", StringComparison.OrdinalIgnoreCase),
                "span" => IsWallSplineSpanNode(normalizedNodeName),
                _ => false,
            };
        }

        return false;
    }

    private static bool IsWallSplineSpanNode(string normalizedNodeName)
    {
        if (string.IsNullOrWhiteSpace(normalizedNodeName))
        {
            return false;
        }

        if (normalizedNodeName.Contains("BarbedWire", StringComparison.OrdinalIgnoreCase)
            || normalizedNodeName.Contains("Pillar", StringComparison.OrdinalIgnoreCase)
            || normalizedNodeName.Contains("Socket", StringComparison.OrdinalIgnoreCase)
            || normalizedNodeName.Contains("Target", StringComparison.OrdinalIgnoreCase)
            || normalizedNodeName.Contains("Support", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return normalizedNodeName.Contains("Wall_segment", StringComparison.OrdinalIgnoreCase)
            || normalizedNodeName.Contains("WallSegments", StringComparison.OrdinalIgnoreCase)
            || normalizedNodeName.Contains("WallPlank", StringComparison.OrdinalIgnoreCase);
    }

    private static bool MatchesIntervalMarkerSplineLayer(
        FoxWatchManifestStructure structure,
        string normalizedNodeName,
        string layerId)
    {
        if (IsMineSplineStructure(structure))
        {
            return layerId.ToLowerInvariant() switch
            {
                "span" => string.Equals(normalizedNodeName, "CraterS", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalizedNodeName, "InfantryMinePickup", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalizedNodeName, "Seamines", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalizedNodeName, "SmallSeaMine", StringComparison.OrdinalIgnoreCase),
                "spanalt" => string.Equals(normalizedNodeName, "Bouy01", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalizedNodeName, "InfantryMinePickup", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        if (IsTankStopSplineStructure(structure))
        {
            if (!normalizedNodeName.StartsWith("TankStopT3_", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return layerId.ToLowerInvariant() switch
            {
                "span" => normalizedNodeName.EndsWith("_1", StringComparison.OrdinalIgnoreCase),
                "spanalt" => normalizedNodeName.EndsWith("_2", StringComparison.OrdinalIgnoreCase),
                _ => false,
            };
        }

        return false;
    }

    private static FoxWatchRenderScenePose? ClonePose(FoxWatchRenderScenePose? pose)
    {
        if (pose == null)
        {
            return null;
        }

        return new FoxWatchRenderScenePose
        {
            Type = pose.Type,
            Profile = pose.Profile,
            Parameters = pose.Parameters == null
                ? null
                : pose.Parameters.ToDictionary(entry => entry.Key, entry => entry.Value, StringComparer.Ordinal),
            Bones = pose.Bones == null
                ? null
                : [.. pose.Bones.Select(bone => new FoxWatchRenderSceneBonePose
                {
                    Name = bone.Name,
                    ParentIndex = bone.ParentIndex,
                    Location = bone.Location == null ? null : [.. bone.Location],
                    RotationQuaternion = bone.RotationQuaternion == null ? null : [.. bone.RotationQuaternion],
                    Scale = bone.Scale == null ? null : [.. bone.Scale],
                })],
        };
    }

    private static Dictionary<string, FoxWatchRenderScenePose>? ClonePoseVariants(Dictionary<string, FoxWatchRenderScenePose>? poseVariants)
    {
        if (poseVariants == null || poseVariants.Count == 0)
        {
            return null;
        }

        return poseVariants.ToDictionary(entry => entry.Key, entry => ClonePose(entry.Value)!, StringComparer.OrdinalIgnoreCase);
    }

    private async Task ApplyDefaultScenePosesAsync(
        FoxWatchManifestStructure structure,
        IReadOnlyList<FoxWatchRenderSceneNode> roots,
        IReadOnlyDictionary<string, FoxWatchRenderSceneMeshAsset> meshAssetsById,
        CancellationToken cancellationToken)
    {
        if (roots.Count == 0)
        {
            return;
        }

        if (await TryApplyStructurePoseOverrideAsync(structure, roots, meshAssetsById, cancellationToken))
        {
            return;
        }
    }

    private async Task<bool> TryApplyStructurePoseOverrideAsync(
        FoxWatchManifestStructure structure,
        IReadOnlyList<FoxWatchRenderSceneNode> roots,
        IReadOnlyDictionary<string, FoxWatchRenderSceneMeshAsset> meshAssetsById,
        CancellationToken cancellationToken)
    {
        var overridePose = await _poseOverrideLoader.TryLoadDefaultPoseAsync(structure.Id, cancellationToken);
        if (overridePose != null)
        {
            if (string.Equals(structure.Id, FacilityCraneStructureId, StringComparison.OrdinalIgnoreCase))
            {
                var applied = ApplyPoseToFirstMatchingNode(roots, FacilityCraneMeshId, overridePose);
                LogAppliedStructurePoseOverride(structure.Id, applied);
                return applied;
            }

            if (string.Equals(structure.Id, BargeStructureId, StringComparison.OrdinalIgnoreCase))
            {
                var applied = ApplyPoseToFirstMatchingNode(roots, BargeMeshId, overridePose);
                LogAppliedStructurePoseOverride(structure.Id, applied);
                return applied;
            }

            if (string.Equals(structure.Id, LargeCraneStructureId, StringComparison.OrdinalIgnoreCase))
            {
                var applied = ApplyPoseToFirstMatchingNode(roots, LargeCraneMeshId, overridePose);
                LogAppliedStructurePoseOverride(structure.Id, applied);
                return applied;
            }

            if (ContainsMeshId(roots, DeployableTripodMeshId))
            {
                var appliedCount = ApplyPoseToMatchingNodes(roots, DeployableTripodMeshId, overridePose);
                AttachChildMeshesToBoneForMatchingNodes(roots, DeployableTripodMeshId, DeployableTripodMountedAttachmentBoneName);
                LogAppliedStructurePoseOverride(structure.Id, appliedCount > 0);
                return appliedCount > 0;
            }

            if (ContainsMeshId(roots, WindsockMeshId))
            {
                var applied = ApplyPoseToMatchingNodes(roots, WindsockMeshId, overridePose) > 0;
                LogAppliedStructurePoseOverride(structure.Id, applied);
                return applied;
            }

            foreach (var meshAsset in GetPoseOverrideTargetMeshAssets(meshAssetsById))
            {
                var applied = ApplyPoseToFirstMatchingNode(roots, meshAsset.Id, overridePose);
                if (!applied)
                {
                    continue;
                }

                LogAppliedStructurePoseOverride(structure.Id, true);
                return true;
            }

            _logger.LogWarning(
                "Found pose override for {StructureId}, but no supported skeletal mesh target was present in the generated render scene",
                structure.Id);
            return false;
        }

        if (!string.Equals(structure.Id, DeployedTripodStructureId, StringComparison.OrdinalIgnoreCase) &&
            ContainsMeshId(roots, DeployableTripodMeshId))
        {
            var tripodPose = await TryCreateDeployableTripodNeutralPoseAsync(cancellationToken);
            if (tripodPose == null)
            {
                return false;
            }

            var appliedCount = ApplyPoseToMatchingNodes(roots, DeployableTripodMeshId, tripodPose);
            AttachChildMeshesToBoneForMatchingNodes(roots, DeployableTripodMeshId, DeployableTripodMountedAttachmentBoneName);
            if (appliedCount > 0)
            {
                _logger.LogDebug("Applied embedded tripod pose for {StructureId}", structure.Id);
                return true;
            }
        }

        return false;
    }

    private void LogAppliedStructurePoseOverride(string structureId, bool applied)
    {
        if (!applied)
        {
            return;
        }

        _logger.LogDebug("Applied default pose override for {StructureId}", structureId);
    }

    private async Task<List<FoxWatchRenderSceneVariant>?> TryApplyPoseVariantsAsync(
        FoxWatchManifestStructure structure,
        IReadOnlyList<FoxWatchRenderSceneNode> roots,
        IReadOnlyDictionary<string, FoxWatchRenderSceneMeshAsset> meshAssetsById,
        CancellationToken cancellationToken)
    {
        var variants = new List<FoxWatchRenderSceneVariant>
        {
            new()
            {
                Id = DefaultPoseSceneVariantId,
                Name = "Default Pose",
                IsDefault = true,
            },
        };

        var appliedAny = false;
        if (ContainsMeshId(roots, DeployableTripodMeshId))
        {
            appliedAny |= await TryApplyTripodPoseVariantsAsync(roots, variants, cancellationToken);
        }

        if (ContainsMeshId(roots, BargeMeshId))
        {
            appliedAny |= await TryApplyBargePoseVariantsAsync(roots, variants, cancellationToken);
        }

        if (ContainsMeshId(roots, FacilityCraneMeshId))
        {
            appliedAny |= await TryApplyPoseVariantsAsync(
                roots,
                FacilityCraneMeshId,
                "facility-crane",
                GetFacilityCranePoseAnimationPackagePaths(),
                TryCreateFacilityCranePoseAsync,
                variants,
                cancellationToken);
        }

        if (ContainsMeshId(roots, StaticCraneMeshId))
        {
            appliedAny |= await TryApplyPoseVariantsAsync(
                roots,
                StaticCraneMeshId,
                "static-crane",
                GetFacilityCranePoseAnimationPackagePaths(),
                TryCreateStaticCranePoseAsync,
                variants,
                cancellationToken);
        }

        if (ContainsMeshId(roots, WindsockMeshId))
        {
            appliedAny |= await TryApplyPoseVariantsAsync(
                roots,
                WindsockMeshId,
                "windsock",
                GetWindsockPoseAnimationPackagePaths(),
                TryCreateWindsockPoseAsync,
                variants,
                cancellationToken);
        }

        if (ContainsMeshId(roots, LargeCraneMeshId))
        {
            appliedAny |= await TryApplyPoseVariantsAsync(
                roots,
                LargeCraneMeshId,
                "large-crane",
                GetLargeCranePoseAnimationPackagePaths(),
                TryCreateLargeCranePoseAsync,
                variants,
                cancellationToken);
        }

            appliedAny |= await TryApplyAutomaticPoseVariantsAsync(roots, meshAssetsById, variants, cancellationToken);

        if (!appliedAny)
        {
            return null;
        }

        _logger.LogDebug("Generated {VariantCount} pose variants for {StructureId}", variants.Count, structure.Id);
        return variants;
    }

    private Task<bool> TryApplyTripodPoseVariantsAsync(
        IReadOnlyList<FoxWatchRenderSceneNode> roots,
        List<FoxWatchRenderSceneVariant> variants,
        CancellationToken cancellationToken)
    {
        return TryApplyPoseVariantsAsync(
            roots,
            DeployableTripodMeshId,
            "tripod",
            GetDeployableTripodPoseAnimationPackagePaths(),
            TryCreateDeployableTripodPoseAsync,
            variants,
            cancellationToken);
    }

    private Task<bool> TryApplyBargePoseVariantsAsync(
        IReadOnlyList<FoxWatchRenderSceneNode> roots,
        List<FoxWatchRenderSceneVariant> variants,
        CancellationToken cancellationToken)
    {
        return TryApplyPoseVariantsAsync(
            roots,
            BargeMeshId,
            "barge",
            GetBargePoseAnimationPackagePaths(),
            TryCreateBargePoseAsync,
            variants,
            cancellationToken);
    }

    private async Task<bool> TryApplyAutomaticPoseVariantsAsync(
        IReadOnlyList<FoxWatchRenderSceneNode> roots,
        IReadOnlyDictionary<string, FoxWatchRenderSceneMeshAsset> meshAssetsById,
        List<FoxWatchRenderSceneVariant> variants,
        CancellationToken cancellationToken)
    {
        var appliedAny = false;
        foreach (var meshAsset in GetAutomaticPoseMeshAssets(meshAssetsById))
        {
            if (!ContainsMeshId(roots, meshAsset.Id) || meshAsset.PoseAnimationPackagePaths is not { Count: > 0 })
            {
                continue;
            }

            appliedAny |= await TryApplyPoseVariantsAsync(
                roots,
                meshAsset.Id,
                meshAsset.Id,
                meshAsset.PoseAnimationPackagePaths,
                (animationPackagePath, token) => TryCreateAutomaticPoseAsync(meshAsset, animationPackagePath, token),
                variants,
                cancellationToken);
        }

        return appliedAny;
    }

    private Task<FoxWatchRenderScenePose?> TryCreateAutomaticPoseAsync(
        FoxWatchRenderSceneMeshAsset meshAsset,
        string? animationPackagePath,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(animationPackagePath) || string.IsNullOrWhiteSpace(meshAsset.SourcePath))
        {
            return Task.FromResult<FoxWatchRenderScenePose?>(null);
        }

        return TryCreateSampledPoseAsync(
            profile: "skeletal-auto",
            animationPackagePath: animationPackagePath,
            referenceMeshAssetPath: meshAsset.SourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
    }

    private static IEnumerable<FoxWatchRenderSceneMeshAsset> GetAutomaticPoseMeshAssets(
        IReadOnlyDictionary<string, FoxWatchRenderSceneMeshAsset> meshAssetsById)
    {
        return meshAssetsById.Values
            .Where(asset => asset.PoseAnimationPackagePaths is { Count: > 0 })
            .Where(asset => !string.Equals(asset.Id, DeployableTripodMeshId, StringComparison.OrdinalIgnoreCase))
            .Where(asset => !string.Equals(asset.Id, BargeMeshId, StringComparison.OrdinalIgnoreCase))
            .Where(asset => !string.Equals(asset.Id, FacilityCraneMeshId, StringComparison.OrdinalIgnoreCase))
            .Where(asset => !string.Equals(asset.Id, LargeCraneMeshId, StringComparison.OrdinalIgnoreCase))
            .Where(asset => !string.Equals(asset.Id, WindsockMeshId, StringComparison.OrdinalIgnoreCase))
            .OrderBy(asset => asset.Id, StringComparer.OrdinalIgnoreCase);
    }

    private static IEnumerable<FoxWatchRenderSceneMeshAsset> GetPoseOverrideTargetMeshAssets(
        IReadOnlyDictionary<string, FoxWatchRenderSceneMeshAsset> meshAssetsById)
    {
        return meshAssetsById.Values
            .Where(IsLikelySkeletalMeshAsset)
            .OrderBy(asset => asset.Id, StringComparer.OrdinalIgnoreCase);
    }

    private static bool IsLikelySkeletalMeshAsset(FoxWatchRenderSceneMeshAsset asset)
    {
        var fileName = Path.GetFileNameWithoutExtension(asset.SourcePath?.Replace('/', Path.DirectorySeparatorChar));
        return !string.IsNullOrWhiteSpace(fileName)
            && (fileName.StartsWith("SK_", StringComparison.OrdinalIgnoreCase)
                || fileName.StartsWith("SKM_", StringComparison.OrdinalIgnoreCase));
    }

    private async Task<bool> TryApplyPoseVariantsAsync(
        IReadOnlyList<FoxWatchRenderSceneNode> roots,
        string meshId,
        string variantPrefix,
        IReadOnlyList<string> animationPackagePaths,
        Func<string, CancellationToken, Task<FoxWatchRenderScenePose?>> createPoseAsync,
        List<FoxWatchRenderSceneVariant> variants,
        CancellationToken cancellationToken)
    {
        var poseVariants = new Dictionary<string, FoxWatchRenderScenePose>(StringComparer.OrdinalIgnoreCase);
        foreach (var animationPackagePath in animationPackagePaths)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var pose = await createPoseAsync(animationPackagePath, cancellationToken);
            if (pose == null)
            {
                continue;
            }

            var variantId = CreatePoseVariantId(variantPrefix, animationPackagePath);
            poseVariants[variantId] = pose;
            variants.Add(new FoxWatchRenderSceneVariant
            {
                Id = variantId,
                Name = Path.GetFileNameWithoutExtension(animationPackagePath.Replace('/', Path.DirectorySeparatorChar)),
            });
        }

        if (poseVariants.Count == 0)
        {
            return false;
        }

        ApplyPoseVariantsToMatchingNodes(roots, meshId, poseVariants);
        return true;
    }

    private async Task<FoxWatchBlueprintSceneExtraction?> AppendCraneSpawnVisualsAsync(
        FoxWatchManifestStructure structure,
        FoxWatchBlueprintSceneExtraction? blueprintScene,
        CancellationToken cancellationToken)
    {
        if (structure.CraneSpawns.Count == 0)
        {
            return blueprintScene;
        }

        var scene = blueprintScene ?? new FoxWatchBlueprintSceneExtraction();
        if (scene.Roots.Count == 0)
        {
            scene.Roots.Add(new FoxWatchRenderSceneNode
            {
                Id = $"{structure.Id}:root",
                Name = structure.CodeName,
            });
        }

        var root = scene.Roots[0];
        var insertedSpawnKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < structure.CraneSpawns.Count; index += 1)
        {
            var craneSpawn = structure.CraneSpawns[index];
            var structureId = craneSpawn.StructureId?.Trim();
            if (string.IsNullOrWhiteSpace(structureId))
            {
                continue;
            }

            var spawnX = craneSpawn.X ?? 0;
            var spawnY = craneSpawn.Y ?? 0;
            var spawnZ = craneSpawn.Z ?? 0;
            var spawnKey = string.Join(
                "|",
                structureId,
                spawnX.ToString("0.###"),
                spawnY.ToString("0.###"),
                spawnZ.ToString("0.###"),
                (craneSpawn.Rotation ?? 0).ToString("0.###"));
            if (!insertedSpawnKeys.Add(spawnKey))
            {
                continue;
            }

            var craneAsset = await GetCraneRenderAssetAsync(structureId, cancellationToken);
            if (craneAsset == null)
            {
                continue;
            }

            var meshId = GetOrAddMeshAsset(scene, craneAsset.MeshSourcePath, craneAsset.MeshId);
            root.Children.Add(new FoxWatchRenderSceneNode
            {
                Id = $"{structure.Id}:crane:{index + 1}",
                Name = string.IsNullOrWhiteSpace(craneSpawn.Name) ? craneAsset.DisplayName : craneSpawn.Name,
                UnrealSceneLocationCentimeters =
                [
                    spawnX,
                    spawnY,
                    spawnZ,
                ],
                UnrealRotationDegrees =
                [
                    0,
                    craneSpawn.Rotation ?? 0,
                    0,
                ],
                Children =
                [
                    new FoxWatchRenderSceneNode
                    {
                        Id = $"{structure.Id}:crane:{index + 1}:mesh",
                        Name = craneAsset.DisplayName,
                        MeshId = meshId,
                        UnrealLocationCentimeters = craneAsset.LocalLocationCentimeters == null ? null : [.. craneAsset.LocalLocationCentimeters],
                        UnrealRotationDegrees = craneAsset.LocalRotationDegrees == null ? null : [.. craneAsset.LocalRotationDegrees],
                        Pose = ClonePose(craneAsset.Pose),
                    },
                ],
            });
        }

        return scene;
    }

    private static string GetOrAddMeshAsset(FoxWatchBlueprintSceneExtraction scene, string meshSourcePath, string preferredMeshId)
    {
        var existingMeshAsset = scene.Meshes.FirstOrDefault(asset =>
            string.Equals(asset.SourcePath, meshSourcePath, StringComparison.OrdinalIgnoreCase));
        if (existingMeshAsset != null)
        {
            return existingMeshAsset.Id;
        }

        var meshId = preferredMeshId;
        var suffix = 2;
        while (scene.Meshes.Any(asset => string.Equals(asset.Id, meshId, StringComparison.OrdinalIgnoreCase)))
        {
            meshId = $"{preferredMeshId}-{suffix}";
            suffix += 1;
        }

        scene.Meshes.Add(new FoxWatchRenderSceneMeshAsset
        {
            Id = meshId,
            SourcePath = meshSourcePath,
        });
        return meshId;
    }

    private async Task<FoxWatchCraneRenderAsset?> GetCraneRenderAssetAsync(string structureId, CancellationToken cancellationToken)
    {
        if (_craneRenderAssetByStructureId.TryGetValue(structureId, out var cachedAsset))
        {
            return cachedAsset;
        }

        FoxWatchCraneRenderAsset? craneAsset = null;
        if (string.Equals(structureId, FacilityCraneStructureId, StringComparison.OrdinalIgnoreCase))
        {
            craneAsset = new FoxWatchCraneRenderAsset
            {
                DisplayName = "FacilityCrane",
                MeshId = FacilityCraneMeshId,
                MeshSourcePath = FacilityCraneMeshSourcePath,
                LocalRotationDegrees = [0, -90, 0],
            };
        }
        else if (string.Equals(structureId, StaticCraneStructureId, StringComparison.OrdinalIgnoreCase))
        {
            craneAsset = new FoxWatchCraneRenderAsset
            {
                DisplayName = "StaticCrane",
                MeshId = StaticCraneMeshId,
                MeshSourcePath = StaticCraneMeshSourcePath,
                LocalRotationDegrees = [0, -90, 0],
                Pose = await _poseOverrideLoader.TryLoadDefaultPoseAsync(StaticCraneStructureId, cancellationToken),
            };
        }
        else if (string.Equals(structureId, LargeCraneStructureId, StringComparison.OrdinalIgnoreCase))
        {
            craneAsset = new FoxWatchCraneRenderAsset
            {
                DisplayName = "LargeCrane",
                MeshId = "mesh-sk_largecrane",
                MeshSourcePath = LargeCraneMeshSourcePath,
                LocalLocationCentimeters = [0, 0, -650],
            };
        }

        _craneRenderAssetByStructureId[structureId] = craneAsset;
        return craneAsset;
    }

    private Task<FoxWatchRenderScenePose?> TryCreateDeployableTripodPoseAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        return TryCreateDeployableTripodPoseWithLegSpreadAsync(
            animationPackagePath,
            cancellationToken);
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateDeployableTripodPoseWithLegSpreadAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        var pose = await TryCreateSampledPoseAsync(
            profile: "deployable-tripod",
            animationPackagePath: animationPackagePath,
            referenceMeshAssetPath: DeployableTripodMeshSourcePath,
            parameters: CreateDeployableTripodPoseParameters(),
            cancellationToken);

        if (pose == null)
        {
            return null;
        }

        ApplyDeployableTripodLegSpread(pose);
        return pose;
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateLargeCranePoseAsync(CancellationToken cancellationToken)
    {
        return await TryCreateLargeCranePoseAsync(
            GetEnvironmentVariableString(
                LargeCranePoseOverrideEnvironmentVariableName,
                "War/Content/Animation/LargeCrane/Anim_LargeCrane_Pose_CraneLocation_1375dist_500height.uasset"),
            cancellationToken);
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateLargeCranePoseAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        if (IsLargeCraneHookDepthPose(animationPackagePath))
        {
            return await TryCreateLargeCraneHookDepthPoseAsync(animationPackagePath, cancellationToken);
        }

        if (IsLargeCraneHookRotationPose(animationPackagePath))
        {
            return await TryCreateLargeCraneHookRotationPoseAsync(animationPackagePath, cancellationToken);
        }

        var pose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: animationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (pose == null)
        {
            return null;
        }

        if (IsLargeCraneArmLocationPose(animationPackagePath))
        {
            await TryApplyLargeCraneNeutralArmOverlayAsync(pose, cancellationToken);
        }

        return pose;
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateLargeCraneHookDepthPoseAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        var basePose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: LargeCraneDefaultArmLocationAnimationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (basePose == null)
        {
            return null;
        }

        var hookReferencePose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: LargeCraneHorizontalRotationFrontAnimationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (hookReferencePose == null)
        {
            return basePose;
        }

        var hookDepthPose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: animationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (hookDepthPose != null)
        {
            ApplyRelativeMeshSpacePoseBoneSubtrees(basePose, hookDepthPose, hookReferencePose, ["Arm_Pivot"]);
        }

        var hookFrontPose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: LargeCraneHookRotationFrontAnimationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (hookFrontPose != null)
        {
            ApplyRelativeMeshSpacePoseBoneSubtrees(basePose, hookFrontPose, hookReferencePose, ["Arm_Pivot"]);
        }

        return basePose;
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateLargeCraneHookRotationPoseAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        var basePose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: LargeCraneDefaultArmLocationAnimationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (basePose == null)
        {
            return null;
        }

        var hookReferencePose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: LargeCraneHorizontalRotationFrontAnimationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (hookReferencePose == null)
        {
            return basePose;
        }

        var hookDepthPose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: LargeCraneHookDepthNeutralAnimationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (hookDepthPose != null)
        {
            ApplyRelativeMeshSpacePoseBoneSubtrees(basePose, hookDepthPose, hookReferencePose, ["Arm_Pivot"]);
        }

        var hookRotationPose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: animationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (hookRotationPose != null)
        {
            ApplyRelativeMeshSpacePoseBoneSubtrees(basePose, hookRotationPose, hookReferencePose, ["Arm_Pivot"]);
        }

        return basePose;
    }

    private async Task TryApplyLargeCraneNeutralArmOverlayAsync(FoxWatchRenderScenePose basePose, CancellationToken cancellationToken)
    {
        var hookReferencePose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: LargeCraneHorizontalRotationFrontAnimationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (hookReferencePose == null)
        {
            return;
        }

        var hookDepthPose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: LargeCraneHookDepthNeutralAnimationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (hookDepthPose != null)
        {
            ApplyRelativeMeshSpacePoseBoneSubtrees(basePose, hookDepthPose, hookReferencePose, ["Arm_Pivot"]);
        }

        var hookFrontPose = await TryCreateSampledPoseAsync(
            profile: "large-crane",
            animationPackagePath: LargeCraneHookRotationFrontAnimationPackagePath,
            referenceMeshAssetPath: LargeCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (hookFrontPose != null)
        {
            ApplyRelativeMeshSpacePoseBoneSubtrees(basePose, hookFrontPose, hookReferencePose, ["Arm_Pivot"]);
        }
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateSampledPoseAsync(
        string profile,
        string animationPackagePath,
        string? referenceMeshAssetPath,
        Dictionary<string, double> parameters,
        CancellationToken cancellationToken)
    {
        try
        {
            var sampledPose = await _meshAssetExporter.SampleAnimationPoseAsync(
                animationPackagePath,
                referenceMeshAssetPath: referenceMeshAssetPath,
                cancellationToken: cancellationToken);
            return new FoxWatchRenderScenePose
            {
                Type = "foxhole-bone-pose",
                Profile = profile,
                Parameters = parameters,
                Bones = [.. sampledPose.Bones.Select(bone => new FoxWatchRenderSceneBonePose
                {
                    Name = bone.Name,
                    ParentIndex = bone.ParentIndex,
                    Location = [.. bone.Location],
                    RotationQuaternion = [.. bone.RotationQuaternion],
                    Scale = [.. bone.Scale],
                })],
            };
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Failed to sample default crane pose from {AnimationPackagePath}", animationPackagePath);
            return null;
        }
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateFacilityCranePoseAsync(CancellationToken cancellationToken)
    {
        var parameters = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["horizontalDistanceCm"] = 450.0,
            ["craneHeightCm"] = 500.0,
        };

        var basePose = await TryCreateSampledPoseAsync(
            profile: "static-crane",
            animationPackagePath: "War/Content/Animation/WorldAssets/StaticCrane/Anim_StaticCrane_horizontalMovement_500.uasset",
            referenceMeshAssetPath: FacilityCraneMeshSourcePath,
            parameters: parameters,
            cancellationToken);
        if (basePose == null)
        {
            return null;
        }

        var hookDepthPose = await TryCreateSampledPoseAsync(
            profile: "static-crane",
            animationPackagePath: "War/Content/Animation/WorldAssets/StaticCrane/Anim_StaticCrane_hookDepth_0.uasset",
            referenceMeshAssetPath: FacilityCraneMeshSourcePath,
            parameters: parameters,
            cancellationToken);
        if (hookDepthPose == null)
        {
            return basePose;
        }

        OverlayPoseBones(
            basePose,
            hookDepthPose,
            [
                "arm_Pivot",
                "arm_partA",
                "arm_partB",
                "arm_partC",
                "arm_partD",
                "arm_hookAim",
                "hook",
                "hook_end",
                "counterweight",
            ]);

        return basePose;
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateBargePoseAsync(CancellationToken cancellationToken)
    {
        if (_bargePoseInitialized)
        {
            return ClonePose(_bargePose);
        }

        _bargePoseInitialized = true;
        _bargePose = await TryCreateBargePoseAsync(
            GetEnvironmentVariableString(
                BargePoseOverrideEnvironmentVariableName,
                BargeClosedNeutralPoseAnimationPackagePath),
            cancellationToken);

        return ClonePose(_bargePose);
    }

    private Task<FoxWatchRenderScenePose?> TryCreateBargePoseAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        return TryCreateBargePoseWithDoorCorrectionsAsync(animationPackagePath, cancellationToken);
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateBargePoseWithDoorCorrectionsAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        var pose = await TryCreateSampledPoseAsync(
            profile: "barge",
            animationPackagePath: animationPackagePath,
            referenceMeshAssetPath: BargeMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);

        if (pose == null)
        {
            return null;
        }

        InvertPoseBoneZAxisLocation(
            pose,
            [
                "frontDoor_extension01",
                "frontDoor_extension02",
            ]);

        if (IsBargeDoorExtensionPose(animationPackagePath))
        {
            var basePose = await TryCreateBargePoseAsync(cancellationToken);
            if (basePose == null)
            {
                return pose;
            }

            OverlayPoseBoneSubtrees(
                basePose,
                pose,
                [
                    "frontDoor_extension01",
                ]);

            return basePose;
        }

        return pose;
    }

    private static bool IsBargeDoorExtensionPose(string animationPackagePath)
    {
        return animationPackagePath.Contains("_door_closed", StringComparison.OrdinalIgnoreCase)
            || animationPackagePath.Contains("_door_halfextended", StringComparison.OrdinalIgnoreCase)
            || animationPackagePath.Contains("_door_fullyextended", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateFacilityCranePoseAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        var pose = await TryCreateSampledPoseAsync(
            profile: "static-crane",
            animationPackagePath: animationPackagePath,
            referenceMeshAssetPath: FacilityCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (pose == null)
        {
            return null;
        }

        return pose;
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateStaticCranePoseAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        var pose = await TryCreateSampledPoseAsync(
            profile: "static-crane",
            animationPackagePath: animationPackagePath,
            referenceMeshAssetPath: StaticCraneMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
        if (pose == null)
        {
            return null;
        }

        return pose;
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateDeployableTripodNeutralPoseAsync(CancellationToken cancellationToken)
    {
        if (_deployableTripodNeutralPoseInitialized)
        {
            return ClonePose(_deployableTripodNeutralPose);
        }

        _deployableTripodNeutralPoseInitialized = true;
        var basePose = await TryCreateSampledPoseAsync(
            profile: "deployable-tripod",
            animationPackagePath: GetEnvironmentVariableString(
                DeployableTripodHeightPoseOverrideEnvironmentVariableName,
                DeployableTripodHeightPoseAnimationPackagePath),
            referenceMeshAssetPath: DeployableTripodMeshSourcePath,
            parameters: CreateDeployableTripodPoseParameters(),
            cancellationToken);
        var neutralAimPose = await TryCreateSampledPoseAsync(
            profile: "deployable-tripod",
            animationPackagePath: GetEnvironmentVariableString(
                DeployableTripodNeutralPoseOverrideEnvironmentVariableName,
                DeployableTripodNeutralPoseAnimationPackagePath),
            referenceMeshAssetPath: DeployableTripodMeshSourcePath,
            parameters: CreateDeployableTripodPoseParameters(),
            cancellationToken);

        if (basePose != null && neutralAimPose != null)
        {
            OverlayPoseBones(basePose, neutralAimPose, ["horizontal_pivot", "vertical_pivot"]);
            ApplyDeployableTripodMountFlip(basePose);
            ApplyDeployableTripodLegSpread(basePose);
            _deployableTripodNeutralPose = basePose;
        }
        else
        {
            _deployableTripodNeutralPose = basePose ?? neutralAimPose;
            if (_deployableTripodNeutralPose != null)
            {
                ApplyDeployableTripodMountFlip(_deployableTripodNeutralPose);
                ApplyDeployableTripodLegSpread(_deployableTripodNeutralPose);
            }
        }

        return ClonePose(_deployableTripodNeutralPose);
    }

    private async Task<FoxWatchRenderScenePose?> TryCreateWindsockPoseAsync(CancellationToken cancellationToken)
    {
        if (_windsockPoseInitialized)
        {
            return ClonePose(_windsockPose);
        }

        _windsockPoseInitialized = true;
        _windsockPose = await TryCreateSampledPoseAsync(
            profile: "windsock",
            animationPackagePath: GetEnvironmentVariableString(
                WindsockPoseOverrideEnvironmentVariableName,
                WindsockPoseAnimationPackagePath),
            referenceMeshAssetPath: WindsockMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);

        return ClonePose(_windsockPose);
    }

    private Task<FoxWatchRenderScenePose?> TryCreateWindsockPoseAsync(string animationPackagePath, CancellationToken cancellationToken)
    {
        return TryCreateSampledPoseAsync(
            profile: "windsock",
            animationPackagePath: animationPackagePath,
            referenceMeshAssetPath: WindsockMeshSourcePath,
            parameters: CreatePoseParameters(),
            cancellationToken);
    }

    private static void OverlayPoseBones(
        FoxWatchRenderScenePose targetPose,
        FoxWatchRenderScenePose overlayPose,
        IReadOnlyCollection<string> boneNames)
    {
        if (targetPose.Bones == null || overlayPose.Bones == null || boneNames.Count == 0)
        {
            return;
        }

        var requestedBoneNames = boneNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var targetBonesByName = targetPose.Bones.ToDictionary(bone => bone.Name, StringComparer.OrdinalIgnoreCase);
        foreach (var overlayBone in overlayPose.Bones)
        {
            if (!requestedBoneNames.Contains(overlayBone.Name) ||
                !targetBonesByName.TryGetValue(overlayBone.Name, out var targetBone))
            {
                continue;
            }

            targetBone.ParentIndex = overlayBone.ParentIndex;
            targetBone.Location = overlayBone.Location == null ? null : [.. overlayBone.Location];
            targetBone.RotationQuaternion = overlayBone.RotationQuaternion == null ? null : [.. overlayBone.RotationQuaternion];
            targetBone.Scale = overlayBone.Scale == null ? null : [.. overlayBone.Scale];
        }
    }

    private static void ApplyDeployableTripodLegSpread(FoxWatchRenderScenePose pose)
    {
        RotatePoseBoneZAxisDegrees(pose, ["frontLegLeft_pivot"], 15.0);
        RotatePoseBoneZAxisDegrees(pose, ["frontLegRight_pivot"], -15.0);
    }

    private static void ApplyDeployableTripodMountFlip(FoxWatchRenderScenePose pose)
    {
        RotatePoseBoneXAxisDegrees(pose, ["horizontal_pivot", "vertical_pivot"], 180.0);
    }

    private static Dictionary<string, double> CreatePoseParameters()
    {
        return new Dictionary<string, double>(StringComparer.Ordinal);
    }

    private static Dictionary<string, double> CreateDeployableTripodPoseParameters()
    {
        return new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["relativeYawDegrees"] = 0.0,
            ["relativePitchDegrees"] = 0.0,
        };
    }

    private static void OverlayPoseBoneSubtrees(
        FoxWatchRenderScenePose targetPose,
        FoxWatchRenderScenePose overlayPose,
        IReadOnlyCollection<string> rootBoneNames)
    {
        if (overlayPose.Bones == null || rootBoneNames.Count == 0)
        {
            return;
        }

        var subtreeBoneNames = CollectPoseSubtreeBoneNames(overlayPose.Bones, rootBoneNames);
        if (subtreeBoneNames.Count == 0)
        {
            return;
        }

        OverlayPoseBones(targetPose, overlayPose, subtreeBoneNames);
    }

    private static void ApplyAdditivePoseBoneSubtrees(
        FoxWatchRenderScenePose targetPose,
        FoxWatchRenderScenePose additivePose,
        IReadOnlyCollection<string> rootBoneNames)
    {
        if (targetPose.Bones == null || additivePose.Bones == null || rootBoneNames.Count == 0)
        {
            return;
        }

        var subtreeBoneNames = CollectPoseSubtreeBoneNames(additivePose.Bones, rootBoneNames);
        if (subtreeBoneNames.Count == 0)
        {
            return;
        }

        ApplyAdditivePoseBones(targetPose, additivePose, subtreeBoneNames);
    }

    private static void ApplyRelativeMeshSpacePoseBoneSubtrees(
        FoxWatchRenderScenePose targetPose,
        FoxWatchRenderScenePose overlayPose,
        FoxWatchRenderScenePose referencePose,
        IReadOnlyCollection<string> rootBoneNames)
    {
        if (targetPose.Bones == null || overlayPose.Bones == null || referencePose.Bones == null || rootBoneNames.Count == 0)
        {
            return;
        }

        var subtreeBoneNames = CollectPoseSubtreeBoneNames(overlayPose.Bones, rootBoneNames);
        if (subtreeBoneNames.Count == 0)
        {
            return;
        }

        var requestedBoneNames = subtreeBoneNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var targetBonesByName = targetPose.Bones
            .Select((bone, index) => (bone, index))
            .ToDictionary(entry => entry.bone.Name, StringComparer.OrdinalIgnoreCase);
        var overlayBonesByName = overlayPose.Bones
            .Select((bone, index) => (bone, index))
            .ToDictionary(entry => entry.bone.Name, StringComparer.OrdinalIgnoreCase);
        var referenceBonesByName = referencePose.Bones
            .Select((bone, index) => (bone, index))
            .ToDictionary(entry => entry.bone.Name, StringComparer.OrdinalIgnoreCase);
        var targetWorldTransforms = BuildPoseWorldTransforms(targetPose.Bones);
        var overlayWorldTransforms = BuildPoseWorldTransforms(overlayPose.Bones);
        var referenceWorldTransforms = BuildPoseWorldTransforms(referencePose.Bones);

        foreach (var boneName in requestedBoneNames)
        {
            if (!targetBonesByName.TryGetValue(boneName, out var targetEntry) ||
                !overlayBonesByName.TryGetValue(boneName, out var overlayEntry) ||
                !referenceBonesByName.TryGetValue(boneName, out var referenceEntry))
            {
                continue;
            }

            var targetBone = targetEntry.bone;
            var targetBoneIndex = targetEntry.index;
            var targetWorld = targetWorldTransforms[targetBoneIndex];
            var overlayWorld = overlayWorldTransforms[overlayEntry.index];
            var referenceWorld = referenceWorldTransforms[referenceEntry.index];
            var deltaWorldRotation = Quaternion.Normalize(overlayWorld.Rotation * Quaternion.Inverse(referenceWorld.Rotation));
            var finalWorldRotation = Quaternion.Normalize(deltaWorldRotation * targetWorld.Rotation);
            var finalWorldLocation = targetWorld.Location;

            if (targetBone.ParentIndex >= 0 && targetBone.ParentIndex < targetWorldTransforms.Length)
            {
                var parentWorld = targetWorldTransforms[targetBone.ParentIndex];
                var parentInverseRotation = Quaternion.Inverse(parentWorld.Rotation);
                var localLocation = Vector3.Transform(finalWorldLocation - parentWorld.Location, parentInverseRotation);
                var localRotation = Quaternion.Normalize(parentInverseRotation * finalWorldRotation);
                targetBone.Location = [localLocation.X, localLocation.Y, localLocation.Z];
                targetBone.RotationQuaternion = [localRotation.X, localRotation.Y, localRotation.Z, localRotation.W];
            }
            else
            {
                targetBone.Location = [finalWorldLocation.X, finalWorldLocation.Y, finalWorldLocation.Z];
                targetBone.RotationQuaternion = [finalWorldRotation.X, finalWorldRotation.Y, finalWorldRotation.Z, finalWorldRotation.W];
            }
        }
    }

    private static void ApplyAdditivePoseBones(
        FoxWatchRenderScenePose targetPose,
        FoxWatchRenderScenePose additivePose,
        IReadOnlyCollection<string> boneNames)
    {
        if (targetPose.Bones == null || additivePose.Bones == null || boneNames.Count == 0)
        {
            return;
        }

        var requestedBoneNames = boneNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var targetBonesByName = targetPose.Bones
            .Select((bone, index) => (bone, index))
            .ToDictionary(entry => entry.bone.Name, StringComparer.OrdinalIgnoreCase);
        var additiveBonesByName = additivePose.Bones
            .Select((bone, index) => (bone, index))
            .ToDictionary(entry => entry.bone.Name, StringComparer.OrdinalIgnoreCase);
        var targetWorldTransforms = BuildPoseWorldTransforms(targetPose.Bones);
        var additiveWorldTransforms = BuildPoseWorldTransforms(additivePose.Bones);

        foreach (var boneName in requestedBoneNames)
        {
            if (!targetBonesByName.TryGetValue(boneName, out var targetEntry) ||
                !additiveBonesByName.TryGetValue(boneName, out var additiveEntry))
            {
                continue;
            }

            var targetBone = targetEntry.bone;
            var targetBoneIndex = targetEntry.index;
            var targetWorld = targetWorldTransforms[targetBoneIndex];
            var additiveWorld = additiveWorldTransforms[additiveEntry.index];
            var finalWorldRotation = Quaternion.Normalize(additiveWorld.Rotation * targetWorld.Rotation);
            var finalWorldLocation = targetWorld.Location + additiveWorld.Location;

            if (targetBone.ParentIndex >= 0 && targetBone.ParentIndex < targetWorldTransforms.Length)
            {
                var parentWorld = targetWorldTransforms[targetBone.ParentIndex];
                var parentInverseRotation = Quaternion.Inverse(parentWorld.Rotation);
                var localLocation = Vector3.Transform(finalWorldLocation - parentWorld.Location, parentInverseRotation);
                var localRotation = Quaternion.Normalize(parentInverseRotation * finalWorldRotation);
                targetBone.Location = [localLocation.X, localLocation.Y, localLocation.Z];
                targetBone.RotationQuaternion = [localRotation.X, localRotation.Y, localRotation.Z, localRotation.W];
            }
            else
            {
                targetBone.Location = [finalWorldLocation.X, finalWorldLocation.Y, finalWorldLocation.Z];
                targetBone.RotationQuaternion = [finalWorldRotation.X, finalWorldRotation.Y, finalWorldRotation.Z, finalWorldRotation.W];
            }
        }
    }

    private static HashSet<string> CollectPoseSubtreeBoneNames(
        IReadOnlyList<FoxWatchRenderSceneBonePose> bones,
        IReadOnlyCollection<string> rootBoneNames)
    {
        var requestedRootBoneNames = rootBoneNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var childBoneIndicesByParentIndex = new Dictionary<int, List<int>>();
        for (var boneIndex = 0; boneIndex < bones.Count; boneIndex += 1)
        {
            var parentIndex = bones[boneIndex].ParentIndex;
            if (!childBoneIndicesByParentIndex.TryGetValue(parentIndex, out var childBoneIndices))
            {
                childBoneIndices = [];
                childBoneIndicesByParentIndex[parentIndex] = childBoneIndices;
            }

            childBoneIndices.Add(boneIndex);
        }

        var subtreeBoneNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pendingBoneIndices = new Queue<int>();
        for (var boneIndex = 0; boneIndex < bones.Count; boneIndex += 1)
        {
            if (requestedRootBoneNames.Contains(bones[boneIndex].Name))
            {
                pendingBoneIndices.Enqueue(boneIndex);
            }
        }

        while (pendingBoneIndices.Count > 0)
        {
            var boneIndex = pendingBoneIndices.Dequeue();
            var bone = bones[boneIndex];
            if (!subtreeBoneNames.Add(bone.Name))
            {
                continue;
            }

            if (!childBoneIndicesByParentIndex.TryGetValue(boneIndex, out var childBoneIndices))
            {
                continue;
            }

            foreach (var childBoneIndex in childBoneIndices)
            {
                pendingBoneIndices.Enqueue(childBoneIndex);
            }
        }

        return subtreeBoneNames;
    }

    private static PoseWorldTransform[] BuildPoseWorldTransforms(IReadOnlyList<FoxWatchRenderSceneBonePose> bones)
    {
        var worldTransforms = new PoseWorldTransform[bones.Count];
        for (var boneIndex = 0; boneIndex < bones.Count; boneIndex += 1)
        {
            var bone = bones[boneIndex];
            var localLocation = ToVector3(bone.Location);
            var localRotation = ToQuaternion(bone.RotationQuaternion);
            var localScale = ToVector3(bone.Scale, Vector3.One);

            if (bone.ParentIndex < 0 || bone.ParentIndex >= bones.Count)
            {
                worldTransforms[boneIndex] = new PoseWorldTransform(localLocation, localRotation, localScale);
                continue;
            }

            var parentWorld = worldTransforms[bone.ParentIndex];
            var worldLocation = parentWorld.Location + Vector3.Transform(localLocation, parentWorld.Rotation);
            var worldRotation = Quaternion.Normalize(parentWorld.Rotation * localRotation);
            var worldScale = new Vector3(
                parentWorld.Scale.X * localScale.X,
                parentWorld.Scale.Y * localScale.Y,
                parentWorld.Scale.Z * localScale.Z);
            worldTransforms[boneIndex] = new PoseWorldTransform(worldLocation, worldRotation, worldScale);
        }

        return worldTransforms;
    }

    private static Vector3 ToVector3(IReadOnlyList<double>? values)
    {
        return ToVector3(values, Vector3.Zero);
    }

    private static Vector3 ToVector3(IReadOnlyList<double>? values, Vector3 defaultValue)
    {
        if (values is not { Count: >= 3 })
        {
            return defaultValue;
        }

        return new Vector3(
            (float)values[0],
            (float)values[1],
            (float)values[2]);
    }

    private static Quaternion ToQuaternion(IReadOnlyList<double>? values)
    {
        if (values is not { Count: >= 4 })
        {
            return Quaternion.Identity;
        }

        return Quaternion.Normalize(new Quaternion(
            (float)values[0],
            (float)values[1],
            (float)values[2],
            (float)values[3]));
    }

    private static void InvertPoseBoneXAxisRotation(
        FoxWatchRenderScenePose targetPose,
        IReadOnlyCollection<string> boneNames)
    {
        if (targetPose.Bones == null || boneNames.Count == 0)
        {
            return;
        }

        var requestedBoneNames = boneNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var bone in targetPose.Bones)
        {
            if (!requestedBoneNames.Contains(bone.Name) || bone.RotationQuaternion is not { Count: >= 4 })
            {
                continue;
            }

            bone.RotationQuaternion[0] *= -1.0;
        }
    }

    private static void RotatePoseBoneXAxisDegrees(
        FoxWatchRenderScenePose targetPose,
        IReadOnlyCollection<string> boneNames,
        double degrees)
    {
        if (targetPose.Bones == null || boneNames.Count == 0 || Math.Abs(degrees) < double.Epsilon)
        {
            return;
        }

        var requestedBoneNames = boneNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var halfRadians = degrees * Math.PI / 360.0;
        var delta = Quaternion.Normalize(new Quaternion((float)Math.Sin(halfRadians), 0f, 0f, (float)Math.Cos(halfRadians)));

        foreach (var bone in targetPose.Bones)
        {
            if (!requestedBoneNames.Contains(bone.Name) || bone.RotationQuaternion is not { Count: >= 4 })
            {
                continue;
            }

            var current = new Quaternion(
                (float)bone.RotationQuaternion[0],
                (float)bone.RotationQuaternion[1],
                (float)bone.RotationQuaternion[2],
                (float)bone.RotationQuaternion[3]);
            var adjusted = Quaternion.Normalize(current * delta);
            bone.RotationQuaternion[0] = adjusted.X;
            bone.RotationQuaternion[1] = adjusted.Y;
            bone.RotationQuaternion[2] = adjusted.Z;
            bone.RotationQuaternion[3] = adjusted.W;
        }
    }

    private static void InvertPoseBoneZAxisLocation(
        FoxWatchRenderScenePose targetPose,
        IReadOnlyCollection<string> boneNames)
    {
        if (targetPose.Bones == null || boneNames.Count == 0)
        {
            return;
        }

        var requestedBoneNames = boneNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var bone in targetPose.Bones)
        {
            if (!requestedBoneNames.Contains(bone.Name) || bone.Location is not { Count: >= 3 })
            {
                continue;
            }

            bone.Location[2] *= -1.0;
        }
    }

    private static void RotatePoseBoneYAxisDegrees(
        FoxWatchRenderScenePose targetPose,
        IReadOnlyCollection<string> boneNames,
        double degrees)
    {
        if (targetPose.Bones == null || boneNames.Count == 0 || Math.Abs(degrees) < double.Epsilon)
        {
            return;
        }

        var requestedBoneNames = boneNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var halfRadians = degrees * Math.PI / 360.0;
        var delta = Quaternion.Normalize(new Quaternion(0f, (float)Math.Sin(halfRadians), 0f, (float)Math.Cos(halfRadians)));

        foreach (var bone in targetPose.Bones)
        {
            if (!requestedBoneNames.Contains(bone.Name) || bone.RotationQuaternion is not { Count: >= 4 })
            {
                continue;
            }

            var current = new Quaternion(
                (float)bone.RotationQuaternion[0],
                (float)bone.RotationQuaternion[1],
                (float)bone.RotationQuaternion[2],
                (float)bone.RotationQuaternion[3]);
            var adjusted = Quaternion.Normalize(current * delta);
            bone.RotationQuaternion[0] = adjusted.X;
            bone.RotationQuaternion[1] = adjusted.Y;
            bone.RotationQuaternion[2] = adjusted.Z;
            bone.RotationQuaternion[3] = adjusted.W;
        }
    }

    private static void RotatePoseBoneZAxisDegrees(
        FoxWatchRenderScenePose targetPose,
        IReadOnlyCollection<string> boneNames,
        double degrees)
    {
        if (targetPose.Bones == null || boneNames.Count == 0 || Math.Abs(degrees) < double.Epsilon)
        {
            return;
        }

        var requestedBoneNames = boneNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var halfRadians = degrees * Math.PI / 360.0;
        var delta = Quaternion.Normalize(new Quaternion(0f, 0f, (float)Math.Sin(halfRadians), (float)Math.Cos(halfRadians)));

        foreach (var bone in targetPose.Bones)
        {
            if (!requestedBoneNames.Contains(bone.Name) || bone.RotationQuaternion is not { Count: >= 4 })
            {
                continue;
            }

            var current = new Quaternion(
                (float)bone.RotationQuaternion[0],
                (float)bone.RotationQuaternion[1],
                (float)bone.RotationQuaternion[2],
                (float)bone.RotationQuaternion[3]);
            var adjusted = Quaternion.Normalize(current * delta);
            bone.RotationQuaternion[0] = adjusted.X;
            bone.RotationQuaternion[1] = adjusted.Y;
            bone.RotationQuaternion[2] = adjusted.Z;
            bone.RotationQuaternion[3] = adjusted.W;
        }
    }

    private static double GetEnvironmentVariableDouble(string variableName, double fallback)
    {
        var rawValue = Environment.GetEnvironmentVariable(variableName);
        return double.TryParse(rawValue, NumberStyles.Float | NumberStyles.AllowThousands, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
    }

    private static string GetEnvironmentVariableString(string variableName, string fallback)
    {
        var rawValue = Environment.GetEnvironmentVariable(variableName);
        return string.IsNullOrWhiteSpace(rawValue)
            ? fallback
            : rawValue.Trim();
    }

    private IReadOnlyList<string> GetDeployableTripodPoseAnimationPackagePaths()
    {
        return _deployableTripodPoseAnimationPackagePaths ??= _meshAssetExporter
            .FindPackages("Tripod_POSE_", limit: 100, pathPrefix: "War/Content/Animation/Weapons/DeployableTripod/")
            .Where(path => path.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    private IReadOnlyList<string> GetBargePoseAnimationPackagePaths()
    {
        return _bargePoseAnimationPackagePaths ??= _meshAssetExporter
            .FindPackages("Anim_Barge_POSE_", limit: 100, pathPrefix: "War/Content/Animation/WaterVehicles/Barge/")
            .Where(path => path.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    private IReadOnlyList<string> GetFacilityCranePoseAnimationPackagePaths()
    {
        return _facilityCranePoseAnimationPackagePaths ??= _meshAssetExporter
            .FindPackages("Anim_StaticCrane_", limit: 100, pathPrefix: "War/Content/Animation/WorldAssets/StaticCrane/")
            .Where(path => path.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    private IReadOnlyList<string> GetWindsockPoseAnimationPackagePaths()
    {
        return _windsockPoseAnimationPackagePaths ??= _meshAssetExporter
            .FindPackages("ANIM_Windsock_", limit: 20, pathPrefix: "War/Content/Animation/Weapons/DeployableTripod/")
            .Where(path => path.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    private IReadOnlyList<string> GetLargeCranePoseAnimationPackagePaths()
    {
        return _largeCranePoseAnimationPackagePaths ??= _meshAssetExporter
            .FindPackages("Anim_LargeCrane_Pose_", limit: 100, pathPrefix: "War/Content/Animation/LargeCrane/")
            .Where(path => path.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    private static bool IsLargeCraneArmLocationPose(string animationPackagePath)
    {
        return animationPackagePath.Contains("Pose_CraneLocation_", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsLargeCraneHookDepthPose(string animationPackagePath)
    {
        return animationPackagePath.Contains("Pose_hookDepth_", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsLargeCraneHookRotationPose(string animationPackagePath)
    {
        return animationPackagePath.Contains("Pose_hook_", StringComparison.OrdinalIgnoreCase)
            && !animationPackagePath.Contains("Pose_hookDepth_", StringComparison.OrdinalIgnoreCase);
    }

    private static string CreatePoseVariantId(string prefix, string animationPackagePath)
    {
        var fileName = Path.GetFileNameWithoutExtension(animationPackagePath.Replace('/', Path.DirectorySeparatorChar));
        var builder = new StringBuilder(prefix.Length + fileName.Length + 1);
        builder.Append(prefix);
        builder.Append('-');

        var previousWasSeparator = true;
        foreach (var character in fileName)
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(char.ToLowerInvariant(character));
                previousWasSeparator = false;
                continue;
            }

            if (!previousWasSeparator)
            {
                builder.Append('-');
                previousWasSeparator = true;
            }
        }

        return builder.ToString().TrimEnd('-');
    }

    private static bool ApplyPoseToFirstMatchingNode(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string meshId,
        FoxWatchRenderScenePose pose)
    {
        foreach (var node in nodes)
        {
            if (string.Equals(node.MeshId, meshId, StringComparison.OrdinalIgnoreCase))
            {
                node.Pose = pose;
                return true;
            }

            if (ApplyPoseToFirstMatchingNode(node.Children, meshId, pose))
            {
                return true;
            }
        }

        return false;
    }

    private static int ApplyPoseToMatchingNodes(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string meshId,
        FoxWatchRenderScenePose pose)
    {
        var appliedCount = 0;
        foreach (var node in nodes)
        {
            if (string.Equals(node.MeshId, meshId, StringComparison.OrdinalIgnoreCase))
            {
                node.Pose = ClonePose(pose);
                appliedCount += 1;
            }

            appliedCount += ApplyPoseToMatchingNodes(node.Children, meshId, pose);
        }

        return appliedCount;
    }

    private static int ApplyPoseVariantsToMatchingNodes(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string meshId,
        IReadOnlyDictionary<string, FoxWatchRenderScenePose> poseVariants)
    {
        var appliedCount = 0;
        foreach (var node in nodes)
        {
            if (string.Equals(node.MeshId, meshId, StringComparison.OrdinalIgnoreCase))
            {
                node.PoseVariants = poseVariants.ToDictionary(
                    entry => entry.Key,
                    entry => ClonePose(entry.Value)!,
                    StringComparer.OrdinalIgnoreCase);
                appliedCount += 1;
            }

            appliedCount += ApplyPoseVariantsToMatchingNodes(node.Children, meshId, poseVariants);
        }

        return appliedCount;
    }

    private static int AttachChildMeshesToBoneForMatchingNodes(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string meshId,
        string boneName)
    {
        var attachedCount = 0;
        foreach (var node in nodes)
        {
            if (string.Equals(node.MeshId, meshId, StringComparison.OrdinalIgnoreCase))
            {
                foreach (var child in node.Children)
                {
                    if (!string.IsNullOrWhiteSpace(child.MeshId) && string.IsNullOrWhiteSpace(child.AttachBoneName))
                    {
                        child.AttachBoneName = boneName;
                        attachedCount += 1;
                    }
                }
            }

            attachedCount += AttachChildMeshesToBoneForMatchingNodes(node.Children, meshId, boneName);
        }

        return attachedCount;
    }

    private readonly record struct PoseWorldTransform(Vector3 Location, Quaternion Rotation, Vector3 Scale);

    private static bool ContainsMeshId(
        IEnumerable<FoxWatchRenderSceneNode> nodes,
        string meshId)
    {
        foreach (var node in nodes)
        {
            if (string.Equals(node.MeshId, meshId, StringComparison.OrdinalIgnoreCase) ||
                ContainsMeshId(node.Children, meshId))
            {
                return true;
            }
        }

        return false;
    }

    private static readonly Dictionary<string, string> FoundationMaterialSidecarReferenceMeshPackagePaths =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["FacilityFoundationConcrete"] = "War/Content/Meshes/Structures/Foundations/Foundation01T3.uasset",
            ["FacilityFoundationDirt"] = "War/Content/Meshes/Structures/Foundations/Foundation01_1x2_T1.uasset",
        };

    private async Task PopulateMeshExportsAsync(IEnumerable<FoxWatchRenderSceneMeshAsset> meshAssets, string? renderAssetOutputDirectory, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(renderAssetOutputDirectory))
        {
            return;
        }

        var meshAssetList = meshAssets as IList<FoxWatchRenderSceneMeshAsset> ?? [.. meshAssets];
        foreach (var meshAsset in meshAssetList)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var meshPackagePath = ConvertMeshSourcePathToPackagePath(meshAsset.SourcePath);
            if (string.IsNullOrWhiteSpace(meshPackagePath))
            {
                continue;
            }

            if (_exportUrlByPackagePath.TryGetValue(meshPackagePath, out var cachedExportUrl))
            {
                meshAsset.ExportUrl = cachedExportUrl;
                continue;
            }

            var exportUrl = BuildExportUrl(meshPackagePath);
            var expectedExportPath = BuildExportPath(renderAssetOutputDirectory, exportUrl);
            if (!string.IsNullOrWhiteSpace(expectedExportPath) && !File.Exists(expectedExportPath))
            {
                var result = await _meshAssetExporter.ExportMeshAsync(meshPackagePath, renderAssetOutputDirectory, cancellationToken);
                exportUrl = BuildExportUrlFromSavedFilePath(renderAssetOutputDirectory, result.SavedFilePath) ?? exportUrl;
            }

            meshAsset.ExportUrl = exportUrl;
            _exportUrlByPackagePath[meshPackagePath] = exportUrl;
        }

        foreach (var materialSidecarName in meshAssetList
                     .Select(meshAsset => meshAsset.MaterialSidecarNameOverride)
                     .Where(value => !string.IsNullOrWhiteSpace(value))
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!FoundationMaterialSidecarReferenceMeshPackagePaths.TryGetValue(materialSidecarName!, out var referenceMeshPackagePath) ||
                _exportUrlByPackagePath.ContainsKey(referenceMeshPackagePath))
            {
                continue;
            }

            cancellationToken.ThrowIfCancellationRequested();
            await _meshAssetExporter.ExportMeshAsync(referenceMeshPackagePath, renderAssetOutputDirectory, cancellationToken);
            _exportUrlByPackagePath[referenceMeshPackagePath] = BuildExportUrl(referenceMeshPackagePath) ?? referenceMeshPackagePath;
        }
    }

    private static string? ConvertMeshSourcePathToPackagePath(string? sourcePath)
    {
        if (string.IsNullOrWhiteSpace(sourcePath))
        {
            return null;
        }

        var normalized = sourcePath.Replace('\\', '/').Trim();
        var warIndex = normalized.IndexOf("War/Content/", StringComparison.OrdinalIgnoreCase);
        if (warIndex >= 0)
        {
            normalized = normalized[warIndex..];
        }

        if (normalized.EndsWith(".glb", StringComparison.OrdinalIgnoreCase))
        {
            return $"{normalized[..^".glb".Length]}.uasset";
        }

        return normalized.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase)
            ? normalized
            : $"{normalized}.uasset";
    }

    private static string? BuildExportUrl(string? packagePath)
    {
        if (string.IsNullOrWhiteSpace(packagePath))
        {
            return null;
        }

        return packagePath
            .Replace('\\', '/')
            .Replace(".uasset", ".glb", StringComparison.OrdinalIgnoreCase);
    }

    private static string? BuildExportPath(string outputDirectory, string? exportUrl)
    {
        if (string.IsNullOrWhiteSpace(exportUrl))
        {
            return null;
        }

        var relativePath = exportUrl.Replace('/', Path.DirectorySeparatorChar);
        return Path.Combine(outputDirectory, relativePath);
    }

    private static string? BuildExportUrlFromSavedFilePath(string outputDirectory, string? savedFilePath)
    {
        if (string.IsNullOrWhiteSpace(outputDirectory) || string.IsNullOrWhiteSpace(savedFilePath))
        {
            return null;
        }

        var relativePath = Path.GetRelativePath(outputDirectory, savedFilePath);
        if (relativePath.StartsWith("..", StringComparison.Ordinal))
        {
            return null;
        }

        return relativePath.Replace('\\', '/');
    }

    private static double? GetTopdownPaddingFactor(FoxWatchManifestStructure structure)
    {
        return null;
    }

    private static double? GetTopdownPaddingMeters(FoxWatchManifestStructure structure)
    {
        return null;
    }

    private static bool GetClipFloor(FoxWatchManifestStructure structure)
    {
        return structure.ClipFloor ?? (structure.IsVehicle != true && structure.IsItem != true);
    }

    private static FoxWatchBounds3D? GetClipBounds(FoxWatchManifestStructure structure)
    {
        return NormalizeClipBounds(structure.ClipBounds);
    }

    private static string GetAssetTypeName(FoxWatchManifestStructure structure)
    {
        if (structure.IsVehicle == true)
        {
            return "vehicles";
        }

        if (structure.IsItem == true)
        {
            return "items";
        }

        return "structures";
    }

    private static double GetFloorZ(FoxWatchManifestStructure structure)
    {
        return structure.ClipFloorZ ?? 0;
    }

    private static FoxWatchBounds3D? NormalizeClipBounds(FoxWatchBounds3D? clipBounds)
    {
        var min = NormalizeClipBoundsVector(clipBounds?.Min);
        var max = NormalizeClipBoundsVector(clipBounds?.Max);
        if (min == null || max == null)
        {
            return null;
        }

        return new FoxWatchBounds3D
        {
            Min =
            [
                Math.Min(min[0], max[0]),
                Math.Min(min[1], max[1]),
                Math.Min(min[2], max[2]),
            ],
            Max =
            [
                Math.Max(min[0], max[0]),
                Math.Max(min[1], max[1]),
                Math.Max(min[2], max[2]),
            ],
            TransformMatrix = NormalizeClipBoundsMatrix(clipBounds?.TransformMatrix),
        };
    }

    private static double[]? NormalizeClipBoundsVector(List<double>? values)
    {
        if (values == null || values.Count < 3)
        {
            return null;
        }

        return [values[0], values[1], values[2]];
    }

    private static List<double>? NormalizeClipBoundsMatrix(List<double>? values)
    {
        if (values == null || values.Count < 16)
        {
            return null;
        }

        return [.. values.Take(16)];
    }

    private static int GetStandaloneModificationVariantMetadataScore(FoxWatchManifestModificationSlotVariant variant)
    {
        var score = 0;
        if (!string.IsNullOrWhiteSpace(variant.TemplateActorPath))
        {
            score += 8;
        }

        if (!string.IsNullOrWhiteSpace(variant.TemplateMeshPath))
        {
            score += 4;
        }

        if (!string.IsNullOrWhiteSpace(variant.PreviewMeshPath))
        {
            score += 2;
        }

        if (!string.IsNullOrWhiteSpace(variant.PreviewDirection))
        {
            score += 1;
        }

        return score;
    }

    private static string ResolveModificationPreviewDirection(
        FoxWatchManifestModificationSlotVariant? variant,
        FoxWatchManifestStructure structure)
    {
        return GetPreviewDirection(structure, variant?.PreviewDirection);
    }

    private static SharedModificationHashDiagnosticInput CreateSharedModificationHashDiagnosticInput(string? value)
    {
        return new SharedModificationHashDiagnosticInput
        {
            Raw = value ?? string.Empty,
            Normalized = NormalizeStandaloneModificationIdentityPart(value),
        };
    }

    private static string ResolveTemplatePathForSharedModificationIdentity(FoxWatchManifestModificationSlotVariant? variant)
    {
        if (!string.IsNullOrWhiteSpace(variant?.TemplateActorPath))
        {
            return variant.TemplateActorPath;
        }

        if (!string.IsNullOrWhiteSpace(variant?.TemplateMeshPath))
        {
            return variant.TemplateMeshPath;
        }

        if (!string.IsNullOrWhiteSpace(variant?.PreviewMeshPath))
        {
            return variant.PreviewMeshPath;
        }

        return string.Empty;
    }

    private static string CreateSharedModificationHashDiagnosticsRunId()
    {
        return $"{DateTimeOffset.UtcNow.ToString("yyyyMMddTHHmmssfffZ", CultureInfo.InvariantCulture)}-pid{Environment.ProcessId}";
    }

    private async Task WriteSharedModificationHashDiagnosticsAsync(
        string runId,
        string outputDirectory,
        string? renderAssetOutputDirectory,
        string baseAssetsUrl,
        string? pakDirectoryPath,
        JsonSerializerOptions serializerOptions,
        CancellationToken cancellationToken)
    {
        var diagnosticsDirectory = Path.Combine(FoxWatchWorkspace.RepositoryRoot, SharedModificationHashDiagnosticsRelativeDirectory.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(diagnosticsDirectory);

        var diagnosticsPath = Path.Combine(diagnosticsDirectory, $"{runId}-render-scene-generator.json");
        var document = new SharedModificationHashDiagnosticsDocument
        {
            Source = "render-scene-generator",
            RunId = runId,
            GeneratedAtUtc = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
            ProcessId = Environment.ProcessId,
            OutputDirectory = outputDirectory,
            RenderAssetOutputDirectory = renderAssetOutputDirectory,
            BaseAssetsUrl = baseAssetsUrl,
            PakDirectoryPath = pakDirectoryPath,
            EntryCount = _sharedModificationHashDiagnostics.Count,
            Entries = [.. _sharedModificationHashDiagnostics],
        };

        var json = JsonSerializer.Serialize(document, serializerOptions);
        await File.WriteAllTextAsync(diagnosticsPath, $"{json}{Environment.NewLine}", cancellationToken);
        _logger.LogInformation("Wrote {DiagnosticCount} shared modification hash diagnostics to {DiagnosticsPath}", _sharedModificationHashDiagnostics.Count, diagnosticsPath);
    }

    private static string NormalizeStandaloneModificationIdentityPart(string? value)
    {
        return string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : value.Trim().ToLowerInvariant();
    }

    private static string NormalizeStandaloneModificationKeyComponent(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        var needsSeparator = false;
        foreach (var character in value.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(character);
                needsSeparator = false;
                continue;
            }

            if (!needsSeparator && builder.Length > 0)
            {
                builder.Append('-');
                needsSeparator = true;
            }
        }

        return builder.ToString().Trim('-');
    }

    private static string GetPreviewDirection(FoxWatchManifestStructure structure, string? previewDirectionOverride = null)
    {
        return string.IsNullOrWhiteSpace(previewDirectionOverride)
            ? (string.IsNullOrWhiteSpace(structure.PreviewDirection)
            ? "se"
            : structure.PreviewDirection.Trim().ToLowerInvariant())
            : previewDirectionOverride.Trim().ToLowerInvariant();
    }

    private sealed class StandaloneModificationRenderTarget
    {
        public string VariantId { get; set; } = string.Empty;

        public string SlotName { get; set; } = string.Empty;

        public string? DataClassPath { get; set; }

        public string OutputKey { get; set; } = string.Empty;

        public bool IsUpgrade { get; set; }

        public string RenderId { get; set; } = string.Empty;

        public string SharedModificationId { get; set; } = string.Empty;

        public string PreviewDirection { get; set; } = string.Empty;

        public List<FoxWatchRenderSceneConsumer> Consumers { get; set; } = [];
    }

    private sealed class FoxWatchCraneRenderAsset
    {
        public string DisplayName { get; set; } = string.Empty;

        public string MeshId { get; set; } = string.Empty;

        public string MeshSourcePath { get; set; } = string.Empty;

        public List<double>? LocalLocationCentimeters { get; set; }

        public List<double>? LocalRotationDegrees { get; set; }

        public FoxWatchRenderScenePose? Pose { get; set; }
    }
}
