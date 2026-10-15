import { resolvePlacementEndPosition, resolveRotationFromPointer } from '#nixie/plugins/nixie/board/utils/spline-path.ts';
import { isTrenchConnector } from './trench-connector.ts';
import { allowsConnectorRotationHandles, usesStraightChordPath } from './pipe-connector-path.ts';
import { shouldLockFoxholeConnectorEndpointToSocketAxis, isStraightConnectorSocketSnapAligned } from './connector.ts';
import { getFoxholeSplineConnectorConstraints, isPowerlineConnector, resolveDefaultEndRotation, normalizeSplineRotationRadians, worldRotationToEndpointLocal } from './spline-connector.ts';
import type { FoxholeSplineConnectorEndpoint, FoxholeSplineConnectorState } from './spline-connector.ts';
import { DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE, findBestFoxholeSocketSnap } from './structure-socket-snapping.ts';
import type { FoxholeSocketSnapPoint } from './structure-socket-snapping.ts';

/** Native endpoint snapping, with coordinate and occupancy adapters supplied by the editor. */
export function resolveFoxholeSplineEndpointSocketSnap(options: {
    state: FoxholeSplineConnectorState;
    role: 'start' | 'end';
    local: { x: number; y: number; };
    world: { x: number; y: number; };
    nodeRotation: number;
    movingSocket: FoxholeSocketSnapPoint;
    targetSockets: readonly FoxholeSocketSnapPoint[];
    toLocal: (point: { x: number; y: number; }) => { x: number; y: number; } | null;
    isAvailable: (movingSocket: FoxholeSocketSnapPoint, targetSocket: FoxholeSocketSnapPoint) => boolean;
}): { local: { x: number; y: number; }; rotation?: number; attachment?: { nodeId: string; socketName: string; }; } {
    const match = findBestFoxholeSocketSnap({
        movingSockets: [options.movingSocket], targetSockets: options.targetSockets,
        moveX: 0, moveY: 0, maxDistance: DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
        pointerWorld: options.world, pointerSocketRadius: DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
        isTargetSocketAvailable: options.isAvailable,
    });
    if (!match) {
        return { local: options.local };
    }
    const socketStemOffset = options.role === 'start' ? Math.PI : 0;
    const endpointRotation = options.state[options.role].rotation;
    const movingSocketWorld = normalizeSplineRotationRadians(endpointRotation + socketStemOffset + options.nodeRotation);
    const alignedStemWorld = normalizeSplineRotationRadians(movingSocketWorld + match.rotationDelta);
    const tangentWorld = options.role === 'start' ? normalizeSplineRotationRadians(alignedStemWorld - Math.PI) : alignedStemWorld;
    const rotation = worldRotationToEndpointLocal(tangentWorld, options.nodeRotation);
    const local = options.toLocal({ x: options.world.x + match.moveX, y: options.world.y + match.moveY });
    if (!local || !isStraightConnectorSocketSnapAligned({ foxholeKey: options.state.foxholeKey,
        start: options.role === 'start' ? local : options.state.start,
        end: options.role === 'end' ? local : options.state.end, endpointTangentRotation: rotation })) {
        return { local: options.local };
    }
    return { local, rotation, attachment: { nodeId: match.targetNodeId, socketName: match.targetSocketName } };
}

export interface FoxholeSplinePlacementState {
    phase: 'pick-start' | 'pick-end';
    lockedStartPosition?: FoxholeSplineConnectorEndpoint;
    lockedEndPosition?: FoxholeSplineConnectorEndpoint;
    manualStartRotation?: boolean;
    manualEndRotation?: boolean;
}

export function resolveMinimumLengthPreviewEnd(start: FoxholeSplineConnectorEndpoint,
    constraints: ReturnType<typeof getFoxholeSplineConnectorConstraints>, foxholeKey: string): FoxholeSplineConnectorEndpoint {
    const minLength = constraints.minLength ?? 0;
    const end = { x: start.x + Math.cos(start.rotation) * minLength,
        y: start.y + Math.sin(start.rotation) * minLength, rotation: 0 };
    return { ...end, rotation: resolveDefaultEndRotation(start, end, foxholeKey) };
}

export function resolvePlacementEndPositionAlongAxis(start: FoxholeSplineConnectorEndpoint,
    cursor: { x: number; y: number; }, constraints: ReturnType<typeof getFoxholeSplineConnectorConstraints>) {
    const minLength = Math.max(1, constraints.minLength ?? 1);
    const maxLength = Math.max(minLength, constraints.maxLength ?? minLength);
    const projected = (cursor.x - start.x) * Math.cos(start.rotation) + (cursor.y - start.y) * Math.sin(start.rotation);
    const length = Math.min(maxLength, Math.max(minLength, projected));
    return { x: start.x + Math.cos(start.rotation) * length, y: start.y + Math.sin(start.rotation) * length };
}

export function resolveFoxholeSplinePlacementPreview(state: FoxholeSplineConnectorState,
    session: FoxholeSplinePlacementState, cursor: { x: number; y: number; }, options: {
        pathStyle?: string;
        maxArcAngleDeg?: number;
        rotateActiveEndpoint?: boolean;
        snapped?: { local: { x: number; y: number; }; rotation?: number; } | null;
        startAttached?: boolean;
    }) {
    const { pathStyle, snapped } = options;
    const constraints = getFoxholeSplineConnectorConstraints(state, pathStyle);
    const allowsRotation = allowsConnectorRotationHandles(pathStyle, state.foxholeKey, { maxArcAngleDeg: options.maxArcAngleDeg });
    if (session.phase === 'pick-start') {
        let start: FoxholeSplineConnectorEndpoint;
        if (allowsRotation && options.rotateActiveEndpoint && session.lockedStartPosition) {
            start = { ...session.lockedStartPosition, rotation: resolveRotationFromPointer(session.lockedStartPosition, cursor) };
            session.manualStartRotation = true;
        } else {
            if (!options.rotateActiveEndpoint) {
                session.lockedStartPosition = undefined;
            }
            const local = snapped?.local ?? cursor;
            start = { x: local.x, y: local.y, rotation: snapped?.rotation
                ?? (allowsRotation && session.manualStartRotation ? state.start.rotation : 0) };
            if (snapped?.rotation !== undefined) {
                session.manualStartRotation = true;
            }
        }
        return { start, end: resolveMinimumLengthPreviewEnd(start, constraints, state.foxholeKey) };
    }

    const start = { ...state.start };
    let end: FoxholeSplineConnectorEndpoint;
    if (options.rotateActiveEndpoint && session.lockedEndPosition) {
        end = { ...session.lockedEndPosition, rotation: resolveRotationFromPointer(start, cursor) };
        session.manualEndRotation = true;
    } else {
        session.lockedEndPosition = undefined;
        const endSnapped = snapped?.rotation !== undefined;
        const lockLengthOnly = shouldLockFoxholeConnectorEndpointToSocketAxis({
            usesStraightChord: usesStraightChordPath(pathStyle), foxholeKey: state.foxholeKey,
            oppositeEndpointAttached: options.startAttached === true || session.manualStartRotation === true,
            activeEndpointSnapped: endSnapped,
        });
        // A snapped power line must reach the socket even when its span is invalid.
        // The overlength stroke communicates that the buildings need moving.
        const position = endSnapped && isPowerlineConnector(state.foxholeKey)
            ? snapped?.local ?? cursor
            : lockLengthOnly
                ? resolvePlacementEndPositionAlongAxis(start, snapped?.local ?? cursor, constraints)
                : resolvePlacementEndPosition(start, snapped?.local ?? cursor, constraints);
        const chordRotation = Math.atan2(position.y - start.y, position.x - start.x);
        end = { ...position, rotation: snapped?.rotation ?? (session.manualEndRotation || allowsRotation
            ? state.end.rotation
            : resolveDefaultEndRotation(start, { ...position, rotation: chordRotation }, state.foxholeKey)) };
        if (endSnapped) {
            session.manualEndRotation = true;
        }
    }
    if (isTrenchConnector(state.foxholeKey) && !session.manualEndRotation) {
        end.rotation = Math.atan2(end.y - start.y, end.x - start.x);
    }
    return { start: { ...start, rotation: session.manualStartRotation || session.manualEndRotation
        ? start.rotation
        : Math.atan2(end.y - start.y, end.x - start.x) }, end };
}
