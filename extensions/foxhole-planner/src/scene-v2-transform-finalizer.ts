import type {
    NixieExperimentalComponentEntitySnapshotV1,
    NixieExperimentalComponentOperationV1,
    NixieExperimentalComponentJsonObjectV1,
    NixieExperimentalTransformFinalizeRequestV1,
    NixieExperimentalTransformFinalizeResultV1,
} from '@nixie/extension-sdk/experimental/scene-v2';
import { clampDraggedSplineEndpoint, selectNixieExperimentalConnectionTargetV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import foxholeSceneV2Assets from '#foxhole-scene-v2-assets';
import { resolveFoxholeEntityStructureSockets } from './effective-structure-sockets.ts';
import { sampleFoxholeSceneV2Connector, foxholeSceneV2ConnectorConstraints, foxholeSceneV2ConnectorEndpoints } from './scene-v2-connector-path.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { resolveFacilityPipeSideSocketsFromPath } from './connector-side-sockets.ts';
import { isFoxholePowerSocketConnectionAvailable } from './power-socket-capacity.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';
import type { FoxholePowerSocketConnection } from './power-socket-capacity.ts';
import type {
    FoxholeSceneV2AssetMetadata,
    FoxholeSceneV2BuildSocketMetadata,
} from './scene-v2-asset-metadata.ts';

export const FOXHOLE_SCENE_V2_TRANSFORM_FINALIZER_SYSTEM_ID = 'transforms.socket-snapping';

const FOXHOLE_OWNER_ID = 'nixie.foxhole-planner';
const CORE_OWNER_ID = 'nixie.core';
const SOCKET_ATTACHMENTS_COMPONENT_ID = 'socket-attachments';
const SNAP_DISTANCE = 20;
const MAX_FACING_ERROR = 8 * Math.PI / 180;
const FOUNDATION_MASK = 8n;
const assets = foxholeSceneV2Assets as Record<string, FoxholeSceneV2AssetMetadata>;

interface Matrix {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
}

interface Attachment {
    localSocketName: string;
    targetEntityId: string;
    targetSocketName: string;
}

interface WorldSocket {
    entityId: string;
    socket: FoxholeSceneV2BuildSocketMetadata;
    x: number;
    y: number;
    z: number;
    world: [number, number, number];
    direction: [number, number, number];
    rotation: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function component(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    ownerId: string,
    componentId: string,
) {
    return entity.components.find(candidate => (
        candidate.ownerId === ownerId
        && candidate.componentId === componentId
        && candidate.definitionAvailable
    ));
}

function finite(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function multiply(left: Matrix, right: Matrix): Matrix {
    return {
        a: left.a * right.a + left.c * right.b,
        b: left.b * right.a + left.d * right.b,
        c: left.a * right.c + left.c * right.d,
        d: left.b * right.c + left.d * right.d,
        tx: left.a * right.tx + left.c * right.ty + left.tx,
        ty: left.b * right.tx + left.d * right.ty + left.ty,
    };
}

function localMatrix(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    override?: NixieExperimentalTransformFinalizeRequestV1['transform'],
): Matrix {
    const data = component(entity, CORE_OWNER_ID, 'transform')?.data;
    const rotation = override?.rotation ?? finite(data?.rotation, 0);
    const scaleX = override?.scaleX ?? finite(data?.scaleX, 1);
    const scaleY = override?.scaleY ?? finite(data?.scaleY, 1);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    return {
        a: cosine * scaleX,
        b: sine * scaleX,
        c: -sine * scaleY,
        d: cosine * scaleY,
        tx: override?.x ?? finite(data?.x, 0),
        ty: override?.y ?? finite(data?.y, 0),
    };
}

function parentId(entity: NixieExperimentalComponentEntitySnapshotV1): string {
    const value = component(entity, CORE_OWNER_ID, 'hierarchy')?.data.parentId;
    return typeof value === 'string' ? value : '';
}

function worldMatrices(
    entities: readonly NixieExperimentalComponentEntitySnapshotV1[],
    movedEntityId: string,
    transform: NixieExperimentalTransformFinalizeRequestV1['transform'],
): Map<string, Matrix> {
    const byId = new Map(entities.map(entity => [entity.entityId, entity]));
    const resolved = new Map<string, Matrix>();
    const resolving = new Set<string>();
    const resolve = (entityId: string): Matrix => {
        const existing = resolved.get(entityId);
        if (existing) {
            return existing;
        }
        const entity = byId.get(entityId);
        if (!entity || resolving.has(entityId)) {
            return IDENTITY;
        }
        resolving.add(entityId);
        const parent = parentId(entity);
        const world = multiply(
            parent ? resolve(parent) : IDENTITY,
            localMatrix(entity, entityId === movedEntityId ? transform : undefined),
        );
        resolving.delete(entityId);
        resolved.set(entityId, world);
        return world;
    };
    for (const entity of entities) {
        resolve(entity.entityId);
    }
    return resolved;
}

function point(matrix: Matrix, x: number, y: number): { x: number; y: number; } {
    return { x: matrix.a * x + matrix.c * y + matrix.tx, y: matrix.b * x + matrix.d * y + matrix.ty };
}

function inverseVector(matrix: Matrix, x: number, y: number): { x: number; y: number; } | null {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) {
        return null;
    }
    return {
        x: (matrix.d * x - matrix.c * y) / determinant,
        y: (-matrix.b * x + matrix.a * y) / determinant,
    };
}

function assetMetadata(entity: NixieExperimentalComponentEntitySnapshotV1): FoxholeSceneV2AssetMetadata | null {
    const assetId = component(entity, FOXHOLE_OWNER_ID, 'asset')?.data.assetId
        ?? connectorComponent(entity)?.data.foxholeKey;
    return typeof assetId === 'string' ? assets[assetId] ?? null : null;
}

function connectorComponent(entity: NixieExperimentalComponentEntitySnapshotV1) {
    return component(entity, FOXHOLE_OWNER_ID, 'spline-connector') ?? component(entity, FOXHOLE_OWNER_ID, 'connector');
}

function connectorEndpoints(entity: NixieExperimentalComponentEntitySnapshotV1): Array<{ role: 'start' | 'end'; socket: FoxholeSceneV2BuildSocketMetadata; }> {
    const connector = connectorComponent(entity);
    if (!connector) {
        return [];
    }
    const data = connector.data;
    const metadata = assetMetadata(entity);
    const templates = resolveFoxholeEntityStructureSockets(entity, metadata);
    const points = Array.isArray(data.points) ? data.points.map(value => finite(value, 0)) : [];
    const spline = connector.componentId === 'spline-connector';
    const key = String(data.foxholeKey ?? '').toLowerCase();
    return (['start', 'end'] as const).flatMap(role => {
        const name = data[`${role}SocketName`]
            || (role === 'start' ? metadata?.connector?.backSocketName : metadata?.connector?.frontSocketName);
        if (typeof name !== 'string' || !name) {
            return [];
        }
        const template = templates.find(socket => normalizedName(socket.name) === normalizedName(name))
            ?? templates.find(socket => normalizedName(socket.name) !== normalizedName(data[`${role === 'start' ? 'end' : 'start'}SocketName`] as string ?? ''));
        if (!template || (!spline && points.length < 4)) {
            return [];
        }
        const start = role === 'start';
        const index = start ? 0 : points.length - 2;
        const x = spline ? finite(data[`${role}X`], 0) : points[index]!;
        const y = spline ? finite(data[`${role}Y`], 0) : points[index + 1]!;
        const rotation = spline
            ? finite(data[`${role}Rotation`], 0) + (start || (key.includes('pipe') && !key.includes('underground')) ? Math.PI : 0)
            : start
                ? Math.atan2(points[1]! - points[3]!, points[0]! - points[2]!)
                : Math.atan2(y - points[index - 1]!, x - points[index - 2]!);
        return [{ role, socket: { ...template, name, x, y, rotation } }];
    });
}

function sockets(entity: NixieExperimentalComponentEntitySnapshotV1, matrix: Matrix,
    projection?: ReturnType<typeof createFoxholeSpatialProjection>): WorldSocket[] {
    const localSockets = connectorComponent(entity)
        ? connectorEndpoints(entity).map(endpoint => endpoint.socket)
        : resolveFoxholeEntityStructureSockets(entity, assetMetadata(entity));
    const connector = connectorComponent(entity);
    const asset = assetMetadata(entity);
    if (connector?.componentId === 'spline-connector' && connector.data.foxholeKey === 'facilitypipe' && localSockets.length) {
        const data = connector.data as unknown as FoxholeSceneV2SplineConnectorData;
        const span = asset?.renderLayers.span ?? asset?.renderLayers.underlay;
        const sideSockets = resolveFacilityPipeSideSocketsFromPath(sampleFoxholeSceneV2Connector(data, asset ?? undefined),
            Math.max(2, (span?.height ?? 8) * 0.5));
        localSockets.push(...sideSockets.map(socket => ({ ...localSockets[0]!, ...socket })));
    }
    return localSockets.map(socket => {
        const position = point(matrix, socket.x, socket.y);
        const direction = point(matrix, socket.x + Math.cos(socket.rotation), socket.y + Math.sin(socket.rotation));
        const world = projection?.toWorld(entity, [socket.x, socket.y, socket.z ?? 0]) ?? [position.x, position.y, 0];
        const facing = projection?.toWorld(entity, [socket.x + Math.cos(socket.rotation), socket.y + Math.sin(socket.rotation), socket.z ?? 0])
            ?? [direction.x, direction.y, 0];
        return {
            entityId: entity.entityId,
            socket,
            ...position,
            z: world[2]!,
            world: world as [number, number, number],
            direction: facing.map((value, axis) => value - world[axis]!) as [number, number, number],
            rotation: Math.atan2(direction.y - position.y, direction.x - position.x),
        };
    });
}

function normalizedName(value: string): string {
    const normalized = value.trim().replace(/_GEN_VARIABLE$/iu, '');
    return (normalized.includes(':') ? normalized.slice(normalized.lastIndexOf(':') + 1) : normalized).toLowerCase();
}

function railCouplerKind(value: string): 'front' | 'rear' | null {
    const name = normalizedName(value);
    if (name.includes('front') && name.includes('coupler')) {
        return 'front';
    }
    if ((name.includes('rear') || name.includes('back')) && name.includes('coupler')) {
        return 'rear';
    }
    return null;
}

function sharedTagCount(left: FoxholeSceneV2BuildSocketMetadata, right: FoxholeSceneV2BuildSocketMetadata): number {
    let count = 0;
    for (const leftTag of left.socketTags ?? []) {
        const leftMask = BigInt(leftTag.mask) & ~FOUNDATION_MASK;
        const leftCategory = BigInt(leftTag.category);
        if (!leftMask || !leftCategory) {
            continue;
        }
        for (const rightTag of right.socketTags ?? []) {
            const rightMask = BigInt(rightTag.mask) & ~FOUNDATION_MASK;
            const rightCategory = BigInt(rightTag.category);
            if (!rightMask || !rightCategory) {
                continue;
            }
            let overlap = 0n;
            if (leftCategory & rightCategory) {
                overlap |= leftMask & rightMask;
            }
            overlap |= leftMask & rightCategory;
            overlap |= rightMask & leftCategory;
            while (overlap > 0n) {
                overlap &= overlap - 1n;
                count += 1;
            }
        }
    }
    return count;
}

function compatible(left: WorldSocket, right: WorldSocket): number {
    const leftCoupler = railCouplerKind(left.socket.name);
    const rightCoupler = railCouplerKind(right.socket.name);
    if (leftCoupler && rightCoupler && leftCoupler !== rightCoupler) {
        return 1;
    }
    return sharedTagCount(left.socket, right.socket);
}

function readAttachments(entity: NixieExperimentalComponentEntitySnapshotV1): Attachment[] {
    const value = component(entity, FOXHOLE_OWNER_ID, SOCKET_ATTACHMENTS_COMPONENT_ID)?.data.attachments;
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return [];
        }
        const record = entry as Record<string, unknown>;
        return typeof record.localSocketName === 'string'
            && typeof record.targetEntityId === 'string'
            && typeof record.targetSocketName === 'string'
            ? [{
                localSocketName: record.localSocketName,
                targetEntityId: record.targetEntityId,
                targetSocketName: record.targetSocketName,
            }]
            : [];
    });
}

function attachmentAt(items: readonly Attachment[], socketName: string): Attachment | undefined {
    const key = normalizedName(socketName);
    return items.find(item => normalizedName(item.localSocketName) === key);
}

function endpointAttachmentAt(entity: NixieExperimentalComponentEntitySnapshotV1, socketName: string): Attachment | undefined {
    const connector = connectorComponent(entity);
    const endpoint = connector && connectorEndpoints(entity).find(candidate => normalizedName(candidate.socket.name) === normalizedName(socketName));
    if (!connector || !endpoint) {
        return undefined;
    }
    const reference = connector.componentId === 'spline-connector'
        ? { nodeId: connector.data[`${endpoint.role}AttachmentNodeId`], socketName: connector.data[`${endpoint.role}AttachmentSocketName`] }
        : connector.data[`${endpoint.role}Attachment`];
    return reference && typeof reference === 'object' && !Array.isArray(reference)
        && typeof reference.nodeId === 'string' && typeof reference.socketName === 'string'
        ? { localSocketName: endpoint.socket.name, targetEntityId: reference.nodeId, targetSocketName: reference.socketName }
        : undefined;
}

function sameAttachments(left: readonly Attachment[], right: readonly Attachment[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function inversePoint(matrix: Matrix, world: { x: number; y: number; }) {
    return inverseVector(matrix, world.x - matrix.tx, world.y - matrix.ty);
}

function connectorEndpointPatch(entity: NixieExperimentalComponentEntitySnapshotV1, role: 'start' | 'end', world: WorldSocket, matrix: Matrix, projection?: ReturnType<typeof createFoxholeSpatialProjection>): NixieExperimentalComponentJsonObjectV1 | null {
    const connector = connectorComponent(entity)!;
    const local = projection?.toLocal(entity, world.world);
    const position = local ? { x: local[0], y: local[1] } : inversePoint(matrix, world);
    const localFacing = projection?.toLocal(entity, world.world.map((value, axis) => value - world.direction[axis]!) as [number, number, number]);
    const direction = local && localFacing ? { x: localFacing[0] - local[0], y: localFacing[1] - local[1] }
        : inverseVector(matrix, Math.cos(world.rotation + Math.PI), Math.sin(world.rotation + Math.PI));
    if (!position || !direction) {
        return null;
    }
    if (connector.componentId === 'connector') {
        const points = [...connector.data.points as number[]];
        const index = role === 'start' ? 0 : points.length - 2;
        points[index] = position.x;
        points[index + 1] = position.y;
        return { points };
    }
    const key = String(connector.data.foxholeKey ?? '').toLowerCase();
    const reversed = role === 'start' || (key.includes('pipe') && !key.includes('underground'));
    const angle = Math.atan2(direction.y, direction.x) - (reversed ? Math.PI : 0);
    return { [`${role}X`]: position.x, [`${role}Y`]: position.y, [`${role}Rotation`]: Math.atan2(Math.sin(angle), Math.cos(angle)) };
}

function carriedConnectorPatches(moved: NixieExperimentalComponentEntitySnapshotV1,
    entities: readonly NixieExperimentalComponentEntitySnapshotV1[], matrices: ReadonlyMap<string, Matrix>,
    movedSockets: readonly WorldSocket[]): Map<string, NixieExperimentalComponentJsonObjectV1> {
    const patches = new Map<string, NixieExperimentalComponentJsonObjectV1>();
    for (const attachment of readAttachments(moved)) {
        const entity = entities.find(candidate => candidate.entityId === attachment.targetEntityId);
        if (!entity || entity.entityId === moved.entityId || !connectorComponent(entity)) {
            continue;
        }
        const endpoint = connectorEndpoints(entity).find(candidate => normalizedName(candidate.socket.name) === normalizedName(attachment.targetSocketName));
        const reverse = endpoint && endpointAttachmentAt(entity, endpoint.socket.name);
        const target = movedSockets.find(socket => normalizedName(socket.socket.name) === normalizedName(attachment.localSocketName));
        if (!endpoint || !target || reverse?.targetEntityId !== moved.entityId
            || normalizedName(reverse.targetSocketName) !== normalizedName(attachment.localSocketName)) {
            continue;
        }
        const patch = connectorEndpointPatch(entity, endpoint.role, target, matrices.get(entity.entityId) ?? localMatrix(entity));
        if (!patch) {
            continue;
        }
        const previous = patches.get(entity.entityId);
        if (previous && 'points' in previous && 'points' in patch) {
            const index = endpoint.role === 'start' ? 0 : (patch.points as number[]).length - 2;
            (previous.points as number[])[index] = (patch.points as number[])[index]!;
            (previous.points as number[])[index + 1] = (patch.points as number[])[index + 1]!;
        } else {
            patches.set(entity.entityId, { ...previous, ...patch });
        }
    }
    return patches;
}

function finalizeConnector(request: NixieExperimentalTransformFinalizeRequestV1, moved: NixieExperimentalComponentEntitySnapshotV1): NixieExperimentalTransformFinalizeResultV1 {
    const entities = request.context.entities;
    const connector = connectorComponent(moved)!;
    const gesture = request.geometryGesture;
    const role = gesture?.handleId === 'start' || gesture?.handleId === 'polyline-vertex-0' ? 'start'
        : gesture?.handleId === 'end' || gesture?.handleId === 'polyline-vertex-' + (Array.isArray(connector.data.points) ? connector.data.points.length / 2 - 1 : -1) ? 'end' : null;
    const projection = createFoxholeSpatialProjection(entities.map(entity => entity.entityId !== moved.entityId ? entity : ({ ...entity,
        components: entity.components.map(entry => entry.ownerId === CORE_OWNER_ID && entry.componentId === 'transform'
            ? { ...entry, data: { ...entry.data, ...request.transform } } : entry) })));
    if (gesture && !role) {
        const tangentRole = gesture.handleId === 'start-rotation' ? 'start' : gesture.handleId === 'end-rotation' ? 'end' : null;
        if (!tangentRole || connector.componentId !== 'spline-connector') return { contractVersion: 1, transform: { x: request.transform.x, y: request.transform.y } };
        const point = projection.toLocal(moved, [gesture.worldPoint.x, gesture.worldPoint.y, gesture.worldPoint.z ?? 0]);
        const key = String(connector.data.foxholeKey ?? '').toLowerCase();
        const reversedEnd = tangentRole === 'end' && !(key.includes('pipe') && !key.includes('underground'));
        const angle = Math.atan2(point[1] - Number(connector.data[tangentRole + 'Y']), point[0] - Number(connector.data[tangentRole + 'X'])) + (reversedEnd ? Math.PI : 0);
        return { contractVersion: 1, transform: { x: request.transform.x, y: request.transform.y }, transaction: { contractVersion: 1,
            transactionId: 'connector-tangent-' + globalThis.crypto.randomUUID(), operations: [{ op: 'patch', entityId: moved.entityId,
                componentId: connector.componentId, set: { [tangentRole + 'Rotation']: Math.atan2(Math.sin(angle), Math.cos(angle)) } }] } };
    }
    const matrices = worldMatrices(entities, moved.entityId, request.transform);
    const matrix = matrices.get(moved.entityId) ?? localMatrix(moved, request.transform);
    const endpoints = connectorEndpoints(moved);
    const dragged = endpoints.find(endpoint => endpoint.role === role);
    const nextAttachments = new Map(entities.map(entity => [entity.entityId, readAttachments(entity).filter(item =>
        !(item.targetEntityId === moved.entityId && (!gesture || normalizedName(item.targetSocketName) === normalizedName(dragged!.socket.name)))
        && !(gesture && entity.entityId === moved.entityId && normalizedName(item.localSocketName) === normalizedName(dragged!.socket.name)))]));
    const operations: NixieExperimentalComponentOperationV1[] = [];
    const set: Record<string, import('@nixie/extension-sdk/experimental/scene-v2').NixieExperimentalComponentJsonValueV1> = {};
    const unset: string[] = [];
    const claimed = new Set<string>();
    const movingSockets = sockets(moved, matrix, projection);
    const power = connector.data.foxholeKey === 'powerline';
    const connections: FoxholePowerSocketConnection[] = entities.flatMap(entity => {
        const candidate = connectorComponent(entity);
        if (candidate?.data.foxholeKey !== 'powerline') {
            return [];
        }
        return connectorEndpoints(entity).map(endpoint => {
            const attachment = candidate.componentId === 'spline-connector'
                ? { nodeId: candidate.data[`${endpoint.role}AttachmentNodeId`], socketName: candidate.data[`${endpoint.role}AttachmentSocketName`] }
                : candidate.data[`${endpoint.role}Attachment`];
            return { connectorNodeId: entity.entityId, connectorSocketName: endpoint.socket.name,
                attachment: attachment && typeof attachment === 'object' && !Array.isArray(attachment)
                    && typeof attachment.nodeId === 'string' && typeof attachment.socketName === 'string'
                    ? { nodeId: attachment.nodeId, socketName: attachment.socketName }
                    : null };
        });
    });
    for (const endpoint of connectorEndpoints(moved)) {
        const moving = movingSockets.find(socket => socket.socket.name === endpoint.socket.name)!;
        if (gesture && endpoint.role !== role) {
            // An endpoint gesture owns one end only. Preserve the opposite link
            // without opportunistically snapping it to a different nearby port.
            const retained = endpointAttachmentAt(moved, endpoint.socket.name);
            if (retained && nextAttachments.has(retained.targetEntityId)
                && !nextAttachments.get(retained.targetEntityId)!.some(link => normalizedName(link.localSocketName) === normalizedName(retained.targetSocketName)
                    && link.targetEntityId === moved.entityId && normalizedName(link.targetSocketName) === normalizedName(endpoint.socket.name))) {
                nextAttachments.get(retained.targetEntityId)!.push({ localSocketName: retained.targetSocketName,
                    targetEntityId: moved.entityId, targetSocketName: endpoint.socket.name });
                claimed.add(retained.targetEntityId + ':' + retained.targetSocketName);
            }
            continue;
        }
        const eligible: Array<{ entityId: string; id: string; position: [number, number, number]; target: WorldSocket; }> = [];
        for (const entity of entities) {
            if (entity.entityId === moved.entityId) continue;
            for (const target of sockets(entity, matrices.get(entity.entityId) ?? localMatrix(entity), projection)) {
                const key = target.entityId + ':' + target.socket.name;
                const endpointLink = endpointAttachmentAt(entity, target.socket.name);
                if (endpointLink && (endpointLink.targetEntityId !== moved.entityId
                    || normalizedName(endpointLink.targetSocketName) !== normalizedName(endpoint.socket.name))) continue;
                const available = power && !connectorComponent(entity)
                    ? isFoxholePowerSocketConnectionAvailable({ targetNodeId: target.entityId, targetSocketName: target.socket.name,
                        maxConnections: assetMetadata(entity)?.powerSocketMaxConnections, connections,
                        movingConnectorNodeId: moved.entityId, movingConnectorSocketName: endpoint.socket.name })
                    : !attachmentAt(nextAttachments.get(target.entityId) ?? [], target.socket.name);
                if (claimed.has(key) || !available || compatible(moving, target) <= 0) continue;
                const opposite = connectorEndpoints(moved).find(other => other.role !== endpoint.role);
                const oppositeLink = opposite && endpointAttachmentAt(moved, opposite.socket.name);
                if (power && oppositeLink?.targetEntityId === target.entityId && normalizedName(oppositeLink.targetSocketName) === normalizedName(target.socket.name)) continue;
                eligible.push({ entityId: target.entityId, id: target.socket.name, position: power ? [target.world[0], target.world[1], 0] : target.world, target });
            }
        }
        const selected = !gesture || gesture.snappingEnabled ? selectNixieExperimentalConnectionTargetV1({
            point: gesture ? [gesture.worldPoint.x, gesture.worldPoint.y, power ? 0 : gesture.worldPoint.z ?? moving.world[2]] : power ? [moving.world[0], moving.world[1], 0] : moving.world,
            targets: eligible, maximumDistance: SNAP_DISTANCE,
            ...(power && gesture ? { hoveredEntityIds: gesture.hoveredEntityIds } : {}),
        }) : null;
        const best = selected ? { target: selected.target } : null;
        if (gesture) for (const peer of entities) {
            if (peer.entityId === moved.entityId || !connectorComponent(peer)) continue;
            for (const peerEndpoint of connectorEndpoints(peer)) {
                const link = endpointAttachmentAt(peer, peerEndpoint.socket.name);
                if (link?.targetEntityId !== moved.entityId || normalizedName(link.targetSocketName) !== normalizedName(endpoint.socket.name)) continue;
                const peerGeometry = connectorComponent(peer)!;
                operations.push({ op: 'patch', entityId: peer.entityId, componentId: peerGeometry.componentId,
                    unset: peerGeometry.componentId === 'spline-connector' ? [peerEndpoint.role + 'AttachmentNodeId', peerEndpoint.role + 'AttachmentSocketName'] : [peerEndpoint.role + 'Attachment'] });
            }
        }
        const nodeField = `${endpoint.role}AttachmentNodeId`;
        const socketField = `${endpoint.role}AttachmentSocketName`;
        if (!best) {
            if (gesture && connector.componentId === 'spline-connector' && !(request.interaction === 'placement' && role === 'start')) {
                const data = connector.data as unknown as FoxholeSceneV2SplineConnectorData;
                const endpoints = foxholeSceneV2ConnectorEndpoints(data);
                const pointer = projection.toLocal(moved, [gesture.worldPoint.x, gesture.worldPoint.y, gesture.worldPoint.z ?? moving.world[2]]);
                const next = clampDraggedSplineEndpoint(endpoint.role,
                    { ...endpoints.start, ...(endpoint.role === 'start' ? { x: pointer[0], y: pointer[1] } : {}) },
                    { ...endpoints.end, ...(endpoint.role === 'end' ? { x: pointer[0], y: pointer[1] } : {}) },
                    foxholeSceneV2ConnectorConstraints(data, assetMetadata(moved) ?? undefined));
                Object.assign(set, { [endpoint.role + 'X']: next[endpoint.role].x, [endpoint.role + 'Y']: next[endpoint.role].y });
            }
            if (connector.componentId === 'spline-connector') {
                unset.push(nodeField, socketField);
            } else {
                unset.push(`${endpoint.role}Attachment`);
            }
            continue;
        }
        const patch = connectorEndpointPatch(moved, endpoint.role, best.target, matrix, projection);
        if (!patch) {
            continue;
        }
        if ('points' in patch && set.points) {
            const points = set.points as number[];
            const index = endpoint.role === 'start' ? 0 : points.length - 2;
            points[index] = (patch.points as number[])[index]!;
            points[index + 1] = (patch.points as number[])[index + 1]!;
        } else {
            Object.assign(set, patch);
        }
        if (connector.componentId === 'spline-connector') {
            Object.assign(set, { [nodeField]: best.target.entityId, [socketField]: best.target.socket.name });
        } else {
            set[`${endpoint.role}Attachment`] = { nodeId: best.target.entityId, socketName: best.target.socket.name };
        }
        claimed.add(`${best.target.entityId}:${best.target.socket.name}`);
        nextAttachments.get(best.target.entityId)!.push({ localSocketName: best.target.socket.name, targetEntityId: moved.entityId, targetSocketName: endpoint.socket.name });
    }
    const changed = Object.fromEntries(Object.entries(set).filter(([key, value]) => JSON.stringify(connector.data[key]) !== JSON.stringify(value)));
    const removed = unset.filter(field => field in connector.data);
    if (Object.keys(changed).length || removed.length) {
        operations.push({ op: 'patch', entityId: moved.entityId, componentId: connector.componentId, ...(Object.keys(changed).length ? { set: changed } : {}), ...(removed.length ? { unset: removed } : {}) });
    }
    const finalizedData = Object.fromEntries(Object.entries({ ...connector.data, ...set }).filter(([field]) => !removed.includes(field)));
    const finalizedMoved = { ...moved, components: moved.components.map(candidate => candidate === connector
        ? { ...connector, data: finalizedData }
        : candidate.ownerId === FOXHOLE_OWNER_ID && candidate.componentId === SOCKET_ATTACHMENTS_COMPONENT_ID
            ? { ...candidate, data: { ...candidate.data, attachments: nextAttachments.get(moved.entityId)!.map(link => ({ ...link })) } } : candidate) };
    const finalizedEntities = entities.map(entity => entity.entityId === moved.entityId ? finalizedMoved : entity);
    for (const [entityId, carried] of carriedConnectorPatches(finalizedMoved, finalizedEntities, matrices, sockets(finalizedMoved, matrix))) {
        const entity = entities.find(candidate => candidate.entityId === entityId)!;
        const geometry = connectorComponent(entity)!;
        const delta = Object.fromEntries(Object.entries(carried).filter(([field, value]) => JSON.stringify(geometry.data[field]) !== JSON.stringify(value)));
        if (Object.keys(delta).length) {
            operations.push({ op: 'patch', entityId, componentId: geometry.componentId, set: delta });
        }
    }
    for (const entity of entities) {
        const next = nextAttachments.get(entity.entityId)!;
        if (sameAttachments(readAttachments(entity), next)) {
            continue;
        }
        const attachments = next.map(item => ({ ...item }));
        operations.push(component(entity, FOXHOLE_OWNER_ID, SOCKET_ATTACHMENTS_COMPONENT_ID)
            ? { op: 'patch', entityId: entity.entityId, componentId: SOCKET_ATTACHMENTS_COMPONENT_ID, set: { attachments } }
            : { op: 'add', entityId: entity.entityId, componentId: SOCKET_ATTACHMENTS_COMPONENT_ID, data: { attachments } });
    }
    return { contractVersion: 1, transform: { x: request.transform.x, y: request.transform.y }, ...(operations.length ? { transaction: { contractVersion: 1, transactionId: `connector-snap-${globalThis.crypto.randomUUID()}`, operations } } : {}) };
}

export function finalizeFoxholeSceneV2Transform(
    request: NixieExperimentalTransformFinalizeRequestV1,
): NixieExperimentalTransformFinalizeResultV1 {
    const entities = request.context.entities;
    const projection = createFoxholeSpatialProjection(entities.map(entity => entity.entityId !== request.entityId ? entity : ({ ...entity,
        components: entity.components.map(entry => entry.ownerId === CORE_OWNER_ID && entry.componentId === 'transform'
            ? { ...entry, data: { ...entry.data, ...request.transform } } : entry) })));
    const moved = entities.find(entity => entity.entityId === request.entityId);
    if (moved && connectorComponent(moved)) {
        return finalizeConnector(request, moved);
    }
    if (!moved || !resolveFoxholeEntityStructureSockets(moved, assetMetadata(moved)).length) {
        return { contractVersion: 1, transform: { x: request.transform.x, y: request.transform.y } };
    }
    const movingIds = new Set(request.movingEntityIds ?? [moved.entityId]);
    const movers = entities.filter(entity => movingIds.has(entity.entityId));
    const matrices = worldMatrices(entities, moved.entityId, request.transform);
    const movingSockets = movers.flatMap(entity => sockets(entity, matrices.get(entity.entityId) ?? localMatrix(entity), projection));
    const attachmentsByEntity = new Map(entities.map(entity => [entity.entityId, readAttachments(entity)]));
    let best: { moving: WorldSocket; target: WorldSocket; distance: number; overlap: number; } | null = null;
    const candidates: Array<{ moving: WorldSocket; target: WorldSocket; distance: number; overlap: number; }> = [];
    for (const entity of entities) {
        if (movingIds.has(entity.entityId)) {
            continue;
        }
        const targetAttachments = attachmentsByEntity.get(entity.entityId) ?? [];
        for (const target of sockets(entity, matrices.get(entity.entityId) ?? localMatrix(entity), projection)) {
            const occupied = attachmentAt(targetAttachments, target.socket.name) ?? endpointAttachmentAt(entity, target.socket.name);
            for (const moving of movingSockets) {
                if (occupied && occupied.targetEntityId !== moving.entityId) {
                    continue;
                }
                const overlap = compatible(moving, target);
                if (overlap <= 0) {
                    continue;
                }
                const facingCosine = -moving.direction.reduce((sum, value, axis) => sum + value * target.direction[axis]!, 0)
                    / (Math.hypot(...moving.direction) * Math.hypot(...target.direction));
                if (!Number.isFinite(facingCosine) || facingCosine < Math.cos(MAX_FACING_ERROR)) continue;
                const distance = Math.hypot(...target.world.map((value, axis) => value - moving.world[axis]!));
                if (!Number.isFinite(distance) || distance > SNAP_DISTANCE) {
                    continue;
                }
                candidates.push({ moving, target, distance, overlap });
                if (!best || distance - overlap * 0.01 < best.distance - best.overlap * 0.01) {
                    best = { moving, target, distance, overlap };
                }
            }
        }
    }

    const nextByEntity = new Map<string, Attachment[]>();
    const setAttachments = (entityId: string, value: Attachment[]) => nextByEntity.set(entityId, value);
    for (const member of movers) {
        const previousAttachments = attachmentsByEntity.get(member.entityId) ?? [];
        // Internal links move rigidly with the selection. External connectors keep
        // following their sockets; only stationary structure links are re-evaluated.
        const retained = previousAttachments.filter(attachment => movingIds.has(attachment.targetEntityId)
            || entities.some(entity => entity.entityId === attachment.targetEntityId && connectorComponent(entity)));
        setAttachments(member.entityId, [...retained]);
        for (const previous of previousAttachments) {
            if (retained.includes(previous)) continue;
            const priorTarget = nextByEntity.get(previous.targetEntityId) ?? attachmentsByEntity.get(previous.targetEntityId) ?? [];
            setAttachments(previous.targetEntityId, priorTarget.filter(item => !(
                normalizedName(item.localSocketName) === normalizedName(previous.targetSocketName)
                && item.targetEntityId === member.entityId
                && normalizedName(item.targetSocketName) === normalizedName(previous.localSocketName)
            )));
        }
    }

    let x = request.transform.x;
    let y = request.transform.y;
    let elevation: number | undefined;
    let translation = [0, 0, 0];
    if (best) {
        const parent = parentId(moved);
        const parentEntity = entities.find(entity => entity.entityId === parent);
        const origin = projection.toWorld(moved, [0, 0, 0]);
        const desired = origin.map((value, axis) => value + best!.target.world[axis]! - best!.moving.world[axis]!) as [number, number, number];
        const local = parentEntity ? projection.toLocal(parentEntity, desired) : desired;
        if (local.every(Number.isFinite)) {
            x = local[0];
            y = local[1];
            const oldElevation = finite(component(moved, CORE_OWNER_ID, 'spatial-transform')?.data.elevation, 0);
            if (Math.abs(local[2] - oldElevation) > 1e-6) elevation = local[2];
            // One pair determines the pose; every compatible pair aligned at that
            // pose owns a reciprocal link, including both sockets on a foundation edge.
            translation = best.target.world.map((value, axis) => value - best!.moving.world[axis]!);
            const aligned = candidates.map(candidate => ({ ...candidate, distance: Math.hypot(...candidate.target.world
                .map((value, axis) => value - candidate.moving.world[axis]! - translation[axis]!)) }))
                .filter(candidate => candidate.distance <= 1)
                .sort((left, right) => left.distance - right.distance || right.overlap - left.overlap);
            const claimedMoving = new Set(movers.flatMap(member => (nextByEntity.get(member.entityId) ?? []).map(attachment => member.entityId + ':' + normalizedName(attachment.localSocketName))));
            const claimedTargets = new Set<string>();
            for (const match of aligned) {
                const movingName = match.moving.entityId + ':' + normalizedName(match.moving.socket.name);
                const targetKey = `${match.target.entityId}:${normalizedName(match.target.socket.name)}`;
                if (claimedMoving.has(movingName) || claimedTargets.has(targetKey)) continue;
                claimedMoving.add(movingName);
                claimedTargets.add(targetKey);
                nextByEntity.get(match.moving.entityId)!.push({
                    localSocketName: match.moving.socket.name,
                    targetEntityId: match.target.entityId,
                    targetSocketName: match.target.socket.name,
                });
                const targetCurrent = nextByEntity.get(match.target.entityId) ?? attachmentsByEntity.get(match.target.entityId) ?? [];
                setAttachments(match.target.entityId, [...targetCurrent.filter(item => normalizedName(item.localSocketName)
                    !== normalizedName(match.target.socket.name)), {
                    localSocketName: match.target.socket.name,
                    targetEntityId: match.moving.entityId,
                    targetSocketName: match.moving.socket.name,
                }]);
            }
        }
    }

    const operations: NixieExperimentalComponentOperationV1[] = [];
    const finalizedEntities = entities.map(entity => {
        if (!movingIds.has(entity.entityId)) return entity;
        const parent = entities.find(candidate => candidate.entityId === parentId(entity));
        const origin = projection.toWorld(entity, [0, 0, 0]);
        const desired = origin.map((value, axis) => value + translation[axis]!) as [number, number, number];
        const local = parent ? projection.toLocal(parent, desired) : desired;
        const spatial = component(entity, CORE_OWNER_ID, 'spatial-transform');
        return { ...entity, components: [...entity.components.map(entry => entry.ownerId === CORE_OWNER_ID && entry.componentId === 'transform'
            ? { ...entry, data: { ...entry.data, x: local[0], y: local[1] } } : entry.ownerId === CORE_OWNER_ID && entry.componentId === 'spatial-transform'
                ? { ...entry, data: { ...entry.data, elevation: local[2] } } : entry),
            ...(spatial ? [] : [{ ownerId: CORE_OWNER_ID, componentId: 'spatial-transform', version: 1, definitionAvailable: true, data: { elevation: local[2] } }])] };
    });
    const finalizedMatrices = worldMatrices(finalizedEntities, moved.entityId, { ...request.transform, x, y });
    const connectorPatches = new Map<string, NixieExperimentalComponentJsonObjectV1>();
    for (const member of finalizedEntities.filter(entity => movingIds.has(entity.entityId))) {
        for (const [id, patch] of carriedConnectorPatches(member, finalizedEntities, finalizedMatrices, sockets(member, finalizedMatrices.get(member.entityId)!))) {
            // Selected connectors already share the rigid movement.
            if (!movingIds.has(id)) connectorPatches.set(id, { ...connectorPatches.get(id), ...patch });
        }
    }
    for (const [entityId, set] of connectorPatches) {
        const entity = entities.find(candidate => candidate.entityId === entityId)!;
        operations.push({ op: 'patch', entityId, componentId: connectorComponent(entity)!.componentId, set });
    }
    for (const [entityId, next] of nextByEntity) {
        const entity = entities.find(candidate => candidate.entityId === entityId);
        if (!entity) {
            continue;
        }
        const current = attachmentsByEntity.get(entityId) ?? [];
        if (sameAttachments(current, next)) {
            continue;
        }
        const attachments = next.map(item => ({
            localSocketName: item.localSocketName,
            targetEntityId: item.targetEntityId,
            targetSocketName: item.targetSocketName,
        }));
        operations.push(component(entity, FOXHOLE_OWNER_ID, SOCKET_ATTACHMENTS_COMPONENT_ID)
            ? { op: 'patch', entityId, componentId: SOCKET_ATTACHMENTS_COMPONENT_ID, set: { attachments } }
            : { op: 'add', entityId, componentId: SOCKET_ATTACHMENTS_COMPONENT_ID, data: { attachments } });
    }
    return {
        contractVersion: 1,
        transform: { x, y, ...(elevation === undefined ? {} : { elevation }) },
        ...(operations.length
            ? {
                transaction: {
                    contractVersion: 1,
                    transactionId: `socket-snap-${globalThis.crypto.randomUUID()}`,
                    operations,
                },
            }
            : {}),
    };
}
