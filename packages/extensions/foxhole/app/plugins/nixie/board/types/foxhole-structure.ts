import { canFoxholeSocketConnectionOpenWalls } from '#foxhole/plugins/foxhole/nixie/socket-wall-visibility.ts';
import { resolveFoxholeFiringPortReplacedWallLayerIds } from '#foxhole/plugins/foxhole/nixie/firing-port-wall-visibility.ts';
import { resolveFoxholeLadderReplacedRoofLayerIds } from '#foxhole/plugins/foxhole/nixie/ladder-roof-visibility.ts';
import { resolveFoxholeStructureOverlaySockets, getFoxholeSocketDebugLabel, getFoxholeSocketLabelPositionKey, createFoxholeSocketAttachmentStatusVisual, createFoxholeAllSocketsLabel, drawFoxholeSocketAttachmentDirectionTick } from '#foxhole/plugins/foxhole/nixie/structure-socket-overlay.ts';
import type { FoxholeResolvedStructureSocket } from '#foxhole/plugins/foxhole/nixie/structure-socket-overlay.ts';
import * as PIXI from 'pixi.js';
import { loadFoxholeContactShadowProjection, resolveFoxholeContactShadowCenter } from '#foxhole/plugins/foxhole/nixie/contact-shadow.ts';
import type { FoxholeContactShadowProjection } from '#foxhole/plugins/foxhole/nixie/contact-shadow.ts';
import { watch } from 'vue';
import { createFoxholeStructureRangeVisual, formatFoxholeComponentDebugLabel, toFoxholeRangePosition, toFoxholeRangeDistance, RANGE_OVERLAY_FILL_ALPHA, RANGE_OVERLAY_STROKE_ALPHA, RANGE_OVERLAY_STROKE_WIDTH, RANGE_OVERLAY_PIXELS_PER_METER } from '#foxhole/plugins/foxhole/nixie/structure-range-visual.ts';
import { FOXHOLE_NIGHT_RANGE_SETTING_IDS, resolveFoxholeNightVisionRadius } from '#foxhole/plugins/foxhole/nixie/night-ranges.ts';
import { createFoxholePowerPoleLampGlow, showFoxholePowerPoleLamp } from '#foxhole/plugins/foxhole/nixie/power-pole-lamps.ts';
import { createFoxholeBunkerSpotlightGlow, resolveFoxholeBunkerSpotlightLights, showFoxholeBunkerSpotlightGlow } from '#foxhole/plugins/foxhole/nixie/bunker-spotlights.ts';
import { createFoxholeSpotlightBeam } from '#foxhole/plugins/foxhole/nixie/spotlight-beam.ts';
import { FOXHOLE_BOARD_SPRITE_SCALE, resolveFoxholeStructureDimensions, resolveFoxholeStructureSpriteOffset } from '#foxhole/plugins/foxhole/nixie/structure-dimensions.ts';
import type { WatchStopHandle } from 'vue';
import { BoardSpriteNode } from '#nixie/plugins/nixie/board/types/primitives/index.ts';
import type { BoardSpriteDefinition } from '#nixie/plugins/nixie/board/types/primitives/index.ts';
import type { NixieResolvedAssetEntry } from '#nixie/plugins/nixie/registry/index.ts';
import { canvasHoverPopover, registerCanvasHoverTarget, unregisterCanvasHoverTarget } from '#nixie/plugins/nixie/board/utils/canvas-hover-popover.ts';
import { NIXIE_HITBOX_NODE_TYPE } from '#nixie/plugins/nixie/contributions/assets/shared/hitbox.ts';
import type { NixieHitboxState } from '#nixie/plugins/nixie/contributions/assets/shared/hitbox.ts';
import { listHitboxChildren } from '#nixie/plugins/nixie/board/utils/hitbox-host.ts';
import { readHitboxHostMetrics, scaleHitboxPointsToCurrentHostLocal } from '#nixie/plugins/nixie/board/utils/hitbox-texture.ts';
import {
    getCachedBoardUrlTexture as getCachedTexture,
    loadBoardUrlTexture as loadFoxholeTexture,
} from '#nixie/plugins/nixie/board/utils/url-texture.ts';
import { rotatePoint, rotatePointAroundPivot } from '#nixie/plugins/nixie/board/utils/transform-geometry.ts';
import { isBoardNodeMoveSnapStationaryCandidate } from '#nixie/plugins/nixie/board/utils/move-snap-targets.ts';
import { applyTransform } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import { resolveNxAssetIconTileTheme, resolveNxDesignTokens } from '#nixie/utils/nx-design-tokens.ts';
import { NX_BOOTSTRAP_LIGHTNING_SVG } from '#nixie/utils/nx-bootstrap-lightning.ts';
import {
    NIXIE_COLOR_THEME_SETTING_ID,
    resolveNxTheme,

} from '#nixie/utils/nx-theme.ts';
import type { NxThemePreference } from '#nixie/utils/nx-theme.ts';
import BoardNodeBase from '#nixie/plugins/nixie/board/types/node.ts';
import type {
    BoardNodeDeleteCommitContext,
    BoardNodeEditableHandleContext,
    BoardNodeLiveTransformOverlayProvider,
    BoardRenderParticipant,
    BoardNodeMoveCommitContext,
    BoardNodeMoveSnapPatch,
    BoardNodeMoveSnapProvider,
    BoardNodeMoveSnapResult,
    BoardNodeOptions,
    BoardNodeSelectionBounds,
    BoardNodeSelectionBoundsProvider,
    BoardNodeSelectionPolygonsProvider,
    BoardNodeSelectionTransformOriginProvider,
    BoardNodeWorldHitTester,
} from '#nixie/plugins/nixie/board/types/node.ts';
import {
    activeNixieStructureModificationHoverPreview,
    activeNixiePlacementPreviewTransforms,
    activeNixieViewport,
    activeNixieSelectionIds,
    subscribeToNixieSelectionState,
} from '#nixie/plugins/nixie/runtime/shared-state.ts';
import {
    markAllFoxholeStructureOverlaysDirty,
    markFoxholeStructureOverlaysDirtyByIds,
    registerFoxholeStructureOverlaySync,
    syncFoxholeLineOfSightOverlays,
    unregisterFoxholeStructureOverlaySync,
} from '#foxhole/plugins/foxhole/nixie/structure-overlay-sync.ts';
import type { FoxholeStructureOverlaySyncContext } from '#foxhole/plugins/foxhole/nixie/structure-overlay-sync.ts';
import type { FoxholeSocketNetworkSceneNode } from '#foxhole/plugins/foxhole/nixie/structure-socket-networks.ts';
import {
    buildModificationHoverPreviewSignature,
    createStructureAssetReplacementPreview,
    FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA,
    isReplacementBaseHoverPreview,
    isStructureReplacementModificationVariant,
    resolveModificationHoverPreviewMode,
    resolveStructureAssetHoverTargetKey,
    resolveModificationHoverPreviewSelections,
    resolveModificationVariantsForSocketOverlay,
    resolveReplacementHoverPreviewAlpha,
    shouldHideRoofForModificationHoverPreview,
    shouldHideCargoForStructureHoverPreview,
} from '#foxhole/plugins/foxhole/nixie/structure-modification-hover-preview.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import type {
    FoxholeManifestBuildSocket,
    FoxholeManifestRange,
    FoxholeManifestSocketTag,
    FoxholeManifestSpotlight,
    FoxholeManifestStructure,
    FoxholeManifestStructureVolume,
    FoxholeManifestVehicleSeat,
} from '#foxhole/plugins/foxhole/nixie/manifest.ts';
import {
    foxholeHoldProfileRetainsCargoWhenPackaged,
    resolveSupportedMarkedItemCodenames,
    hasFoxholeHoldProfileItemSelection,
} from '#foxhole/plugins/foxhole/nixie/hold-profile.ts';
import { resolveFoxholeGroupedCargoCodenames } from '#foxhole/plugins/foxhole/nixie/stockpile-groups.ts';
import { clampFoxholeStructureProductionOrders, resolveFoxholeStructureMaxOrders } from '#foxhole/plugins/foxhole/nixie/production/orders.ts';
import { resolveFoxholeProductionCompletedCycles } from '#foxhole/plugins/foxhole/nixie/production/aggregation.ts';
import { FOXHOLE_RECIPE_POWER_RESOURCE_ID } from '#foxhole/plugins/foxhole/nixie/production/operating-power.ts';
import { formatFoxholeProductionOverlayOutputLabel } from '#foxhole/plugins/foxhole/nixie/production/overlay-outputs.ts';
import type { FoxholeProductionOverlayOutput } from '#foxhole/plugins/foxhole/nixie/production/overlay-outputs.ts';
import { resolveFoxholeMaintenanceIntervalSeconds } from '#foxhole/plugins/foxhole/nixie/maintenance-supplies.ts';
import { FOXHOLE_STATS_SETTING_KEYS } from '#foxhole/plugins/foxhole/nixie/stats-settings.ts';
import {
    layoutMarkedCargoIconGrid,
    resolveMarkedCargoAssetTileMetrics,
    resolveMarkedCargoIconSizing,
    resolveMarkedCargoOverlayColumnPositions,
    resolveMarkedCargoOverlayLocalPosition,

} from '#foxhole/plugins/foxhole/nixie/marked-cargo-overlay.ts';
import type { MarkedCargoAssetTileMetrics, MarkedCargoIconSizing } from '#foxhole/plugins/foxhole/nixie/marked-cargo-overlay.ts';
import { resolveFoxholeMarkedCargoOverlayLocalOffset } from '#foxhole/plugins/foxhole/nixie/marked-cargo-overlay-dev.ts';
import {
    FOXHOLE_RANGE_DEBUG_SETTING_KEYS,
    FOXHOLE_RANGE_OVERLAY_SETTING_IDS,
    FOXHOLE_RANGE_SETTING_KEYS,
    getFoxholeRangeColor,
    isFoxholeRangeVisible,
    readFoxholeRangeSettingsFromGetter,
} from '#foxhole/plugins/foxhole/nixie/range-settings.ts';
import {
    buildFoxholeLineOfSightMaskPoints,
    isFoxholeLineOfSightStructureKey,
} from '#foxhole/plugins/foxhole/nixie/line-of-sight.ts';
import {
    FOXHOLE_CONNECTOR_NODE_TYPE,
    resolveFoxholeConnectorEndpointAttachmentsFromTargets,
    resolveFoxholeSplinePowerlineGeometry,
    resolveFoxholeSplinePowerlineWorldEndpoint,
    resolveFoxholeStraightConnectorGeometry,

} from '#foxhole/plugins/foxhole/nixie/connector.ts';
import {
    FOXHOLE_BOARD_PIXELS_PER_CENTIMETER,
    FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
    isPowerlineConnector,
    isSplineConnectorSocketSnapHost,
    isRailTrackSnapHost,
    resolveRailTrackGauge,
    usesSplineConnectorSocketSnapping,
} from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import { retainFoxholePowerlineAttachments } from '#foxhole/plugins/foxhole/nixie/powerline-attachments.ts';
import type { FoxholePowerlineAttachmentSource } from '#foxhole/plugins/foxhole/nixie/powerline-attachments.ts';
import type { FoxholeConnectorEndpointAttachment } from '#foxhole/plugins/foxhole/nixie/connector.ts';
import {
    DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
    DEFAULT_FOXHOLE_SOCKET_ROTATION_SNAP_DEGREES,
    DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_DISTANCE,
    DEFAULT_FOXHOLE_RAIL_COUPLER_KEEP_DISTANCE,
    FOXHOLE_SOCKET_SNAPPING_SETTING_ID,
    collectFoxholeLivePreviewTargetNodeIds,
    findAlignedFoxholeSocketMatches,
    findBestFoxholeSocketSnap,
    hasFoxholePowerSocketTag,
    hasFoxholeSnapSocketTags,
    normalizeFoxholeSocketTags,
    unwrapAngleNearReference,

} from '#foxhole/plugins/foxhole/nixie/structure-socket-snapping.ts';
import type { FoxholeSocketTagBitfield, FoxholeSocketSnapMatch, FoxholeSocketSnapPoint } from '#foxhole/plugins/foxhole/nixie/structure-socket-snapping.ts';
import {
    FOXHOLE_STRUCTURE_EMPLACEMENT_SNAP_RESULT_KIND,
    findBestFoxholeEmplacementSnap,
    foxholeEmplacementLocalToBoardOffset,
} from '#foxhole/plugins/foxhole/nixie/structure-emplacement-snapping.ts';
import type { FoxholeEmplacementPadPoint } from '#foxhole/plugins/foxhole/nixie/structure-emplacement-snapping.ts';
import {
    DEFAULT_FOXHOLE_RAIL_COUPLER_DOCK_CAPTURE_DISTANCE,
    FOXHOLE_STRUCTURE_RAIL_COUPLER_DOCK_SNAP_RESULT_KIND,
    FOXHOLE_STRUCTURE_RAIL_TRACK_SNAP_RESULT_KIND,
    findBestFoxholeRailCouplerDockSnap,
    findBestFoxholeRailTrackSnap,
    resolveFoxholeRailCouplerDockZoneRotation,
} from '#foxhole/plugins/foxhole/nixie/structure-rail-track-snapping.ts';
import type {
    FoxholeRailCouplerDockSnapMatch,
    FoxholeRailTrackPath,
} from '#foxhole/plugins/foxhole/nixie/structure-rail-track-snapping.ts';
import {
    normalizeFoxholeBuildSocketName,
    resolveFoxholeBuildSocketPosition,
    resolveFoxholeEffectiveBuildSockets,
    areFoxholeRailCouplerNamesCompatible,
    isFoxholeRailCouplerSocket,
} from '#foxhole/plugins/foxhole/nixie/structure-socket-resolution.ts';
import { findBestFoxholeRailCouplerSnap } from '#foxhole/plugins/foxhole/nixie/structure-rail-coupler-snapping.ts';
import { syncUprightBoardOverlayChildren } from '#foxhole/plugins/foxhole/nixie/upright-overlay-sync.ts';
import {
    isFoxholeFloorRenderLayer,
    isFoxholeFloorDetailRenderLayer,
    isFoxholeRoofRenderLayer,
    orderFoxholeStructureRenderLayers,
    resolveFoxholeOccupiedSocketTags,
    resolveFoxholeStructureRenderLane,
    shouldCompositeFoxholeStructureBaseTexture,
    shouldShowFoxholeStructureRenderLayer,
} from '#foxhole/plugins/foxhole/nixie/structure-render-layer-visibility.ts';
import {
    createFoxholeStructureFloorMaskPoints,
    createFoxholeCornerWallMaskPoints,
} from '#foxhole/plugins/foxhole/nixie/structure-floor-mask.ts';
import {
    resolveFoxholeModificationTextureAnchor,
    resolveFoxholeModificationTexturePosition,
} from '#foxhole/plugins/foxhole/nixie/modification-anchor.ts';
import {
    compareFoxholeModificationRenderOrder,
    isFoxholeRoofModification,
    resolveFoxholeModificationTextureLayer,

} from '#foxhole/plugins/foxhole/nixie/modification-render-order.ts';
import type { FoxholeModificationTextureLayer } from '#foxhole/plugins/foxhole/nixie/modification-render-order.ts';
import { createFoxholeBarbedWireSplineGeometry, createFoxholeSandbagSplineGeometry, resolveFoxholeEmplacementModificationSplineEnd } from '#foxhole/plugins/foxhole/nixie/modification-spline.ts';
import {
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS,
    FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS,
} from '#foxhole/plugins/foxhole/nixie/structure-debug-settings.ts';
import {
    isFoxholeBreachIndicatorSocket,
    isFoxholeBunkerSocketUnbreachable,
    resolveFoxholeStructureSocketAttachment,
} from '#foxhole/plugins/foxhole/nixie/bunker-health.ts';
import {
    createFoxholePipeSocketVisual,
    createFoxholePowerSocketVisual,
    createFoxholeSocketLabel,
    FOXHOLE_POWER_SOCKET_COLOR,
    FOXHOLE_SOCKET_STEM_LENGTH,
    resolveFoxholePipeSocketColor,
    resolveFoxholePipeSocketFlow,
    resolveFoxholeSocketOverlayOccupancyKeys,
} from '#foxhole/plugins/foxhole/nixie/structure-socket-visuals.ts';
import {
    createFoxholeStructureTextureKey,
    areFoxholeSnapSocketsAvailableForAttachment,
    resolveFoxholeMoveSnapAttachments,
    filterFoxholeStructureSocketAttachments,
    hasFoxholeReciprocalSocketAttachment,
    normalizeFoxholeColorHex,
    resolveFoxholeAlignedReciprocalSocketAttachments,
    resolveFoxholeOccupiedSocketKeys,
    normalizeFoxholeStructureSocketAttachmentMap,

} from '#foxhole/plugins/foxhole/nixie/types.ts';
import type { FoxholeStructureSocketAttachmentMap, FoxholeStructureState } from '#foxhole/plugins/foxhole/nixie/types.ts';
import type {
    FoxholeStructureAsset,
    FoxholeStructureDestroyedAsset,
    FoxholeStructurePackagedAsset,
    FoxholeSharedPackagedPalletAsset,
    FoxholeStructureRenderLayerAsset,
    FoxholeStructureModificationSlotAsset,
    FoxholeStructureModificationSlotVariantAsset,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    getFoxholeSelectedModificationSlotVariants,
    normalizeFoxholeModificationSelectionMap,
    replaceFoxholeModificationSelectionMap,
} from '#foxhole/plugins/foxhole/nixie/modification-slots.ts';
import type { FoxholeStructureModificationSelectionMap } from '#foxhole/plugins/foxhole/nixie/modification-slots.ts';
import {
    sanitizeFoxholeModificationSelections,

} from '#foxhole/plugins/foxhole/nixie/structure-mod-availability.ts';
import type { FoxholeStructureModAvailabilitySceneNode } from '#foxhole/plugins/foxhole/nixie/structure-mod-availability.ts';
import {
    buildFoxholeStructureSelectionGeometry,
    isPointInsideFoxholeStructureSelectionGeometry,

} from '#foxhole/plugins/nixie/board/types/foxhole-structure-selection.ts';
import type { FoxholeStructureSelectionGeometry } from '#foxhole/plugins/nixie/board/types/foxhole-structure-selection.ts';
import {
    FOXHOLE_STRUCTURE_LANE_IDS,
    FOXHOLE_STRUCTURE_LANE_ORDER,
    resolveFoxholeStructureDirtRenderLane,
    resolveFoxholeStructurePrimaryRenderLane,
    resolveFoxholeAssetHeightLane,
    FOXHOLE_RANGE_RENDER_LANE,
} from '#foxhole/plugins/foxhole/nixie/render-lanes.ts';
import {
    DEFAULT_FOXHOLE_STRUCTURE_STATE,
    normalizeFoxholeStructureState,
} from '#foxhole/plugins/foxhole/nixie/structure-state.ts';
import { materializeFoxholeAppearancePatchDefaults } from '#foxhole/plugins/foxhole/nixie/appearance-state.ts';

export {
    DEFAULT_FOXHOLE_STRUCTURE_STATE,
    normalizeFoxholeStructureState,
} from '#foxhole/plugins/foxhole/nixie/structure-state.ts';

export interface FoxholeStructureDefinition extends BoardSpriteDefinition {
    assetResolver?: (foxholeKey: string) => FoxholeStructureAsset | undefined;
    structureResolver?: (foxholeKey: string) => FoxholeManifestStructure | undefined;
    packagedPalletResolver?: (shippableType: string) => FoxholeSharedPackagedPalletAsset | null | undefined;
    modificationVisualResolver?: (
        foxholeKey: string,
        slotId: string,
        variantId: string,
    ) => FoxholeStructureModificationVisual | null | undefined;
    textureUrlResolver?: (textureKey: string) => string | null | undefined;
    itemIconUrlResolver?: (codename: string) => string | null | undefined;
    itemHoverEntryResolver?: (codename: string) => NixieResolvedAssetEntry | null | undefined;
    productionOutputsResolver?: (recipeId: string) => FoxholeProductionOverlayOutput[] | null | undefined;
}

type FoxholeProductionTileOutput = FoxholeProductionOverlayOutput & {
    completedCycles: number;
    intervalSeconds: number;
};

export type FoxholeStructureModificationVisual = {
    variantId?: string;
    kind: 'full-structure';
    textureKey?: string | null;
    textureUrl?: string | null;
    width: number | null;
    height: number | null;
    anchorX: number;
    anchorY: number;
    offsetX: number;
    offsetY: number;
    worldOffsetX?: number | null;
    worldOffsetY?: number | null;
    rotationDegrees?: number | null;
};

const MODIFICATION_HOVER_PREVIEW_BADGE_ALPHA = 0.62;

export function rotateFoxholeVisualOffset(
    offsetX: number,
    offsetY: number,
    rotationDegrees: number,
): { x: number; y: number; } {
    if (!Number.isFinite(rotationDegrees) || rotationDegrees === 0) {
        return { x: offsetX, y: offsetY };
    }

    const radians = (rotationDegrees * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return {
        x: (offsetX * cosine) - (offsetY * sine),
        y: (offsetX * sine) + (offsetY * cosine),
    };
}

function omitPersistedSize<T extends Record<string, unknown>>(state: T | undefined): T | undefined {
    if (!state) {
        return state;
    }

    const nextState = { ...state };
    delete nextState.width;
    delete nextState.height;
    return nextState as T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

const FOOTPRINT_OVERLAY_PIXELS_PER_UNIT = 32;
const PRODUCTION_FALLBACK_ICON_SVG = '<svg viewBox="0 0 256 256"><path fill="#fff" d="m223.68 66.15l-88-48.15a15.88 15.88 0 0 0-15.36 0l-88 48.17a16 16 0 0 0-8.32 14v95.64a16 16 0 0 0 8.32 14l88 48.17a15.88 15.88 0 0 0 15.36 0l88-48.17a16 16 0 0 0 8.32-14V80.18a16 16 0 0 0-8.32-14.03M128 32l80.34 44l-29.77 16.3l-80.35-44Zm0 88L47.66 76l33.9-18.56l80.34 44ZM40 90l80 43.78v85.79l-80-43.75Zm176 85.78l-80 43.79v-85.75l32-17.51V152a8 8 0 0 0 16 0v-44.45L216 90v85.77Z"/></svg>';
const MARKED_CARGO_TILE_BORDER_COLOR = 0x5f9eb5;
const PRODUCTION_OUTPUT_TILE_BORDER_COLOR = 0x22c55e;

function createProductionOutputVectorIcon(svg: string, size: number, viewBoxSize = 256): PIXI.Graphics {
    const icon = new PIXI.Graphics().svg(svg);
    icon.pivot.set(viewBoxSize / 2, viewBoxSize / 2);
    icon.scale.set(size / viewBoxSize);
    return icon;
}
// FoxWatch top-down renders are now generated at 64 px/m, but the Foxhole board
// still places structure sprites in 32 px/m board space.
const GENERIC_SOCKET_OVERLAY_COLOR = 0xC77DFF;
const GENERIC_SOCKET_CORE_COLOR = 0xF8EDFF;
const MODIFICATION_SLOT_OVERLAY_COLOR = 0xFF3B3B;
const MODIFICATION_SLOT_CORE_COLOR = 0xFFF0F0;
const VEHICLE_SEAT_OVERLAY_COLOR = 0xFFD166;
const VEHICLE_SEAT_CORE_COLOR = 0xFFF4CC;
const SPOTLIGHT_DEFAULT_COLOR_HEX = 'ffe3ac';
const BLUEPRINT_STRUCTURE_TINT = 0x335CFF;
const STRUCTURE_VOLUME_OVERLAY_FILL_ALPHA = 0.16;
const STRUCTURE_VOLUME_OVERLAY_STROKE_ALPHA = 0.95;
const STRUCTURE_VOLUME_OVERLAY_STROKE_WIDTH = 3;
const STRUCTURE_VOLUME_LABEL_THEME = resolveNxCanvasLabelTheme('dark');
const STRUCTURE_VOLUME_LABEL_PADDING = 6;
const STRUCTURE_VOLUME_LABEL_STYLE = {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    fill: STRUCTURE_VOLUME_LABEL_THEME.text,
} as const;
const SPOTLIGHT_MIN_BASE_HALF_WIDTH = 1.25;
const SPOTLIGHT_MAX_BASE_HALF_WIDTH = 4;
const SPOTLIGHT_BASE_HALF_WIDTH_SCALE = 0.004;
const SPOTLIGHT_MAX_BASE_OFFSET_FRACTION = 0.24;
const LINE_OF_SIGHT_CLIP_EDGE_EPSILON = 0.5;
const LIVE_LINE_OF_SIGHT_BASE_RAY_COUNT = 32;
const HITBOX_DEBUG_COLOR = 0xF59E0B;
const HITBOX_DEBUG_FILL_ALPHA = 0.16;
const HITBOX_DEBUG_STROKE_ALPHA = 0.9;
const HITBOX_DEBUG_STROKE_WIDTH = 2;
const SOCKET_ATTACHMENT_EMPTY_COLOR = 0xFF4D4D;
const SOCKET_ATTACHMENT_OCCUPIED_COLOR = 0x53D769;
const SOCKET_ATTACHMENT_SQUARE_SIZE = 12;
const SOCKET_ATTACHMENT_SQUARE_STROKE_WIDTH = 2;
const RAIL_COUPLER_DOCK_ZONE_WIDTH = 72;
const RAIL_COUPLER_DOCK_ZONE_SOCKET_OVERLAP = 8;
const RAIL_COUPLER_DOCK_ZONE_CORNER_RADIUS = 10;
const RAIL_COUPLER_DOCK_ZONE_FILL_ALPHA = 0.16;
const RAIL_COUPLER_DOCK_ZONE_STROKE_ALPHA = 0.9;
const RAIL_COUPLER_DOCK_ZONE_STROKE_WIDTH = 2;

function resolveRailCouplerDockZoneAccentHex(theme: ReturnType<typeof resolveNxTheme>): string {
    const fallback = resolveNxDesignTokens(theme).palette.accent;
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
        return fallback;
    }

    const currentAccent = getComputedStyle(document.documentElement)
        .getPropertyValue('--nx-accent')
        .trim();
    return /^#[0-9a-f]{6}$/i.test(currentAccent) ? currentAccent : fallback;
}

interface FoxholeSocketOverlaySceneState {
    version: number;
    frameTime: number;
    previewTransforms: Readonly<Record<string, { x: number; y: number; rotation: number; }>>;
    viewport: BoardNodeEditableHandleContext['viewport'] | null;
    snapNodes: FoxholeStructureNode[];
    occupiedSocketKeys: ReadonlySet<string>;
}

interface FoxholeMoveSnapSceneState {
    viewport: BoardNodeEditableHandleContext['viewport'];
    selectedNodes: readonly unknown[];
    stationaryNodes: readonly unknown[];
    selectedWorldOrigins: ReadonlyMap<string, { x: number; y: number; }>;
    selectedInitialRotations: ReadonlyMap<string, number>;
    selectedSocketsByNode: ReadonlyMap<string, readonly FoxholeSocketSnapPoint[]>;
    targetSocketSpatialIndex: FoxholeMoveSnapSocketSpatialIndex;
    previewAttachmentsByNode: ReadonlyMap<string, FoxholeStructureSocketAttachmentMap>;
    /** Raw + reverse connector links for snap eligibility (not reciprocal-filtered). */
    occupancyAttachmentsByNode: ReadonlyMap<string, FoxholeStructureSocketAttachmentMap>;
    moveSnapAttachmentsByNode: ReadonlyMap<string, FoxholeStructureSocketAttachmentMap>;
}

interface FoxholeMoveSnapSocketSpatialIndex {
    cellSize: number;
    socketsByCell: ReadonlyMap<string, readonly FoxholeSocketSnapPoint[]>;
}

const foxholeSocketOverlaySceneCache = new WeakMap<PIXI.Container, FoxholeSocketOverlaySceneState>();
let foxholeSocketOverlaySceneCacheVersion = 0;
let foxholeMoveSnapSceneCache: FoxholeMoveSnapSceneState | null = null;
// All selected providers share one preview context per pointer update. Resolve
// their leader once, without retaining contexts after the update finishes.
const foxholeMoveAttachmentPreviewLeaderCache = new WeakMap<object, string | null>();

const pendingLiveAttachmentVisualNodes = new Map<FoxholeStructureNode, boolean>();
let liveAttachmentVisualRaf = 0;

function queueLiveAttachmentPreviewVisualSync(
    node: FoxholeStructureNode,
    shouldRefreshSocketOverlay: boolean,
): void {
    const previous = pendingLiveAttachmentVisualNodes.get(node) === true;
    pendingLiveAttachmentVisualNodes.set(node, previous || shouldRefreshSocketOverlay);
    if (liveAttachmentVisualRaf) {
        return;
    }

    const schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame.bind(globalThis)
        : (callback: () => void) => setTimeout(callback, 0) as unknown as number;

    liveAttachmentVisualRaf = schedule(() => {
        liveAttachmentVisualRaf = 0;
        const pending = [...pendingLiveAttachmentVisualNodes];
        pendingLiveAttachmentVisualNodes.clear();
        for (const [structure, refreshSocketOverlay] of pending) {
            if (structure.destroyed) {
                continue;
            }
            structure.flushLiveAttachmentPreviewVisuals(refreshSocketOverlay);
        }
    });
}

function invalidateFoxholeSocketOverlaySceneCache(options: { syncOverlays?: boolean; } = {}): void {
    foxholeSocketOverlaySceneCacheVersion += 1;

    // Live attachment/placement previews patch many times per drag. Bump the occupancy
    // cache version, but do not dirty every mounted structure each frame — that made the
    // overlay ticker walk the full scene (~50ms spikes). A full sync runs when preview ends.
    if (options.syncOverlays === false) {
        return;
    }

    const previewIds = Object.keys(activeNixiePlacementPreviewTransforms.value);
    if (previewIds.length > 0) {
        markFoxholeStructureOverlaysDirtyByIds(previewIds);
        return;
    }

    markAllFoxholeStructureOverlaysDirty();
}

const MODIFICATION_OVERLAY_TEXT_STYLE = {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    fill: 0xFFF7EA,
} as const;
const MODIFICATION_BADGE_DEFAULT_WIDTH = 56;
const MODIFICATION_BADGE_END_SLOT_WIDTH = 60;
const MODIFICATION_BADGE_HEIGHT = 20;
const MODIFICATION_BADGE_CORNER_RADIUS = 8;
const MODIFICATION_BADGE_STROKE_WIDTH = 2;
const FOXHOLE_STRUCTURE_SOCKET_SNAP_RESULT_KIND = 'foxhole:structure-socket-snap';
const FOXHOLE_MOVE_SNAP_TARGET_SOCKET_CELL_SIZE = DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE * 8;
type FoxholeStructureTextureVisual = PIXI.Sprite | PIXI.Mesh;
type FoxholeModificationSplineSpan = { start: { x: number; y: number; }; end: { x: number; y: number; }; rotation: number; variantId: string; };
const blueprintStructureFiltersBySprite = new WeakMap<FoxholeStructureTextureVisual, PIXI.Filter[]>();
const brightnessStructureFiltersBySprite = new WeakMap<FoxholeStructureTextureVisual, { brightness: number; filters: PIXI.Filter[]; }>();

function createBlueprintStructureFilter(): PIXI.ColorMatrixFilter {
    const filter = new PIXI.ColorMatrixFilter();
    filter.brightness(2.15);
    return filter;
}

function createBrightnessStructureFilter(brightness: number): PIXI.ColorMatrixFilter {
    const filter = new PIXI.ColorMatrixFilter();
    filter.brightness(brightness);
    return filter;
}

function getBlueprintStructureFiltersForSprite(sprite: FoxholeStructureTextureVisual): PIXI.Filter[] {
    const existing = blueprintStructureFiltersBySprite.get(sprite);
    if (existing) {
        return existing;
    }

    const filters = [createBlueprintStructureFilter()];
    blueprintStructureFiltersBySprite.set(sprite, filters);
    return filters;
}

function getBrightnessStructureFiltersForSprite(sprite: FoxholeStructureTextureVisual, brightness: number): PIXI.Filter[] {
    const existing = brightnessStructureFiltersBySprite.get(sprite);
    if (existing && existing.brightness === brightness) {
        return existing.filters;
    }

    const filters = [createBrightnessStructureFilter(brightness)];
    brightnessStructureFiltersBySprite.set(sprite, { brightness, filters });
    return filters;
}

interface FootprintBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface FoxholeResolvedModificationSlot {
    id: string;
    name: string;
    localX: number;
    localY: number;
    rotationRadians: number;
    slot: FoxholeStructureModificationSlotAsset;
}

interface FoxholeResolvedVehicleSeat {
    id: string;
    label: string;
    localX: number;
    localY: number;
    rotationRadians: number;
    seat: FoxholeManifestVehicleSeat;
}

interface FoxholeResolvedSpotlight {
    id: string;
    label: string;
    localX: number;
    localY: number;
    rotationRadians: number;
    planarProjectionScale: number;
    coneLength: number;
    baseOffsetPixels: number;
    baseHalfWidthPixels: number;
    outerConeAngleRadians: number;
    innerConeAngleRadians: number;
    beamColorHex: string;
    beamStrength: number;
    spotlight: FoxholeManifestSpotlight;
}

function resolveSpotlightBeamColorHex(value: unknown): string {
    const normalized = normalizeFoxholeColorHex(value);
    if (!normalized) {
        return SPOTLIGHT_DEFAULT_COLOR_HEX;
    }

    return normalized.slice(0, 6);
}

interface FoxholeStructureDebugOverlaySettings {
    showAllSockets: boolean;
    showPowerSockets: boolean;
    showPipeSockets: boolean;
    showBreachIndicators: boolean;
    showSocketLabels: boolean;
    showModificationSlots: boolean;
    showVehicleSeats: boolean;
    showSpotlights: boolean;
    visibleVolumeCategories: Set<string>;
}

interface FoxholeResolvedStructureVolume {
    id: string;
    category: string;
    label: string;
    localX: number;
    localY: number;
    width: number;
    height: number;
    rotationRadians: number;
}

interface FoxholeResolvedModificationAnchor {
    localX: number;
    localY: number;
    rotationRadians: number;
    width: number;
}

interface FoxholeStructureSocketMoveSnapData {
    kind: typeof FOXHOLE_STRUCTURE_SOCKET_SNAP_RESULT_KIND;
    match: FoxholeSocketSnapMatch;
}

interface FoxholeStructureEmplacementMoveSnapData {
    kind: typeof FOXHOLE_STRUCTURE_EMPLACEMENT_SNAP_RESULT_KIND;
    match: {
        movingNodeId: string;
        targetNodeId: string;
        distance: number;
    };
}

interface FoxholeStructureRailTrackMoveSnapData {
    kind: typeof FOXHOLE_STRUCTURE_RAIL_TRACK_SNAP_RESULT_KIND;
    match: {
        movingNodeId: string;
        targetNodeId: string;
        distance: number;
    };
}

interface FoxholeStructureRailCouplerDockMoveSnapData {
    kind: typeof FOXHOLE_STRUCTURE_RAIL_COUPLER_DOCK_SNAP_RESULT_KIND;
    match: FoxholeRailCouplerDockSnapMatch;
}

const MAX_FOXHOLE_MOVE_SNAP_ROTATION_DELTA_RADIANS = Math.PI / 6;
const MAX_FOXHOLE_MOVE_SNAP_ROTATION_LEEWAY_RADIANS = Math.PI / 4;
const FOXHOLE_MOVE_SNAP_POINTER_SOCKET_RADIUS = DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE * 2.5;

interface FoxholeConnectorGeometryPatchTarget {
    boardId: string | number;
    boardType: string;
    boardState: {
        foxholeKey?: string;
        x?: number;
        y?: number;
        points?: number[];
        start?: { x?: number; y?: number; rotation?: number; };
        end?: { x?: number; y?: number; rotation?: number; };
        startSocketName?: string;
        endSocketName?: string;
        startAttachment?: FoxholeConnectorEndpointAttachment | null;
        endAttachment?: FoxholeConnectorEndpointAttachment | null;
    };
    collectSnapSocketPoints?: (viewport: BoardNodeEditableHandleContext['viewport']) => FoxholeSocketSnapPoint[];
}

const STRUCTURE_VOLUME_COLOR_BY_CATEGORY: Record<string, { fill: number; stroke: number; }> = {
    footprint: { fill: 0x00E5A8, stroke: 0x6EFFE2 },
    useArea: { fill: 0x1DD3B0, stroke: 0x6EFFE2 },
    killVolume: { fill: 0xD7263D, stroke: 0xFF90A1 },
    garageFootprint: { fill: 0xFF9F1C, stroke: 0xFFD08A },
    parkingSpot: { fill: 0x3A86FF, stroke: 0xA7C8FF },
    loadingArea: { fill: 0x8338EC, stroke: 0xD1B3FF },
    interiorArea: { fill: 0x2A9D8F, stroke: 0x9BE7DE },
    noBuild: { fill: 0x6C757D, stroke: 0xCDD3D8 },
    docking: { fill: 0x118AB2, stroke: 0x9DE7FF },
    temperature: { fill: 0xFB5607, stroke: 0xFFC19A },
    passenger: { fill: 0x8AC926, stroke: 0xD5F39F },
    iceBlocker: { fill: 0x70D6FF, stroke: 0xD5F5FF },
    other: { fill: 0xB8B8FF, stroke: 0xECECFF },
};

function foxholeRailCouplerLinkKey(
    leftNodeId: string,
    leftSocketName: string,
    rightNodeId: string,
    rightSocketName: string,
): string {
    const left = `${leftNodeId}:${leftSocketName}`;
    const right = `${rightNodeId}:${rightSocketName}`;
    return left < right ? `${left}|${right}` : `${right}|${left}`;
}

const STRUCTURE_VOLUME_SETTING_ID_BY_CATEGORY = Object.fromEntries(
    FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS.map(definition => [definition.category, definition.settingId]),
) as Record<string, string>;

const FOXHOLE_STRUCTURE_DEBUG_OVERLAY_SETTING_IDS = [
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.breachIndicators,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.markedCargo,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hitboxes,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.useStaticRender,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideFloors,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideWalls,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideDirt,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideCorners,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.modificationSlots,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.vehicleSeats,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.spotlights,
    ...FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS.map(definition => definition.settingId),
] as const;

const FOXHOLE_STRUCTURE_RANGE_OVERLAY_SETTING_IDS = [
    ...FOXHOLE_NIGHT_RANGE_SETTING_IDS,
    FOXHOLE_RANGE_SETTING_KEYS.selectionOnly,
    FOXHOLE_RANGE_DEBUG_SETTING_KEYS.vehicleWeapons,
    ...FOXHOLE_RANGE_OVERLAY_SETTING_IDS,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.lineOfSight,
] as const;

const BUNKER_ROOF_HOVER_ALPHA = 0.25;
const BUNKER_ROOF_HOVER_FADE_MS = 110;

export class FoxholeStructureNode extends BoardSpriteNode implements BoardNodeSelectionBoundsProvider, BoardNodeSelectionPolygonsProvider, BoardNodeSelectionTransformOriginProvider, BoardNodeWorldHitTester, BoardNodeMoveSnapProvider, BoardNodeLiveTransformOverlayProvider {
    declare readonly boardState: FoxholeStructureState;
    declare readonly boardDefinition: Readonly<FoxholeStructureDefinition>;
    private readonly contactShadowOverlay: PIXI.Container;
    private readonly floorDetailTextureOverlay: PIXI.Container;
    private readonly contactShadowSources = new WeakMap<FoxholeStructureTextureVisual, { textureUrl: string; }>();
    private readonly modificationTextureAlphas = new WeakMap<FoxholeStructureTextureVisual, number>();
    private readonly modificationSplineVisuals = new WeakMap<FoxholeStructureTextureVisual, FoxholeModificationSplineSpan>();
    private readonly contactShadowVisuals = new Map<FoxholeStructureTextureVisual, { sprite: FoxholeStructureTextureVisual; projection: FoxholeContactShadowProjection; mask?: PIXI.Graphics; }>();
    private readonly structureFloorTextureOverlay: PIXI.Container;
    private readonly packagedPalletTextureOverlay: PIXI.Container;
    private readonly lowerModificationTextureOverlay: PIXI.Container;
    private readonly modificationTextureOverlay: PIXI.Container;
    private readonly trenchDefenseTextureOverlay: PIXI.Container;
    private readonly structureDirtTextureOverlay: PIXI.Container;
    private readonly structureRoofTextureOverlay: PIXI.Container;
    private readonly roofModificationTextureOverlay: PIXI.Container;
    private readonly offLaneRoofSprites = new Set<PIXI.Sprite>();
    private readonly offLaneRoofModificationSprites = new Set<FoxholeStructureTextureVisual>();
    private bunkerRoofHoverFade: { from: number; to: number; elapsedMs: number; } | null = null;
    private bunkerCargoHoverFaded = false;
    private cargoTileHoverTargets = new WeakMap<PIXI.Container, number>();
    private readonly structureWallTextureOverlay: PIXI.Container;
    private readonly structureCornerTextureOverlay: PIXI.Container;
    private readonly bunkerSpotlightOverlay: PIXI.Container;
    private readonly upperModificationTextureOverlay: PIXI.Container;
    private readonly modificationOverlay: PIXI.Container;
    private readonly structureVolumeOverlay: PIXI.Container;
    private readonly railCouplerDockZoneOverlay: PIXI.Container;
    private readonly socketOverlay: PIXI.Container;
    private readonly rangeOverlay: PIXI.Container;
    private readonly hitboxDebugOverlay: PIXI.Graphics;
    private readonly lineOfSightMask: PIXI.Graphics;
    private readonly lineOfSightClipOutline: PIXI.Graphics;
    private readonly markedCargoOverlay: PIXI.Container;
    private readonly productionOutputOverlay: PIXI.Container;
    private readonly settingsStore = useNixieSettingsStore();
    private settingsWatcher: WatchStopHandle | null = null;
    private rangeSettingsWatcher: WatchStopHandle | null = null;
    private itemTileSettingsWatcher: WatchStopHandle | null = null;
    private markedCargoDevOffsetWatcher: WatchStopHandle | null = null;
    private selectionStateWatcher: (() => void) | null = null;
    private overlaySyncDisposed = false;
    private overlayPreviewSignature = '';
    private liveAttachmentPreviewVisualActive = false;
    private modificationPreviewSignature = '';
    private renderLayerVisibilitySignature = '';
    private readonly structureRenderLayerTextures = new Map<string, PIXI.Texture>();
    private railCouplerDockZoneSignature = '';
    private railCouplerDockZoneMovingNode: FoxholeStructureNode | null = null;
    private railCouplerDockZonePreviewNodes: FoxholeStructureNode[] = [];
    private moveAttachmentPreview: {
        initialAttachmentsByNode: Map<string, FoxholeStructureSocketAttachmentMap>;
        initialConnectorEndpointsByNode: Map<string, {
            startAttachment: FoxholeConnectorEndpointAttachment | null;
            endAttachment: FoxholeConnectorEndpointAttachment | null;
        }>;
        initialPowerlineLinks: FoxholePowerlineAttachmentSource[];
        previewTargetNodes: Map<string, unknown>;
        /** Stationary nodes changed by an earlier pointer frame and needing restoration. */
        touchedTargetNodeIds: Set<string>;
        /** Canonical Front↔Rear pairs attached during this drag (for keep hysteresis). */
        attachedRailCouplerKeys: Set<string>;
    } | null = null;

    runOverlaySyncTick(context: FoxholeStructureOverlaySyncContext): void {
        if (this.overlaySyncDisposed) {
            return;
        }

        this.syncLineOfSightMask();

        const nodeId = String(this.boardId);
        const isHovered = context.hoveredNodeId === nodeId;
        const usesRenderLayers = this.isUsingStructureRenderLayers();

        const nextModificationPreviewSignature = this.getModificationHoverPreviewSignature();
        if (nextModificationPreviewSignature !== this.modificationPreviewSignature) {
            this.modificationPreviewSignature = nextModificationPreviewSignature;
            this.syncModificationOverlay();
            this.syncMarkedCargoOverlay();
            // Attachment live-preview patches bump boardRevision (included in this
            // signature). syncSpriteFromState → applyTransform would yank the node
            // back to boardState and fight the selection drag pose every ticker tick.
            if (!this.hasTransientTransformPreview()) {
                this.syncSpriteFromState();
            }
        }

        if (!context.showAllSockets && !isHovered && !usesRenderLayers) {
            return;
        }

        // Live drag already has transient pose; occupancy-driven roof/layer sync is deferred
        // until preview/commit so we do not rebuild the full socket scene every pointer move.
        if (usesRenderLayers && !this.hasTransientTransformPreview()) {
            const nextRenderLayerVisibilitySignature = this.getStructureRenderLayerVisibilitySignature();
            if (nextRenderLayerVisibilitySignature !== this.renderLayerVisibilitySignature) {
                this.renderLayerVisibilitySignature = nextRenderLayerVisibilitySignature;
                this.syncStructureRenderLayers();
            }
        }

        if (!context.showAllSockets) {
            this.overlayPreviewSignature = '';
            return;
        }

        const nextSignature = this.getSnapSocketOverlayPreviewSignature();
        if (nextSignature === this.overlayPreviewSignature) {
            return;
        }

        this.overlayPreviewSignature = nextSignature;
        this.syncHitboxOverlay();

        // syncHitboxOverlay() rebuilds socket-overlay children. Bolt "upright"
        // correction relies on per-frame rotation sync, so re-run it immediately
        // after rebuild to keep the power bolt visually aligned during pending placement.
        if (this.socketOverlay.visible) {
            syncUprightBoardOverlayChildren(this.rotation, this.socketOverlay);
        }
    };

    private rangeOverlayCacheKey = '';
    private rangeOverlayEntries: Array<{ range: FoxholeManifestRange; visual: PIXI.Container; strokeVisual: PIXI.Graphics | null; label: PIXI.Text | null; }> = [];
    private markedCargoOverlayCacheKey = '';
    private markedCargoOverlayGeneration = 0;
    private productionOutputOverlayCacheKey = '';
    private productionOutputOverlayGeneration = 0;
    private selectionGeometryCacheKey = '';
    private selectionGeometryCache: FoxholeStructureSelectionGeometry | null = null;

    constructor(options: BoardNodeOptions<FoxholeStructureState, FoxholeStructureDefinition>) {
        super({
            ...options,
            state: normalizeFoxholeStructureState({
                ...DEFAULT_FOXHOLE_STRUCTURE_STATE,
                ...(omitPersistedSize(options.state as Record<string, unknown> | undefined) ?? {}),
            }),
        });

        this.contactShadowOverlay = new PIXI.Container();
        this.contactShadowOverlay.eventMode = 'none';
        this.contactShadowOverlay.onRender = () => this.syncContactShadowVisuals();
        this.addBoardVisualChild(this.contactShadowOverlay);

        this.floorDetailTextureOverlay = new PIXI.Container();
        this.floorDetailTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.floorDetailTextureOverlay);

        this.structureFloorTextureOverlay = new PIXI.Container();
        this.structureFloorTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.structureFloorTextureOverlay);

        this.packagedPalletTextureOverlay = new PIXI.Container();
        this.packagedPalletTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.packagedPalletTextureOverlay);

        this.lowerModificationTextureOverlay = new PIXI.Container();
        this.lowerModificationTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.lowerModificationTextureOverlay);

        this.modificationTextureOverlay = new PIXI.Container();
        this.modificationTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.modificationTextureOverlay);

        this.trenchDefenseTextureOverlay = new PIXI.Container();
        this.trenchDefenseTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.trenchDefenseTextureOverlay);

        this.structureDirtTextureOverlay = new PIXI.Container();
        this.structureDirtTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.structureDirtTextureOverlay);

        this.structureRoofTextureOverlay = new PIXI.Container();
        this.structureRoofTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.structureRoofTextureOverlay);

        this.roofModificationTextureOverlay = new PIXI.Container();
        this.roofModificationTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.roofModificationTextureOverlay);

        this.structureWallTextureOverlay = new PIXI.Container();
        this.structureWallTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.structureWallTextureOverlay);

        this.structureCornerTextureOverlay = new PIXI.Container();
        this.structureCornerTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.structureCornerTextureOverlay);

        this.bunkerSpotlightOverlay = new PIXI.Container();
        this.bunkerSpotlightOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.bunkerSpotlightOverlay);

        this.upperModificationTextureOverlay = new PIXI.Container();
        this.upperModificationTextureOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.upperModificationTextureOverlay);

        this.modificationOverlay = new PIXI.Container();
        this.modificationOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.modificationOverlay);

        this.structureVolumeOverlay = new PIXI.Container();
        this.structureVolumeOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.structureVolumeOverlay);

        this.railCouplerDockZoneOverlay = new PIXI.Container();
        this.railCouplerDockZoneOverlay.eventMode = 'none';
        this.railCouplerDockZoneOverlay.visible = false;
        this.addBoardVisualChild(this.railCouplerDockZoneOverlay);

        this.socketOverlay = new PIXI.Container();
        this.socketOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.socketOverlay);

        this.rangeOverlay = new PIXI.Container();
        this.rangeOverlay.eventMode = 'none';
        this.addChild(this.rangeOverlay);

        this.hitboxDebugOverlay = new PIXI.Graphics();
        this.hitboxDebugOverlay.eventMode = 'none';
        this.hitboxDebugOverlay.visible = false;
        this.addChild(this.hitboxDebugOverlay);

        this.lineOfSightMask = new PIXI.Graphics();
        this.lineOfSightMask.eventMode = 'none';
        this.lineOfSightMask.visible = false;
        this.addChild(this.lineOfSightMask);

        this.lineOfSightClipOutline = new PIXI.Graphics();
        this.lineOfSightClipOutline.eventMode = 'none';
        this.lineOfSightClipOutline.visible = false;
        this.addChild(this.lineOfSightClipOutline);

        this.markedCargoOverlay = new PIXI.Container();
        this.markedCargoOverlay.eventMode = 'none';
        this.markedCargoOverlay.visible = false;
        this.addChild(this.markedCargoOverlay);

        this.productionOutputOverlay = new PIXI.Container();
        this.productionOutputOverlay.eventMode = 'none';
        this.productionOutputOverlay.visible = false;
        this.addChild(this.productionOutputOverlay);

        this.bindDebugOverlaySettings();
        invalidateFoxholeSocketOverlaySceneCache();
        this.syncStructureRenderLayers();
        this.syncModificationOverlay();
        this.syncBlueprintVisualState();
        this.syncHitboxOverlay();
        this.syncRangeOverlay();
        this.syncSpriteFromState();
        void this.ensureTextureLoaded();
    }

    override patchBoardState(patch: Parameters<BoardSpriteNode['patchBoardState']>[0], options = {}): void {
        this.invalidateSelectionGeometry();
        const reason = String((options as { reason?: string; }).reason ?? '');
        // Attachment occupancy previews only refresh socket indicators. Calling
        // BoardSpriteNode.patchBoardState → syncSpriteFromState → applyTransform
        // would wipe the transient selection-drag pose (valve twitch). Same idea as
        // FoxholeSplineConnectorNode.onBoardStateChanged for attachment-preview.
        const attachmentOnly = reason.includes('attachment-preview')
            || reason.includes('attachment-revert');

        if (typeof patch === 'function') {
            if (attachmentOnly) {
                this.liveAttachmentPreviewVisualActive = reason.includes('attachment-preview');
                BoardNodeBase.prototype.patchBoardState.call(this, patch, options);
                return;
            }
            super.patchBoardState(patch, options);
            void this.ensureTextureLoaded();
            return;
        }

        const nextPatch = materializeFoxholeAppearancePatchDefaults(
            omitPersistedSize(patch as Record<string, unknown>) ?? {},
        ) as typeof patch;
        let shouldRefreshSocketOverlay = false;
        let nextSocketAttachments = normalizeFoxholeStructureSocketAttachmentMap(this.boardState.socketAttachments);
        const nextSelections = isPlainRecord((nextPatch as { modificationVariantIds?: unknown; }).modificationVariantIds)
            ? replaceFoxholeModificationSelectionMap(
                this.boardState.modificationVariantIds,
                (nextPatch as { modificationVariantIds?: unknown; }).modificationVariantIds,
            )
            : null;

        if ('socketAttachments' in (nextPatch as Record<string, unknown>)) {
            nextSocketAttachments = normalizeFoxholeStructureSocketAttachmentMap(
                (nextPatch as { socketAttachments?: unknown; }).socketAttachments,
            );
            shouldRefreshSocketOverlay = true;
        }

        // Preview/revert patches must not discard modifications outside history.
        // The attachment commit records any removals together with their inverse.
        if (nextSelections && !attachmentOnly) {
            const sanitizedSelections = this.sanitizeModificationVariantSelections(
                nextSelections,
                nextSocketAttachments,
                String((nextPatch as { foxholeKey?: string; }).foxholeKey ?? this.boardState.foxholeKey),
            );
            (nextPatch as Record<string, unknown>).modificationVariantIds = sanitizedSelections;
        } else if (shouldRefreshSocketOverlay && !attachmentOnly) {
            const sanitizedSelections = this.sanitizeModificationVariantSelections(
                this.boardState.modificationVariantIds,
                nextSocketAttachments,
                String((nextPatch as { foxholeKey?: string; }).foxholeKey ?? this.boardState.foxholeKey),
            );
            if (JSON.stringify(sanitizedSelections) !== JSON.stringify(this.boardState.modificationVariantIds)) {
                (nextPatch as Record<string, unknown>).modificationVariantIds = sanitizedSelections;
            }
        }

        if ('socketAttachments' in (nextPatch as Record<string, unknown>)) {
            (nextPatch as Record<string, unknown>).socketAttachments = nextSocketAttachments;
        }

        if (attachmentOnly) {
            this.liveAttachmentPreviewVisualActive = reason.includes('attachment-preview');
            BoardNodeBase.prototype.patchBoardState.call(this, nextPatch, options);
            // Live attachment-preview patches can fire for many neighbors every pointer move.
            // Refresh only this node's socket/render visuals from its own attachments — do not
            // invalidate the scene occupancy cache (that forced full-scene rebuilds).
            if (reason.includes('attachment-preview')) {
                if (!this.destroyed) {
                    queueLiveAttachmentPreviewVisualSync(this, shouldRefreshSocketOverlay);
                }
                return;
            }
            invalidateFoxholeSocketOverlaySceneCache();
            if (shouldRefreshSocketOverlay && !this.destroyed) {
                this.overlayPreviewSignature = '';
                this.syncHitboxOverlay();
            }
            return;
        }

        super.patchBoardState(nextPatch, options);
        invalidateFoxholeSocketOverlaySceneCache();
        if (shouldRefreshSocketOverlay && !this.destroyed) {
            this.overlayPreviewSignature = '';
            this.syncHitboxOverlay();
        }
        void this.ensureTextureLoaded();
    }

    override replaceBoardState(nextState: FoxholeStructureState, options = {}): void {
        this.invalidateSelectionGeometry();
        const normalizedState = normalizeFoxholeStructureState(
            omitPersistedSize(nextState as Record<string, unknown>) as FoxholeStructureState,
        );
        normalizedState.socketAttachments = normalizeFoxholeStructureSocketAttachmentMap(normalizedState.socketAttachments);
        super.replaceBoardState(normalizedState, options);
        invalidateFoxholeSocketOverlaySceneCache();
        if (!this.destroyed) {
            this.overlayPreviewSignature = '';
            this.syncHitboxOverlay();
        }
        void this.ensureTextureLoaded();
    }

    override getBoardRenderParticipants(): BoardRenderParticipant[] {
        const participants: BoardRenderParticipant[] = [];
        const localOrder = this.getBoardRenderLocalOrder();
        const primaryLane = resolveFoxholeStructurePrimaryRenderLane(
            this.boardState.foxholeKey, this.isRailVehicleStructure(), this.getResolvedAsset()?.isVehicle,
        );
        const primaryLaneId = primaryLane.laneId;
        const primaryLaneOrder = primaryLane.laneOrder;

        if (this.isUsingStructureRenderLayers()) {
            participants.push(
                this.createSharedLaneParticipant(
                    'structure-floor',
                    this.structureFloorTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.floor,
                    FOXHOLE_STRUCTURE_LANE_ORDER.floor,
                    localOrder,
                    0,
                ),
                this.createSharedLaneParticipant(
                    'structure-lower-modification',
                    this.lowerModificationTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.lowerModification,
                    FOXHOLE_STRUCTURE_LANE_ORDER.lowerModification,
                    localOrder,
                    1,
                ),
            );

            if (this.isCompositingBaseTextureWithRenderLayers()) {
                participants.push(this.createSharedLaneParticipant(
                    'structure-sprite',
                    this.spriteObject,
                    primaryLaneId,
                    primaryLaneOrder,
                    localOrder,
                    2,
                ));
            }

            participants.push(
                this.createSharedLaneParticipant(
                    'structure-walls',
                    this.structureWallTextureOverlay,
                    primaryLaneId,
                    primaryLaneOrder,
                    localOrder,
                    2,
                ),
                this.createSharedLaneParticipant(
                    'structure-modification',
                    this.modificationTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.modification,
                    FOXHOLE_STRUCTURE_LANE_ORDER.modification,
                    localOrder,
                    3,
                ),
                this.createSharedLaneParticipant(
                    'structure-trench-defense',
                    this.trenchDefenseTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.trenchDefense,
                    FOXHOLE_STRUCTURE_LANE_ORDER.trenchDefense,
                    localOrder,
                    3,
                ),
                this.createSharedLaneParticipant(
                    'structure-dirt',
                    this.structureDirtTextureOverlay,
                    resolveFoxholeStructureDirtRenderLane(this.getResolvedStructure()?.codeName).laneId,
                    resolveFoxholeStructureDirtRenderLane(this.getResolvedStructure()?.codeName).laneOrder,
                    localOrder,
                    4,
                ),
                this.createSharedLaneParticipant(
                    'structure-roof',
                    this.structureRoofTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.roof,
                    FOXHOLE_STRUCTURE_LANE_ORDER.roof,
                    localOrder,
                    5,
                ),
                this.createSharedLaneParticipant(
                    'structure-roof-modification', this.roofModificationTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.roof, FOXHOLE_STRUCTURE_LANE_ORDER.roof, localOrder, 6,
                ),
                this.createSharedLaneParticipant(
                    'structure-corners',
                    this.structureCornerTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.corners,
                    FOXHOLE_STRUCTURE_LANE_ORDER.corners,
                    localOrder,
                    6,
                ),
                this.createSharedLaneParticipant(
                    'structure-upper-modification',
                    this.upperModificationTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.upperModification,
                    FOXHOLE_STRUCTURE_LANE_ORDER.upperModification,
                    localOrder,
                    7,
                ),
            );
        } else {
            participants.push(
                this.createSharedLaneParticipant(
                    'structure-packaged-pallet',
                    this.packagedPalletTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.floor,
                    FOXHOLE_STRUCTURE_LANE_ORDER.floor,
                    localOrder,
                    0,
                ),
                this.createSharedLaneParticipant(
                    'structure-sprite',
                    this.spriteObject,
                    primaryLaneId,
                    primaryLaneOrder,
                    localOrder,
                    1,
                ),
                this.createSharedLaneParticipant(
                    'structure-modification',
                    this.modificationTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.modification,
                    FOXHOLE_STRUCTURE_LANE_ORDER.modification,
                    localOrder,
                    2,
                ),
                this.createSharedLaneParticipant(
                    'structure-trench-defense',
                    this.trenchDefenseTextureOverlay,
                    FOXHOLE_STRUCTURE_LANE_IDS.trenchDefense,
                    FOXHOLE_STRUCTURE_LANE_ORDER.trenchDefense,
                    localOrder,
                    3,
                ),
            );
        }

        participants.push(this.createSharedLaneParticipant(
            'structure-contact-shadows',
            this.contactShadowOverlay,
            FOXHOLE_STRUCTURE_LANE_IDS.contactShadow,
            FOXHOLE_STRUCTURE_LANE_ORDER.contactShadow,
            localOrder,
            0,
        ));
        participants.push(this.createSharedLaneParticipant(
            'structure-floor-details',
            this.floorDetailTextureOverlay,
            FOXHOLE_STRUCTURE_LANE_IDS.floorDetail,
            FOXHOLE_STRUCTURE_LANE_ORDER.floorDetail,
            localOrder,
            0,
        ));

        // Retain host-local transforms while rendering above every structure
        // visual, including roofs, modifications, and connectors.
        participants.push(this.createSharedLaneParticipant(
            'structure-spotlight', this.bunkerSpotlightOverlay,
            FOXHOLE_STRUCTURE_LANE_IDS.spotlight, FOXHOLE_STRUCTURE_LANE_ORDER.spotlight, localOrder, 0,
        ));
        participants.push(this.createSharedLaneParticipant(
            'structure-hitbox-debug',
            this.hitboxDebugOverlay,
            FOXHOLE_STRUCTURE_LANE_IDS.hitboxDebug,
            FOXHOLE_STRUCTURE_LANE_ORDER.hitboxDebug,
            localOrder,
            0,
        ));

        participants.push({ id: 'structure-ranges', displayObject: this.rangeOverlay, scope: 'shared-lane',
            ...FOXHOLE_RANGE_RENDER_LANE, localOrder, affectsPickRank: false });
        return participants;
    }

    protected override onBoardMounted(): void {
        // Warm selection geometry so cullArea is set for Pixi culling.
        this.getSelectionGeometry();
        registerFoxholeStructureOverlaySync(this);
    }

    protected override onBoardUnmounted(): void {
        unregisterFoxholeStructureOverlaySync(this);
    }

    override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        this.overlaySyncDisposed = true;
        unregisterFoxholeStructureOverlaySync(this);
        this.settingsWatcher?.();
        this.settingsWatcher = null;
        this.rangeSettingsWatcher?.();
        this.rangeSettingsWatcher = null;
        this.itemTileSettingsWatcher?.();
        this.itemTileSettingsWatcher = null;
        this.markedCargoDevOffsetWatcher?.();
        this.markedCargoDevOffsetWatcher = null;
        this.selectionStateWatcher?.();
        this.selectionStateWatcher = null;
        invalidateFoxholeSocketOverlaySceneCache();
        this.clearRangeOverlayGraphics();
        this.clearMarkedCargoOverlayGraphics();
        this.clearProductionOutputOverlayGraphics();
        super.destroy(options);
    }

    private createSharedLaneParticipant(
        id: string,
        displayObject: PIXI.Container,
        laneId: string,
        laneOrder: number,
        localOrder: number,
        tieBreakOrder: number,
    ): BoardRenderParticipant {
        const replacement = this.getEffectiveStructureReplacementSelection()?.variant;
        const key = id === 'structure-sprite'
            ? replacement?.appliedModificationId ?? replacement?.id ?? this.boardState.foxholeKey
            : this.boardState.foxholeKey;
        const height = resolveFoxholeAssetHeightLane(key);
        if (height && id !== 'structure-spotlight' && id !== 'structure-hitbox-debug'
            && id !== 'structure-floor-details' && id !== 'structure-packaged-pallet'
            && ((height.laneId !== 'foxhole:height:trench' && key !== 'trenchempt1') || id === 'structure-floor' || id === 'structure-dirt')) {
            laneId = height.laneId;
            laneOrder = height.laneOrder;
            if (id === 'structure-contact-shadows') {
                laneId += ':shadow';
                laneOrder -= 1;
            }
        }
        return {
            id,
            displayObject,
            scope: 'shared-lane',
            laneId,
            laneOrder,
            localOrder,
            tieBreakOrder,
        };
    }

    private getResolvedTextureKey(): string | undefined {
        if (this.getEffectiveStructureReplacementSelection()) {
            return undefined;
        }

        const state = this.boardState;
        const packaged = this.isPackagedVisualEnabled();
        return state.foxholeKey
            ? createFoxholeStructureTextureKey(
                state.foxholeKey,
                state.faction ?? null,
                state.destroyed === true,
                this.getResolvedColorHex(),
                packaged,
            )
            : undefined;
    }

    private getResolvedColorHex(): string | null {
        const assetColors = this.getResolvedAsset()?.colors ?? [];
        if (assetColors.length === 0) {
            return null;
        }

        const selectedColorHex = normalizeFoxholeColorHex(this.boardState.colorHex);
        if (selectedColorHex && assetColors.some(color => color.hex === selectedColorHex)) {
            return selectedColorHex;
        }

        return assetColors[0]?.hex ?? null;
    }

    private getResolvedDirectTextureUrl(): string | null {
        const replacementSelection = this.getEffectiveStructureReplacementSelection();
        const textureUrl = String(replacementSelection?.variant.textureUrl ?? '').trim();
        return textureUrl || null;
    }

    private getResolvedTextureUrl(textureKey: string): string | null {
        const resolved = this.boardDefinition.textureUrlResolver?.(textureKey);
        return typeof resolved === 'string' && resolved.trim() ? resolved : null;
    }

    private getResolvedDimensions(): {
        width: number | null;
        height: number | null;
    } {
        return resolveFoxholeStructureDimensions(this.getResolvedAsset(),
            this.getResolvedPackagedVisual() ?? this.getResolvedDestroyedVisual(),
            this.getEffectiveStructureReplacementSelection()?.variant);
    }

    private applyResolvedSpriteVisualState(useRenderLayers: boolean): void {
        const state = this.boardState;

        this.spriteObject.anchor.set(state.anchorX ?? 0.5, state.anchorY ?? 0.5);

        const dimensions = this.getResolvedDimensions();
        if (typeof dimensions.width === 'number') {
            this.spriteObject.width = dimensions.width;
        }
        if (typeof dimensions.height === 'number') {
            this.spriteObject.height = dimensions.height;
        }

        const spriteOffset = this.getResolvedSpriteOffset();
        this.spriteObject.position.set(spriteOffset.x, spriteOffset.y);
        this.applyStructureTextureVisualState(this.spriteObject);
        this.spriteObject.visible = !useRenderLayers && state.visible !== false;
    }

    private isBlueprintVisualEnabled(): boolean {
        return !this.isPackagedVisualEnabled()
            && this.boardState.blueprint === true
            && this.getResolvedAsset()?.canBlueprint === true;
    }

    private getResolvedStructureTint(): number {
        const baseTint = this.boardState.tint ?? 0xFFFFFF;
        return this.isBlueprintVisualEnabled() ? BLUEPRINT_STRUCTURE_TINT : baseTint;
    }

    private getResolvedStructureTextureAlpha(): number {
        const hoverPreview = this.getResolvedUpgradeReplacementHoverPreview();
        const appliedReplacement = this.getResolvedStructureReplacementSelection();
        const previewingBase = this.isPreviewingUpgradeReplacementBase();
        return resolveReplacementHoverPreviewAlpha({
            hoverVariantId: hoverPreview?.variant.id ?? null,
            appliedVariantId: appliedReplacement?.variant.id ?? null,
            previewingBase,
            previewAlpha: FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA,
        });
    }

    private getResolvedStructureFilters(sprite: FoxholeStructureTextureVisual): PIXI.Filter[] | null {
        if (this.isBlueprintVisualEnabled()) {
            return getBlueprintStructureFiltersForSprite(sprite);
        }
        const brightness = this.boardState.brightness;
        if (typeof brightness === 'number' && Number.isFinite(brightness) && brightness !== 1) {
            return getBrightnessStructureFiltersForSprite(sprite, brightness);
        }
        return null;
    }

    private applyStructureTextureVisualState(sprite: FoxholeStructureTextureVisual): void {
        sprite.tint = this.getResolvedStructureTint();
        sprite.alpha = this.getStructureTextureVisualAlpha(sprite);
        sprite.filters = this.getResolvedStructureFilters(sprite);
    }

    private getStructureTextureVisualAlpha(sprite: FoxholeStructureTextureVisual): number {
        return this.getResolvedStructureTextureAlpha()
            * (this.modificationTextureAlphas.get(sprite) ?? 1)
            * ((sprite instanceof PIXI.Sprite && this.offLaneRoofSprites.has(sprite))
                || this.offLaneRoofModificationSprites.has(sprite) ? this.structureRoofTextureOverlay.alpha : 1);
    }

    private applyTextureVisualStateToOverlay(container: PIXI.Container): void {
        for (const child of container.children) {
            if (child instanceof PIXI.Sprite || child instanceof PIXI.Mesh) {
                this.applyStructureTextureVisualState(child);
            }
        }
    }

    private syncBlueprintVisualState(): void {
        this.applyStructureTextureVisualState(this.spriteObject);
        this.applyTextureVisualStateToOverlay(this.structureFloorTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.floorDetailTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.packagedPalletTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.lowerModificationTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.modificationTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.trenchDefenseTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.structureDirtTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.structureRoofTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.roofModificationTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.structureWallTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.structureCornerTextureOverlay);
        this.applyTextureVisualStateToOverlay(this.bunkerSpotlightOverlay);
        this.syncBunkerSpotlightGlowAlpha();
        this.applyTextureVisualStateToOverlay(this.upperModificationTextureOverlay);
    }

    private getResolvedAsset(): FoxholeStructureAsset | undefined {
        return this.boardDefinition.assetResolver?.(this.boardState.foxholeKey);
    }

    private getResolvedDestroyedVisual(): FoxholeStructureDestroyedAsset | null {
        if (this.isPackagedVisualEnabled() || this.boardState.destroyed !== true) {
            return null;
        }

        return this.getResolvedAsset()?.destroyed ?? null;
    }

    private isPackagedVisualEnabled(): boolean {
        return this.boardState.packaged === true && Boolean(this.getResolvedAsset()?.packaged);
    }

    private getResolvedPackagedVisual(): FoxholeStructurePackagedAsset | null {
        if (!this.isPackagedVisualEnabled()) {
            return null;
        }

        return this.getResolvedAsset()?.packaged ?? null;
    }

    private getResolvedPackagedPalletAsset(): FoxholeSharedPackagedPalletAsset | null {
        const shippableType = String(this.getResolvedPackagedVisual()?.shippableType ?? '').trim();
        if (!shippableType) {
            return null;
        }

        return this.boardDefinition.packagedPalletResolver?.(shippableType) ?? null;
    }

    private getResolvedPackagedPalletSelectionSprite(): {
        width: number | null;
        height: number | null;
        anchorX: number;
        anchorY: number;
        offsetX: number;
        offsetY: number;
        rotationRadians: number;
    } | null {
        const pallet = this.getResolvedPackagedPalletAsset();
        if (!pallet) {
            return null;
        }

        const packagedVisual = this.getResolvedPackagedVisual();
        const palletOffsetX = Number(packagedVisual?.palletOffset?.x ?? 0);
        const palletOffsetY = Number(packagedVisual?.palletOffset?.y ?? 0);
        const offset = this.getScaledStructureSpriteOffset({
            sprite: {
                offsetX: (Number(pallet.offsetX ?? 0) || 0) + (Number.isFinite(palletOffsetX) ? palletOffsetX : 0),
                offsetY: (Number(pallet.offsetY ?? 0) || 0) + (Number.isFinite(palletOffsetY) ? palletOffsetY : 0),
            },
        });
        const width = Number(pallet.width ?? NaN);
        const height = Number(pallet.height ?? NaN);
        const anchorX = Number(pallet.anchorX ?? 0.5);
        const anchorY = Number(pallet.anchorY ?? 0.5);
        const rotationDegrees = Number(packagedVisual?.palletOffset?.rotationDegrees ?? 0);
        const rotationRadians = Number.isFinite(rotationDegrees) ? (rotationDegrees * Math.PI) / 180 : 0;

        return {
            width: Number.isFinite(width) ? width * FOXHOLE_BOARD_SPRITE_SCALE : null,
            height: Number.isFinite(height) ? height * FOXHOLE_BOARD_SPRITE_SCALE : null,
            anchorX: Number.isFinite(anchorX) ? anchorX : 0.5,
            anchorY: Number.isFinite(anchorY) ? anchorY : 0.5,
            offsetX: offset.x,
            offsetY: offset.y,
            rotationRadians,
        };
    }

    private isOperationalStructureEnabled(): boolean {
        return this.boardState.destroyed !== true && !this.isPackagedVisualEnabled();
    }

    private getResolvedRenderLayers(): FoxholeStructureRenderLayerAsset[] {
        const hover = activeNixieStructureModificationHoverPreview.value;
        if (resolveStructureAssetHoverTargetKey(hover, String(this.boardId))) {
            const preview = this.getResolvedUpgradeReplacementHoverPreview();
            if (preview) return preview.variant.renderLayers;
        }
        return this.getResolvedAsset()?.renderLayers ?? [];
    }

    private hasInitializedStructureOverlays(): boolean {
        return Boolean(
            this.structureFloorTextureOverlay
            && this.packagedPalletTextureOverlay
            && this.lowerModificationTextureOverlay
            && this.modificationTextureOverlay
            && this.trenchDefenseTextureOverlay
            && this.structureDirtTextureOverlay
            && this.structureRoofTextureOverlay
            && this.roofModificationTextureOverlay
            && this.structureWallTextureOverlay
            && this.structureCornerTextureOverlay
            && this.upperModificationTextureOverlay
            && this.modificationOverlay
            && this.structureVolumeOverlay
            && this.socketOverlay
            && this.rangeOverlay,
        );
    }

    private isUsingStructureRenderLayers(): boolean {
        return this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.useStaticRender) !== true
            && (!this.getEffectiveStructureReplacementSelection()
                || Boolean(activeNixieStructureModificationHoverPreview.value?.nodeId === String(this.boardId)
                    && activeNixieStructureModificationHoverPreview.value?.targetAssetKey))
            && !this.getResolvedPackagedVisual()
            && !this.getResolvedDestroyedVisual()
            && this.getResolvedRenderLayers().length > 0;
    }

    private isCompositingBaseTextureWithRenderLayers(): boolean {
        return this.isUsingStructureRenderLayers()
            && shouldCompositeFoxholeStructureBaseTexture(this.getResolvedRenderLayers());
    }

    private getResolvedStructure(): FoxholeManifestStructure | undefined {
        const visualKey = this.boardState.destroyed === true && !this.isPackagedVisualEnabled()
            ? this.getResolvedAsset()?.destroyedStructureId ?? this.boardState.foxholeKey
            : this.boardState.foxholeKey;
        return this.boardDefinition.structureResolver?.(visualKey);
    }

    private getResolvedRenderStructure(): FoxholeManifestStructure | undefined {
        const targetKey = resolveStructureAssetHoverTargetKey(activeNixieStructureModificationHoverPreview.value, String(this.boardId));
        if (targetKey && this.getResolvedUpgradeReplacementHoverPreview()) {
            return this.boardDefinition.structureResolver?.(targetKey) ?? this.getResolvedStructure();
        }
        return this.getResolvedStructure();
    }

    private getScaledStructureSpriteOffset(structure: Pick<FoxholeManifestStructure, 'sprite'> | null | undefined): {
        x: number;
        y: number;
    } {
        const offsetX = Number(structure?.sprite.offsetX ?? 0);
        const offsetY = Number(structure?.sprite.offsetY ?? 0);

        return {
            x: Number.isFinite(offsetX) ? offsetX * FOXHOLE_BOARD_SPRITE_SCALE : 0,
            y: Number.isFinite(offsetY) ? offsetY * FOXHOLE_BOARD_SPRITE_SCALE : 0,
        };
    }

    private getResolvedModificationBounds(): FootprintBounds | null {
        const geometry = this.getSelectionGeometry();
        if (geometry?.bounds) {
            return geometry.bounds;
        }

        const dimensions = this.getResolvedDimensions();
        if (typeof dimensions.width !== 'number' || typeof dimensions.height !== 'number') {
            return null;
        }

        const spriteOffset = this.getResolvedSpriteOffset();
        const anchorX = this.boardState.anchorX ?? 0.5;
        const anchorY = this.boardState.anchorY ?? 0.5;

        return {
            minX: spriteOffset.x - (dimensions.width * anchorX),
            minY: spriteOffset.y - (dimensions.height * anchorY),
            maxX: spriteOffset.x + (dimensions.width * (1 - anchorX)),
            maxY: spriteOffset.y + (dimensions.height * (1 - anchorY)),
        };
    }

    private getResolvedModificationSelections(): Record<string, string> {
        return normalizeFoxholeModificationSelectionMap(this.boardState.modificationVariantIds);
    }

    private getResolvedSelectedModificationVariants(selections = this.getResolvedModificationSelections()): Array<{
        slot: FoxholeStructureModificationSlotAsset;
        variant: FoxholeStructureModificationSlotVariantAsset;
    }> {
        if (!this.isOperationalStructureEnabled()) {
            return [];
        }

        const asset = this.getResolvedAsset();
        if (!asset) {
            return [];
        }

        return getFoxholeSelectedModificationSlotVariants(
            asset.modificationSlots,
            selections,
        );
    }

    private getResolvedStructureReplacementSelection(): {
        slot: FoxholeStructureModificationSlotAsset;
        variant: FoxholeStructureModificationSlotVariantAsset;
    } | null {
        return this.getResolvedSelectedModificationVariants().find(selection => {
            return isStructureReplacementModificationVariant(selection.variant);
        }) ?? null;
    }

    private getResolvedModificationHoverPreviewSelection(): {
        slot: FoxholeStructureModificationSlotAsset;
        variant: FoxholeStructureModificationSlotVariantAsset;
        mode: 'replacement' | 'overlay';
    } | null {
        const preview = activeNixieStructureModificationHoverPreview.value;
        if (!preview || preview.nodeId !== String(this.boardId)) {
            return null;
        }

        const asset = this.getResolvedAsset();
        if (!asset) {
            return null;
        }

        const slot = asset.modificationSlotById[String(preview.slotId ?? '').trim()];
        if (!slot) {
            return null;
        }

        const variant = slot.variantById[String(preview.variantId ?? '').trim()];
        if (!variant) {
            return null;
        }

        return {
            slot,
            variant,
            mode: resolveModificationHoverPreviewMode(variant, preview.mode),
        };
    }

    private isPreviewingUpgradeReplacementBase(): boolean {
        return isReplacementBaseHoverPreview(
            activeNixieStructureModificationHoverPreview.value,
            String(this.boardId),
        );
    }

    private getResolvedUpgradeReplacementHoverPreview(): {
        slot: FoxholeStructureModificationSlotAsset;
        variant: FoxholeStructureModificationSlotVariantAsset;
    } | null {
        const hover = activeNixieStructureModificationHoverPreview.value;
        const targetKey = resolveStructureAssetHoverTargetKey(hover, String(this.boardId));
        if (targetKey && this.isOperationalStructureEnabled()) {
            const asset = this.boardDefinition.assetResolver?.(targetKey);
            const structure = this.boardDefinition.structureResolver?.(targetKey);
            const textureUrl = asset ? this.getResolvedTextureUrl(asset.textureKey) : null;
            if (asset && structure && textureUrl) return createStructureAssetReplacementPreview(asset, structure, textureUrl);
        }
        if (this.isPreviewingUpgradeReplacementBase()) {
            return null;
        }

        const preview = this.getResolvedModificationHoverPreviewSelection();
        if (!preview || preview.mode !== 'replacement') {
            return null;
        }

        if (!isStructureReplacementModificationVariant(preview.variant)) {
            return null;
        }

        return {
            slot: preview.slot,
            variant: preview.variant,
        };
    }

    private getEffectiveStructureReplacementSelection(): {
        slot: FoxholeStructureModificationSlotAsset;
        variant: FoxholeStructureModificationSlotVariantAsset;
    } | null {
        if (this.isPreviewingUpgradeReplacementBase()) {
            return null;
        }

        return this.getResolvedUpgradeReplacementHoverPreview()
            ?? this.getResolvedStructureReplacementSelection();
    }

    private getResolvedModificationHoverPreview(): {
        slot: FoxholeStructureModificationSlotAsset;
        variant: FoxholeStructureModificationSlotVariantAsset;
    } | null {
        const preview = this.getResolvedModificationHoverPreviewSelection();
        if (!preview || preview.mode !== 'overlay') {
            return null;
        }

        if (preview.variant.isUpgrade) {
            return null;
        }

        return {
            slot: preview.slot,
            variant: preview.variant,
        };
    }

    private getModificationHoverPreviewSignature(): string {
        return buildModificationHoverPreviewSignature(
            String(this.boardId),
            activeNixieStructureModificationHoverPreview.value,
            this.boardRevision.value,
        );
    }

    private shouldHideRoofForModificationPreview(): boolean {
        return shouldHideRoofForModificationHoverPreview(this.getResolvedModificationHoverPreview(), {
            profileType: this.getResolvedStructure()?.profileType,
            useStructureRenderLayers: this.isUsingStructureRenderLayers(),
        });
    }

    private getResolvedBuildSockets(
        structure: Pick<FoxholeManifestStructure, 'buildSockets' | 'railCouplers'> | null | undefined = this.getResolvedStructure(),
    ): FoxholeManifestBuildSocket[] {
        if (!this.isOperationalStructureEnabled()) {
            return [];
        }

        return resolveFoxholeEffectiveBuildSockets(
            structure?.buildSockets ?? [],
            this.getResolvedSelectedModificationVariants().map(selection => selection.variant),
            structure?.railCouplers,
        );
    }

    private getResolvedModificationVariantsForSocketOverlay(): Array<{
        slot: FoxholeStructureModificationSlotAsset;
        variant: FoxholeStructureModificationSlotVariantAsset;
    }> {
        return resolveModificationVariantsForSocketOverlay({
            selected: this.getResolvedSelectedModificationVariants(),
            hoverReplacement: this.getResolvedUpgradeReplacementHoverPreview(),
            previewingBase: this.isPreviewingUpgradeReplacementBase(),
        });
    }

    private getResolvedBuildSocketsForOverlay(
        structure: Pick<FoxholeManifestStructure, 'buildSockets' | 'railCouplers'> | null | undefined = this.getResolvedStructure(),
    ): FoxholeManifestBuildSocket[] {
        if (!this.isOperationalStructureEnabled()) {
            return [];
        }

        return resolveFoxholeEffectiveBuildSockets(
            structure?.buildSockets ?? [],
            this.getResolvedModificationVariantsForSocketOverlay().map(selection => selection.variant),
            structure?.railCouplers,
        );
    }

    private getResolvedModificationVisual(
        slot: FoxholeStructureModificationSlotAsset,
        variant: FoxholeStructureModificationSlotVariantAsset,
    ): FoxholeStructureModificationVisual | null {
        const foxholeKey = String(this.boardState.foxholeKey ?? '').trim();
        if (!foxholeKey) {
            return null;
        }

        return this.boardDefinition.modificationVisualResolver?.(foxholeKey, slot.id, variant.id) ?? null;
    }

    private clearOverlay(container: PIXI.Container): void {
        container.removeChildren().forEach(child => child.destroy());
    }

    private clearStructureFloorTextureOverlay(): void {
        this.structureFloorTextureOverlay.mask = null;
        this.clearOverlay(this.structureFloorTextureOverlay);
    }

    private syncStructureFloorTextureMask(
        structure: FoxholeManifestStructure | undefined,
        floorLayer: FoxholeStructureRenderLayerAsset | undefined,
        occupiedSocketTags: ReadonlySet<string>,
    ): void {
        if (!floorLayer) {
            return;
        }

        const width = Number(floorLayer.width);
        const height = Number(floorLayer.height);
        const textureDiameter = Math.min(width, height);
        if (!Number.isFinite(textureDiameter) || textureDiameter <= 0) {
            return;
        }

        const offset = this.getScaledStructureSpriteOffset({
            sprite: {
                offsetX: floorLayer.offsetX ?? 0,
                offsetY: floorLayer.offsetY ?? 0,
            },
        });
        const points = createFoxholeStructureFloorMaskPoints(
            structure?.codeName,
            { width: width * FOXHOLE_BOARD_SPRITE_SCALE, height: height * FOXHOLE_BOARD_SPRITE_SCALE, offsetX: offset.x, offsetY: offset.y },
            320 * FOXHOLE_BOARD_SPRITE_SCALE,
            occupiedSocketTags,
        );
        if (points.length === 0) {
            return;
        }

        const mask = new PIXI.Graphics()
            .poly(points.flatMap(point => [point.x, point.y]))
            .fill({ color: 0xffffff });
        mask.eventMode = 'none';
        this.structureFloorTextureOverlay.addChild(mask);
        this.structureFloorTextureOverlay.mask = mask;
    }

    private createPackagedPalletTextureVisual(pallet: FoxholeSharedPackagedPalletAsset): PIXI.Sprite {
        const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        sprite.eventMode = 'none';
        sprite.anchor.set(pallet.anchorX ?? 0.5, pallet.anchorY ?? 0.5);
        sprite.scale.set(FOXHOLE_BOARD_SPRITE_SCALE);

        const selectionSprite = this.getResolvedPackagedPalletSelectionSprite();
        sprite.position.set(selectionSprite?.offsetX ?? 0, selectionSprite?.offsetY ?? 0);
        sprite.rotation = selectionSprite?.rotationRadians ?? 0;

        void this.ensurePackagedPalletTextureLoaded(sprite, pallet);
        return sprite;
    }

    private async ensurePackagedPalletTextureLoaded(
        sprite: PIXI.Sprite,
        pallet: FoxholeSharedPackagedPalletAsset,
    ): Promise<void> {
        const textureUrl = String(pallet.textureUrl ?? '').trim();
        if (!textureUrl) {
            return;
        }

        const loadedTexture = await loadFoxholeTexture(textureUrl);
        if (!loadedTexture || loadedTexture.destroyed || sprite.destroyed) {
            return;
        }

        if (sprite.texture !== loadedTexture) {
            sprite.texture = loadedTexture;
        }
    }

    private createStructureRenderLayerVisual(layer: FoxholeStructureRenderLayerAsset): PIXI.Sprite {
        const textureUrl = String(layer.textureUrl ?? '').trim();
        const cachedTexture = this.getCachedStructureRenderLayerTexture(textureUrl);
        const sprite = new PIXI.Sprite(cachedTexture ?? PIXI.Texture.EMPTY);
        sprite.eventMode = 'none';
        // FoxWatch's render-layer sidecars use anchorX/Y to calculate the
        // root-relative offset. Applying both here doubles that displacement.
        sprite.anchor.set(0.5);
        sprite.scale.set(FOXHOLE_BOARD_SPRITE_SCALE);

        const offset = this.getScaledStructureSpriteOffset({
            sprite: {
                width: layer.width ?? undefined,
                height: layer.height ?? undefined,
                anchorX: layer.anchorX ?? 0.5,
                anchorY: layer.anchorY ?? 0.5,
                offsetX: layer.offsetX ?? 0,
                offsetY: layer.offsetY ?? 0,
            },
        });
        sprite.position.set(offset.x, offset.y);

        this.trackContactShadow(sprite, textureUrl);
        void this.ensureStructureRenderLayerTextureLoaded(sprite, layer);
        return sprite;
    }

    private async ensureStructureRenderLayerTextureLoaded(
        sprite: PIXI.Sprite,
        layer: FoxholeStructureRenderLayerAsset,
    ): Promise<void> {
        const textureUrl = String(layer.textureUrl ?? '').trim();
        if (!textureUrl) {
            return;
        }

        const cachedTexture = this.getCachedStructureRenderLayerTexture(textureUrl);
        if (cachedTexture) {
            if (!sprite.destroyed && sprite.texture !== cachedTexture) {
                sprite.texture = cachedTexture;
            }
            return;
        }

        const loadedTexture = await loadFoxholeTexture(textureUrl);
        if (!loadedTexture || loadedTexture.destroyed) {
            return;
        }

        this.structureRenderLayerTextures.set(textureUrl, loadedTexture);
        if (sprite.destroyed) {
            return;
        }

        if (sprite.texture !== loadedTexture) {
            sprite.texture = loadedTexture;
        }
    }

    private trackContactShadow(surface: FoxholeStructureTextureVisual, textureUrl: string): void {
        // The base class can sync state before the derived overlays exist.
        if (!this.contactShadowOverlay || this.contactShadowSources.get(surface)?.textureUrl === textureUrl) {
            return;
        }
        const request = { textureUrl };
        this.contactShadowSources.set(surface, request);
        const previous = this.contactShadowVisuals.get(surface);
        previous?.sprite.destroy();
        previous?.mask?.destroy({ context: true });
        this.contactShadowVisuals.delete(surface);
        if (!textureUrl) {
            return;
        }
        void loadFoxholeContactShadowProjection(textureUrl).then(async projection => {
            if (!projection || this.destroyed || surface.destroyed || this.contactShadowSources.get(surface) !== request) {
                return;
            }
            const texture = await loadFoxholeTexture(projection.textureUrl);
            if (!texture || texture.destroyed || this.destroyed || surface.destroyed || this.contactShadowSources.get(surface) !== request) {
                return;
            }
            const span = this.modificationSplineVisuals.get(surface);
            const sprite = span
                ? this.createModificationSplineTextureVisual(projection, span, texture)
                : new PIXI.Sprite({ texture, anchor: 0.5, eventMode: 'none' });
            this.contactShadowOverlay.addChild(sprite);
            // A clipped wall's contact shadow must use the same cut. Keep an
            // independent mask because shadows render in a separate lane.
            const mask = surface.mask instanceof PIXI.Graphics
                ? new PIXI.Graphics(surface.mask.context.clone())
                : undefined;
            if (mask) {
                mask.eventMode = 'none';
                this.contactShadowOverlay.addChild(mask);
                sprite.mask = mask;
            }
            this.contactShadowVisuals.set(surface, { sprite, projection, mask });
            this.syncContactShadowVisuals();
        }).catch(() => { /* A missing optional shadow never hides the surface. */ });
    }

    private syncContactShadowVisuals(): void {
        for (const [surface, { sprite, projection, mask }] of this.contactShadowVisuals) {
            if (surface.destroyed || !surface.parent) {
                sprite.destroy();
                mask?.destroy({ context: true });
                this.contactShadowVisuals.delete(surface);
                continue;
            }
            sprite.visible = surface.visible && surface.parent.visible
                && surface.texture !== PIXI.Texture.EMPTY && this.boardState.visible !== false;
            sprite.alpha = surface.alpha;
            if (surface instanceof PIXI.Mesh) {
                surface.updateLocalTransform();
                sprite.setFromMatrix(surface.localTransform);
                continue;
            }
            const center = resolveFoxholeContactShadowCenter(projection, surface.anchor.x, surface.anchor.y);
            surface.updateLocalTransform();
            const position = surface.localTransform.apply(center);
            sprite.position.set(position.x, position.y);
            sprite.scale.copyFrom(surface.scale);
            sprite.rotation = surface.rotation;
            sprite.skew.copyFrom(surface.skew);
        }
    }

    private getCachedStructureRenderLayerTexture(textureUrl: string): PIXI.Texture | null {
        if (!textureUrl) {
            return null;
        }

        const retainedTexture = this.structureRenderLayerTextures.get(textureUrl);
        if (retainedTexture && !retainedTexture.destroyed) {
            return retainedTexture;
        }
        if (retainedTexture?.destroyed) {
            this.structureRenderLayerTextures.delete(textureUrl);
        }

        const cachedTexture = getCachedTexture(textureUrl);
        if (!cachedTexture || cachedTexture.destroyed) {
            return null;
        }

        this.structureRenderLayerTextures.set(textureUrl, cachedTexture);
        return cachedTexture;
    }

    private getWallVisibilityNeighborKey(nodeId: string): string | undefined {
        const visit = (node: PIXI.Container): string | undefined => {
            const candidate = node as PIXI.Container & { boardId?: string; boardState?: { foxholeKey?: string } };
            if (String(candidate.boardId) === nodeId) {
                const targetKey = resolveStructureAssetHoverTargetKey(activeNixieStructureModificationHoverPreview.value, nodeId);
                return targetKey && this.boardDefinition.structureResolver?.(targetKey) ? targetKey : candidate.boardState?.foxholeKey;
            }
            for (const child of node.children) {
                const key = visit(child);
                if (key !== undefined) return key;
            }
            return undefined;
        };
        const root = this.getTopBoardContainer();
        return root ? visit(root) : undefined;
    }

    private getLocalAttachmentOccupancyKeys(forWallVisibility = false): ReadonlySet<string> {
        const nodeId = String(this.boardId);
        const occupied = new Set<string>();
        for (const [socketName, attachment] of Object.entries(this.getNormalizedSocketAttachments())) {
            if (forWallVisibility && !canFoxholeSocketConnectionOpenWalls(this.getResolvedRenderStructure()?.id ?? this.boardState.foxholeKey,
                this.getWallVisibilityNeighborKey(String(attachment.nodeId)))) continue;
            const normalizedSocketName = String(socketName ?? '').trim();
            if (normalizedSocketName) {
                occupied.add(`${nodeId}:${normalizedSocketName}`);
            }
        }
        return occupied;
    }

    private getSocketOverlayOccupancyKeys(): ReadonlySet<string> {
        return resolveFoxholeSocketOverlayOccupancyKeys({
            liveAttachmentPreviewActive: this.liveAttachmentPreviewVisualActive,
            localAttachmentKeys: this.getLocalAttachmentOccupancyKeys(),
            sceneOccupancyKeys: this.getSnapSocketOccupancyMap(),
        });
    }

    /**
     * Apply socket/render visuals after live attachment-preview patches.
     * Coalesced via rAF so rapid snap flicker does not rebuild layers every pointer event.
     */
    flushLiveAttachmentPreviewVisuals(shouldRefreshSocketOverlay: boolean): void {
        if (shouldRefreshSocketOverlay) {
            this.overlayPreviewSignature = '';
            this.syncHitboxOverlay();
            this.syncRailCouplerDockZoneOverlay(this.railCouplerDockZoneMovingNode);
        }

        if (!this.isUsingStructureRenderLayers()) {
            return;
        }

        const nextSignature = this.getStructureRenderLayerVisibilitySignature();
        if (nextSignature === this.renderLayerVisibilitySignature) {
            return;
        }

        this.renderLayerVisibilitySignature = nextSignature;
        this.syncStructureRenderLayers();
    }

    private getModificationReplacedRenderLayerIds(renderLayers: readonly FoxholeStructureRenderLayerAsset[] = this.getResolvedRenderLayers()): ReadonlySet<string> {
        // A conversion preview renders another asset's layers, not this asset's slots.
        if (resolveStructureAssetHoverTargetKey(activeNixieStructureModificationHoverPreview.value, String(this.boardId))) {
            return new Set();
        }
        const hideRoofs = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs) === true
            || this.shouldHideRoofForModificationPreview();
        const hovered = this.getResolvedModificationHoverPreview();
        const hoveredPreview = hideRoofs && hovered && isFoxholeRoofModification(hovered.variant) ? null : hovered;
        const asset = this.getResolvedAsset();
        const selections = asset
            ? resolveModificationHoverPreviewSelections(asset, this.getResolvedModificationSelections(), hoveredPreview)
            : this.getResolvedModificationSelections();
        const renderableSelections = this.getResolvedSelectedModificationVariants(selections).filter(({ slot, variant }) => {
            const visual = this.getResolvedModificationVisual(slot, variant);
            return visual?.kind === 'full-structure' && Boolean(visual.textureUrl?.trim());
        });
        return new Set([
            ...resolveFoxholeFiringPortReplacedWallLayerIds(renderLayers, renderableSelections),
            ...resolveFoxholeLadderReplacedRoofLayerIds(renderLayers, renderableSelections, this.getResolvedRenderStructure()?.codeName),
        ]);
    }

    private getStructureRenderLayerVisibilitySignature(): string {
        if (!this.isUsingStructureRenderLayers()) {
            return '';
        }

        const structure = this.getResolvedRenderStructure();
        if (!structure) {
            return '';
        }

        // Use this node's socketAttachments only. Scene occupancy cache is not invalidated
        // during live attachment-preview, so relying on it let overlay ticks overwrite
        // correct partner visuals with stale pre-drag occupancy (first snap looked broken).
        const occupiedSocketTags = resolveFoxholeOccupiedSocketTags(
            this.getResolvedBuildSockets(structure),
            this.getLocalAttachmentOccupancyKeys(true),
            String(this.boardId),
        );
        const hideRoofs = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs) === true
            || this.shouldHideRoofForModificationPreview();
        const hideFloors = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideFloors) === true;
        const hideWalls = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideWalls) === true;
        const hideDirt = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideDirt) === true;
        const hideCorners = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideCorners) === true;
        const replacedLayers = [...this.getModificationReplacedRenderLayerIds()].sort().join(',');
        return `${hideRoofs ? 'hide-roofs' : 'show-roofs'}|${hideFloors ? 'hide-floors' : 'show-floors'}|${hideWalls ? 'hide-walls' : 'show-walls'}|${hideDirt ? 'hide-dirt' : 'show-dirt'}|${hideCorners ? 'hide-corners' : 'show-corners'}|${[...occupiedSocketTags].sort().join('|')}|${replacedLayers}`;
    }

    private syncStructureRenderLayers(): void {
        if (!this.hasInitializedStructureOverlays()) {
            return;
        }

        this.offLaneRoofSprites.clear();
        this.clearStructureFloorTextureOverlay();
        this.clearOverlay(this.floorDetailTextureOverlay);
        this.clearOverlay(this.structureDirtTextureOverlay);
        this.clearOverlay(this.structureRoofTextureOverlay);
        this.clearOverlay(this.structureWallTextureOverlay);
        this.clearOverlay(this.structureCornerTextureOverlay);
        this.clearOverlay(this.bunkerSpotlightOverlay);

        if (this.boardState.visible === false || !this.isUsingStructureRenderLayers()) {
            this.structureFloorTextureOverlay.visible = false;
            this.floorDetailTextureOverlay.visible = false;
            this.structureDirtTextureOverlay.visible = false;
            this.structureRoofTextureOverlay.visible = false;
            this.structureWallTextureOverlay.visible = false;
            this.structureCornerTextureOverlay.visible = false;
            this.syncPowerPoleLampGlow();
            this.syncBunkerSpotlightGlow();
            return;
        }

        const structure = this.getResolvedRenderStructure();
        const occupiedSocketTags = structure
            ? resolveFoxholeOccupiedSocketTags(
                this.getResolvedBuildSockets(structure),
                this.getLocalAttachmentOccupancyKeys(true),
                String(this.boardId),
            )
            : new Set<string>();

        const hideRoofs = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs) === true
            || this.shouldHideRoofForModificationPreview();
        const hideFloors = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideFloors) === true;
        const hideWalls = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideWalls) === true;
        const hideDirt = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideDirt) === true;
        const hideCorners = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideCorners) === true;
        const renderLayers = orderFoxholeStructureRenderLayers(this.getResolvedRenderLayers(), structure?.codeName);
        const replacedLayers = this.getModificationReplacedRenderLayerIds(renderLayers);
        for (const layer of renderLayers) {
            const sprite = this.createStructureRenderLayerVisual(layer);
            sprite.visible = shouldShowFoxholeStructureRenderLayer(layer, occupiedSocketTags, {
                hideRoofs,
                hideFloors,
                hideWalls,
                hideDirt,
                hideCorners,
                structureCodeName: structure?.codeName,
            }) && !replacedLayers.has(layer.id);
            const renderLane = resolveFoxholeStructureRenderLane(layer, structure?.codeName);
            if (renderLane !== 'roof' && isFoxholeRoofRenderLayer(layer, structure?.codeName)) {
                // Some roof parts (including garrison guns) draw above walls.
                // Keep their render lane, but fade the same parts Hide Roofs hides.
                this.offLaneRoofSprites.add(sprite);
                this.applyStructureTextureVisualState(sprite);
            }
            switch (renderLane) {
                case 'spotlight':
                    this.bunkerSpotlightOverlay.addChild(sprite);
                    break;
                case 'floor':
                    if (isFoxholeFloorDetailRenderLayer(layer, structure?.codeName)) {
                        this.floorDetailTextureOverlay.addChild(sprite);
                    } else {
                        this.structureFloorTextureOverlay.addChild(sprite);
                    }
                    break;
                case 'dirt':
                    this.structureDirtTextureOverlay.addChild(sprite);
                    break;
                case 'roof':
                    this.structureRoofTextureOverlay.addChild(sprite);
                    break;
                case 'corners':
                    this.structureCornerTextureOverlay.addChild(sprite);
                    break;
                case 'walls':
                default:
                    this.structureWallTextureOverlay.addChild(sprite);
                    break;
            }
            if (sprite.visible && (renderLane === 'walls' || renderLane === 'corners')) {
                const wallMaskPoints = createFoxholeCornerWallMaskPoints(structure?.codeName, {
                    id: layer.id, width: layer.width * FOXHOLE_BOARD_SPRITE_SCALE, height: layer.height * FOXHOLE_BOARD_SPRITE_SCALE,
                    offsetX: (layer.offsetX ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE, offsetY: (layer.offsetY ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE,
                }, 320 * FOXHOLE_BOARD_SPRITE_SCALE, occupiedSocketTags);
                if (wallMaskPoints.length > 0) {
                    const mask = new PIXI.Graphics().poly(wallMaskPoints.flatMap(point => [point.x, point.y])).fill({ color: 0xffffff });
                    mask.eventMode = 'none';
                    const overlay = renderLane === 'corners' ? this.structureCornerTextureOverlay : this.structureWallTextureOverlay;
                    overlay.addChild(mask);
                    sprite.mask = mask;
                }
            }
        }

        const hasVisibleFloorLayer = this.structureFloorTextureOverlay.children.some(child => child.visible);
        this.syncStructureFloorTextureMask(
            structure,
            renderLayers.find(layer => isFoxholeFloorRenderLayer(layer, structure?.codeName)),
            occupiedSocketTags,
        );
        this.structureFloorTextureOverlay.visible = hasVisibleFloorLayer;
        this.floorDetailTextureOverlay.visible = this.floorDetailTextureOverlay.children.some(child => child.visible);
        this.structureDirtTextureOverlay.visible = this.structureDirtTextureOverlay.children.some(child => child.visible);
        this.structureRoofTextureOverlay.visible = this.structureRoofTextureOverlay.children.some(child => child.visible);
        this.structureWallTextureOverlay.visible = this.structureWallTextureOverlay.children.some(child => child.visible);
        this.structureCornerTextureOverlay.visible = this.structureCornerTextureOverlay.children.some(child => child.visible);
        this.syncPowerPoleLampGlow();
        this.syncBunkerSpotlightGlow();
    }

    private syncPowerPoleLampGlow(): void {
        const asset = this.getResolvedAsset();
        const selections = asset ? resolveModificationHoverPreviewSelections(asset,
            this.getResolvedModificationSelections(), this.getResolvedModificationHoverPreview()) : {};
        if (this.boardState.visible === false || !showFoxholePowerPoleLamp(asset?.codeName,
            Object.values(selections), id => this.settingsStore.getValue(id), this.boardState)) {
            return;
        }
        const glow = createFoxholePowerPoleLampGlow();
        glow.alpha = this.getResolvedStructureTextureAlpha();
        this.floorDetailTextureOverlay.addChild(glow);
        this.floorDetailTextureOverlay.visible = true;
    }

    private syncBunkerSpotlightGlow(): void {
        const lamp = this.getResolvedRenderLayers().find(layer => layer.id === 'topmesh');
        if (this.boardState.visible !== false && showFoxholeBunkerSpotlightGlow(this.getResolvedAsset()?.codeName,
            id => this.settingsStore.getValue(id), this.boardState)) {
            const fallbackLamp = lamp ? { width: lamp.width * FOXHOLE_BOARD_SPRITE_SCALE,
                offsetX: (lamp.offsetX ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE,
                offsetY: (lamp.offsetY ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE } : undefined;
            for (const light of resolveFoxholeBunkerSpotlightLights(this.getResolvedRenderStructure()?.spotlights, fallbackLamp)) {
                const glow = createFoxholeBunkerSpotlightGlow(light.beam);
                glow.position.set(light.x, light.y);
                glow.rotation = light.rotation;
                this.bunkerSpotlightOverlay.addChild(glow);
            }
        }
        this.syncBunkerSpotlightGlowAlpha();
        this.bunkerSpotlightOverlay.visible = this.bunkerSpotlightOverlay.children.some(child => child.visible);
    }

    private syncBunkerSpotlightGlowAlpha(): void {
        for (const child of this.bunkerSpotlightOverlay.children) {
            if (child.label === 'bunker-spotlight-glow') {
                child.alpha = this.getResolvedStructureTextureAlpha() * this.structureRoofTextureOverlay.alpha;
            }
        }
    }

    private syncPackagedPalletOverlay(): void {
        if (!this.hasInitializedStructureOverlays()) {
            return;
        }

        this.clearOverlay(this.packagedPalletTextureOverlay);

        if (this.boardState.visible === false || !this.isPackagedVisualEnabled()) {
            this.packagedPalletTextureOverlay.visible = false;
            return;
        }

        const pallet = this.getResolvedPackagedPalletAsset();
        if (!String(pallet?.textureUrl ?? '').trim()) {
            this.packagedPalletTextureOverlay.visible = false;
            return;
        }

        this.packagedPalletTextureOverlay.addChild(this.createPackagedPalletTextureVisual(pallet));
        this.packagedPalletTextureOverlay.visible = true;
    }

    private resolveModificationTextureLayer(
        slot: FoxholeStructureModificationSlotAsset,
        variant: Pick<FoxholeStructureModificationSlotVariantAsset, 'id'>,
    ): FoxholeModificationTextureLayer {
        return resolveFoxholeModificationTextureLayer(slot, variant, {
            profileType: this.getResolvedStructure()?.profileType,
            useStructureRenderLayers: this.isUsingStructureRenderLayers(),
        });
    }

    private compareSelectedModificationVariants(
        left: {
            slot: FoxholeStructureModificationSlotAsset;
            variant: FoxholeStructureModificationSlotVariantAsset;
        },
        right: {
            slot: FoxholeStructureModificationSlotAsset;
            variant: FoxholeStructureModificationSlotVariantAsset;
        },
    ): number {
        return compareFoxholeModificationRenderOrder(left, right, {
            profileType: this.getResolvedStructure()?.profileType,
            useStructureRenderLayers: this.isUsingStructureRenderLayers(),
        });
    }

    private getModificationBadgePalette(variantId: string): {
        fill: number;
        stroke: number;
        text: string;
    } {
        switch (String(variantId ?? '').trim().toLowerCase()) {
            case 'bridge':
                return { fill: 0x768AA0, stroke: 0xD8E6F3, text: 'BRIDGE' };
            case 'barbedwire':
                return { fill: 0x8E4039, stroke: 0xF1B7A4, text: 'WIRE' };
            case 'sandbags':
                return { fill: 0x8A7453, stroke: 0xF4D8A7, text: 'BERM' };
            case 'stairs':
                return { fill: 0x546B87, stroke: 0xD7E7FF, text: 'STAIRS' };
            case 'oneway':
                return { fill: 0x426A56, stroke: 0xCFEFD8, text: '1-WAY' };
            default:
                return {
                    fill: 0x6F5A44,
                    stroke: 0xE7C9A1,
                    text: String(variantId ?? '').trim().slice(0, 8).toUpperCase() || 'MOD',
                };
        }
    }

    private resolveModificationAnchor(slot: FoxholeStructureModificationSlotAsset, bounds: FootprintBounds): FoxholeResolvedModificationAnchor {
        const structure = this.getResolvedStructure();
        const anchor = resolveFoxholeModificationTextureAnchor(slot, bounds, this.getResolvedBuildSockets(structure));
        return { localX: anchor.x, localY: anchor.y, rotationRadians: 0,
            width: slot.name.toLowerCase().includes('end') ? MODIFICATION_BADGE_END_SLOT_WIDTH : MODIFICATION_BADGE_DEFAULT_WIDTH };
    }

    private createModificationBadgeVisual(
        slot: FoxholeStructureModificationSlotAsset,
        variant: FoxholeStructureModificationSlotVariantAsset,
        bounds: FootprintBounds,
        alpha = 1,
    ): PIXI.Container {
        const anchor = this.resolveModificationAnchor(slot, bounds);
        const palette = this.getModificationBadgePalette(variant.id);
        const container = new PIXI.Container();
        container.eventMode = 'none';
        container.position.set(anchor.localX, anchor.localY);
        container.rotation = anchor.rotationRadians;

        const graphics = new PIXI.Graphics();
        graphics.eventMode = 'none';
        graphics.roundRect(
            -(anchor.width / 2),
            -(MODIFICATION_BADGE_HEIGHT / 2),
            anchor.width,
            MODIFICATION_BADGE_HEIGHT,
            MODIFICATION_BADGE_CORNER_RADIUS,
        );
        graphics.fill({ color: palette.fill, alpha: 0.9 * alpha });
        graphics.stroke({ color: palette.stroke, alpha: 0.95 * alpha, width: MODIFICATION_BADGE_STROKE_WIDTH });
        container.addChild(graphics);

        const label = new PIXI.Text({
            text: palette.text,
            style: MODIFICATION_OVERLAY_TEXT_STYLE,
        });
        label.eventMode = 'none';
        label.anchor.set(0.5, 0.5);
        label.alpha = alpha;
        container.addChild(label);
        return container;
    }

    private async ensureModificationVisualTextureLoaded(
        sprite: FoxholeStructureTextureVisual,
        visual: FoxholeStructureModificationVisual,
    ): Promise<void> {
        const texture = visual.textureKey
            ? this.boardDefinition.textureResolver?.(visual.textureKey)
            : null;
        if (texture && !texture.destroyed) {
            if (!sprite.destroyed && sprite.texture !== texture) {
                sprite.texture = texture;
            }
            return;
        }

        const textureUrl = String(
            visual.textureUrl
            ?? (visual.textureKey ? this.getResolvedTextureUrl(visual.textureKey) : '')
            ?? '',
        ).trim();
        if (!textureUrl) {
            return;
        }

        const loadedTexture = await loadFoxholeTexture(textureUrl);
        if (!loadedTexture || loadedTexture.destroyed || sprite.destroyed) {
            return;
        }

        if (sprite.texture !== loadedTexture) {
            sprite.texture = loadedTexture;
        }
    }

    private createModificationSplineTextureVisual(
        visual: { width?: number | null; height?: number | null; offsetX?: number | null; offsetY?: number | null; },
        span: FoxholeModificationSplineSpan,
        texture: PIXI.Texture = PIXI.Texture.EMPTY,
    ): PIXI.Mesh<PIXI.MeshGeometry> {
        const panel = {
            width: Number(visual.width ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE,
            height: Number(visual.height ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE,
            offsetX: Number(visual.offsetX ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE,
            offsetY: Number(visual.offsetY ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE,
            anchorX: 0.5, anchorY: 0.5,
        };
        const geometry = span.variantId === 'sandbags'
            ? createFoxholeSandbagSplineGeometry(span.start, span.end, panel)
            : createFoxholeBarbedWireSplineGeometry(span.start, span.end, span.rotation, panel);
        const mesh = new PIXI.Mesh({ texture, geometry: new PIXI.MeshGeometry({
            positions: new Float32Array(geometry.positions), uvs: new Float32Array(geometry.uvs), indices: new Uint32Array(geometry.indices),
        }) });
        mesh.eventMode = 'none';
        this.modificationSplineVisuals.set(mesh, span);
        return mesh;
    }

    private createModificationTextureVisual(
        slot: FoxholeStructureModificationSlotAsset,
        visual: FoxholeStructureModificationVisual,
        bounds: FootprintBounds,
        alpha = 1,
    ): FoxholeStructureTextureVisual {
        const rotationDegrees = Number(visual.rotationDegrees ?? 0) || 0;
        const splineEnd = visual.variantId === 'barbedwire' || visual.variantId === 'sandbags'
            ? resolveFoxholeEmplacementModificationSplineEnd(this.getResolvedRenderStructure()?.codeName ?? '', slot, bounds, this.getResolvedBuildSockets())
            : null;
        const span = splineEnd
            ? { start: resolveFoxholeModificationTextureAnchor(slot, bounds, this.getResolvedBuildSockets()),
                end: splineEnd, rotation: rotationDegrees * Math.PI / 180, variantId: visual.variantId ?? '' }
            : null;
        const sprite = span ? this.createModificationSplineTextureVisual(visual, span) : new PIXI.Sprite(PIXI.Texture.EMPTY);
        sprite.eventMode = 'none';
        this.trackContactShadow(sprite, String(visual.textureUrl
            ?? (visual.textureKey ? this.getResolvedTextureUrl(visual.textureKey) : '') ?? ''));
        if (sprite instanceof PIXI.Sprite) {
            sprite.anchor.set(visual.anchorX, visual.anchorY);
            sprite.scale.set(FOXHOLE_BOARD_SPRITE_SCALE);
            const position = resolveFoxholeModificationTexturePosition(slot, bounds, this.getResolvedBuildSockets(), visual);
            sprite.rotation = (rotationDegrees * Math.PI) / 180;
            sprite.position.set(position.x, position.y);
        }
        sprite.alpha = alpha;
        this.modificationTextureAlphas.set(sprite, alpha);
        if (isFoxholeRoofModification({ id: visual.variantId })
            && this.resolveModificationTextureLayer(slot, { id: visual.variantId ?? '' }) !== 'roof') {
            this.offLaneRoofModificationSprites.add(sprite);
            sprite.alpha = this.getStructureTextureVisualAlpha(sprite);
        }

        const texture = visual.textureKey
            ? this.boardDefinition.textureResolver?.(visual.textureKey)
            : null;
        if (texture && !texture.destroyed) {
            sprite.texture = texture;
        } else {
            void this.ensureModificationVisualTextureLoaded(sprite, visual);
        }

        return sprite;
    }

    private syncModificationOverlay(): void {
        if (!this.hasInitializedStructureOverlays()) {
            return;
        }

        this.offLaneRoofModificationSprites.clear();
        this.clearOverlay(this.lowerModificationTextureOverlay);
        this.clearOverlay(this.modificationTextureOverlay);
        this.clearOverlay(this.trenchDefenseTextureOverlay);
        this.clearOverlay(this.upperModificationTextureOverlay);
        this.clearOverlay(this.roofModificationTextureOverlay);
        this.clearOverlay(this.modificationOverlay);

        if (this.boardState.visible === false) {
            this.lowerModificationTextureOverlay.visible = false;
            this.modificationTextureOverlay.visible = false;
            this.trenchDefenseTextureOverlay.visible = false;
            this.upperModificationTextureOverlay.visible = false;
            this.modificationOverlay.visible = false;
            return;
        }

        if (!this.isOperationalStructureEnabled()) {
            this.lowerModificationTextureOverlay.visible = false;
            this.modificationTextureOverlay.visible = false;
            this.trenchDefenseTextureOverlay.visible = false;
            this.upperModificationTextureOverlay.visible = false;
            this.modificationOverlay.visible = false;
            return;
        }

        const bounds = this.getResolvedModificationBounds();
        // Conversion clicks clear the old structure's modifications as well.
        if (activeNixieStructureModificationHoverPreview.value?.nodeId === String(this.boardId)
            && activeNixieStructureModificationHoverPreview.value?.targetAssetKey) return;
        const hideRoofs = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs) === true
            || this.shouldHideRoofForModificationPreview();
        const hovered = this.getResolvedModificationHoverPreview();
        const hoveredPreview = hideRoofs && hovered && isFoxholeRoofModification(hovered.variant) ? null : hovered;
        const asset = this.getResolvedAsset();
        const previewSelections = asset
            ? resolveModificationHoverPreviewSelections(asset, this.getResolvedModificationSelections(), hoveredPreview)
            : this.getResolvedModificationSelections();
        const selectedVariants = this.getResolvedSelectedModificationVariants(previewSelections)
            .filter(selection => !hoveredPreview || selection.slot.id !== hoveredPreview.slot.id)
            .filter(selection => !selection.variant.isUpgrade);
        const visibleVariants = selectedVariants.filter(selection => !hideRoofs || !isFoxholeRoofModification(selection.variant));
        if (!bounds || (selectedVariants.length === 0 && !hoveredPreview)) {
            this.lowerModificationTextureOverlay.visible = false;
            this.modificationTextureOverlay.visible = false;
            this.trenchDefenseTextureOverlay.visible = false;
            this.upperModificationTextureOverlay.visible = false;
            this.modificationOverlay.visible = false;
            return;
        }

        for (const selection of [...visibleVariants].sort((left, right) => this.compareSelectedModificationVariants(left, right))) {
            const visual = this.getResolvedModificationVisual(selection.slot, selection.variant);
            if (visual?.kind === 'full-structure') {
                switch (this.resolveModificationTextureLayer(selection.slot, selection.variant)) {
                    case 'roof':
                        this.roofModificationTextureOverlay.addChild(this.createModificationTextureVisual(selection.slot, visual, bounds));
                        break;
                    case 'lower':
                        this.lowerModificationTextureOverlay.addChild(this.createModificationTextureVisual(selection.slot, visual, bounds));
                        break;
                    case 'upper':
                        this.upperModificationTextureOverlay.addChild(this.createModificationTextureVisual(selection.slot, visual, bounds));
                        break;
                    case 'trenchDefense':
                        this.trenchDefenseTextureOverlay.addChild(this.createModificationTextureVisual(selection.slot, visual, bounds));
                        break;
                    default:
                        this.modificationTextureOverlay.addChild(this.createModificationTextureVisual(selection.slot, visual, bounds));
                        break;
                }
                continue;
            }

            this.modificationOverlay.addChild(this.createModificationBadgeVisual(selection.slot, selection.variant, bounds));
        }

        if (hoveredPreview) {
            const visual = this.getResolvedModificationVisual(hoveredPreview.slot, hoveredPreview.variant);
            if (visual?.kind === 'full-structure') {
                switch (this.resolveModificationTextureLayer(hoveredPreview.slot, hoveredPreview.variant)) {
                    case 'roof':
                        this.roofModificationTextureOverlay.addChild(this.createModificationTextureVisual(hoveredPreview.slot, visual, bounds, FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA));
                        break;
                    case 'lower':
                        this.lowerModificationTextureOverlay.addChild(
                            this.createModificationTextureVisual(
                                hoveredPreview.slot,
                                visual,
                                bounds,
                                FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA,
                            ),
                        );
                        break;
                    case 'upper':
                        this.upperModificationTextureOverlay.addChild(
                            this.createModificationTextureVisual(
                                hoveredPreview.slot,
                                visual,
                                bounds,
                                FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA,
                            ),
                        );
                        break;
                    case 'trenchDefense':
                        this.trenchDefenseTextureOverlay.addChild(
                            this.createModificationTextureVisual(
                                hoveredPreview.slot,
                                visual,
                                bounds,
                                FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA,
                            ),
                        );
                        break;
                    default:
                        this.modificationTextureOverlay.addChild(
                            this.createModificationTextureVisual(
                                hoveredPreview.slot,
                                visual,
                                bounds,
                                FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA,
                            ),
                        );
                        break;
                }
            } else {
                this.modificationOverlay.addChild(
                    this.createModificationBadgeVisual(
                        hoveredPreview.slot,
                        hoveredPreview.variant,
                        bounds,
                        MODIFICATION_HOVER_PREVIEW_BADGE_ALPHA,
                    ),
                );
            }
        }

        this.lowerModificationTextureOverlay.visible = this.lowerModificationTextureOverlay.children.length > 0;
        this.modificationTextureOverlay.visible = this.modificationTextureOverlay.children.length > 0;
        this.trenchDefenseTextureOverlay.visible = this.trenchDefenseTextureOverlay.children.length > 0;
        this.upperModificationTextureOverlay.visible = this.upperModificationTextureOverlay.children.length > 0;
        this.roofModificationTextureOverlay.visible = this.roofModificationTextureOverlay.children.length > 0;
        this.modificationOverlay.visible = this.modificationOverlay.children.length > 0;
    }

    private invalidateSelectionGeometry(): void {
        this.selectionGeometryCacheKey = '';
        this.selectionGeometryCache = null;
    }

    private syncCullAreaFromSelectionGeometry(geometry: FoxholeStructureSelectionGeometry | null): void {
        const bounds = geometry?.bounds;
        if (
            !bounds
            || !Number.isFinite(bounds.minX)
            || !Number.isFinite(bounds.minY)
            || !Number.isFinite(bounds.maxX)
            || !Number.isFinite(bounds.maxY)
        ) {
            this.cullArea = undefined;
            return;
        }

        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        if (!(width > 0) || !(height > 0)) {
            this.cullArea = undefined;
            return;
        }

        if (this.cullArea) {
            this.cullArea.x = bounds.minX;
            this.cullArea.y = bounds.minY;
            this.cullArea.width = width;
            this.cullArea.height = height;
            return;
        }

        this.cullArea = new PIXI.Rectangle(bounds.minX, bounds.minY, width, height);
    }

    private getSelectionRenderLayers(): readonly FoxholeStructureRenderLayerAsset[] {
        const codeName = this.getResolvedStructure()?.codeName;
        if (!/^trencht[12]$/i.test(String(codeName ?? ''))
            || this.boardState.destroyed === true
            || this.isPackagedVisualEnabled()
            || this.getEffectiveStructureReplacementSelection()) {
            return [];
        }
        return this.getResolvedAsset()?.renderLayers ?? [];
    }

    private getSelectionGeometryCacheKey(): string {
        const packagedSelectionSprite = this.getResolvedPackagedPalletSelectionSprite();
        const dimensions = packagedSelectionSprite ?? this.getResolvedDimensions();
        const spriteOffset = this.getResolvedSpriteOffset();
        const structure = packagedSelectionSprite ? null : this.getResolvedStructure();
        const selectionPolygons = packagedSelectionSprite ? [] : this.getResolvedSelectionPolygons();
        return [
            this.boardState.foxholeKey,
            structure?.id ?? '',
            dimensions.width ?? '',
            dimensions.height ?? '',
            packagedSelectionSprite?.anchorX ?? this.boardState.anchorX ?? 0.5,
            packagedSelectionSprite?.anchorY ?? this.boardState.anchorY ?? 0.5,
            packagedSelectionSprite?.offsetX ?? spriteOffset.x,
            packagedSelectionSprite?.offsetY ?? spriteOffset.y,
            packagedSelectionSprite?.rotationRadians ?? 0,
            ...selectionPolygons.flatMap(polygon => polygon.shape),
            ...this.getSelectionRenderLayers().flatMap(layer => [layer.id, layer.width, layer.height, layer.offsetX, layer.offsetY]),
        ].join('|');
    }

    private buildSelectionGeometry(options: { includeSelectionPolygons?: boolean; } = {}): FoxholeStructureSelectionGeometry | null {
        const packagedSelectionSprite = this.getResolvedPackagedPalletSelectionSprite();
        const dimensions = packagedSelectionSprite ?? this.getResolvedDimensions();
        const spriteOffset = this.getResolvedSpriteOffset();
        const structure = packagedSelectionSprite ? undefined : this.getResolvedStructure();
        return buildFoxholeStructureSelectionGeometry({
            structure,
            selectionPolygons: options.includeSelectionPolygons === false
                ? []
                : this.getResolvedSelectionPolygons(),
            renderLayers: this.getSelectionRenderLayers(),
            sprite: {
                width: dimensions.width,
                height: dimensions.height,
                anchorX: packagedSelectionSprite?.anchorX ?? this.boardState.anchorX,
                anchorY: packagedSelectionSprite?.anchorY ?? this.boardState.anchorY,
                offsetX: packagedSelectionSprite?.offsetX ?? spriteOffset.x,
                offsetY: packagedSelectionSprite?.offsetY ?? spriteOffset.y,
                rotationRadians: packagedSelectionSprite?.rotationRadians ?? 0,
            },
            pixelsPerUnit: FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
        });
    }

    private getSelectionGeometry(): FoxholeStructureInteractionGeometry | null {
        const cacheKey = this.getSelectionGeometryCacheKey();
        if (this.selectionGeometryCacheKey !== cacheKey) {
            this.selectionGeometryCacheKey = cacheKey;
            this.selectionGeometryCache = this.buildSelectionGeometry();
            this.syncCullAreaFromSelectionGeometry(this.buildSelectionGeometry({ includeSelectionPolygons: false }));
        }

        return this.selectionGeometryCache;
    }

    getSelectionLocalBounds(): BoardNodeSelectionBounds | null {
        return this.getSelectionGeometry()?.bounds ?? null;
    }

    getSelectionLocalPolygons(): readonly { x: number; y: number; }[][] {
        return (this.getSelectionGeometry()?.hitPolygons ?? []).map(shape => {
            const points: { x: number; y: number; }[] = [];
            for (let index = 0; index + 1 < shape.length; index += 2) {
                points.push({ x: shape[index]!, y: shape[index + 1]! });
            }
            return points;
        });
    }

    getSelectionTransformOriginLocal(): { x: number; y: number; } {
        return { x: 0, y: 0 };
    }

    containsWorldPoint(world: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        if (this.boardState.visible === false) {
            return false;
        }

        const geometry = this.getSelectionGeometry();
        if (!geometry) {
            return false;
        }

        const global = context.viewport.toGlobal(world);
        const local = this.toLocal(global);
        return isPointInsideFoxholeStructureSelectionGeometry(local.x, local.y, geometry);
    }

    getBunkerRoofHoverNetworkNode(): FoxholeSocketNetworkSceneNode | null {
        const structure = this.getResolvedStructure();
        if (!structure || this.boardState.visible === false) {
            return null;
        }

        return {
            nodeId: String(this.boardId),
            foxholeKey: String(this.boardState.foxholeKey),
            buildSockets: this.getResolvedBuildSockets(structure),
            socketAttachments: this.getNormalizedSocketAttachments(),
            profileType: structure.profileType ?? null,
            structuralIntegrity: structure.structuralIntegrity ?? null,
            isBunker: structure.isBunker === true,
            isFacility: structure.isFacility === true,
            isDestroyed: structure.isDestroyed === true,
            isBreached: structure.isBreached === true,
            codeName: structure.codeName ?? null,
        };
    }

    setBunkerRoofHoverFaded(faded: boolean, immediate = false): boolean {
        this.bunkerCargoHoverFaded = faded;
        this.syncCargoTileHoverAlpha();
        const alpha = faded ? BUNKER_ROOF_HOVER_ALPHA : 1;
        if (immediate) {
            this.bunkerRoofHoverFade = null;
            this.applyBunkerRoofHoverAlpha(alpha);
            return false;
        }
        if ((this.bunkerRoofHoverFade?.to ?? this.structureRoofTextureOverlay.alpha) === alpha) {
            return this.bunkerRoofHoverFade !== null;
        }
        this.bunkerRoofHoverFade = {
            from: this.structureRoofTextureOverlay.alpha,
            to: alpha,
            elapsedMs: 0,
        };
        return true;
    }

    advanceBunkerRoofHoverFade(deltaMs: number): boolean {
        const fade = this.bunkerRoofHoverFade;
        if (!fade) {
            return false;
        }
        fade.elapsedMs = Math.min(BUNKER_ROOF_HOVER_FADE_MS, fade.elapsedMs + Math.max(0, deltaMs));
        const progress = fade.elapsedMs / BUNKER_ROOF_HOVER_FADE_MS;
        const eased = progress * progress * (3 - 2 * progress);
        const alpha = fade.from + (fade.to - fade.from) * eased;
        this.applyBunkerRoofHoverAlpha(alpha);
        if (progress >= 1) {
            this.bunkerRoofHoverFade = null;
            return false;
        }
        return true;
    }

    private applyBunkerRoofHoverAlpha(alpha: number): void {
        this.structureRoofTextureOverlay.alpha = alpha;
        this.roofModificationTextureOverlay.alpha = alpha;
        this.syncBunkerSpotlightGlowAlpha();
        for (const sprite of [...this.offLaneRoofSprites, ...this.offLaneRoofModificationSprites]) {
            sprite.alpha = this.getStructureTextureVisualAlpha(sprite);
        }
    }

    private bindDebugOverlaySettings(): void {
        if (this.settingsWatcher) {
            return;
        }

        // Retired settings can disappear before the old board node is destroyed.
        // Skip overlay work until their definitions are registered again.
        this.settingsWatcher = watch(() => {
            return FOXHOLE_STRUCTURE_DEBUG_OVERLAY_SETTING_IDS.map(settingId => this.settingsStore.getValueOr(settingId, undefined));
        }, values => {
            if (this.destroyed || values.some(value => typeof value === 'undefined')) {
                return;
            }

            this.renderLayerVisibilitySignature = this.getStructureRenderLayerVisibilitySignature();
            this.syncSpriteFromState();
        });

        this.rangeSettingsWatcher = watch(() => {
            return [
                ...FOXHOLE_STRUCTURE_RANGE_OVERLAY_SETTING_IDS.map(settingId => this.settingsStore.getValueOr(settingId, undefined)),
                this.settingsStore.getValue('nixie.debug.overlay'),
            ];
        }, (values, previousValues) => {
            if (!this.destroyed && values.every(value => typeof value !== 'undefined')) {
                if (values.slice(0, FOXHOLE_NIGHT_RANGE_SETTING_IDS.length).some((value, index) => value !== previousValues[index])) {
                    this.syncStructureRenderLayers();
                }
                this.syncRangeOverlay();
            }
        });

        this.selectionStateWatcher = subscribeToNixieSelectionState(String(this.boardId), selected => {
            if (!this.destroyed) {
                // A settled load failure leaves this instance empty even if another
                // node later caches the same art. Selection can retry the bounded
                // loader without resyncing the saved transform over a live pose.
                if (selected && (this.spriteObject.texture === PIXI.Texture.EMPTY || this.spriteObject.texture.destroyed)) {
                    void this.ensureTextureLoaded();
                }
                this.syncRangeOverlay();
                this.syncHitboxDebugOverlay();
            }
        });

        this.itemTileSettingsWatcher = watch(() => [
            resolveNxTheme(this.settingsStore.getValue(NIXIE_COLOR_THEME_SETTING_ID) as NxThemePreference),
            this.settingsStore.getValueOr(FOXHOLE_STATS_SETTING_KEYS.timeInterval, undefined),
            this.settingsStore.getValueOr(FOXHOLE_STATS_SETTING_KEYS.customIntervalSeconds, undefined),
            canvasHoverPopover.value?.owner,
        ] as const, ([theme, interval, customSeconds], [previousTheme]) => {
            if (!this.destroyed && typeof interval !== 'undefined' && typeof customSeconds !== 'undefined') {
                if (theme !== previousTheme) {
                    this.markedCargoOverlayCacheKey = '';
                }
                this.syncMarkedCargoOverlay();
            }
        });

        // Dev cargo-overlay offset edits update a Vue Map; re-apply PIXI position when this
        // structure's resolved offset changes (transform sync alone does not watch that Map).
        if (import.meta.dev) {
            this.markedCargoDevOffsetWatcher = watch(() => {
                const offset = resolveFoxholeMarkedCargoOverlayLocalOffset({
                    foxholeKey: this.boardState.foxholeKey,
                    manifestOverlay: this.getResolvedStructure()?.markedCargoOverlay,
                });
                return `${offset.x}:${offset.y}`;
            }, () => {
                if (!this.destroyed && this.markedCargoOverlay.visible) {
                    this.syncMarkedCargoOverlayTransform();
                }
            });
        }
    }

    syncLiveTransformOverlays(): void {
        this.syncMarkedCargoOverlayCounterRotation();
        this.syncStructureRangeOverlayLabelRotations();
        if (this.socketOverlay.visible) {
            syncUprightBoardOverlayChildren(this.rotation, this.socketOverlay);
        }
        // Selection transforms update Pixi directly before their final board-state
        // commit. Only a single selected structure earns the immediate range-mask
        // refresh; multi-selection waits for its committed-state update.
        const selectedIds = activeNixieSelectionIds.value;
        if (selectedIds.length === 1 && selectedIds[0] === String(this.boardId)) {
            syncFoxholeLineOfSightOverlays(this);
        }
        // Multi-selection poses are intentionally not recalculated while the
        // pointer is down. This prevents every selected node from queueing a
        // full scene LOS rebuild per frame; the normal committed-state sync
        // refreshes once when the transform is released.
    }

    /** Called at pointer-move cadence by the shared live-transform sync. */
    syncLiveLineOfSightMask(movingStructure: FoxholeStructureNode): void {
        if (!this.destroyed && this.isLineOfSightAffectedByLiveTransform(movingStructure)) {
            this.syncLineOfSightMask({ live: true });
        }
    }

    /** Refreshes the explicit Debug > Hitboxes overlay after a child edit. */
    refreshHitboxOverlay(): void {
        if (!this.destroyed) {
            this.syncHitboxDebugOverlay();
        }
    }

    override addBoardChild(child: BoardNodeBase<any, any>, index?: number): BoardNodeBase<any, any> {
        const added = super.addBoardChild(child, index);
        this.syncHitboxDebugOverlay();
        return added;
    }

    override removeBoardChild(child: BoardNodeBase<any, any>, destroy = false): boolean {
        const removed = super.removeBoardChild(child, destroy);
        if (removed) {
            this.syncHitboxDebugOverlay();
        }
        return removed;
    }

    private syncStructureRangeOverlayLabelRotations(): void {
        if (!this.rangeOverlay.visible) {
            return;
        }

        const counterRotation = -this.rotation;
        for (const entry of this.rangeOverlayEntries) {
            if (entry.label) {
                entry.label.rotation = counterRotation;
            }
        }
    }

    private syncMarkedCargoOverlayCounterRotation(): void {
        if (!this.markedCargoOverlay.visible && !this.productionOutputOverlay.visible) {
            return;
        }

        this.markedCargoOverlay.rotation = -this.rotation;
        this.productionOutputOverlay.rotation = -this.rotation;
    }

    private getDebugOverlaySettings(): FoxholeStructureDebugOverlaySettings {
        const visibleVolumeCategories = new Set<string>();
        for (const definition of FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS) {
            if (this.settingsStore.getValue(definition.settingId) === true) {
                visibleVolumeCategories.add(definition.category);
            }
        }

        return {
            showAllSockets: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets) === true,
            showPowerSockets: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets) === true,
            showPipeSockets: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets) === true,
            showBreachIndicators: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.breachIndicators) === true,
            showSocketLabels: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels) === true,
            showModificationSlots: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.modificationSlots) === true,
            showVehicleSeats: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.vehicleSeats) === true,
            showSpotlights: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.spotlights) === true,
            visibleVolumeCategories,
        };
    }

    private getPipeSocketOverlayColor(socket: FoxholeResolvedStructureSocket): number {
        return resolveFoxholePipeSocketColor(resolveFoxholePipeSocketFlow(socket.socket.pipeType));
    }

    private getResolvedSpriteOffset(): {
        x: number;
        y: number;
    } {
        return resolveFoxholeStructureSpriteOffset(this.getResolvedStructure()?.sprite,
            this.getResolvedPackagedVisual() ?? this.getResolvedDestroyedVisual(),
            this.getEffectiveStructureReplacementSelection()?.variant);
    }

    private getFootprintBoundsFromShapes(shapes: readonly number[][]): FootprintBounds | null {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const shape of shapes) {
            for (let index = 0; index < shape.length; index += 2) {
                const x = Number(shape[index] ?? 0);
                const y = Number(shape[index + 1] ?? 0);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    continue;
                }

                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }

        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return null;
        }

        return { minX, minY, maxX, maxY };
    }

    private getStructureVolumeBounds(structure: FoxholeManifestStructure, category?: string): FootprintBounds | null {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const volume of structure.structureVolumes) {
            const volumeCategory = String(volume.category ?? '').trim();
            if (category && volumeCategory !== category) {
                continue;
            }

            const centerX = Number(volume.x ?? NaN) / 100;
            const centerY = Number(volume.y ?? NaN) / 100;
            const halfWidth = Number(volume.width ?? NaN) / 100;
            const halfLength = Number(volume.length ?? NaN) / 100;
            if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(halfWidth) || !Number.isFinite(halfLength)) {
                continue;
            }

            minX = Math.min(minX, centerX - halfWidth);
            maxX = Math.max(maxX, centerX + halfWidth);
            minY = Math.min(minY, centerY - halfLength);
            maxY = Math.max(maxY, centerY + halfLength);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return null;
        }

        return { minX, minY, maxX, maxY };
    }

    private getFootprintBoundsFromOverlayPoints(entries: ReadonlyArray<{ x?: number | null; y?: number | null; }>): FootprintBounds | null {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const entry of entries) {
            const entryX = Number(entry.x ?? NaN) / 100;
            const entryY = Number(entry.y ?? NaN) / 100;
            if (!Number.isFinite(entryX) || !Number.isFinite(entryY)) {
                continue;
            }

            minX = Math.min(minX, entryX);
            maxX = Math.max(maxX, entryX);
            minY = Math.min(minY, entryY);
            maxY = Math.max(maxY, entryY);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return null;
        }

        return { minX, minY, maxX, maxY };
    }

    private getFootprintBoundsFromSockets(buildSockets: readonly FoxholeManifestBuildSocket[]): FootprintBounds | null {
        return this.getFootprintBoundsFromOverlayPoints(buildSockets);
    }

    private getSocketTags(socketTags: readonly FoxholeManifestSocketTag[] | null | undefined): FoxholeSocketTagBitfield[] {
        return normalizeFoxholeSocketTags(socketTags);
    }

    private resolveStructureSockets(
        buildSockets: readonly FoxholeManifestBuildSocket[],
        socketOrigin: { x: number; y: number; },
    ): FoxholeResolvedStructureSocket[] {
        return resolveFoxholeStructureOverlaySockets(buildSockets, socketOrigin, String(this.id));
    }

    private hasSnapSocketStructure(): boolean {
        const structure = this.getResolvedStructure();
        if (!structure) {
            return false;
        }

        return this.getResolvedBuildSockets(structure).some(socket => {
            return isFoxholeRailCouplerSocket(socket)
                || hasFoxholeSnapSocketTags(this.getSocketTags(socket.socketTags));
        });
    }

    private getNormalizedSocketAttachments(): FoxholeStructureSocketAttachmentMap {
        return normalizeFoxholeStructureSocketAttachmentMap(this.boardState.socketAttachments);
    }

    private resolveModificationAvailabilitySceneNodes(): FoxholeStructureModAvailabilitySceneNode[] {
        const container = this.getTopBoardContainer();
        const structureNodes = container
            ? this.collectSnapSocketOverlaySceneNodes(container)
            : [this];

        return structureNodes.flatMap(node => {
            const structure = node.getResolvedStructure();
            const foxholeKey = String(node.boardState.foxholeKey ?? '').trim();
            if (!structure || !foxholeKey) {
                return [];
            }

            return [{
                nodeId: String(node.boardId),
                foxholeKey,
                buildSockets: node.getResolvedBuildSockets(structure),
                socketAttachments: node.getNormalizedSocketAttachments(),
            }];
        });
    }

    private sanitizeModificationVariantSelections(
        selections: FoxholeStructureModificationSelectionMap,
        socketAttachments: FoxholeStructureSocketAttachmentMap,
        foxholeKey = this.boardState.foxholeKey,
    ): FoxholeStructureModificationSelectionMap {
        const asset = this.boardDefinition.assetResolver?.(foxholeKey);
        const structure = this.boardDefinition.structureResolver?.(foxholeKey);
        if (!asset || !structure) {
            return selections;
        }

        return sanitizeFoxholeModificationSelections(asset, selections, {
            nodeId: String(this.boardId),
            buildSockets: structure.buildSockets ?? [],
            socketAttachments,
            sceneNodes: this.resolveModificationAvailabilitySceneNodes(),
        });
    }

    private createSocketAttachmentPairKey(
        leftNodeId: string,
        leftSocketName: string,
        rightNodeId: string,
        rightSocketName: string,
    ): string {
        return [
            `${leftNodeId}:${leftSocketName}`,
            `${rightNodeId}:${rightSocketName}`,
        ].sort().join('|');
    }

    private collectSnapSocketOverlaySceneNodes(container: PIXI.Container): FoxholeStructureNode[] {
        const nodes: FoxholeStructureNode[] = [];
        const visit = (node: PIXI.Container) => {
            if (node instanceof FoxholeStructureNode && node.hasSnapSocketStructure()) {
                nodes.push(node);
            }

            if (node instanceof PIXI.Container) {
                for (const child of node.children) {
                    if (child instanceof PIXI.Container) {
                        visit(child);
                    }
                }
            }
        };

        for (const child of container.children) {
            if (child instanceof PIXI.Container) {
                visit(child);
            }
        }

        return nodes;
    }

    private collectSplineConnectorOverlayHosts(container: PIXI.Container) {
        const hosts: Array<{
            boardId: string | number;
            boardState: {
                socketAttachments?: FoxholeStructureSocketAttachmentMap;
                startAttachment?: FoxholeConnectorEndpointAttachment | null;
                endAttachment?: FoxholeConnectorEndpointAttachment | null;
                startSocketName?: string;
                endSocketName?: string;
            };
            collectSnapSocketPoints: (
                viewport: BoardNodeEditableHandleContext['viewport'],
                originOverride?: { x: number; y: number; } | null,
                rotationOverride?: number | null,
            ) => FoxholeSocketSnapPoint[];
            hasTransientTransformPreview?: () => boolean;
        }> = [];
        const visit = (node: PIXI.Container) => {
            if (isSplineConnectorSocketSnapHost(node) && 'boardId' in node) {
                hosts.push(node as typeof hosts[number]);
            }

            if (node instanceof PIXI.Container) {
                for (const child of node.children) {
                    if (child instanceof PIXI.Container) {
                        visit(child);
                    }
                }
            }
        };

        for (const child of container.children) {
            if (child instanceof PIXI.Container) {
                visit(child);
            }
        }

        return hosts;
    }

    private buildSocketOverlayOccupancyNodes(
        structureNodes: readonly FoxholeStructureNode[],
        connectorHosts: ReturnType<FoxholeStructureNode['collectSplineConnectorOverlayHosts']>,
        viewport: BoardNodeEditableHandleContext['viewport'] | null,
        previewTransforms: Readonly<Record<string, { x: number; y: number; rotation: number; }>>,
    ) {
        return [
            ...structureNodes.map(node => {
                const previewTransform = previewTransforms[String(node.boardId)];
                return {
                    nodeId: String(node.boardId),
                    sockets: viewport
                        ? (previewTransform
                            ? node.collectSnapSocketPoints(viewport, {
                                x: previewTransform.x,
                                y: previewTransform.y,
                            }, previewTransform.rotation)
                            : node.collectSnapSocketPoints(viewport))
                        : node.collectSnapSocketGlobalPoints(),
                    attachments: node.getNormalizedSocketAttachments(),
                    moving: !!previewTransform || node.hasTransientTransformPreview(),
                };
            }),
            ...connectorHosts.map(node => {
                const nodeId = String(node.boardId);
                const previewTransform = previewTransforms[nodeId];
                const sockets = viewport
                    ? (previewTransform
                        ? node.collectSnapSocketPoints(viewport, {
                            x: previewTransform.x,
                            y: previewTransform.y,
                        }, previewTransform.rotation)
                        : node.collectSnapSocketPoints(viewport))
                    : [];
                return {
                    nodeId,
                    sockets,
                    attachments: this.getConnectorOccupancyAttachments(node),
                    moving: !!previewTransform || node.hasTransientTransformPreview?.() === true,
                };
            }),
        ];
    }

    private getSnapSocketOverlaySceneState(): FoxholeSocketOverlaySceneState | null {
        if (!this.hasSnapSocketStructure()) {
            return null;
        }

        const container = this.getTopBoardContainer();
        const viewport = activeNixieViewport.value;
        const previewTransforms = activeNixiePlacementPreviewTransforms.value;

        if (!container) {
            const snapNodes = [this];
            return {
                version: foxholeSocketOverlaySceneCacheVersion,
                frameTime: PIXI.Ticker.shared.lastTime,
                previewTransforms,
                viewport,
                snapNodes,
                occupiedSocketKeys: resolveFoxholeOccupiedSocketKeys(this.buildSocketOverlayOccupancyNodes(
                    snapNodes,
                    [],
                    viewport,
                    previewTransforms,
                )),
            };
        }

        const cached = foxholeSocketOverlaySceneCache.get(container);
        if (
            cached
            && cached.version === foxholeSocketOverlaySceneCacheVersion
            && cached.frameTime === PIXI.Ticker.shared.lastTime
            && cached.previewTransforms === previewTransforms
            && cached.viewport === viewport
        ) {
            return cached;
        }

        const snapNodes = this.collectSnapSocketOverlaySceneNodes(container);
        const connectorHosts = this.collectSplineConnectorOverlayHosts(container);
        const nextState: FoxholeSocketOverlaySceneState = {
            version: foxholeSocketOverlaySceneCacheVersion,
            frameTime: PIXI.Ticker.shared.lastTime,
            previewTransforms,
            viewport,
            snapNodes,
            occupiedSocketKeys: resolveFoxholeOccupiedSocketKeys(this.buildSocketOverlayOccupancyNodes(
                snapNodes,
                connectorHosts,
                viewport,
                previewTransforms,
            )),
        };
        foxholeSocketOverlaySceneCache.set(container, nextState);
        return nextState;
    }

    private getSnapSocketOccupancyMap(): ReadonlySet<string> {
        const sceneState = this.getSnapSocketOverlaySceneState();
        if (!sceneState) {
            return new Set<string>();
        }

        return sceneState.occupiedSocketKeys;
    }

    private getSnapSocketOverlayOccupancySignature(occupiedSocketKeys: ReadonlySet<string>): string {
        const structure = this.getResolvedStructure();
        if (!structure) {
            return '';
        }

        return this.getResolvedBuildSockets(structure)
            .flatMap(socket => {
                const socketName = String(socket.name ?? '').trim();
                if (!socketName) {
                    return [];
                }

                const socketTags = this.getSocketTags(socket.socketTags);
                if (!isFoxholeRailCouplerSocket(socket) && !hasFoxholeSnapSocketTags(socketTags)) {
                    return [];
                }

                return [`${socketName}:${occupiedSocketKeys.has(`${String(this.boardId)}:${socketName}`) ? 1 : 0}`];
            })
            .sort()
            .join(',');
    }

    private getSnapSocketOverlayPreviewSignature(): string {
        if (!this.hasSnapSocketStructure()) {
            return '';
        }

        const previewTransforms = activeNixiePlacementPreviewTransforms.value;
        const previewTransform = previewTransforms[String(this.boardId)];
        const attachmentSignature = Object.entries(this.getNormalizedSocketAttachments())
            .sort(([leftSocketName], [rightSocketName]) => leftSocketName.localeCompare(rightSocketName))
            .map(([socketName, attachment]) => `${socketName}:${attachment.nodeId}:${attachment.socketName}`)
            .join(',');
        const occupiedSocketSignature = this.getSnapSocketOverlayOccupancySignature(this.getSocketOverlayOccupancyKeys());
        const previewTransformSignature = previewTransform
            ? `${previewTransform.x.toFixed(3)}:${previewTransform.y.toFixed(3)}:${previewTransform.rotation.toFixed(4)}`
            : `${this.x.toFixed(3)}:${this.y.toFixed(3)}:${this.rotation.toFixed(4)}`;
        return `${String(this.boardId)}:${previewTransformSignature}:${this.boardRevision.value}:${previewTransform ? 1 : (this.hasTransientTransformPreview() ? 1 : 0)}:${attachmentSignature}:${occupiedSocketSignature}`;
    }

    private isSocketOccupiedForOverlay(socketName: string | null | undefined): boolean {
        const normalizedSocketName = String(socketName ?? '').trim();
        if (!normalizedSocketName) {
            return false;
        }

        const occupied = this.getSocketOverlayOccupancyKeys();
        return occupied.has(`${String(this.boardId)}:${normalizedSocketName}`);
    }

    private hasTransientTransformPreview(): boolean {
        const stateX = Number(this.boardState.x ?? 0);
        const stateY = Number(this.boardState.y ?? 0);
        const stateRotation = Number(this.boardState.rotation ?? 0);
        return Math.abs(this.x - stateX) > 0.0001
            || Math.abs(this.y - stateY) > 0.0001
            || Math.abs(this.rotation - stateRotation) > 0.0001;
    }

    private getTopBoardContainer(): PIXI.Container | null {
        let current = this as unknown as PIXI.Container;
        while (current.parent instanceof BoardSpriteNode) {
            current = current.parent;
        }

        return current.parent as PIXI.Container | null;
    }

    private collectSnapSocketGlobalPoints(): FoxholeSocketSnapPoint[] {
        if (!this.hasSnapSocketStructure()) {
            return [];
        }

        // Prefer board-world sockets via the active viewport. Raw toGlobal() is screen space
        // and will misplace connectors that consume these points as board coordinates.
        const viewport = activeNixieViewport.value;
        if (viewport) {
            return this.collectSnapSocketPoints(viewport);
        }

        const structure = this.getResolvedStructure();
        if (!structure) {
            return [];
        }

        return this.getResolvedBuildSockets(structure).flatMap(socket => {
            const socketName = String(socket.name ?? '').trim();
            if (!socketName) {
                return [];
            }

            const socketPosition = resolveFoxholeBuildSocketPosition(socket);
            if (!socketPosition) {
                return [];
            }

            const socketX = (socketPosition.x / 100) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT;
            const socketY = (socketPosition.y / 100) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT;

            const socketTags = this.getSocketTags(socket.socketTags);
            if (!isFoxholeRailCouplerSocket(socket) && !hasFoxholeSnapSocketTags(socketTags)) {
                return [];
            }

            const socketRotationRadians = (Number(socket.rotation ?? 0) * Math.PI) / 180;
            const parent = this.parent;
            const socketBoard = parent
                ? parent.toLocal(this.toGlobal(new PIXI.Point(socketX, socketY)))
                : new PIXI.Point(this.x + socketX, this.y + socketY);
            const directionBoard = parent
                ? parent.toLocal(this.toGlobal(new PIXI.Point(
                    socketX + (Math.cos(socketRotationRadians) * 8),
                    socketY + (Math.sin(socketRotationRadians) * 8),
                )))
                : new PIXI.Point(
                    this.x + socketX + (Math.cos(socketRotationRadians) * 8),
                    this.y + socketY + (Math.sin(socketRotationRadians) * 8),
                );

            return [{
                nodeId: String(this.boardId),
                socketName,
                x: socketBoard.x,
                y: socketBoard.y,
                rotation: Math.atan2(directionBoard.y - socketBoard.y, directionBoard.x - socketBoard.x),
                socketTags,
            }];
        });
    }

    private resolveSocketSnapPoint(
        socket: FoxholeManifestBuildSocket,
        viewport: BoardNodeEditableHandleContext['viewport'],
        originOverride?: { x: number; y: number; } | null,
        rotationOverride?: number | null,
    ): FoxholeSocketSnapPoint | null {
        const socketName = String(socket.name ?? '').trim();
        if (!socketName) {
            return null;
        }

        const socketPosition = resolveFoxholeBuildSocketPosition(socket);
        if (!socketPosition) {
            return null;
        }

        const socketX = (socketPosition.x / 100) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT;
        const socketY = (socketPosition.y / 100) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT;

        const socketTags = this.getSocketTags(socket.socketTags);
        if (!isFoxholeRailCouplerSocket(socket) && !hasFoxholeSnapSocketTags(socketTags)) {
            return null;
        }

        const socketRotationRadians = (Number(socket.rotation ?? 0) * Math.PI) / 180;
        if (originOverride) {
            const nodeRotation = Number(rotationOverride ?? this.rotation ?? 0);
            const rotatedOffset = rotatePoint({ x: socketX, y: socketY }, nodeRotation);
            return {
                nodeId: String(this.boardId),
                socketName,
                x: originOverride.x + rotatedOffset.x,
                y: originOverride.y + rotatedOffset.y,
                rotation: nodeRotation + socketRotationRadians,
                socketTags,
            };
        }

        const originWorld = viewport.toWorld(this.toGlobal(new PIXI.Point(0, 0)));
        const socketWorld = viewport.toWorld(this.toGlobal(new PIXI.Point(socketX, socketY)));
        const directionWorld = viewport.toWorld(this.toGlobal(new PIXI.Point(
            socketX + (Math.cos(socketRotationRadians) * 8),
            socketY + (Math.sin(socketRotationRadians) * 8),
        )));

        return {
            nodeId: String(this.boardId),
            socketName,
            x: socketWorld.x,
            y: socketWorld.y,
            rotation: Math.atan2(directionWorld.y - socketWorld.y, directionWorld.x - socketWorld.x),
            socketTags,
        };
    }

    private collectSnapSocketPoints(
        viewport: BoardNodeEditableHandleContext['viewport'],
        originOverride?: { x: number; y: number; } | null,
        rotationOverride?: number | null,
    ): FoxholeSocketSnapPoint[] {
        if (!this.hasSnapSocketStructure()) {
            return [];
        }

        const structure = this.getResolvedStructure();
        if (!structure) {
            return [];
        }

        return this.getResolvedBuildSockets(structure).flatMap(socket => {
            const point = this.resolveSocketSnapPoint(socket, viewport, originOverride, rotationOverride);
            return point ? [point] : [];
        });
    }

    private getMoveSnapTargetSocketCellKey(x: number, y: number, cellSize: number): string {
        return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
    }

    private createMoveSnapTargetSocketSpatialIndex(targetSockets: readonly FoxholeSocketSnapPoint[]): FoxholeMoveSnapSocketSpatialIndex {
        const socketsByCell = new Map<string, FoxholeSocketSnapPoint[]>();

        for (const socket of targetSockets) {
            const cellKey = this.getMoveSnapTargetSocketCellKey(socket.x, socket.y, FOXHOLE_MOVE_SNAP_TARGET_SOCKET_CELL_SIZE);
            const bucket = socketsByCell.get(cellKey);
            if (bucket) {
                bucket.push(socket);
                continue;
            }

            socketsByCell.set(cellKey, [socket]);
        }

        return {
            cellSize: FOXHOLE_MOVE_SNAP_TARGET_SOCKET_CELL_SIZE,
            socketsByCell,
        };
    }

    private getMoveSnapCandidateTargetSockets(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
        movingSockets: readonly FoxholeSocketSnapPoint[],
        targetSocketSpatialIndex: FoxholeMoveSnapSocketSpatialIndex,
    ): FoxholeSocketSnapPoint[] {
        if (!movingSockets.length) {
            return [];
        }

        const candidateTargetSockets: FoxholeSocketSnapPoint[] = [];
        const seenTargetSocketKeys = new Set<string>();
        const cellSize = targetSocketSpatialIndex.cellSize;

        for (const movingSocket of movingSockets) {
            const movedX = movingSocket.x + context.moveX;
            const movedY = movingSocket.y + context.moveY;
            const pointerDistance = context.pointerWorld
                ? Math.hypot(context.pointerWorld.x - movedX, context.pointerWorld.y - movedY)
                : Number.POSITIVE_INFINITY;
            const pointerTargetsSocket = FOXHOLE_MOVE_SNAP_POINTER_SOCKET_RADIUS > 0 && pointerDistance <= FOXHOLE_MOVE_SNAP_POINTER_SOCKET_RADIUS;
            const maxRotationDelta = pointerTargetsSocket
                ? Math.PI
                : MAX_FOXHOLE_MOVE_SNAP_ROTATION_LEEWAY_RADIANS;
            const maxRotationDisplacement = context.rotatePivot
                ? 2 * Math.hypot(movingSocket.x - context.rotatePivot.x, movingSocket.y - context.rotatePivot.y) * Math.sin(Math.abs(maxRotationDelta) / 2)
                : 0;
            const queryRadius = DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE + maxRotationDisplacement;
            const minCellX = Math.floor((movedX - queryRadius) / cellSize);
            const maxCellX = Math.floor((movedX + queryRadius) / cellSize);
            const minCellY = Math.floor((movedY - queryRadius) / cellSize);
            const maxCellY = Math.floor((movedY + queryRadius) / cellSize);

            for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
                for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
                    const bucket = targetSocketSpatialIndex.socketsByCell.get(`${cellX}:${cellY}`);
                    if (!bucket) {
                        continue;
                    }

                    for (const targetSocket of bucket) {
                        const targetSocketKey = `${targetSocket.nodeId}:${targetSocket.socketName}`;
                        if (seenTargetSocketKeys.has(targetSocketKey)) {
                            continue;
                        }

                        seenTargetSocketKeys.add(targetSocketKey);
                        candidateTargetSockets.push(targetSocket);
                    }
                }
            }
        }

        return candidateTargetSockets;
    }

    /** Query target sockets near absolute world points (sockets already at live pose). */
    private queryMoveSnapTargetSocketsNearWorldPoints(
        worldPoints: readonly { x: number; y: number; }[],
        targetSocketSpatialIndex: FoxholeMoveSnapSocketSpatialIndex,
        radius: number,
    ): FoxholeSocketSnapPoint[] {
        if (!worldPoints.length || !(radius > 0)) {
            return [];
        }

        const candidateTargetSockets: FoxholeSocketSnapPoint[] = [];
        const seenTargetSocketKeys = new Set<string>();
        const cellSize = targetSocketSpatialIndex.cellSize;

        for (const point of worldPoints) {
            const minCellX = Math.floor((point.x - radius) / cellSize);
            const maxCellX = Math.floor((point.x + radius) / cellSize);
            const minCellY = Math.floor((point.y - radius) / cellSize);
            const maxCellY = Math.floor((point.y + radius) / cellSize);

            for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
                for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
                    const bucket = targetSocketSpatialIndex.socketsByCell.get(`${cellX}:${cellY}`);
                    if (!bucket) {
                        continue;
                    }

                    for (const targetSocket of bucket) {
                        const targetSocketKey = `${targetSocket.nodeId}:${targetSocket.socketName}`;
                        if (seenTargetSocketKeys.has(targetSocketKey)) {
                            continue;
                        }

                        if (Math.hypot(targetSocket.x - point.x, targetSocket.y - point.y) > radius) {
                            continue;
                        }

                        seenTargetSocketKeys.add(targetSocketKey);
                        candidateTargetSockets.push(targetSocket);
                    }
                }
            }
        }

        return candidateTargetSockets;
    }

    private getMoveSnapSceneState(context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0]): FoxholeMoveSnapSceneState {
        const cached = foxholeMoveSnapSceneCache;
        if (
            cached
            && cached.viewport === context.viewport
            && cached.selectedNodes === context.selectedNodes
            && cached.stationaryNodes === context.stationaryNodes
            && cached.selectedWorldOrigins === context.selectedWorldOrigins
            && cached.selectedInitialRotations === context.selectedInitialRotations
        ) {
            return cached;
        }

        const selectedSocketsByNode = new Map<string, readonly FoxholeSocketSnapPoint[]>();
        const previewSocketNodes: Array<{
            nodeId: string;
            sockets: readonly FoxholeSocketSnapPoint[];
            attachments: FoxholeStructureSocketAttachmentMap;
        }> = [];
        const targetSockets: FoxholeSocketSnapPoint[] = [];

        for (const node of context.selectedNodes) {
            if (node instanceof FoxholeStructureNode && node.hasSnapSocketStructure()) {
                const nodeId = String(node.boardId);
                const origin = context.selectedWorldOrigins.get(nodeId);
                const rotation = context.selectedInitialRotations.get(nodeId);
                const sockets = origin && Number.isFinite(rotation)
                    ? node.collectSnapSocketPoints(context.viewport, origin, rotation)
                    : [];

                selectedSocketsByNode.set(nodeId, sockets);
                previewSocketNodes.push({
                    nodeId,
                    sockets,
                    attachments: node.getNormalizedSocketAttachments(),
                });
                continue;
            }

            // Co-selected connectors must participate in occupancy so structure sockets
            // linked only via pipe start/end are not treated as free during move snap.
            if (isSplineConnectorSocketSnapHost(node)) {
                const nodeId = String((node as { boardId?: string | number; }).boardId ?? '');
                if (!nodeId) {
                    continue;
                }

                const origin = context.selectedWorldOrigins.get(nodeId);
                const rotation = context.selectedInitialRotations.get(nodeId);
                const sockets = origin && Number.isFinite(rotation)
                    ? node.collectSnapSocketPoints(context.viewport, origin, rotation)
                    : [];
                previewSocketNodes.push({
                    nodeId,
                    sockets,
                    attachments: this.getConnectorOccupancyAttachments(node),
                });
            }
        }

        for (const node of context.stationaryNodes) {
            // Selected movers are never in stationaryNodes; still require visible + on-screen.
            if (!isBoardNodeMoveSnapStationaryCandidate(node as BoardNodeBase<any, any>)) {
                continue;
            }

            if (node instanceof FoxholeStructureNode && node.hasSnapSocketStructure()) {
                const nodeId = String(node.boardId);
                const sockets = node.collectSnapSocketPoints(context.viewport);
                targetSockets.push(...sockets);
                previewSocketNodes.push({
                    nodeId,
                    sockets,
                    attachments: node.getNormalizedSocketAttachments(),
                });
                continue;
            }

            if (isSplineConnectorSocketSnapHost(node)) {
                const nodeId = String((node as { boardId?: string | number; }).boardId ?? '');
                if (!nodeId) {
                    continue;
                }

                const sockets = node.collectSnapSocketPoints(context.viewport);
                targetSockets.push(...sockets);
                previewSocketNodes.push({
                    nodeId,
                    sockets,
                    attachments: this.getConnectorOccupancyAttachments(node),
                });
            }
        }

        // Attached powerline endpoints follow the selected structures. Their cached
        // pickup positions must not pull those structures back during move snapping.
        const selectedIds = new Set(context.selectedNodes.map(node => String(node.boardId)));
        const carriedPowerlineSocketKeys = new Set(this.getStationaryPowerlineLinks(context.stationaryNodes)
            .flatMap(powerline => powerline.endpoints
                .filter(endpoint => endpoint.attachment && selectedIds.has(endpoint.attachment.nodeId))
                .map(endpoint => `${powerline.nodeId}:${endpoint.socketName}`)));

        const occupancyAttachmentsByNode = this.buildMoveSnapOccupancyAttachmentsByNode(previewSocketNodes);
        const nextState: FoxholeMoveSnapSceneState = {
            viewport: context.viewport,
            selectedNodes: context.selectedNodes,
            stationaryNodes: context.stationaryNodes,
            selectedWorldOrigins: context.selectedWorldOrigins,
            selectedInitialRotations: context.selectedInitialRotations,
            selectedSocketsByNode,
            targetSocketSpatialIndex: this.createMoveSnapTargetSocketSpatialIndex(targetSockets
                .filter(socket => !carriedPowerlineSocketKeys.has(`${socket.nodeId}:${socket.socketName}`))),
            previewAttachmentsByNode: resolveFoxholeAlignedReciprocalSocketAttachments(previewSocketNodes),
            occupancyAttachmentsByNode,
            moveSnapAttachmentsByNode: resolveFoxholeMoveSnapAttachments(
                occupancyAttachmentsByNode, new Set(context.selectedNodeIds),
            ),
        };
        foxholeMoveSnapSceneCache = nextState;
        return nextState;
    }

    private buildMoveSnapOccupancyAttachmentsByNode(
        nodes: readonly {
            nodeId: string;
            attachments: FoxholeStructureSocketAttachmentMap;
        }[],
    ): Map<string, FoxholeStructureSocketAttachmentMap> {
        const byNode = new Map<string, FoxholeStructureSocketAttachmentMap>();
        for (const node of nodes) {
            byNode.set(node.nodeId, { ...node.attachments });
        }

        // Ensure structure sockets occupied only on the connector endpoint side still block snaps.
        for (const node of nodes) {
            for (const [socketName, attachment] of Object.entries(node.attachments)) {
                const targetNodeId = String(attachment?.nodeId ?? '').trim();
                const targetSocketName = String(attachment?.socketName ?? '').trim();
                const localSocketName = String(socketName ?? '').trim();
                if (!targetNodeId || !targetSocketName || !localSocketName) {
                    continue;
                }

                const targetAttachments = byNode.get(targetNodeId) ?? {};
                if (targetAttachments[targetSocketName]) {
                    continue;
                }

                targetAttachments[targetSocketName] = {
                    nodeId: node.nodeId,
                    socketName: localSocketName,
                };
                byNode.set(targetNodeId, targetAttachments);
            }
        }

        return byNode;
    }

    private getFinalMoveRotationDelta(context: BoardNodeMoveCommitContext): number {
        return context.rotationDelta ?? context.activeSnap?.rotationDelta ?? 0;
    }

    private getFinalMoveWorldOrigin(
        context: BoardNodeMoveCommitContext,
        nodeId: string,
    ): { x: number; y: number; } | null {
        const origin = context.selectedWorldOrigins.get(nodeId);
        if (!origin) {
            return null;
        }

        const rotationDelta = this.getFinalMoveRotationDelta(context);
        const rotatedOrigin = rotationDelta && context.rotatePivot
            ? rotatePointAroundPivot(origin, context.rotatePivot, rotationDelta)
            : origin;
        return {
            x: rotatedOrigin.x + context.moveX,
            y: rotatedOrigin.y + context.moveY,
        };
    }

    private getFinalMoveRotation(
        context: BoardNodeMoveCommitContext,
        nodeId: string,
    ): number | null {
        const startRotation = context.selectedInitialRotations.get(nodeId);
        if (!Number.isFinite(startRotation)) {
            return null;
        }

        return startRotation + this.getFinalMoveRotationDelta(context);
    }

    private getSelectedSnapSocketStructureNodes(context: BoardNodeMoveCommitContext): FoxholeStructureNode[] {
        return context.selectedNodes.filter((node): node is FoxholeStructureNode => node instanceof FoxholeStructureNode && node.hasSnapSocketStructure());
    }

    private getSelectedSplineConnectorSnapHosts(context: BoardNodeMoveCommitContext) {
        return context.selectedNodes.filter(isSplineConnectorSocketSnapHost);
    }

    private getConnectorOccupancyAttachments(node: {
        boardState: {
            socketAttachments?: FoxholeStructureSocketAttachmentMap;
            startAttachment?: FoxholeConnectorEndpointAttachment | null;
            endAttachment?: FoxholeConnectorEndpointAttachment | null;
            startSocketName?: string;
            endSocketName?: string;
        };
    }): FoxholeStructureSocketAttachmentMap {
        const attachments = normalizeFoxholeStructureSocketAttachmentMap(node.boardState.socketAttachments);
        const startSocketName = String(node.boardState.startSocketName ?? '').trim();
        const endSocketName = String(node.boardState.endSocketName ?? '').trim();
        const startAttachment = this.getNormalizedConnectorEndpointAttachment(node.boardState.startAttachment);
        const endAttachment = this.getNormalizedConnectorEndpointAttachment(node.boardState.endAttachment);
        if (startSocketName && startAttachment) {
            attachments[startSocketName] = startAttachment;
        }
        if (endSocketName && endAttachment) {
            attachments[endSocketName] = endAttachment;
        }
        return attachments;
    }

    private getStationaryPowerlineLinks(nodes: readonly unknown[]): FoxholePowerlineAttachmentSource[] {
        return nodes.flatMap(node => {
            if (!isSplineConnectorSocketSnapHost(node)) {
                return [];
            }
            const connector = node as FoxholeConnectorGeometryPatchTarget;
            if (!isPowerlineConnector(connector.boardState.foxholeKey)) {
                return [];
            }
            const nodeId = String(connector.boardId);
            const initial = this.moveAttachmentPreview?.initialConnectorEndpointsByNode.get(nodeId);
            return [{
                nodeId,
                endpoints: [
                    {
                        socketName: String(connector.boardState.startSocketName ?? '').trim(),
                        attachment: initial ? initial.startAttachment : connector.boardState.startAttachment,
                    },
                    {
                        socketName: String(connector.boardState.endSocketName ?? '').trim(),
                        attachment: initial ? initial.endAttachment : connector.boardState.endAttachment,
                    },
                ],
            }];
        });
    }

    private isSnapSocketAttachmentCommitLeader(context: BoardNodeMoveCommitContext): boolean {
        const snapNodes = this.getSelectedSnapSocketStructureNodes(context);
        if (!snapNodes.length) {
            return false;
        }

        const leaderId = snapNodes
            .map(node => String(node.boardId))
            .sort()[0];
        return leaderId === String(this.boardId);
    }

    private createSocketAttachmentStatusVisual(socket: FoxholeResolvedStructureSocket, occupiedSocketKeys: ReadonlySet<string>): PIXI.Container {
        return createFoxholeSocketAttachmentStatusVisual(socket, this.resolveSocketAttachmentStatusColor(socket, occupiedSocketKeys));
    }

    private resolveSocketAttachmentStatusColor(socket: FoxholeResolvedStructureSocket, occupiedSocketKeys: ReadonlySet<string>): number {
        const occupied = occupiedSocketKeys.has(`${String(this.boardId)}:${String(socket.name ?? '').trim()}`)
            // Own socketAttachments are source of truth for this node's indicator. Aligned
            // reciprocal occupancy can drop the pipe-facing socket after rotate settle
            // (geometric "moving" path ends) even though the attachment is still present —
            // that reads as unoccupied until refresh reloads from Yjs.
            || Boolean(this.getNormalizedSocketAttachments()[String(socket.name ?? '').trim()]);
        return occupied ? SOCKET_ATTACHMENT_OCCUPIED_COLOR : SOCKET_ATTACHMENT_EMPTY_COLOR;
    }

    private createBreachSocketStatusVisual(
        socket: FoxholeResolvedStructureSocket,
        structure: FoxholeManifestStructure,
        neighborById: ReadonlyMap<string, FoxholeStructureNode>,
        showDirectionTick = false,
    ): PIXI.Container {
        const container = new PIXI.Container();
        container.label = `breach:${socket.id}`;
        container.eventMode = 'none';
        container.position.set(socket.localX, socket.localY);

        const color = this.resolveBreachSocketStatusColor(socket, structure, neighborById);
        const graphics = new PIXI.Graphics();
        graphics.eventMode = 'none';
        graphics.rect(
            -(SOCKET_ATTACHMENT_SQUARE_SIZE / 2),
            -(SOCKET_ATTACHMENT_SQUARE_SIZE / 2),
            SOCKET_ATTACHMENT_SQUARE_SIZE,
            SOCKET_ATTACHMENT_SQUARE_SIZE,
        );
        graphics.fill({ color, alpha: 0.95 });
        graphics.stroke({ color: 0x081018, alpha: 0.95, width: SOCKET_ATTACHMENT_SQUARE_STROKE_WIDTH });
        if (showDirectionTick) {
            drawFoxholeSocketAttachmentDirectionTick(graphics, socket);
        }
        container.addChild(graphics);
        return container;
    }

    private resolveBreachSocketStatusColor(
        socket: FoxholeResolvedStructureSocket,
        structure: FoxholeManifestStructure,
        neighborById: ReadonlyMap<string, FoxholeStructureNode>,
    ): number {
        const socketName = String(socket.name ?? '').trim();
        const attachment = resolveFoxholeStructureSocketAttachment(this.getNormalizedSocketAttachments(), socketName);
        const neighbor = attachment ? neighborById.get(String(attachment.nodeId ?? '').trim()) ?? null : null;
        const neighborStructure = neighbor?.getResolvedStructure() ?? null;
        const selfIsBuildSite = String(this.boardState.foxholeKey ?? '').trim().toLowerCase() === 'fortbuildsite';
        const neighborIsBuildSite = String(neighbor?.boardState.foxholeKey ?? '').trim().toLowerCase() === 'fortbuildsite';
        const sealed = Boolean(attachment) && isFoxholeBunkerSocketUnbreachable({
            selfBreachable: structure.breachable === true,
            selfStructuralGarrison: structure.structuralGarrison === true,
            selfExposed: selfIsBuildSite,
            neighborBreachable: neighborStructure?.breachable === true,
            neighborStructuralGarrison: neighborStructure?.structuralGarrison === true,
            neighborExposed: neighborIsBuildSite,
            connectionCount: 1,
        });
        return sealed ? SOCKET_ATTACHMENT_OCCUPIED_COLOR : SOCKET_ATTACHMENT_EMPTY_COLOR;
    }

    private resolveBreachIndicatorNeighborMap(): ReadonlyMap<string, FoxholeStructureNode> {
        const container = this.getTopBoardContainer();
        const nodes = container ? this.collectSnapSocketOverlaySceneNodes(container) : [this];
        return new Map(nodes.map(node => [String(node.boardId), node] as const));
    }

    private findFoxholeStructureNode(
        context: BoardNodeMoveCommitContext,
        nodeId: string,
    ): FoxholeStructureNode | null {
        const allNodes = [...context.selectedNodes, ...context.stationaryNodes];
        const match = allNodes.find(node => String(node.boardId) === nodeId);
        return match instanceof FoxholeStructureNode ? match : null;
    }

    private buildSocketAttachmentPatch(
        node: FoxholeStructureNode,
        nextAttachments: FoxholeStructureSocketAttachmentMap,
        previousAttachmentsOverride?: FoxholeStructureSocketAttachmentMap,
    ) {
        // Prefer pre-preview attachments when committing a move. Live attachment
        // previews mutate boardState with recordHistory:false (not synced), so
        // comparing against live state skips patches and leaves stale links in Yjs.
        const previousAttachments = previousAttachmentsOverride
            ?? node.getNormalizedSocketAttachments();
        if (JSON.stringify(previousAttachments) === JSON.stringify(nextAttachments)) {
            return null;
        }

        const previousSelections = node.getResolvedModificationSelections();
        const nextSelections = node.sanitizeModificationVariantSelections(previousSelections, nextAttachments);
        const selectionsChanged = JSON.stringify(previousSelections) !== JSON.stringify(nextSelections);
        return {
            nodeId: String(node.boardId),
            patch: {
                socketAttachments: nextAttachments,
                ...(selectionsChanged ? { modificationVariantIds: nextSelections } : {}),
            },
            inversePatch: {
                socketAttachments: previousAttachments,
                ...(selectionsChanged ? { modificationVariantIds: previousSelections } : {}),
            },
        };
    }

    private buildConnectorEndpointAttachmentPatch(
        node: FoxholeConnectorGeometryPatchTarget,
        occupancyAttachments: FoxholeStructureSocketAttachmentMap,
        previousOverride?: {
            startAttachment: FoxholeConnectorEndpointAttachment | null;
            endAttachment: FoxholeConnectorEndpointAttachment | null;
            socketAttachments: FoxholeStructureSocketAttachmentMap;
        },
    ) {
        const startSocketName = String(node.boardState.startSocketName ?? '').trim();
        const endSocketName = String(node.boardState.endSocketName ?? '').trim();
        const nextStart = startSocketName && occupancyAttachments[startSocketName]
            ? {
                nodeId: occupancyAttachments[startSocketName].nodeId,
                socketName: occupancyAttachments[startSocketName].socketName,
            } satisfies FoxholeConnectorEndpointAttachment
            : null;
        const nextEnd = endSocketName && occupancyAttachments[endSocketName]
            ? {
                nodeId: occupancyAttachments[endSocketName].nodeId,
                socketName: occupancyAttachments[endSocketName].socketName,
            } satisfies FoxholeConnectorEndpointAttachment
            : null;
        const nextSocketAttachments = Object.fromEntries(
            Object.entries(occupancyAttachments).filter(([socketName]) => (
                socketName !== startSocketName && socketName !== endSocketName
            )),
        );
        const previousStart = previousOverride
            ? previousOverride.startAttachment
            : (this.getNormalizedConnectorEndpointAttachment(node.boardState.startAttachment) ?? null);
        const previousEnd = previousOverride
            ? previousOverride.endAttachment
            : (this.getNormalizedConnectorEndpointAttachment(node.boardState.endAttachment) ?? null);
        const previousSocketAttachments = previousOverride
            ? previousOverride.socketAttachments
            : normalizeFoxholeStructureSocketAttachmentMap(node.boardState.socketAttachments);
        if (
            JSON.stringify(previousStart) === JSON.stringify(nextStart)
            && JSON.stringify(previousEnd) === JSON.stringify(nextEnd)
            && JSON.stringify(previousSocketAttachments) === JSON.stringify(nextSocketAttachments)
        ) {
            return null;
        }

        return {
            nodeId: String(node.boardId),
            patch: {
                startAttachment: nextStart,
                endAttachment: nextEnd,
                socketAttachments: nextSocketAttachments,
            },
            inversePatch: {
                startAttachment: previousStart,
                endAttachment: previousEnd,
                socketAttachments: previousSocketAttachments,
            },
        };
    }

    buildDeleteCommitPatches(context: BoardNodeDeleteCommitContext) {
        if (!this.hasSnapSocketStructure() || context.deletedNodeIds.has(String(this.boardId))) {
            return [];
        }

        const nextAttachments = filterFoxholeStructureSocketAttachments(
            this.getNormalizedSocketAttachments(),
            attachment => !context.deletedNodeIds.has(String(attachment.nodeId ?? '').trim()),
        );
        const patch = this.buildSocketAttachmentPatch(this, nextAttachments);
        return patch ? [patch] : [];
    }

    private getNormalizedConnectorEndpointAttachment(
        value: FoxholeConnectorEndpointAttachment | null | undefined,
    ): FoxholeConnectorEndpointAttachment | undefined {
        const nodeId = String(value?.nodeId ?? '').trim();
        const socketName = String(value?.socketName ?? '').trim();
        return nodeId && socketName
            ? { nodeId, socketName }
            : undefined;
    }

    private buildAttachedConnectorGeometryPatch(
        node: FoxholeConnectorGeometryPatchTarget,
        socketPointsByKey: Map<string, FoxholeSocketSnapPoint>,
        movedStructureIds: ReadonlySet<string>,
        viewport: BoardNodeEditableHandleContext['viewport'],
        structureTargets: ReadonlyArray<{ nodeId: string; attachments: FoxholeStructureSocketAttachmentMap; }>,
    ) {
        if (!usesSplineConnectorSocketSnapping(node.boardState.foxholeKey)) {
            return null;
        }

        const boardType = String(node.boardType ?? '');
        const isLegacyConnector = boardType === FOXHOLE_CONNECTOR_NODE_TYPE;
        const isSplineConnector = boardType === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE;
        if (!isLegacyConnector && !isSplineConnector) {
            return null;
        }

        const recoveredAttachments = resolveFoxholeConnectorEndpointAttachmentsFromTargets({
            connectorNodeId: String(node.boardId),
            startSocketName: String(node.boardState.startSocketName ?? '').trim() || undefined,
            endSocketName: String(node.boardState.endSocketName ?? '').trim() || undefined,
            targets: structureTargets,
        });
        const startAttachment = this.getNormalizedConnectorEndpointAttachment(node.boardState.startAttachment)
            ?? recoveredAttachments.startAttachment;
        const endAttachment = this.getNormalizedConnectorEndpointAttachment(node.boardState.endAttachment)
            ?? recoveredAttachments.endAttachment;
        const touchesMovedStructure = [startAttachment, endAttachment].some(attachment => attachment && movedStructureIds.has(attachment.nodeId));
        if (!touchesMovedStructure) {
            return null;
        }

        const attachedStart = startAttachment
            ? socketPointsByKey.get(`${startAttachment.nodeId}:${startAttachment.socketName}`)
            : undefined;
        const attachedEnd = endAttachment
            ? socketPointsByKey.get(`${endAttachment.nodeId}:${endAttachment.socketName}`)
            : undefined;

        if (isSplineConnector) {
            const foxholeKey = String(node.boardState.foxholeKey ?? '');
            // Match live powerline preview: only power lines stretch to attached sockets.
            // Facility pipes keep authored curve geometry; rewriting them as straight
            // segments mangles path length and independent endpoint rotations on commit.
            if (!isPowerlineConnector(foxholeKey)) {
                return null;
            }

            const originX = Number(node.boardState.x ?? 0);
            const originY = Number(node.boardState.y ?? 0);
            const nodeRotation = Number(node.boardState.rotation ?? 0);
            const nodeScaleX = Number(node.boardState.scaleX ?? 1);
            const nodeScaleY = Number(node.boardState.scaleY ?? 1);
            const start = node.boardState.start;
            const end = node.boardState.end;
            const geometry = resolveFoxholeSplinePowerlineGeometry({
                currentStart: start
                    ? resolveFoxholeSplinePowerlineWorldEndpoint(
                        { x: originX, y: originY }, start, nodeRotation, nodeScaleX, nodeScaleY,
                    )
                    : undefined,
                currentEnd: end
                    ? resolveFoxholeSplinePowerlineWorldEndpoint(
                        { x: originX, y: originY }, end, nodeRotation, nodeScaleX, nodeScaleY,
                    )
                    : undefined,
                attachedStart,
                attachedEnd,
                nodeRotation,
                nodeScaleX,
                nodeScaleY,
            });
            if (!geometry) {
                return null;
            }

            const previousX = originX;
            const previousY = originY;
            const previousStart = {
                ...(start ?? {}),
                x: Number(start?.x ?? 0),
                y: Number(start?.y ?? 0),
                rotation: Number(start?.rotation ?? 0),
            };
            const previousEnd = {
                ...(end ?? {}),
                x: Number(end?.x ?? 0),
                y: Number(end?.y ?? 0),
                rotation: Number(end?.rotation ?? 0),
            };
            const updatedStart = { ...previousStart, ...geometry.start };
            const updatedEnd = { ...previousEnd, ...geometry.end };
            if (
                Math.abs(previousX - geometry.x) <= 0.0001
                && Math.abs(previousY - geometry.y) <= 0.0001
                && JSON.stringify(previousStart) === JSON.stringify(updatedStart)
                && JSON.stringify(previousEnd) === JSON.stringify(updatedEnd)
            ) {
                return null;
            }

            return {
                nodeId: String(node.boardId),
                patch: {
                    x: geometry.x,
                    y: geometry.y,
                    start: updatedStart,
                    end: updatedEnd,
                },
                inversePatch: {
                    x: previousX,
                    y: previousY,
                    start: previousStart,
                    end: previousEnd,
                },
            };
        }

        const currentSockets = node.collectSnapSocketPoints?.(viewport) ?? [];
        const startSocketName = String(node.boardState.startSocketName ?? '').trim();
        const endSocketName = String(node.boardState.endSocketName ?? '').trim();
        const currentStart = currentSockets.find(socket => socket.socketName === startSocketName);
        const currentEnd = currentSockets.find(socket => socket.socketName === endSocketName);
        const geometry = resolveFoxholeStraightConnectorGeometry({
            currentStart,
            currentEnd,
            attachedStart,
            attachedEnd,
        });
        if (!geometry) {
            return null;
        }

        const previousX = Number(node.boardState.x ?? 0);
        const previousY = Number(node.boardState.y ?? 0);
        const previousPoints = Array.isArray(node.boardState.points)
            ? node.boardState.points.slice()
            : [];
        if (
            Math.abs(previousX - geometry.x) <= 0.0001
            && Math.abs(previousY - geometry.y) <= 0.0001
            && JSON.stringify(previousPoints) === JSON.stringify(geometry.points)
        ) {
            return null;
        }

        return {
            nodeId: String(node.boardId),
            patch: {
                x: geometry.x,
                y: geometry.y,
                points: geometry.points,
                startAttachment,
                endAttachment,
            },
            inversePatch: {
                x: previousX,
                y: previousY,
                points: previousPoints,
                startAttachment: this.getNormalizedConnectorEndpointAttachment(node.boardState.startAttachment),
                endAttachment: this.getNormalizedConnectorEndpointAttachment(node.boardState.endAttachment),
            },
        };
    }

    resolveMoveSnap(context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0]): BoardNodeMoveSnapResult | null {
        if (this.settingsStore.getValue(FOXHOLE_SOCKET_SNAPPING_SETTING_ID) === false) {
            return null;
        }

        const nodeId = String(this.boardId);
        if (!context.selectedWorldOrigins.get(nodeId)) {
            return null;
        }
        if (!Number.isFinite(context.selectedInitialRotations.get(nodeId))) {
            return null;
        }

        const socketSnap = this.resolveStructureSocketMoveSnap(context);
        // Track pose owns the transform for rail vehicles. A compatible open coupler can
        // refine that pose along the connected path, but may never yank rail contacts off it.
        const railTrackSnap = this.resolveRailTrackMoveSnap(context);
        const railCouplerDockSnap = railTrackSnap
            ? this.resolveRailCouplerDockMoveSnap(context)
            : null;
        const effectiveRailTrackSnap = railCouplerDockSnap ?? railTrackSnap;
        const couplerSnap = effectiveRailTrackSnap ? null : this.resolveRailCouplerMoveSnap(context);
        const emplacementSnap = this.resolveEmplacementMoveSnap(context);

        const candidates = [socketSnap, couplerSnap, emplacementSnap, effectiveRailTrackSnap].filter(
            (value): value is BoardNodeMoveSnapResult => value != null,
        );
        if (!candidates.length) {
            return null;
        }

        return candidates.reduce((best, candidate) => (
            candidate.score < best.score ? candidate : best
        ));
    }

    private resolveStructureSocketMoveSnap(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): BoardNodeMoveSnapResult | null {
        if (!this.hasSnapSocketStructure()) {
            return null;
        }

        const nodeId = String(this.boardId);

        // Linked multi-select assemblies (e.g. valve↔silo) must still snap as a unit onto
        // stationary sockets outside the selection. Co-selected partners are never move-snap
        // targets, so free-side yank within the selection cannot occur here.

        const sceneState = this.getMoveSnapSceneState(context);
        const movingSockets = (sceneState.selectedSocketsByNode.get(nodeId) ?? [])
            .filter(socket => !isFoxholeRailCouplerSocket({ name: socket.socketName }));
        if (!movingSockets.length) {
            return null;
        }
        const targetSockets = this.getMoveSnapCandidateTargetSockets(
            context,
            movingSockets,
            sceneState.targetSocketSpatialIndex,
        ).filter(socket => !isFoxholeRailCouplerSocket({ name: socket.socketName }));
        if (!targetSockets.length) {
            return null;
        }

        const match = findBestFoxholeSocketSnap({
            movingSockets,
            targetSockets,
            rotatePivot: context.rotatePivot,
            moveX: context.moveX,
            moveY: context.moveY,
            maxRotationDeltaRadians: MAX_FOXHOLE_MOVE_SNAP_ROTATION_LEEWAY_RADIANS,
            pointerWorld: context.pointerWorld,
            pointerSocketRadius: FOXHOLE_MOVE_SNAP_POINTER_SOCKET_RADIUS,
            isTargetSocketAvailable: (movingSocket, targetSocket) => areFoxholeSnapSocketsAvailableForAttachment(
                movingSocket,
                sceneState.moveSnapAttachmentsByNode.get(String(movingSocket.nodeId ?? '').trim()),
                targetSocket,
                sceneState.moveSnapAttachmentsByNode.get(String(targetSocket.nodeId ?? '').trim()),
            ),
        });
        if (!match) {
            return null;
        }

        return {
            moveX: match.moveX,
            moveY: match.moveY,
            rotationDelta: match.rotationDelta,
            score: match.distance + (Math.abs(match.rotationDelta) * (DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE / Math.PI)),
            data: {
                kind: FOXHOLE_STRUCTURE_SOCKET_SNAP_RESULT_KIND,
                match,
            } satisfies FoxholeStructureSocketMoveSnapData,
        };
    }

    private resolveRailCouplerMoveSnap(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): BoardNodeMoveSnapResult | null {
        if (!this.hasRailCouplerStructure()) {
            return null;
        }

        const nodeId = String(this.boardId);
        const sceneState = this.getMoveSnapSceneState(context);
        const movingSockets = (sceneState.selectedSocketsByNode.get(nodeId) ?? [])
            .filter(socket => isFoxholeRailCouplerSocket({ name: socket.socketName }));
        if (!movingSockets.length) {
            return null;
        }

        const targetSockets = this.getMoveSnapCandidateTargetSockets(
            context,
            movingSockets,
            sceneState.targetSocketSpatialIndex,
        ).filter(socket => isFoxholeRailCouplerSocket({ name: socket.socketName }));
        if (!targetSockets.length) {
            return null;
        }

        const match = findBestFoxholeRailCouplerSnap({
            movingSockets,
            targetSockets,
            rotatePivot: context.rotatePivot,
            moveX: context.moveX,
            moveY: context.moveY,
            maxRotationDeltaRadians: MAX_FOXHOLE_MOVE_SNAP_ROTATION_LEEWAY_RADIANS,
            pointerWorld: context.pointerWorld,
            pointerSocketRadius: FOXHOLE_MOVE_SNAP_POINTER_SOCKET_RADIUS,
            isTargetSocketAvailable: (movingSocket, targetSocket) => areFoxholeSnapSocketsAvailableForAttachment(
                movingSocket,
                sceneState.occupancyAttachmentsByNode.get(String(movingSocket.nodeId ?? '').trim()),
                targetSocket,
                sceneState.occupancyAttachmentsByNode.get(String(targetSocket.nodeId ?? '').trim()),
            ),
        });
        if (!match) {
            return null;
        }

        return {
            moveX: match.moveX,
            moveY: match.moveY,
            rotationDelta: match.rotationDelta,
            score: match.distance + (Math.abs(match.rotationDelta) * (DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE / Math.PI)),
            data: {
                kind: FOXHOLE_STRUCTURE_SOCKET_SNAP_RESULT_KIND,
                match,
            } satisfies FoxholeStructureSocketMoveSnapData,
        };
    }

    private resolveRailCouplerDockMoveSnap(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): BoardNodeMoveSnapResult | null {
        // A consist requires per-node transforms, while move snap currently returns one
        // rigid selection transform. Keep this pass intentionally scoped to one car.
        if (context.selectedNodeIds.length !== 1 || !this.hasRailCouplerStructure()) {
            return null;
        }

        const nodeId = String(this.boardId);
        const movingOrigin = context.selectedWorldOrigins.get(nodeId);
        const movingRotation = context.selectedInitialRotations.get(nodeId);
        const structure = this.getResolvedStructure();
        const wheelBase = Number(structure?.wheelBase ?? 0) * FOXHOLE_BOARD_PIXELS_PER_CENTIMETER;
        if (!movingOrigin || !Number.isFinite(movingRotation) || !(wheelBase > 0)) {
            return null;
        }

        const tracks = this.collectStationaryRailTrackPaths(context);
        if (!tracks.length) {
            return null;
        }

        const sceneState = this.getMoveSnapSceneState(context);
        const movingSockets = (sceneState.selectedSocketsByNode.get(nodeId) ?? [])
            .filter(socket => isFoxholeRailCouplerSocket({ name: socket.socketName }));
        if (!movingSockets.length) {
            return null;
        }

        const movedSocketPoints = movingSockets.map(socket => ({
            x: socket.x + context.moveX,
            y: socket.y + context.moveY,
        }));
        const stationaryRailVehiclesById = new Map<string, FoxholeStructureNode>();
        for (const node of context.stationaryNodes) {
            if (!(node instanceof FoxholeStructureNode) || !node.isRailVehicleStructure()) {
                continue;
            }
            stationaryRailVehiclesById.set(String(node.boardId), node);
        }

        const movingGauge = structure?.trackGauge ?? null;
        const targetSockets = this.queryMoveSnapTargetSocketsNearWorldPoints(
            movedSocketPoints,
            sceneState.targetSocketSpatialIndex,
            DEFAULT_FOXHOLE_RAIL_COUPLER_DOCK_CAPTURE_DISTANCE,
        ).filter(socket => {
            if (!isFoxholeRailCouplerSocket({ name: socket.socketName })) {
                return false;
            }
            const targetNode = stationaryRailVehiclesById.get(String(socket.nodeId));
            if (!targetNode) {
                return false;
            }
            const targetGauge = targetNode.getResolvedStructure()?.trackGauge ?? null;
            return !movingGauge || !targetGauge || movingGauge === targetGauge;
        });
        if (!targetSockets.length) {
            return null;
        }

        const match = findBestFoxholeRailCouplerDockSnap({
            movingNodeId: nodeId,
            movingOrigin,
            movingRotation: Number(movingRotation),
            wheelBase,
            trackGauge: movingGauge,
            tracks,
            movingSockets,
            targetSockets,
            moveX: context.moveX,
            moveY: context.moveY,
            isTargetSocketAvailable: (movingSocket, targetSocket) => areFoxholeSnapSocketsAvailableForAttachment(
                movingSocket,
                sceneState.occupancyAttachmentsByNode.get(String(movingSocket.nodeId ?? '').trim()),
                targetSocket,
                sceneState.occupancyAttachmentsByNode.get(String(targetSocket.nodeId ?? '').trim()),
            ),
        });
        if (!match) {
            return null;
        }

        return {
            moveX: match.moveX,
            moveY: match.moveY,
            rotationDelta: match.rotationDelta,
            score: match.couplerDistance
                + (match.distance * 0.01)
                + (Math.abs(match.rotationDelta) * (DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE / Math.PI)),
            data: {
                kind: FOXHOLE_STRUCTURE_RAIL_COUPLER_DOCK_SNAP_RESULT_KIND,
                match,
            } satisfies FoxholeStructureRailCouplerDockMoveSnapData,
        };
    }

    private hasRailCouplerStructure(): boolean {
        const structure = this.getResolvedStructure();
        if (!structure) {
            return false;
        }

        return this.getResolvedBuildSockets(structure).some(socket => isFoxholeRailCouplerSocket(socket));
    }

    private resolveEmplacementMoveSnap(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): BoardNodeMoveSnapResult | null {
        if (!this.isEmplacedWeaponStructure()) {
            return null;
        }

        const nodeId = String(this.boardId);
        const movingOrigin = context.selectedWorldOrigins.get(nodeId);
        if (!movingOrigin) {
            return null;
        }

        const pads = this.collectStationaryEmplacementPads(context);
        if (!pads.length) {
            return null;
        }

        const match = findBestFoxholeEmplacementSnap({
            movingNodeId: nodeId,
            movingOrigin,
            pads,
            moveX: context.moveX,
            moveY: context.moveY,
            pointerWorld: context.pointerWorld,
            pointerBiasRadius: FOXHOLE_MOVE_SNAP_POINTER_SOCKET_RADIUS,
        });
        if (!match) {
            return null;
        }

        return {
            moveX: match.moveX,
            moveY: match.moveY,
            rotationDelta: 0,
            score: match.distance,
            data: {
                kind: FOXHOLE_STRUCTURE_EMPLACEMENT_SNAP_RESULT_KIND,
                match: {
                    movingNodeId: match.movingNodeId,
                    targetNodeId: match.targetNodeId,
                    distance: match.distance,
                },
            } satisfies FoxholeStructureEmplacementMoveSnapData,
        };
    }

    private resolveRailTrackMoveSnap(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): BoardNodeMoveSnapResult | null {
        if (!this.isRailVehicleStructure()) {
            return null;
        }

        const nodeId = String(this.boardId);
        const movingOrigin = context.selectedWorldOrigins.get(nodeId);
        const movingRotation = context.selectedInitialRotations.get(nodeId);
        if (!movingOrigin || !Number.isFinite(movingRotation)) {
            return null;
        }

        const tracks = this.collectStationaryRailTrackPaths(context);
        if (!tracks.length) {
            return null;
        }
        const structure = this.getResolvedStructure();

        const match = findBestFoxholeRailTrackSnap({
            movingNodeId: nodeId,
            movingOrigin,
            movingRotation: Number(movingRotation),
            wheelBase: Number(structure?.wheelBase ?? 0) * FOXHOLE_BOARD_PIXELS_PER_CENTIMETER,
            trackGauge: structure?.trackGauge ?? null,
            tracks,
            moveX: context.moveX,
            moveY: context.moveY,
            pointerWorld: context.pointerWorld,
            pointerBiasRadius: FOXHOLE_MOVE_SNAP_POINTER_SOCKET_RADIUS,
        });
        if (!match) {
            return null;
        }

        return {
            moveX: match.moveX,
            moveY: match.moveY,
            rotationDelta: match.rotationDelta,
            score: match.distance
                + (Math.abs(match.rotationDelta) * (DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE / Math.PI)),
            data: {
                kind: FOXHOLE_STRUCTURE_RAIL_TRACK_SNAP_RESULT_KIND,
                match: {
                    movingNodeId: match.movingNodeId,
                    targetNodeId: match.targetNodeId,
                    distance: match.distance,
                },
            } satisfies FoxholeStructureRailTrackMoveSnapData,
        };
    }

    private isActiveRailTrackMoveSnap(activeSnap: BoardNodeMoveSnapResult | null | undefined): boolean {
        const kind = (activeSnap?.data as { kind?: string; } | null | undefined)?.kind;
        return kind === FOXHOLE_STRUCTURE_RAIL_TRACK_SNAP_RESULT_KIND
            || kind === FOXHOLE_STRUCTURE_RAIL_COUPLER_DOCK_SNAP_RESULT_KIND;
    }

    private isEmplacedWeaponStructure(): boolean {
        return this.getResolvedStructure()?.isEmplacedWeapon === true;
    }

    private isRailVehicleStructure(): boolean {
        const structure = this.getResolvedStructure();
        return Number(structure?.wheelBase ?? 0) > 0
            || (structure?.railCouplers?.length ?? 0) > 0;
    }

    private collectStationaryEmplacementPads(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): FoxholeEmplacementPadPoint[] {
        const pads: FoxholeEmplacementPadPoint[] = [];
        for (const node of context.stationaryNodes) {
            if (!(node instanceof FoxholeStructureNode)) {
                continue;
            }
            if (!isBoardNodeMoveSnapStationaryCandidate(node as BoardNodeBase<any, any>)) {
                continue;
            }

            const pad = node.resolveEmplacementPadWorldPoint(context.viewport);
            if (pad) {
                pads.push(pad);
            }
        }
        return pads;
    }

    private collectStationaryRailTrackPaths(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): FoxholeRailTrackPath[] {
        const tracks: FoxholeRailTrackPath[] = [];
        for (const node of context.stationaryNodes) {
            if (!isBoardNodeMoveSnapStationaryCandidate(node as BoardNodeBase<any, any>)) {
                continue;
            }
            if (!isRailTrackSnapHost(node)) {
                continue;
            }

            const nodeId = String(node.boardId ?? '').trim();
            if (!nodeId) {
                continue;
            }

            const points = node.collectRailTrackWorldPathPoints(context.viewport);
            if (points.length < 1) {
                continue;
            }

            tracks.push({
                nodeId,
                points,
                trackGauge: resolveRailTrackGauge(node.boardState.foxholeKey),
            });
        }
        return tracks;
    }

    private resolveEmplacementPadWorldPoint(
        viewport: BoardNodeEditableHandleContext['viewport'],
    ): FoxholeEmplacementPadPoint | null {
        const structure = this.getResolvedStructure();
        if (!structure || structure.supportsEmplacedStructures !== true || !structure.emplacementLocation) {
            return null;
        }

        const local = foxholeEmplacementLocalToBoardOffset(structure.emplacementLocation);
        const padWorld = viewport.toWorld(this.toGlobal(new PIXI.Point(local.x, local.y)));
        return {
            nodeId: String(this.boardId),
            x: padWorld.x,
            y: padWorld.y,
        };
    }

    resolveRotationSnap(
        context: Parameters<NonNullable<BoardNodeMoveSnapProvider['resolveRotationSnap']>>[0],
    ) {
        if (
            !this.hasSnapSocketStructure()
            || !context.rotatePivot
            || this.settingsStore.getValue(FOXHOLE_SOCKET_SNAPPING_SETTING_ID) === false
        ) {
            return null;
        }

        const nodeId = String(this.boardId);
        const rawRotationDelta = Number(context.rotationDelta ?? 0);
        if (
            !context.selectedWorldOrigins.has(nodeId)
            || !Number.isFinite(context.selectedInitialRotations.get(nodeId))
            || !Number.isFinite(rawRotationDelta)
        ) {
            return null;
        }

        const sceneState = this.getMoveSnapSceneState(context);
        const initialSockets = sceneState.selectedSocketsByNode.get(nodeId) ?? [];
        const movingSockets = initialSockets.map(socket => {
            const point = rotatePointAroundPivot(socket, context.rotatePivot!, rawRotationDelta);
            return {
                ...socket,
                x: point.x + context.moveX,
                y: point.y + context.moveY,
                rotation: socket.rotation + rawRotationDelta,
            };
        });
        const targetSockets = this.getMoveSnapCandidateTargetSockets(
            { ...context, rotatePivot: null, moveX: 0, moveY: 0 },
            movingSockets,
            sceneState.targetSocketSpatialIndex,
        );
        const match = findBestFoxholeSocketSnap({
            movingSockets,
            targetSockets,
            rotatePivot: context.rotatePivot,
            moveX: 0,
            moveY: 0,
            // Tighter than move-snap leeway so rotate doesn't yank from ~135° to 180°.
            maxRotationDeltaRadians: (DEFAULT_FOXHOLE_SOCKET_ROTATION_SNAP_DEGREES * Math.PI) / 180,
            maxDistance: DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
            isTargetSocketAvailable: (movingSocket, targetSocket) => areFoxholeSnapSocketsAvailableForAttachment(
                movingSocket,
                sceneState.occupancyAttachmentsByNode.get(String(movingSocket.nodeId ?? '').trim()),
                targetSocket,
                sceneState.occupancyAttachmentsByNode.get(String(targetSocket.nodeId ?? '').trim()),
            ),
        });
        if (!match) {
            return null;
        }

        // match.rotationDelta is the remaining facing correction from the already
        // raw-rotated pose; match.moveX/Y is residual translation after that correction.
        // Unwrap near rawDelta so ±π representations of the same pose don't flicker.
        const rotationDelta = unwrapAngleNearReference(
            rawRotationDelta + match.rotationDelta,
            rawRotationDelta,
        );
        return {
            rotationDelta,
            moveX: match.moveX,
            moveY: match.moveY,
            score: match.distance + (Math.abs(match.rotationDelta) * (DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE / Math.PI)),
            data: {
                kind: FOXHOLE_STRUCTURE_SOCKET_SNAP_RESULT_KIND,
                match: {
                    ...match,
                    rotationDelta,
                    moveX: match.moveX,
                    moveY: match.moveY,
                },
            } satisfies FoxholeStructureSocketMoveSnapData,
        };
    }

    cancelMoveAttachmentPreview(): void {
        this.clearRailCouplerDockZones();
        const preview = this.moveAttachmentPreview;
        if (!preview) {
            return;
        }

        for (const [targetNodeId, attachments] of preview.initialAttachmentsByNode) {
            const node = preview.previewTargetNodes.get(targetNodeId) as {
                patchBoardState?: (patch: Record<string, unknown>, options?: Record<string, unknown>) => void;
            } | undefined;
            if (!node?.patchBoardState) {
                continue;
            }
            if (preview.initialConnectorEndpointsByNode.has(targetNodeId)) {
                continue;
            }
            node.patchBoardState({
                socketAttachments: attachments,
            }, {
                reason: 'foxhole-structure-move-attachment-revert',
                recordHistory: false,
            });
        }

        for (const [connectorNodeId, endpoints] of preview.initialConnectorEndpointsByNode) {
            const node = preview.previewTargetNodes.get(connectorNodeId) as {
                patchBoardState?: (patch: Record<string, unknown>, options?: Record<string, unknown>) => void;
            } | undefined;
            node?.patchBoardState?.({
                startAttachment: endpoints.startAttachment,
                endAttachment: endpoints.endAttachment,
                socketAttachments: preview.initialAttachmentsByNode.get(connectorNodeId) ?? {},
            }, {
                reason: 'foxhole-structure-move-connector-attachment-revert',
                recordHistory: false,
            });
        }

        this.moveAttachmentPreview = null;
        this.refreshStationaryPowerlinePreviews(preview);
    }

    private refreshStationaryPowerlinePreviews(
        preview: NonNullable<FoxholeStructureNode['moveAttachmentPreview']>,
        movingSockets: readonly FoxholeSocketSnapPoint[] = [],
    ): void {
        const socketPointsByKey = new Map<string, FoxholeSocketSnapPoint>(
            movingSockets.map(socket => [`${socket.nodeId}:${socket.socketName}`, socket]),
        );
        for (const powerline of preview.initialPowerlineLinks) {
            const node = preview.previewTargetNodes.get(powerline.nodeId) as {
                refreshAttachedPowerlinePreview?: (
                    start?: { x: number; y: number; rotation?: number; },
                    end?: { x: number; y: number; rotation?: number; },
                ) => void;
            } | undefined;
            const movedPoint = (index: number) => {
                const attachment = powerline.endpoints[index]?.attachment;
                return attachment
                    ? socketPointsByKey.get(`${attachment.nodeId}:${attachment.socketName}`)
                    : undefined;
            };
            node?.refreshAttachedPowerlinePreview?.(movedPoint(0), movedPoint(1));
        }
    }

    syncMoveLiveAttachmentPreview(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): void {
        if (!this.hasSnapSocketStructure()) {
            return;
        }

        const selfId = String(this.boardId);
        const selectedIds = new Set(context.selectedNodeIds.map(String));
        // Only the attachment commit leader owns live multi-socket preview so
        // co-selected structures do not fight over shared targets each frame.
        if (!this.isMoveAttachmentPreviewLeader(context)) {
            return;
        }

        this.syncRailCouplerDockZonesForMove(context);

        if (!this.moveAttachmentPreview) {
            const initialAttachmentsByNode = new Map<string, FoxholeStructureSocketAttachmentMap>();
            const initialConnectorEndpointsByNode = new Map<string, {
                startAttachment: FoxholeConnectorEndpointAttachment | null;
                endAttachment: FoxholeConnectorEndpointAttachment | null;
            }>();
            const previewTargetNodes = new Map<string, unknown>();

            for (const node of [...context.selectedNodes, ...context.stationaryNodes]) {
                const nodeId = String((node as { boardId?: string | number; }).boardId ?? '');
                if (!nodeId) {
                    continue;
                }
                previewTargetNodes.set(nodeId, node);
                if (node instanceof FoxholeStructureNode && node.hasSnapSocketStructure()) {
                    initialAttachmentsByNode.set(nodeId, node.getNormalizedSocketAttachments());
                    continue;
                }
                if (isSplineConnectorSocketSnapHost(node)) {
                    const connector = node as FoxholeConnectorGeometryPatchTarget;
                    initialAttachmentsByNode.set(
                        nodeId,
                        normalizeFoxholeStructureSocketAttachmentMap(connector.boardState.socketAttachments),
                    );
                    initialConnectorEndpointsByNode.set(nodeId, {
                        startAttachment: this.getNormalizedConnectorEndpointAttachment(connector.boardState.startAttachment) ?? null,
                        endAttachment: this.getNormalizedConnectorEndpointAttachment(connector.boardState.endAttachment) ?? null,
                    });
                }
            }

            this.moveAttachmentPreview = {
                initialAttachmentsByNode,
                initialConnectorEndpointsByNode,
                initialPowerlineLinks: this.getStationaryPowerlineLinks(context.stationaryNodes)
                    .filter(powerline => powerline.endpoints.some(endpoint => (
                        endpoint.attachment && selectedIds.has(endpoint.attachment.nodeId)
                    ))),
                previewTargetNodes,
                touchedTargetNodeIds: new Set(),
                // Pickup clears prior coupler links — rematch only while snapped to rails.
                attachedRailCouplerKeys: new Set(),
            };
        }

        const effectiveMoveX = context.moveX;
        const effectiveMoveY = context.moveY;
        const effectiveRotationDelta = Number(context.rotationDelta ?? 0);

        const movingOccupancyNodes = [
            ...context.selectedNodes.flatMap(node => {
                if (!(node instanceof FoxholeStructureNode) || !node.hasSnapSocketStructure()) {
                    return [];
                }
                const nodeId = String(node.boardId);
                const origin = context.selectedWorldOrigins.get(nodeId);
                const initialRotation = context.selectedInitialRotations.get(nodeId);
                if (!origin || !Number.isFinite(initialRotation)) {
                    return [];
                }
                const rotatedOrigin = effectiveRotationDelta && context.rotatePivot
                    ? rotatePointAroundPivot(origin, context.rotatePivot, effectiveRotationDelta)
                    : origin;
                const movedOrigin = {
                    x: rotatedOrigin.x + effectiveMoveX,
                    y: rotatedOrigin.y + effectiveMoveY,
                };
                const movedRotation = Number(initialRotation) + effectiveRotationDelta;
                return [{
                    nodeId,
                    sockets: node.collectSnapSocketPoints(context.viewport, movedOrigin, movedRotation),
                    attachments: this.moveAttachmentPreview?.initialAttachmentsByNode.get(nodeId) ?? node.getNormalizedSocketAttachments(),
                }];
            }),
            // Co-selected connectors must participate in live rematch the same way as commit.
            // Otherwise stationary partners (e.g. facilityminewater) stay cleared every frame
            // while only structure↔structure alignment is considered.
            ...context.selectedNodes.flatMap(node => {
                if (!isSplineConnectorSocketSnapHost(node)) {
                    return [];
                }
                const nodeId = String((node as { boardId?: string | number; }).boardId ?? '');
                if (!nodeId) {
                    return [];
                }
                const origin = context.selectedWorldOrigins.get(nodeId);
                const initialRotation = context.selectedInitialRotations.get(nodeId);
                if (!origin || !Number.isFinite(initialRotation)) {
                    return [];
                }
                const rotatedOrigin = effectiveRotationDelta && context.rotatePivot
                    ? rotatePointAroundPivot(origin, context.rotatePivot, effectiveRotationDelta)
                    : origin;
                const movedOrigin = {
                    x: rotatedOrigin.x + effectiveMoveX,
                    y: rotatedOrigin.y + effectiveMoveY,
                };
                const movedRotation = Number(initialRotation) + effectiveRotationDelta;
                const connector = node as FoxholeConnectorGeometryPatchTarget;
                const startSocketName = String(connector.boardState.startSocketName ?? '').trim();
                const endSocketName = String(connector.boardState.endSocketName ?? '').trim();
                const initialEndpoints = this.moveAttachmentPreview?.initialConnectorEndpointsByNode.get(nodeId);
                const attachments: FoxholeStructureSocketAttachmentMap = {
                    ...(this.moveAttachmentPreview?.initialAttachmentsByNode.get(nodeId) ?? {}),
                };
                if (startSocketName && initialEndpoints?.startAttachment) {
                    attachments[startSocketName] = initialEndpoints.startAttachment;
                }
                if (endSocketName && initialEndpoints?.endAttachment) {
                    attachments[endSocketName] = initialEndpoints.endAttachment;
                }
                return [{
                    nodeId,
                    sockets: node.collectSnapSocketPoints(context.viewport, movedOrigin, movedRotation),
                    attachments,
                }];
            }),
        ];

        const movingSockets = movingOccupancyNodes.flatMap(node => node.sockets);
        // Reuse the move-snap spatial index instead of collectSnapSocketPoints on every
        // stationary node (~900+) each pointer move — that was dominating drag `other`.
        const moveSnapScene = this.getMoveSnapSceneState(context);
        const liveAlignmentDistance = 8;
        const nearbyTargetSockets = this.queryMoveSnapTargetSocketsNearWorldPoints(
            movingSockets,
            moveSnapScene.targetSocketSpatialIndex,
            Math.max(
                liveAlignmentDistance,
                DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
                DEFAULT_FOXHOLE_RAIL_COUPLER_KEEP_DISTANCE,
            ),
        );

        const targetNodeIds = collectFoxholeLivePreviewTargetNodeIds({
            nearbyTargetNodeIds: nearbyTargetSockets.map(socket => socket.nodeId),
            previouslyTouchedTargetNodeIds: this.moveAttachmentPreview?.touchedTargetNodeIds ?? [],
            occupancyAttachmentsByNode: moveSnapScene.occupancyAttachmentsByNode,
            selectedNodeIds: selectedIds,
        });
        for (const powerline of this.moveAttachmentPreview.initialPowerlineLinks) {
            targetNodeIds.add(powerline.nodeId);
        }

        const targetOccupancyNodes = [...targetNodeIds].flatMap(nodeId => {
            const node = this.moveAttachmentPreview?.previewTargetNodes.get(nodeId);
            if (!node) {
                return [];
            }

            if (node instanceof FoxholeStructureNode && node.hasSnapSocketStructure()) {
                return [{
                    nodeId,
                    sockets: [] as FoxholeSocketSnapPoint[],
                    attachments: moveSnapScene.occupancyAttachmentsByNode.get(nodeId)
                        ?? this.moveAttachmentPreview?.initialAttachmentsByNode.get(nodeId)
                        ?? node.getNormalizedSocketAttachments(),
                }];
            }

            if (isSplineConnectorSocketSnapHost(node)) {
                const occupancyAttachments = moveSnapScene.occupancyAttachmentsByNode.get(nodeId);
                if (occupancyAttachments) {
                    return [{
                        nodeId,
                        sockets: [] as FoxholeSocketSnapPoint[],
                        attachments: occupancyAttachments,
                    }];
                }
                const initialEndpoints = this.moveAttachmentPreview?.initialConnectorEndpointsByNode.get(nodeId);
                const initialAttachments = {
                    ...(this.moveAttachmentPreview?.initialAttachmentsByNode.get(nodeId) ?? {}),
                };
                if (initialEndpoints) {
                    const connector = node as FoxholeConnectorGeometryPatchTarget;
                    const startSocketName = String(connector.boardState.startSocketName ?? '').trim();
                    const endSocketName = String(connector.boardState.endSocketName ?? '').trim();
                    if (startSocketName && initialEndpoints.startAttachment) {
                        initialAttachments[startSocketName] = initialEndpoints.startAttachment;
                    }
                    if (endSocketName && initialEndpoints.endAttachment) {
                        initialAttachments[endSocketName] = initialEndpoints.endAttachment;
                    }
                }
                return [{
                    nodeId,
                    sockets: [] as FoxholeSocketSnapPoint[],
                    attachments: initialAttachments,
                }];
            }

            return [];
        });

        const nextAttachmentsByNode = new Map<string, FoxholeStructureSocketAttachmentMap>();
        for (const node of movingOccupancyNodes) {
            // Keep co-selected links from occupancy attachments (includes connector start/end).
            // Do not re-read initialAttachmentsByNode alone — that map only stores socketAttachments
            // and would wipe pipe↔structure endpoint links every live frame.
            nextAttachmentsByNode.set(node.nodeId, filterFoxholeStructureSocketAttachments(
                node.attachments,
                attachment => selectedIds.has(String(attachment.nodeId ?? '').trim()),
            ));
        }
        for (const node of targetOccupancyNodes) {
            // Use occupancy attachments (includes connector start/end endpoints). Seeding from
            // socketAttachments alone clears pipe endpoints and disconnects stationary originals
            // when a pasted multi-select runs structure live preview.
            nextAttachmentsByNode.set(node.nodeId, filterFoxholeStructureSocketAttachments(
                node.attachments,
                attachment => !selectedIds.has(String(attachment.nodeId ?? '').trim()),
            ));
        }
        retainFoxholePowerlineAttachments(
            selectedIds,
            this.moveAttachmentPreview.initialPowerlineLinks,
            nextAttachmentsByNode,
            nextAttachmentsByNode,
        );

        const targetSockets = nearbyTargetSockets;
        // Live preview uses a slightly looser alignment than commit so both ends of a
        // dual-socket fit (e.g. silo between pipes) light up while still near the snap pose.
        const onRailTrack = this.isActiveRailTrackMoveSnap(context.activeSnap);
        const attachedRailCouplerKeys = this.moveAttachmentPreview?.attachedRailCouplerKeys
            ?? new Set<string>();
        const alignedMatches = movingSockets.length && targetSockets.length
            ? findAlignedFoxholeSocketMatches({
                movingSockets,
                targetSockets,
                maxDistance: liveAlignmentDistance,
                railCouplerMaxDistance: DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_DISTANCE,
                railCouplerKeepDistance: DEFAULT_FOXHOLE_RAIL_COUPLER_KEEP_DISTANCE,
                allowNewRailCouplerAttachments: onRailTrack,
                isRailCouplerPairAttached: (movingSocket, targetSocket) => (
                    onRailTrack
                    && attachedRailCouplerKeys.has(foxholeRailCouplerLinkKey(
                        movingSocket.nodeId,
                        movingSocket.socketName,
                        targetSocket.nodeId,
                        targetSocket.socketName,
                    ))
                ),
                // Use the working attachment maps (links to the moving selection already
                // cleared), not drag-start initials. Otherwise a 180° silo flip cannot
                // reassign Front/Back to each other's former partners — availability still
                // sees the old counterparts and live preview stays empty until refresh.
                isTargetSocketAvailable: (movingSocket, targetSocket) => areFoxholeSnapSocketsAvailableForAttachment(
                    movingSocket,
                    nextAttachmentsByNode.get(String(movingSocket.nodeId ?? '').trim()),
                    targetSocket,
                    nextAttachmentsByNode.get(String(targetSocket.nodeId ?? '').trim()),
                ),
            })
            : [];

        if (!onRailTrack) {
            attachedRailCouplerKeys.clear();
        }

        for (const aligned of alignedMatches) {
            const movingAttachments = nextAttachmentsByNode.get(aligned.movingNodeId) ?? {};
            movingAttachments[aligned.movingSocketName] = {
                nodeId: aligned.targetNodeId,
                socketName: aligned.targetSocketName,
            };
            nextAttachmentsByNode.set(aligned.movingNodeId, movingAttachments);

            const targetAttachments = nextAttachmentsByNode.get(aligned.targetNodeId) ?? {};
            targetAttachments[aligned.targetSocketName] = {
                nodeId: aligned.movingNodeId,
                socketName: aligned.movingSocketName,
            };
            nextAttachmentsByNode.set(aligned.targetNodeId, targetAttachments);
            this.moveAttachmentPreview?.touchedTargetNodeIds.add(aligned.targetNodeId);

            if (
                isFoxholeRailCouplerSocket({ name: aligned.movingSocketName })
                && isFoxholeRailCouplerSocket({ name: aligned.targetSocketName })
            ) {
                attachedRailCouplerKeys.add(foxholeRailCouplerLinkKey(
                    aligned.movingNodeId,
                    aligned.movingSocketName,
                    aligned.targetNodeId,
                    aligned.targetSocketName,
                ));
            }
        }

        for (const [targetNodeId, nextAttachments] of nextAttachmentsByNode) {
            const node = this.moveAttachmentPreview?.previewTargetNodes.get(targetNodeId) as {
                patchBoardState?: (patch: Record<string, unknown>, options?: Record<string, unknown>) => void;
                boardState?: Record<string, unknown>;
            } | undefined;
            if (!node?.patchBoardState) {
                continue;
            }

            if (this.moveAttachmentPreview?.initialConnectorEndpointsByNode.has(targetNodeId)) {
                const connector = node as FoxholeConnectorGeometryPatchTarget;
                const startSocketName = String(connector.boardState.startSocketName ?? '').trim();
                const endSocketName = String(connector.boardState.endSocketName ?? '').trim();
                const startAttachment = startSocketName && nextAttachments[startSocketName]
                    ? {
                        nodeId: nextAttachments[startSocketName].nodeId,
                        socketName: nextAttachments[startSocketName].socketName,
                    } satisfies FoxholeConnectorEndpointAttachment
                    : null;
                const endAttachment = endSocketName && nextAttachments[endSocketName]
                    ? {
                        nodeId: nextAttachments[endSocketName].nodeId,
                        socketName: nextAttachments[endSocketName].socketName,
                    } satisfies FoxholeConnectorEndpointAttachment
                    : null;
                const connectorSocketAttachments = Object.fromEntries(
                    Object.entries(nextAttachments).filter(([socketName]) => (
                        socketName !== startSocketName && socketName !== endSocketName
                    )),
                );
                const previousStart = this.getNormalizedConnectorEndpointAttachment(connector.boardState.startAttachment) ?? null;
                const previousEnd = this.getNormalizedConnectorEndpointAttachment(connector.boardState.endAttachment) ?? null;
                const previousSocketAttachments = normalizeFoxholeStructureSocketAttachmentMap(connector.boardState.socketAttachments);
                if (
                    JSON.stringify(previousStart) === JSON.stringify(startAttachment)
                    && JSON.stringify(previousEnd) === JSON.stringify(endAttachment)
                    && JSON.stringify(previousSocketAttachments) === JSON.stringify(connectorSocketAttachments)
                ) {
                    continue;
                }
                node.patchBoardState({
                    startAttachment,
                    endAttachment,
                    socketAttachments: connectorSocketAttachments,
                }, {
                    reason: 'foxhole-structure-move-connector-attachment-preview',
                    recordHistory: false,
                });
                continue;
            }

            const previous = normalizeFoxholeStructureSocketAttachmentMap(
                (node as FoxholeStructureNode).boardState?.socketAttachments
                ?? this.moveAttachmentPreview?.initialAttachmentsByNode.get(targetNodeId),
            );
            if (JSON.stringify(previous) === JSON.stringify(nextAttachments)) {
                continue;
            }
            node.patchBoardState({
                socketAttachments: nextAttachments,
            }, {
                reason: 'foxhole-structure-move-attachment-preview',
                recordHistory: false,
            });
        }
        this.refreshStationaryPowerlinePreviews(this.moveAttachmentPreview, movingSockets);
    }

    collectMoveLivePreviewPatches(): BoardNodeMoveSnapPatch[] {
        const preview = this.moveAttachmentPreview;
        if (!preview) {
            return [];
        }

        const patches: BoardNodeMoveSnapPatch[] = [];
        for (const [nodeId, initialAttachments] of preview.initialAttachmentsByNode) {
            const node = preview.previewTargetNodes.get(nodeId) as FoxholeConnectorGeometryPatchTarget | FoxholeStructureNode | undefined;
            if (!node) {
                continue;
            }

            const initialEndpoints = preview.initialConnectorEndpointsByNode.get(nodeId);
            if (initialEndpoints) {
                const connector = node as FoxholeConnectorGeometryPatchTarget;
                const patch = {
                    startAttachment: this.getNormalizedConnectorEndpointAttachment(connector.boardState.startAttachment) ?? null,
                    endAttachment: this.getNormalizedConnectorEndpointAttachment(connector.boardState.endAttachment) ?? null,
                    socketAttachments: normalizeFoxholeStructureSocketAttachmentMap(connector.boardState.socketAttachments),
                };
                if (
                    JSON.stringify(patch.startAttachment) !== JSON.stringify(initialEndpoints.startAttachment)
                    || JSON.stringify(patch.endAttachment) !== JSON.stringify(initialEndpoints.endAttachment)
                    || JSON.stringify(patch.socketAttachments) !== JSON.stringify(initialAttachments)
                ) {
                    patches.push({ nodeId, patch });
                }
                continue;
            }

            const socketAttachments = normalizeFoxholeStructureSocketAttachmentMap(
                (node as FoxholeStructureNode).boardState.socketAttachments,
            );
            if (JSON.stringify(socketAttachments) !== JSON.stringify(initialAttachments)) {
                patches.push({
                    nodeId,
                    patch: { socketAttachments },
                });
            }
        }
        return patches;
    }

    private isMoveAttachmentPreviewLeader(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): boolean {
        const cached = foxholeMoveAttachmentPreviewLeaderCache.get(context);
        if (cached !== undefined) {
            return cached === String(this.boardId);
        }
        const selectedStructureIds = context.selectedNodes
            .filter((node): node is FoxholeStructureNode => (
                node instanceof FoxholeStructureNode && node.hasSnapSocketStructure()
            ))
            .map(node => String(node.boardId))
            .sort();
        const leader = selectedStructureIds[0] ?? null;
        foxholeMoveAttachmentPreviewLeaderCache.set(context, leader);
        return leader === String(this.boardId);
    }

    buildMoveCommitPatches(context: BoardNodeMoveCommitContext) {
        if (!this.hasSnapSocketStructure() || !this.isSnapSocketAttachmentCommitLeader(context)) {
            return [];
        }

        const selectedSnapNodes = this.getSelectedSnapSocketStructureNodes(context);
        const selectedSnapNodeIds = new Set(selectedSnapNodes.map(node => String(node.boardId)));
        const selectedConnectorHosts = this.getSelectedSplineConnectorSnapHosts(context);
        const selectedConnectorIds = new Set(
            selectedConnectorHosts.map(node => String((node as { boardId?: string | number; }).boardId ?? '')).filter(Boolean),
        );
        const liveSnapNodeIds = new Set([
            ...selectedSnapNodes.map(node => String(node.boardId)),
            ...selectedConnectorIds,
            ...context.stationaryNodes.flatMap(node => {
                if (node instanceof FoxholeStructureNode && node.hasSnapSocketStructure()) {
                    return [String(node.boardId)];
                }
                if (isSplineConnectorSocketSnapHost(node)) {
                    const nodeId = String((node as { boardId?: string | number; }).boardId ?? '');
                    return nodeId ? [nodeId] : [];
                }
                return [];
            }),
        ]);
        const selectedPreviousAttachmentsByNode = new Map(
            selectedSnapNodes.map(node => {
                const nodeId = String(node.boardId);
                // Prefer drag-start initials so live preview corruption cannot drop
                // co-selected structure↔connector links before commit rematch.
                const initial = this.moveAttachmentPreview?.initialAttachmentsByNode.get(nodeId)
                    ?? node.getNormalizedSocketAttachments();
                return [
                    nodeId,
                    filterFoxholeStructureSocketAttachments(
                        initial,
                        attachment => {
                            const targetNodeId = String(attachment.nodeId ?? '').trim();
                            return selectedSnapNodeIds.has(targetNodeId) || selectedConnectorIds.has(targetNodeId);
                        },
                    ),
                ] as const;
            }),
        );
        const targetAttachmentMaps = new Map<string, FoxholeStructureSocketAttachmentMap>();

        for (const node of context.stationaryNodes) {
            if (!(node instanceof FoxholeStructureNode) || !node.hasSnapSocketStructure()) {
                continue;
            }

            const nextAttachments = filterFoxholeStructureSocketAttachments(
                node.getNormalizedSocketAttachments(),
                attachment => {
                    const targetNodeId = String(attachment.nodeId ?? '').trim();
                    return liveSnapNodeIds.has(targetNodeId) && !selectedSnapNodeIds.has(targetNodeId) && !selectedConnectorIds.has(targetNodeId);
                },
            );
            targetAttachmentMaps.set(String(node.boardId), nextAttachments);
        }

        const movingSocketOccupancyNodes = [
            ...selectedSnapNodes.map(node => {
                const nodeId = String(node.boardId);
                const worldOrigin = node.getFinalMoveWorldOrigin(context, nodeId);
                const rotation = node.getFinalMoveRotation(context, nodeId);
                if (!worldOrigin || !Number.isFinite(rotation)) {
                    return {
                        nodeId,
                        sockets: [] as FoxholeSocketSnapPoint[],
                        attachments: selectedPreviousAttachmentsByNode.get(nodeId) ?? {},
                    };
                }
                return {
                    nodeId,
                    sockets: node.collectSnapSocketPoints(context.viewport, worldOrigin, rotation),
                    attachments: selectedPreviousAttachmentsByNode.get(nodeId) ?? {},
                };
            }),
            // Co-selected connectors must participate so structure↔pipe reciprocal links survive commit.
            ...selectedConnectorHosts.flatMap(node => {
                const nodeId = String((node as { boardId?: string | number; }).boardId ?? '');
                if (!nodeId) {
                    return [];
                }
                const worldOrigin = this.getFinalMoveWorldOrigin(context, nodeId);
                const rotation = this.getFinalMoveRotation(context, nodeId);
                const connector = node as FoxholeConnectorGeometryPatchTarget;
                const startSocketName = String(connector.boardState.startSocketName ?? '').trim();
                const endSocketName = String(connector.boardState.endSocketName ?? '').trim();
                // Q/E and inspector transforms have no live move preview — seed from board
                // endpoint state so reciprocal structure↔pipe pairs are not dropped.
                const initialEndpoints = this.moveAttachmentPreview?.initialConnectorEndpointsByNode.get(nodeId);
                const attachments: FoxholeStructureSocketAttachmentMap = this.moveAttachmentPreview
                    ? {
                        ...(this.moveAttachmentPreview.initialAttachmentsByNode.get(nodeId) ?? {}),
                    }
                    : this.getConnectorOccupancyAttachments(connector);
                if (this.moveAttachmentPreview) {
                    if (startSocketName && initialEndpoints?.startAttachment) {
                        attachments[startSocketName] = initialEndpoints.startAttachment;
                    }
                    if (endSocketName && initialEndpoints?.endAttachment) {
                        attachments[endSocketName] = initialEndpoints.endAttachment;
                    }
                }
                // Keep only co-selected partners; stationary links are rematched below.
                const coSelectedAttachments = filterFoxholeStructureSocketAttachments(
                    attachments,
                    attachment => {
                        const targetNodeId = String(attachment.nodeId ?? '').trim();
                        return selectedSnapNodeIds.has(targetNodeId) || selectedConnectorIds.has(targetNodeId);
                    },
                );
                if (!worldOrigin || rotation === null) {
                    return [{
                        nodeId,
                        sockets: [] as FoxholeSocketSnapPoint[],
                        attachments: coSelectedAttachments,
                    }];
                }
                return [{
                    nodeId,
                    sockets: node.collectSnapSocketPoints(context.viewport, worldOrigin, rotation),
                    attachments: coSelectedAttachments,
                }];
            }),
        ];
        // Co-selected nodes move rigidly together — keep reciprocal links without a 1px
        // re-alignment check that can drop stable pipe↔structure pairs mid-transform.
        const nextAttachmentsByNode = resolveFoxholeAlignedReciprocalSocketAttachments(
            movingSocketOccupancyNodes,
            { requireAlignment: false },
        );
        const movingSockets = movingSocketOccupancyNodes.flatMap(node => node.sockets);
        // Stationary links to the moving selection are cleared above; always rematch so
        // translate-back / spline-connector snaps can restore them (not only structure snaps
        // or rotates). Live preview already rematches every frame.
        const stationarySocketOccupancyNodes = context.stationaryNodes.flatMap(node => {
            if (node instanceof FoxholeStructureNode && node.hasSnapSocketStructure()) {
                const nodeId = String(node.boardId);
                return [{
                    nodeId,
                    sockets: node.collectSnapSocketPoints(context.viewport),
                    attachments: targetAttachmentMaps.get(nodeId) ?? {},
                }];
            }

            if (isSplineConnectorSocketSnapHost(node)) {
                const nodeId = String((node as { boardId?: string | number; }).boardId ?? '');
                if (!nodeId) {
                    return [];
                }
                if (!targetAttachmentMaps.has(nodeId)) {
                    // Drop links to the moving selection before alignment resolve, matching
                    // stationary structures. Otherwise rotate (no live attachment preview)
                    // re-seeds connector start/end from stale live endpoints and never clears.
                    const seeded = filterFoxholeStructureSocketAttachments(
                        this.getConnectorOccupancyAttachments(node as FoxholeConnectorGeometryPatchTarget),
                        attachment => {
                            const targetNodeId = String(attachment.nodeId ?? '').trim();
                            return !selectedSnapNodeIds.has(targetNodeId) && !selectedConnectorIds.has(targetNodeId);
                        },
                    );
                    targetAttachmentMaps.set(nodeId, seeded);
                }
                return [{
                    nodeId,
                    sockets: node.collectSnapSocketPoints(context.viewport),
                    attachments: targetAttachmentMaps.get(nodeId) ?? {},
                }];
            }

            return [];
        });
        const stationaryPowerlines = this.moveAttachmentPreview?.initialPowerlineLinks
            ?? this.getStationaryPowerlineLinks(context.stationaryNodes);
        retainFoxholePowerlineAttachments(
            selectedSnapNodeIds,
            stationaryPowerlines,
            nextAttachmentsByNode,
            targetAttachmentMaps,
        );
        const stationaryOccupiedAttachmentsByNode = resolveFoxholeAlignedReciprocalSocketAttachments(stationarySocketOccupancyNodes);
        retainFoxholePowerlineAttachments(
            selectedSnapNodeIds,
            stationaryPowerlines,
            nextAttachmentsByNode,
            stationaryOccupiedAttachmentsByNode,
        );
        const targetSockets = stationarySocketOccupancyNodes.flatMap(node => node.sockets);
        const socketPointsByKey = new Map<string, FoxholeSocketSnapPoint>();
        for (const socket of [...movingSockets, ...targetSockets]) {
            socketPointsByKey.set(`${socket.nodeId}:${socket.socketName}`, socket);
        }

        // A docking snap already resolved one specific compatible, available pair while
        // preserving both rail contacts. Persist that intent directly so tiny differences
        // between live Pixi transforms and reconstructed commit geometry cannot discard it.
        const activeDockData = context.activeSnap?.data as FoxholeStructureRailCouplerDockMoveSnapData | null | undefined;
        if (activeDockData?.kind === FOXHOLE_STRUCTURE_RAIL_COUPLER_DOCK_SNAP_RESULT_KIND) {
            const dock = activeDockData.match;
            const movingAttachments = nextAttachmentsByNode.get(dock.movingNodeId);
            const targetAttachments = targetAttachmentMaps.get(dock.targetNodeId);
            if (
                movingAttachments
                && targetAttachments
                && !movingAttachments[dock.movingSocketName]
                && !targetAttachments[dock.targetSocketName]
            ) {
                movingAttachments[dock.movingSocketName] = {
                    nodeId: dock.targetNodeId,
                    socketName: dock.targetSocketName,
                };
                targetAttachments[dock.targetSocketName] = {
                    nodeId: dock.movingNodeId,
                    socketName: dock.movingSocketName,
                };
            }
        }

        for (const match of findAlignedFoxholeSocketMatches({
            movingSockets,
            targetSockets,
            railCouplerMaxDistance: DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_DISTANCE,
            railCouplerKeepDistance: DEFAULT_FOXHOLE_RAIL_COUPLER_KEEP_DISTANCE,
            allowNewRailCouplerAttachments: this.isActiveRailTrackMoveSnap(context.activeSnap),
            isRailCouplerPairAttached: (movingSocket, targetSocket) => (
                this.isActiveRailTrackMoveSnap(context.activeSnap)
                && (
                    this.moveAttachmentPreview?.attachedRailCouplerKeys.has(foxholeRailCouplerLinkKey(
                        movingSocket.nodeId,
                        movingSocket.socketName,
                        targetSocket.nodeId,
                        targetSocket.socketName,
                    )) === true
                )
            ),
            isTargetSocketAvailable: (movingSocket, targetSocket) => areFoxholeSnapSocketsAvailableForAttachment(
                movingSocket,
                nextAttachmentsByNode.get(String(movingSocket.nodeId ?? '').trim()),
                targetSocket,
                stationaryOccupiedAttachmentsByNode.get(String(targetSocket.nodeId ?? '').trim()),
            ),
        })) {
            const movingAttachments = nextAttachmentsByNode.get(match.movingNodeId);
            if (!movingAttachments) {
                continue;
            }
            if (
                !selectedSnapNodeIds.has(match.targetNodeId)
                && !targetAttachmentMaps.has(match.targetNodeId)
            ) {
                continue;
            }

            const displacedMoving = movingAttachments[match.movingSocketName];
            if (displacedMoving && (displacedMoving.nodeId !== match.targetNodeId || displacedMoving.socketName !== match.targetSocketName)) {
                if (selectedSnapNodeIds.has(displacedMoving.nodeId)) {
                    const displacedCounterpartAttachments = nextAttachmentsByNode.get(displacedMoving.nodeId);
                    if (displacedCounterpartAttachments && hasFoxholeReciprocalSocketAttachment(
                        match.movingNodeId,
                        match.movingSocketName,
                        movingAttachments,
                        targetNodeId => targetNodeId === displacedMoving.nodeId ? displacedCounterpartAttachments : undefined,
                    )) {
                        delete displacedCounterpartAttachments[displacedMoving.socketName];
                    }
                }
            }

            movingAttachments[match.movingSocketName] = {
                nodeId: match.targetNodeId,
                socketName: match.targetSocketName,
            };

            const targetAttachments = selectedSnapNodeIds.has(match.targetNodeId)
                ? (nextAttachmentsByNode.get(match.targetNodeId) ?? {})
                : (targetAttachmentMaps.get(match.targetNodeId) ?? {});
            const displaced = targetAttachments[match.targetSocketName];
            if (displaced && (displaced.nodeId !== match.movingNodeId || displaced.socketName !== match.movingSocketName)) {
                if (selectedSnapNodeIds.has(displaced.nodeId)) {
                    const displacedMovingAttachments = nextAttachmentsByNode.get(displaced.nodeId);
                    delete displacedMovingAttachments?.[displaced.socketName];
                } else if (targetAttachmentMaps.has(displaced.nodeId)) {
                    const displacedAttachments = targetAttachmentMaps.get(displaced.nodeId) ?? {};
                    delete displacedAttachments[displaced.socketName];
                    targetAttachmentMaps.set(displaced.nodeId, displacedAttachments);
                }
            }

            targetAttachments[match.targetSocketName] = {
                nodeId: match.movingNodeId,
                socketName: match.movingSocketName,
            };
            if (selectedSnapNodeIds.has(match.targetNodeId)) {
                nextAttachmentsByNode.set(match.targetNodeId, targetAttachments);
            } else {
                targetAttachmentMaps.set(match.targetNodeId, targetAttachments);
            }
        }

        const patches = [];
        for (const node of selectedSnapNodes) {
            const nextAttachments = nextAttachmentsByNode.get(String(node.boardId)) ?? {};
            const initialAttachments = this.moveAttachmentPreview?.initialAttachmentsByNode.get(String(node.boardId));
            const ownPatch = this.buildSocketAttachmentPatch(
                node,
                nextAttachments,
                initialAttachments,
            );
            if (ownPatch) {
                patches.push(ownPatch);
            }
        }

        // Selected connectors participate in rematch via nextAttachmentsByNode but are not in
        // targetAttachmentMaps. Commit their endpoint attachments so stationary rematches stick.
        for (const connector of selectedConnectorHosts) {
            const nodeId = String((connector as { boardId?: string | number; }).boardId ?? '');
            if (!nodeId) {
                continue;
            }
            const attachments = nextAttachmentsByNode.get(nodeId) ?? {};
            const initialEndpoints = this.moveAttachmentPreview?.initialConnectorEndpointsByNode.get(nodeId);
            const initialConnectorSa = this.moveAttachmentPreview?.initialAttachmentsByNode.get(nodeId);
            const previousOverride = initialEndpoints
                ? {
                    startAttachment: initialEndpoints.startAttachment,
                    endAttachment: initialEndpoints.endAttachment,
                    socketAttachments: initialConnectorSa ?? {},
                }
                : undefined;
            const connectorPatch = this.buildConnectorEndpointAttachmentPatch(
                connector as FoxholeConnectorGeometryPatchTarget,
                attachments,
                previousOverride,
            );
            if (connectorPatch) {
                patches.push(connectorPatch);
            }
        }

        for (const [nodeId, attachments] of targetAttachmentMaps.entries()) {
            const structureNode = this.findFoxholeStructureNode(context, nodeId);
            if (structureNode) {
                const initialAttachments = this.moveAttachmentPreview?.initialAttachmentsByNode.get(nodeId);
                const patch = this.buildSocketAttachmentPatch(structureNode, attachments, initialAttachments);
                if (patch) {
                    patches.push(patch);
                }
                continue;
            }

            const connectorNode = [...context.selectedNodes, ...context.stationaryNodes].find(node => (
                isSplineConnectorSocketSnapHost(node)
                && String((node as { boardId?: string | number; }).boardId ?? '') === nodeId
            )) as FoxholeConnectorGeometryPatchTarget | undefined;
            if (!connectorNode) {
                continue;
            }

            const initialEndpoints = this.moveAttachmentPreview?.initialConnectorEndpointsByNode.get(nodeId);
            const initialConnectorSa = this.moveAttachmentPreview?.initialAttachmentsByNode.get(nodeId);
            const previousOverride = initialEndpoints
                ? {
                    startAttachment: initialEndpoints.startAttachment,
                    endAttachment: initialEndpoints.endAttachment,
                    socketAttachments: initialConnectorSa ?? {},
                }
                : undefined;
            const connectorPatch = this.buildConnectorEndpointAttachmentPatch(
                connectorNode,
                attachments,
                previousOverride,
            );
            if (connectorPatch) {
                patches.push(connectorPatch);
            }
        }

        const structureTargets = [
            ...selectedSnapNodes.map(node => ({
                nodeId: String(node.boardId),
                attachments: nextAttachmentsByNode.get(String(node.boardId)) ?? {},
            })),
            ...selectedConnectorHosts.flatMap(node => {
                const nodeId = String((node as { boardId?: string | number; }).boardId ?? '');
                return nodeId
                    ? [{
                        nodeId,
                        attachments: nextAttachmentsByNode.get(nodeId) ?? {},
                    }]
                    : [];
            }),
            ...Array.from(targetAttachmentMaps.entries()).map(([nodeId, attachments]) => ({ nodeId, attachments })),
        ];

        for (const node of context.stationaryNodes) {
            const connectorPatch = this.buildAttachedConnectorGeometryPatch(
                node as FoxholeConnectorGeometryPatchTarget,
                socketPointsByKey,
                selectedSnapNodeIds,
                context.viewport,
                structureTargets,
            );
            if (connectorPatch) {
                patches.push(connectorPatch);
            }
        }

        for (const node of selectedSnapNodes) {
            node.moveAttachmentPreview = null;
        }

        return patches;
    }

    afterMoveCommit(context: BoardNodeMoveCommitContext): void {
        if (!this.hasSnapSocketStructure() || !this.isSnapSocketAttachmentCommitLeader(context)) {
            return;
        }

        invalidateFoxholeSocketOverlaySceneCache();
        const selectedSnapNodes = this.getSelectedSnapSocketStructureNodes(context);
        const overlayNodes = [
            ...selectedSnapNodes,
            ...context.stationaryNodes.filter((node): node is FoxholeStructureNode => (
                node instanceof FoxholeStructureNode && node.hasSnapSocketStructure()
            )),
        ];
        for (const node of overlayNodes) {
            if (node.destroyed) {
                continue;
            }
            node.syncRailCouplerDockZoneOverlay(null);
            node.liveAttachmentPreviewVisualActive = false;
            node.overlayPreviewSignature = '';
            node.syncHitboxOverlay();
        }

        for (const node of [...context.selectedNodes, ...context.stationaryNodes]) {
            if (!isSplineConnectorSocketSnapHost(node)) {
                continue;
            }
            const connector = node as FoxholeConnectorGeometryPatchTarget & {
                destroyed?: boolean;
                onBoardStateChanged?: (reason: string, source: 'local' | 'remote') => void;
            };
            if (connector.destroyed) {
                continue;
            }
            connector.onBoardStateChanged?.('foxhole-structure-attachment-commit-overlay attachment-preview', 'local');
        }
    }

    private syncRailCouplerDockZonesForMove(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): void {
        const movingNode = context.selectedNodes.length === 1
            && context.selectedNodes[0] instanceof FoxholeStructureNode
            && context.selectedNodes[0].hasRailCouplerStructure()
            ? context.selectedNodes[0]
            : null;

        for (const node of context.selectedNodes) {
            if (node instanceof FoxholeStructureNode) {
                node.syncRailCouplerDockZoneOverlay(null);
            }
        }

        const previousTargets = this.railCouplerDockZonePreviewNodes;
        this.railCouplerDockZonePreviewNodes = [];
        for (const node of context.stationaryNodes) {
            if (!(node instanceof FoxholeStructureNode)) {
                continue;
            }
            node.syncRailCouplerDockZoneOverlay(movingNode);
            if (movingNode) {
                this.railCouplerDockZonePreviewNodes.push(node);
            }
        }
        const currentTargets = new Set(this.railCouplerDockZonePreviewNodes);
        for (const node of previousTargets) {
            if (!node.destroyed && !currentTargets.has(node)) {
                node.syncRailCouplerDockZoneOverlay(null);
            }
        }
    }

    private clearRailCouplerDockZones(): void {
        const nodes = this.railCouplerDockZonePreviewNodes;
        this.railCouplerDockZonePreviewNodes = [];
        for (const node of nodes) {
            if (node.destroyed) {
                continue;
            }
            node.syncRailCouplerDockZoneOverlay(null);
        }
    }

    private syncRailCouplerDockZoneOverlay(movingNode: FoxholeStructureNode | null): void {
        const hide = () => {
            this.railCouplerDockZoneMovingNode = null;
            this.railCouplerDockZoneSignature = '';
            if (this.railCouplerDockZoneOverlay.children.length > 0) {
                this.railCouplerDockZoneOverlay.removeChildren().forEach(child => child.destroy());
            }
            this.railCouplerDockZoneOverlay.visible = false;
        };

        if (
            !movingNode
            || movingNode === this
            || movingNode.destroyed
            || this.destroyed
            || this.settingsStore.getValue(FOXHOLE_SOCKET_SNAPPING_SETTING_ID) === false
            || !movingNode.hasRailCouplerStructure()
            || !this.hasRailCouplerStructure()
        ) {
            hide();
            return;
        }

        const movingStructure = movingNode.getResolvedStructure();
        const targetStructure = this.getResolvedStructure();
        if (!movingStructure || !targetStructure) {
            hide();
            return;
        }

        const movingGauge = movingStructure.trackGauge ?? null;
        const targetGauge = targetStructure.trackGauge ?? null;
        if (movingGauge && targetGauge && movingGauge !== targetGauge) {
            hide();
            return;
        }

        const movingAttachments = movingNode.getNormalizedSocketAttachments();
        const movingSocketNames = movingNode.getResolvedBuildSockets(movingStructure)
            .filter(isFoxholeRailCouplerSocket)
            .map(socket => normalizeFoxholeBuildSocketName(socket.name))
            .filter(socketName => socketName && !movingAttachments[socketName]);
        if (!movingSocketNames.length) {
            hide();
            return;
        }

        const targetAttachments = this.getNormalizedSocketAttachments();
        const targetCouplerSockets = this.resolveStructureSockets(
            this.getResolvedBuildSockets(targetStructure).filter(isFoxholeRailCouplerSocket),
            { x: 0, y: 0 },
        );
        const openTargetSockets = targetCouplerSockets.filter(socket => {
            const socketName = normalizeFoxholeBuildSocketName(socket.name);
            return Boolean(
                socketName
                && !targetAttachments[socketName]
                && movingSocketNames.some(movingSocketName => (
                    areFoxholeRailCouplerNamesCompatible(movingSocketName, socketName)
                )),
            );
        });

        if (!openTargetSockets.length) {
            hide();
            return;
        }

        const theme = resolveNxTheme(this.settingsStore.getValue(NIXIE_COLOR_THEME_SETTING_ID) as NxThemePreference);
        const accentHex = resolveRailCouplerDockZoneAccentHex(theme);
        const accentColor = Number.parseInt(accentHex.slice(1), 16);
        const signature = [
            String(movingNode.boardId),
            movingSocketNames.sort().join(','),
            openTargetSockets.map(socket => normalizeFoxholeBuildSocketName(socket.name)).sort().join(','),
            accentHex,
        ].join('|');
        this.railCouplerDockZoneMovingNode = movingNode;
        if (signature === this.railCouplerDockZoneSignature) {
            this.railCouplerDockZoneOverlay.visible = true;
            return;
        }

        this.railCouplerDockZoneSignature = signature;
        this.railCouplerDockZoneOverlay.removeChildren().forEach(child => child.destroy());
        for (const socket of openTargetSockets) {
            const zone = new PIXI.Container();
            zone.label = `${socket.id}:dock-zone`;
            zone.eventMode = 'none';
            zone.position.set(socket.localX, socket.localY);
            zone.rotation = resolveFoxholeRailCouplerDockZoneRotation(socket, targetCouplerSockets);

            const graphics = new PIXI.Graphics();
            graphics.eventMode = 'none';
            graphics.roundRect(
                -RAIL_COUPLER_DOCK_ZONE_SOCKET_OVERLAP,
                -(RAIL_COUPLER_DOCK_ZONE_WIDTH / 2),
                DEFAULT_FOXHOLE_RAIL_COUPLER_DOCK_CAPTURE_DISTANCE
                + RAIL_COUPLER_DOCK_ZONE_SOCKET_OVERLAP,
                RAIL_COUPLER_DOCK_ZONE_WIDTH,
                RAIL_COUPLER_DOCK_ZONE_CORNER_RADIUS,
            );
            graphics.fill({ color: accentColor, alpha: RAIL_COUPLER_DOCK_ZONE_FILL_ALPHA });
            graphics.stroke({
                color: accentColor,
                alpha: RAIL_COUPLER_DOCK_ZONE_STROKE_ALPHA,
                width: RAIL_COUPLER_DOCK_ZONE_STROKE_WIDTH,
            });
            zone.addChild(graphics);
            this.railCouplerDockZoneOverlay.addChild(zone);
        }
        this.railCouplerDockZoneOverlay.visible = true;
    }

    private createPowerSocketVisual(socket: FoxholeResolvedStructureSocket): PIXI.Container {
        const container = createFoxholePowerSocketVisual({
            localX: socket.localX,
            localY: socket.localY,
            rotationRadians: socket.rotationRadians,
            ancestorRotationRadians: this.rotation,
        });
        container.label = socket.id;
        return container;
    }

    private createPipeSocketVisual(socket: FoxholeResolvedStructureSocket): PIXI.Container {
        const container = createFoxholePipeSocketVisual({
            localX: socket.localX,
            localY: socket.localY,
            rotationRadians: socket.rotationRadians,
        }, socket.socket.pipeType);
        container.label = socket.id;
        return container;
    }

    private createGenericSocketVisual(socket: FoxholeResolvedStructureSocket): PIXI.Container {
        const container = new PIXI.Container();
        container.label = socket.id;
        container.eventMode = 'none';
        container.position.set(socket.localX, socket.localY);
        container.rotation = socket.rotationRadians;

        const graphics = new PIXI.Graphics();
        graphics.eventMode = 'none';
        graphics.moveTo(0, 0);
        graphics.lineTo(FOXHOLE_SOCKET_STEM_LENGTH - 2, 0);
        graphics.stroke({ color: GENERIC_SOCKET_OVERLAY_COLOR, alpha: 0.92, width: 2.5 });
        graphics.poly([
            0, -9,
            9, 0,
            0, 9,
            -9, 0,
        ]);
        graphics.fill({ color: GENERIC_SOCKET_OVERLAY_COLOR, alpha: 0.18 });
        graphics.stroke({ color: GENERIC_SOCKET_OVERLAY_COLOR, alpha: 1, width: 2.5 });
        graphics.circle(0, 0, 4);
        graphics.fill({ color: GENERIC_SOCKET_CORE_COLOR, alpha: 1 });
        graphics.rect(FOXHOLE_SOCKET_STEM_LENGTH - 5, -4, 8, 8);
        graphics.fill({ color: GENERIC_SOCKET_OVERLAY_COLOR, alpha: 0.95 });

        container.addChild(graphics);
        return container;
    }

    private createSocketLabel(
        socket: FoxholeResolvedStructureSocket,
        color: number,
    ): PIXI.Text {
        return createFoxholeSocketLabel(
            getFoxholeSocketDebugLabel(socket),
            color,
            socket.rotationRadians,
        );
    }

    private resolveModificationSlots(
        asset: FoxholeStructureAsset,
        slotOrigin: { x: number; y: number; },
    ): FoxholeResolvedModificationSlot[] {
        if (!this.isOperationalStructureEnabled()) {
            return [];
        }

        const centerX = slotOrigin.x;
        const centerY = slotOrigin.y;

        return asset.modificationSlots.flatMap((slot, index) => {
            const slotX = Number(slot.x ?? NaN) / 100;
            const slotY = Number(slot.y ?? NaN) / 100;
            if (!Number.isFinite(slotX) || !Number.isFinite(slotY)) {
                return [];
            }

            return [{
                id: `${this.id}:mod-slot:${index}`,
                name: String(slot.name ?? '').trim() || `slot-${index}`,
                localX: (slotX - centerX) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                localY: (slotY - centerY) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                rotationRadians: (Number(slot.rotation ?? 0) * Math.PI) / 180,
                slot,
            }];
        });
    }

    private createModificationSlotVisual(slot: FoxholeResolvedModificationSlot): PIXI.Container {
        const container = new PIXI.Container();
        container.label = slot.id;
        container.eventMode = 'none';
        container.position.set(slot.localX, slot.localY);
        container.rotation = slot.rotationRadians;

        const graphics = new PIXI.Graphics();
        graphics.eventMode = 'none';
        graphics.rect(-8, -8, 16, 16);
        graphics.fill({ color: MODIFICATION_SLOT_OVERLAY_COLOR, alpha: 0.18 });
        graphics.stroke({ color: MODIFICATION_SLOT_OVERLAY_COLOR, alpha: 1, width: 2.5 });
        graphics.rect(-3, -3, 6, 6);
        graphics.fill({ color: MODIFICATION_SLOT_CORE_COLOR, alpha: 1 });
        graphics.moveTo(0, 0);
        graphics.lineTo(FOXHOLE_SOCKET_STEM_LENGTH, 0);
        graphics.stroke({ color: MODIFICATION_SLOT_OVERLAY_COLOR, alpha: 0.95, width: 2.5 });
        graphics.circle(FOXHOLE_SOCKET_STEM_LENGTH, 0, 3);
        graphics.fill({ color: MODIFICATION_SLOT_OVERLAY_COLOR, alpha: 0.95 });
        container.addChild(graphics);

        const label = new PIXI.Text({
            text: slot.name,
            style: {
                ...STRUCTURE_VOLUME_LABEL_STYLE,
                fontSize: 11,
                fill: MODIFICATION_SLOT_OVERLAY_COLOR,
            },
        });
        label.eventMode = 'none';
        label.anchor.set(0.5, 1);
        label.position.set(0, -12);
        container.addChild(label);

        return container;
    }

    private resolveVehicleSeats(
        structure: FoxholeManifestStructure,
        overlayOrigin: { x: number; y: number; },
    ): FoxholeResolvedVehicleSeat[] {
        if (!this.isOperationalStructureEnabled()) {
            return [];
        }

        const centerX = overlayOrigin.x;
        const centerY = overlayOrigin.y;

        return structure.vehicleSeats.flatMap((seat, index) => {
            const seatX = Number(seat.x ?? NaN) / 100;
            const seatY = Number(seat.y ?? NaN) / 100;
            if (!Number.isFinite(seatX) || !Number.isFinite(seatY)) {
                return [];
            }

            const seatName = String(seat.name ?? '').trim();
            return [{
                id: `${this.id}:seat:${index}`,
                label: seatName ? formatFoxholeComponentDebugLabel(seatName) : `Seat ${index + 1}`,
                localX: (seatX - centerX) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                localY: (seatY - centerY) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                rotationRadians: (Number(seat.rotation ?? 0) * Math.PI) / 180,
                seat,
            }];
        });
    }

    private getVehicleSeatDebugLabel(seat: FoxholeResolvedVehicleSeat): string {
        const seatType = formatFoxholeComponentDebugLabel(String(seat.seat.seatType ?? '').trim());
        const seatDirection = formatFoxholeComponentDebugLabel(String(seat.seat.seatDirection ?? '').trim());
        const baseLabel = seatType || seat.label || 'Seat';
        return seatDirection ? `${baseLabel} (${seatDirection})` : baseLabel;
    }

    private createVehicleSeatVisual(seat: FoxholeResolvedVehicleSeat): PIXI.Container {
        const container = new PIXI.Container();
        container.label = seat.id;
        container.eventMode = 'none';
        container.position.set(seat.localX, seat.localY);
        container.rotation = seat.rotationRadians;

        const graphics = new PIXI.Graphics();
        graphics.eventMode = 'none';
        graphics.roundRect(-8, -6, 16, 12, 3);
        graphics.fill({ color: VEHICLE_SEAT_OVERLAY_COLOR, alpha: 0.18 });
        graphics.stroke({ color: VEHICLE_SEAT_OVERLAY_COLOR, alpha: 0.98, width: 2.5 });
        graphics.rect(-4, -3, 8, 6);
        graphics.fill({ color: VEHICLE_SEAT_CORE_COLOR, alpha: 1 });
        graphics.moveTo(0, 0);
        graphics.lineTo(FOXHOLE_SOCKET_STEM_LENGTH - 2, 0);
        graphics.stroke({ color: VEHICLE_SEAT_OVERLAY_COLOR, alpha: 0.95, width: 2.5 });
        graphics.poly([
            FOXHOLE_SOCKET_STEM_LENGTH + 4, 0,
            FOXHOLE_SOCKET_STEM_LENGTH - 6, -5,
            FOXHOLE_SOCKET_STEM_LENGTH - 6, 5,
        ]);
        graphics.fill({ color: VEHICLE_SEAT_OVERLAY_COLOR, alpha: 0.95 });
        container.addChild(graphics);

        const label = new PIXI.Text({
            text: this.getVehicleSeatDebugLabel(seat),
            style: {
                ...STRUCTURE_VOLUME_LABEL_STYLE,
                fontSize: 11,
                fill: VEHICLE_SEAT_OVERLAY_COLOR,
            },
        });
        label.eventMode = 'none';
        label.anchor.set(0.5, 1);
        label.position.set(0, -12);
        label.rotation = -seat.rotationRadians;
        container.addChild(label);

        return container;
    }

    private resolveSpotlights(
        structure: FoxholeManifestStructure,
        overlayOrigin: { x: number; y: number; },
    ): FoxholeResolvedSpotlight[] {
        if (!this.isOperationalStructureEnabled()) {
            return [];
        }

        const centerX = overlayOrigin.x;
        const centerY = overlayOrigin.y;

        return structure.spotlights.flatMap((spotlight, index) => {
            const lightX = Number(spotlight.x ?? NaN) / 100;
            const lightY = Number(spotlight.y ?? NaN) / 100;
            if (!Number.isFinite(lightX) || !Number.isFinite(lightY)) {
                return [];
            }

            const outerConeAngle = Math.max(6, Number(spotlight.outerConeAngle ?? 24));
            const innerConeAngle = Math.min(outerConeAngle, Math.max(0, Number(spotlight.innerConeAngle ?? 0)));
            const outerConeAngleRadians = (outerConeAngle * Math.PI) / 180;
            const innerConeAngleRadians = (innerConeAngle * Math.PI) / 180;
            const attenuationRadius = Number(spotlight.attenuationRadius ?? NaN);
            const radiusPixels = Number.isFinite(attenuationRadius)
                ? (attenuationRadius / 100) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT
                : NaN;
            const planarProjectionScale = Math.max(0, Math.min(1, Number(spotlight.planarProjectionScale ?? 1)));
            const coneLength = Number.isFinite(radiusPixels) && radiusPixels > 0
                ? radiusPixels * planarProjectionScale
                : 72;
            const outerHalfWidth = Math.tan(outerConeAngleRadians / 2) * coneLength;
            const innerHalfWidth = innerConeAngleRadians > 0
                ? Math.tan(innerConeAngleRadians / 2) * coneLength
                : 0;
            const sourceRadiusPixels = Math.max(0, Number(spotlight.sourceRadius ?? NaN)) / 100 * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT;
            const softSourceRadiusPixels = Math.max(0, Number(spotlight.softSourceRadius ?? NaN)) / 100 * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT;
            const sourceLengthPixels = Math.max(0, Number(spotlight.sourceLength ?? NaN)) / 100 * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT;
            const authoredSourceHalfWidthPixels = Math.max(
                Number.isFinite(sourceRadiusPixels) ? sourceRadiusPixels : 0,
                Number.isFinite(softSourceRadiusPixels) ? softSourceRadiusPixels : 0,
            );
            const baseHalfWidthPixels = planarProjectionScale <= 0.01
                ? Math.min(
                    SPOTLIGHT_MAX_BASE_HALF_WIDTH,
                    Math.max(
                        authoredSourceHalfWidthPixels,
                        SPOTLIGHT_MIN_BASE_HALF_WIDTH,
                    ),
                )
                : Math.min(
                    SPOTLIGHT_MAX_BASE_HALF_WIDTH,
                    outerHalfWidth * 0.5,
                    authoredSourceHalfWidthPixels > 0
                        ? authoredSourceHalfWidthPixels
                        : Math.max(
                            innerHalfWidth > 0 ? innerHalfWidth * 0.06 : 0,
                            outerHalfWidth * SPOTLIGHT_BASE_HALF_WIDTH_SCALE,
                            SPOTLIGHT_MIN_BASE_HALF_WIDTH,
                        ),
                );
            const outerHalfTangent = Math.tan(outerConeAngleRadians / 2);
            const baseOffsetPixels = planarProjectionScale <= 0.01
                ? 0
                : Math.min(
                    coneLength * SPOTLIGHT_MAX_BASE_OFFSET_FRACTION,
                    Math.max(
                        Number.isFinite(sourceLengthPixels) ? sourceLengthPixels : 0,
                        outerHalfTangent > 0.0001 ? baseHalfWidthPixels / outerHalfTangent : 0,
                    ),
                );
            const intensity = Number(spotlight.intensity ?? NaN);
            const beamStrength = Number.isFinite(intensity) && intensity > 0
                ? Math.max(0.35, Math.min(1, Math.log10(intensity + 1) / 1.6))
                : 0.55;
            const spotlightName = String(spotlight.name ?? '').trim();

            return [{
                id: `${this.id}:spotlight:${index}`,
                label: spotlightName ? formatFoxholeComponentDebugLabel(spotlightName) : `Spotlight ${index + 1}`,
                localX: (lightX - centerX) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                localY: (lightY - centerY) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                rotationRadians: (Number(spotlight.rotation ?? 0) * Math.PI) / 180,
                planarProjectionScale,
                coneLength,
                baseOffsetPixels,
                baseHalfWidthPixels,
                outerConeAngleRadians,
                innerConeAngleRadians,
                beamColorHex: resolveSpotlightBeamColorHex(spotlight.lightColor),
                beamStrength,
                spotlight,
            }];
        });
    }

    private createSpotlightVisual(spotlight: FoxholeResolvedSpotlight): PIXI.Container {
        const container = createFoxholeSpotlightBeam(spotlight);
        container.label = spotlight.id;
        container.position.set(spotlight.localX, spotlight.localY);
        container.rotation = spotlight.rotationRadians;
        return container;
    }

    private resolveStructureVolumes(
        structure: FoxholeManifestStructure,
        volumeOrigin: { x: number; y: number; },
    ): FoxholeResolvedStructureVolume[] {
        const centerX = volumeOrigin.x;
        const centerY = volumeOrigin.y;

        return structure.structureVolumes.flatMap((volume, index) => {
            const rawX = Number(volume.x ?? NaN) / 100;
            const rawY = Number(volume.y ?? NaN) / 100;
            const rawWidth = Number(volume.width ?? NaN) / 100;
            const rawLength = Number(volume.length ?? NaN) / 100;
            if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || !Number.isFinite(rawWidth) || !Number.isFinite(rawLength)) {
                return [];
            }

            return [{
                id: `${this.id}:volume:${index}`,
                category: String(volume.category ?? 'other').trim() || 'other',
                label: String(volume.label ?? '').trim() || 'Volume',
                localX: (rawX - rawWidth - centerX) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                localY: (rawY - rawLength - centerY) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                width: rawWidth * 2 * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                height: rawLength * 2 * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT,
                rotationRadians: (Number(volume.rotation ?? 0) * Math.PI) / 180,
            }];
        });
    }

    private createStructureVolumeVisual(volume: FoxholeResolvedStructureVolume): PIXI.Container {
        const colors = STRUCTURE_VOLUME_COLOR_BY_CATEGORY[volume.category] ?? STRUCTURE_VOLUME_COLOR_BY_CATEGORY.other;
        const container = new PIXI.Container();
        container.label = volume.id;
        container.eventMode = 'none';
        container.position.set(volume.localX + (volume.width / 2), volume.localY + (volume.height / 2));
        container.rotation = volume.rotationRadians;

        const graphics = new PIXI.Graphics();
        graphics.eventMode = 'none';
        graphics.rect(-(volume.width / 2), -(volume.height / 2), volume.width, volume.height);
        graphics.fill({ color: colors.fill, alpha: STRUCTURE_VOLUME_OVERLAY_FILL_ALPHA });
        graphics.stroke({ color: colors.stroke, alpha: STRUCTURE_VOLUME_OVERLAY_STROKE_ALPHA, width: STRUCTURE_VOLUME_OVERLAY_STROKE_WIDTH });
        container.addChild(graphics);

        const label = new PIXI.Text({
            text: volume.label,
            style: {
                ...STRUCTURE_VOLUME_LABEL_STYLE,
                fill: colors.stroke,
            },
        });
        label.eventMode = 'none';
        label.anchor.set(0, 0);
        label.position.set(
            -(volume.width / 2) + STRUCTURE_VOLUME_LABEL_PADDING,
            -(volume.height / 2) + STRUCTURE_VOLUME_LABEL_PADDING,
        );
        container.addChild(label);

        return container;
    }

    private syncStructureVolumeOverlay(
        structure: FoxholeManifestStructure,
        volumeOrigin: { x: number; y: number; },
        overlaySettings: FoxholeStructureDebugOverlaySettings,
    ): void {
        this.structureVolumeOverlay.removeChildren().forEach(child => child.destroy());

        if (overlaySettings.visibleVolumeCategories.size === 0) {
            this.structureVolumeOverlay.visible = false;
            return;
        }

        const volumes = this.resolveStructureVolumes(structure, volumeOrigin)
            .filter(volume => overlaySettings.visibleVolumeCategories.has(volume.category));
        if (volumes.length === 0) {
            this.structureVolumeOverlay.visible = false;
            return;
        }

        for (const volume of volumes) {
            this.structureVolumeOverlay.addChild(this.createStructureVolumeVisual(volume));
        }

        this.structureVolumeOverlay.visible = true;
    }

    private syncSocketOverlay(
        structure: FoxholeManifestStructure,
        asset: FoxholeStructureAsset | undefined,
        socketOrigin: { x: number; y: number; },
        overlaySettings: FoxholeStructureDebugOverlaySettings,
    ): void {
        if (!this.socketOverlay) {
            return;
        }

        this.socketOverlay.removeChildren().forEach(child => child.destroy());

        const {
            showAllSockets,
            showPowerSockets,
            showPipeSockets,
            showBreachIndicators,
            showSocketLabels,
            showModificationSlots,
            showVehicleSeats,
            showSpotlights,
        } = overlaySettings;
        if (!showAllSockets && !showPowerSockets && !showPipeSockets && !showBreachIndicators && !showModificationSlots && !showVehicleSeats && !showSpotlights) {
            this.socketOverlay.visible = false;
            this.socketOverlay.alpha = 1;
            return;
        }

        const overlayBuildSockets = this.getResolvedBuildSocketsForOverlay(structure);
        const sockets = this.resolveStructureSockets(overlayBuildSockets, socketOrigin);
        const allSocketLabelGroups = new Map<string, FoxholeResolvedStructureSocket[]>();
        if (showAllSockets && showSocketLabels) {
            for (const socket of sockets) {
                const key = getFoxholeSocketLabelPositionKey(socket);
                const group = allSocketLabelGroups.get(key) ?? [];
                group.push(socket);
                allSocketLabelGroups.set(key, group);
            }
        }
        const modificationSlots = asset ? this.resolveModificationSlots(asset, socketOrigin) : [];
        const vehicleSeats = showVehicleSeats ? this.resolveVehicleSeats(structure, socketOrigin) : [];
        const spotlights = showSpotlights ? this.resolveSpotlights(structure, socketOrigin) : [];
        const occupiedSocketKeys = showAllSockets ? this.getSocketOverlayOccupancyKeys() : null;
        const breachNeighborById = showBreachIndicators ? this.resolveBreachIndicatorNeighborMap() : null;
        if (sockets.length === 0 && modificationSlots.length === 0 && vehicleSeats.length === 0 && spotlights.length === 0) {
            this.socketOverlay.visible = false;
            this.socketOverlay.alpha = 1;
            return;
        }

        const attachments = this.getNormalizedSocketAttachments();
        for (const socket of sockets) {
            const showBreachForSocket = showBreachIndicators
                && isFoxholeBreachIndicatorSocket(structure, socket.socket);

            if (showAllSockets) {
                const visual = showBreachForSocket && breachNeighborById
                    ? this.createBreachSocketStatusVisual(socket, structure, breachNeighborById, true)
                    : this.createSocketAttachmentStatusVisual(socket, occupiedSocketKeys ?? new Set<string>());
                const socketLabelGroup = allSocketLabelGroups.get(getFoxholeSocketLabelPositionKey(socket)) ?? [socket];
                if (showSocketLabels && socketLabelGroup[0] === socket) {
                    // Labels always represent attachment state, even while the
                    // square marker represents breach state. A connected pair
                    // therefore colors both endpoint labels green.
                    visual.addChild(createFoxholeAllSocketsLabel(
                        socketLabelGroup, this.boardState.foxholeKey,
                        labelSocket => this.resolveSocketAttachmentStatusColor(labelSocket, occupiedSocketKeys ?? new Set<string>()),
                    ));
                }
                this.socketOverlay.addChild(visual);
                continue;
            }

            if (showBreachForSocket && breachNeighborById) {
                this.socketOverlay.addChild(this.createBreachSocketStatusVisual(socket, structure, breachNeighborById));
                continue;
            }

            // Hide decorative indicators when the socket is attached, matching
            // fort/trench wall occupancy hiding.
            if (attachments[String(socket.socket.name ?? '').trim()]) {
                continue;
            }

            if (socket.kind === 'power') {
                if (showPowerSockets) {
                    const visual = this.createPowerSocketVisual(socket);
                    if (showSocketLabels) {
                        visual.addChild(this.createSocketLabel(socket, FOXHOLE_POWER_SOCKET_COLOR));
                    }
                    this.socketOverlay.addChild(visual);
                }
                continue;
            }

            if (socket.kind === 'pipe') {
                if (showPipeSockets) {
                    const color = this.getPipeSocketOverlayColor(socket);
                    const visual = this.createPipeSocketVisual(socket);
                    if (showSocketLabels) {
                        visual.addChild(this.createSocketLabel(socket, color));
                    }
                    this.socketOverlay.addChild(visual);
                }
                continue;
            }
        }

        if (showModificationSlots) {
            for (const slot of modificationSlots) {
                this.socketOverlay.addChild(this.createModificationSlotVisual(slot));
            }
        }

        if (showVehicleSeats) {
            for (const seat of vehicleSeats) {
                this.socketOverlay.addChild(this.createVehicleSeatVisual(seat));
            }
        }

        if (showSpotlights) {
            for (const spotlight of spotlights) {
                this.socketOverlay.addChild(this.createSpotlightVisual(spotlight));
            }
        }

        this.socketOverlay.visible = this.socketOverlay.children.length > 0;
        // Match ghosted structure textures while an upgrade replacement is hovered.
        this.socketOverlay.alpha = this.getResolvedStructureTextureAlpha();
    }

    private syncHitboxOverlay(): void {
        if (!this.structureVolumeOverlay || !this.socketOverlay || !this.rangeOverlay) {
            return;
        }

        const structure = this.getResolvedStructure();
        const asset = this.getResolvedAsset();
        if (!structure) {
            this.clearHitboxDebugOverlay();
            this.structureVolumeOverlay.removeChildren().forEach(child => child.destroy());
            this.structureVolumeOverlay.visible = false;
            this.socketOverlay.removeChildren().forEach(child => child.destroy());
            this.socketOverlay.visible = false;
            this.clearRangeOverlayGraphics();
            return;
        }

        this.syncHitboxDebugOverlay();
        const polygons = structure.footprintPolygons ?? [];
        const validShapes = polygons
            .map(polygon => Array.isArray(polygon.shape) ? polygon.shape : [])
            .filter(shape => shape.length >= 6);
        const buildSockets = this.getResolvedBuildSocketsForOverlay(structure);
        const polygonBounds = this.getFootprintBoundsFromShapes(validShapes);
        const footprintVolumeBounds = this.getStructureVolumeBounds(structure, 'footprint');
        const structureVolumeBounds = this.getStructureVolumeBounds(structure);
        const socketBounds = this.getFootprintBoundsFromSockets(buildSockets);
        const vehicleSeatBounds = this.isOperationalStructureEnabled()
            ? this.getFootprintBoundsFromOverlayPoints(structure.vehicleSeats)
            : null;
        const spotlightBounds = this.isOperationalStructureEnabled()
            ? this.getFootprintBoundsFromOverlayPoints(structure.spotlights)
            : null;
        const footprintBounds = polygonBounds ?? footprintVolumeBounds;
        const bounds = footprintBounds ?? structureVolumeBounds ?? socketBounds ?? vehicleSeatBounds ?? spotlightBounds;
        const overlaySettings = this.getDebugOverlaySettings();

        if (!bounds) {
            this.structureVolumeOverlay.removeChildren().forEach(child => child.destroy());
            this.structureVolumeOverlay.visible = false;
            this.socketOverlay.removeChildren().forEach(child => child.destroy());
            this.socketOverlay.visible = false;
            return;
        }

        this.syncStructureVolumeOverlay(structure, { x: 0, y: 0 }, overlaySettings);
        this.syncSocketOverlay(structure, asset, { x: 0, y: 0 }, overlaySettings);
    }

    private clearHitboxDebugOverlay(): void {
        this.hitboxDebugOverlay.clear();
        this.hitboxDebugOverlay.visible = false;
    }

    private getAuthoredSceneHitboxes(): number[][] {
        const metrics = readHitboxHostMetrics(this);
        const sceneHitboxes = listHitboxChildren(this)
            .filter(hitbox => hitbox.boardType === NIXIE_HITBOX_NODE_TYPE)
            .map(hitbox => {
                const state = hitbox.boardState as NixieHitboxState;
                return scaleHitboxPointsToCurrentHostLocal(
                    state.points,
                    Number(state.basisWidth) || metrics.width,
                    Number(state.basisHeight) || metrics.height,
                    metrics,
                );
            })
            .filter(points => points.length >= 6);
        // Authoritative manifest geometry is useful the moment Debug >
        // Hitboxes turns on, before the inspector materializes it as editable
        // child data for the selected structure.
        return sceneHitboxes.length > 0 ? sceneHitboxes : this.getDefaultLineOfSightHitboxes();
    }

    private syncHitboxDebugOverlay(): void {
        this.clearHitboxDebugOverlay();
        // Selected assets render their editable hitbox directly from each
        // hitbox facet. Keeping this debug renderer selection-driven as well
        // produces a stale second polygon during live vertex previews.
        const showHitboxes = this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hitboxes) === true;
        if (!showHitboxes) {
            return;
        }

        const hitboxes = this.getAuthoredSceneHitboxes();
        for (const points of hitboxes) {
            this.hitboxDebugOverlay.poly(points, true);
            this.hitboxDebugOverlay.fill({ color: HITBOX_DEBUG_COLOR, alpha: HITBOX_DEBUG_FILL_ALPHA });
            this.hitboxDebugOverlay.stroke({
                color: HITBOX_DEBUG_COLOR,
                alpha: HITBOX_DEBUG_STROKE_ALPHA,
                width: HITBOX_DEBUG_STROKE_WIDTH,
            });
        }
        this.hitboxDebugOverlay.visible = hitboxes.length > 0;
    }

    private isRangeSelected(): boolean {
        return activeNixieSelectionIds.value.includes(String(this.boardId));
    }

    private getRangeSettings() {
        return readFoxholeRangeSettingsFromGetter(settingId => this.settingsStore.getValue(settingId));
    }

    private clearRangeOverlayGraphics(): void {
        this.clearLineOfSightMask();
        this.rangeOverlay.removeChildren().forEach(child => child.destroy());
        this.rangeOverlay.visible = false;
        this.rangeOverlayCacheKey = '';
        this.rangeOverlayEntries = [];
    }

    private isLineOfSightEnabled(): boolean {
        return this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.lineOfSight) === true
            && isFoxholeLineOfSightStructureKey(this.boardState.foxholeKey);
    }

    private clearLineOfSightMask(): void {
        this.rangeOverlay.mask = null;
        this.lineOfSightMask.clear();
        this.lineOfSightMask.visible = false;
        this.lineOfSightClipOutline.clear();
        this.lineOfSightClipOutline.visible = false;
    }

    private getLineOfSightOccluderPolygons(maxDistance: number): Array<Array<{ x: number; y: number; }>> {
        const polygons: Array<Array<{ x: number; y: number; }>> = [];
        for (const candidate of this.parent?.children ?? []) {
            if (!(candidate instanceof FoxholeStructureNode) || candidate === this || candidate.destroyed || candidate.boardState.visible === false) {
                continue;
            }

            const authoredPolygons = candidate.getAuthoredLineOfSightPolygons();
            if (authoredPolygons.length > 0) {
                for (const polygon of authoredPolygons) {
                    const localPolygon = candidate.toLineOfSightMaskLocalPolygon(this, polygon);
                    if (this.isLineOfSightPolygonWithinRange(localPolygon, maxDistance)) {
                        polygons.push(localPolygon);
                    }
                }
                continue;
            }

            for (const box of candidate.getSelectionGeometry()?.hitBoxes ?? []) {
                const cos = Math.cos(box.rotationRadians);
                const sin = Math.sin(box.rotationRadians);
                const localPolygon = [
                    { x: -box.halfWidth, y: -box.halfHeight },
                    { x: box.halfWidth, y: -box.halfHeight },
                    { x: box.halfWidth, y: box.halfHeight },
                    { x: -box.halfWidth, y: box.halfHeight },
                ].map(corner => {
                    const global = candidate.toGlobal({
                        x: box.centerX + (corner.x * cos) - (corner.y * sin),
                        y: box.centerY + (corner.x * sin) + (corner.y * cos),
                    });
                    return this.toLocal(global);
                });
                if (this.isLineOfSightPolygonWithinRange(localPolygon, maxDistance)) {
                    polygons.push(localPolygon);
                }
            }
        }
        return polygons;
    }

    /** Conservative range test: a blocker outside this box cannot clip a ray. */
    private isLineOfSightPolygonWithinRange(
        polygon: readonly { x: number; y: number; }[],
        maxDistance: number,
    ): boolean {
        if (polygon.length === 0) {
            return false;
        }
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const point of polygon) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
        const nearestX = Math.max(minX, Math.min(0, maxX));
        const nearestY = Math.max(minY, Math.min(0, maxY));
        return (nearestX * nearestX) + (nearestY * nearestY) <= maxDistance * maxDistance;
    }

    private isLineOfSightAffectedByLiveTransform(movingStructure: FoxholeStructureNode): boolean {
        if (!this.isLineOfSightEnabled() || !this.rangeOverlay.visible || movingStructure.destroyed) {
            return false;
        }
        if (movingStructure === this) {
            return true;
        }
        const maxDistance = this.getVisibleLineOfSightRangeDistance();
        if (maxDistance <= 0) {
            return false;
        }
        const hitBoxes = movingStructure.getSelectionGeometry()?.hitBoxes ?? [];
        // Be conservative for nonstandard structures that expose no selection
        // bounds: keeping that range live is preferable to a stale LOS mask.
        if (hitBoxes.length === 0) {
            return true;
        }
        for (const box of hitBoxes) {
            const cos = Math.cos(box.rotationRadians);
            const sin = Math.sin(box.rotationRadians);
            const polygon = [
                { x: -box.halfWidth, y: -box.halfHeight },
                { x: box.halfWidth, y: -box.halfHeight },
                { x: box.halfWidth, y: box.halfHeight },
                { x: -box.halfWidth, y: box.halfHeight },
            ].map(corner => {
                const global = movingStructure.toGlobal({
                    x: box.centerX + (corner.x * cos) - (corner.y * sin),
                    y: box.centerY + (corner.x * sin) + (corner.y * cos),
                });
                return this.toLocal(global);
            });
            if (this.isLineOfSightPolygonWithinRange(polygon, maxDistance)) {
                return true;
            }
        }
        return false;
    }

    private isPointInsideVisibleRange(point: { x: number; y: number; }): boolean {
        return this.rangeOverlayEntries.some(({ range, visual }) => {
            if (!visual.visible) {
                return false;
            }

            const centerX = toFoxholeRangePosition(range.x);
            const centerY = toFoxholeRangePosition(range.y);
            const deltaX = point.x - centerX;
            const deltaY = point.y - centerY;
            const distance = Math.hypot(deltaX, deltaY);
            const maxRadius = toFoxholeRangeDistance(range.max);
            const minRadius = toFoxholeRangeDistance(range.min);
            const overlapRadius = toFoxholeRangeDistance(range.overlap);
            const epsilon = RANGE_OVERLAY_STROKE_WIDTH;

            const inPrimaryRange = maxRadius && distance <= maxRadius + epsilon && (!minRadius || distance >= minRadius - epsilon)
                && (() => {
                    const arcDegrees = Number(range.arc ?? NaN);
                    if (!Number.isFinite(arcDegrees) || arcDegrees <= 0 || (arcDegrees * 2) >= 359.99) {
                        return true;
                    }
                    const rotationRadians = (Number(range.rotation ?? 0) * Math.PI) / 180;
                    const angleDelta = Math.atan2(Math.sin(Math.atan2(deltaY, deltaX) - rotationRadians), Math.cos(Math.atan2(deltaY, deltaX) - rotationRadians));
                    return Math.abs(angleDelta) <= ((arcDegrees * Math.PI) / 180) + 0.0001;
                })();
            const inOverlapRange = overlapRadius && distance <= overlapRadius + epsilon;
            return Boolean(inPrimaryRange || inOverlapRange);
        });
    }

    private drawLineOfSightClippedEdge(graphics: PIXI.Graphics, point: { x: number; y: number; }, nextPoint: { x: number; y: number; }): void {
        const segmentCount = Math.max(1, Math.ceil(Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y) / 8));
        let isDrawing = false;
        for (let index = 0; index < segmentCount; index += 1) {
            const startT = index / segmentCount;
            const endT = (index + 1) / segmentCount;
            const start = {
                x: point.x + ((nextPoint.x - point.x) * startT),
                y: point.y + ((nextPoint.y - point.y) * startT),
            };
            const end = {
                x: point.x + ((nextPoint.x - point.x) * endT),
                y: point.y + ((nextPoint.y - point.y) * endT),
            };
            if (!this.isPointInsideVisibleRange({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })) {
                isDrawing = false;
                continue;
            }
            if (!isDrawing) {
                graphics.moveTo(start.x, start.y);
                isDrawing = true;
            }
            graphics.lineTo(end.x, end.y);
        }
    }

    private getAuthoredLineOfSightPolygons(): number[][] {
        const authoredSceneHitboxes = this.getAuthoredSceneHitboxes();
        if (authoredSceneHitboxes.length > 0) {
            return authoredSceneHitboxes;
        }

        return this.getResolvedLineOfSightPolygons()
            .map(polygon => polygon.shape.map(point => point * RANGE_OVERLAY_PIXELS_PER_METER))
            .filter(points => points.length >= 6);
    }

    /** Source polygons used when beginning an editor hitbox pass. */
    getDefaultLineOfSightHitboxes(): number[][] {
        return this.getResolvedLineOfSightPolygons()
            .map(polygon => polygon.shape.map(point => point * RANGE_OVERLAY_PIXELS_PER_METER))
            .filter(points => points.length >= 6);
    }

    private getResolvedLineOfSightPolygons() {
        const variant = this.getResolvedSelectedModificationVariants()
            .map(selection => selection.variant)
            .find(candidate => candidate.lineOfSightPolygons.length > 0);
        return variant?.lineOfSightPolygons ?? this.getResolvedStructure()?.lineOfSightPolygons ?? [];
    }

    private getResolvedSelectionPolygons() {
        const variant = this.getResolvedSelectedModificationVariants()
            .map(selection => selection.variant)
            .find(candidate => candidate.selectionPolygons.length > 0);
        return variant?.selectionPolygons ?? this.getResolvedStructure()?.selectionPolygons ?? [];
    }

    private toLineOfSightMaskLocalPolygon(
        target: FoxholeStructureNode,
        points: readonly number[],
    ): Array<{ x: number; y: number; }> {
        const polygon: Array<{ x: number; y: number; }> = [];
        for (let index = 0; index + 1 < points.length; index += 2) {
            const global = this.toGlobal({ x: points[index]!, y: points[index + 1]! });
            polygon.push(target.toLocal(global));
        }
        return polygon;
    }

    private getVisibleLineOfSightRangeDistance(): number {
        return Math.max(0, ...this.rangeOverlayEntries
            .filter(entry => entry.visual.visible)
            .map(entry => Math.max(
                toFoxholeRangeDistance(entry.range.max) ?? 0,
                toFoxholeRangeDistance(entry.range.overlap) ?? 0,
                toFoxholeRangeDistance(entry.range.reach) ?? 0,
            )));
    }

    private setRangeOverlayStrokeVisibility(visible: boolean): void {
        for (const entry of this.rangeOverlayEntries) {
            if (entry.strokeVisual) {
                entry.strokeVisual.visible = visible;
            }
        }
    }

    private syncLineOfSightMask(options: { live?: boolean; } = {}): void {
        if (
            !this.isLineOfSightEnabled()
            || !this.rangeOverlay.visible
        ) {
            if (this.rangeOverlay.mask === this.lineOfSightMask || this.lineOfSightMask.visible) {
                this.clearLineOfSightMask();
            }
            return;
        }

        this.setRangeOverlayStrokeVisibility(options.live !== true);
        this.clearLineOfSightMask();

        const maxDistance = this.getVisibleLineOfSightRangeDistance();
        const points = buildFoxholeLineOfSightMaskPoints({
            origin: { x: 0, y: 0 },
            maxDistance,
            occluders: this.getLineOfSightOccluderPolygons(maxDistance),
            baseRayCount: options.live ? LIVE_LINE_OF_SIGHT_BASE_RAY_COUNT : undefined,
        });
        if (points.length < 3) {
            return;
        }

        this.lineOfSightMask.poly(points.flatMap(point => [point.x, point.y]), true).fill(0xFFFFFF);
        this.lineOfSightMask.visible = true;
        this.rangeOverlay.mask = this.lineOfSightMask;

        // Rebuilding clipped edge segments involves many short Graphics paths.
        // Keep the live mask responsive and restore the precise outline when the
        // transform settles through the normal overlay sync.
        if (options.live) {
            return;
        }

        const color = getFoxholeRangeColor(this.rangeOverlayEntries.find(entry => entry.visual.visible)?.range.type);
        for (let index = 0; index < points.length; index += 1) {
            const point = points[index]!;
            const nextPoint = points[(index + 1) % points.length]!;
            const pointIsClipped = Math.hypot(point.x, point.y) < maxDistance - LINE_OF_SIGHT_CLIP_EDGE_EPSILON;
            const nextPointIsClipped = Math.hypot(nextPoint.x, nextPoint.y) < maxDistance - LINE_OF_SIGHT_CLIP_EDGE_EPSILON;
            if (pointIsClipped || nextPointIsClipped) {
                this.drawLineOfSightClippedEdge(this.lineOfSightClipOutline, point, nextPoint);
            }
        }
        this.lineOfSightClipOutline.stroke({
            color,
            alpha: RANGE_OVERLAY_STROKE_ALPHA,
            width: RANGE_OVERLAY_STROKE_WIDTH,
        });
        this.lineOfSightClipOutline.visible = true;
    }

    private clearMarkedCargoOverlayGraphics(): void {
        this.markedCargoOverlay.removeChildren().forEach(child => {
            unregisterCanvasHoverTarget(child);
            child.destroy();
        });
        this.markedCargoOverlay.visible = false;
        this.markedCargoOverlayCacheKey = '';
        this.markedCargoOverlayGeneration += 1;
    }

    private clearProductionOutputOverlayGraphics(): void {
        this.productionOutputOverlay.removeChildren().forEach(child => {
            unregisterCanvasHoverTarget(child);
            child.destroy();
        });
        this.productionOutputOverlay.visible = false;
        this.productionOutputOverlayCacheKey = '';
        this.productionOutputOverlayGeneration += 1;
    }

    private getMarkedCargoCodenames(): string[] {
        const structure = this.getResolvedStructure();
        const grouped = resolveFoxholeGroupedCargoCodenames(structure?.stockpiles, this.boardState.markedStockpileItems, this.boardState.markedItemCodenames);
        if (grouped) return grouped;
        const holdProfile = structure?.holdProfile ?? null;
        if (!hasFoxholeHoldProfileItemSelection(holdProfile)) {
            return [];
        }
        return resolveSupportedMarkedItemCodenames(holdProfile, this.boardState.markedItemCodenames);
    }

    private getProductionOutputs(): FoxholeProductionTileOutput[] {
        if (this.boardState.disableProduction === true) {
            return [];
        }
        const maxOrders = resolveFoxholeStructureMaxOrders(this.getResolvedStructure());
        const orders = clampFoxholeStructureProductionOrders(this.boardState.productionOrders, maxOrders);
        const resolveOutputs = this.boardDefinition.productionOutputsResolver;
        if (!resolveOutputs) {
            return [];
        }
        const intervalSeconds = resolveFoxholeMaintenanceIntervalSeconds(
            String(this.settingsStore.getValue(FOXHOLE_STATS_SETTING_KEYS.timeInterval) ?? ''),
            Number(this.settingsStore.getValue(FOXHOLE_STATS_SETTING_KEYS.customIntervalSeconds)),
        );
        return orders.flatMap(order => (resolveOutputs(order.recipeId) ?? []).map(output => ({
            ...output,
            completedCycles: resolveFoxholeProductionCompletedCycles(
                output.durationSeconds,
                intervalSeconds,
                order.cycles,
            ),
            intervalSeconds,
        })));
    }

    private getMarkedCargoAssetDimensionsPx(): { width: number; height: number; } | null {
        const dimensions = this.getResolvedDimensions();
        if (typeof dimensions.width !== 'number' || typeof dimensions.height !== 'number') {
            return null;
        }

        return {
            width: dimensions.width,
            height: dimensions.height,
        };
    }

    private resolveMarkedCargoOverlaySizing(count: number, columnCount = 1): MarkedCargoIconSizing {
        const assetDimensions = this.getMarkedCargoAssetDimensionsPx();
        return resolveMarkedCargoIconSizing({
            count,
            assetWidthPx: assetDimensions ? assetDimensions.width / Math.max(1, columnCount) : undefined,
            assetHeightPx: assetDimensions?.height,
        });
    }

    private getMarkedCargoOverlayBackground(): number {
        const theme = resolveNxTheme(this.settingsStore.getValue(NIXIE_COLOR_THEME_SETTING_ID) as NxThemePreference);
        return resolveNxAssetIconTileTheme(theme).background;
    }

    private createMarkedCargoOverlayFrame(tileMetrics: MarkedCargoAssetTileMetrics, background: number, border: number): PIXI.Graphics {
        const frame = new PIXI.Graphics();
        const { framePx, frameRadiusPx, borderPx } = tileMetrics;
        const frameHalf = framePx / 2;
        const gutterPx = Math.max(2, Math.round(framePx / 32));
        const fillInset = borderPx + gutterPx;
        frame.roundRect(
            -frameHalf + fillInset,
            -frameHalf + fillInset,
            framePx - fillInset * 2,
            framePx - fillInset * 2,
            Math.max(2, frameRadiusPx - fillInset),
        ).fill({ color: background, alpha: 1 });
        frame.roundRect(-frameHalf, -frameHalf, framePx, framePx, frameRadiusPx)
            .stroke({ color: border, width: borderPx, alignment: 1, alpha: 1 });
        return frame;
    }

    private rebuildMarkedCargoOverlay(codenames: string[], sizing: MarkedCargoIconSizing): void {
        this.markedCargoOverlay.removeChildren().forEach(child => {
            unregisterCanvasHoverTarget(child);
            child.destroy();
        });
        const generation = ++this.markedCargoOverlayGeneration;
        const positions = layoutMarkedCargoIconGrid(codenames.length, sizing);
        const tileMetrics = resolveMarkedCargoAssetTileMetrics(sizing.framePx);
        const iconInnerPx = tileMetrics.innerPx;
        const background = this.getMarkedCargoOverlayBackground();

        for (let index = 0; index < codenames.length; index += 1) {
            const position = positions[index];
            if (!position) {
                continue;
            }

            const cell = new PIXI.Container();
            this.bindItemTileHover(cell, codenames[index] ?? '', sizing.framePx, 'Storage', MARKED_CARGO_TILE_BORDER_COLOR);
            cell.addChild(this.createMarkedCargoOverlayFrame(
                tileMetrics,
                background,
                MARKED_CARGO_TILE_BORDER_COLOR,
            ));

            const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
            sprite.anchor.set(0.5);
            sprite.width = iconInnerPx;
            sprite.height = iconInnerPx;
            cell.addChild(sprite);
            cell.position.set(position.x, position.y);
            this.markedCargoOverlay.addChild(cell);

            const iconUrl = this.boardDefinition.itemIconUrlResolver?.(codenames[index] ?? '');
            if (!iconUrl) {
                continue;
            }

            void loadFoxholeTexture(iconUrl).then(texture => {
                if (
                    generation !== this.markedCargoOverlayGeneration
                    || !texture
                    || texture.destroyed
                    || sprite.destroyed
                ) {
                    return;
                }

                sprite.texture = texture;
                const maxDimension = Math.max(texture.width, texture.height, 1);
                sprite.width = (texture.width / maxDimension) * iconInnerPx;
                sprite.height = (texture.height / maxDimension) * iconInnerPx;
            });
        }
    }

    private rebuildProductionOutputOverlay(outputs: FoxholeProductionTileOutput[], sizing: MarkedCargoIconSizing): void {
        this.productionOutputOverlay.removeChildren().forEach(child => {
            unregisterCanvasHoverTarget(child);
            child.destroy();
        });
        const generation = ++this.productionOutputOverlayGeneration;
        const positions = layoutMarkedCargoIconGrid(outputs.length, sizing);
        const tileMetrics = resolveMarkedCargoAssetTileMetrics(sizing.framePx);
        const iconInsetPx = Math.max(1, Math.round(tileMetrics.framePx * 0.04));
        const iconInnerPx = Math.max(1, tileMetrics.innerPx - iconInsetPx * 2);
        const background = this.getMarkedCargoOverlayBackground();

        for (let index = 0; index < outputs.length; index += 1) {
            const position = positions[index];
            const output = outputs[index];
            if (!position || !output) {
                continue;
            }

            const cell = new PIXI.Container();
            this.bindItemTileHover(cell, output.codename, sizing.framePx, formatFoxholeProductionOverlayOutputLabel(
                output,
                output.completedCycles,
                output.intervalSeconds,
            ), PRODUCTION_OUTPUT_TILE_BORDER_COLOR);
            cell.addChild(this.createMarkedCargoOverlayFrame(
                tileMetrics,
                background,
                PRODUCTION_OUTPUT_TILE_BORDER_COLOR,
            ));

            cell.position.set(position.x, position.y);
            this.productionOutputOverlay.addChild(cell);

            const codename = output.codename;
            if (codename === FOXHOLE_RECIPE_POWER_RESOURCE_ID) {
                cell.addChild(createProductionOutputVectorIcon(NX_BOOTSTRAP_LIGHTNING_SVG, iconInnerPx, 16));
                continue;
            }

            const iconUrl = this.boardDefinition.itemIconUrlResolver?.(codename);
            if (!iconUrl) {
                cell.addChild(createProductionOutputVectorIcon(PRODUCTION_FALLBACK_ICON_SVG, iconInnerPx));
                continue;
            }

            const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
            sprite.anchor.set(0.5);
            sprite.width = iconInnerPx;
            sprite.height = iconInnerPx;
            cell.addChild(sprite);
            const fallbackIcon = createProductionOutputVectorIcon(PRODUCTION_FALLBACK_ICON_SVG, iconInnerPx);
            cell.addChild(fallbackIcon);
            void loadFoxholeTexture(iconUrl).then(texture => {
                if (
                    generation !== this.productionOutputOverlayGeneration
                    || !texture
                    || texture.destroyed
                    || sprite.destroyed
                ) {
                    return;
                }

                sprite.texture = texture;
                const maxDimension = Math.max(texture.width, texture.height, 1);
                sprite.width = (texture.width / maxDimension) * iconInnerPx;
                sprite.height = (texture.height / maxDimension) * iconInnerPx;
                cell.removeChild(fallbackIcon);
                fallbackIcon.destroy();
            });
        }
    }

    private bindItemTileHover(
        cell: PIXI.Container,
        codename: string,
        framePx: number,
        detailLabel: string,
        typeColor: number,
    ): void {
        const asset = this.boardDefinition.itemHoverEntryResolver?.(codename);
        if (!asset) {
            return;
        }
        registerCanvasHoverTarget({
            owner: cell,
            content: {
                kind: 'item-tile',
                name: asset.displayName,
                category: asset.categoryName,
                detailLabel,
                typeColor,
                iconUrl: asset.iconUrl || null,
                previewUrl: asset.previewUrl || null,
            },
            containsScreenPoint: point => {
                if (!cell.parent?.visible || !this.parent || !this.visible || this.destroyed) {
                    return false;
                }
                const local = cell.toLocal(new PIXI.Point(point.x, point.y));
                return Math.abs(local.x) <= framePx / 2 && Math.abs(local.y) <= framePx / 2;
            },
        });
    }

    private syncMarkedCargoOverlayTransform(): void {
        if (!this.markedCargoOverlay.visible && !this.productionOutputOverlay.visible) {
            return;
        }

        const transformOrigin = this.getSelectionTransformOriginLocal() ?? { x: 0, y: 0 };
        const localOffset = resolveFoxholeMarkedCargoOverlayLocalOffset({
            foxholeKey: this.boardState.foxholeKey,
            manifestOverlay: this.getResolvedStructure()?.markedCargoOverlay,
        });
        const localPosition = resolveMarkedCargoOverlayLocalPosition({
            transformOrigin,
            localOffset,
        });

        const hasBoth = this.markedCargoOverlay.visible && this.productionOutputOverlay.visible;
        const cargoCount = this.getMarkedCargoCodenames().length;
        const productionCount = this.getProductionOutputs().length;
        const columns = resolveMarkedCargoOverlayColumnPositions({
            cargoCount,
            cargoSizing: this.resolveMarkedCargoOverlaySizing(cargoCount, hasBoth ? 2 : 1),
            productionCount,
            productionSizing: this.resolveMarkedCargoOverlaySizing(productionCount, hasBoth ? 2 : 1),
        });

        this.markedCargoOverlay.position.set(localPosition.x + columns.cargoX, localPosition.y);
        this.productionOutputOverlay.position.set(localPosition.x + columns.productionX, localPosition.y);
        this.syncMarkedCargoOverlayCounterRotation();
        this.markedCargoOverlay.scale.set(1, 1);
        this.productionOutputOverlay.scale.set(1, 1);
    }

    private syncMarkedCargoOverlay(): void {
        if (!this.markedCargoOverlay) {
            return;
        }

        if (this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.markedCargo) !== true) {
            this.clearMarkedCargoOverlayGraphics();
            this.clearProductionOutputOverlayGraphics();
            return;
        }

        if (this.boardState.destroyed === true || this.boardState.visible === false) {
            this.clearMarkedCargoOverlayGraphics();
            this.clearProductionOutputOverlayGraphics();
            return;
        }

        // Packaged shippables keep stockpile / crate / fuel cargo; inventory-only holds must be empty.
        if (this.isPackagedVisualEnabled()) {
            const holdProfile = this.getResolvedStructure()?.holdProfile ?? null;
            if (!foxholeHoldProfileRetainsCargoWhenPackaged(holdProfile)) {
                this.clearMarkedCargoOverlayGraphics();
            }
            this.clearProductionOutputOverlayGraphics();
            return;
        }

        const cargoCodenames = this.getMarkedCargoCodenames();
        const productionOutputs = this.getProductionOutputs();
        const productionCodenames = productionOutputs.map(output => output.codename);
        if (cargoCodenames.length === 0) {
            this.clearMarkedCargoOverlayGraphics();
        }
        if (productionCodenames.length === 0) {
            this.clearProductionOutputOverlayGraphics();
        }
        if (cargoCodenames.length === 0 && productionCodenames.length === 0) {
            return;
        }

        const hasBoth = cargoCodenames.length > 0 && productionCodenames.length > 0;
        const cargoSizing = this.resolveMarkedCargoOverlaySizing(cargoCodenames.length, hasBoth ? 2 : 1);
        const productionSizing = this.resolveMarkedCargoOverlaySizing(productionCodenames.length, hasBoth ? 2 : 1);
        const assetDimensions = this.getMarkedCargoAssetDimensionsPx();
        const shellTheme = resolveNxTheme(this.settingsStore.getValue(NIXIE_COLOR_THEME_SETTING_ID) as NxThemePreference);
        const cargoCacheKey = [
            cargoCodenames.join('|'),
            cargoSizing.tier,
            cargoSizing.framePx,
            cargoSizing.innerPx,
            cargoSizing.gapPx,
            assetDimensions?.width ?? '',
            assetDimensions?.height ?? '',
            shellTheme,
        ].join('|');
        if (cargoCodenames.length > 0 && this.markedCargoOverlayCacheKey !== cargoCacheKey) {
            this.rebuildMarkedCargoOverlay(cargoCodenames, cargoSizing);
            this.markedCargoOverlayCacheKey = cargoCacheKey;
        }
        const productionCacheKey = [
            productionOutputs.map(output => `${output.channel}:${output.codename}:${output.quantity ?? ''}:${output.completedCycles}:${output.intervalSeconds}`).join('|'),
            productionSizing.tier,
            productionSizing.framePx,
            productionSizing.innerPx,
            productionSizing.gapPx,
            assetDimensions?.width ?? '',
            assetDimensions?.height ?? '',
            shellTheme,
        ].join('|');
        if (productionCodenames.length > 0 && this.productionOutputOverlayCacheKey !== productionCacheKey) {
            this.rebuildProductionOutputOverlay(productionOutputs, productionSizing);
            this.productionOutputOverlayCacheKey = productionCacheKey;
        }

        this.markedCargoOverlay.visible = cargoCodenames.length > 0;
        this.productionOutputOverlay.visible = productionCodenames.length > 0;
        this.syncCargoTileHoverAlpha();
        this.syncMarkedCargoOverlayTransform();
    }

    private syncCargoTileHoverAlpha(): void {
        const faded = this.bunkerCargoHoverFaded
            || shouldHideCargoForStructureHoverPreview(activeNixieStructureModificationHoverPreview.value, String(this.boardId));
        const hoveredTile = canvasHoverPopover.value?.owner;
        for (const overlay of [this.markedCargoOverlay, this.productionOutputOverlay]) {
            for (const tile of overlay?.children ?? []) {
                // Keep a faint tile and its custom hover target while revealing the interior.
                const target = faded && hoveredTile !== tile ? BUNKER_ROOF_HOVER_ALPHA : 1;
                if (this.cargoTileHoverTargets.get(tile) === target) {
                    continue;
                }
                this.cargoTileHoverTargets.set(tile, target);
                const from = tile.alpha;
                const started = performance.now();
                tile.onRender = () => {
                    const progress = Math.min(1, (performance.now() - started) / BUNKER_ROOF_HOVER_FADE_MS);
                    const eased = progress * progress * (3 - 2 * progress);
                    tile.alpha = from + (target - from) * eased;
                    if (progress >= 1) {
                        tile.onRender = undefined;
                    }
                };
            }
        }
    }

    private getRangeOverlayCacheKey(structure: FoxholeManifestStructure): string {
        const nightSettings = FOXHOLE_NIGHT_RANGE_SETTING_IDS.map(id => this.settingsStore.getValue(id));
        return `${this.boardState.foxholeKey}|${this.isLineOfSightEnabled()}|${JSON.stringify(nightSettings)}|${JSON.stringify(structure.ranges)}`;
    }

    private ensureRangeOverlayGraphics(structure: FoxholeManifestStructure): void {
        const nextCacheKey = this.getRangeOverlayCacheKey(structure);
        if (this.rangeOverlayCacheKey === nextCacheKey) {
            return;
        }

        this.clearRangeOverlayGraphics();
        this.rangeOverlayCacheKey = nextCacheKey;

        for (const range of structure.ranges) {
            const entry = createFoxholeStructureRangeVisual(range, this.isLineOfSightEnabled(),
                resolveFoxholeNightVisionRadius(structure, range, id => this.settingsStore.getValue(id)));
            if (!entry) {
                continue;
            }
            entry.visual.visible = false;
            this.rangeOverlay.addChild(entry.visual);
            this.rangeOverlayEntries.push({
                range,
                visual: entry.visual,
                strokeVisual: entry.strokeVisual,
                label: entry.label,
            });
        }
    }

    private syncRangeOverlay(): void {
        if (!this.rangeOverlay) {
            return;
        }

        if (!this.isOperationalStructureEnabled()) {
            this.clearRangeOverlayGraphics();
            return;
        }

        const structure = this.getResolvedStructure();
        if (!structure || structure.ranges.length === 0 || this.boardState.visible === false) {
            this.rangeOverlay.visible = false;
            return;
        }

        this.ensureRangeOverlayGraphics(structure);

        const selected = this.isRangeSelected();
        const settings = this.getRangeSettings();
        const showRangeLabels = this.settingsStore.getValue('nixie.debug.overlay') === true;
        let visibleCount = 0;
        for (const entry of this.rangeOverlayEntries) {
            const visible = isFoxholeRangeVisible(entry.range, settings, selected, {
                isVehicle: structure.isVehicle === true,
            });
            entry.visual.visible = visible;
            if (entry.label) {
                entry.label.visible = visible && showRangeLabels;
            }
            if (visible) {
                visibleCount += 1;
            }
        }

        this.rangeOverlay.visible = visibleCount > 0;
        this.syncStructureRangeOverlayLabelRotations();
        this.syncLineOfSightMask();
    }

    private async ensureTextureLoaded(): Promise<void> {
        if (this.isUsingStructureRenderLayers() && !this.isCompositingBaseTextureWithRenderLayers()) {
            this.spriteObject.texture = PIXI.Texture.EMPTY;
            return;
        }

        const textureKey = this.getResolvedTextureKey();
        const directTextureUrl = this.getResolvedDirectTextureUrl();
        if (!textureKey && !directTextureUrl) {
            return;
        }

        const texture = textureKey
            ? this.boardDefinition.textureResolver?.(textureKey)
            : null;
        if (texture && !texture.destroyed) {
            if (this.spriteObject.texture !== texture) {
                this.spriteObject.texture = texture;
                this.applyResolvedSpriteVisualState(false);
            }
            return;
        }

        const textureUrl = directTextureUrl ?? (textureKey ? this.getResolvedTextureUrl(textureKey) : null);
        if (!textureUrl) {
            return;
        }

        const loadedTexture = await loadFoxholeTexture(textureUrl);
        if (!loadedTexture || loadedTexture.destroyed) {
            return;
        }

        if (this.spriteObject.destroyed) {
            return;
        }

        if (this.getResolvedTextureKey() !== textureKey || this.getResolvedDirectTextureUrl() !== directTextureUrl) {
            return;
        }

        if (this.spriteObject.texture !== loadedTexture) {
            this.spriteObject.texture = loadedTexture;
            this.applyResolvedSpriteVisualState(false);
        }
    }

    override syncSpriteFromState(): void {
        const state = this.boardState;
        const textureKey = this.getResolvedTextureKey();
        const directTextureUrl = this.getResolvedDirectTextureUrl();
        const overlaysReady = this.hasInitializedStructureOverlays();
        const useRenderLayers = overlaysReady && this.isUsingStructureRenderLayers();
        const useBaseTexture = !useRenderLayers || this.isCompositingBaseTextureWithRenderLayers();
        let resolvedTexture: PIXI.Texture | null = null;

        if (useBaseTexture && textureKey && this.boardDefinition.textureResolver) {
            const texture = this.boardDefinition.textureResolver(textureKey);
            if (texture && !texture.destroyed && this.spriteObject.texture !== texture) {
                this.spriteObject.texture = texture;
                resolvedTexture = texture;
            }
            if (texture && !texture.destroyed) {
                resolvedTexture = texture;
            }
        }

        if (useBaseTexture && directTextureUrl) {
            const texture = getCachedTexture(directTextureUrl);
            if (texture && !texture.destroyed && this.spriteObject.texture !== texture) {
                this.spriteObject.texture = texture;
                resolvedTexture = texture;
            }
            if (texture && !texture.destroyed) {
                resolvedTexture = texture;
            }
        }

        const shouldDeferSpriteVisualUpdate = Boolean(
            useBaseTexture
            && directTextureUrl
            && !resolvedTexture
            && this.spriteObject.texture !== PIXI.Texture.EMPTY,
        );

        if (useBaseTexture && !resolvedTexture && (textureKey || directTextureUrl)) {
            void this.ensureTextureLoaded();
        }

        if ((!textureKey && !directTextureUrl) || !useBaseTexture) {
            this.spriteObject.texture = PIXI.Texture.EMPTY;
        }

        if (!shouldDeferSpriteVisualUpdate) {
            this.applyResolvedSpriteVisualState(!useBaseTexture);
        }

        applyTransform(this as unknown as PIXI.Container, state);
        if (overlaysReady && (this.markedCargoOverlay.visible || this.productionOutputOverlay.visible)) {
            this.syncMarkedCargoOverlayTransform();
        }
        if (!overlaysReady) {
            return;
        }

        this.trackContactShadow(this.spriteObject, useBaseTexture
            ? String(directTextureUrl ?? (textureKey ? this.getResolvedTextureUrl(textureKey) : '') ?? '')
            : '');
        this.syncPackagedPalletOverlay();
        this.syncStructureRenderLayers();
        this.syncModificationOverlay();
        this.syncBlueprintVisualState();
        this.syncHitboxOverlay();
        this.syncRangeOverlay();
        this.syncMarkedCargoOverlay();
    }
}
