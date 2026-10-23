import type {
    NixieExperimentalComponentEntitySnapshotV1,
    NixieExperimentalEntityRendererContextV1,
} from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { resolveFoxholeEntityAttachmentSockets } from './scene-v2-attachment-sockets.ts';
import type { FoxholeSceneV2ConnectorData } from './scene-v2-connectors.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';

export interface FoxholeSceneV2Matrix {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
}

interface Attachment {
    nodeId: string;
    socketName: string;
}

interface ResolvedSocket {
    x: number;
    y: number;
    rotation: number;
}

const FOXHOLE_OWNER_ID = 'nixie.foxhole-planner';
const CORE_OWNER_ID = 'nixie.core';
const IDENTITY_MATRIX: FoxholeSceneV2Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function componentData(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    ownerId: string,
    componentId: string,
): Record<string, unknown> | undefined {
    return entity.components.find(component => (
        component.ownerId === ownerId
        && component.componentId === componentId
        && component.definitionAvailable
    ))?.data;
}

function finite(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function multiply(left: FoxholeSceneV2Matrix, right: FoxholeSceneV2Matrix): FoxholeSceneV2Matrix {
    return {
        a: left.a * right.a + left.c * right.b,
        b: left.b * right.a + left.d * right.b,
        c: left.a * right.c + left.c * right.d,
        d: left.b * right.c + left.d * right.d,
        tx: left.a * right.tx + left.c * right.ty + left.tx,
        ty: left.b * right.tx + left.d * right.ty + left.ty,
    };
}

function localMatrix(entity: NixieExperimentalComponentEntitySnapshotV1): FoxholeSceneV2Matrix {
    const transform = componentData(entity, CORE_OWNER_ID, 'transform');
    const rotation = finite(transform?.rotation, 0);
    const scaleX = finite(transform?.scaleX, 1);
    const scaleY = finite(transform?.scaleY, 1);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    return {
        a: cosine * scaleX,
        b: sine * scaleX,
        c: -sine * scaleY,
        d: cosine * scaleY,
        tx: finite(transform?.x, 0),
        ty: finite(transform?.y, 0),
    };
}

export function resolveFoxholeSceneV2WorldMatrices(
    context: NixieExperimentalEntityRendererContextV1,
): Map<string, FoxholeSceneV2Matrix> {
    const entities = new Map(context.entities.map(entity => [entity.entityId, entity]));
    const resolved = new Map<string, FoxholeSceneV2Matrix>();
    const resolving = new Set<string>();
    const resolve = (entityId: string): FoxholeSceneV2Matrix => {
        const existing = resolved.get(entityId);
        if (existing) {
            return existing;
        }
        const entity = entities.get(entityId);
        if (!entity || resolving.has(entityId)) {
            return IDENTITY_MATRIX;
        }
        resolving.add(entityId);
        const hierarchy = componentData(entity, CORE_OWNER_ID, 'hierarchy');
        const parentId = typeof hierarchy?.parentId === 'string' ? hierarchy.parentId : '';
        const world = multiply(parentId ? resolve(parentId) : IDENTITY_MATRIX, localMatrix(entity));
        resolving.delete(entityId);
        resolved.set(entityId, world);
        return world;
    };
    for (const entityId of entities.keys()) {
        resolve(entityId);
    }
    return resolved;
}

export function invertFoxholeSceneV2Matrix(matrix: FoxholeSceneV2Matrix): FoxholeSceneV2Matrix | null {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) {
        return null;
    }
    const reciprocal = 1 / determinant;
    return {
        a: matrix.d * reciprocal,
        b: -matrix.b * reciprocal,
        c: -matrix.c * reciprocal,
        d: matrix.a * reciprocal,
        tx: (matrix.c * matrix.ty - matrix.d * matrix.tx) * reciprocal,
        ty: (matrix.b * matrix.tx - matrix.a * matrix.ty) * reciprocal,
    };
}

export function transformFoxholeSceneV2Point(matrix: FoxholeSceneV2Matrix, x: number, y: number): { x: number; y: number; } {
    return {
        x: matrix.a * x + matrix.c * y + matrix.tx,
        y: matrix.b * x + matrix.d * y + matrix.ty,
    };
}

function normalizedSocketName(value: string): string {
    const normalized = value.trim().replace(/_GEN_VARIABLE$/iu, '');
    return (normalized.includes(':') ? normalized.slice(normalized.lastIndexOf(':') + 1) : normalized).toLowerCase();
}

function resolveSocket(
    link: Attachment | undefined,
    context: NixieExperimentalEntityRendererContextV1,
    worldMatrices: Map<string, FoxholeSceneV2Matrix>,
    assetMetadataById: Record<string, FoxholeSceneV2AssetMetadata>,
): ResolvedSocket | null {
    if (!link) {
        return null;
    }
    const entity = context.entities.find(candidate => candidate.entityId === link.nodeId);
    const asset = entity ? componentData(entity, FOXHOLE_OWNER_ID, 'asset') : undefined;
    const assetId = typeof asset?.assetId === 'string' ? asset.assetId : '';
    const metadata = assetMetadataById[assetId];
    const expectedName = normalizedSocketName(link.socketName);
    const socket = entity && resolveFoxholeEntityAttachmentSockets(entity, metadata).find(candidate => normalizedSocketName(candidate.name) === expectedName);
    const world = worldMatrices.get(link.nodeId);
    if (!socket || !world) {
        return null;
    }
    const position = transformFoxholeSceneV2Point(world, socket.x, socket.y);
    const direction = transformFoxholeSceneV2Point(world, socket.x + Math.cos(socket.rotation), socket.y + Math.sin(socket.rotation));
    return {
        ...position,
        rotation: Math.atan2(direction.y - position.y, direction.x - position.x),
    };
}

function attachment(value: unknown): Attachment | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const input = value as Record<string, unknown>;
    return typeof input.nodeId === 'string' && typeof input.socketName === 'string'
        ? { nodeId: input.nodeId, socketName: input.socketName }
        : undefined;
}

function toLocal(socket: ResolvedSocket | null, inverseEntityWorld: FoxholeSceneV2Matrix | null): ResolvedSocket | null {
    if (!socket || !inverseEntityWorld) {
        return null;
    }
    const position = transformFoxholeSceneV2Point(inverseEntityWorld, socket.x, socket.y);
    const direction = transformFoxholeSceneV2Point(
        inverseEntityWorld,
        socket.x + Math.cos(socket.rotation),
        socket.y + Math.sin(socket.rotation),
    );
    return {
        ...position,
        rotation: Math.atan2(direction.y - position.y, direction.x - position.x),
    };
}

export function resolveFoxholeSceneV2ConnectorAttachments(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    data: FoxholeSceneV2ConnectorData & Record<string, unknown>,
    context: NixieExperimentalEntityRendererContextV1,
    assetMetadataById: Record<string, FoxholeSceneV2AssetMetadata>,
): FoxholeSceneV2ConnectorData {
    const matrices = resolveFoxholeSceneV2WorldMatrices(context);
    const inverseEntityWorld = invertFoxholeSceneV2Matrix(matrices.get(entity.entityId) ?? localMatrix(entity));
    const start = toLocal(resolveSocket(attachment(data.startAttachment), context, matrices, assetMetadataById), inverseEntityWorld);
    const end = toLocal(resolveSocket(attachment(data.endAttachment), context, matrices, assetMetadataById), inverseEntityWorld);
    const points = [...data.points];
    if (start) {
        points.splice(0, 2, start.x, start.y);
    }
    if (end) {
        points.splice(points.length - 2, 2, end.x, end.y);
    }
    return { foxholeKey: data.foxholeKey, points };
}

export function resolveFoxholeSceneV2SplineAttachments(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    data: FoxholeSceneV2SplineConnectorData & Record<string, unknown>,
    context: NixieExperimentalEntityRendererContextV1,
    assetMetadataById: Record<string, FoxholeSceneV2AssetMetadata>,
): FoxholeSceneV2SplineConnectorData {
    const matrices = resolveFoxholeSceneV2WorldMatrices(context);
    const inverseEntityWorld = invertFoxholeSceneV2Matrix(matrices.get(entity.entityId) ?? localMatrix(entity));
    const resolve = (prefix: 'start' | 'end') => {
        const nodeId = data[`${prefix}AttachmentNodeId`];
        const socketName = data[`${prefix}AttachmentSocketName`];
        return typeof nodeId === 'string' && typeof socketName === 'string'
            ? toLocal(resolveSocket({ nodeId, socketName }, context, matrices, assetMetadataById), inverseEntityWorld)
            : null;
    };
    const start = resolve('start');
    const end = resolve('end');
    const occupancy = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'socket-attachments' && component.definitionAvailable)?.data.attachments;
    return {
        ...data,
        socketAttachments: Array.isArray(occupancy)
            ? Object.fromEntries(occupancy.flatMap(entry =>
                entry && typeof entry === 'object' && 'socketName' in entry && typeof entry.socketName === 'string'
                    ? [[entry.socketName, entry]]
                    : []))
            : {},
        ...(start ? { startX: start.x, startY: start.y, startRotation: start.rotation } : {}),
        ...(end ? { endX: end.x, endY: end.y, endRotation: end.rotation } : {}),
    };
}
