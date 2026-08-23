namespace FoxWatchService;

using System.Text.Json.Serialization;

public sealed class FoxWatchManifest
{
    public string SchemaVersion { get; set; } = "1.0.0";

    public FoxWatchManifestSource Source { get; set; } = new();

    public FoxWatchManifestShared Shared { get; set; } = new();

    public List<FoxWatchManifestCategory> Categories { get; set; } = [];

    public List<FoxWatchManifestStructure> Assets { get; set; } = [];

    public List<FoxWatchManifestItem> Items { get; set; } = [];

    public List<FoxWatchLocalizationBundle> Localizations { get; set; } = [];
}

public sealed class FoxWatchManifestShared
{
    public FoxWatchManifestBunkerDestruction? BunkerDestruction { get; set; }
}

public sealed class FoxWatchManifestBunkerDestruction
{
    public Dictionary<string, FoxWatchManifestBunkerDestructionWeapon> Weapons { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class FoxWatchManifestBunkerDestructionWeapon
{
    public string? Name { get; set; }

    public string? CodeName { get; set; }

    public double? Damage { get; set; }

    public FoxWatchManifestBunkerDestructionDamageType? DamageType { get; set; }
}

public sealed class FoxWatchManifestBunkerDestructionDamageType
{
    public string? Name { get; set; }

    public string? Description { get; set; }

    public Dictionary<string, double>? Multipliers { get; set; }

    public Dictionary<string, double>? Profiles { get; set; }
}

public sealed class FoxWatchManifestSource
{
    public string Kind { get; set; } = "foxwatch";
}

public sealed class FoxWatchLocalizedText
{
    public string Id { get; set; } = string.Empty;

    public string Fallback { get; set; } = string.Empty;
}

public sealed class FoxWatchTextureVariant
{
    public string TextureUrl { get; set; } = string.Empty;
}

public sealed class FoxWatchSprite
{
    public double? Width { get; set; }

    public double? Height { get; set; }

    public double AnchorX { get; set; } = 0.5;

    public double AnchorY { get; set; } = 0.5;

    public double OffsetX { get; set; }

    public double OffsetY { get; set; }
}

public sealed class FoxWatchBounds3D
{
    public List<double> Min { get; set; } = [];

    public List<double> Max { get; set; } = [];

    public List<double>? TransformMatrix { get; set; }
}

public sealed class FoxWatchTextureVariants
{
    public FoxWatchTextureVariant? Default { get; set; }

    public FoxWatchTextureVariant? C { get; set; }

    public FoxWatchTextureVariant? W { get; set; }
}

public sealed class FoxWatchManifestColorVariant
{
    public string Hex { get; set; } = string.Empty;
}

public sealed class FoxWatchManifestDestroyedVisual
{
    public string? ComponentName { get; set; }
}

public sealed class FoxWatchManifestPackagedPalletOffset
{
    public double? X { get; set; }

    public double? Y { get; set; }

    public double? RotationDegrees { get; set; }
}

public sealed class FoxWatchManifestPackagedVisual
{
    public string? MeshPackagePath { get; set; }

    public string? ShippableType { get; set; }

    public FoxWatchManifestPackagedPalletOffset? PalletOffset { get; set; }
}

public sealed class FoxWatchManifestCategory
{
    public string Id { get; set; } = string.Empty;

    public FoxWatchLocalizedText Name { get; set; } = new();

    public string? IconUrl { get; set; }

    public int Order { get; set; }
}

public sealed class FoxWatchManifestStructure
{
    public string Id { get; set; } = string.Empty;

    public string CodeName { get; set; } = string.Empty;

    public string? LegacyKey { get; set; }

    [JsonPropertyName("legacyKeys")]
    public List<string>? LegacyKeysCompat
    {
        get => null;
        set
        {
            if (string.IsNullOrWhiteSpace(LegacyKey))
            {
                LegacyKey = value?
                    .Select(entry => entry?.Trim())
                    .FirstOrDefault(entry => !string.IsNullOrWhiteSpace(entry));
            }
        }
    }

    public FoxWatchLocalizedText Name { get; set; } = new();

    public FoxWatchLocalizedText Description { get; set; } = new();

    public string CategoryId { get; set; } = string.Empty;

    [JsonIgnore]
    public FoxWatchLocalizedText CategoryName { get; set; } = new();

    [JsonIgnore]
    public string? CategoryIconUrl { get; set; }

    public int BuildOrder { get; set; }

    public string? PreviewIconUrl { get; set; }

    public string? IconUrl { get; set; }

    public string? SubTypeIconUrl { get; set; }

    public string? PreviewUrl { get; set; }

    public string? PreviewDirection { get; set; }

    public List<double>? RenderRotationDegrees { get; set; }

    public List<string>? RenderExcludedMeshIds { get; set; }

    public bool? GenerateDefaultIcon { get; set; }

    public bool? ClipFloor { get; set; }

    public double? ClipFloorZ { get; set; }

    public FoxWatchBounds3D? ClipBounds { get; set; }

    public bool? IsItem { get; set; }

    public bool? IsVehicle { get; set; }

    public bool? IsBunker { get; set; }

    public bool? IsFacility { get; set; }

    public bool? IsWorldStructure { get; set; }

    public bool? IsDestroyed { get; set; }

    public bool? IsBreached { get; set; }

    public bool? CanBlueprint { get; set; }

    public FoxWatchSprite Sprite { get; set; } = new();

    public FoxWatchTextureVariants Variants { get; set; } = new();

    public List<FoxWatchManifestColorVariant> Colors { get; set; } = [];

    public FoxWatchManifestDestroyedVisual? Destroyed { get; set; }

    public FoxWatchManifestPackagedVisual? Packaged { get; set; }

    public string? Faction { get; set; }

    [JsonIgnore]
    public string? VehicleBuildType { get; set; }

    public int? Tier { get; set; }

    public string? TechId { get; set; }

    public bool? bIsBuiltOnFoundation { get; set; }

    public bool? bBuildOnWater { get; set; }

    public bool? bIsBuiltOnLandscape { get; set; }

    public bool SupportsEmplacedStructures { get; set; }

    public bool IsEmplacedWeapon { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public FoxWatchManifestEmplacementLocation? EmplacementLocation { get; set; }

    public List<FoxWatchManifestRailCoupler> RailCouplers { get; set; } = [];

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? WheelBase { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? TrackGauge { get; set; }

    public string? BuildLocationType { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? UpgradeStructureCodeName { get; set; }

    public List<string> ConversionCodeNames { get; set; } = [];

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DestroyedStructureCodeName { get; set; }

    [JsonIgnore]
    public string? BlueprintPackagePath { get; set; }

    /// <summary>
    /// Authored standalone meshes that should render as a catalog asset without
    /// requiring a game blueprint. This is authoring-only and never published.
    /// </summary>
    [JsonIgnore]
    public List<string> StandaloneMeshPackagePaths { get; set; } = [];

    /// <summary>
    /// Optional authored RGBA material overrides for individual standalone meshes,
    /// keyed by their source package path. This is useful for texture-less meshes
    /// such as character skin.
    /// </summary>
    [JsonIgnore]
    public Dictionary<string, List<double>> StandaloneMeshColorOverrides { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    [JsonIgnore]
    public string? ReferencedBuildSiteCodeName { get; set; }

    [JsonIgnore]
    public string? ReferencedBuildSiteBlueprintPackagePath { get; set; }

    public string? ProfileType { get; set; }

    public string? ArmourType { get; set; }

    public string? MapIntelligenceType { get; set; }

    public FoxWatchManifestPowerGridInfo? PowerGridInfo { get; set; }

    public FoxWatchManifestConnector? Connector { get; set; }

    public Dictionary<string, FoxWatchManifestRecipeResource> Cost { get; set; } = [];

    public int? RepairCost { get; set; }

    public double? StructuralIntegrity { get; set; }

    /// <summary>True when the structure can participate in bunker breach / SI socket scoring.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Breachable { get; set; }

    /// <summary>True for AI garrison fort pieces (same-garrison faces stay breachable).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? StructuralGarrison { get; set; }

    public int? InventorySlots { get; set; }

    /// <summary>Maintenance supply drain multiplier from DecaySupplyDrain.</summary>
    public double? DecaySupplyDrain { get; set; }

    /// <summary>True when the structure decays (DecayStartHours &gt; 0 or forced).</summary>
    public bool? Decays { get; set; }

    /// <summary>Facility liquid volume from MaxLiquidAmount (liters).</summary>
    public double? LiquidCapacity { get; set; }

    public FoxWatchManifestStockpile? Stockpile { get; set; }

    public FoxWatchManifestHoldProfile? HoldProfile { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public FoxWatchManifestMarkedCargoOverlay? MarkedCargoOverlay { get; set; }

    public int? MaxHealth { get; set; }

    public int? MaxOrders { get; set; }

    public List<FoxWatchManifestBuildSocket> BuildSockets { get; set; } = [];

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<FoxWatchManifestStructureRenderLayer>? RenderLayers { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, FoxWatchManifestComponentRenderOverride>? ComponentRenderOverrides { get; set; }

    public List<FoxWatchManifestCraneSpawn> CraneSpawns { get; set; } = [];

    public List<FoxWatchManifestHitPolygon> FootprintPolygons { get; set; } = [];

    /// <summary>Authored top-down occlusion polygons for planner line-of-sight.</summary>
    public List<FoxWatchManifestHitPolygon> LineOfSightPolygons { get; set; } = [];

    public List<FoxWatchManifestStructureVolume> StructureVolumes { get; set; } = [];

    public List<FoxWatchManifestVehicleSeat> VehicleSeats { get; set; } = [];

    public List<FoxWatchManifestSpotlight> Spotlights { get; set; } = [];

    public List<FoxWatchManifestFuelTank> FuelTanks { get; set; } = [];

    public List<FoxWatchManifestConversionEntry> ConversionEntries { get; set; } = [];

    public List<FoxWatchManifestRange> Ranges { get; set; } = [];

    public Dictionary<string, FoxWatchManifestModification> Modifications { get; set; } = [];

    public List<FoxWatchManifestModificationSlot>? ModificationSlots { get; set; }

    public bool HideInList { get; set; }

    [JsonIgnore]
    public bool Exclude { get; set; }

    public bool IsUpgrade { get; set; }

    public string? UpgradeName { get; set; }

    public string? ParentStructureId { get; set; }

    public string? RootStructureId { get; set; }

    public string? AppliedModificationId { get; set; }

    [JsonPropertyName("legacyBuildingKey")]
    public string? LegacyBuildingKeyCompat
    {
        get => null;
        set
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                LegacyKey = value.Trim();
            }
        }
    }
}

public sealed class FoxWatchManifestConnector
{
    public string? Kind { get; set; }

    public bool? IsConnector { get; set; }

    public bool? IsManualConnector { get; set; }

    public string? SplineComponentName { get; set; }

    public string? FrontSocketName { get; set; }

    public string? BackSocketName { get; set; }

    public double? MinLengthCm { get; set; }

    public double? MaxLengthCm { get; set; }

    public double? MinWidthCm { get; set; }

    public string? PathMode { get; set; }

    public List<double>? DefaultTargetUnrealLocationCm { get; set; }

    public double? MinRadiusCm { get; set; }

    public double? MaxRadiusCm { get; set; }

    public double? MaxBufferCm { get; set; }

    public double? MinBufferCm { get; set; }

    public bool? EnforceSplineModeCornerRadius { get; set; }

    public double? MaxArcAngleDeg { get; set; }

    public double? MaxTargetAngleDeg { get; set; }

    public double? MaxSlopeAngleDeg { get; set; }

    public string? PathStyle { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public FoxWatchManifestConnectorBehavior? Behavior { get; set; }

    public List<FoxWatchManifestConnectorMeshConfig> MeshConfigs { get; set; } = [];

    public List<FoxWatchManifestSplineComponentConfig> ComponentConfigs { get; set; } = [];
}

public sealed class FoxWatchManifestConnectorBehavior
{
    public bool? TrimSpan { get; set; }

    public bool? FieldConnectorSpan { get; set; }

    public bool? MineSpline { get; set; }

    public bool? RailTrack { get; set; }

    public bool? RailForkEndCaps { get; set; }

    public bool? Powerline { get; set; }

    public bool? PipeCurveScale { get; set; }

    public bool? PipeExtension { get; set; }

    public bool? UndergroundPipe { get; set; }

    public bool? SocketSnapping { get; set; }

    public bool? TankStop { get; set; }

    public bool? RenderEndCaps { get; set; }
}

public sealed class FoxWatchManifestMarkedCargoOverlay
{
    public double? OffsetX { get; set; }

    public double? OffsetY { get; set; }
}

public sealed class FoxWatchManifestSplineComponentConfig
{
    public string ComponentName { get; set; } = string.Empty;

    public double? Distance { get; set; }

    public List<double>? RelativeLocation { get; set; }

    public List<double>? RelativeRotation { get; set; }
}

public sealed class FoxWatchManifestConnectorMeshConfig
{
    public string? Mode { get; set; }

    public List<string> MeshPaths { get; set; } = [];

    public string? SplineMeshAxis { get; set; }

    public double? NativeMeshLengthCm { get; set; }

    public double? Interval { get; set; }

    public double? StartOffset { get; set; }

    public double? EndOffset { get; set; }

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

public sealed class FoxWatchManifestRange
{
    public string Type { get; set; } = string.Empty;

    public string? CodeName { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Rotation { get; set; }

    public double? Arc { get; set; }

    public double? Min { get; set; }

    public double? Max { get; set; }

    public double? Reach { get; set; }

    public double? Overlap { get; set; }
}

public sealed class FoxWatchManifestPowerGridInfo
{
    public int? PowerDelta { get; set; }

    public int? MaxConnections { get; set; }
}

public sealed class FoxWatchManifestStockpile
{
    public int? TotalItemCapacity { get; set; }

    public int? TotalCrateCapacity { get; set; }

    public Dictionary<string, int>? ItemQuantityLimits { get; set; }

    public List<string>? ValidItems { get; set; }

    public int? ItemCategoryFilter { get; set; }
}

public sealed class FoxWatchManifestHoldProfile
{
    public string Mode { get; set; } = string.Empty;

    public int? Capacity { get; set; }

    public int? StackLimit { get; set; }

    public List<string>? AllowedItems { get; set; }

    public Dictionary<string, int>? ItemQuantityLimits { get; set; }

    public bool? AllowsAnyItem { get; set; }
}

public sealed class FoxWatchManifestBuildSocket
{
    public string? Name { get; set; }

    public string? ComponentType { get; set; }

    public string? PipeType { get; set; }

    public List<FoxWatchManifestSocketTag> SocketTags { get; set; } = [];

    /// <summary>When false, socket is excluded from bunker SI / breach indicators (legacy integrityBonus).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IntegrityBonus { get; set; }

    /// <summary>True when this build socket corresponds to a physical bunker wall breach face.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? BreachFace { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public double? Rotation { get; set; }
}

public sealed class FoxWatchManifestVehicleSeat
{
    public string? Name { get; set; }

    public string? ComponentType { get; set; }

    public string? SeatType { get; set; }

    public string? SeatDirection { get; set; }

    public string? MountCodeName { get; set; }

    public FoxWatchManifestVehicleSeatMountComponent? MountComponent { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public double? Rotation { get; set; }
}

public sealed class FoxWatchManifestVehicleSeatMountComponent
{
    public string? PackagePath { get; set; }

    public string? CodeName { get; set; }

    public string? DisplayName { get; set; }

    public string? IconUrl { get; set; }

    public string? AmmoName { get; set; }

    public List<string> CompatibleAmmoNames { get; set; } = [];

    public bool IsMultiWeapon { get; set; }
}

public sealed class FoxWatchManifestSpotlight
{
    public string? Name { get; set; }

    public string? ComponentType { get; set; }

    public string? LightType { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public double? Rotation { get; set; }

    public double? PlanarProjectionScale { get; set; }

    public double? OuterConeAngle { get; set; }

    public double? InnerConeAngle { get; set; }

    public double? AttenuationRadius { get; set; }

    public double? Intensity { get; set; }

    public string? LightColor { get; set; }

    public double? SourceRadius { get; set; }

    public double? SoftSourceRadius { get; set; }

    public double? SourceLength { get; set; }
}

public sealed class FoxWatchManifestCraneSpawn
{
    public string? Name { get; set; }

    public string? ComponentType { get; set; }

    public string StructureId { get; set; } = "staticcrane";

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public double? Rotation { get; set; }
}

public sealed class FoxWatchManifestEmplacementLocation
{
    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }
}

public sealed class FoxWatchManifestRailCoupler
{
    public string? Name { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public double? Rotation { get; set; }
}

public sealed class FoxWatchManifestSocketTag
{
    public long? Mask { get; set; }

    public long? Category { get; set; }

    public string? Tag { get; set; }
}

public sealed class FoxWatchManifestStructureRenderLayer
{
    public string Id { get; set; } = string.Empty;

    public string? ComponentName { get; set; }

    public List<string> ComponentTags { get; set; } = [];
}

public sealed class FoxWatchManifestComponentRenderOverride
{
    public FoxWatchManifestRepeatCropPixels? RepeatCropPixels { get; set; }

    public string? CalibrationBackgroundColor { get; set; }
}

public sealed class FoxWatchManifestRepeatCropPixels
{
    public double Start { get; set; }

    public double End { get; set; }
}

public sealed class FoxWatchManifestBuildFootprintBox
{
    public bool? bCheckForLandscape { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public double? Width { get; set; }

    public double? Length { get; set; }

    public double? Height { get; set; }

    public double? Rotation { get; set; }
}

public sealed class FoxWatchManifestStructureVolume
{
    public string Name { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;

    public string Category { get; set; } = string.Empty;

    public string? ComponentType { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public double? Width { get; set; }

    public double? Length { get; set; }

    public double? Height { get; set; }

    public double? Rotation { get; set; }
}

public sealed class FoxWatchManifestHitPolygon
{
    public List<double> Shape { get; set; } = [];
}

public sealed class FoxWatchManifestFuelTank
{
    public string CodeName { get; set; } = string.Empty;

    public double? Capacity { get; set; }
}

public sealed class FoxWatchManifestConversionEntry
{
    /// <summary>
    /// Stable recipe id for production queues / legacy plan import.
    /// Assigned and reused at publish time (not extracted from game data).
    /// </summary>
    public int? Id { get; set; }

    public Dictionary<string, FoxWatchManifestRecipeResource> ItemInput { get; set; } = [];

    public Dictionary<string, FoxWatchManifestRecipeResource> CrateInput { get; set; } = [];

    public Dictionary<string, FoxWatchManifestRecipeResource> LiquidInput { get; set; } = [];

    public Dictionary<string, FoxWatchManifestRecipeResource> ItemOutput { get; set; } = [];

    public Dictionary<string, FoxWatchManifestRecipeResource> CrateOutput { get; set; } = [];

    public Dictionary<string, FoxWatchManifestRecipeResource> LiquidOutput { get; set; } = [];

    public double? Duration { get; set; }

    public int? PowerDelta { get; set; }

    public bool? bConsumeResourceNodes { get; set; }
}

public sealed class FoxWatchManifestRecipeResource
{
    public double Quantity { get; set; }

    public double? Limit { get; set; }
}

public sealed class FoxWatchManifestModification
{
    public string Name { get; set; } = string.Empty;

    public string CodeName { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public FoxWatchManifestPowerGridInfo? PowerGridInfo { get; set; }

    public List<FoxWatchManifestBuildSocket> BuildSockets { get; set; } = [];

    public List<FoxWatchManifestCraneSpawn> CraneSpawns { get; set; } = [];

    public List<FoxWatchManifestHitPolygon> FootprintPolygons { get; set; } = [];

    /// <summary>Authored top-down occlusion polygons for this modification.</summary>
    public List<FoxWatchManifestHitPolygon> LineOfSightPolygons { get; set; } = [];

    public List<FoxWatchManifestFuelTank> FuelTanks { get; set; } = [];

    public List<FoxWatchManifestConversionEntry> ConversionEntries { get; set; } = [];

    public Dictionary<string, FoxWatchManifestRecipeResource> Cost { get; set; } = [];

    public bool IsUpgrade { get; set; }

    public string? UpgradeName { get; set; }

    public string? ParentStructureId { get; set; }

    public string? RootStructureId { get; set; }

    public string? AppliedModificationId { get; set; }
}

public sealed class FoxWatchManifestModificationSlot
{
    public string Name { get; set; } = string.Empty;

    public string ComponentType { get; set; } = string.Empty;

    public string? DataClassPath { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public double? Rotation { get; set; }

    public bool IsLinkedToSocket { get; set; }

    public List<string> LinkedSocketNames { get; set; } = [];

    public List<string> BlockedByModSlotNames { get; set; } = [];

    public Dictionary<string, FoxWatchManifestModificationSlotVariant> Variants { get; set; } = [];
}

public sealed class FoxWatchManifestModificationSlotVariant
{
    public string Name { get; set; } = string.Empty;

    public string CodeName { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string? IconTexturePath { get; set; }

    public string? SubTypeIconUrl { get; set; }

    public long? RequiredSocketConnectionMask { get; set; }

    public long? HiddenBySocketConnectionMask { get; set; }

    public bool? ShowInBuildSite { get; set; }

    public string? BuildFootprintTemplatePath { get; set; }

    public Dictionary<string, FoxWatchManifestRecipeResource> Cost { get; set; } = [];

    /// <summary>Authored top-down occlusion polygons for this modification variant.</summary>
    public List<FoxWatchManifestHitPolygon> LineOfSightPolygons { get; set; } = [];

    public bool UseTemplateActor { get; set; }

    public string? TemplateMeshPath { get; set; }

    public string? TemplateActorPath { get; set; }

    public string? PreviewMeshPath { get; set; }

    public string? TextureUrl { get; set; }

    public string? IconUrl { get; set; }

    public string? PreviewUrl { get; set; }

    public string? PreviewDirection { get; set; }

    public double? TextureWidth { get; set; }

    public double? TextureHeight { get; set; }

    public double? AnchorX { get; set; }

    public double? AnchorY { get; set; }

    public double? OffsetX { get; set; }

    public double? OffsetY { get; set; }

    public string? RenderId { get; set; }
}

public sealed class FoxWatchManifestItem
{
    public string Id { get; set; } = string.Empty;

    public string CodeName { get; set; } = string.Empty;

    public string? LegacyKey { get; set; }

    [JsonPropertyName("legacyKeys")]
    public List<string>? LegacyKeysCompat
    {
        get => null;
        set
        {
            if (string.IsNullOrWhiteSpace(LegacyKey))
            {
                LegacyKey = value?
                    .Select(entry => entry?.Trim())
                    .FirstOrDefault(entry => !string.IsNullOrWhiteSpace(entry));
            }
        }
    }

    public FoxWatchLocalizedText Name { get; set; } = new();

    public FoxWatchLocalizedText Description { get; set; } = new();

    public string CategoryId { get; set; } = string.Empty;

    [JsonIgnore]
    public FoxWatchLocalizedText CategoryName { get; set; } = new();

    [JsonIgnore]
    public string? CategoryIconUrl { get; set; }

    public int BuildOrder { get; set; }

    public string? IconUrl { get; set; }

    public string? PreviewUrl { get; set; }
}

public sealed class FoxWatchLocalizationBundle
{
    public string Locale { get; set; } = "en";

    public Dictionary<string, string> Strings { get; set; } = [];
}
