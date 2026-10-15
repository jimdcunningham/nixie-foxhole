import type { BoardTransformState } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import type { FoxholeManifestBuildSocket, FoxholeManifestStructure } from './manifest.ts';
import {
    findAlignedFoxholeSocketMatches,
    hasFoxholePowerSocketTag,
    normalizeFoxholeSocketTags,

} from './structure-socket-snapping.ts';
import type { FoxholeSocketSnapPoint, FoxholeSocketTagBitfield } from './structure-socket-snapping.ts';
import type { FoxholeStructureSocketAttachmentMap } from './types.ts';
import { requiresStraightConnectorSocketAlignment, resolveConnectorEndpointSocketNames } from './connector-behavior.ts';
import { normalizeFoxholeBuildSocketName } from './structure-socket-resolution.ts';

export { isFoxholePowerSocketConnectionAvailable } from './power-socket-capacity.ts';

export const FOXHOLE_CONNECTOR_NODE_TYPE = 'foxholeConnector';

export interface FoxholeConnectorEndpointAttachment {
    nodeId: string;
    socketName: string;
}

export type { FoxholePowerSocketConnection } from './power-socket-capacity.ts';

export interface ReconcileFoxholeConnectorAttachmentsOptions {
    connectorNodeId: string;
    startSocketName?: string;
    endSocketName?: string;
    movingSockets: readonly FoxholeSocketSnapPoint[];
    targets: ReadonlyArray<{
        nodeId: string;
        sockets: readonly FoxholeSocketSnapPoint[];
        attachments: FoxholeStructureSocketAttachmentMap;
    }>;
    maxDistance?: number;
    isTargetSocketAvailable?: (movingSocket: FoxholeSocketSnapPoint, targetSocket: FoxholeSocketSnapPoint) => boolean;
}

export interface ReconcileFoxholeConnectorAttachmentsResult {
    startAttachment?: FoxholeConnectorEndpointAttachment;
    endAttachment?: FoxholeConnectorEndpointAttachment;
    targetAttachmentsByNode: Map<string, FoxholeStructureSocketAttachmentMap>;
}

export interface FoxholeConnectorState extends BoardTransformState {
    foxholeKey: string;
    points: number[];
    startSocketName?: string;
    endSocketName?: string;
    startAttachment?: FoxholeConnectorEndpointAttachment;
    endAttachment?: FoxholeConnectorEndpointAttachment;
}

export const DEFAULT_FOXHOLE_CONNECTOR_STATE: FoxholeConnectorState = {
    foxholeKey: '',
    x: 0,
    y: 0,
    rotation: 0,
    visible: true,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    locked: false,
    points: [0, 0, 120, 0],
    startSocketName: undefined,
    endSocketName: undefined,
    startAttachment: undefined,
    endAttachment: undefined,
};

export function normalizeFoxholeConnectorPoints(points: readonly number[]): number[] {
    const normalized = points.filter(value => typeof value === 'number' && Number.isFinite(value));
    if (normalized.length < 4) {
        return DEFAULT_FOXHOLE_CONNECTOR_STATE.points.slice();
    }

    const evenLength = normalized.length - (normalized.length % 2);
    return normalized.slice(0, evenLength);
}

function normalizeFoxholeConnectorEndpointAttachment(
    value: FoxholeConnectorEndpointAttachment | null | undefined,
): FoxholeConnectorEndpointAttachment | undefined {
    const nodeId = String(value?.nodeId ?? '').trim();
    const socketName = String(value?.socketName ?? '').trim();
    return nodeId && socketName
        ? { nodeId, socketName }
        : undefined;
}

export function normalizeFoxholeConnectorState(state: Partial<FoxholeConnectorState> | undefined): FoxholeConnectorState {
    return {
        ...DEFAULT_FOXHOLE_CONNECTOR_STATE,
        ...(state ?? {}),
        foxholeKey: String(state?.foxholeKey ?? '').trim(),
        points: normalizeFoxholeConnectorPoints(state?.points ?? DEFAULT_FOXHOLE_CONNECTOR_STATE.points),
        startAttachment: normalizeFoxholeConnectorEndpointAttachment(state?.startAttachment),
        endAttachment: normalizeFoxholeConnectorEndpointAttachment(state?.endAttachment),
    };
}

export function createFoxholeConnectorNodeId(prefix = 'foxhole-connector'): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface FoxholeResolvedConnectorEndpointSocket {
    name: string;
    componentType?: string;
    pipeType?: string | null;
    socketTags: FoxholeSocketTagBitfield[];
}

export interface FoxholeConnectorWorldEndpoint {
    x: number;
    y: number;
    rotation?: number;
}

export function resolveFoxholeSplinePowerlineWorldEndpoint(
    origin: { x: number; y: number; },
    endpoint: FoxholeConnectorWorldEndpoint,
    nodeRotation = 0,
    scaleX = 1,
    scaleY = 1,
): FoxholeConnectorWorldEndpoint {
    const cos = Math.cos(nodeRotation);
    const sin = Math.sin(nodeRotation);
    const x = endpoint.x * scaleX;
    const y = endpoint.y * scaleY;
    return {
        x: origin.x + (x * cos) - (y * sin),
        y: origin.y + (x * sin) + (y * cos),
        rotation: endpoint.rotation,
    };
}

export interface ResolveFoxholeStraightConnectorGeometryOptions {
    currentStart?: FoxholeConnectorWorldEndpoint | null;
    currentEnd?: FoxholeConnectorWorldEndpoint | null;
    attachedStart?: FoxholeConnectorWorldEndpoint | null;
    attachedEnd?: FoxholeConnectorWorldEndpoint | null;
}

export interface ResolveFoxholeConnectorEndpointAttachmentsFromTargetsOptions {
    connectorNodeId: string;
    startSocketName?: string;
    endSocketName?: string;
    targets: ReadonlyArray<{
        nodeId: string;
        attachments: FoxholeStructureSocketAttachmentMap;
    }>;
}

export interface BuildFoxholeConnectorTargetAttachmentsFromEndpointsOptions {
    connectorNodeId: string;
    startSocketName?: string;
    endSocketName?: string;
    startAttachment?: FoxholeConnectorEndpointAttachment;
    endAttachment?: FoxholeConnectorEndpointAttachment;
    targets: ReadonlyArray<{
        nodeId: string;
        attachments: FoxholeStructureSocketAttachmentMap;
    }>;
}

function getNamedBuildSocketMap(structure: FoxholeManifestStructure): Map<string, FoxholeManifestBuildSocket> {
    const resolved = new Map<string, FoxholeManifestBuildSocket>();
    for (const socket of structure.buildSockets) {
        const name = String(socket.name ?? '').trim();
        if (!name || resolved.has(name)) {
            continue;
        }
        resolved.set(name, socket);
    }
    return resolved;
}

function getSocketTags(socket: FoxholeManifestBuildSocket | null | undefined): FoxholeSocketTagBitfield[] {
    return normalizeFoxholeSocketTags(socket?.socketTags);
}

function findNamedConnectorSocket(sockets: ReadonlyMap<string, FoxholeManifestBuildSocket>, name: string): FoxholeManifestBuildSocket | undefined {
    const exact = sockets.get(name);
    if (exact) return exact;
    // Connector metadata can use BackSocket while inherited blueprints publish
    // TrenchConnectorCommon:BackSocket. Never fall through to a ghost component.
    const normalized = normalizeFoxholeBuildSocketName(name);
    const matches = [...sockets.values()].filter(socket => normalizeFoxholeBuildSocketName(socket.name) === normalized);
    return matches.length === 1 ? matches[0] : undefined;
}

function findConnectorSocketFallback(
    structure: FoxholeManifestStructure,
    preferredSocketName?: string,
): FoxholeManifestBuildSocket | null {
    const namedSockets = getNamedBuildSocketMap(structure);
    if (preferredSocketName) {
        const preferred = findNamedConnectorSocket(namedSockets, preferredSocketName);
        if (preferred) {
            return preferred;
        }
    }

    for (const socket of namedSockets.values()) {
        if (hasFoxholePowerSocketTag(getSocketTags(socket))) {
            return socket;
        }
    }

    return namedSockets.values().next().value ?? null;
}

export function resolveFoxholeConnectorEndpointSockets(
    structure: FoxholeManifestStructure,
    options: {
        startSocketName?: string;
        endSocketName?: string;
    },
): {
    start: FoxholeResolvedConnectorEndpointSocket | null;
    end: FoxholeResolvedConnectorEndpointSocket | null;
} {
    const namedSockets = getNamedBuildSocketMap(structure);
    const inferred = resolveConnectorEndpointSocketNames(structure.id, structure.connector);
    const startSocketName = String(options.startSocketName ?? '').trim() || inferred.backSocketName;
    const endSocketName = String(options.endSocketName ?? '').trim() || inferred.frontSocketName;
    const startSocket = startSocketName
        ? findNamedConnectorSocket(namedSockets, startSocketName) ?? findConnectorSocketFallback(structure, endSocketName)
        : null;
    const endSocket = endSocketName
        ? findNamedConnectorSocket(namedSockets, endSocketName) ?? findConnectorSocketFallback(structure, startSocketName)
        : null;

    return {
        start: startSocketName && startSocket
            ? {
                name: startSocketName,
                componentType: startSocket.componentType,
                pipeType: startSocket.pipeType,
                socketTags: getSocketTags(startSocket),
            }
            : null,
        end: endSocketName && endSocket
            ? {
                name: endSocketName,
                componentType: endSocket.componentType,
                pipeType: endSocket.pipeType,
                socketTags: getSocketTags(endSocket),
            }
            : null,
    };
}

export function resolveFoxholeStraightConnectorGeometry(
    options: ResolveFoxholeStraightConnectorGeometryOptions,
): {
    x: number;
    y: number;
    points: number[];
} | null {
    const start = options.attachedStart ?? options.currentStart;
    const end = options.attachedEnd ?? options.currentEnd;
    if (!start || !end) {
        return null;
    }

    return {
        x: start.x,
        y: start.y,
        points: [0, 0, end.x - start.x, end.y - start.y],
    };
}

function resolvePowerlineEndpointRotation(
    attached: FoxholeConnectorWorldEndpoint | null | undefined,
    current: FoxholeConnectorWorldEndpoint | null | undefined,
    nodeRotation: number,
    end: boolean,
    chordRotation: number,
): number {
    if (Number.isFinite(attached?.rotation)) {
        const localRotation = Number(attached?.rotation) - nodeRotation - (end ? Math.PI : 0);
        return Math.atan2(Math.sin(localRotation), Math.cos(localRotation));
    }
    return Number.isFinite(current?.rotation) ? Number(current?.rotation) : chordRotation;
}

export function resolveFoxholeSplinePowerlineGeometry(
    options: ResolveFoxholeStraightConnectorGeometryOptions & {
        nodeRotation?: number;
        nodeScaleX?: number;
        nodeScaleY?: number;
    },
): {
    x: number;
    y: number;
    start: { x: number; y: number; rotation: number; };
    end: { x: number; y: number; rotation: number; };
} | null {
    const straight = resolveFoxholeStraightConnectorGeometry(options);
    if (!straight) {
        return null;
    }

    const worldDeltaX = straight.points[2] ?? 0;
    const worldDeltaY = straight.points[3] ?? 0;
    const nodeRotation = Number.isFinite(options.nodeRotation) ? Number(options.nodeRotation) : 0;
    const nodeScaleX = Number.isFinite(options.nodeScaleX) && options.nodeScaleX !== 0 ? Number(options.nodeScaleX) : 1;
    const nodeScaleY = Number.isFinite(options.nodeScaleY) && options.nodeScaleY !== 0 ? Number(options.nodeScaleY) : 1;
    const cos = Math.cos(nodeRotation);
    const sin = Math.sin(nodeRotation);
    const deltaX = ((worldDeltaX * cos) + (worldDeltaY * sin)) / nodeScaleX;
    const deltaY = ((worldDeltaY * cos) - (worldDeltaX * sin)) / nodeScaleY;
    const rotation = Math.atan2(deltaY, deltaX);
    const startRotation = resolvePowerlineEndpointRotation(
        options.attachedStart, options.currentStart, nodeRotation, false, rotation,
    );
    const endRotation = resolvePowerlineEndpointRotation(
        options.attachedEnd, options.currentEnd, nodeRotation, true, rotation,
    );

    return {
        x: straight.x,
        y: straight.y,
        start: {
            x: 0,
            y: 0,
            rotation: startRotation,
        },
        end: {
            x: deltaX,
            y: deltaY,
            rotation: endRotation,
        },
    };
}

export function resolvePowerlineEndpointRotationsAfterDetach(options: {
    start: Readonly<{ x: number; y: number; rotation: number; }>;
    end: Readonly<{ x: number; y: number; rotation: number; }>;
    detachedStart: boolean;
    detachedEnd: boolean;
}): { startRotation: number; endRotation: number; } {
    const chordRotation = Math.atan2(
        options.end.y - options.start.y,
        options.end.x - options.start.x,
    );

    return {
        startRotation: options.detachedStart ? chordRotation : options.start.rotation,
        endRotation: options.detachedEnd ? chordRotation : options.end.rotation,
    };
}

export function resolveFoxholePowerlineSelectionQuad(
    start: Readonly<{ x: number; y: number; }>,
    end: Readonly<{ x: number; y: number; }>,
    strokeWidth: number,
): [
    { x: number; y: number; },
    { x: number; y: number; },
    { x: number; y: number; },
    { x: number; y: number; },
] {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const halfStroke = Math.max(0, Number(strokeWidth) || 0) * 0.5;
    const directionX = length > 1e-6 ? dx / length : 1;
    const directionY = length > 1e-6 ? dy / length : 0;
    const perpendicularX = -directionY;
    const perpendicularY = directionX;
    const startCapX = start.x - (directionX * halfStroke);
    const startCapY = start.y - (directionY * halfStroke);
    const endCapX = end.x + (directionX * halfStroke);
    const endCapY = end.y + (directionY * halfStroke);

    return [
        {
            x: startCapX + (perpendicularX * halfStroke),
            y: startCapY + (perpendicularY * halfStroke),
        },
        {
            x: endCapX + (perpendicularX * halfStroke),
            y: endCapY + (perpendicularY * halfStroke),
        },
        {
            x: endCapX - (perpendicularX * halfStroke),
            y: endCapY - (perpendicularY * halfStroke),
        },
        {
            x: startCapX - (perpendicularX * halfStroke),
            y: startCapY - (perpendicularY * halfStroke),
        },
    ];
}

export interface FoxholeStructureSocketSnapHost {
    collectSnapSocketPoints: (viewport: import('pixi-viewport').Viewport) => FoxholeSocketSnapPoint[];
}

export function resolveHoveredFoxholePowerSocketTarget(
    world: { x: number; y: number; },
    hosts: readonly FoxholeStructureSocketSnapHost[],
    viewport: import('pixi-viewport').Viewport,
    excludedAttachment?: FoxholeConnectorEndpointAttachment,
    isSocketAvailable?: (socket: FoxholeSocketSnapPoint) => boolean,
): FoxholeSocketSnapPoint | null {
    return resolveHoveredFoxholePowerSocketPoint(world, hosts.flatMap(host => host.collectSnapSocketPoints(viewport)),
        excludedAttachment, isSocketAvailable);
}

export function resolveHoveredFoxholePowerSocketPoint(
    world: { x: number; y: number; },
    sockets: readonly FoxholeSocketSnapPoint[],
    excludedAttachment?: FoxholeConnectorEndpointAttachment,
    isSocketAvailable?: (socket: FoxholeSocketSnapPoint) => boolean,
): FoxholeSocketSnapPoint | null {
    let bestTarget: FoxholeSocketSnapPoint | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const socket of sockets) {
        if (!hasFoxholePowerSocketTag(socket.socketTags)) {
            continue;
        }
        if (
            excludedAttachment
            && String(socket.nodeId) === String(excludedAttachment.nodeId)
            && String(socket.socketName) === String(excludedAttachment.socketName)
        ) {
            continue;
        }
        if (isSocketAvailable && !isSocketAvailable(socket)) {
            continue;
        }

        const distance = Math.hypot(world.x - socket.x, world.y - socket.y);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestTarget = socket;
        }
    }

    return bestTarget;
}

export function shouldLockFoxholeConnectorEndpointToSocketAxis(options: {
    usesStraightChord: boolean;
    foxholeKey: string;
    oppositeEndpointAttached: boolean;
    activeEndpointSnapped: boolean;
}): boolean {
    return options.usesStraightChord
        && requiresStraightConnectorSocketAlignment(options.foxholeKey)
        && options.oppositeEndpointAttached
        && !options.activeEndpointSnapped;
}

export function isStraightConnectorSocketSnapAligned(options: {
    foxholeKey: string;
    start: { x: number; y: number; };
    end: { x: number; y: number; };
    endpointTangentRotation: number;
    maxRotationErrorRadians?: number;
}): boolean {
    if (!requiresStraightConnectorSocketAlignment(options.foxholeKey)) {
        return true;
    }

    const chordRotation = Math.atan2(
        options.end.y - options.start.y,
        options.end.x - options.start.x,
    );
    const rotationError = Math.abs(Math.atan2(
        Math.sin(options.endpointTangentRotation - chordRotation),
        Math.cos(options.endpointTangentRotation - chordRotation),
    ));
    const maxRotationErrorRadians = Number.isFinite(options.maxRotationErrorRadians)
        ? Math.max(0, Number(options.maxRotationErrorRadians))
        : Math.PI / 180;

    return rotationError <= maxRotationErrorRadians;
}

export function resolveFoxholeConnectorEndpointAttachmentsFromTargets(
    options: ResolveFoxholeConnectorEndpointAttachmentsFromTargetsOptions,
): {
    startAttachment?: FoxholeConnectorEndpointAttachment;
    endAttachment?: FoxholeConnectorEndpointAttachment;
} {
    const connectorNodeId = String(options.connectorNodeId ?? '').trim();
    const startSocketName = String(options.startSocketName ?? '').trim();
    const endSocketName = String(options.endSocketName ?? '').trim();
    let startAttachment: FoxholeConnectorEndpointAttachment | undefined;
    let endAttachment: FoxholeConnectorEndpointAttachment | undefined;

    for (const target of options.targets) {
        const targetNodeId = String(target.nodeId ?? '').trim();
        if (!targetNodeId) {
            continue;
        }

        for (const [socketName, attachment] of Object.entries(target.attachments)) {
            if (String(attachment?.nodeId ?? '').trim() !== connectorNodeId) {
                continue;
            }

            const connectorSocketName = String(attachment?.socketName ?? '').trim();
            if (startSocketName && connectorSocketName === startSocketName) {
                startAttachment = {
                    nodeId: targetNodeId,
                    socketName,
                };
            }
            if (endSocketName && connectorSocketName === endSocketName) {
                endAttachment = {
                    nodeId: targetNodeId,
                    socketName,
                };
            }
        }
    }

    return {
        ...(startAttachment ? { startAttachment } : {}),
        ...(endAttachment ? { endAttachment } : {}),
    };
}

export function buildFoxholeConnectorTargetAttachmentsFromEndpoints(
    options: BuildFoxholeConnectorTargetAttachmentsFromEndpointsOptions,
): Map<string, FoxholeStructureSocketAttachmentMap> {
    const connectorNodeId = String(options.connectorNodeId ?? '').trim();
    const startSocketName = String(options.startSocketName ?? '').trim();
    const endSocketName = String(options.endSocketName ?? '').trim();
    const targetAttachmentsByNode = new Map<string, FoxholeStructureSocketAttachmentMap>(
        options.targets.map(target => {
            const filteredAttachments = Object.fromEntries(
                Object.entries(target.attachments).filter(([, attachment]) => String(attachment?.nodeId ?? '').trim() !== connectorNodeId),
            ) as FoxholeStructureSocketAttachmentMap;
            return [String(target.nodeId), filteredAttachments] as const;
        }),
    );

    const applyAttachment = (
        attachment: FoxholeConnectorEndpointAttachment | undefined,
        connectorSocketName: string,
    ) => {
        if (!attachment || !connectorSocketName) {
            return;
        }

        const targetNodeId = String(attachment.nodeId ?? '').trim();
        const targetSocketName = String(attachment.socketName ?? '').trim();
        if (!targetNodeId || !targetSocketName) {
            return;
        }

        const nextAttachments = targetAttachmentsByNode.get(targetNodeId) ?? {};
        nextAttachments[targetSocketName] = {
            nodeId: connectorNodeId,
            socketName: connectorSocketName,
        };
        targetAttachmentsByNode.set(targetNodeId, nextAttachments);
    };

    applyAttachment(options.startAttachment, startSocketName);
    applyAttachment(options.endAttachment, endSocketName);
    return targetAttachmentsByNode;
}

export function reconcileFoxholeConnectorAttachments(
    options: ReconcileFoxholeConnectorAttachmentsOptions,
): ReconcileFoxholeConnectorAttachmentsResult {
    const connectorNodeId = String(options.connectorNodeId ?? '').trim();
    const startSocketName = String(options.startSocketName ?? '').trim();
    const endSocketName = String(options.endSocketName ?? '').trim();
    const targetAttachmentsByNode = new Map<string, FoxholeStructureSocketAttachmentMap>(
        options.targets.map(target => {
            const filteredAttachments = Object.fromEntries(
                Object.entries(target.attachments).filter(([, attachment]) => String(attachment?.nodeId ?? '').trim() !== connectorNodeId),
            ) as FoxholeStructureSocketAttachmentMap;
            return [target.nodeId, filteredAttachments] as const;
        }),
    );

    let startAttachment: FoxholeConnectorEndpointAttachment | undefined;
    let endAttachment: FoxholeConnectorEndpointAttachment | undefined;
    const targetSockets = options.targets.flatMap(target => target.sockets);

    for (const match of findAlignedFoxholeSocketMatches({
        movingSockets: options.movingSockets,
        targetSockets,
        maxDistance: options.maxDistance,
        isTargetSocketAvailable: options.isTargetSocketAvailable,
    })) {
        if (startSocketName && match.movingSocketName === startSocketName) {
            startAttachment = {
                nodeId: match.targetNodeId,
                socketName: match.targetSocketName,
            };
        }

        if (endSocketName && match.movingSocketName === endSocketName) {
            endAttachment = {
                nodeId: match.targetNodeId,
                socketName: match.targetSocketName,
            };
        }

        const targetAttachments = targetAttachmentsByNode.get(match.targetNodeId) ?? {};
        targetAttachments[match.targetSocketName] = {
            nodeId: connectorNodeId,
            socketName: match.movingSocketName,
        };
        targetAttachmentsByNode.set(match.targetNodeId, targetAttachments);
    }

    return {
        ...(startAttachment ? { startAttachment } : {}),
        ...(endAttachment ? { endAttachment } : {}),
        targetAttachmentsByNode,
    };
}
