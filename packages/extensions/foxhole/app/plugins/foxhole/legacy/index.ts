export {
    LEGACY_PLAN_BUILDING_KEY_MAP,
    resolveLegacyPlanBuildingKey,
} from './plan-building-key-map.ts';
export { LegacyPlanArchiveReader } from './plan-archive.ts';
export {
    isLegacyPlanClipboardText,
    LEGACY_PLAN_CLIPBOARD_BASE64_PREFIX,
    LEGACY_PLAN_CLIPBOARD_PLAIN_PREFIX,
    parseLegacyPlanClipboardText,
    serializeLegacyPlanClipboardText,
} from './plan-clipboard.ts';
export { LegacyPlanCargoMapper, type LegacyCargoMappingResult } from './plan-cargo-mapper.ts';
export {
    LegacyPlanFacilityUpgradeResolver,
    listLegacyPlanParentPrefixes,
    type LegacyBuildingResolution,
} from './plan-facility-upgrade.ts';
export {
    LEGACY_PLAN_FACILITY_UPGRADE_CODENAMES,
    resolveLegacyPlanFacilityUpgradeCodeName,
} from './plan-facility-upgrade-codenames.ts';
export {
    LEGACY_PLAN_ALL_KNOWN_ENTITY_FIELDS,
    LEGACY_PLAN_DROPPED_ENTITY_FIELDS,
    LEGACY_PLAN_ENTITY_BASE_FIELDS,
    LEGACY_PLAN_ENTITY_BUILDING_FIELDS,
    LEGACY_PLAN_ENTITY_GEOMETRY_FIELDS,
    LEGACY_PLAN_ENTITY_TRANSITIONAL_FIELDS,
    LEGACY_PLAN_MAPPED_ENTITY_FIELDS,
    LEGACY_PLAN_MAPPED_PROJECT_FIELDS,
    LEGACY_PLAN_PROJECT_FIELDS,
    LegacyPlanFieldInventory,
    type LegacyPlanFieldFinding,
    type LegacyPlanFieldInventoryResult,
} from './plan-field-inventory.ts';
export {
    mapLegacyPlanIconEntity,
    LEGACY_DEPRECATED_ICON_KEYS,
    type LegacyIconMappingResult,
} from './plan-icon-mapper.ts';
export {
    applyLegacyTintBrightness,
    resolveLegacyTintBrightness,
    type LegacyTintBrightness,
} from './plan-tint.ts';
export {
    collectLegacyPlanPendingImages,
    createLegacyPlanImageFile,
    createLegacyPlanImageSpriteSnapshot,
    findLegacyPlanArchiveAsset,
    inspectLegacyPlanImageSources,
    type LegacyPlanImageMappingResult,
    type LegacyPlanPendingImage,
} from './plan-image-mapper.ts';
export {
    LegacyPlanImportReport,
    type LegacyPlanImportReportJson,
} from './plan-import-report.ts';
export {
    mapLegacyPlanAuthorsToCredits,
    mapLegacyPlanIdentitySettings,
    type LegacyPlanIdentitySettings,
} from './plan-identity-settings.ts';
export {
    LegacyPlanImporter,
    type LegacyPlanImportResult,
    type LegacyPlanImporterOptions,
    type LegacyPlanStubDocument,
    type LegacyPlanStubNode,
} from './plan-importer.ts';
export {
    darkenLegacyColor,
    parseLegacyColor,
    resolveLegacyLabelStyle,
    resolveLegacyShapeStyle,
    type LegacyShapeStyle,
} from './plan-legacy-styles.ts';
export {
    LEGACY_PLAN_SHAPE_ENTITY_TYPES,
    mapLegacyPlanShapeEntity,
    type LegacyShapeMappingResult,
} from './plan-shape-mapper.ts';
export {
    LEGACY_PLAN_ORIENTATION_MAP,
    resolveLegacyPlanOrientationOffsetDeg,
    type LegacyPlanOrientationEntry,
} from './plan-orientation-map.ts';
export {
    LEGACY_PLAN_SOCKET_ID_MAP,
    LEGACY_PLAN_SOCKET_MATCH_META,
    resolveLegacyPlanSocketId,
    resolveLegacyPlanSocketMatchMeta,
    resolveLegacyPlanSocketName,
    type LegacyPlanSocketMatchEntry,
} from './plan-socket-id-map.ts';
export {
    LegacyPlanSocketMapper,
    type LegacySocketAttachmentFinding,
    type LegacySocketLink,
} from './plan-socket-mapper.ts';
export { LegacyPlanSplineMapper } from './plan-spline-mapper.ts';
export {
    mapLegacyPlanProjectSettings,
    type LegacyPlanMappedProjectSettings,
} from './plan-project-settings.ts';
export {
    LEGACY_PLAN_CURRENT_VERSION,
    type LegacyPlanArchiveAsset,
    type LegacyPlanArchiveContents,
    type LegacyPlanBezierPoint,
    type LegacyPlanConnections,
    type LegacyPlanEntity,
    type LegacyPlanLayer,
    type LegacyPlanLinePoint,
    type LegacyPlanProductionOrder,
    type LegacyPlanProjectSettings,
    type LegacyPlanProperty,
    type LegacyPlanSave,
} from './plan-types.ts';
export {
    LEGACY_CRANE_UPGRADE_OFFSET,
    LEGACY_METER_BOARD_PIXEL_SIZE,
    LEGACY_METER_TEXTURE_PIXEL_SCALE,
    LEGACY_METER_TEXTURE_PIXEL_SIZE,
    LEGACY_PLAN_BUILDING_FLAGS,
    LEGACY_PLAN_MAPS,
    LEGACY_PLAN_SAVE_VERSION,
    LEGACY_REGION_HEIGHT,
    LEGACY_REGION_WIDTH,
    type LegacyPlanBuildingUpgradeFlags,
    type LegacyPlanMapData,
} from './plan-upgrade-data.ts';
export {
    LegacyPlanSaveUpgrader,
    isLegacyPlanBuildingEntity,
    type LegacyPlanSaveUpgraderOptions,
    type LegacyPlanUpgradeResult,
    type LegacyPlanUpgradeWarning,
} from './plan-upgrader.ts';
