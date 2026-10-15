import type { BoardTransformState } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import { isTrenchConnector } from './trench-connector.ts';
import { isReferenceRoadSplineKey } from './world-road-edit-validity.ts';
import type { SplinePathConstraints, SplinePathEndpoint } from '#nixie/plugins/nixie/board/utils/spline-path.ts';
import type { FoxholeConnectorEndpointAttachment } from './connector.ts';
import type { FoxholeManifestConnector, FoxholeManifestConnectorMeshConfig, FoxholeManifestStructure } from './manifest.ts';
import type { FoxholeStructureRenderLayerAsset } from './catalog.ts';
import type { FoxholeStructureModificationSelectionMap } from './modification-slots.ts';
import { normalizeFoxholeModificationSelectionMap } from './modification-slots.ts';
import type { FoxholeStructureSocketAttachmentMap } from './types.ts';
import { normalizeFoxholeStructureSocketAttachmentMap } from './types.ts';
import {
    DEFAULT_PIPE_CURVE_T,
    normalizePipeCurveT,
    usesPipeCurveScale,
} from './pipe-spline-constraints.ts';
import {
    normalizeConnectorFoxholeKey,
    requiresStraightConnectorSocketAlignment,
    resolveConnectorBehavior,
    resolveConnectorBehaviorFromStructure,
    resolveConnectorEndpointSocketNames,
    resolveConnectorVisualPathStyle,
} from './connector-behavior.ts';
import type { ResolvedConnectorBehavior } from './connector-behavior.ts';

export {
    resolveConnectorBehavior,
    resolveConnectorBehaviorFromStructure,
    requiresStraightConnectorSocketAlignment,
    type ResolvedConnectorBehavior,
};

export const FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE = 'foxholeSplineConnector';

export const FOXHOLE_SPLINE_CONNECTOR_ROTATION_SNAP_STEP_RAD = Math.PI / 12;
export const FOXHOLE_BOARD_PIXELS_PER_CENTIMETER = 32 / 100;
export const FOXHOLE_BOARD_SPRITE_SCALE = 0.5;
export const DEFAULT_FOXHOLE_SPLINE_MIN_RADIUS = 24;
export const DEFAULT_FOXHOLE_SPLINE_HANDLE_CHORD_SCALE = 0.4;

export interface FoxholeSplineConnectorEndpoint extends SplinePathEndpoint {}

export interface FoxholeSplineConnectorState extends BoardTransformState {
    foxholeKey: string;
    start: FoxholeSplineConnectorEndpoint;
    end: FoxholeSplineConnectorEndpoint;
    minLength: number;
    maxLength: number;
    minRadius: number;
    maxRadius: number;
    maxBuffer: number;
    curveT: number;
    maxTargetAngleDeg?: number;
    maxArcAngleDeg?: number;
    startSocketName?: string;
    endSocketName?: string;
    startAttachment?: FoxholeConnectorEndpointAttachment;
    endAttachment?: FoxholeConnectorEndpointAttachment;
    socketAttachments?: FoxholeStructureSocketAttachmentMap;
    modificationVariantIds?: FoxholeStructureModificationSelectionMap;
    destroyed?: boolean;
    blueprint?: boolean;
    tint?: number;
    brightness?: number;
}

export const DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE: FoxholeSplineConnectorState = {
    foxholeKey: '',
    x: 0,
    y: 0,
    rotation: 0,
    visible: true,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    locked: false,
    start: {
        x: 0,
        y: 0,
        rotation: 0,
    },
    end: {
        x: 120,
        y: 0,
        rotation: 0,
    },
    minLength: 48,
    maxLength: 100_000,
    minRadius: DEFAULT_FOXHOLE_SPLINE_MIN_RADIUS,
    maxRadius: DEFAULT_FOXHOLE_SPLINE_MIN_RADIUS,
    maxBuffer: 0,
    curveT: DEFAULT_PIPE_CURVE_T,
    maxTargetAngleDeg: undefined,
    maxArcAngleDeg: undefined,
    startSocketName: undefined,
    endSocketName: undefined,
    startAttachment: undefined,
    endAttachment: undefined,
    socketAttachments: {},
    modificationVariantIds: {},
    destroyed: false,
    blueprint: false,
    tint: undefined,
    brightness: undefined,
};

function normalizeEndpoint(
    value: Partial<FoxholeSplineConnectorEndpoint> | undefined,
    fallback: FoxholeSplineConnectorEndpoint,
): FoxholeSplineConnectorEndpoint {
    return {
        x: Number.isFinite(value?.x) ? Number(value?.x) : fallback.x,
        y: Number.isFinite(value?.y) ? Number(value?.y) : fallback.y,
        rotation: Number.isFinite(value?.rotation) ? Number(value?.rotation) : fallback.rotation,
        ...(Number.isFinite(value?.handleLength)
            ? { handleLength: Math.max(1, Number(value?.handleLength)) }
            : {}),
    };
}

export function normalizeFoxholeSplineConnectorState(
    state: Partial<FoxholeSplineConnectorState> | undefined,
): FoxholeSplineConnectorState {
    const base = {
        ...DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE,
        ...(state ?? {}),
    };
    const endpointSocketNames = resolveConnectorEndpointSocketNames(base.foxholeKey);

    return {
        ...base,
        foxholeKey: String(base.foxholeKey ?? '').trim(),
        start: normalizeEndpoint(state?.start, DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.start),
        end: normalizeEndpoint(state?.end, DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.end),
        minLength: Math.max(1, Number(base.minLength ?? DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.minLength)),
        maxLength: Math.max(base.minLength, Number(base.maxLength ?? DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.maxLength)),
        minRadius: Math.max(1, Number(base.minRadius ?? DEFAULT_FOXHOLE_SPLINE_MIN_RADIUS)),
        maxRadius: Math.max(1, Number(base.maxRadius ?? base.minRadius ?? DEFAULT_FOXHOLE_SPLINE_MIN_RADIUS)),
        maxBuffer: Math.max(0, Number(base.maxBuffer ?? DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.maxBuffer)),
        curveT: normalizePipeCurveT(Number(base.curveT ?? DEFAULT_PIPE_CURVE_T)),
        maxTargetAngleDeg: Number.isFinite(base.maxTargetAngleDeg)
            ? Number(base.maxTargetAngleDeg)
            : undefined,
        maxArcAngleDeg: Number.isFinite(base.maxArcAngleDeg)
            ? Number(base.maxArcAngleDeg)
            : undefined,
        startSocketName: String(base.startSocketName ?? '').trim() || endpointSocketNames.backSocketName,
        endSocketName: String(base.endSocketName ?? '').trim() || endpointSocketNames.frontSocketName,
        startAttachment: normalizeSplineConnectorEndpointAttachment(state?.startAttachment),
        endAttachment: normalizeSplineConnectorEndpointAttachment(state?.endAttachment),
        socketAttachments: normalizeFoxholeStructureSocketAttachmentMap(state?.socketAttachments),
        modificationVariantIds: normalizeFoxholeModificationSelectionMap(state?.modificationVariantIds),
        destroyed: base.destroyed === true,
        blueprint: base.blueprint === true,
        tint: Number.isFinite(base.tint) && Number(base.tint) !== 0xFFFFFF
            ? (Number(base.tint) >>> 0)
            : undefined,
        brightness: Number.isFinite(base.brightness) && Number(base.brightness) !== 1
            ? Number(base.brightness)
            : undefined,
    };
}

function normalizeSplineConnectorEndpointAttachment(
    value: FoxholeConnectorEndpointAttachment | null | undefined,
): FoxholeConnectorEndpointAttachment | undefined {
    const nodeId = String(value?.nodeId ?? '').trim();
    const socketName = String(value?.socketName ?? '').trim();
    return nodeId && socketName
        ? { nodeId, socketName }
        : undefined;
}

export function resolveSplineConnectorCurveT(
    state: FoxholeSplineConnectorState,
    pathStyle?: string,
): number {
    if (usesPipeCurveScale(pathStyle, state.foxholeKey)) {
        return normalizePipeCurveT(state.curveT);
    }

    return 1;
}

export function getFoxholeSplineConnectorConstraints(
    state: FoxholeSplineConnectorState,
    pathStyle?: string,
): SplinePathConstraints {
    const usesAdjustablePipeCurve = usesPipeCurveScale(pathStyle, state.foxholeKey);
    const chordLength = Math.hypot(
        state.end.x - state.start.x,
        state.end.y - state.start.y,
    );
    const minLengthHandle = Math.max(state.minLength * 0.5, state.minRadius);
    const maxBuffer = usesAdjustablePipeCurve && state.maxBuffer > 0
        ? state.maxBuffer
        : undefined;
    const defaultHandleLength = usesAdjustablePipeCurve
        ? Math.max(maxBuffer ?? 0, minLengthHandle)
        : chordLength * DEFAULT_FOXHOLE_SPLINE_HANDLE_CHORD_SCALE;
    const maxRadius = state.maxRadius > state.minRadius ? state.maxRadius : undefined;

    return {
        minLength: state.minLength,
        maxLength: state.maxLength,
        minRadius: state.minRadius,
        maxRadius,
        maxBuffer,
        defaultHandleLength,
        curveT: resolveSplineConnectorCurveT(state, pathStyle),
        maxTargetAngleDeg: state.maxTargetAngleDeg,
        maxArcAngleDeg: state.maxArcAngleDeg,
    };
}

export function usesSocketFacingEndRotation(foxholeKey: string): boolean {
    const normalizedKey = String(foxholeKey ?? '').trim().toLowerCase();
    return normalizedKey.includes('pipe') && !normalizedKey.includes('underground');
}

export function isUndergroundPipe(foxholeKey: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).undergroundPipe;
}

export function usesFacilityPipeGuidePath(foxholeKey?: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    const normalizedKey = normalizeConnectorFoxholeKey(foxholeKey);
    return normalizedKey === 'facilitypipe' || normalizedKey === 'facilitypipeunderground';
}

export function resolveDefaultEndRotation(
    start: FoxholeSplineConnectorEndpoint,
    end: FoxholeSplineConnectorEndpoint,
    foxholeKey: string,
): number {
    const chordRotation = Math.atan2(end.y - start.y, end.x - start.x);
    if (usesSocketFacingEndRotation(foxholeKey)) {
        return normalizeSplineRotationRadians(chordRotation + Math.PI);
    }

    return normalizeSplineRotationRadians(chordRotation);
}

export function resolveTrimDisplayRotation(
    rotation: number,
    endpoint: 'start' | 'end',
    foxholeKey?: string,
): number {
    if (endpoint === 'end' && usesSocketFacingEndRotation(String(foxholeKey ?? ''))) {
        return normalizeSplineRotationRadians(rotation + Math.PI);
    }

    return rotation;
}

export function resolveHybridPipeBezierEndRotation(
    rotation: number,
    foxholeKey?: string,
): number {
    if (usesSocketFacingEndRotation(String(foxholeKey ?? ''))) {
        // Ground pipes store socket-facing end rotations. Extension routing and trim
        // sprites use the pipe tangent, but bezier control points interpret rotation
        // as the outgoing tangent at the endpoint.
        return normalizeSplineRotationRadians(rotation + Math.PI);
    }

    return rotation;
}

export function resolveConnectorSocketOutwardRotation(
    endpointRole: 'start' | 'end',
    endpointRotation: number,
    foxholeKey?: string,
): number {
    if (endpointRole === 'start') {
        return normalizeSplineRotationRadians(endpointRotation + Math.PI);
    }

    if (usesSocketFacingEndRotation(String(foxholeKey ?? ''))) {
        return normalizeSplineRotationRadians(endpointRotation + Math.PI);
    }

    return endpointRotation;
}

export function resolveConnectorSocketSnapStemRotation(
    endpointRole: 'start' | 'end',
    endpointRotation: number,
    nodeRotation = 0,
    foxholeKey?: string,
): number {
    const outwardRotation = resolveConnectorSocketOutwardRotation(
        endpointRole,
        endpointRotation,
        foxholeKey,
    );
    return normalizeSplineRotationRadians(outwardRotation + nodeRotation);
}

export function resolveConnectorEndpointVisualRotation(
    endpointRole: 'start' | 'end',
    start: Readonly<FoxholeSplineConnectorEndpoint>,
    end: Readonly<FoxholeSplineConnectorEndpoint>,
    foxholeKey?: string,
): number {
    if (isPowerlineConnector(String(foxholeKey ?? ''))) {
        return Math.atan2(end.y - start.y, end.x - start.x);
    }

    if (requiresStraightConnectorSocketAlignment(foxholeKey)) {
        return endpointRole === 'start'
            ? Math.atan2(end.y - start.y, end.x - start.x)
            : resolveDefaultEndRotation(start, end, String(foxholeKey ?? ''));
    }

    return endpointRole === 'start' ? start.rotation : end.rotation;
}

export function resolveConnectorAttachmentStatusVisualRotation(
    nodeRotation: number,
    foxholeKey?: string,
): number {
    return requiresStraightConnectorSocketAlignment(foxholeKey)
        ? -nodeRotation
        : 0;
}

export function normalizeSplineRotationRadians(value: number): number {
    let angle = value;
    while (angle > Math.PI) {
        angle -= Math.PI * 2;
    }
    while (angle < -Math.PI) {
        angle += Math.PI * 2;
    }
    return angle;
}

export function worldRotationToEndpointLocal(worldRotation: number, nodeRotation: number): number {
    return normalizeSplineRotationRadians(worldRotation - nodeRotation);
}

export function endpointLocalToWorldRotation(localRotation: number, nodeRotation: number): number {
    return normalizeSplineRotationRadians(localRotation + nodeRotation);
}

export function centimetersToFoxholeBoardPixels(centimeters: number): number {
    return Math.max(0, centimeters) * FOXHOLE_BOARD_PIXELS_PER_CENTIMETER;
}

export function isFoxholeSplineConnectorStructure(structure?: FoxholeManifestStructure | null): boolean {
    if (isTrenchConnector(structure?.id) || /^sandbag(?:half|full)spline$/iu.test(structure?.id ?? '')) {
        return true;
    }
    if (structure?.connector?.splineComponentName === 'SplineConnector') {
        return true;
    }

    const behavior = resolveConnectorBehaviorFromStructure(structure);
    return behavior.trimSpan || behavior.mineSpline;
}

export function resolveStraightConnectorFrontTrimRotation(
    chordRotation: number,
    _foxholeKey?: string,
): number {
    return chordRotation;
}

type ConnectorTrimSocketRole = 'back' | 'front';

export function resolveConnectorRampSpriteAnchor(
    layer: FoxholeStructureRenderLayerAsset | undefined,
    role: ConnectorTrimSocketRole,
): { x: number; y: number; } {
    const anchorY = Number(layer?.anchorY ?? 0.5);

    // Field connector ramps are authored as separate components. Pin the handle-side
    // edge at the spline endpoint so the ramp body extends outward from the span.
    return {
        x: role === 'back' ? 1 : 0,
        y: Number.isFinite(anchorY) ? anchorY : 0.5,
    };
}

export function usesFieldConnectorSpan(foxholeKey: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).fieldConnectorSpan;
}

export function usesTrimSpanSplineConnector(foxholeKey: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).trimSpan;
}

export function usesMineSplineConnector(foxholeKey: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).mineSpline;
}

export function usesRailTrackSpline(foxholeKey: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).railTrack;
}

export type FoxholeRailTrackGauge = 'small' | 'standard';

export function resolveRailTrackGauge(
    foxholeKey?: string,
    connector?: Pick<FoxholeManifestConnector, 'behavior'> | null,
): FoxholeRailTrackGauge | null {
    if (!usesRailTrackSpline(foxholeKey ?? '', connector)) {
        return null;
    }

    return String(foxholeKey ?? '').trim().toLowerCase().startsWith('smallrailtrack')
        ? 'small'
        : 'standard';
}

export function usesRailTrackForkEndCaps(foxholeKey: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).railForkEndCaps;
}

export function shouldRenderConnectorEndCapLayers(foxholeKey: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).renderEndCaps;
}

export function isPowerlineConnector(foxholeKey?: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).powerline;
}

export function shouldSynchronizeStraightConnectorEndpointRotations(options: {
    pathStyle: string;
    foxholeKey: string;
    startAttached: boolean;
    endAttached: boolean;
}): boolean {
    const usesStraightPath = options.pathStyle === 'straight-telescoping'
        || options.pathStyle === 'endpoints-only'
        || usesMineSplineConnector(options.foxholeKey);

    return usesStraightPath
        && !isPowerlineConnector(options.foxholeKey)
        && !options.startAttached
        && !options.endAttached;
}

export function usesSplineConnectorSocketSnapping(foxholeKey?: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).socketSnapping;
}

export function isSplineConnectorSocketSnapHost(node: unknown): node is {
    boardState: {
        foxholeKey?: string;
        socketAttachments?: FoxholeStructureSocketAttachmentMap;
    };
    collectSnapSocketPoints: (
        viewport: import('pixi-viewport').Viewport,
        originOverride?: { x: number; y: number; } | null,
    ) => import('./structure-socket-snapping.ts').FoxholeSocketSnapPoint[];
} {
    if (typeof node !== 'object' || node === null) {
        return false;
    }

    const candidate = node as {
        boardState?: { foxholeKey?: string; };
        collectSnapSocketPoints?: unknown;
    };

    return usesSplineConnectorSocketSnapping(candidate.boardState?.foxholeKey)
        && typeof candidate.collectSnapSocketPoints === 'function';
}

export function isRailTrackSnapHost(node: unknown): node is {
    boardState: {
        foxholeKey?: string;
    };
    boardId?: string | number;
    collectRailTrackWorldPathPoints: (
        viewport: import('pixi-viewport').Viewport,
    ) => Array<{ x: number; y: number; }>;
} {
    if (typeof node !== 'object' || node === null) {
        return false;
    }

    const candidate = node as {
        boardState?: { foxholeKey?: string; };
        collectRailTrackWorldPathPoints?: unknown;
    };

    return usesRailTrackSpline(candidate.boardState?.foxholeKey)
        && typeof candidate.collectRailTrackWorldPathPoints === 'function';
}

export function isTankStopSplineConnector(foxholeKey?: string, connector?: Pick<FoxholeManifestConnector, 'behavior'> | null): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).tankStop;
}

export {
    usesIntervalMarkerSpan,
    resolveIntervalMeshConfig,
    resolveIntervalMarkerDistances,
    resolveMeshConfigIntervalMarkerDistances,
    resolveCenteredMeshConfigIntervalBoundaryDistances,
} from '../../../../../../../extensions/foxhole-planner/src/interval-marker-distances.ts';

export function resolveEffectiveConnectorPathStyle(pathStyle?: string, foxholeKey?: string): string | undefined {
    if (isTrenchConnector(foxholeKey)) {
        return 'trench';
    }
    if (isUndergroundPipe(String(foxholeKey ?? ''))) {
        return 'spline';
    }

    return resolveConnectorVisualPathStyle(pathStyle, foxholeKey);
}

export function shouldTintInvalidSplinePath(foxholeKey?: string): boolean {
    return !isReferenceRoadSplineKey(foxholeKey);
}

export function allowsConnectorRotationHandles(
    pathStyle?: string,
    foxholeKey?: string,
    options?: {
        maxArcAngleDeg?: number;
    },
): boolean {
    const effectivePathStyle = resolveEffectiveConnectorPathStyle(pathStyle, foxholeKey);
    if (usesMineSplineConnector(String(foxholeKey ?? ''))) {
        return false;
    }

    if (effectivePathStyle === 'interval') {
        if (/^sandbag(?:half|full)spline$/iu.test(String(foxholeKey ?? ''))) {
            return true;
        }
        return Number(options?.maxArcAngleDeg ?? 0) > 0;
    }

    if (effectivePathStyle === 'straight-telescoping' || effectivePathStyle === 'endpoints-only') {
        return false;
    }

    if (isPowerlineConnector(foxholeKey)) {
        return false;
    }

    const normalizedKey = String(foxholeKey ?? '').trim().toLowerCase();
    if (normalizedKey.includes('cranerail')) {
        return false;
    }

    return true;
}

export function createFoxholeSplineConnectorNodeId(prefix = 'foxhole-spline-connector'): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
