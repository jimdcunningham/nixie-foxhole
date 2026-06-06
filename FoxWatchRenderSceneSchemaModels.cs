namespace FoxWatchService;

public sealed class FoxWatchRenderSceneDocument
{
    public string SchemaVersion { get; set; } = "1.0.0";

    public FoxWatchRenderSceneStructure Structure { get; set; } = new();

    public List<FoxWatchRenderSceneVariant>? Variants { get; set; }

    public FoxWatchRenderSceneRenderSettings Render { get; set; } = new();

    public FoxWatchRenderSceneGraph Scene { get; set; } = new();

    public FoxWatchRenderSceneAssets Assets { get; set; } = new();
}

public sealed class FoxWatchRenderSceneStructure
{
    public string Id { get; set; } = string.Empty;

    public string AssetType { get; set; } = "structures";

    public string CodeName { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string CategoryId { get; set; } = string.Empty;

    public string CategoryName { get; set; } = string.Empty;
}

public sealed class FoxWatchRenderSceneRenderSettings
{
    public string OutputKey { get; set; } = string.Empty;

    public List<string>? Modes { get; set; }

    public string PreviewDirection { get; set; } = "se";

    public bool? GenerateDefaultIcon { get; set; }

    public bool TransparentBackground { get; set; } = true;

    public bool ClipFloor { get; set; } = true;

    public double FloorZ { get; set; }

    public FoxWatchBounds3D? ClipBounds { get; set; }

    public double? TopdownPaddingFactor { get; set; }

    public double? TopdownPaddingMeters { get; set; }

    public string? MaterialMode { get; set; }
}

public sealed class FoxWatchRenderSceneGraph
{
    public List<FoxWatchRenderSceneNode> Roots { get; set; } = [];
}

public sealed class FoxWatchRenderSceneNode
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool Visible { get; set; } = true;

    public List<string>? VariantIds { get; set; }

    public string? MeshId { get; set; }

    public FoxWatchRenderScenePrimitive? Primitive { get; set; }

    public List<string> MaterialIds { get; set; } = [];

    public List<double>? Location { get; set; }

    public List<double>? RotationEulerDegrees { get; set; }

    public List<double>? Scale { get; set; }

    public List<double>? UnrealLocationCentimeters { get; set; }

    public List<double>? UnrealSceneLocationCentimeters { get; set; }

    public List<double>? UnrealRotationDegrees { get; set; }

    public List<double>? DebugColor { get; set; }

    public List<double>? MarkerColor { get; set; }

    public double? MarkerSize { get; set; }

    public FoxWatchRenderScenePose? Pose { get; set; }

    public Dictionary<string, FoxWatchRenderScenePose>? PoseVariants { get; set; }

    public string? AttachBoneName { get; set; }

    public List<double> TransformMatrix { get; set; } = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ];

    public List<FoxWatchRenderSceneNode> Children { get; set; } = [];
}

public sealed class FoxWatchRenderScenePrimitive
{
    public string Type { get; set; } = string.Empty;

    public List<List<double>>? Points { get; set; }

    public List<double>? Color { get; set; }

    public double? Radius { get; set; }

    public double? Width { get; set; }

    public double? Height { get; set; }
}

public sealed class FoxWatchRenderScenePose
{
    public string Type { get; set; } = string.Empty;

    public string? Profile { get; set; }

    public Dictionary<string, double>? Parameters { get; set; }

    public List<FoxWatchRenderSceneBonePose>? Bones { get; set; }
}

public sealed class FoxWatchRenderSceneBonePose
{
    public string Name { get; set; } = string.Empty;

    public int ParentIndex { get; set; } = -1;

    public List<double>? Location { get; set; }

    public List<double>? RotationQuaternion { get; set; }

    public List<double>? Scale { get; set; }
}

public sealed class FoxWatchRenderSceneVariant
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool IsDefault { get; set; }

    public string? ColorHex { get; set; }

    public bool? PlaceVariantAfterMode { get; set; }
}

public sealed class FoxWatchRenderSceneAssets
{
    public List<FoxWatchRenderSceneMeshAsset> Meshes { get; set; } = [];

    public List<FoxWatchRenderSceneMaterialAsset> Materials { get; set; } = [];
}

public sealed class FoxWatchRenderSceneMeshAsset
{
    public string Id { get; set; } = string.Empty;

    public string? SourcePath { get; set; }

    public string? ExportUrl { get; set; }

    public string? DefaultPoseAnimationPackagePath { get; set; }

    public List<string>? PoseAnimationPackagePaths { get; set; }
}

public sealed class FoxWatchRenderSceneMaterialAsset
{
    public string Id { get; set; } = string.Empty;

    public string? Name { get; set; }

    public Dictionary<string, string> Textures { get; set; } = [];
}

public sealed class FoxWatchRenderSceneIndex
{
    public string SchemaVersion { get; set; } = "1.0.0";

    public List<FoxWatchRenderSceneIndexEntry> Scenes { get; set; } = [];
}

public sealed class FoxWatchRenderSceneIndexEntry
{
    public string StructureId { get; set; } = string.Empty;

    public List<string> AllowedStructureIds { get; set; } = [];

    public List<FoxWatchRenderSceneConsumer> Consumers { get; set; } = [];

    public string CodeName { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string CategoryId { get; set; } = string.Empty;

    public string OutputPath { get; set; } = string.Empty;

    public string? PreviewUrl { get; set; }

    public string? IconUrl { get; set; }
}

public sealed class FoxWatchRenderSceneConsumer
{
    public string StructureId { get; set; } = string.Empty;

    public string VariantId { get; set; } = string.Empty;
}
