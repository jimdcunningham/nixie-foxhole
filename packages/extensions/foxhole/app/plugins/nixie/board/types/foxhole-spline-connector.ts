import { canFoxholeSocketConnectionOpenWalls } from '#foxhole/plugins/foxhole/nixie/socket-wall-visibility.ts';
import { resolveFoxholeSplineConnectorSockets, populateFoxholeSplineConnectorSocketOverlay } from '#foxhole/plugins/foxhole/nixie/spline-connector-sockets.ts';
import type { FoxholeSplineConnectorResolvedSocket } from '#foxhole/plugins/foxhole/nixie/spline-connector-sockets.ts';
import { resolveFoxholeSplineDeleteMutation } from '#foxhole/plugins/foxhole/nixie/spline-connector-delete.ts';
import { FOXHOLE_POWERLINE_CORE_WIDTH as POWERLINE_CORE_WIDTH, isFoxholePowerlineOverLength, resolveFoxholePowerlineStroke } from '#foxhole/plugins/foxhole/nixie/powerline-stroke.ts';
import { advancePowerlineMotionFrame, createPowerlineMotion, powerlinePathPoints, rebasePowerlineMotion, resetPowerlineMotion } from '#foxhole/plugins/foxhole/nixie/powerline-motion.ts';
import type { PowerlinePoint } from '#foxhole/plugins/foxhole/nixie/powerline-motion.ts';
import { resolveNixieSceneWind } from '#nixie/utils/nixie-scene-settings.ts';
import type { NixieSceneEnvironment } from '#nixie/utils/nixie-scene-settings.ts';
import { resolveFoxholeSplinePathConstraints, resolveFoxholeSplineGuidePath, drawFoxholeSplinePathGuide, drawFoxholeSplineEndpointGizmo } from '#foxhole/plugins/foxhole/nixie/spline-connector-guides.ts';
import { getFoxholeSplineLocalEditableHandles } from '#foxhole/plugins/foxhole/nixie/spline-connector-handles.ts';
import { isReferenceRoadSplineKey, isWorldRoadEditCandidateValid } from '#foxhole/plugins/foxhole/nixie/world-road-edit-validity.ts';
import { resolveTrenchSharedRotation } from '#foxhole/plugins/foxhole/nixie/trench-shared-rotation.ts';
import { resolveFoxholeSplinePlacementPreview, resolveMinimumLengthPreviewEnd, resolvePlacementEndPositionAlongAxis, resolveFoxholeSplineEndpointSocketSnap } from '#foxhole/plugins/foxhole/nixie/spline-connector-placement.ts';
import * as PIXI from 'pixi.js';
import { resolveConnectorBehavior } from '../../../../../../../../extensions/foxhole-planner/src/connector-behavior.ts';
import { resolveIntervalMarkerVariantIds } from '../../../../../../../../extensions/foxhole-planner/src/interval-marker-variants.ts';
import { isBarbedWireFence, resolveBarbedWireFencePosts } from '../../../../../../../../extensions/foxhole-planner/src/barbed-wire-fence.ts';
import { isWaterWallSpline, resolveWaterWallBuoys, resolveWaterWallNetInsets } from '../../../../../../../../extensions/foxhole-planner/src/water-wall-spline.ts';
import { isTrenchConnector, trenchConnectorTier, isTrenchConnectorBuildSite, isTrenchConnectorViable, trenchConnectorCorners } from '#foxhole/plugins/foxhole/nixie/trench-connector.ts';
import { TrenchConnectorVisual } from '#foxhole/plugins/foxhole/nixie/trench-connector-visual.ts';
import { invalidateFoxholeRoofHoverNetwork, markFoxholeStructureOverlaysDirtyByIds, registerFoxholeRoofHoverHost, unregisterFoxholeRoofHoverHost } from '#foxhole/plugins/foxhole/nixie/structure-overlay-sync.ts';
import { resolveTrenchConnectorModifications } from '#foxhole/plugins/foxhole/nixie/trench-connector-modifications.ts';
import { updateTrenchBuildSiteMesh } from '#foxhole/plugins/foxhole/nixie/trench-connector-mesh.ts';
import { watch } from 'vue';
import type { WatchStopHandle } from 'vue';
import BoardNodeBase from '#nixie/plugins/nixie/board/types/node.ts';
import type {
    BoardNodeDeleteCommitContext,
    BoardNodeEditableHandle,
    BoardNodeEditableHandleContext,
    BoardNodeEditableHandleProvider,
    BoardNodeEditableMutation,
    BoardNodeMoveCommitContext,
    BoardNodeMoveSnapProvider,
    BoardNodeMoveSnapResult,
    BoardNodeOptions,
    BoardNodePlacementProvider,
    BoardNodePlacementSessionContext,
    BoardNodeSelectionBounds,
    BoardNodeSelectionBoundsProvider,
    BoardNodeSelectionFrameAngleProvider,
    BoardNodeSceneEnvironmentVisual,
    BoardNodeSelectionLocalQuad,
    BoardNodeSelectionQuadProvider,
    BoardNodeSelectionTransformOriginProvider,
    BoardNodeWorldHitTester,
    BoardRenderParticipant,
} from '#nixie/plugins/nixie/board/types/node.ts';
import { applyTransform } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import { BoardSpriteNode } from '#nixie/plugins/nixie/board/types/primitives/index.ts';
import { rotatePointAroundPivot } from '#nixie/plugins/nixie/board/utils/transform-geometry.ts';
import { isBoardNodeMoveSnapStationaryCandidate } from '#nixie/plugins/nixie/board/utils/move-snap-targets.ts';
import {
    getCachedBoardUrlTexture as getCachedTexture,
    loadBoardUrlTexture as loadFoxholeTexture,
} from '#nixie/plugins/nixie/board/utils/url-texture.ts';
import {
    clampDraggedSplineEndpoint,
    distanceToSplinePath,
} from '#nixie/plugins/nixie/board/utils/spline-path.ts';
import { isSplinePathViable, SPLINE_PATH_INVALID_TINT } from '#nixie/plugins/nixie/board/utils/spline-path-viability.ts';
import { subscribeToNixieSelectionState, activeNixieViewport, activeNixieStructureModificationHoverPreview } from '#nixie/plugins/nixie/runtime/shared-state.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import {
    resolveCanvasToolAccentColorPair,
    subscribeToCanvasToolAccentColor,
} from '#nixie/utils/nx-canvas-tool-color.ts';
import {
    buildSplineRibbonMeshGeometry,
    configureSpanRibbonTexture,
    resolveConnectorSplineTextureSlicing,
} from '#foxhole/plugins/foxhole/nixie/spline-ribbon-mesh.ts';
import { hasSplineContactShadow, resolveSplineContactShadowPath } from '#foxhole/plugins/foxhole/nixie/spline-contact-shadow.ts';
import {
    allowsConnectorRotationHandles,
    resolveConnectorHitRadius,
    resolveConnectorPathStyle,
    resolveEffectiveConnectorPathStyle,
    resolveConnectorSpanInsets,
    resolveConnectorSpanTextureMapping,
    resolveConnectorTrimPositions,
    resolveConnectorRampSpriteAnchor,
    resolveFacilityPipeSideSocketPlacements,
    resolveConnectorSpanCrossHalfWidth,
    resolveConnectorTrimSpriteAnchor,
    resolveLandWallLayerMeshConfig,
    resolveStraightConnectorEndpointRotations,
    sampleConnectorPath,
    shouldRenderConnectorSpan,
    isConnectorEndpointHit,
    usesConnectorEndpointOnlyHitTesting,
    usesIntervalMarkerSpan,
    usesLayeredLandWallConnector,
    usesStraightChordPath,
} from '#foxhole/plugins/foxhole/nixie/pipe-connector-path.ts';
import {
    resolveCenteredMeshConfigIntervalBoundarySamples,
    resolveIntervalMarkerSamples,
    resolveMeshConfigIntervalMarkerSamples,
    resolveIntervalMarkerSpritePosition,
    resolveMineSplineMarkerSample,
    INTERVAL_MARKER_SPRITE_ANCHOR,
} from '#foxhole/plugins/foxhole/nixie/interval-connector-path.ts';
import {
    isExtensionPipeGeometryViable,
    usesPipeExtensionPath,
} from '#foxhole/plugins/foxhole/nixie/pipe-extension-path.ts';
import {
    adjustPipeCurveT,
    resolvePipeRotationSnapStepRad,
    usesPipeCurveScale,
} from '#foxhole/plugins/foxhole/nixie/pipe-spline-constraints.ts';
import {
    buildFoxholeConnectorTargetAttachmentsFromEndpoints,
    isFoxholePowerSocketConnectionAvailable,
    reconcileFoxholeConnectorAttachments,
    resolveHoveredFoxholePowerSocketTarget,
    resolveFoxholeConnectorEndpointAttachmentsFromTargets,
    resolveFoxholeConnectorEndpointSockets,
    resolveFoxholePowerlineSelectionQuad,
    resolveFoxholeSplinePowerlineGeometry,
    resolveFoxholeSplinePowerlineWorldEndpoint,
    shouldLockFoxholeConnectorEndpointToSocketAxis,

} from '#foxhole/plugins/foxhole/nixie/connector.ts';
import type { FoxholeConnectorEndpointAttachment, FoxholePowerSocketConnection } from '#foxhole/plugins/foxhole/nixie/connector.ts';
import { FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS } from '#foxhole/plugins/foxhole/nixie/structure-debug-settings.ts';
import {
    DEFAULT_FOXHOLE_SOCKET_ROTATION_SNAP_DEGREES,
    DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
    FOXHOLE_SOCKET_SNAPPING_SETTING_ID,
    findBestFoxholeSocketSnap,
    hasFoxholePowerSocketTag,
    hasFoxholeSnapSocketTags,
    unwrapAngleNearReference,
} from '#foxhole/plugins/foxhole/nixie/structure-socket-snapping.ts';
import type { FoxholeSocketSnapPoint } from '#foxhole/plugins/foxhole/nixie/structure-socket-snapping.ts';
import {
    areFoxholeSnapSocketsAvailableForAttachment,
    normalizeFoxholeStructureSocketAttachmentMap,
} from '#foxhole/plugins/foxhole/nixie/types.ts';
import type { FoxholeStructureSocketAttachmentMap } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { FoxholeStructureNode } from './foxhole-structure.ts';
import type { Viewport } from 'pixi-viewport';
import {
    DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE,
    FOXHOLE_BOARD_SPRITE_SCALE,
    FOXHOLE_SPLINE_CONNECTOR_ROTATION_SNAP_STEP_RAD,
    getFoxholeSplineConnectorConstraints,
    normalizeFoxholeSplineConnectorState,
    normalizeSplineRotationRadians,
    isPowerlineConnector,
    isUndergroundPipe,
    resolveDefaultEndRotation,
    shouldRenderConnectorEndCapLayers,
    shouldTintInvalidSplinePath,
    shouldSynchronizeStraightConnectorEndpointRotations,
    usesMineSplineConnector,
    usesRailTrackSpline,
    usesSocketFacingEndRotation,
    usesSplineConnectorSocketSnapping,
    worldRotationToEndpointLocal,
    resolveConnectorSocketSnapStemRotation,
} from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import { materializeFoxholeAppearancePatchDefaults } from '#foxhole/plugins/foxhole/nixie/appearance-state.ts';
import { FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE, resolveFoxholeConnectorRenderLane } from '#foxhole/plugins/foxhole/nixie/render-lanes.ts';
import type { FoxholeStructureAsset, FoxholeStructureRenderLayerAsset } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeSplineConnectorRenderLayers, resolveFoxholeSplineConnectorUpgradeHoverPreviewAlpha } from '#foxhole/plugins/foxhole/nixie/spline-connector-upgrade-layers.ts';
import { resolveStructureAssetHoverTargetKey } from '#foxhole/plugins/foxhole/nixie/structure-modification-hover-preview.ts';

import type { FoxholeSplineConnectorEndpoint, FoxholeSplineConnectorState } from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';

const FOXHOLE_SPLINE_CONNECTOR_DEBUG_OVERLAY_SETTING_IDS = [
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels,
] as const;

interface FoxholeSplineConnectorDebugOverlaySettings {
    showAllSockets: boolean;
    showPowerSockets: boolean;
    showPipeSockets: boolean;
    showSocketLabels: boolean;
}

const GIZMO_STEM_LENGTH = 36;
const GIZMO_STEM_COLOR = 0x8BE9FF;
const GIZMO_HANDLE_COLOR = 0xD8F7FF;
const GIZMO_PATH_GUIDE_COLOR = 0x8BE9FF;
const SPLINE_CONNECTOR_VALID_TINT = 0xFFFFFF;
const BLUEPRINT_SPLINE_CONNECTOR_TINT = 0x335CFF;

const blueprintSplineConnectorFiltersByTarget = new WeakMap<PIXI.Container, PIXI.Filter[]>();
const brightnessSplineConnectorFiltersByTarget = new WeakMap<PIXI.Container, { brightness: number; filters: PIXI.Filter[]; }>();

function createBlueprintSplineConnectorFilter(): PIXI.ColorMatrixFilter {
    const filter = new PIXI.ColorMatrixFilter();
    filter.brightness(2.15);
    return filter;
}

function createBrightnessSplineConnectorFilter(brightness: number): PIXI.ColorMatrixFilter {
    const filter = new PIXI.ColorMatrixFilter();
    filter.brightness(brightness);
    return filter;
}

function getBlueprintSplineConnectorFiltersForTarget(target: PIXI.Container): PIXI.Filter[] {
    const existing = blueprintSplineConnectorFiltersByTarget.get(target);
    if (existing) {
        return existing;
    }

    const filters = [createBlueprintSplineConnectorFilter()];
    blueprintSplineConnectorFiltersByTarget.set(target, filters);
    return filters;
}

function getBrightnessSplineConnectorFiltersForTarget(target: PIXI.Container, brightness: number): PIXI.Filter[] {
    const existing = brightnessSplineConnectorFiltersByTarget.get(target);
    if (existing && existing.brightness === brightness) {
        return existing.filters;
    }

    const filters = [createBrightnessSplineConnectorFilter(brightness)];
    brightnessSplineConnectorFiltersByTarget.set(target, { brightness, filters });
    return filters;
}

interface FoxholeSplineConnectorDefinition {
    assetResolver?: (foxholeKey: string) => FoxholeStructureAsset | undefined;
    structureResolver?: (foxholeKey: string) => import('#foxhole/plugins/foxhole/nixie/manifest.ts').FoxholeManifestStructure | undefined;
}

interface FoxholeSplineConnectorSnapTarget {
    nodeId: string;
    node: FoxholeStructureNode | FoxholeSplineConnectorNode;
    sockets: FoxholeSocketSnapPoint[];
    attachments: FoxholeStructureSocketAttachmentMap;
}

interface FoxholeSplineConnectorSocketMoveSnapData {
    kind: 'foxhole:spline-connector-socket-snap';
    match: ReturnType<typeof findBestFoxholeSocketSnap>;
}

interface FoxholeSplineConnectorTargetStructureSnapshot {
    nodeId: string;
    node: FoxholeStructureNode | FoxholeSplineConnectorNode;
    sockets: FoxholeSocketSnapPoint[];
    attachments: FoxholeStructureSocketAttachmentMap;
}

interface SplineConnectorEditableSession {
    sharedTrenchRotation?: { nodeId: string; role: 'start' | 'end'; initial: FoxholeSplineConnectorEndpoint; };
    handleId: string;
    initialStart: FoxholeSplineConnectorEndpoint;
    initialEnd: FoxholeSplineConnectorEndpoint;
    initialX: number;
    initialY: number;
    initialStartAttachment?: FoxholeConnectorEndpointAttachment;
    initialEndAttachment?: FoxholeConnectorEndpointAttachment;
    initialSocketAttachments: FoxholeStructureSocketAttachmentMap;
    previewStartAttachment?: FoxholeConnectorEndpointAttachment;
    previewEndAttachment?: FoxholeConnectorEndpointAttachment;
    previewSocketAttachments?: FoxholeStructureSocketAttachmentMap;
    previewTargetAttachmentsByNode?: Map<string, FoxholeStructureSocketAttachmentMap>;
    previewTargets?: FoxholeSplineConnectorSnapTarget[];
    initialTargetAttachmentsByNode?: Map<string, FoxholeStructureSocketAttachmentMap>;
}

interface SplineConnectorMoveAttachmentPreview {
    initialStartAttachment?: FoxholeConnectorEndpointAttachment;
    initialEndAttachment?: FoxholeConnectorEndpointAttachment;
    initialSocketAttachments: FoxholeStructureSocketAttachmentMap;
    initialTargetAttachmentsByNode: Map<string, FoxholeStructureSocketAttachmentMap>;
    previewTargets: FoxholeSplineConnectorSnapTarget[];
}

interface SplineConnectorPlacementSession {
    phase: 'pick-start' | 'pick-end';
    removeOnCancel: boolean;
    initialX: number;
    initialY: number;
    initialStart: FoxholeSplineConnectorEndpoint;
    initialEnd: FoxholeSplineConnectorEndpoint;
    initialStartAttachment?: FoxholeConnectorEndpointAttachment;
    initialEndAttachment?: FoxholeConnectorEndpointAttachment;
    previewStartAttachment?: FoxholeConnectorEndpointAttachment;
    previewEndAttachment?: FoxholeConnectorEndpointAttachment;
    previewTargetAttachmentsByNode?: Map<string, FoxholeStructureSocketAttachmentMap>;
    previewTargets?: FoxholeSplineConnectorSnapTarget[];
    initialTargetAttachmentsByNode?: Map<string, FoxholeStructureSocketAttachmentMap>;
    lockedStartPosition?: FoxholeSplineConnectorEndpoint;
    lockedEndPosition?: FoxholeSplineConnectorEndpoint;
    manualStartRotation?: boolean;
    manualEndRotation?: boolean;
}

function resolveEndpointRotationFromSocketPoint(
    socketPoint: FoxholeSocketSnapPoint,
    endpointRole: 'start' | 'end',
    nodeRotation: number,
): number {
    const tangentWorld = endpointRole === 'start'
        ? socketPoint.rotation
        : normalizeSplineRotationRadians(socketPoint.rotation - Math.PI);
    return worldRotationToEndpointLocal(tangentWorld, nodeRotation);
}

function cloneEndpoint(endpoint: FoxholeSplineConnectorEndpoint): FoxholeSplineConnectorEndpoint {
    return {
        x: endpoint.x,
        y: endpoint.y,
        rotation: endpoint.rotation,
        ...(endpoint.handleLength !== undefined ? { handleLength: endpoint.handleLength } : {}),
    };
}

function getNodeRotation(node: BoardNodeBase<FoxholeSplineConnectorState>): number {
    return Number(node.rotation ?? 0);
}

function toSplineEndpointWorldPoint(
    node: BoardNodeBase<FoxholeSplineConnectorState>,
    endpoint: FoxholeSplineConnectorEndpoint,
    viewport: Viewport,
    originOverride?: { x: number; y: number; } | null,
    rotationOverride?: number | null,
): PIXI.Point {
    if (!originOverride) {
        return toBoardWorldPoint(node, new PIXI.Point(endpoint.x, endpoint.y), viewport);
    }

    const rotation = Number.isFinite(rotationOverride) ? Number(rotationOverride) : getNodeRotation(node);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return new PIXI.Point(
        originOverride.x + ((endpoint.x * cos) - (endpoint.y * sin)),
        originOverride.y + ((endpoint.x * sin) + (endpoint.y * cos)),
    );
}

function toBoardWorldPoint(
    node: BoardNodeBase<FoxholeSplineConnectorState>,
    localPoint: PIXI.Point,
    viewport: Viewport,
): PIXI.Point {
    return viewport.toLocal(node.toGlobal(localPoint));
}

function snapWorldRotation(
    rotation: number,
    enabled: boolean,
    snapStepRad = FOXHOLE_SPLINE_CONNECTOR_ROTATION_SNAP_STEP_RAD,
): number {
    if (!enabled) {
        return normalizeSplineRotationRadians(rotation);
    }

    return normalizeSplineRotationRadians(
        Math.round(rotation / snapStepRad) * snapStepRad,
    );
}

function resolvePlacementStartPositionAlongAxis(
    end: FoxholeSplineConnectorEndpoint,
    cursor: { x: number; y: number; },
    constraints: ReturnType<typeof getFoxholeSplineConnectorConstraints>,
    foxholeKey: string,
): { x: number; y: number; } {
    // Socket-facing ends point outward; into-span (end → start) is along end.rotation.
    // Non-socket-facing ends point along the chord; into-span is the opposite.
    const intoSpanFromEnd = usesSocketFacingEndRotation(foxholeKey)
        ? end.rotation
        : normalizeSplineRotationRadians(end.rotation + Math.PI);
    const minLength = Math.max(1, constraints.minLength ?? 1);
    const maxLength = Math.max(minLength, constraints.maxLength ?? minLength);
    const dx = cursor.x - end.x;
    const dy = cursor.y - end.y;
    const projected = (dx * Math.cos(intoSpanFromEnd)) + (dy * Math.sin(intoSpanFromEnd));
    const length = Math.min(maxLength, Math.max(minLength, projected));
    return {
        x: end.x + (Math.cos(intoSpanFromEnd) * length),
        y: end.y + (Math.sin(intoSpanFromEnd) * length),
    };
}

function resolveRotationFromWorldPointer(
    node: BoardNodeBase<FoxholeSplineConnectorState>,
    endpoint: FoxholeSplineConnectorEndpoint,
    pointerWorld: PIXI.Point,
    context: BoardNodeEditableHandleContext,
    endpointRole: 'start' | 'end',
    pathStyle?: string,
): number {
    const endpointWorld = toBoardWorldPoint(
        node,
        new PIXI.Point(endpoint.x, endpoint.y),
        context.viewport,
    );
    const snapStep = resolvePipeRotationSnapStepRad(
        String(node.boardState.foxholeKey ?? ''),
        pathStyle,
        FOXHOLE_SPLINE_CONNECTOR_ROTATION_SNAP_STEP_RAD,
    );
    const worldRotation = snapWorldRotation(Math.atan2(
        pointerWorld.y - endpointWorld.y,
        pointerWorld.x - endpointWorld.x,
    ), context.snapRotation === true, snapStep);
    const localRotation = worldRotationToEndpointLocal(worldRotation, getNodeRotation(node));
    if (endpointRole === 'end' && !usesSocketFacingEndRotation(node.boardState.foxholeKey)) {
        return normalizeSplineRotationRadians(localRotation + Math.PI);
    }

    return localRotation;
}

function getLayerById(layers: readonly FoxholeStructureRenderLayerAsset[], id: string): FoxholeStructureRenderLayerAsset | undefined {
    const normalizedId = id.trim().toLowerCase();
    return layers.find(layer => String(layer.id ?? '').trim().toLowerCase() === normalizedId);
}

function getConnectorEndCapLayer(
    layers: readonly FoxholeStructureRenderLayerAsset[],
    role: 'back' | 'front',
    foxholeKey: string,
): FoxholeStructureRenderLayerAsset | undefined {
    if (!shouldRenderConnectorEndCapLayers(foxholeKey)) {
        return undefined;
    }

    if (role === 'back') {
        return getLayerById(layers, 'backtrim') ?? getLayerById(layers, 'backswitch');
    }

    return getLayerById(layers, 'fronttrim') ?? getLayerById(layers, 'frontswitch');
}

export class FoxholeSplineConnectorNode extends BoardNodeBase<FoxholeSplineConnectorState> implements
    BoardNodeEditableHandleProvider,
    BoardNodePlacementProvider,
    BoardNodeSelectionBoundsProvider,
    BoardNodeSelectionQuadProvider,
    BoardNodeSelectionFrameAngleProvider,
    BoardNodeSelectionTransformOriginProvider,
    BoardNodeWorldHitTester,
    BoardNodeMoveSnapProvider,
    BoardNodeSceneEnvironmentVisual {
    declare readonly boardDefinition: Readonly<FoxholeSplineConnectorDefinition>;

    readonly contactShadowGraphics: PIXI.Graphics;
    readonly underlayOverlay: PIXI.Container;
    readonly spanOverlay: PIXI.Container;
    readonly wallMiddlePillarOverlay: PIXI.Container;
    readonly wallBarbedWireOverlay: PIXI.Container;
    readonly trimOverlay: PIXI.Container;
    readonly handleTrimOverlay: PIXI.Container;
    readonly pathGuideGraphics: PIXI.Graphics;
    readonly powerlineGraphics: PIXI.Graphics;
    readonly gizmoGraphics: PIXI.Graphics;
    readonly socketOverlay: PIXI.Container;
    private readonly settingsStore = useNixieSettingsStore();
    private settingsWatcher: WatchStopHandle | null = null;
    private underlayMesh: PIXI.Mesh | null = null;
    private spanMesh: PIXI.Mesh | null = null;
    private spanMeshIsTrenchBuildSite = false;
    private trenchVisual: TrenchConnectorVisual | null = null;
    private wallBarbedWireMesh: PIXI.Mesh | null = null;
    private selectionStateWatcher: (() => void) | null = null;
    private canvasToolColorWatcher: (() => void) | null = null;
    private activePlacementPhase: 'pick-start' | 'pick-end' | null = null;
    private isSelected = false;
    private textureSyncGeneration = 0;
    private readonly mineMarkerRotationSeed = Math.floor(Math.random() * 0x1_0000_0000);
    private modificationHoverPreviewWatcher: WatchStopHandle | null = null;
    private roofHoverAlpha = 1;
    private overlaySyncFoxholeKey: string | null = null;
    private roofHoverFade: { from: number; to: number; elapsedMs: number } | null = null;
    private moveAttachmentPreview: SplineConnectorMoveAttachmentPreview | null = null;
    private readonly powerlineMotion = createPowerlineMotion();
    private powerlineDrawnParticles: PowerlinePoint[] = [];
    private readonly powerlineWindPhase: number;
    private renderedPowerlineStart: PowerlinePoint | null = null;
    private renderedPowerlineEnd: PowerlinePoint | null = null;
    private renderedPowerlineAlpha = 1;
    private attachedStructurePreviewActive = false;

    constructor(options: BoardNodeOptions<FoxholeSplineConnectorState, FoxholeSplineConnectorDefinition>) {
        super({
            ...options,
            definition: options.definition ?? {},
            state: normalizeFoxholeSplineConnectorState({
                ...DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE,
                ...(options.state ?? {}),
            }),
        });

        this.powerlineWindPhase = [...String(this.boardId)].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % 628 / 100;

        this.contactShadowGraphics = new PIXI.Graphics();
        this.contactShadowGraphics.eventMode = 'none';
        this.addBoardVisualChild(this.contactShadowGraphics);

        this.underlayOverlay = new PIXI.Container();
        this.underlayOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.underlayOverlay);

        this.spanOverlay = new PIXI.Container();
        this.spanOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.spanOverlay);

        this.wallMiddlePillarOverlay = new PIXI.Container();
        this.wallMiddlePillarOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.wallMiddlePillarOverlay);

        this.wallBarbedWireOverlay = new PIXI.Container();
        this.wallBarbedWireOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.wallBarbedWireOverlay);

        this.trimOverlay = new PIXI.Container();
        this.trimOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.trimOverlay);

        this.handleTrimOverlay = new PIXI.Container();
        this.handleTrimOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.handleTrimOverlay);

        this.pathGuideGraphics = new PIXI.Graphics();
        this.pathGuideGraphics.eventMode = 'none';
        this.addBoardVisualChild(this.pathGuideGraphics);

        this.powerlineGraphics = new PIXI.Graphics();
        this.powerlineGraphics.eventMode = 'none';
        this.addBoardVisualChild(this.powerlineGraphics);

        this.gizmoGraphics = new PIXI.Graphics();
        this.gizmoGraphics.eventMode = 'none';
        this.addBoardVisualChild(this.gizmoGraphics);

        this.socketOverlay = new PIXI.Container();
        this.socketOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.socketOverlay);

        this.bindSelectionState();
        this.syncFromState();
    }

    protected override onBoardMounted(): void {
        this.bindCanvasToolColorWatcher();
        this.bindDebugOverlaySettings();
        this.bindModificationHoverPreviewWatcher();
        this.overlaySyncFoxholeKey = this.boardState.foxholeKey;
        if (isTrenchConnector(this.boardState.foxholeKey)) {
            registerFoxholeRoofHoverHost(this);
        }
    }

    getBunkerRoofHoverNetworkNode() {
        const structure = this.getResolvedStructure();
        if (!structure || this.boardState.visible === false || trenchConnectorTier(this.boardState.foxholeKey) !== 3) {
            return null;
        }
        return { nodeId: String(this.boardId), foxholeKey: this.boardState.foxholeKey,
            codeName: structure.codeName, profileType: 'Trench', buildSockets: structure.buildSockets,
            socketAttachments: this.getEndpointOccupancyAttachments() };
    }

    setBunkerRoofHoverFaded(faded: boolean, immediate = false): boolean {
        const alpha = faded ? 0.25 : 1;
        if (immediate) {
            this.roofHoverFade = null;
            this.roofHoverAlpha = alpha;
            this.trenchVisual?.setRoofHoverAlpha(alpha);
            return false;
        }
        if ((this.roofHoverFade?.to ?? this.roofHoverAlpha) === alpha) {
            return this.roofHoverFade !== null;
        }
        this.roofHoverFade = { from: this.roofHoverAlpha, to: alpha, elapsedMs: 0 };
        return true;
    }

    advanceBunkerRoofHoverFade(deltaMs: number): boolean {
        const fade = this.roofHoverFade;
        if (!fade) {
            return false;
        }
        fade.elapsedMs = Math.min(110, fade.elapsedMs + Math.max(0, deltaMs));
        const progress = fade.elapsedMs / 110;
        const eased = progress * progress * (3 - 2 * progress);
        this.roofHoverAlpha = fade.from + (fade.to - fade.from) * eased;
        this.trenchVisual?.setRoofHoverAlpha(this.roofHoverAlpha);
        if (progress >= 1) {
            this.roofHoverFade = null;
        }
        return this.roofHoverFade !== null;
    }

    override patchBoardState(patch: Parameters<BoardNodeBase<FoxholeSplineConnectorState>['patchBoardState']>[0], options = {}): void {
        if (typeof patch === 'function') {
            super.patchBoardState(patch, options);
            return;
        }

        const partial = materializeFoxholeAppearancePatchDefaults(
            patch as Record<string, unknown>,
        ) as Partial<FoxholeSplineConnectorState>;
        super.patchBoardState(draft => {
            if (partial.start) {
                Object.assign(draft.start, partial.start);
            }
            if (partial.end) {
                Object.assign(draft.end, partial.end);
            }

            for (const [key, value] of Object.entries(partial)) {
                if (key === 'start' || key === 'end' || value === undefined) {
                    continue;
                }
                (draft as Record<string, unknown>)[key] = value;
            }
        }, options);
    }

    override replaceBoardState(nextState: FoxholeSplineConnectorState, options = {}): void {
        super.replaceBoardState(normalizeFoxholeSplineConnectorState(nextState), options);
    }

    override getBoardRenderParticipants(): BoardRenderParticipant[] {
        const lane = resolveFoxholeConnectorRenderLane(this.boardState.foxholeKey, FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE);
        const participants: BoardRenderParticipant[] = [];
        if (hasSplineContactShadow(this.boardState.foxholeKey)) {
            participants.push({
                id: 'spline-contact-shadow',
                displayObject: this.contactShadowGraphics,
                scope: 'shared-lane',
                laneId: `${lane.laneId}:shadow`,
                laneOrder: lane.laneOrder - 1,
                localOrder: this.getBoardRenderLocalOrder(),
                tieBreakOrder: 0,
            });
        }
        participants.push({
            id: 'default',
            displayObject: this.boardVisual,
            scope: 'shared-lane',
            laneId: lane.laneId,
            laneOrder: lane.laneOrder,
            localOrder: this.getBoardRenderLocalOrder(),
            tieBreakOrder: 0,
        });
        // Corner details must clear walls belonging to neighboring trenches too,
        // which cannot be achieved by ordering children inside this connector.
        for (const [index, piece] of (this.trenchVisual?.getElevatedRenderPieces() ?? []).entries()) {
            participants.push({ id: `trench:${piece.id}`, displayObject: piece.mesh, scope: 'shared-lane',
                laneId: piece.lane.laneId, laneOrder: piece.lane.laneOrder,
                localOrder: this.getBoardRenderLocalOrder(), tieBreakOrder: index + 1 });
        }
        return participants;
    }

    override onBoardStateChanged(reason: string, _source: 'local' | 'remote'): void {
        if (this.overlaySyncFoxholeKey !== this.boardState.foxholeKey) {
            this.overlaySyncFoxholeKey = this.boardState.foxholeKey;
            this.refreshAttachedStructureOverlays();
        }
        if (isTrenchConnector(this.boardState.foxholeKey)) {
            invalidateFoxholeRoofHoverNetwork();
        }
        // Attachment occupancy previews must update endpoint ramps and socket
        // indicators without applying the persisted transform over a transient
        // move/snap pose mid-drag.
        if (reason.includes('attachment-preview') || reason.includes('attachment-revert')) {
            this.syncRampOverlayFromState();
            if (this.trenchVisual) {
                const occupancy = this.getWallVisibilityAttachments();
                this.trenchVisual.syncOccupancy(
                    Boolean(occupancy[String(this.boardState.startSocketName ?? '')]),
                    Boolean(occupancy[String(this.boardState.endSocketName ?? '')]),
                );
            }
            this.syncSocketOverlay(this.boardState, this.getResolvedUpgradeHoverPreviewAlpha());
            return;
        }

        this.syncFromState();
    }

    refreshAttachedPowerlinePreview(
        attachedStart?: PowerlinePoint & { rotation?: number; },
        attachedEnd?: PowerlinePoint & { rotation?: number; },
    ): void {
        if (this.destroyed || !isPowerlineConnector(this.boardState.foxholeKey)) {
            return;
        }
        const originX = Number(this.boardState.x ?? 0);
        const originY = Number(this.boardState.y ?? 0);
        const nodeRotation = getNodeRotation(this);
        const nodeScaleX = Number(this.boardState.scaleX ?? 1);
        const nodeScaleY = Number(this.boardState.scaleY ?? 1);
        const preview = attachedStart || attachedEnd
            ? resolveFoxholeSplinePowerlineGeometry({
                currentStart: resolveFoxholeSplinePowerlineWorldEndpoint(
                    { x: originX, y: originY }, this.boardState.start, nodeRotation, nodeScaleX, nodeScaleY,
                ),
                currentEnd: resolveFoxholeSplinePowerlineWorldEndpoint(
                    { x: originX, y: originY }, this.boardState.end, nodeRotation, nodeScaleX, nodeScaleY,
                ),
                attachedStart,
                attachedEnd,
                nodeRotation,
                nodeScaleX,
                nodeScaleY,
            })
            : null;
        this.attachedStructurePreviewActive = preview !== null;
        const renderedState = preview ? { ...this.boardState, ...preview } : this.boardState;
        this.applyRenderedPowerlineTransform(renderedState, true);
        this.renderedPowerlineStart = { x: renderedState.start.x, y: renderedState.start.y };
        this.renderedPowerlineEnd = { x: renderedState.end.x, y: renderedState.end.y };
        this.redrawPowerline();
    }

    private applyRenderedPowerlineTransform(state: FoxholeSplineConnectorState, preserveRopePosition: boolean): void {
        const oldGlobalOrigin = preserveRopePosition && this.powerlineMotion.particles.length
            ? this.toGlobal(new PIXI.Point(0, 0))
            : null;
        applyTransform(this, state);
        if (oldGlobalOrigin) {
            rebasePowerlineMotion(this.powerlineMotion, this.toLocal(oldGlobalOrigin));
        }
    }

    containsWorldPoint(world: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        if (this.boardState.visible === false) {
            return false;
        }

        const globalPoint = context.viewport.toGlobal(world);
        const localPoint = this.toLocal(globalPoint);
        if (isTrenchConnector(this.boardState.foxholeKey)) {
            const corners = trenchConnectorCorners(this.boardState.start, this.boardState.end);
            return new PIXI.Polygon(corners.flatMap(point => [point.x, point.y])).contains(localPoint.x, localPoint.y)
                || this.trenchVisual?.containsLocalPoint(localPoint) === true
                || this.hitTestsFinishedVisual(globalPoint);
        }
        if (isPowerlineConnector(this.boardState.foxholeKey) && this.hitTestsAnimatedPowerline(localPoint, context.worldPerPx)) {
            return true;
        }
        const chordAligned = this.usesChordAlignedSelectionFrame();
        const selectionFrameHit = this.hitTestsSelectionFrameLocal(localPoint);
        const finishedVisualHit = this.hitTestsFinishedVisual(globalPoint);

        // Straight chord-aligned connectors: selection frame is the hit area.
        if (chordAligned && selectionFrameHit !== null) {
            return selectionFrameHit;
        }

        if (finishedVisualHit && !this.allowsRotationHandles()) {
            return true;
        }

        const showGuides = this.isSelected && this.activePlacementPhase === null;
        const isPowerline = isPowerlineConnector(this.boardState.foxholeKey);
        if (showGuides && !isPowerline) {
            const guideHitRadius = Math.max(8, context.worldPerPx * 8);
            const guideSample = this.getGuidePathSample();
            if (distanceToSplinePath(localPoint, guideSample.points) <= guideHitRadius) {
                return true;
            }
        }

        const layers = this.getResolvedRenderLayers();
        const pathStyle = this.getResolvedPathStyle();
        const connector = this.getResolvedConnector();
        const backtrimLayer = getConnectorEndCapLayer(layers, 'back', this.boardState.foxholeKey);
        const fronttrimLayer = getConnectorEndCapLayer(layers, 'front', this.boardState.foxholeKey);
        const spanLayer = getLayerById(layers, 'span') ?? getLayerById(layers, 'underlay');
        const hitRadius = Math.max(8, context.worldPerPx * 8, resolveConnectorHitRadius(
            pathStyle,
            backtrimLayer,
            fronttrimLayer,
            spanLayer,
            FOXHOLE_BOARD_SPRITE_SCALE,
            {
                foxholeKey: this.boardState.foxholeKey,
                connector,
            },
        ));

        // Fallback while textures/meshes are still loading, or for connectors without finished visuals.
        if (usesConnectorEndpointOnlyHitTesting(this.boardState.foxholeKey, connector)) {
            return isConnectorEndpointHit(
                localPoint,
                this.boardState.start,
                this.boardState.end,
                hitRadius,
            );
        }

        const sampled = this.getSampledPath();
        const pathHit = distanceToSplinePath(localPoint, sampled.points) <= hitRadius;

        // Rotatable/curved connectors hit the spline path only (span-texture cross-width radius).
        if (this.allowsRotationHandles()) {
            return pathHit;
        }

        return finishedVisualHit || pathHit;
    }

    getSelectionLocalBounds(): BoardNodeSelectionBounds | null {
        const chordAligned = this.usesChordAlignedSelectionFrame();
        if (chordAligned) {
            const oriented = this.getSelectionOrientedBoundsInNodeSpace();
            if (oriented) {
                return oriented.bounds;
            }
        }

        const visualBounds = this.getFinishedVisualBoundsInNodeSpace();
        if (visualBounds) {
            return visualBounds;
        }

        const sampled = this.getSampledPath();
        if (!sampled.points.length) {
            return null;
        }

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const point of sampled.points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }

        const padding = Math.max(GIZMO_STEM_LENGTH, 48);
        return {
            minX: minX - padding,
            minY: minY - padding,
            maxX: maxX + padding,
            maxY: maxY + padding,
        };
    }

    getSelectionLocalQuad(): BoardNodeSelectionLocalQuad | null {
        if (!this.usesChordAlignedSelectionFrame()) {
            return null;
        }

        return this.getSelectionOrientedBoundsInNodeSpace()?.quad ?? null;
    }

    getSelectionFrameAngleLocal(): number | null {
        if (!this.usesChordAlignedSelectionFrame()) {
            return null;
        }

        const start = this.boardState.start;
        const end = this.boardState.end;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (Math.hypot(dx, dy) <= 1e-6) {
            return 0;
        }

        return Math.atan2(dy, dx);
    }

    getSelectionTransformOriginLocal(): { x: number; y: number; } | null {
        const start = this.boardState.start;
        const end = this.boardState.end;
        return {
            x: (start.x + end.x) * 0.5,
            y: (start.y + end.y) * 0.5,
        };
    }

    private getSelectionOrientedBoundsInNodeSpace(): {
        bounds: BoardNodeSelectionBounds;
        quad: BoardNodeSelectionLocalQuad;
    } | null {
        const points = this.collectFinishedVisualCornersInNodeSpace();
        if (points.length < 2) {
            return null;
        }

        const frameAngle = this.getSelectionFrameAngleLocal() ?? 0;
        const cos = Math.cos(frameAngle);
        const sin = Math.sin(frameAngle);
        let minU = Number.POSITIVE_INFINITY;
        let minV = Number.POSITIVE_INFINITY;
        let maxU = Number.NEGATIVE_INFINITY;
        let maxV = Number.NEGATIVE_INFINITY;

        for (const point of points) {
            const u = (point.x * cos) + (point.y * sin);
            const v = (point.x * sin) - (point.y * cos);
            minU = Math.min(minU, u);
            minV = Math.min(minV, v);
            maxU = Math.max(maxU, u);
            maxV = Math.max(maxV, v);
        }

        if (!Number.isFinite(minU) || !Number.isFinite(minV) || !Number.isFinite(maxU) || !Number.isFinite(maxV)) {
            return null;
        }

        const toNode = (u: number, v: number) => ({
            x: (u * cos) + (v * sin),
            y: (u * sin) - (v * cos),
        });
        const quad: BoardNodeSelectionLocalQuad = [
            toNode(minU, minV),
            toNode(maxU, minV),
            toNode(maxU, maxV),
            toNode(minU, maxV),
        ];

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const corner of quad) {
            minX = Math.min(minX, corner.x);
            minY = Math.min(minY, corner.y);
            maxX = Math.max(maxX, corner.x);
            maxY = Math.max(maxY, corner.y);
        }

        return {
            bounds: { minX, minY, maxX, maxY },
            quad,
        };
    }

    private collectFinishedVisualCornersInNodeSpace(): Array<{ x: number; y: number; }> {
        const points: Array<{ x: number; y: number; }> = [];

        const appendLocalPoint = (
            source: PIXI.Container,
            localX: number,
            localY: number,
        ) => {
            const point = this.toLocal(source.toGlobal(new PIXI.Point(localX, localY)));
            points.push({ x: point.x, y: point.y });
        };

        const appendAabbCorners = (source: PIXI.Container) => {
            if (!this.sourceHasFinishedVisualGeometry(source)) {
                return;
            }

            const localBounds = source.getLocalBounds();
            if (!Number.isFinite(localBounds.minX)
                || !Number.isFinite(localBounds.minY)
                || !Number.isFinite(localBounds.maxX)
                || !Number.isFinite(localBounds.maxY)
                || localBounds.width <= 0
                || localBounds.height <= 0) {
                return;
            }

            const corners = [
                { x: localBounds.minX, y: localBounds.minY },
                { x: localBounds.maxX, y: localBounds.minY },
                { x: localBounds.maxX, y: localBounds.maxY },
                { x: localBounds.minX, y: localBounds.maxY },
            ];
            for (const corner of corners) {
                appendLocalPoint(source, corner.x, corner.y);
            }
        };

        const appendMeshVertexPoints = (mesh: PIXI.Mesh) => {
            if (!this.sourceHasFinishedVisualGeometry(mesh)) {
                return;
            }

            const positions = this.getMeshPositionData(mesh);
            if (!positions || positions.length < 4) {
                appendAabbCorners(mesh);
                return;
            }

            for (let index = 0; index + 1 < positions.length; index += 2) {
                appendLocalPoint(mesh, positions[index]!, positions[index + 1]!);
            }
        };

        for (const source of this.getFinishedVisualSources()) {
            if (source === this.powerlineGraphics) {
                if (isPowerlineConnector(this.boardState.foxholeKey)) {
                    points.push(...resolveFoxholePowerlineSelectionQuad(
                        this.boardState.start,
                        this.boardState.end,
                        POWERLINE_CORE_WIDTH,
                    ));
                }
                continue;
            }

            for (const child of source.children) {
                if (!child.visible || !(child instanceof PIXI.Container)) {
                    continue;
                }
                if (child instanceof PIXI.Sprite) {
                    const texture = child.texture;
                    if (!texture
                        || texture === PIXI.Texture.EMPTY
                        || texture.destroyed
                        || texture.width <= 0
                        || texture.height <= 0) {
                        continue;
                    }
                    appendAabbCorners(child);
                    continue;
                }
                if (child instanceof PIXI.Mesh) {
                    appendMeshVertexPoints(child);
                    continue;
                }
                appendAabbCorners(child);
            }
        }

        return points;
    }

    private getMeshPositionData(mesh: PIXI.Mesh): Float32Array | null {
        const geometry = mesh.geometry as PIXI.MeshGeometry | null | undefined;
        if (!geometry) {
            return null;
        }

        const positions = geometry.positions;
        if (positions instanceof Float32Array && positions.length >= 4) {
            return positions;
        }

        try {
            const attribute = geometry.getAttribute('aPosition');
            const data = attribute?.buffer?.data ?? attribute?.data;
            if (data instanceof Float32Array && data.length >= 4) {
                return data;
            }
            if (ArrayBuffer.isView(data) && data.length >= 4) {
                return data as Float32Array;
            }
        } catch {
            // Fall through when attribute lookup is unavailable.
        }

        return null;
    }

    private allowsRotationHandles(): boolean {
        return allowsConnectorRotationHandles(this.getResolvedPathStyle(), this.boardState.foxholeKey, {
            maxArcAngleDeg: this.getResolvedMaxArcAngleDeg(),
        });
    }

    private usesChordAlignedSelectionFrame(): boolean {
        // Straight telescoping / non-rotatable connectors keep a chord-aligned OBB.
        // Curved / rotatable-handle splines use standard AABB selection bounds.
        return !this.allowsRotationHandles();
    }

    private hitTestsSelectionFrameLocal(localPoint: { x: number; y: number; }): boolean | null {
        if (this.usesChordAlignedSelectionFrame()) {
            const oriented = this.getSelectionOrientedBoundsInNodeSpace();
            if (!oriented) {
                return null;
            }

            const frameAngle = this.getSelectionFrameAngleLocal() ?? 0;
            const cos = Math.cos(frameAngle);
            const sin = Math.sin(frameAngle);
            const u = (localPoint.x * cos) + (localPoint.y * sin);
            const v = (localPoint.x * sin) - (localPoint.y * cos);
            let minU = Number.POSITIVE_INFINITY;
            let minV = Number.POSITIVE_INFINITY;
            let maxU = Number.NEGATIVE_INFINITY;
            let maxV = Number.NEGATIVE_INFINITY;
            for (const corner of oriented.quad) {
                const cornerU = (corner.x * cos) + (corner.y * sin);
                const cornerV = (corner.x * sin) - (corner.y * cos);
                minU = Math.min(minU, cornerU);
                minV = Math.min(minV, cornerV);
                maxU = Math.max(maxU, cornerU);
                maxV = Math.max(maxV, cornerV);
            }

            return u >= minU && u <= maxU && v >= minV && v <= maxV;
        }

        const bounds = this.getSelectionLocalBounds();
        if (!bounds) {
            return null;
        }

        return localPoint.x >= bounds.minX
            && localPoint.x <= bounds.maxX
            && localPoint.y >= bounds.minY
            && localPoint.y <= bounds.maxY;
    }

    private getFinishedVisualSources(): readonly PIXI.Container[] {
        return [
            this.underlayOverlay,
            this.spanOverlay,
            this.wallMiddlePillarOverlay,
            this.wallBarbedWireOverlay,
            this.trimOverlay,
            this.handleTrimOverlay,
            this.powerlineGraphics,
        ];
    }

    private hitTestsFinishedVisual(globalPoint: PIXI.Point): boolean {
        for (const source of this.getFinishedVisualSources()) {
            if (source === this.powerlineGraphics) {
                if (this.hitTestsDisplayObjectBounds(this.powerlineGraphics, globalPoint)) {
                    return true;
                }
                continue;
            }

            for (const child of source.children) {
                if (!child.visible) {
                    continue;
                }
                if (child instanceof PIXI.Sprite) {
                    if (this.hitTestsSprite(child, globalPoint)) {
                        return true;
                    }
                    continue;
                }
                if (child instanceof PIXI.Mesh) {
                    if (this.hitTestsDisplayObjectBounds(child, globalPoint)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private hitTestsSprite(sprite: PIXI.Sprite, globalPoint: PIXI.Point): boolean {
        const texture = sprite.texture;
        if (!texture
            || texture === PIXI.Texture.EMPTY
            || texture.destroyed
            || texture.width <= 0
            || texture.height <= 0) {
            return false;
        }

        const local = sprite.toLocal(globalPoint);
        const width = texture.width;
        const height = texture.height;
        const minX = -sprite.anchor.x * width;
        const minY = -sprite.anchor.y * height;
        return local.x >= minX
            && local.x <= minX + width
            && local.y >= minY
            && local.y <= minY + height;
    }

    private hitTestsDisplayObjectBounds(
        target: PIXI.Container,
        globalPoint: PIXI.Point,
    ): boolean {
        const bounds = target.getLocalBounds();
        if (!Number.isFinite(bounds.minX)
            || !Number.isFinite(bounds.minY)
            || !Number.isFinite(bounds.maxX)
            || !Number.isFinite(bounds.maxY)
            || bounds.width <= 0
            || bounds.height <= 0) {
            return false;
        }

        const local = target.toLocal(globalPoint);
        return local.x >= bounds.minX
            && local.x <= bounds.maxX
            && local.y >= bounds.minY
            && local.y <= bounds.maxY;
    }

    private getFinishedVisualBoundsInNodeSpace(): BoardNodeSelectionBounds | null {
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let found = false;

        const sources = trenchConnectorTier(this.boardState.foxholeKey) && this.trenchVisual
            ? this.trenchVisual.getSelectionMeshes()
            : this.getFinishedVisualSources();
        for (const source of sources) {
            if (!this.sourceHasFinishedVisualGeometry(source)) {
                continue;
            }

            const localBounds = source.getLocalBounds();
            if (!Number.isFinite(localBounds.minX)
                || !Number.isFinite(localBounds.minY)
                || !Number.isFinite(localBounds.maxX)
                || !Number.isFinite(localBounds.maxY)
                || localBounds.width <= 0
                || localBounds.height <= 0) {
                continue;
            }

            const corners = [
                { x: localBounds.minX, y: localBounds.minY },
                { x: localBounds.maxX, y: localBounds.minY },
                { x: localBounds.maxX, y: localBounds.maxY },
                { x: localBounds.minX, y: localBounds.maxY },
            ];
            for (const corner of corners) {
                const point = this.toLocal(source.toGlobal(corner));
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
                found = true;
            }
        }

        if (!found) {
            return null;
        }

        return { minX, minY, maxX, maxY };
    }

    private sourceHasFinishedVisualGeometry(source: PIXI.Container): boolean {
        if (source === this.powerlineGraphics) {
            const bounds = source.getLocalBounds();
            return Number.isFinite(bounds.width)
                && Number.isFinite(bounds.height)
                && bounds.width > 0
                && bounds.height > 0;
        }

        if (source instanceof PIXI.Sprite) {
            const texture = source.texture;
            return Boolean(texture)
                && texture !== PIXI.Texture.EMPTY
                && !texture.destroyed
                && texture.width > 0
                && texture.height > 0;
        }

        if (source instanceof PIXI.Mesh) {
            return Boolean(source.geometry);
        }

        return source.children.some(child => {
            if (!child.visible) {
                return false;
            }
            if (child instanceof PIXI.Sprite) {
                const texture = child.texture;
                return Boolean(texture)
                    && texture !== PIXI.Texture.EMPTY
                    && !texture.destroyed
                    && texture.width > 0
                    && texture.height > 0;
            }
            if (child instanceof PIXI.Mesh) {
                return Boolean(child.geometry);
            }
            return true;
        });
    }

    startPlacementSession(_context: BoardNodePlacementSessionContext): SplineConnectorPlacementSession {
        this.activePlacementPhase = 'pick-start';

        return {
            phase: 'pick-start',
            removeOnCancel: true,
            initialX: Number(this.boardState.x ?? this.x ?? 0),
            initialY: Number(this.boardState.y ?? this.y ?? 0),
            initialStart: cloneEndpoint(this.boardState.start),
            initialEnd: cloneEndpoint(this.boardState.end),
            initialStartAttachment: this.getNormalizedEndpointAttachment(this.boardState.startAttachment),
            initialEndAttachment: this.getNormalizedEndpointAttachment(this.boardState.endAttachment),
            manualStartRotation: false,
            manualEndRotation: false,
        };
    }

    private getNormalizedEndpointAttachment(
        value: FoxholeConnectorEndpointAttachment | null | undefined,
    ): FoxholeConnectorEndpointAttachment | undefined {
        const nodeId = String(value?.nodeId ?? '').trim();
        const socketName = String(value?.socketName ?? '').trim();
        return nodeId && socketName
            ? { nodeId, socketName }
            : undefined;
    }

    private getNormalizedSocketAttachments(): FoxholeStructureSocketAttachmentMap {
        return normalizeFoxholeStructureSocketAttachmentMap(this.boardState.socketAttachments);
    }

    private resolveOwnSocketAttachmentsFromTargetReciprocals(
        targetAttachmentsByNode: Map<string, FoxholeStructureSocketAttachmentMap>,
    ): FoxholeStructureSocketAttachmentMap {
        const selfId = String(this.boardId);
        const nextAttachments: FoxholeStructureSocketAttachmentMap = {};

        // Host occupancy for sockets others attach onto (including side sockets and
        // endpoint sockets when we are the target) is reconstructed from reciprocal writes.
        for (const [targetNodeId, attachments] of targetAttachmentsByNode) {
            for (const [targetSocketName, attachment] of Object.entries(attachments)) {
                if (String(attachment?.nodeId ?? '').trim() !== selfId) {
                    continue;
                }
                const ownSocketName = String(attachment?.socketName ?? '').trim();
                const partnerSocketName = String(targetSocketName ?? '').trim();
                if (!ownSocketName || !partnerSocketName) {
                    continue;
                }
                nextAttachments[ownSocketName] = {
                    nodeId: targetNodeId,
                    socketName: partnerSocketName,
                };
            }
        }

        return normalizeFoxholeStructureSocketAttachmentMap(nextAttachments);
    }

    private syncConnectorTargetEndpointAttachmentsFromOccupancy(
        target: FoxholeSplineConnectorSnapTarget,
        nextOccupancyAttachments: FoxholeStructureSocketAttachmentMap,
    ): void {
        const node = target.node;
        if (!(node instanceof FoxholeSplineConnectorNode)) {
            return;
        }

        const selfId = String(this.boardId);
        const startSocketName = String(node.boardState.startSocketName ?? '').trim();
        const endSocketName = String(node.boardState.endSocketName ?? '').trim();
        const currentStart = node.getNormalizedEndpointAttachment(node.boardState.startAttachment) ?? null;
        const currentEnd = node.getNormalizedEndpointAttachment(node.boardState.endAttachment) ?? null;
        let nextStart = currentStart;
        let nextEnd = currentEnd;

        if (startSocketName) {
            const occupied = nextOccupancyAttachments[startSocketName];
            if (occupied && String(occupied.nodeId ?? '').trim() === selfId) {
                nextStart = {
                    nodeId: selfId,
                    socketName: String(occupied.socketName ?? '').trim(),
                };
            } else if (currentStart?.nodeId === selfId) {
                nextStart = null;
            }
        }

        if (endSocketName) {
            const occupied = nextOccupancyAttachments[endSocketName];
            if (occupied && String(occupied.nodeId ?? '').trim() === selfId) {
                nextEnd = {
                    nodeId: selfId,
                    socketName: String(occupied.socketName ?? '').trim(),
                };
            } else if (currentEnd?.nodeId === selfId) {
                nextEnd = null;
            }
        }

        if (
            JSON.stringify(currentStart) === JSON.stringify(nextStart)
            && JSON.stringify(currentEnd) === JSON.stringify(nextEnd)
        ) {
            return;
        }

        node.patchBoardState({
            startAttachment: nextStart,
            endAttachment: nextEnd,
        }, {
            reason: 'foxhole-spline-connector-target-endpoint-attachment-preview',
            recordHistory: false,
        });
    }

    private getWallVisibilityAttachments(): FoxholeStructureSocketAttachmentMap {
        return Object.fromEntries(Object.entries(this.getEndpointOccupancyAttachments()).filter(([, attachment]) => {
            const targetKey = resolveStructureAssetHoverTargetKey(activeNixieStructureModificationHoverPreview.value, String(attachment.nodeId));
            const neighborKey = targetKey && this.boardDefinition.structureResolver?.(targetKey) ? targetKey
                : (this.findBoardNodeById(String(attachment.nodeId)) as { boardState?: { foxholeKey?: string } } | null)?.boardState?.foxholeKey;
            return canFoxholeSocketConnectionOpenWalls(this.getResolvedRenderKey(), neighborKey);
        }));
    }

    private getEndpointOccupancyAttachments(): FoxholeStructureSocketAttachmentMap {
        const attachments = { ...this.getNormalizedSocketAttachments() };
        const startSocketName = String(this.boardState.startSocketName ?? '').trim();
        const endSocketName = String(this.boardState.endSocketName ?? '').trim();
        const startAttachment = this.getNormalizedEndpointAttachment(this.boardState.startAttachment);
        const endAttachment = this.getNormalizedEndpointAttachment(this.boardState.endAttachment);
        if (startSocketName && startAttachment) {
            attachments[startSocketName] = startAttachment;
        }
        if (endSocketName && endAttachment) {
            attachments[endSocketName] = endAttachment;
        }
        return attachments;
    }

    /** Pre-drag endpoint links win over live preview clears so occupied sockets stay non-snappable. */
    private getMoveSnapOccupancyAttachments(): FoxholeStructureSocketAttachmentMap {
        const attachments = this.getEndpointOccupancyAttachments();
        const preview = this.moveAttachmentPreview;
        if (!preview) {
            return attachments;
        }

        const startSocketName = String(this.boardState.startSocketName ?? '').trim();
        const endSocketName = String(this.boardState.endSocketName ?? '').trim();
        if (startSocketName && preview.initialStartAttachment) {
            attachments[startSocketName] = preview.initialStartAttachment;
        }
        if (endSocketName && preview.initialEndAttachment) {
            attachments[endSocketName] = preview.initialEndAttachment;
        }
        return attachments;
    }

    private reconcileAttachmentsAgainstTargets(
        movingSockets: readonly FoxholeSocketSnapPoint[],
        targets: readonly FoxholeSplineConnectorSnapTarget[],
        maxDistance?: number,
    ) {
        const movingAttachments = this.getMoveSnapOccupancyAttachments();
        return reconcileFoxholeConnectorAttachments({
            connectorNodeId: String(this.boardId),
            startSocketName: this.boardState.startSocketName,
            endSocketName: this.boardState.endSocketName,
            movingSockets,
            targets,
            maxDistance,
            isTargetSocketAvailable: (movingSocket, targetSocket) => this.areConnectorSnapSocketsAvailable(
                movingSocket,
                movingAttachments,
                targetSocket,
                targets,
            ),
        });
    }

    private collectPowerSocketConnections(
        targets: readonly FoxholeSplineConnectorSnapTarget[],
    ): FoxholePowerSocketConnection[] {
        const connectors = new Map<string, FoxholeSplineConnectorNode>();
        connectors.set(String(this.boardId), this);
        for (const target of targets) {
            if (target.node instanceof FoxholeSplineConnectorNode) {
                connectors.set(target.nodeId, target.node);
            }
        }

        const connections: FoxholePowerSocketConnection[] = [];
        for (const [connectorNodeId, connector] of connectors) {
            if (!isPowerlineConnector(connector.boardState.foxholeKey)) {
                continue;
            }

            const startSocketName = String(connector.boardState.startSocketName ?? '').trim();
            if (startSocketName) {
                connections.push({
                    connectorNodeId,
                    connectorSocketName: startSocketName,
                    attachment: connector.getNormalizedEndpointAttachment(connector.boardState.startAttachment),
                });
            }

            const endSocketName = String(connector.boardState.endSocketName ?? '').trim();
            if (endSocketName) {
                connections.push({
                    connectorNodeId,
                    connectorSocketName: endSocketName,
                    attachment: connector.getNormalizedEndpointAttachment(connector.boardState.endAttachment),
                });
            }
        }

        return connections;
    }

    private areConnectorSnapSocketsAvailable(
        movingSocket: FoxholeSocketSnapPoint,
        movingAttachments: FoxholeStructureSocketAttachmentMap,
        targetSocket: FoxholeSocketSnapPoint,
        targets: readonly FoxholeSplineConnectorSnapTarget[],
    ): boolean {
        const target = targets.find(entry => entry.nodeId === targetSocket.nodeId);
        if (
            target?.node instanceof FoxholeStructureNode
            && hasFoxholePowerSocketTag(movingSocket.socketTags)
            && hasFoxholePowerSocketTag(targetSocket.socketTags)
        ) {
            const structure = target.node.boardDefinition.structureResolver?.(
                String(target.node.boardState.foxholeKey ?? '').trim(),
            );
            return isFoxholePowerSocketConnectionAvailable({
                targetNodeId: targetSocket.nodeId,
                targetSocketName: targetSocket.socketName,
                maxConnections: structure?.powerGridInfo?.maxConnections,
                connections: this.collectPowerSocketConnections(targets),
                movingConnectorNodeId: movingSocket.nodeId,
                movingConnectorSocketName: movingSocket.socketName,
            });
        }

        return areFoxholeSnapSocketsAvailableForAttachment(
            movingSocket,
            movingAttachments,
            targetSocket,
            target?.attachments,
        );
    }

    private usesSocketSnapping(): boolean {
        return usesSplineConnectorSocketSnapping(this.boardState.foxholeKey);
    }

    private getInteractiveRoadKey(): string {
        // Resolve aliases through the catalog without rewriting the persisted key.
        return this.getResolvedAsset()?.foxholeKey ?? this.getResolvedStructure()?.id ?? this.boardState.foxholeKey;
    }

    private isInteractiveRoadCandidateValid(start = this.boardState.start, end = this.boardState.end): boolean {
        const key = this.getInteractiveRoadKey();
        if (!isReferenceRoadSplineKey(key)) return true;
        const layer = this.getResolvedRenderLayers().find(layer => layer.id === 'span');
        const connector = this.getResolvedConnector();
        const pathStyle = this.getResolvedPathStyle();
        const constraints = this.getPathConstraints({ ...this.boardState, start, end });
        return isWorldRoadEditCandidateValid(key, layer ? {
            spanLayer: layer,
            textureMapping: resolveConnectorSpanTextureMapping(layer, connector, layer.width ?? undefined, pathStyle, {
                foxholeKey: this.boardState.foxholeKey,
            }),
            pathSample: sampleConnectorPath(start, end, constraints, pathStyle, { foxholeKey: key }),
        } : undefined, start, end, constraints);
    }

    private patchInteractiveEndpoints(
        update: (state: FoxholeSplineConnectorState) => void,
        options: { reason: string; recordHistory: boolean; },
    ): boolean {
        if (!isReferenceRoadSplineKey(this.getInteractiveRoadKey())) {
            this.patchBoardState(update, options);
            return true;
        }
        const candidate = { ...this.boardState, start: cloneEndpoint(this.boardState.start), end: cloneEndpoint(this.boardState.end) };
        update(candidate);
        if (!this.isInteractiveRoadCandidateValid(candidate.start, candidate.end)) return false;
        this.patchBoardState({ start: candidate.start, end: candidate.end }, options);
        return true;
    }

    updatePlacementSession(session: SplineConnectorPlacementSession, context: BoardNodePlacementSessionContext): boolean {
        const cursor = this.toLocal(context.viewport.toGlobal(context.world));
        const snapped = this.usesSocketSnapping()
            ? this.snapSplineConnectorHandleLocal(session.phase === 'pick-start' ? 'start' : 'end', context.world, context)
            : null;
        // Preview resolution also changes transient placement flags: reject them atomically.
        const draftSession = { ...session };
        const preview = resolveFoxholeSplinePlacementPreview(this.boardState, draftSession, cursor, {
            pathStyle: this.getResolvedPathStyle(), maxArcAngleDeg: this.getResolvedMaxArcAngleDeg(),
            rotateActiveEndpoint: context.rotateActiveEndpoint, snapped,
            startAttached: Boolean(session.previewStartAttachment ?? this.getNormalizedEndpointAttachment(this.boardState.startAttachment)),
        });
        if (!this.patchInteractiveEndpoints(state => {
            state.start = preview.start;
            state.end = preview.end;
        }, { reason: session.phase === 'pick-start'
            ? 'foxhole-spline-connector-placement-preview-start'
            : 'foxhole-spline-connector-placement-preview-end', recordHistory: false })) return false;
        Object.assign(session, draftSession);
        if (this.usesSocketSnapping()) {
            this.reconcilePlacementSocketAttachments(session, context, session.phase === 'pick-start' ? 'start' : 'end');
        }
        return true;
    }

    private reconcilePlacementSocketAttachments(
        session: SplineConnectorPlacementSession,
        context: BoardNodePlacementSessionContext,
        activeEndpoint: 'start' | 'end',
    ): void {
        const structure = this.getResolvedStructure();
        if (!structure) {
            return;
        }

        const endpointSockets = resolveFoxholeConnectorEndpointSockets(structure, {
            startSocketName: this.boardState.startSocketName,
            endSocketName: this.boardState.endSocketName,
        });
        const activeSocketName = activeEndpoint === 'start'
            ? String(this.boardState.startSocketName ?? '').trim()
            : String(this.boardState.endSocketName ?? '').trim();
        const movingSockets = this.collectMovingEndpointSocketsFromState(endpointSockets, context)
            .filter(socket => socket.socketName === activeSocketName);
        const targets = this.getSnapTargetsForViewport(context.viewport);
        const reconciliation = this.reconcileAttachmentsAgainstTargets(movingSockets, targets);
        if (activeEndpoint === 'start') {
            session.previewStartAttachment = reconciliation.startAttachment;
            session.previewEndAttachment = undefined;
        } else {
            session.previewEndAttachment = reconciliation.endAttachment;
        }

        const mergedTargetAttachments = new Map(reconciliation.targetAttachmentsByNode);
        const lockedStartAttachment = activeEndpoint === 'end'
            ? (session.previewStartAttachment
                ?? this.getNormalizedEndpointAttachment(this.boardState.startAttachment))
            : undefined;
        if (lockedStartAttachment) {
            session.previewStartAttachment = lockedStartAttachment;
            const startSocketName = String(this.boardState.startSocketName ?? '').trim();
            if (startSocketName) {
                const existing = {
                    ...(mergedTargetAttachments.get(lockedStartAttachment.nodeId) ?? {}),
                };
                existing[lockedStartAttachment.socketName] = {
                    nodeId: String(this.boardId),
                    socketName: startSocketName,
                };
                mergedTargetAttachments.set(lockedStartAttachment.nodeId, existing);
            }
        }
        session.previewTargetAttachmentsByNode = mergedTargetAttachments;
        session.previewTargets = [...targets];

        const liveReconciliation = {
            ...(session.previewStartAttachment
                ? { startAttachment: session.previewStartAttachment }
                : {}),
            ...(session.previewEndAttachment
                ? { endAttachment: session.previewEndAttachment }
                : {}),
            targetAttachmentsByNode: mergedTargetAttachments,
        };
        this.applyLiveAttachmentPreview(session, liveReconciliation, targets);
    }

    confirmPlacementSession(session: SplineConnectorPlacementSession, context: BoardNodePlacementSessionContext): 'continue' | 'complete' | 'cancel' {
        if (!this.updatePlacementSession(session, context)) return 'continue';

        if (session.phase === 'pick-start') {
            session.phase = 'pick-end';
            this.activePlacementPhase = 'pick-end';
            session.removeOnCancel = true;
            session.lockedStartPosition = undefined;
            session.lockedEndPosition = undefined;
            session.manualEndRotation = false;
            const pathStyle = this.getResolvedPathStyle();
            const constraints = getFoxholeSplineConnectorConstraints(this.boardState, pathStyle);
            const startAttachment = session.previewStartAttachment;
            // Socket-locked starts must keep their facing even when this path style
            // does not expose rotation handles (e.g. straight-telescoping overhead).
            if (startAttachment && this.usesSocketSnapping() && !isPowerlineConnector(this.boardState.foxholeKey)) {
                session.manualStartRotation = true;
            } else if (allowsConnectorRotationHandles(pathStyle, this.boardState.foxholeKey, {
                maxArcAngleDeg: this.getResolvedMaxArcAngleDeg(),
            })) {
                session.manualStartRotation = true;
            }
            if (startAttachment && this.usesSocketSnapping()) {
                const socketPoint = this.findSocketPointForAttachment(startAttachment, context.viewport);
                if (socketPoint) {
                    const nodeRotation = getNodeRotation(this);
                    const localRotation = resolveEndpointRotationFromSocketPoint(socketPoint, 'start', nodeRotation);
                    const start = {
                        x: 0,
                        y: 0,
                        rotation: localRotation,
                    };
                    const end = resolveMinimumLengthPreviewEnd(start, constraints, this.boardState.foxholeKey);
                    this.patchBoardState(state => {
                        state.x = socketPoint.x;
                        state.y = socketPoint.y;
                        state.start = start;
                        state.end = end;
                        state.startAttachment = startAttachment;
                        state.endAttachment = undefined;
                    }, {
                        reason: 'foxhole-spline-connector-placement-lock-start',
                        recordHistory: false,
                    });
                    return 'continue';
                }
            }

            const start = cloneEndpoint(this.boardState.start);
            const end = resolveMinimumLengthPreviewEnd(start, constraints, this.boardState.foxholeKey);
            this.patchBoardState(state => {
                state.start = start;
                state.end = end;
                state.startAttachment = startAttachment;
                state.endAttachment = undefined;
            }, {
                reason: 'foxhole-spline-connector-placement-lock-start',
                recordHistory: false,
            });
            return 'continue';
        }

        session.removeOnCancel = false;
        this.activePlacementPhase = null;
        return 'complete';
    }

    buildPlacementCommit(session: SplineConnectorPlacementSession, context: BoardNodePlacementSessionContext): BoardNodeEditableMutation | null {
        if (!this.updatePlacementSession(session, context) || !this.isInteractiveRoadCandidateValid()) {
            this.cancelPlacementSession(session);
            return null;
        }

        const startAttachment = session.previewStartAttachment
            ?? this.getNormalizedEndpointAttachment(this.boardState.startAttachment);
        const endAttachment = session.previewEndAttachment
            ?? this.getNormalizedEndpointAttachment(this.boardState.endAttachment);
        const nextPatch = {
            x: Number(this.boardState.x ?? this.x ?? 0),
            y: Number(this.boardState.y ?? this.y ?? 0),
            start: cloneEndpoint(this.boardState.start),
            end: cloneEndpoint(this.boardState.end),
            ...(this.usesSocketSnapping()
                ? {
                    startAttachment: startAttachment ?? null,
                    endAttachment: endAttachment ?? null,
                }
                : {}),
        };
        const inversePatch = {
            x: session.initialX,
            y: session.initialY,
            start: cloneEndpoint(session.initialStart),
            end: cloneEndpoint(session.initialEnd),
            ...(this.usesSocketSnapping()
                ? {
                    startAttachment: session.initialStartAttachment ?? null,
                    endAttachment: session.initialEndAttachment ?? null,
                }
                : {}),
        };
        const extraPatches = this.usesSocketSnapping() && session.previewTargetAttachmentsByNode
            ? [...new Set([
                ...(session.previewTargets?.map(target => target.nodeId) ?? []),
                ...(session.initialTargetAttachmentsByNode?.keys() ?? []),
                ...session.previewTargetAttachmentsByNode.keys(),
            ])].flatMap(nodeId => {
                // Compare against pre-preview attachments. Live targets already have
                // preview patches applied, so comparing to target.attachments drops
                // reciprocal writes and they vanish on hard refresh.
                const nextAttachments = session.previewTargetAttachmentsByNode?.get(nodeId)
                    ?? session.initialTargetAttachmentsByNode?.get(nodeId)
                    ?? {};
                const previousAttachments = session.initialTargetAttachmentsByNode?.get(nodeId) ?? {};
                if (JSON.stringify(previousAttachments) === JSON.stringify(nextAttachments)) {
                    return [];
                }
                return [{
                    nodeId,
                    patch: { socketAttachments: nextAttachments },
                    inversePatch: { socketAttachments: previousAttachments },
                }];
            })
            : [];

        return {
            patch: nextPatch,
            inversePatch,
            reason: 'foxhole-spline-connector-placement-commit',
            label: isPowerlineConnector(this.boardState.foxholeKey) ? 'Place Power Line' : 'Place Spline Connector',
            ...(extraPatches.length ? { extraPatches } : {}),
        };
    }

    cancelPlacementSession(session: SplineConnectorPlacementSession): void {
        this.activePlacementPhase = null;
        this.restoreLiveAttachmentPreview(session);
        this.patchBoardState(state => {
            state.x = session.initialX;
            state.y = session.initialY;
            state.start = cloneEndpoint(session.initialStart);
            state.end = cloneEndpoint(session.initialEnd);
            if (this.usesSocketSnapping()) {
                state.startAttachment = session.initialStartAttachment;
                state.endAttachment = session.initialEndAttachment;
            }
        }, {
            reason: 'foxhole-spline-connector-placement-cancel',
            recordHistory: false,
        });
    }

    buildDeleteCommitPatches(context: BoardNodeDeleteCommitContext) {
        if (context.deletedNodeIds.has(String(this.boardId))) {
            return [];
        }
        const mutation = resolveFoxholeSplineDeleteMutation({ ...this.boardState,
            socketAttachments: this.getNormalizedSocketAttachments(),
            startAttachment: this.getNormalizedEndpointAttachment(this.boardState.startAttachment),
            endAttachment: this.getNormalizedEndpointAttachment(this.boardState.endAttachment) }, context.deletedNodeIds);
        return Object.keys(mutation.patch).length ? [{ nodeId: String(this.boardId), ...mutation }] : [];
    }

    shouldRemoveNodeOnPlacementCancel(session: unknown): boolean {
        return typeof session === 'object'
            && session !== null
            && (session as SplineConnectorPlacementSession).removeOnCancel === true;
    }

    applyPlacementSecondaryDown(session: SplineConnectorPlacementSession): void {
        const pathStyle = this.getResolvedPathStyle();
        if (!allowsConnectorRotationHandles(pathStyle, this.boardState.foxholeKey, {
            maxArcAngleDeg: this.getResolvedMaxArcAngleDeg(),
        })) {
            return;
        }

        if (session.phase === 'pick-start') {
            session.lockedStartPosition = cloneEndpoint(this.boardState.start);
            session.manualStartRotation = true;
            return;
        }

        if (session.phase !== 'pick-end') {
            return;
        }

        session.lockedEndPosition = cloneEndpoint(this.boardState.end);
        session.manualEndRotation = true;
    }

    applyPlacementWheel(session: SplineConnectorPlacementSession, wheelDeltaY: number): boolean {
        const pathStyle = this.getResolvedPathStyle();
        if (!usesPipeCurveScale(pathStyle, this.boardState.foxholeKey)) {
            return false;
        }

        this.patchBoardState(state => {
            state.curveT = adjustPipeCurveT(state.curveT, wheelDeltaY);
        }, {
            reason: 'foxhole-spline-connector-placement-curve-scale',
            recordHistory: false,
        });
        return true;
    }

    applyCurveScaleWheel(wheelDeltaY: number): boolean {
        const pathStyle = this.getResolvedPathStyle();
        if (!usesPipeCurveScale(pathStyle, this.boardState.foxholeKey)) {
            return false;
        }

        this.patchBoardState(state => {
            state.curveT = adjustPipeCurveT(state.curveT, wheelDeltaY);
        }, {
            reason: 'foxhole-spline-connector-curve-scale',
            recordHistory: true,
        });
        return true;
    }

    getEditableHandles(context: BoardNodeEditableHandleContext): BoardNodeEditableHandle[] {
        return getFoxholeSplineLocalEditableHandles(this.boardState, this.getResolvedPathStyle(), this.getResolvedMaxArcAngleDeg())
            .filter(handle => {
                if (!isTrenchConnector(this.boardState.foxholeKey) || !handle.id.endsWith('-rotation')) return true;
                const role = handle.id === 'start-rotation' ? 'start' : 'end';
                return !this.getTrenchEndAttachment(role) || Boolean(this.getTrenchRotationPartner(role));
            })
            .map(({ local, ...handle }) => ({ ...handle, world: toBoardWorldPoint(this, new PIXI.Point(local.x, local.y), context.viewport) }));
    }

    private getTrenchEndAttachment(role: 'start' | 'end') {
        return this.getEndpointOccupancyAttachments()[String(role === 'start' ? this.boardState.startSocketName : this.boardState.endSocketName)];
    }

    private getTrenchRotationPartner(role: 'start' | 'end') {
        const attachment = this.getTrenchEndAttachment(role);
        if (!attachment) return null;
        const node = this.findBoardNodeById(String(attachment.nodeId));
        if (!(node instanceof FoxholeSplineConnectorNode) || node === this || node.destroyed
            || node.boardState.locked || !isTrenchConnector(node.boardState.foxholeKey)) return null;
        const name = (value: unknown) => String(value ?? '').split(':').pop();
        const partnerRole: 'start' | 'end' | null = name(attachment.socketName) === name(node.boardState.startSocketName) ? 'start'
            : name(attachment.socketName) === name(node.boardState.endSocketName) ? 'end' : null;
        if (!partnerRole) return null;
        const reciprocal = node.getTrenchEndAttachment(partnerRole);
        if (!reciprocal || String(reciprocal.nodeId) !== String(this.boardId)) return null;
        return { node, role: partnerRole };
    }

    startEditableHandleDrag(handle: BoardNodeEditableHandle): SplineConnectorEditableSession | null {
        const initialStartAttachment = this.getNormalizedEndpointAttachment(this.boardState.startAttachment);
        const initialEndAttachment = this.getNormalizedEndpointAttachment(this.boardState.endAttachment);
        return {
            handleId: handle.id,
            initialStart: cloneEndpoint(this.boardState.start),
            initialEnd: cloneEndpoint(this.boardState.end),
            initialX: Number(this.boardState.x ?? this.x ?? 0),
            initialY: Number(this.boardState.y ?? this.y ?? 0),
            initialStartAttachment,
            initialEndAttachment,
            initialSocketAttachments: this.getNormalizedSocketAttachments(),
            // Seed previews so rotation commits preserve untouched ends until reconcile runs.
            previewStartAttachment: initialStartAttachment,
            previewEndAttachment: initialEndAttachment,
            previewSocketAttachments: this.getNormalizedSocketAttachments(),
        };
    }

    applyEditableHandleDrag(session: SplineConnectorEditableSession, pointerWorld: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const pathStyle = this.getResolvedPathStyle();

        if (session.handleId === 'start-rotation' || session.handleId === 'end-rotation') {
            const endpointRole = session.handleId === 'start-rotation' ? 'start' : 'end';
            if (isTrenchConnector(this.boardState.foxholeKey) && this.getTrenchEndAttachment(endpointRole)) {
                const partner = this.getTrenchRotationPartner(endpointRole);
                if (!partner) return false;
                if (session.sharedTrenchRotation && (session.sharedTrenchRotation.nodeId !== String(partner.node.boardId)
                    || session.sharedTrenchRotation.role !== partner.role)) return false;
                const endpoint = this.boardState[endpointRole];
                const rotation = resolveRotationFromWorldPointer(this, endpoint, pointerWorld, context, endpointRole, pathStyle);
                // Transform the tangent into the partner's local space, including
                // parent transforms. Equal endpoint roles face opposite ways.
                const origin = partner.node.toLocal(this.toGlobal(new PIXI.Point(endpoint.x, endpoint.y)));
                const tangent = partner.node.toLocal(this.toGlobal(new PIXI.Point(endpoint.x + Math.cos(rotation), endpoint.y + Math.sin(rotation))));
                const shared = resolveTrenchSharedRotation(this.boardState, endpointRole, rotation, partner.node.boardState,
                    partner.role, { x: tangent.x - origin.x, y: tangent.y - origin.y });
                if (!shared) return false;
                session.sharedTrenchRotation ??= { nodeId: String(partner.node.boardId), role: partner.role,
                    initial: cloneEndpoint(partner.node.boardState[partner.role]) };
                partner.node.patchBoardState({ [partner.role]: shared.partnerEndpoint }, { reason: 'foxhole-trench-shared-rotation-preview', recordHistory: false });
                this.patchBoardState({ [endpointRole]: shared.endpoint }, { reason: 'foxhole-trench-shared-rotation-preview', recordHistory: false });
                return true;
            }
            if (!this.patchInteractiveEndpoints(draft => {
                const endpoint = endpointRole === 'start' ? draft.start : draft.end;
                const nextRotation = resolveRotationFromWorldPointer(
                    this,
                    endpoint,
                    pointerWorld,
                    context,
                    endpointRole,
                    pathStyle,
                );
                if (endpointRole === 'start') {
                    draft.start.rotation = nextRotation;
                } else {
                    draft.end.rotation = nextRotation;
                }
            }, {
                reason: 'foxhole-spline-connector-handle-preview',
                recordHistory: false,
            })) return true;
            if (this.usesSocketSnapping()) {
                const targets = this.getSnapTargetsForViewport(context.viewport);
                const reconciliation = this.reconcileAttachmentsAgainstTargets(
                    this.collectSnapSocketPoints(context.viewport),
                    targets,
                );
                session.previewStartAttachment = reconciliation.startAttachment;
                session.previewEndAttachment = reconciliation.endAttachment;
                session.previewTargetAttachmentsByNode = reconciliation.targetAttachmentsByNode;
                session.previewTargets = targets;
                this.applyLiveAttachmentPreview(session, reconciliation, targets);
            }
            return true;
        }

        if (this.usesSocketSnapping()) {
            return this.applySocketSnappingEditableHandleDrag(session, pointerWorld, context);
        }

        const localPoint = this.toLocal(context.viewport.toGlobal(pointerWorld));
        const constraints = getFoxholeSplineConnectorConstraints(this.boardState, pathStyle);

        const syncStraightRotations = (draft: FoxholeSplineConnectorState) => {
            if (pathStyle !== 'straight-telescoping' && pathStyle !== 'endpoints-only') {
                return;
            }

            const { startRotation, endRotation } = resolveStraightConnectorEndpointRotations(
                draft.start,
                draft.end,
                this.boardState.foxholeKey,
            );
            draft.start.rotation = startRotation;
            draft.end.rotation = endRotation;
        };

        if (session.handleId === 'start') {
            this.patchInteractiveEndpoints(draft => {
                const clamped = clampDraggedSplineEndpoint(
                    'start',
                    { ...cloneEndpoint(draft.start), x: localPoint.x, y: localPoint.y },
                    cloneEndpoint(draft.end),
                    constraints,
                );
                draft.start.x = clamped.start.x;
                draft.start.y = clamped.start.y;
                syncStraightRotations(draft);
            }, {
                reason: 'foxhole-spline-connector-handle-preview',
                recordHistory: false,
            });
            return true;
        }

        if (session.handleId === 'end') {
            this.patchInteractiveEndpoints(draft => {
                const clamped = clampDraggedSplineEndpoint(
                    'end',
                    cloneEndpoint(draft.start),
                    { ...cloneEndpoint(draft.end), x: localPoint.x, y: localPoint.y },
                    constraints,
                );
                draft.end.x = clamped.end.x;
                draft.end.y = clamped.end.y;
                syncStraightRotations(draft);
            }, {
                reason: 'foxhole-spline-connector-handle-preview',
                recordHistory: false,
            });
            return true;
        }

        return false;
    }

    buildEditableHandleCommit(session: SplineConnectorEditableSession): BoardNodeEditableMutation | null {
        if (!this.isInteractiveRoadCandidateValid()) {
            this.cancelEditableHandleDrag(session);
            return null;
        }
        const nextSocketAttachments = session.previewSocketAttachments
            ?? this.getNormalizedSocketAttachments();
        const nextPatch = {
            start: cloneEndpoint(this.boardState.start),
            end: cloneEndpoint(this.boardState.end),
            ...(this.usesSocketSnapping()
                ? {
                    startAttachment: session.previewStartAttachment ?? null,
                    endAttachment: session.previewEndAttachment ?? null,
                    socketAttachments: nextSocketAttachments,
                }
                : {}),
        };
        const inversePatch = {
            start: cloneEndpoint(session.initialStart),
            end: cloneEndpoint(session.initialEnd),
            ...(this.usesSocketSnapping()
                ? {
                    startAttachment: session.initialStartAttachment ?? null,
                    endAttachment: session.initialEndAttachment ?? null,
                    socketAttachments: session.initialSocketAttachments,
                }
                : {}),
        };
        const geometryChanged = JSON.stringify({
            start: nextPatch.start,
            end: nextPatch.end,
        }) !== JSON.stringify({
            start: inversePatch.start,
            end: inversePatch.end,
        });
        const attachmentsChanged = this.usesSocketSnapping() && (
            JSON.stringify(session.previewStartAttachment ?? null) !== JSON.stringify(session.initialStartAttachment ?? null)
            || JSON.stringify(session.previewEndAttachment ?? null) !== JSON.stringify(session.initialEndAttachment ?? null)
            || JSON.stringify(nextSocketAttachments) !== JSON.stringify(session.initialSocketAttachments)
        );
        const extraPatches = this.usesSocketSnapping() && session.previewTargetAttachmentsByNode
            ? [...new Set([
                ...(session.previewTargets?.map(target => target.nodeId) ?? []),
                ...(session.initialTargetAttachmentsByNode?.keys() ?? []),
                ...session.previewTargetAttachmentsByNode.keys(),
            ])].flatMap(nodeId => {
                const nextAttachments = session.previewTargetAttachmentsByNode?.get(nodeId)
                    ?? session.initialTargetAttachmentsByNode?.get(nodeId)
                    ?? {};
                const previousAttachments = session.initialTargetAttachmentsByNode?.get(nodeId) ?? {};
                if (JSON.stringify(previousAttachments) === JSON.stringify(nextAttachments)) {
                    return [];
                }
                return [{
                    nodeId,
                    patch: { socketAttachments: nextAttachments },
                    inversePatch: { socketAttachments: previousAttachments },
                }];
            })
            : [];

        if (!geometryChanged && !attachmentsChanged && !extraPatches.length) {
            return null;
        }

        return {
            patch: nextPatch,
            inversePatch,
            reason: 'foxhole-spline-connector-handle-commit',
            label: isPowerlineConnector(this.boardState.foxholeKey) ? 'Edit Power Line' : 'Edit Spline Connector',
            extraPatches: [...extraPatches, ...this.getSharedTrenchRotationCommit(session)],
        };
    }

    private getSharedTrenchRotationCommit(session: SplineConnectorEditableSession) {
        const shared = session.sharedTrenchRotation;
        const partner = shared && this.findBoardNodeById(shared.nodeId);
        return shared && partner instanceof FoxholeSplineConnectorNode ? [{ nodeId: shared.nodeId,
            patch: { [shared.role]: cloneEndpoint(partner.boardState[shared.role]) },
            inversePatch: { [shared.role]: cloneEndpoint(shared.initial) } }] : [];
    }

    cancelEditableHandleDrag(session: SplineConnectorEditableSession): void {
        const shared = session.sharedTrenchRotation;
        const partner = shared && this.findBoardNodeById(shared.nodeId);
        if (shared && partner instanceof FoxholeSplineConnectorNode) {
            partner.patchBoardState({ [shared.role]: cloneEndpoint(shared.initial) }, { reason: 'foxhole-trench-shared-rotation-revert', recordHistory: false });
        }
        this.restoreLiveAttachmentPreview(session);
        this.patchBoardState({
            start: cloneEndpoint(session.initialStart),
            end: cloneEndpoint(session.initialEnd),
            ...(this.usesSocketSnapping()
                ? {
                    startAttachment: session.initialStartAttachment ?? null,
                    endAttachment: session.initialEndAttachment ?? null,
                    socketAttachments: session.initialSocketAttachments,
                }
                : {}),
        }, {
            reason: 'foxhole-spline-connector-handle-revert',
            recordHistory: false,
        });
    }

    resolveMoveSnap(context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0]): BoardNodeMoveSnapResult | null {
        if (
            !this.usesSocketSnapping()
            || this.settingsStore.getValue(FOXHOLE_SOCKET_SNAPPING_SETTING_ID) === false
        ) {
            return null;
        }

        const nodeId = String(this.boardId);
        const origin = context.selectedWorldOrigins.get(nodeId);
        if (!origin) {
            return null;
        }

        const initialRotation = context.selectedInitialRotations.get(nodeId);
        if (!Number.isFinite(initialRotation)) {
            return null;
        }

        // Collect sockets at the pre-drag origin/rotation. findBest applies context.moveX/Y
        // as the candidate absolute move from that origin (same contract as structures).
        const movingSockets = this.collectSnapSocketPoints(
            context.viewport,
            { x: origin.x, y: origin.y },
            Number(initialRotation),
        );
        if (!movingSockets.length) {
            return null;
        }

        const selectedIds = new Set(context.selectedNodeIds.map(String));
        // Prefer the drag-scoped stationary list (already excludes selection). Never snap
        // to co-selected partners — they move rigidly with this connector.
        const stationaryTargets = this.getMoveSnapStationaryTargets(context, selectedIds);
        const targetSockets = stationaryTargets.flatMap(target => target.sockets);

        const match = targetSockets.length
            ? findBestFoxholeSocketSnap({
                movingSockets,
                targetSockets,
                rotatePivot: context.rotatePivot ?? undefined,
                moveX: context.moveX,
                moveY: context.moveY,
                maxDistance: DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
                maxRotationDeltaRadians: Math.PI / 4,
                pointerWorld: context.pointerWorld,
                pointerSocketRadius: DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE * 2.5,
                isTargetSocketAvailable: (movingSocket, targetSocket) => this.areConnectorSnapSocketsAvailable(
                    movingSocket,
                    this.getMoveSnapOccupancyAttachments(),
                    targetSocket,
                    stationaryTargets,
                ),
            })
            : null;

        if (!match) {
            return null;
        }

        return {
            moveX: match.moveX,
            moveY: match.moveY,
            rotationDelta: match.rotationDelta,
            score: match.distance + (Math.abs(match.rotationDelta) * (DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE / Math.PI)),
            data: {
                kind: 'foxhole:spline-connector-socket-snap',
                match,
            } satisfies FoxholeSplineConnectorSocketMoveSnapData,
        };
    }

    resolveRotationSnap(
        context: Parameters<NonNullable<BoardNodeMoveSnapProvider['resolveRotationSnap']>>[0],
    ) {
        if (
            !this.usesSocketSnapping()
            || !context.rotatePivot
            || this.settingsStore.getValue(FOXHOLE_SOCKET_SNAPPING_SETTING_ID) === false
        ) {
            return null;
        }

        const nodeId = String(this.boardId);
        const origin = context.selectedWorldOrigins.get(nodeId);
        const rawRotationDelta = Number(context.rotationDelta ?? 0);
        const initialRotation = context.selectedInitialRotations.get(nodeId);
        if (
            !origin
            || !Number.isFinite(initialRotation)
            || !Number.isFinite(rawRotationDelta)
        ) {
            return null;
        }

        const initialSockets = this.collectSnapSocketPoints(
            context.viewport,
            { x: origin.x, y: origin.y },
            Number(initialRotation),
        );
        if (!initialSockets.length) {
            return null;
        }

        const movingSockets = initialSockets.map(socket => {
            const point = rotatePointAroundPivot(socket, context.rotatePivot!, rawRotationDelta);
            return {
                ...socket,
                x: point.x + context.moveX,
                y: point.y + context.moveY,
                rotation: socket.rotation + rawRotationDelta,
            };
        });

        const selectedIds = new Set(context.selectedNodeIds.map(String));
        const stationaryTargets = this.getMoveSnapStationaryTargets(context, selectedIds);
        const targetSockets = stationaryTargets.flatMap(target => target.sockets);
        if (!targetSockets.length) {
            return null;
        }

        const match = findBestFoxholeSocketSnap({
            movingSockets,
            targetSockets,
            rotatePivot: context.rotatePivot,
            moveX: 0,
            moveY: 0,
            maxRotationDeltaRadians: (DEFAULT_FOXHOLE_SOCKET_ROTATION_SNAP_DEGREES * Math.PI) / 180,
            maxDistance: DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
            isTargetSocketAvailable: (movingSocket, targetSocket) => this.areConnectorSnapSocketsAvailable(
                movingSocket,
                this.getMoveSnapOccupancyAttachments(),
                targetSocket,
                stationaryTargets,
            ),
        });
        if (!match) {
            return null;
        }

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
                kind: 'foxhole:spline-connector-socket-snap',
                match: {
                    ...match,
                    rotationDelta,
                    moveX: match.moveX,
                    moveY: match.moveY,
                },
            } satisfies FoxholeSplineConnectorSocketMoveSnapData,
        };
    }

    syncMoveLiveAttachmentPreview(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
    ): void {
        if (
            !this.usesSocketSnapping()
            || this.settingsStore.getValue(FOXHOLE_SOCKET_SNAPPING_SETTING_ID) === false
        ) {
            return;
        }

        const nodeId = String(this.boardId);
        const origin = context.selectedWorldOrigins.get(nodeId);
        const initialRotation = context.selectedInitialRotations.get(nodeId);
        if (!origin || !Number.isFinite(initialRotation)) {
            return;
        }

        const selectedIds = new Set(context.selectedNodeIds.map(String));
        const stationaryTargets = this.getMoveSnapStationaryTargets(context, selectedIds);
        const effectiveMoveX = context.moveX;
        const effectiveMoveY = context.moveY;
        const effectiveRotationDelta = Number(context.rotationDelta ?? 0);
        const previewTargets = [
            ...stationaryTargets,
            ...this.buildSelectedSnapTargetsForMovePreview(
                context,
                effectiveMoveX,
                effectiveMoveY,
                effectiveRotationDelta,
            ),
        ];
        this.applyMoveLiveAttachmentPreviewAtPose(
            context,
            origin,
            Number(initialRotation),
            previewTargets,
            effectiveMoveX,
            effectiveMoveY,
            effectiveRotationDelta,
        );
    }

    cancelMoveAttachmentPreview(): void {
        const preview = this.moveAttachmentPreview;
        if (!preview) {
            return;
        }

        const previousOwnAttachments = this.getNormalizedSocketAttachments();
        this.patchBoardState({
            startAttachment: preview.initialStartAttachment ?? null,
            endAttachment: preview.initialEndAttachment ?? null,
            socketAttachments: preview.initialSocketAttachments,
        }, {
            reason: 'foxhole-spline-connector-move-attachment-revert',
            recordHistory: false,
        });

        for (const [targetNodeId, attachments] of preview.initialTargetAttachmentsByNode) {
            const target = preview.previewTargets.find(entry => entry.nodeId === targetNodeId);
            const node = (target?.node ?? this.findBoardNodeById(targetNodeId)) as {
                patchBoardState?: (patch: Record<string, unknown>, options?: Record<string, unknown>) => void;
            } | null;
            node?.patchBoardState?.({
                socketAttachments: attachments,
            }, {
                reason: 'foxhole-spline-connector-move-target-attachment-revert',
                recordHistory: false,
            });
        }

        this.restorePartnerEndpointAttachmentsFromOwnSocketMap(
            previousOwnAttachments,
            preview.initialSocketAttachments,
        );

        this.moveAttachmentPreview = null;
    }

    buildMoveCommitPatches(context: BoardNodeMoveCommitContext) {
        if (!this.usesSocketSnapping()) {
            return [];
        }

        const origin = context.selectedWorldOrigins.get(String(this.boardId));
        if (!origin) {
            return [];
        }

        const movedOrigin = this.getFinalMoveWorldOrigin(context, String(this.boardId)) ?? {
            x: origin.x + context.moveX,
            y: origin.y + context.moveY,
        };
        const movedRotation = this.getFinalMoveRotation(context, String(this.boardId))
            ?? (Number.isFinite(context.selectedInitialRotations.get(String(this.boardId)))
                ? Number(context.selectedInitialRotations.get(String(this.boardId))) + Number(context.rotationDelta ?? 0)
                : undefined);
        const movingSockets = this.collectSnapSocketPoints(context.viewport, movedOrigin, movedRotation);
        const targets = this.getSnapTargetsForMoveCommit(context);
        const reconciliation = this.reconcileAttachmentsAgainstTargets(movingSockets, targets);

        const preview = this.moveAttachmentPreview;
        const patches: Array<{
            nodeId: string;
            patch: Record<string, unknown>;
            inversePatch: Record<string, unknown>;
        }> = [];

        const targetNodeIds = new Set([
            ...targets.map(target => target.nodeId),
            ...(preview?.initialTargetAttachmentsByNode.keys() ?? []),
            ...reconciliation.targetAttachmentsByNode.keys(),
        ]);
        for (const targetNodeId of targetNodeIds) {
            const nextAttachments = reconciliation.targetAttachmentsByNode.get(targetNodeId) ?? {};
            const previousAttachments = preview?.initialTargetAttachmentsByNode.get(targetNodeId)
                ?? targets.find(target => target.nodeId === targetNodeId)?.attachments
                ?? {};
            if (JSON.stringify(previousAttachments) === JSON.stringify(nextAttachments)) {
                continue;
            }
            patches.push({
                nodeId: targetNodeId,
                patch: { socketAttachments: nextAttachments },
                inversePatch: { socketAttachments: previousAttachments },
            });
        }

        const previousStart = preview?.initialStartAttachment
            ?? this.getNormalizedEndpointAttachment(this.boardState.startAttachment);
        const previousEnd = preview?.initialEndAttachment
            ?? this.getNormalizedEndpointAttachment(this.boardState.endAttachment);
        const previousSocketAttachments = preview?.initialSocketAttachments
            ?? this.getNormalizedSocketAttachments();
        const nextStart = reconciliation.startAttachment ?? null;
        const nextEnd = reconciliation.endAttachment ?? null;
        const nextSocketAttachments = this.resolveOwnSocketAttachmentsFromTargetReciprocals(
            reconciliation.targetAttachmentsByNode,
        );
        if (
            JSON.stringify(previousStart ?? null) !== JSON.stringify(nextStart)
            || JSON.stringify(previousEnd ?? null) !== JSON.stringify(nextEnd)
            || JSON.stringify(previousSocketAttachments) !== JSON.stringify(nextSocketAttachments)
        ) {
            patches.push({
                nodeId: String(this.boardId),
                patch: {
                    startAttachment: nextStart,
                    endAttachment: nextEnd,
                    socketAttachments: nextSocketAttachments,
                },
                inversePatch: {
                    startAttachment: previousStart ?? null,
                    endAttachment: previousEnd ?? null,
                    socketAttachments: previousSocketAttachments,
                },
            });
        }

        // Live preview already applied the forward state; clear tracking without restoring.
        this.moveAttachmentPreview = null;

        return patches;
    }

    collectSnapSocketPoints(
        viewport: BoardNodeEditableHandleContext['viewport'],
        originOverride?: { x: number; y: number; } | null,
        rotationOverride?: number | null,
    ): FoxholeSocketSnapPoint[] {
        if (!this.usesSocketSnapping()) {
            return [];
        }

        const structure = this.getResolvedStructure();
        if (!structure) {
            return [];
        }

        const endpointSockets = resolveFoxholeConnectorEndpointSockets(structure, {
            startSocketName: this.boardState.startSocketName,
            endSocketName: this.boardState.endSocketName,
        });

        const sockets: FoxholeSocketSnapPoint[] = [];
        const startSocketName = String(this.boardState.startSocketName ?? '').trim();
        const endSocketName = String(this.boardState.endSocketName ?? '').trim();
        const nodeRotation = Number.isFinite(rotationOverride)
            ? Number(rotationOverride)
            : getNodeRotation(this);

        if (startSocketName && endpointSockets.start && hasFoxholeSnapSocketTags(endpointSockets.start.socketTags)) {
            const world = toSplineEndpointWorldPoint(
                this,
                this.boardState.start,
                viewport,
                originOverride,
                nodeRotation,
            );
            sockets.push({
                nodeId: String(this.boardId),
                socketName: startSocketName,
                x: world.x,
                y: world.y,
                rotation: resolveConnectorSocketSnapStemRotation(
                    'start',
                    this.boardState.start.rotation,
                    nodeRotation,
                    this.boardState.foxholeKey,
                ),
                socketTags: endpointSockets.start.socketTags,
            });
        }

        if (endSocketName && endpointSockets.end && hasFoxholeSnapSocketTags(endpointSockets.end.socketTags)) {
            const world = toSplineEndpointWorldPoint(
                this,
                this.boardState.end,
                viewport,
                originOverride,
                nodeRotation,
            );
            sockets.push({
                nodeId: String(this.boardId),
                socketName: endSocketName,
                x: world.x,
                y: world.y,
                rotation: resolveConnectorSocketSnapStemRotation(
                    'end',
                    this.boardState.end.rotation,
                    nodeRotation,
                    this.boardState.foxholeKey,
                ),
                socketTags: endpointSockets.end.socketTags,
            });
        }

        const sideSocketTemplate = endpointSockets.start ?? endpointSockets.end;
        if (sideSocketTemplate && hasFoxholeSnapSocketTags(sideSocketTemplate.socketTags)) {
            for (const sideSocket of resolveFacilityPipeSideSocketPlacements(
                this.boardState.start,
                this.boardState.end,
                this.getPathConstraints(),
                this.getResolvedPathStyle(),
                this.boardState.foxholeKey,
                { lateralOffset: this.getFacilityPipeSideSocketLateralOffset() },
            )) {
                const world = toSplineEndpointWorldPoint(
                    this,
                    {
                        x: sideSocket.x,
                        y: sideSocket.y,
                        rotation: sideSocket.rotation,
                    },
                    viewport,
                    originOverride,
                    nodeRotation,
                );
                sockets.push({
                    nodeId: String(this.boardId),
                    socketName: sideSocket.name,
                    x: world.x,
                    y: world.y,
                    rotation: sideSocket.rotation + nodeRotation,
                    socketTags: sideSocketTemplate.socketTags,
                });
            }
        }

        return sockets;
    }

    /**
     * Sampled rail centerline in board-world space for train origin snapping.
     * Returns an empty array for non-rail connectors.
     */
    collectRailTrackWorldPathPoints(
        viewport: BoardNodeEditableHandleContext['viewport'],
    ): Array<{ x: number; y: number; }> {
        if (!usesRailTrackSpline(this.boardState.foxholeKey)) {
            return [];
        }

        const sampled = this.getSampledPath();
        if (sampled.points.length < 1) {
            return [];
        }

        return sampled.points.map(point => {
            const world = toBoardWorldPoint(this, new PIXI.Point(point.x, point.y), viewport);
            return { x: world.x, y: world.y };
        });
    }

    override onBoardUnmounted(): void {
        unregisterFoxholeRoofHoverHost(this);
        this.selectionStateWatcher?.();
        this.selectionStateWatcher = null;
        this.canvasToolColorWatcher?.();
        this.canvasToolColorWatcher = null;
        this.settingsWatcher?.();
        this.settingsWatcher = null;
        this.modificationHoverPreviewWatcher?.();
        this.modificationHoverPreviewWatcher = null;
        resetPowerlineMotion(this.powerlineMotion);
        this.redrawPowerline();
    }

    private bindCanvasToolColorWatcher(): void {
        if (this.canvasToolColorWatcher) {
            return;
        }

        this.canvasToolColorWatcher = subscribeToCanvasToolAccentColor(this.settingsStore, () => {
            this.syncFromState();
        });
    }

    private bindSelectionState(): void {
        if (this.selectionStateWatcher) {
            return;
        }

        this.selectionStateWatcher = subscribeToNixieSelectionState(String(this.boardId), selected => {
            this.isSelected = selected;
            this.syncFromState();
        });
    }

    private getResolvedAsset(): FoxholeStructureAsset | undefined {
        const foxholeKey = String(this.boardState.foxholeKey ?? '').trim();
        return foxholeKey ? this.boardDefinition.assetResolver?.(foxholeKey) : undefined;
    }

    private getResolvedStructure() {
        const foxholeKey = String(this.boardState.foxholeKey ?? '').trim();
        return foxholeKey ? this.boardDefinition.structureResolver?.(foxholeKey) : undefined;
    }

    private getResolvedRenderKey(): string {
        const targetKey = resolveStructureAssetHoverTargetKey(activeNixieStructureModificationHoverPreview.value, String(this.boardId));
        return targetKey && this.boardDefinition.assetResolver?.(targetKey) && this.boardDefinition.structureResolver?.(targetKey)
            ? targetKey : String(this.boardState.foxholeKey ?? '').trim();
    }

    private getResolvedRenderAsset(): FoxholeStructureAsset | undefined {
        return this.boardDefinition.assetResolver?.(this.getResolvedRenderKey());
    }

    private getResolvedRenderLayers(): FoxholeStructureRenderLayerAsset[] {
        if (this.boardState.destroyed === true && trenchConnectorTier(this.boardState.foxholeKey)) {
            const destroyedKey = this.getResolvedAsset()?.destroyedStructureId;
            return destroyedKey ? this.boardDefinition.assetResolver?.(destroyedKey)?.renderLayers ?? [] : [];
        }
        const layers = resolveFoxholeSplineConnectorRenderLayers({
            asset: this.getResolvedAsset(),
            targetAsset: this.getResolvedRenderAsset(),
            modificationVariantIds: this.boardState.modificationVariantIds,
            hoverPreview: activeNixieStructureModificationHoverPreview.value,
            nodeId: String(this.boardId),
        });
        if (layers.length || !/^sandbag(?:half|full)spline$/iu.test(this.boardState.foxholeKey)) {
            return layers;
        }
        const structure = this.getResolvedStructure();
        const textureUrl = structure?.variants.default?.textureUrl;
        if (!textureUrl || !structure?.sprite.width || !structure.sprite.height) {
            return layers;
        }
        return [{ id: 'span', textureUrl, width: structure.sprite.width, height: structure.sprite.height,
            anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, componentName: null, componentTags: [] }];
    }

    private getResolvedUpgradeHoverPreviewAlpha(): number {
        return resolveFoxholeSplineConnectorUpgradeHoverPreviewAlpha({
            asset: this.getResolvedAsset(),
            targetAsset: this.getResolvedRenderAsset(),
            modificationVariantIds: this.boardState.modificationVariantIds,
            hoverPreview: activeNixieStructureModificationHoverPreview.value,
            nodeId: String(this.boardId),
        });
    }

    private bindModificationHoverPreviewWatcher(): void {
        if (this.modificationHoverPreviewWatcher) {
            return;
        }

        this.modificationHoverPreviewWatcher = watch(
            () => {
                const preview = activeNixieStructureModificationHoverPreview.value;
                if (!preview) {
                    return null;
                }

                const neighborTarget = resolveStructureAssetHoverTargetKey(preview, preview.nodeId);
                const affectsNeighbor = neighborTarget && Object.values(this.getEndpointOccupancyAttachments())
                    .some(attachment => String(attachment.nodeId) === preview.nodeId);
                if (preview.nodeId !== String(this.boardId) && !affectsNeighbor) return null;

                return `${preview.nodeId}:${preview.slotId}:${preview.variantId}:${preview.mode ?? ''}:${preview.targetAssetKey ?? ''}`;
            },
            () => {
                if (!this.destroyed) {
                    this.syncFromState();
                    this.refreshAttachedStructureOverlays();
                }
            },
        );
    }

    /** A connector's finished/site state controls the attached structures' end walls. */
    private refreshAttachedStructureOverlays(): void {
        if (!isTrenchConnector(this.boardState.foxholeKey)) {
            return;
        }
        markFoxholeStructureOverlaysDirtyByIds(Object.values(this.getEndpointOccupancyAttachments())
            .map(attachment => String(attachment.nodeId)));
    }

    private getResolvedConnector() {
        return this.getResolvedStructure()?.connector;
    }

    private getResolvedMaxArcAngleDeg(): number | undefined {
        if (Number.isFinite(this.boardState.maxArcAngleDeg)) {
            return this.boardState.maxArcAngleDeg;
        }

        const connectorMaxArc = this.getResolvedConnector()?.maxArcAngleDeg;
        return Number.isFinite(connectorMaxArc) ? connectorMaxArc : undefined;
    }

    private getResolvedPathStyle() {
        return resolveEffectiveConnectorPathStyle(
            resolveConnectorPathStyle(this.getResolvedConnector()),
            this.boardState.foxholeKey,
        );
    }

    private getPathConstraints(state = this.boardState) {
        const connector = this.getResolvedConnector();
        return resolveFoxholeSplinePathConstraints(state, this.getResolvedPathStyle(), connector?.maxBufferCm ?? connector?.minLengthCm ?? 0);
    }

    private getGuidePathSample() {
        return resolveFoxholeSplineGuidePath(this.boardState, this.getPathConstraints(), this.getResolvedPathStyle());
    }

    private drawPathGuide(alpha: number, guideColor: number): void {
        drawFoxholeSplinePathGuide(this.pathGuideGraphics, this.getGuidePathSample().points, alpha, guideColor);
    }

    private getSampledPath() {
        return sampleConnectorPath(
            this.boardState.start,
            this.boardState.end,
            this.getPathConstraints(),
            this.getResolvedPathStyle(),
            { foxholeKey: this.boardState.foxholeKey },
        );
    }

    private isCurrentPathViable(sampled = this.getSampledPath()): boolean {
        if (isTrenchConnector(this.boardState.foxholeKey)) {
            return isTrenchConnectorViable(this.boardState.start, this.boardState.end);
        }
        if (isUndergroundPipe(this.boardState.foxholeKey)) {
            return true;
        }

        const pathStyle = this.getResolvedPathStyle();
        const constraints = this.getPathConstraints();
        const connector = this.getResolvedConnector();
        const extensionPath = usesPipeExtensionPath(pathStyle, this.boardState.foxholeKey);
        const extensionGeometryViable = !extensionPath
            || isExtensionPipeGeometryViable(this.boardState.start, this.boardState.end, constraints);

        return extensionGeometryViable && isSplinePathViable(
            this.boardState.start,
            this.boardState.end,
            constraints,
            sampled,
            {
                enforceLengthLimits: false,
                enforceMinRadius: connector?.enforceSplineModeCornerRadius === true,
                socketFacingEndRotation: usesSocketFacingEndRotation(this.boardState.foxholeKey),
            },
        );
    }

    private isBlueprintVisualEnabled(): boolean {
        return this.boardState.blueprint === true
            && this.getResolvedAsset()?.canBlueprint === true;
    }

    private getResolvedVisualTint(): number {
        if (shouldTintInvalidSplinePath(this.boardState.foxholeKey) && !this.isCurrentPathViable()) {
            return SPLINE_PATH_INVALID_TINT;
        }

        if (this.isBlueprintVisualEnabled()) {
            return BLUEPRINT_SPLINE_CONNECTOR_TINT;
        }

        const baseTint = this.boardState.tint;
        return typeof baseTint === 'number' && Number.isFinite(baseTint)
            ? (baseTint >>> 0)
            : SPLINE_CONNECTOR_VALID_TINT;
    }

    private getResolvedVisualFilters(target: PIXI.Container): PIXI.Filter[] | null {
        if (this.isBlueprintVisualEnabled()) {
            return getBlueprintSplineConnectorFiltersForTarget(target);
        }
        const brightness = this.boardState.brightness;
        if (typeof brightness === 'number' && Number.isFinite(brightness) && brightness !== 1) {
            return getBrightnessSplineConnectorFiltersForTarget(target, brightness);
        }
        return null;
    }

    private applyVisualTint(target: PIXI.Sprite | PIXI.Mesh, alpha: number): void {
        target.tint = this.getResolvedVisualTint();
        target.alpha = alpha;
        target.filters = this.getResolvedVisualFilters(target);
    }

    private clearOverlay(container: PIXI.Container): void {
        container.removeChildren().forEach(child => child.destroy());
    }

    private syncRampOverlay(
        layers: readonly FoxholeStructureRenderLayerAsset[],
        trimPositions: ReturnType<typeof resolveConnectorTrimPositions>,
        alpha: number,
    ): void {
        const backRampLayer = getLayerById(layers, 'backramp');
        const frontRampLayer = getLayerById(layers, 'frontramp');
        const endpointOccupancyAttachments = this.getEndpointOccupancyAttachments();
        const startSocketName = String(this.boardState.startSocketName ?? '').trim();
        const endSocketName = String(this.boardState.endSocketName ?? '').trim();
        const backEndpointAttached = Boolean(startSocketName && endpointOccupancyAttachments[startSocketName]);
        const frontEndpointAttached = Boolean(endSocketName && endpointOccupancyAttachments[endSocketName]);

        this.clearOverlay(this.trimOverlay);

        if (backRampLayer && !backEndpointAttached) {
            const sprite = this.createRampSprite(backRampLayer, 'back');
            this.positionTrimSprite(
                sprite,
                backRampLayer,
                trimPositions.backTrim,
                alpha,
            );
            this.trimOverlay.addChild(sprite);
        }

        if (frontRampLayer && !frontEndpointAttached) {
            const sprite = this.createRampSprite(frontRampLayer, 'front');
            this.positionTrimSprite(
                sprite,
                frontRampLayer,
                trimPositions.frontTrim,
                alpha,
            );
            this.trimOverlay.addChild(sprite);
        }
    }

    private syncRampOverlayFromState(): void {
        const layers = this.getResolvedRenderLayers();
        const backEndCapLayer = getConnectorEndCapLayer(layers, 'back', this.boardState.foxholeKey);
        const frontEndCapLayer = getConnectorEndCapLayer(layers, 'front', this.boardState.foxholeKey);
        const trimPositions = resolveConnectorTrimPositions(
            this.boardState.start,
            this.boardState.end,
            this.getResolvedPathStyle(),
            this.getResolvedConnector(),
            backEndCapLayer,
            frontEndCapLayer,
            { foxholeKey: this.boardState.foxholeKey },
        );
        const previewAlpha = this.getResolvedUpgradeHoverPreviewAlpha();
        const alpha = Math.max(0, Math.min(1, this.boardState.alpha ?? 1)) * previewAlpha;
        this.syncRampOverlay(layers, trimPositions, alpha);
    }

    private createRampSprite(
        layer: FoxholeStructureRenderLayerAsset,
        role: 'back' | 'front',
    ): PIXI.Sprite {
        const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        sprite.eventMode = 'none';
        const anchor = resolveConnectorRampSpriteAnchor(layer, role);
        sprite.anchor.set(anchor.x, anchor.y);
        sprite.scale.set(FOXHOLE_BOARD_SPRITE_SCALE);
        return sprite;
    }

    private createTrimSprite(
        layer: FoxholeStructureRenderLayerAsset,
        role: 'back' | 'front',
        placement: 'handle' | 'socket-edge' = 'socket-edge',
    ): PIXI.Sprite {
        const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        sprite.eventMode = 'none';
        const anchor = resolveConnectorTrimSpriteAnchor(layer, role, {
            foxholeKey: this.boardState.foxholeKey,
            placement,
        });
        sprite.anchor.set(anchor.x, anchor.y);
        sprite.scale.set(FOXHOLE_BOARD_SPRITE_SCALE);
        return sprite;
    }

    private createIntervalMarkerSprite(_layer: FoxholeStructureRenderLayerAsset): PIXI.Sprite {
        const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        sprite.eventMode = 'none';
        sprite.anchor.set(INTERVAL_MARKER_SPRITE_ANCHOR.x, INTERVAL_MARKER_SPRITE_ANCHOR.y);
        sprite.scale.set(FOXHOLE_BOARD_SPRITE_SCALE);
        return sprite;
    }

    private positionIntervalMarkerSprite(
        sprite: PIXI.Sprite,
        layer: FoxholeStructureRenderLayerAsset,
        referenceLayer: FoxholeStructureRenderLayerAsset | undefined,
        position: { x: number; y: number; rotation: number; meshIndex: number; },
        alpha: number,
    ): void {
        const placement = resolveIntervalMarkerSpritePosition(
            position,
            layer,
            referenceLayer,
            this.getResolvedConnector(),
        );
        sprite.position.set(placement.x, placement.y);
        sprite.rotation = position.rotation;
        this.applyVisualTint(sprite, alpha);
        this.applyCachedLayerTexture(sprite, layer);
        void this.ensureLayerTextureLoaded(sprite, layer, this.textureSyncGeneration);
    }

    private applyCachedLayerTexture(sprite: PIXI.Sprite, layer: FoxholeStructureRenderLayerAsset): boolean {
        const textureUrl = String(layer.textureUrl ?? '').trim();
        if (!textureUrl) {
            return false;
        }

        const cached = getCachedTexture(textureUrl);
        if (!cached || cached.destroyed) {
            return false;
        }

        if (sprite.texture !== cached) {
            sprite.texture = cached;
        }
        return true;
    }

    private getCachedSpanRibbonTexture(layer: FoxholeStructureRenderLayerAsset): PIXI.Texture | null {
        const textureUrl = String(layer.textureUrl ?? '').trim();
        if (!textureUrl) {
            return null;
        }

        const texture = getCachedTexture(textureUrl);
        if (!texture || texture.destroyed) {
            return null;
        }

        configureSpanRibbonTexture(texture);
        return texture;
    }

    private async ensureLayerTextureLoaded(sprite: PIXI.Sprite, layer: FoxholeStructureRenderLayerAsset, generation: number): Promise<void> {
        const textureUrl = String(layer.textureUrl ?? '').trim();
        if (!textureUrl) {
            return;
        }

        if (this.applyCachedLayerTexture(sprite, layer)) {
            return;
        }

        const loadedTexture = await loadFoxholeTexture(textureUrl);
        if (!loadedTexture || loadedTexture.destroyed || sprite.destroyed || generation !== this.textureSyncGeneration) {
            return;
        }

        const textureChanged = sprite.texture !== loadedTexture;
        if (textureChanged) {
            sprite.texture = loadedTexture;
        }

        // Selection bounds skip EMPTY textures; refresh once the trim/ramp texture lands.
        if (textureChanged && this.isSelected && !this.destroyed) {
            this.touchBoard('trim-texture-loaded', { recordHistory: false });
        }
    }

    private positionTrimSprite(
        sprite: PIXI.Sprite,
        layer: FoxholeStructureRenderLayerAsset,
        position: { x: number; y: number; rotation: number; },
        alpha: number,
    ): void {
        sprite.position.set(position.x, position.y);
        sprite.rotation = position.rotation;
        this.applyVisualTint(sprite, alpha);
        this.applyCachedLayerTexture(sprite, layer);
        void this.ensureLayerTextureLoaded(sprite, layer, this.textureSyncGeneration);
    }

    private destroyUnderlayMesh(): void {
        if (!this.underlayMesh) {
            return;
        }

        this.underlayOverlay.removeChild(this.underlayMesh);
        this.underlayMesh.geometry?.destroy();
        this.underlayMesh.destroy();
        this.underlayMesh = null;
    }

    private destroySpanMesh(): void {
        this.spanMeshIsTrenchBuildSite = false;
        if (!this.spanMesh) {
            return;
        }

        this.spanOverlay.removeChild(this.spanMesh);
        this.spanMesh.geometry?.destroy();
        this.spanMesh.destroy();
        this.spanMesh = null;
    }

    private destroyWallBarbedWireMesh(): void {
        if (!this.wallBarbedWireMesh) {
            return;
        }

        this.wallBarbedWireOverlay.removeChild(this.wallBarbedWireMesh);
        this.wallBarbedWireMesh.geometry?.destroy();
        this.wallBarbedWireMesh.destroy();
        this.wallBarbedWireMesh = null;
    }

    private destroyIntervalMarkerSprites(): void {
        for (const child of [...this.spanOverlay.children]) {
            if (child !== this.spanMesh && child !== this.trenchVisual) child.destroy();
        }
    }

    private syncIntervalMarkerSprites(alpha: number): void {
        const connector = this.getResolvedConnector();
        const pathStyle = this.getResolvedPathStyle();
        const layers = this.getResolvedRenderLayers();
        const markerLayers = resolveIntervalMarkerVariantIds(
            layers.map(layer => layer.id),
            resolveConnectorBehavior(this.boardState.foxholeKey, connector).tankStop,
        ).map(id => getLayerById(layers, id))
            .filter((layer): layer is FoxholeStructureRenderLayerAsset => layer != null);

        this.destroySpanMesh();
        this.destroyIntervalMarkerSprites();
        if (!markerLayers.length) {
            return;
        }

        const pathSample = this.getSampledPath();
        if (usesMineSplineConnector(this.boardState.foxholeKey, connector)) {
            const referenceLayer = markerLayers[0];
            const meshConfigs = connector?.meshConfigs ?? [];
            for (const layerIndex of markerLayers.map((_, index) => index).reverse()) {
                const layer = markerLayers[layerIndex];
                if (!layer) {
                    continue;
                }

                const config = meshConfigs[layerIndex] ?? meshConfigs[0];
                const markerSamples = resolveMeshConfigIntervalMarkerSamples(pathSample, config);
                for (const [markerIndex, marker] of markerSamples.entries()) {
                    const positionedMarker = resolveMineSplineMarkerSample(
                        marker,
                        config,
                        markerIndex,
                        this.mineMarkerRotationSeed,
                    );
                    const sprite = this.createIntervalMarkerSprite(layer);
                    this.positionIntervalMarkerSprite(sprite, layer, referenceLayer, positionedMarker, alpha);
                    this.spanOverlay.addChild(sprite);
                }
            }
            return;
        }

        const markerSamples = resolveIntervalMarkerSamples(
            pathSample,
            connector,
            pathStyle,
            markerLayers.length,
        );

        const referenceLayer = markerLayers[0];
        for (const marker of markerSamples) {
            const layer = markerLayers[marker.meshIndex];
            if (!layer) {
                continue;
            }

            const sprite = this.createIntervalMarkerSprite(layer);
            this.positionIntervalMarkerSprite(sprite, layer, referenceLayer, marker, alpha);
            this.spanOverlay.addChild(sprite);
        }
    }

    private syncWallMiddlePillars(
        layers: readonly FoxholeStructureRenderLayerAsset[],
        alpha: number,
    ): void {
        this.clearOverlay(this.wallMiddlePillarOverlay);

        const waterWall = isWaterWallSpline(this.boardState.foxholeKey);
        const layer = getLayerById(layers, waterWall ? 'backtrim' : 'middlepillars');
        if (!layer) {
            return;
        }

        const config = resolveLandWallLayerMeshConfig(this.getResolvedConnector(), 'middlepillars');
        const markerSamples = waterWall
            ? resolveWaterWallBuoys(this.boardState.start, this.boardState.end, this.getResolvedConnector()?.meshConfigs?.[1])
            : isBarbedWireFence(this.boardState.foxholeKey)
                ? resolveBarbedWireFencePosts(this.getSampledPath(), this.getResolvedConnector()?.meshConfigs?.[2])
                    .map(marker => ({ ...marker, meshIndex: 0 }))
            : resolveCenteredMeshConfigIntervalBoundarySamples(this.getSampledPath(), config);
        for (const marker of markerSamples) {
            const postLayer = waterWall && 'role' in marker && marker.role === 'front'
                ? getLayerById(layers, 'fronttrim') ?? layer
                : 'bend' in marker && marker.bend
                    ? getLayerById(layers, 'backtrim') ?? layer
                    : layer;
            const sprite = this.createIntervalMarkerSprite(postLayer);
            this.positionIntervalMarkerSprite(sprite, postLayer, postLayer, marker, alpha);
            this.wallMiddlePillarOverlay.addChild(sprite);
        }
    }

    private syncWallBarbedWireMesh(
        layer: FoxholeStructureRenderLayerAsset,
        alpha: number,
        texturePixelWidth?: number,
    ): void {
        const cachedTexture = this.getCachedSpanRibbonTexture(layer);
        const resolvedTexturePixelWidth = texturePixelWidth ?? cachedTexture?.width;
        const connector = this.getResolvedConnector();
        const pathStyle = this.getResolvedPathStyle();
        const geometry = buildSplineRibbonMeshGeometry({
            spanLayer: layer,
            textureMapping: resolveConnectorSpanTextureMapping(layer, connector, resolvedTexturePixelWidth, pathStyle, {
                foxholeKey: this.boardState.foxholeKey,
            }),
            perpendicularOffset: 0,
            startInset: 0,
            endInset: 0,
            pathSample: this.getSampledPath(),
            centerTextureRepeats: true,
        }, this.boardState.start, this.boardState.end, this.getPathConstraints());

        this.destroyWallBarbedWireMesh();
        if (!geometry) {
            return;
        }

        const mesh = new PIXI.Mesh({
            geometry,
            texture: cachedTexture ?? PIXI.Texture.EMPTY,
        });
        mesh.eventMode = 'none';
        this.applyVisualTint(mesh, alpha);
        this.wallBarbedWireMesh = mesh;
        this.wallBarbedWireOverlay.addChild(mesh);
        void this.ensureWallBarbedWireMeshTextureLoaded(layer, alpha, this.textureSyncGeneration);
    }

    private refreshWallBarbedWireMeshGeometry(
        layer: FoxholeStructureRenderLayerAsset,
        texturePixelWidth: number,
        generation: number,
    ): void {
        const mesh = this.wallBarbedWireMesh;
        if (!mesh || generation !== this.textureSyncGeneration) {
            return;
        }

        const connector = this.getResolvedConnector();
        const pathStyle = this.getResolvedPathStyle();
        const geometry = buildSplineRibbonMeshGeometry({
            spanLayer: layer,
            textureMapping: resolveConnectorSpanTextureMapping(layer, connector, texturePixelWidth, pathStyle, {
                foxholeKey: this.boardState.foxholeKey,
            }),
            perpendicularOffset: 0,
            startInset: 0,
            endInset: 0,
            pathSample: this.getSampledPath(),
            centerTextureRepeats: true,
        }, this.boardState.start, this.boardState.end, this.getPathConstraints());

        if (!geometry) {
            return;
        }

        mesh.geometry?.destroy();
        mesh.geometry = geometry;
    }

    private async ensureWallBarbedWireMeshTextureLoaded(
        layer: FoxholeStructureRenderLayerAsset,
        alpha: number,
        generation: number,
    ): Promise<void> {
        const mesh = this.wallBarbedWireMesh;
        const textureUrl = String(layer.textureUrl ?? '').trim();
        if (!mesh || !textureUrl) {
            return;
        }

        const loadedTexture = await loadFoxholeTexture(textureUrl);
        if (!loadedTexture || loadedTexture.destroyed || mesh.destroyed || generation !== this.textureSyncGeneration) {
            return;
        }

        configureSpanRibbonTexture(loadedTexture);
        this.refreshWallBarbedWireMeshGeometry(layer, loadedTexture.width, generation);

        if (mesh.texture !== loadedTexture) {
            mesh.texture = loadedTexture;
        }

        this.applyVisualTint(mesh, alpha);
    }

    private syncUnderlayMesh(
        underlayLayer: FoxholeStructureRenderLayerAsset,
        alpha: number,
        texturePixelWidth?: number,
    ): void {
        const cachedTexture = this.getCachedSpanRibbonTexture(underlayLayer);
        const resolvedTexturePixelWidth = texturePixelWidth ?? cachedTexture?.width;
        const connector = this.getResolvedConnector();
        const pathStyle = this.getResolvedPathStyle();
        const constraints = this.getPathConstraints();
        const pathSample = this.getSampledPath();
        const geometry = buildSplineRibbonMeshGeometry({
            spanLayer: underlayLayer,
            textureMapping: resolveConnectorSpanTextureMapping(underlayLayer, connector, resolvedTexturePixelWidth, pathStyle),
            startInset: 0,
            endInset: 0,
            pathSample,
        }, this.boardState.start, this.boardState.end, constraints);

        this.destroyUnderlayMesh();
        if (!geometry) {
            return;
        }

        const mesh = new PIXI.Mesh({
            geometry,
            texture: cachedTexture ?? PIXI.Texture.EMPTY,
        });
        mesh.eventMode = 'none';
        this.applyVisualTint(mesh, alpha);
        this.underlayMesh = mesh;
        this.underlayOverlay.addChild(mesh);
        void this.ensureUnderlayMeshTextureLoaded(underlayLayer, alpha, this.textureSyncGeneration);
    }

    private refreshUnderlayMeshGeometry(
        underlayLayer: FoxholeStructureRenderLayerAsset,
        texturePixelWidth: number,
        generation: number,
    ): void {
        const mesh = this.underlayMesh;
        if (!mesh || generation !== this.textureSyncGeneration) {
            return;
        }

        const connector = this.getResolvedConnector();
        const pathStyle = this.getResolvedPathStyle();
        const constraints = this.getPathConstraints();
        const pathSample = this.getSampledPath();
        const geometry = buildSplineRibbonMeshGeometry({
            spanLayer: underlayLayer,
            textureMapping: resolveConnectorSpanTextureMapping(underlayLayer, connector, texturePixelWidth, pathStyle),
            startInset: 0,
            endInset: 0,
            pathSample,
        }, this.boardState.start, this.boardState.end, constraints);

        if (!geometry) {
            return;
        }

        mesh.geometry?.destroy();
        mesh.geometry = geometry;
    }

    private async ensureUnderlayMeshTextureLoaded(
        underlayLayer: FoxholeStructureRenderLayerAsset,
        alpha: number,
        generation: number,
    ): Promise<void> {
        const mesh = this.underlayMesh;
        const textureUrl = String(underlayLayer.textureUrl ?? '').trim();
        if (!mesh || !textureUrl) {
            return;
        }

        const loadedTexture = await loadFoxholeTexture(textureUrl);
        if (!loadedTexture || loadedTexture.destroyed || mesh.destroyed || generation !== this.textureSyncGeneration) {
            return;
        }

        configureSpanRibbonTexture(loadedTexture);

        this.refreshUnderlayMeshGeometry(underlayLayer, loadedTexture.width, generation);

        if (mesh.texture !== loadedTexture) {
            mesh.texture = loadedTexture;
        }

        this.applyVisualTint(mesh, alpha);
    }

    private syncSpanMesh(
        spanLayer: FoxholeStructureRenderLayerAsset,
        backtrimLayer: FoxholeStructureRenderLayerAsset | undefined,
        fronttrimLayer: FoxholeStructureRenderLayerAsset | undefined,
        alpha: number,
        texturePixelWidth?: number,
    ): void {
        const cachedTexture = this.getCachedSpanRibbonTexture(spanLayer);
        const connector = this.getResolvedConnector();
        const textureSlicing = resolveConnectorSplineTextureSlicing(this.boardState.foxholeKey, spanLayer, connector?.meshConfigs?.[0]?.splineMaterialScaling);
        if (cachedTexture && textureSlicing) {
            configureSpanRibbonTexture(cachedTexture, 'clamp-to-edge');
        }
        const resolvedTexturePixelWidth = texturePixelWidth ?? cachedTexture?.width;
        const pathStyle = this.getResolvedPathStyle();
        const constraints = this.getPathConstraints();
        const pathSample = this.getSampledPath();
        const trimInsets = isWaterWallSpline(this.boardState.foxholeKey)
            ? resolveWaterWallNetInsets(this.boardState.start, this.boardState.end, connector?.meshConfigs?.[1])
            : resolveConnectorSpanInsets(pathStyle, connector, backtrimLayer, fronttrimLayer, {
            foxholeKey: this.boardState.foxholeKey,
        });
        const geometry = buildSplineRibbonMeshGeometry({
            spanLayer,
            textureMapping: resolveConnectorSpanTextureMapping(spanLayer, connector, resolvedTexturePixelWidth, pathStyle, {
                foxholeKey: this.boardState.foxholeKey,
            }),
            perpendicularOffset: usesLayeredLandWallConnector(this.boardState.foxholeKey) ? 0 : undefined,
            startInset: trimInsets.startInset,
            endInset: trimInsets.endInset,
            pathSample,
            centerTextureRepeats: usesLayeredLandWallConnector(this.boardState.foxholeKey),
            textureSlicing,
            textureMaterialScale: connector?.meshConfigs?.[0]?.splineMaterialScaling,
        }, this.boardState.start, this.boardState.end, constraints);

        this.destroySpanMesh();
        if (!geometry) {
            return;
        }

        const mesh = new PIXI.Mesh({
            geometry,
            texture: cachedTexture ?? PIXI.Texture.EMPTY,
        });
        mesh.eventMode = 'none';
        this.applyVisualTint(mesh, alpha);
        this.spanMesh = mesh;
        this.spanOverlay.addChild(mesh);
        void this.ensureSpanMeshTextureLoaded(spanLayer, backtrimLayer, fronttrimLayer, alpha, this.textureSyncGeneration);
    }

    private refreshSpanMeshGeometry(
        spanLayer: FoxholeStructureRenderLayerAsset,
        backtrimLayer: FoxholeStructureRenderLayerAsset | undefined,
        fronttrimLayer: FoxholeStructureRenderLayerAsset | undefined,
        texturePixelWidth: number,
        generation: number,
    ): void {
        const mesh = this.spanMesh;
        if (!mesh || generation !== this.textureSyncGeneration) {
            return;
        }

        const connector = this.getResolvedConnector();
        const pathStyle = this.getResolvedPathStyle();
        const constraints = this.getPathConstraints();
        const pathSample = this.getSampledPath();
        const trimInsets = isWaterWallSpline(this.boardState.foxholeKey)
            ? resolveWaterWallNetInsets(this.boardState.start, this.boardState.end, connector?.meshConfigs?.[1])
            : resolveConnectorSpanInsets(pathStyle, connector, backtrimLayer, fronttrimLayer, {
            foxholeKey: this.boardState.foxholeKey,
        });
        const geometry = buildSplineRibbonMeshGeometry({
            spanLayer,
            textureMapping: resolveConnectorSpanTextureMapping(spanLayer, connector, texturePixelWidth, pathStyle, {
                foxholeKey: this.boardState.foxholeKey,
            }),
            perpendicularOffset: usesLayeredLandWallConnector(this.boardState.foxholeKey) ? 0 : undefined,
            startInset: trimInsets.startInset,
            endInset: trimInsets.endInset,
            pathSample,
            centerTextureRepeats: usesLayeredLandWallConnector(this.boardState.foxholeKey),
            textureSlicing: resolveConnectorSplineTextureSlicing(this.boardState.foxholeKey, spanLayer, connector?.meshConfigs?.[0]?.splineMaterialScaling),
            textureMaterialScale: connector?.meshConfigs?.[0]?.splineMaterialScaling,
        }, this.boardState.start, this.boardState.end, constraints);

        if (!geometry) {
            return;
        }

        mesh.geometry?.destroy();
        mesh.geometry = geometry;
    }

    private async ensureSpanMeshTextureLoaded(
        spanLayer: FoxholeStructureRenderLayerAsset,
        backtrimLayer: FoxholeStructureRenderLayerAsset | undefined,
        fronttrimLayer: FoxholeStructureRenderLayerAsset | undefined,
        alpha: number,
        generation: number,
    ): Promise<void> {
        const mesh = this.spanMesh;
        const textureUrl = String(spanLayer.textureUrl ?? '').trim();
        if (!mesh || !textureUrl) {
            return;
        }

        const loadedTexture = await loadFoxholeTexture(textureUrl);
        if (!loadedTexture || loadedTexture.destroyed || mesh.destroyed || generation !== this.textureSyncGeneration) {
            return;
        }

        configureSpanRibbonTexture(loadedTexture,
            resolveConnectorSplineTextureSlicing(this.boardState.foxholeKey, spanLayer) ? 'clamp-to-edge' : 'repeat');

        this.refreshSpanMeshGeometry(spanLayer, backtrimLayer, fronttrimLayer, loadedTexture.width, generation);

        if (mesh.texture !== loadedTexture) {
            mesh.texture = loadedTexture;
        }

        this.applyVisualTint(mesh, alpha);
    }

    private syncContactShadow(
        spanLayer: FoxholeStructureRenderLayerAsset | undefined,
        backEndCapLayer: FoxholeStructureRenderLayerAsset | undefined,
        frontEndCapLayer: FoxholeStructureRenderLayerAsset | undefined,
        alpha: number,
    ): void {
        const graphics = this.contactShadowGraphics;
        graphics.clear();
        if (!hasSplineContactShadow(this.boardState.foxholeKey) || !spanLayer) {
            return;
        }

        const pathStyle = this.getResolvedPathStyle();
        const connector = this.getResolvedConnector();
        if (!shouldRenderConnectorSpan(pathStyle, connector, this.boardState.foxholeKey)) {
            return;
        }

        const insets = isWaterWallSpline(this.boardState.foxholeKey)
            ? resolveWaterWallNetInsets(this.boardState.start, this.boardState.end, connector?.meshConfigs?.[1])
            : resolveConnectorSpanInsets(pathStyle, connector, backEndCapLayer, frontEndCapLayer, {
            foxholeKey: this.boardState.foxholeKey,
        });
        const shadow = resolveSplineContactShadowPath(
            this.getSampledPath(),
            Number(spanLayer.height),
            FOXHOLE_BOARD_SPRITE_SCALE,
            insets.startInset,
            insets.endInset,
        );
        if (!shadow) {
            return;
        }

        graphics.alpha = alpha;
        const drawPath = (width: number, opacity: number): void => {
            graphics.moveTo(shadow.points[0]!.x + shadow.offset, shadow.points[0]!.y + shadow.offset);
            for (let index = 1; index < shadow.points.length; index += 1) {
                const point = shadow.points[index]!;
                graphics.lineTo(point.x + shadow.offset, point.y + shadow.offset);
            }
            graphics.stroke({ color: 0x080c10, alpha: opacity, width, cap: 'round', join: 'round' });
        };

        // Two static strokes give the ribbon a soft contact edge without a blur filter.
        drawPath(shadow.width + Math.max(4, shadow.width * 0.12), 0.11);
        drawPath(shadow.width, 0.18);
    }

    private syncTrenchBuildSiteMesh(alpha: number): void {
        if (!this.spanMeshIsTrenchBuildSite) this.destroySpanMesh();
        this.spanMesh = updateTrenchBuildSiteMesh(this.spanMesh, this.boardState.start, this.boardState.end);
        this.spanMeshIsTrenchBuildSite = true;
        if (!this.spanMesh.parent) this.spanOverlay.addChild(this.spanMesh);
        const mesh = this.spanMesh;
        this.applyVisualTint(mesh, alpha);
        const textureUrl = this.getResolvedStructure()?.variants.default?.textureUrl;
        if (!textureUrl || mesh.texture !== PIXI.Texture.EMPTY) return;
        const generation = this.textureSyncGeneration;
        void loadFoxholeTexture(textureUrl).then(texture => {
            if (!texture || texture.destroyed || mesh.destroyed || generation !== this.textureSyncGeneration) return;
            mesh.texture = texture;
        });
    }

    private syncFromState(): void {
        const previewGeometry = this.resolveTransientPowerlinePreview();
        const wasAttachedStructurePreviewActive = this.attachedStructurePreviewActive;
        this.attachedStructurePreviewActive = previewGeometry !== null;
        const renderedState = previewGeometry
            ? {
                ...this.boardState,
                x: previewGeometry.x,
                y: previewGeometry.y,
                start: previewGeometry.start,
                end: previewGeometry.end,
            }
            : this.boardState;

        this.applyRenderedPowerlineTransform(renderedState,
            previewGeometry !== null || wasAttachedStructurePreviewActive);

        const previewAlpha = this.getResolvedUpgradeHoverPreviewAlpha();
        const alpha = Math.max(0, Math.min(1, this.boardState.alpha ?? 1)) * previewAlpha;
        const isPowerline = isPowerlineConnector(this.boardState.foxholeKey);
        const renderKey = this.getResolvedRenderKey();
        // Water wall netting crosses over the repeating buoys.
        if (isWaterWallSpline(renderKey)
            && this.boardVisual.getChildIndex(this.spanOverlay) < this.boardVisual.getChildIndex(this.handleTrimOverlay)) {
            this.boardVisual.setChildIndex(this.spanOverlay, this.boardVisual.getChildIndex(this.handleTrimOverlay));
        }
        const isTrenchBuildSite = isTrenchConnectorBuildSite(renderKey);
        const trenchTier = trenchConnectorTier(renderKey);
        const showGuides = this.isSelected && this.activePlacementPhase === null;
        const layers = this.getResolvedRenderLayers();
        const backEndCapLayer = isWaterWallSpline(renderKey) ? undefined : getConnectorEndCapLayer(layers, 'back', renderKey);
        const frontEndCapLayer = isWaterWallSpline(renderKey) ? undefined : getConnectorEndCapLayer(layers, 'front', renderKey);
        const underlayLayer = getLayerById(layers, 'underlay');
        const spanLayer = getLayerById(layers, 'span');
        const wallBarbedWireLayer = getLayerById(layers, 'barbedwire');
        const connector = this.boardDefinition.structureResolver?.(renderKey)?.connector ?? this.getResolvedConnector();
        const pathStyle = this.getResolvedPathStyle();
        const trimPositions = resolveConnectorTrimPositions(
            renderedState.start,
            renderedState.end,
            pathStyle,
            connector,
            backEndCapLayer,
            frontEndCapLayer,
            { foxholeKey: this.boardState.foxholeKey },
        );

        this.textureSyncGeneration += 1;
        this.destroyUnderlayMesh();
        if (!isTrenchBuildSite) this.destroySpanMesh();
        if (!trenchTier && this.trenchVisual) {
            this.trenchVisual.destroy();
            this.trenchVisual = null;
        }
        this.destroyWallBarbedWireMesh();
        this.destroyIntervalMarkerSprites();
        this.clearOverlay(this.wallMiddlePillarOverlay);
        this.clearOverlay(this.handleTrimOverlay);
        this.powerlineGraphics.clear();
        this.syncContactShadow(spanLayer, backEndCapLayer, frontEndCapLayer, alpha);

        if (isPowerline) {
            this.renderedPowerlineStart = { x: renderedState.start.x, y: renderedState.start.y };
            this.renderedPowerlineEnd = { x: renderedState.end.x, y: renderedState.end.y };
            this.renderedPowerlineAlpha = alpha;
            this.drawPowerlineStroke(renderedState.start, renderedState.end, alpha);
        } else {
            this.renderedPowerlineStart = null;
            this.renderedPowerlineEnd = null;
        }

        if (underlayLayer && shouldRenderConnectorSpan(pathStyle, connector, this.boardState.foxholeKey)) {
            this.syncUnderlayMesh(underlayLayer, alpha);
        }

        if (isTrenchBuildSite) {
            this.syncTrenchBuildSiteMesh(alpha);
        } else if (trenchTier) {
            if (!this.trenchVisual) {
                this.trenchVisual = new TrenchConnectorVisual(loadFoxholeTexture);
                this.spanOverlay.addChild(this.trenchVisual);
            }
            const occupancy = this.getWallVisibilityAttachments();
            this.trenchVisual.filters = this.getResolvedVisualFilters(this.trenchVisual);
            this.trenchVisual.sync({
                start: renderedState.start, end: renderedState.end, layers,
                destroyedTier: this.boardState.destroyed === true ? trenchTier : undefined,
                // The quadrilateral component uses FortDirt02 for T1/T2 and
                // FortT3ConcreteFloor01 for T3, shared with the regular trenches.
                floor: this.boardState.destroyed === true
                    ? undefined
                    : this.boardDefinition.assetResolver?.(trenchTier === 3 ? 'trencht3' : 'trencht1')?.renderLayers.find(layer => layer.id === 'floor'),
                startConnected: Boolean(occupancy[String(this.boardState.startSocketName ?? '')]),
                endConnected: Boolean(occupancy[String(this.boardState.endSocketName ?? '')]),
                alpha, tint: this.getResolvedVisualTint(),
                modifications: this.boardState.destroyed === true
                    ? []
                    : resolveTrenchConnectorModifications({
                        asset: this.getResolvedRenderAsset(), selections: this.boardState.modificationVariantIds,
                        hover: activeNixieStructureModificationHoverPreview.value, nodeId: String(this.boardId),
                        start: renderedState.start, end: renderedState.end,
                        hideRoofs: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs) === true,
                    }),
            });
            this.trenchVisual.setRoofHoverAlpha(this.roofHoverAlpha);
        } else if (usesIntervalMarkerSpan(pathStyle, connector)
            && !/^sandbag(?:half|full)spline$/iu.test(this.boardState.foxholeKey)) {
            this.syncIntervalMarkerSprites(alpha);
        } else if (spanLayer && shouldRenderConnectorSpan(pathStyle, connector, this.boardState.foxholeKey)) {
            this.syncSpanMesh(spanLayer, backEndCapLayer, frontEndCapLayer, alpha);
        }

        if (usesLayeredLandWallConnector(this.boardState.foxholeKey)) {
            this.syncWallMiddlePillars(layers, alpha);
            if (wallBarbedWireLayer) {
                this.syncWallBarbedWireMesh(wallBarbedWireLayer, alpha);
            }
        }
        if (isWaterWallSpline(this.boardState.foxholeKey) || isBarbedWireFence(this.boardState.foxholeKey)) {
            this.syncWallMiddlePillars(layers, alpha);
        }

        this.syncRampOverlay(layers, trimPositions, alpha);

        if (backEndCapLayer) {
            const sprite = this.createTrimSprite(backEndCapLayer, 'back', 'handle');
            this.positionTrimSprite(
                sprite,
                backEndCapLayer,
                trimPositions.backTrim,
                alpha,
            );
            this.handleTrimOverlay.addChild(sprite);
        }

        if (frontEndCapLayer) {
            const sprite = this.createTrimSprite(frontEndCapLayer, 'front', 'handle');
            this.positionTrimSprite(
                sprite,
                frontEndCapLayer,
                trimPositions.frontTrim,
                alpha,
            );
            this.handleTrimOverlay.addChild(sprite);
        }

        this.gizmoGraphics.clear();
        this.pathGuideGraphics.clear();
        this.syncSocketOverlay(renderedState, previewAlpha);
        if (!showGuides) {
            return;
        }

        const guideColors = resolveCanvasToolAccentColorPair(
            this.settingsStore,
            GIZMO_PATH_GUIDE_COLOR,
            GIZMO_HANDLE_COLOR,
        );

        if (!isPowerline) {
            this.drawPathGuide(alpha, guideColors.stem);
        }

        this.drawEndpointGizmo(renderedState.start, 'start', guideColors.handle);
        this.drawEndpointGizmo(renderedState.end, 'end', guideColors.handle);
    }

    private bindDebugOverlaySettings(): void {
        if (this.settingsWatcher) {
            return;
        }

        this.settingsWatcher = watch(() => {
            return FOXHOLE_SPLINE_CONNECTOR_DEBUG_OVERLAY_SETTING_IDS.map(settingId => this.settingsStore.getValue(settingId));
        }, () => {
            if (!this.destroyed) {
                this.syncFromState();
            }
        });
    }

    private getDebugOverlaySettings(): FoxholeSplineConnectorDebugOverlaySettings {
        return {
            showAllSockets: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets) === true,
            showPowerSockets: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets) === true,
            showPipeSockets: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets) === true,
            showSocketLabels: this.settingsStore.getValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels) === true,
        };
    }

    private getResolvedConnectorSockets(
        renderedState: Pick<FoxholeSplineConnectorState, 'start' | 'end' | 'startSocketName' | 'endSocketName'>,
    ): FoxholeSplineConnectorResolvedSocket[] {
        const structure = this.getResolvedStructure();
        if (!structure) {
            return [];
        }

        return resolveFoxholeSplineConnectorSockets({ structure,
            state: { ...renderedState, foxholeKey: this.boardState.foxholeKey },
            constraints: this.getPathConstraints(), pathStyle: this.getResolvedPathStyle(),
            lateralOffset: this.getFacilityPipeSideSocketLateralOffset(), visualRotations: true });
    }

    private getFacilityPipeSideSocketLateralOffset(): number {
        const layers = this.getResolvedRenderLayers();
        const spanLayer = getLayerById(layers, 'span') ?? getLayerById(layers, 'underlay');
        return resolveConnectorSpanCrossHalfWidth(spanLayer, FOXHOLE_BOARD_SPRITE_SCALE);
    }

    private isConnectorSocketOccupied(socket: FoxholeSplineConnectorResolvedSocket): boolean {
        if (socket.endpoint === 'side') {
            return Boolean(this.getNormalizedSocketAttachments()[socket.name]);
        }

        const endpoint = socket.endpoint;
        const endpointAttachment = this.getNormalizedEndpointAttachment(
            endpoint === 'start' ? this.boardState.startAttachment : this.boardState.endAttachment,
        );
        if (endpointAttachment) {
            return true;
        }

        // Pipe-to-pipe (and other connector targets) store the counterpart link in
        // socketAttachments on the target node, not start/endAttachment.
        const socketName = String(
            endpoint === 'start' ? this.boardState.startSocketName : this.boardState.endSocketName,
        ).trim();
        const occupiedBySocketAttachment = Boolean(socketName && this.getNormalizedSocketAttachments()[socketName]);
        return occupiedBySocketAttachment;
    }

    private captureInitialTargetAttachments(
        session: {
            initialTargetAttachmentsByNode?: Map<string, FoxholeStructureSocketAttachmentMap>;
        },
        targets: readonly FoxholeSplineConnectorSnapTarget[],
    ): void {
        if (session.initialTargetAttachmentsByNode) {
            return;
        }

        session.initialTargetAttachmentsByNode = new Map(
            targets.map(target => [target.nodeId, { ...target.attachments }]),
        );
    }

    private applyLiveAttachmentPreview(
        session: {
            initialTargetAttachmentsByNode?: Map<string, FoxholeStructureSocketAttachmentMap>;
            initialSocketAttachments?: FoxholeStructureSocketAttachmentMap;
            previewSocketAttachments?: FoxholeStructureSocketAttachmentMap;
            previewTargets?: FoxholeSplineConnectorSnapTarget[];
            handleId?: string;
        },
        reconciliation: {
            startAttachment?: FoxholeConnectorEndpointAttachment;
            endAttachment?: FoxholeConnectorEndpointAttachment;
            targetAttachmentsByNode: Map<string, FoxholeStructureSocketAttachmentMap>;
        },
        targets: readonly FoxholeSplineConnectorSnapTarget[],
    ): void {
        this.captureInitialTargetAttachments(session, targets);
        session.previewTargets = [...targets];

        const nextStart = reconciliation.startAttachment ?? null;
        const nextEnd = reconciliation.endAttachment ?? null;
        const nextSocketAttachments = this.resolveOwnSocketAttachmentsFromTargetReciprocals(
            reconciliation.targetAttachmentsByNode,
        );
        session.previewSocketAttachments = nextSocketAttachments;
        const currentStart = this.getNormalizedEndpointAttachment(this.boardState.startAttachment) ?? null;
        const currentEnd = this.getNormalizedEndpointAttachment(this.boardState.endAttachment) ?? null;
        const currentSocketAttachments = this.getNormalizedSocketAttachments();
        if (
            JSON.stringify(currentStart) !== JSON.stringify(nextStart)
            || JSON.stringify(currentEnd) !== JSON.stringify(nextEnd)
            || JSON.stringify(currentSocketAttachments) !== JSON.stringify(nextSocketAttachments)
        ) {
            this.patchBoardState({
                startAttachment: nextStart,
                endAttachment: nextEnd,
                socketAttachments: nextSocketAttachments,
            }, {
                reason: 'foxhole-spline-connector-attachment-preview',
                recordHistory: false,
            });
        }

        for (const target of targets) {
            const nextAttachments = reconciliation.targetAttachmentsByNode.get(target.nodeId) ?? {};
            const node = target.node as {
                patchBoardState?: (patch: Record<string, unknown>, options?: Record<string, unknown>) => void;
                boardState?: { socketAttachments?: unknown; };
            };
            const currentAttachments = normalizeFoxholeStructureSocketAttachmentMap(
                node.boardState?.socketAttachments ?? target.attachments,
            );
            if (JSON.stringify(currentAttachments) !== JSON.stringify(nextAttachments)) {
                node.patchBoardState?.({
                    socketAttachments: nextAttachments,
                }, {
                    reason: 'foxhole-spline-connector-target-attachment-preview',
                    recordHistory: false,
                });
            }
            this.syncConnectorTargetEndpointAttachmentsFromOccupancy(target, nextAttachments);
        }
    }

    private applyMoveLiveAttachmentPreviewAtPose(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
        origin: { x: number; y: number; },
        initialRotation: number,
        targets: readonly FoxholeSplineConnectorSnapTarget[],
        effectiveMoveX: number,
        effectiveMoveY: number,
        effectiveRotationDelta: number,
    ): void {
        if (!this.moveAttachmentPreview) {
            this.moveAttachmentPreview = {
                initialStartAttachment: this.getNormalizedEndpointAttachment(this.boardState.startAttachment),
                initialEndAttachment: this.getNormalizedEndpointAttachment(this.boardState.endAttachment),
                initialSocketAttachments: this.getNormalizedSocketAttachments(),
                initialTargetAttachmentsByNode: new Map(
                    targets.map(target => [target.nodeId, { ...target.attachments }]),
                ),
                previewTargets: [...targets],
            };
        } else {
            this.moveAttachmentPreview.previewTargets = [...targets];
            for (const target of targets) {
                if (!this.moveAttachmentPreview.initialTargetAttachmentsByNode.has(target.nodeId)) {
                    this.moveAttachmentPreview.initialTargetAttachmentsByNode.set(
                        target.nodeId,
                        { ...target.attachments },
                    );
                }
            }
        }

        const effectiveRotation = initialRotation + effectiveRotationDelta;
        const rotatedOrigin = effectiveRotationDelta && context.rotatePivot
            ? rotatePointAroundPivot(origin, context.rotatePivot, effectiveRotationDelta)
            : origin;
        const movedOrigin = {
            x: rotatedOrigin.x + effectiveMoveX,
            y: rotatedOrigin.y + effectiveMoveY,
        };
        const movingSockets = this.collectSnapSocketPoints(
            context.viewport,
            movedOrigin,
            effectiveRotation,
        );
        const reconciliation = this.reconcileAttachmentsAgainstTargets(
            movingSockets,
            targets,
            8,
        );

        const nextStart = reconciliation.startAttachment ?? null;
        const nextEnd = reconciliation.endAttachment ?? null;
        const nextSocketAttachments = this.resolveOwnSocketAttachmentsFromTargetReciprocals(
            reconciliation.targetAttachmentsByNode,
        );
        const currentStart = this.getNormalizedEndpointAttachment(this.boardState.startAttachment) ?? null;
        const currentEnd = this.getNormalizedEndpointAttachment(this.boardState.endAttachment) ?? null;
        const currentSocketAttachments = this.getNormalizedSocketAttachments();
        if (
            JSON.stringify(currentStart) !== JSON.stringify(nextStart)
            || JSON.stringify(currentEnd) !== JSON.stringify(nextEnd)
            || JSON.stringify(currentSocketAttachments) !== JSON.stringify(nextSocketAttachments)
        ) {
            this.patchBoardState({
                startAttachment: nextStart,
                endAttachment: nextEnd,
                socketAttachments: nextSocketAttachments,
            }, {
                reason: 'foxhole-spline-connector-move-attachment-preview',
                recordHistory: false,
            });
        }

        for (const target of targets) {
            const nextAttachments = reconciliation.targetAttachmentsByNode.get(target.nodeId) ?? {};
            const node = target.node as {
                patchBoardState?: (patch: Record<string, unknown>, options?: Record<string, unknown>) => void;
                boardState?: { socketAttachments?: unknown; };
            };
            // Compare against live boardState (other previews may have updated it this frame),
            // not the stale target.attachments snapshot from when targets were built.
            const currentAttachments = normalizeFoxholeStructureSocketAttachmentMap(
                node.boardState?.socketAttachments ?? target.attachments,
            );
            if (JSON.stringify(currentAttachments) !== JSON.stringify(nextAttachments)) {
                node.patchBoardState?.({
                    socketAttachments: nextAttachments,
                }, {
                    reason: 'foxhole-spline-connector-move-target-attachment-preview',
                    recordHistory: false,
                });
            }
            this.syncConnectorTargetEndpointAttachmentsFromOccupancy(target, nextAttachments);
        }
    }

    private restoreLiveAttachmentPreview(session: {
        initialTargetAttachmentsByNode?: Map<string, FoxholeStructureSocketAttachmentMap>;
        initialSocketAttachments?: FoxholeStructureSocketAttachmentMap;
        previewTargets?: FoxholeSplineConnectorSnapTarget[];
    }): void {
        const previousOwnAttachments = this.getNormalizedSocketAttachments();
        for (const [nodeId, attachments] of session.initialTargetAttachmentsByNode ?? []) {
            const target = session.previewTargets?.find(entry => entry.nodeId === nodeId);
            const node = (target?.node ?? this.findBoardNodeById(nodeId)) as {
                patchBoardState?: (patch: Record<string, unknown>, options?: Record<string, unknown>) => void;
            } | null;
            node?.patchBoardState?.({
                socketAttachments: attachments,
            }, {
                reason: 'foxhole-spline-connector-target-attachment-revert',
                recordHistory: false,
            });
        }
        this.restorePartnerEndpointAttachmentsFromOwnSocketMap(
            previousOwnAttachments,
            session.initialSocketAttachments ?? previousOwnAttachments,
        );
    }

    private restorePartnerEndpointAttachmentsFromOwnSocketMap(
        previousOwnAttachments: FoxholeStructureSocketAttachmentMap,
        nextOwnAttachments: FoxholeStructureSocketAttachmentMap,
    ): void {
        const selfId = String(this.boardId);
        const clearPartner = (
            attachment: FoxholeStructureSocketAttachmentMap[string] | undefined,
            ownSocketName: string,
        ) => {
            const partnerId = String(attachment?.nodeId ?? '').trim();
            const partnerSocketName = String(attachment?.socketName ?? '').trim();
            if (!partnerId || !partnerSocketName) {
                return;
            }
            const partner = this.findBoardNodeById(partnerId);
            if (!(partner instanceof FoxholeSplineConnectorNode)) {
                return;
            }
            const startSocketName = String(partner.boardState.startSocketName ?? '').trim();
            const endSocketName = String(partner.boardState.endSocketName ?? '').trim();
            const patch: Record<string, unknown> = {};
            const currentStart = partner.getNormalizedEndpointAttachment(partner.boardState.startAttachment);
            const currentEnd = partner.getNormalizedEndpointAttachment(partner.boardState.endAttachment);
            if (
                partnerSocketName === startSocketName
                && currentStart?.nodeId === selfId
                && currentStart.socketName === ownSocketName
            ) {
                patch.startAttachment = null;
            }
            if (
                partnerSocketName === endSocketName
                && currentEnd?.nodeId === selfId
                && currentEnd.socketName === ownSocketName
            ) {
                patch.endAttachment = null;
            }
            if (Object.keys(patch).length) {
                partner.patchBoardState(patch, {
                    reason: 'foxhole-spline-connector-partner-endpoint-attachment-revert',
                    recordHistory: false,
                });
            }
        };

        const setPartner = (
            attachment: FoxholeStructureSocketAttachmentMap[string] | undefined,
            ownSocketName: string,
        ) => {
            const partnerId = String(attachment?.nodeId ?? '').trim();
            const partnerSocketName = String(attachment?.socketName ?? '').trim();
            if (!partnerId || !partnerSocketName) {
                return;
            }
            const partner = this.findBoardNodeById(partnerId);
            if (!(partner instanceof FoxholeSplineConnectorNode)) {
                return;
            }
            const startSocketName = String(partner.boardState.startSocketName ?? '').trim();
            const endSocketName = String(partner.boardState.endSocketName ?? '').trim();
            const link = { nodeId: selfId, socketName: ownSocketName };
            const patch: Record<string, unknown> = {};
            if (partnerSocketName === startSocketName) {
                patch.startAttachment = link;
            }
            if (partnerSocketName === endSocketName) {
                patch.endAttachment = link;
            }
            if (Object.keys(patch).length) {
                partner.patchBoardState(patch, {
                    reason: 'foxhole-spline-connector-partner-endpoint-attachment-restore',
                    recordHistory: false,
                });
            }
        };

        for (const [ownSocketName, attachment] of Object.entries(previousOwnAttachments)) {
            if (nextOwnAttachments[ownSocketName]) {
                continue;
            }
            clearPartner(attachment, ownSocketName);
        }
        for (const [ownSocketName, attachment] of Object.entries(nextOwnAttachments)) {
            setPartner(attachment, ownSocketName);
        }
    }

    private findBoardNodeById(nodeId: string): unknown | null {
        const container = this.getTopBoardContainer();
        if (!container) {
            return null;
        }

        let match: unknown | null = null;
        const visit = (node: PIXI.Container) => {
            if (match) {
                return;
            }
            if (
                (node instanceof FoxholeStructureNode || node instanceof FoxholeSplineConnectorNode)
                && String(node.boardId) === nodeId
            ) {
                match = node;
                return;
            }
            for (const child of node.children) {
                if (child instanceof PIXI.Container) {
                    visit(child);
                }
            }
        };
        for (const child of container.children) {
            if (child instanceof PIXI.Container) {
                visit(child);
            }
        }
        return match;
    }

    private syncSocketOverlay(
        renderedState: Pick<FoxholeSplineConnectorState, 'start' | 'end' | 'startSocketName' | 'endSocketName'>,
        previewAlpha = 1,
    ): void {
        populateFoxholeSplineConnectorSocketOverlay(this.socketOverlay, {
            sockets: this.getResolvedConnectorSockets(renderedState), settings: this.getDebugOverlaySettings(),
            foxholeKey: this.boardState.foxholeKey, nodeRotation: getNodeRotation(this),
            isOccupied: socket => this.isConnectorSocketOccupied(socket), previewAlpha,
        });
    }

    private drawPowerlineStroke(
        start: PowerlinePoint,
        end: PowerlinePoint,
        alpha: number,
    ): void {
        const points = powerlinePathPoints(start, end, this.powerlineMotion);
        this.powerlineGraphics.moveTo(points[0]!.x, points[0]!.y);
        for (let index = 1; index < points.length; index += 1) {
            this.powerlineGraphics.lineTo(points[index]!.x, points[index]!.y);
        }
        this.powerlineDrawnParticles = this.powerlineMotion.particles.map(point => ({ ...point }));
        this.powerlineGraphics.stroke({
            ...resolveFoxholePowerlineStroke(
                alpha,
                isFoxholePowerlineOverLength(start, end, this.boardState.maxLength),
            ),
            pixelLine: false,
        });
    }

    updateSceneEnvironmentVisual(
        environment: NixieSceneEnvironment | null,
        deltaMs: number,
        viewportScale: number,
        motionAllowed: boolean,
    ): void {
        const start = this.renderedPowerlineStart;
        const end = this.renderedPowerlineEnd;
        if (!start || !end || this.boardState.visible === false || this.culled) {
            return;
        }
        if (!motionAllowed) {
            const wasSimulated = this.powerlineMotion.particles.length > 0;
            resetPowerlineMotion(this.powerlineMotion);
            if (wasSimulated) {
                this.redrawPowerline();
            }
            return;
        }

        const wind = resolveNixieSceneWind(environment);
        const directionRadians = wind.directionDeg * Math.PI / 180;
        const transform = this.getGlobalTransform();
        const determinant = transform.a * transform.d - transform.b * transform.c;
        const windX = Math.cos(directionRadians);
        const windY = Math.sin(directionRadians);
        const localWindDirection = Math.abs(determinant) > 0.000001
            ? Math.atan2(
                (-transform.b * windX + transform.a * windY) / determinant,
                (transform.d * windX - transform.c * windY) / determinant,
            ) * 180 / Math.PI
            : wind.directionDeg;
        const advanced = advancePowerlineMotionFrame(
            this.powerlineMotion, start, end, { directionDeg: localWindDirection, strength: wind.strength },
            deltaMs, viewportScale, this.powerlineWindPhase,
        );
        if (advanced && (this.powerlineMotion.particles.length !== this.powerlineDrawnParticles.length
            || this.powerlineMotion.particles.some((point, index) => (
                Math.hypot(point.x - this.powerlineDrawnParticles[index]!.x, point.y - this.powerlineDrawnParticles[index]!.y) > 0.01
            )))) {
            this.redrawPowerline();
        }
    }

    private redrawPowerline(): void {
        if (!this.renderedPowerlineStart || !this.renderedPowerlineEnd) {
            return;
        }
        this.powerlineGraphics.clear();
        this.drawPowerlineStroke(this.renderedPowerlineStart, this.renderedPowerlineEnd, this.renderedPowerlineAlpha);
    }

    private hitTestsAnimatedPowerline(point: PIXI.Point, worldPerPx: number): boolean {
        const start = this.renderedPowerlineStart;
        const end = this.renderedPowerlineEnd;
        if (!start || !end) {
            return false;
        }
        return distanceToSplinePath(point, powerlinePathPoints(start, end, this.powerlineMotion))
            <= Math.max(POWERLINE_CORE_WIDTH, worldPerPx * 6);
    }

    private applySocketSnappingEditableHandleDrag(
        session: SplineConnectorEditableSession,
        pointerWorld: PIXI.Point,
        context: BoardNodeEditableHandleContext,
    ): boolean {
        if (session.handleId !== 'start' && session.handleId !== 'end') {
            return false;
        }

        const snapped = this.snapSplineConnectorHandleLocal(session.handleId, pointerWorld, context);
        const localPoint = snapped.local;
        const pathStyle = this.getResolvedPathStyle();
        const constraints = getFoxholeSplineConnectorConstraints(this.boardState, pathStyle);
        const targets = this.getSnapTargetsForViewport(context.viewport);
        const snappedPowerline = isPowerlineConnector(this.boardState.foxholeKey)
            && snapped.rotation !== undefined;

        const syncStraightRotations = (draft: FoxholeSplineConnectorState) => {
            // Keep socket-locked endpoints on their attachment axis; rewriting both
            // rotations from the free chord lets snapped pipes swing off-angle.
            // Power lines also preserve their target-facing snap rotations even
            // though their visible endpoint indicators follow the line chord.
            const startLocked = Boolean(this.getNormalizedEndpointAttachment(draft.startAttachment));
            const endLocked = Boolean(this.getNormalizedEndpointAttachment(draft.endAttachment));
            if (!shouldSynchronizeStraightConnectorEndpointRotations({
                pathStyle,
                foxholeKey: this.boardState.foxholeKey,
                startAttached: startLocked,
                endAttached: endLocked,
            })) {
                return;
            }

            const { startRotation, endRotation } = resolveStraightConnectorEndpointRotations(
                draft.start,
                draft.end,
                this.boardState.foxholeKey,
            );
            draft.start.rotation = startRotation;
            draft.end.rotation = endRotation;
        };

        const reconcileAttachments = () => {
            const reconciliation = this.reconcileAttachmentsAgainstTargets(
                this.collectSnapSocketPoints(context.viewport),
                targets,
            );
            session.previewStartAttachment = reconciliation.startAttachment;
            session.previewEndAttachment = reconciliation.endAttachment;
            session.previewTargetAttachmentsByNode = reconciliation.targetAttachmentsByNode;
            session.previewTargets = targets;
            this.applyLiveAttachmentPreview(session, reconciliation, targets);
        };

        if (session.handleId === 'start') {
            const endLocked = Boolean(this.getNormalizedEndpointAttachment(this.boardState.endAttachment));
            const lockLengthOnly = shouldLockFoxholeConnectorEndpointToSocketAxis({
                usesStraightChord: usesStraightChordPath(pathStyle),
                foxholeKey: this.boardState.foxholeKey,
                oppositeEndpointAttached: endLocked,
                activeEndpointSnapped: snapped.rotation !== undefined,
            });
            if (!this.patchInteractiveEndpoints(draft => {
                const axisStart = lockLengthOnly && !snappedPowerline
                    ? resolvePlacementStartPositionAlongAxis(
                        draft.end,
                        localPoint,
                        constraints,
                        this.boardState.foxholeKey,
                    )
                    : localPoint;
                const nextRotation = snapped.rotation ?? (
                    lockLengthOnly
                        ? (
                            usesSocketFacingEndRotation(this.boardState.foxholeKey)
                                ? normalizeSplineRotationRadians(draft.end.rotation + Math.PI)
                                : draft.end.rotation
                        )
                        : session.initialStart.rotation
                );
                const nextStart = {
                    ...cloneEndpoint(draft.start),
                    x: axisStart.x,
                    y: axisStart.y,
                    rotation: nextRotation,
                };
                const clamped = snappedPowerline
                    ? { start: nextStart }
                    : clampDraggedSplineEndpoint('start', nextStart, cloneEndpoint(draft.end), constraints);
                draft.start.x = clamped.start.x;
                draft.start.y = clamped.start.y;
                draft.start.rotation = clamped.start.rotation;
                syncStraightRotations(draft);
            }, {
                reason: 'foxhole-spline-connector-handle-preview',
                recordHistory: false,
            })) return true;
            reconcileAttachments();
            return true;
        }

        if (!this.patchInteractiveEndpoints(draft => {
            const startLocked = Boolean(this.getNormalizedEndpointAttachment(draft.startAttachment));
            const lockLengthOnly = shouldLockFoxholeConnectorEndpointToSocketAxis({
                usesStraightChord: usesStraightChordPath(pathStyle),
                foxholeKey: this.boardState.foxholeKey,
                oppositeEndpointAttached: startLocked,
                activeEndpointSnapped: snapped.rotation !== undefined,
            });
            const axisEnd = lockLengthOnly && !snappedPowerline
                ? resolvePlacementEndPositionAlongAxis(draft.start, localPoint, constraints)
                : localPoint;
            const nextRotation = snapped.rotation ?? (
                lockLengthOnly
                    ? resolveDefaultEndRotation(draft.start, { ...draft.end, ...axisEnd }, this.boardState.foxholeKey)
                    : session.initialEnd.rotation
            );
            const nextEnd = {
                ...cloneEndpoint(draft.end),
                x: axisEnd.x,
                y: axisEnd.y,
                rotation: nextRotation,
            };
            const clamped = snappedPowerline
                ? { end: nextEnd }
                : clampDraggedSplineEndpoint('end', cloneEndpoint(draft.start), nextEnd, constraints);
            draft.end.x = clamped.end.x;
            draft.end.y = clamped.end.y;
            draft.end.rotation = clamped.end.rotation;
            syncStraightRotations(draft);
        }, {
            reason: 'foxhole-spline-connector-handle-preview',
            recordHistory: false,
        })) return true;
        reconcileAttachments();
        return true;
    }

    private snapSplineConnectorHandleLocal(
        handleId: string,
        pointerWorld: PIXI.Point,
        context: BoardNodeEditableHandleContext,
    ): ReturnType<typeof resolveFoxholeSplineEndpointSocketSnap> {
        const localPoint = this.toLocal(context.viewport.toGlobal(pointerWorld));
        const structure = this.getResolvedStructure();
        if (!structure) {
            return { local: localPoint };
        }

        const endpointSockets = resolveFoxholeConnectorEndpointSockets(structure, {
            startSocketName: this.boardState.startSocketName,
            endSocketName: this.boardState.endSocketName,
        });
        const startSocketName = String(this.boardState.startSocketName ?? '').trim();
        const endSocketName = String(this.boardState.endSocketName ?? '').trim();
        const socketName = handleId === 'start' ? startSocketName : endSocketName;
        const socket = handleId === 'start' ? endpointSockets.start : endpointSockets.end;
        if (
            !socketName
            || !socket
            || !hasFoxholeSnapSocketTags(socket.socketTags)
            || this.settingsStore.getValue(FOXHOLE_SOCKET_SNAPPING_SETTING_ID) === false
        ) {
            return { local: localPoint };
        }

        const endpointRole = handleId === 'start' ? 'start' : 'end';
        const endpoint = handleId === 'start' ? this.boardState.start : this.boardState.end;
        const cursorWorld = toBoardWorldPoint(this, localPoint, context.viewport);
        const nodeRotation = getNodeRotation(this);
        const stemRotation = resolveConnectorSocketSnapStemRotation(
            endpointRole,
            endpoint.rotation,
            nodeRotation,
            this.boardState.foxholeKey,
        );
        const targets = this.getSnapTargetsForViewport(context.viewport);
        const movingSocket = {
            nodeId: String(this.boardId),
            socketName,
            x: cursorWorld.x,
            y: cursorWorld.y,
            rotation: stemRotation,
            socketTags: socket.socketTags,
        } satisfies FoxholeSocketSnapPoint;
        const movingAttachments = this.getEndpointOccupancyAttachments();

        if (isPowerlineConnector(this.boardState.foxholeKey)) {
            const hoveredStructureHosts = targets.flatMap(target => (
                target.node instanceof FoxholeStructureNode
                && target.node.containsWorldPoint(pointerWorld, context)
                    ? [target.node]
                    : []
            ));
            const oppositeAttachment = endpointRole === 'start'
                ? this.getNormalizedEndpointAttachment(this.boardState.endAttachment)
                : this.getNormalizedEndpointAttachment(this.boardState.startAttachment);
            const hoveredSocket = resolveHoveredFoxholePowerSocketTarget(
                pointerWorld,
                hoveredStructureHosts,
                context.viewport,
                oppositeAttachment,
                candidate => this.areConnectorSnapSocketsAvailable(
                    movingSocket,
                    movingAttachments,
                    candidate,
                    targets,
                ),
            );
            if (hoveredSocket) {
                const snappedWorld = new PIXI.Point(hoveredSocket.x, hoveredSocket.y);
                return {
                    local: this.toLocal(context.viewport.toGlobal(snappedWorld)),
                    rotation: resolveEndpointRotationFromSocketPoint(
                        hoveredSocket,
                        endpointRole,
                        nodeRotation,
                    ),
                };
            }
        }

        return resolveFoxholeSplineEndpointSocketSnap({
            state: this.boardState,
            role: endpointRole,
            local: localPoint,
            world: cursorWorld,
            nodeRotation,
            movingSocket,
            targetSockets: targets.flatMap(target => target.sockets),
            toLocal: point => this.toLocal(context.viewport.toGlobal(new PIXI.Point(point.x, point.y))),
            isAvailable: (candidateMovingSocket, targetSocket) => this.areConnectorSnapSocketsAvailable(
                candidateMovingSocket,
                movingAttachments,
                targetSocket,
                targets,
            ),
        });
    }

    private collectMovingEndpointSocketsFromState(
        endpointSockets: ReturnType<typeof resolveFoxholeConnectorEndpointSockets>,
        context: BoardNodeEditableHandleContext,
    ): FoxholeSocketSnapPoint[] {
        const sockets: FoxholeSocketSnapPoint[] = [];
        const startSocketName = String(this.boardState.startSocketName ?? '').trim();
        const endSocketName = String(this.boardState.endSocketName ?? '').trim();
        const nodeRotation = getNodeRotation(this);

        if (startSocketName && endpointSockets.start && hasFoxholeSnapSocketTags(endpointSockets.start.socketTags)) {
            const world = toSplineEndpointWorldPoint(this, this.boardState.start, context.viewport);
            sockets.push({
                nodeId: String(this.boardId),
                socketName: startSocketName,
                x: world.x,
                y: world.y,
                rotation: resolveConnectorSocketSnapStemRotation(
                    'start',
                    // Snap matching retains the target-facing persisted rotation.
                    // Only the decorative power socket visual follows the line chord.
                    this.boardState.start.rotation,
                    nodeRotation,
                    this.boardState.foxholeKey,
                ),
                socketTags: endpointSockets.start.socketTags,
            });
        }

        if (endSocketName && endpointSockets.end && hasFoxholeSnapSocketTags(endpointSockets.end.socketTags)) {
            const world = toSplineEndpointWorldPoint(this, this.boardState.end, context.viewport);
            sockets.push({
                nodeId: String(this.boardId),
                socketName: endSocketName,
                x: world.x,
                y: world.y,
                rotation: resolveConnectorSocketSnapStemRotation(
                    'end',
                    this.boardState.end.rotation,
                    nodeRotation,
                    this.boardState.foxholeKey,
                ),
                socketTags: endpointSockets.end.socketTags,
            });
        }

        return sockets;
    }

    private resolveTransientPowerlinePreview(): {
        x: number;
        y: number;
        start: FoxholeSplineConnectorEndpoint;
        end: FoxholeSplineConnectorEndpoint;
    } | null {
        // Match legacy connectors: only power lines follow attached structure previews.
        // Facility pipes keep authored curve geometry; rewriting them as straight segments
        // (especially while selected) jumps them away from the selection.
        if (
            !isPowerlineConnector(this.boardState.foxholeKey)
            || (this.hasTransientTransformPreview() && !this.attachedStructurePreviewActive)
            || this.isSelected
        ) {
            return null;
        }

        const targets = this.getSiblingStructurePreviewTargets();
        if (!targets.length) {
            return null;
        }

        const recoveredAttachments = resolveFoxholeConnectorEndpointAttachmentsFromTargets({
            connectorNodeId: String(this.boardId),
            startSocketName: String(this.boardState.startSocketName ?? '').trim() || undefined,
            endSocketName: String(this.boardState.endSocketName ?? '').trim() || undefined,
            targets,
        });
        const startAttachment = this.getNormalizedEndpointAttachment(this.boardState.startAttachment)
            ?? recoveredAttachments.startAttachment;
        const endAttachment = this.getNormalizedEndpointAttachment(this.boardState.endAttachment)
            ?? recoveredAttachments.endAttachment;
        const touchedTransient = [startAttachment, endAttachment].some(attachment => {
            if (!attachment) {
                return false;
            }

            return targets.some(target => target.transient && target.nodeId === attachment.nodeId);
        });
        if (!touchedTransient) {
            return null;
        }

        const socketPointsByKey = new Map<string, FoxholeSocketSnapPoint>();
        for (const target of targets) {
            for (const socket of target.sockets) {
                socketPointsByKey.set(`${socket.nodeId}:${socket.socketName}`, socket);
            }
        }

        const originX = Number(this.boardState.x ?? 0);
        const originY = Number(this.boardState.y ?? 0);
        const nodeRotation = getNodeRotation(this);
        const nodeScaleX = Number(this.boardState.scaleX ?? 1);
        const nodeScaleY = Number(this.boardState.scaleY ?? 1);
        const attachedStart = startAttachment
            ? socketPointsByKey.get(`${startAttachment.nodeId}:${startAttachment.socketName}`)
            : undefined;
        const attachedEnd = endAttachment
            ? socketPointsByKey.get(`${endAttachment.nodeId}:${endAttachment.socketName}`)
            : undefined;
        const geometry = resolveFoxholeSplinePowerlineGeometry({
            currentStart: resolveFoxholeSplinePowerlineWorldEndpoint(
                { x: originX, y: originY }, this.boardState.start, nodeRotation, nodeScaleX, nodeScaleY,
            ),
            currentEnd: resolveFoxholeSplinePowerlineWorldEndpoint(
                { x: originX, y: originY }, this.boardState.end, nodeRotation, nodeScaleX, nodeScaleY,
            ),
            attachedStart,
            attachedEnd,
            nodeRotation,
            nodeScaleX,
            nodeScaleY,
        });
        return geometry;
    }

    private hasTransientTransformPreview(): boolean {
        const stateX = Number(this.boardState.x ?? 0);
        const stateY = Number(this.boardState.y ?? 0);
        const stateRotation = Number(this.boardState.rotation ?? 0);

        try {
            return Math.abs(this.x - stateX) > 0.0001
                || Math.abs(this.y - stateY) > 0.0001
                || Math.abs(this.rotation - stateRotation) > 0.0001;
        } catch {
            return true;
        }
    }

    private getSiblingStructurePreviewTargets(): Array<FoxholeSplineConnectorTargetStructureSnapshot & { transient: boolean; }> {
        const container = this.getTopBoardContainer();
        if (!container) {
            return [];
        }

        const targets: Array<FoxholeSplineConnectorTargetStructureSnapshot & { transient: boolean; }> = [];
        const visit = (node: PIXI.Container) => {
            if (node instanceof FoxholeStructureNode) {
                const attachments = normalizeFoxholeStructureSocketAttachmentMap(node.boardState.socketAttachments);
                const sockets = (node as unknown as {
                    collectSnapSocketGlobalPoints?: () => FoxholeSocketSnapPoint[];
                }).collectSnapSocketGlobalPoints?.() ?? [];
                const transient = (node as unknown as {
                    hasTransientTransformPreview?: () => boolean;
                }).hasTransientTransformPreview?.() === true;
                targets.push({
                    nodeId: String(node.boardId),
                    node,
                    sockets,
                    attachments,
                    transient,
                });
            } else if (node instanceof FoxholeSplineConnectorNode && node.usesSocketSnapping()) {
                const viewport = activeNixieViewport.value;
                const attachments = node.getNormalizedSocketAttachments();
                const sockets = viewport ? node.collectSnapSocketPoints(viewport) : [];
                const transient = node.hasTransientTransformPreview();
                targets.push({
                    nodeId: String(node.boardId),
                    node,
                    sockets,
                    attachments,
                    transient,
                });
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

        return targets.filter(target => target.nodeId !== String(this.boardId));
    }

    private getTopBoardContainer(): PIXI.Container | null {
        let current = this as unknown as PIXI.Container;
        while (current.parent instanceof BoardSpriteNode) {
            current = current.parent;
        }

        return current.parent as PIXI.Container | null;
    }

    private getSnapTargetsForViewport(
        viewport: BoardNodeEditableHandleContext['viewport'],
    ): FoxholeSplineConnectorSnapTarget[] {
        return this.collectSnapTargetsFromBoard(viewport);
    }

    /**
     * Move/rotate snap targets: unselected, visible, non-culled only.
     * Uses the drag-scoped stationary list from the selection tool — never co-selected.
     */
    private getMoveSnapStationaryTargets(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
        selectedIds: ReadonlySet<string>,
    ): FoxholeSplineConnectorSnapTarget[] {
        const selfId = String(this.boardId);
        const targets: FoxholeSplineConnectorSnapTarget[] = [];

        for (const node of context.stationaryNodes) {
            if (!(node instanceof BoardNodeBase) || !isBoardNodeMoveSnapStationaryCandidate(node)) {
                continue;
            }
            const target = this.buildSnapTargetFromNode(node, context.viewport);
            if (!target || target.nodeId === selfId || selectedIds.has(target.nodeId)) {
                continue;
            }
            targets.push(target);
        }

        return targets;
    }

    private getSnapTargetsForMoveCommit(context: BoardNodeMoveCommitContext): FoxholeSplineConnectorSnapTarget[] {
        const selfId = String(this.boardId);
        const targets: FoxholeSplineConnectorSnapTarget[] = [];

        for (const node of context.stationaryNodes) {
            if (!isBoardNodeMoveSnapStationaryCandidate(node as BoardNodeBase<any, any>)) {
                continue;
            }
            const target = this.buildSnapTargetFromNode(node, context.viewport);
            if (!target || target.nodeId === selfId) {
                continue;
            }
            targets.push(target);
        }

        // Co-moved attachment partners must be included at their final pose. Stationary-only
        // targets drop selected structures/connectors and clear still-valid socket links.
        for (const node of context.selectedNodes) {
            const target = this.buildSelectedSnapTargetForMoveCommit(node, context);
            if (!target || target.nodeId === selfId) {
                continue;
            }
            targets.push(target);
        }

        return targets;
    }

    private buildSelectedSnapTargetsForMovePreview(
        context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0],
        moveX: number,
        moveY: number,
        rotationDelta: number,
    ): FoxholeSplineConnectorSnapTarget[] {
        const selfId = String(this.boardId);
        const targets: FoxholeSplineConnectorSnapTarget[] = [];

        for (const node of context.selectedNodes) {
            const nodeId = String(node.boardId);
            if (!nodeId || nodeId === selfId) {
                continue;
            }

            const origin = context.selectedWorldOrigins.get(nodeId);
            const initialRotation = context.selectedInitialRotations.get(nodeId);
            if (!origin || !Number.isFinite(initialRotation)) {
                continue;
            }

            const rotatedOrigin = rotationDelta && context.rotatePivot
                ? rotatePointAroundPivot(origin, context.rotatePivot, rotationDelta)
                : origin;
            const movedOrigin = {
                x: rotatedOrigin.x + moveX,
                y: rotatedOrigin.y + moveY,
            };
            const movedRotation = Number(initialRotation) + rotationDelta;

            if (node instanceof FoxholeStructureNode) {
                targets.push({
                    nodeId,
                    node,
                    sockets: node.collectSnapSocketPoints(context.viewport, movedOrigin, movedRotation),
                    attachments: normalizeFoxholeStructureSocketAttachmentMap(node.boardState.socketAttachments),
                });
                continue;
            }

            if (node instanceof FoxholeSplineConnectorNode && node.usesSocketSnapping()) {
                targets.push({
                    nodeId,
                    node,
                    sockets: node.collectSnapSocketPoints(context.viewport, movedOrigin, movedRotation),
                    attachments: node.getNormalizedSocketAttachments(),
                });
            }
        }

        return targets;
    }

    private collectReverseSocketOccupants(
        selectedNodes: readonly { boardId?: string | number; boardState?: Record<string, unknown>; }[],
        stationaryNodes: readonly { boardId?: string | number; boardState?: Record<string, unknown>; }[],
        targetNodeId: string,
        targetSocketName: string,
    ): Array<{ nodeId: string; endpoint: string; socketName: string; }> {
        const occupants: Array<{ nodeId: string; endpoint: string; socketName: string; }> = [];
        const normalizedTargetNodeId = String(targetNodeId ?? '').trim();
        const normalizedTargetSocketName = String(targetSocketName ?? '').trim();
        if (!normalizedTargetNodeId || !normalizedTargetSocketName) {
            return occupants;
        }

        for (const node of [...selectedNodes, ...stationaryNodes]) {
            if (!(node instanceof FoxholeSplineConnectorNode)) {
                continue;
            }

            const nodeId = String(node.boardId);
            const start = this.getNormalizedEndpointAttachment(node.boardState.startAttachment);
            const end = this.getNormalizedEndpointAttachment(node.boardState.endAttachment);
            if (
                start
                && start.nodeId === normalizedTargetNodeId
                && start.socketName === normalizedTargetSocketName
            ) {
                occupants.push({
                    nodeId,
                    endpoint: 'start',
                    socketName: String(node.boardState.startSocketName ?? '').trim(),
                });
            }
            if (
                end
                && end.nodeId === normalizedTargetNodeId
                && end.socketName === normalizedTargetSocketName
            ) {
                occupants.push({
                    nodeId,
                    endpoint: 'end',
                    socketName: String(node.boardState.endSocketName ?? '').trim(),
                });
            }
        }

        return occupants;
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

        return Number(startRotation) + this.getFinalMoveRotationDelta(context);
    }

    private buildSelectedSnapTargetForMoveCommit(
        node: unknown,
        context: BoardNodeMoveCommitContext,
    ): FoxholeSplineConnectorSnapTarget | null {
        const nodeId = String((node as { boardId?: string | number; }).boardId ?? '');
        if (!nodeId) {
            return null;
        }

        const movedOrigin = this.getFinalMoveWorldOrigin(context, nodeId);
        const movedRotation = this.getFinalMoveRotation(context, nodeId);

        if (node instanceof FoxholeStructureNode) {
            return {
                nodeId,
                node,
                sockets: movedOrigin && movedRotation !== null
                    ? node.collectSnapSocketPoints(context.viewport, movedOrigin, movedRotation)
                    : node.collectSnapSocketPoints(context.viewport),
                attachments: normalizeFoxholeStructureSocketAttachmentMap(node.boardState.socketAttachments),
            };
        }

        if (node instanceof FoxholeSplineConnectorNode && node.usesSocketSnapping()) {
            return {
                nodeId,
                node,
                sockets: movedOrigin && movedRotation !== null
                    ? node.collectSnapSocketPoints(context.viewport, movedOrigin, movedRotation)
                    : node.collectSnapSocketPoints(context.viewport),
                attachments: node.getNormalizedSocketAttachments(),
            };
        }

        return null;
    }

    private buildSnapTargetFromNode(
        node: unknown,
        viewport: BoardNodeEditableHandleContext['viewport'],
    ): FoxholeSplineConnectorSnapTarget | null {
        if (node instanceof FoxholeStructureNode) {
            return {
                nodeId: String(node.boardId),
                node,
                sockets: node.collectSnapSocketPoints(viewport),
                attachments: normalizeFoxholeStructureSocketAttachmentMap(node.boardState.socketAttachments),
            };
        }

        if (node instanceof FoxholeSplineConnectorNode && node.usesSocketSnapping()) {
            return {
                nodeId: String(node.boardId),
                node,
                sockets: node.collectSnapSocketPoints(viewport),
                attachments: node.getNormalizedSocketAttachments(),
            };
        }

        return null;
    }

    private collectSnapTargetsFromBoard(
        viewport: BoardNodeEditableHandleContext['viewport'],
    ): FoxholeSplineConnectorSnapTarget[] {
        const container = this.getTopBoardContainer();
        if (!container) {
            return [];
        }

        const targets: FoxholeSplineConnectorSnapTarget[] = [];
        const visit = (node: PIXI.Container) => {
            const snapTarget = this.buildSnapTargetFromNode(node, viewport);
            if (snapTarget) {
                targets.push(snapTarget);
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

        return targets.filter(target => target.nodeId !== String(this.boardId));
    }

    private findSocketPointForAttachment(
        attachment: FoxholeConnectorEndpointAttachment,
        viewport: BoardNodeEditableHandleContext['viewport'],
    ): FoxholeSocketSnapPoint | null {
        for (const target of this.getSnapTargetsForViewport(viewport)) {
            const socket = target.sockets.find(entry =>
                entry.nodeId === attachment.nodeId
                && entry.socketName === attachment.socketName);
            if (socket) {
                return socket;
            }
        }

        return null;
    }

    private buildSnapTargetAttachmentPatch(
        target: FoxholeSplineConnectorSnapTarget,
        nextAttachments: FoxholeStructureSocketAttachmentMap,
    ) {
        const previousAttachments = target.attachments;
        if (JSON.stringify(previousAttachments) === JSON.stringify(nextAttachments)) {
            return null;
        }

        return {
            nodeId: target.nodeId,
            patch: { socketAttachments: nextAttachments },
            inversePatch: { socketAttachments: previousAttachments },
        };
    }

    private buildConnectorAttachmentPatch(
        startAttachment: FoxholeConnectorEndpointAttachment | undefined,
        endAttachment: FoxholeConnectorEndpointAttachment | undefined,
    ) {
        const previousStart = this.getNormalizedEndpointAttachment(this.boardState.startAttachment);
        const previousEnd = this.getNormalizedEndpointAttachment(this.boardState.endAttachment);
        const nextStart = startAttachment ?? null;
        const nextEnd = endAttachment ?? null;
        if (
            JSON.stringify(previousStart ?? null) === JSON.stringify(nextStart)
            && JSON.stringify(previousEnd ?? null) === JSON.stringify(nextEnd)
        ) {
            return null;
        }

        return {
            nodeId: String(this.boardId),
            patch: {
                startAttachment: nextStart,
                endAttachment: nextEnd,
            },
            inversePatch: {
                startAttachment: previousStart ?? null,
                endAttachment: previousEnd ?? null,
            },
        };
    }

    private drawEndpointGizmo(endpoint: FoxholeSplineConnectorEndpoint, role: 'start' | 'end', handleColor: number): void {
        drawFoxholeSplineEndpointGizmo(this.gizmoGraphics, endpoint, role, this.boardState.foxholeKey,
            allowsConnectorRotationHandles(this.getResolvedPathStyle(), this.boardState.foxholeKey, { maxArcAngleDeg: this.getResolvedMaxArcAngleDeg() }),
            Math.max(0, Math.min(1, this.boardState.alpha ?? 1)), handleColor);
    }
}
