import { FOXHOLE_POWERLINE_PREVIEW_LENGTH } from './scene-v2-connector-products.ts';
import type {
    NixieComponentEntitySnapshotV1,
    NixieComponentOperationV1,
    NixieComponentJsonObjectV1,
    NixieTransformFinalizeRequestV1,
    NixieTransformFinalizeResultV1,
} from '@nixiejs/extension-sdk/scene-v2';
import { clampDraggedSplineEndpoint, selectNixieConnectionTargetV1 } from '@nixiejs/extension-sdk/scene-v2';
import foxholeSceneV2Assets from '#foxhole-scene-v2-assets';
import { resolveFoxholeEntityAttachmentSockets } from './scene-v2-attachment-sockets.ts';
import { normalizeFoxholeBuildSocketName } from './bunker-statistics-sockets.ts';
import { resolveFoxholeEntityStructureSockets } from './effective-structure-sockets.ts';
import { sampleFoxholeSceneV2Connector, foxholeSceneV2ConnectorConstraints, foxholeSceneV2ConnectorEndpoints } from './scene-v2-connector-path.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { resolveFacilityPipeSideSocketsFromPath } from './connector-side-sockets.ts';
import { nearestRailPathSocket, railPathSocket, railPathSocketHasBranch, railPathSocketPolicy, readRailPathSocket } from './rail-path-sockets.ts';
import { fixedRailNetwork, nearbyFixedRailRegions, readFixedRailEndpoint } from './fixed-region-rails.ts';
import { requiresStraightConnectorSocketAlignment } from './connector-behavior.ts';
import { isTrenchConnector } from './trench-connector.ts';
import { trenchEndRotationTarget } from './trench-end-rotation.ts';
import { isFoxholePowerSocketConnectionAvailable } from './power-socket-capacity.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';
import { resolveFoxholeSpatialSplineAttachments } from './scene-v2-spatial-attachments.ts';
import { readFoxholeSceneV2CoreTransform, withFoxholeSceneV2TransformProposal } from './scene-v2-core-transforms.ts';
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
const SNAP_RELEASE_DISTANCE = 30;
const STRAIGHT_SOCKET_ALIGNMENT = Math.cos(Math.PI / 180);
const MAX_MOVE_SNAP_ROTATION = Math.PI / 4;
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
    entity: NixieComponentEntitySnapshotV1,
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
    entity: NixieComponentEntitySnapshotV1,
    override?: NixieTransformFinalizeRequestV1['transform'],
): Matrix {
    const data = readFoxholeSceneV2CoreTransform(entity);
    const rotation = override?.rotation ?? finite(data?.rotation.z, 0);
    const scaleX = override?.scaleX ?? finite(data?.scale.x, 1);
    const scaleY = override?.scaleY ?? finite(data?.scale.y, 1);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    return {
        a: cosine * scaleX,
        b: sine * scaleX,
        c: -sine * scaleY,
        d: cosine * scaleY,
        tx: override?.x ?? finite(data?.position.x, 0),
        ty: override?.y ?? finite(data?.position.y, 0),
    };
}

function parentId(entity: NixieComponentEntitySnapshotV1): string {
    const value = component(entity, CORE_OWNER_ID, 'hierarchy')?.data.parentId;
    return typeof value === 'string' ? value : '';
}

function worldMatrices(
    entities: readonly NixieComponentEntitySnapshotV1[],
    movedEntityId: string,
    transform: NixieTransformFinalizeRequestV1['transform'],
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

function assetMetadata(entity: NixieComponentEntitySnapshotV1): FoxholeSceneV2AssetMetadata | null {
    const assetId = component(entity, FOXHOLE_OWNER_ID, 'asset')?.data.assetId
        ?? connectorComponent(entity)?.data.foxholeKey;
    return typeof assetId === 'string' ? assets[assetId] ?? null : null;
}

function connectorComponent(entity: NixieComponentEntitySnapshotV1) {
    return component(entity, FOXHOLE_OWNER_ID, 'spline-connector') ?? component(entity, FOXHOLE_OWNER_ID, 'connector');
}

function connectorEndpoints(entity: NixieComponentEntitySnapshotV1): Array<{ role: 'start' | 'end'; socket: FoxholeSceneV2BuildSocketMetadata; }> {
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
        const straight = spline && requiresStraightConnectorSocketAlignment(key);
        const rotation = straight
            ? Math.atan2(finite(data.endY, 0) - finite(data.startY, 0), finite(data.endX, 0) - finite(data.startX, 0))
                + (start ? Math.PI : 0)
            : spline
            ? finite(data[`${role}Rotation`], 0) + (start || (key.includes('pipe') && !key.includes('underground')) ? Math.PI : 0)
            : start
                ? Math.atan2(points[1]! - points[3]!, points[0]! - points[2]!)
                : Math.atan2(y - points[index - 1]!, x - points[index - 2]!);
        return [{ role, socket: { ...template, name, x, y, rotation } }];
    });
}

function sockets(entity: NixieComponentEntitySnapshotV1, matrix: Matrix,
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
    if (connector?.componentId === 'spline-connector' && railPathSocketPolicy(String(connector.data.foxholeKey))) {
        const data = connector.data as unknown as FoxholeSceneV2SplineConnectorData;
        const names = readAttachments(entity).map(link => link.localSocketName).filter(readRailPathSocket);
        if (names.length) {
            const path = sampleFoxholeSceneV2Connector(data, asset ?? undefined);
            for (const name of names) {
                const socket = railPathSocket(data.foxholeKey, path, name);
                if (socket) localSockets.push(socket);
            }
        }
    }
    return localSockets.map(socket => worldSocket(entity, socket, matrix, projection));
}

function worldSocket(entity: NixieComponentEntitySnapshotV1, socket: FoxholeSceneV2BuildSocketMetadata, matrix: Matrix,
    projection?: ReturnType<typeof createFoxholeSpatialProjection>): WorldSocket {
    const position = point(matrix, socket.x, socket.y);
    const direction = point(matrix, socket.x + Math.cos(socket.rotation), socket.y + Math.sin(socket.rotation));
    const world = projection?.toWorld(entity, [socket.x, socket.y, socket.z ?? 0]) ?? [position.x, position.y, 0];
    const facing = projection?.toWorld(entity, [socket.x + Math.cos(socket.rotation), socket.y + Math.sin(socket.rotation), socket.z ?? 0])
        ?? [direction.x, direction.y, 0];
    return { entityId: entity.entityId, socket, ...position, z: world[2], world,
        direction: [facing[0] - world[0], facing[1] - world[1], facing[2] - world[2]],
        rotation: Math.atan2(direction.y - position.y, direction.x - position.x) };
}

type SpatialPoint = WorldSocket['world'];
type SnapTransform = NixieTransformFinalizeResultV1['transform'];

function facingCorrection(moving: WorldSocket, target: WorldSocket): number {
    const angle = Math.atan2(target.direction[1], target.direction[0])
        - Math.atan2(moving.direction[1], moving.direction[0]) - Math.PI;
    return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function fixedWorldSocket(endpoint: NonNullable<ReturnType<typeof readFixedRailEndpoint>>): WorldSocket {
    const { id, socket, point, rotation } = endpoint;
    return { entityId: id, socket, world: point, x: point[0], y: point[1], z: point[2], rotation,
        direction: [Math.cos(rotation), Math.sin(rotation), 0] };
}

function socketSnapPose(request: NixieTransformFinalizeRequestV1, moved: NixieComponentEntitySnapshotV1,
    moving: WorldSocket, target: WorldSocket, directional = true, snapElevation = directional) {
    const entities = request.context.entities;
    const staged = withFoxholeSceneV2TransformProposal(moved, request.transform);
    const projection = createFoxholeSpatialProjection(entities.map(entity => entity.entityId === moved.entityId ? staged : entity));
    const parent = entities.find(entity => entity.entityId === parentId(moved));
    const toParent = (point: SpatialPoint) => parent ? projection.toLocal(parent, point) : point;
    const origin = projection.toWorld(staged, [0, 0, 0]);
    const correction = directional ? facingCorrection(moving, target) : 0;
    const worldAngle = Math.abs(correction) > 1e-8 ? correction : 0;
    const cos = Math.cos(worldAngle), sin = Math.sin(worldAngle);
    const rotate = ([x, y, z]: SpatialPoint): SpatialPoint => [x * cos - y * sin, x * sin + y * cos, z];
    const offset = rotate(moving.world.map((value, axis) => value - origin[axis]!) as SpatialPoint);
    const desired: SpatialPoint = [target.world[0] - offset[0], target.world[1] - offset[1],
        snapElevation ? target.world[2] - offset[2] : origin[2]];
    const local = toParent(desired);
    if (!local.every(Number.isFinite)) return null;
    const localHeading = (entity: NixieComponentEntitySnapshotV1, localOrigin: SpatialPoint, worldOrigin: SpatialPoint, heading: number) => {
        const parent = entities.find(candidate => candidate.entityId === parentId(entity));
        // Project the entity's parent-local heading through its hierarchy before rotating it.
        const oldTip: SpatialPoint = [localOrigin[0] + Math.cos(heading), localOrigin[1] + Math.sin(heading), localOrigin[2]];
        const worldTip = parent ? projection.toWorld(parent, oldTip) : oldTip;
        const tipOffset = rotate(worldTip.map((value, axis) => value - worldOrigin[axis]!) as SpatialPoint);
        if (!parent) return Math.atan2(tipOffset[1], tipOffset[0]);
        const localTip = projection.toLocal(parent, worldOrigin.map((value, axis) => value + tipOffset[axis]!) as SpatialPoint);
        return Math.atan2(localTip[1] - localOrigin[1], localTip[0] - localOrigin[0]);
    };
    const elevation = readFoxholeSceneV2CoreTransform(staged)?.position.z ?? 0;
    const transform: SnapTransform = { x: local[0] || 0, y: local[1] || 0,
        ...(worldAngle ? { rotation: localHeading(staged, [request.transform.x, request.transform.y, elevation], origin, request.transform.rotation) } : {}),
        ...(Math.abs(local[2] - elevation) > 1e-6 ? { elevation: local[2] } : {}) };
    const apply = (point: SpatialPoint): SpatialPoint => {
        const offset = rotate(point.map((value, axis) => value - origin[axis]!) as SpatialPoint);
        return [desired[0] + offset[0], desired[1] + offset[1], desired[2] + offset[2]];
    };
    return { transform, apply, rotate, localHeading };
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

function readAttachments(entity: NixieComponentEntitySnapshotV1): Attachment[] {
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

function connectorAttachment(connector: NonNullable<ReturnType<typeof connectorComponent>>, role: 'start' | 'end') {
    const reference = connector.componentId === 'spline-connector'
        ? { nodeId: connector.data[`${role}AttachmentNodeId`], socketName: connector.data[`${role}AttachmentSocketName`] }
        : connector.data[`${role}Attachment`];
    return reference && typeof reference === 'object' && !Array.isArray(reference)
        && typeof reference.nodeId === 'string' && typeof reference.socketName === 'string'
        ? { targetEntityId: reference.nodeId, targetSocketName: reference.socketName }
        : undefined;
}

function endpointAttachmentAt(entity: NixieComponentEntitySnapshotV1, socketName: string): Attachment | undefined {
    const connector = connectorComponent(entity);
    if (!connector) return undefined;
    const start = connectorAttachment(connector, 'start');
    const end = connectorAttachment(connector, 'end');
    if (!start && !end) return undefined;
    const name = normalizedName(socketName);
    const endpoint = connectorEndpoints(entity).find(candidate => normalizedName(candidate.socket.name) === name);
    const link = endpoint?.role === 'start' ? start : end;
    return endpoint && link ? { localSocketName: endpoint.socket.name, ...link } : undefined;
}

function sameAttachments(left: readonly Attachment[], right: readonly Attachment[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function inversePoint(matrix: Matrix, world: { x: number; y: number; }) {
    return inverseVector(matrix, world.x - matrix.tx, world.y - matrix.ty);
}

function connectorEndpointPatch(entity: NixieComponentEntitySnapshotV1, role: 'start' | 'end', world: WorldSocket, matrix: Matrix, projection?: ReturnType<typeof createFoxholeSpatialProjection>): NixieComponentJsonObjectV1 | null {
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

function carriedConnectorPatches(moved: NixieComponentEntitySnapshotV1,
    entities: readonly NixieComponentEntitySnapshotV1[], matrices: ReadonlyMap<string, Matrix>,
    movedSockets: readonly WorldSocket[]): Map<string, NixieComponentJsonObjectV1> {
    const patches = new Map<string, NixieComponentJsonObjectV1>();
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

function finalizeConnector(request: NixieTransformFinalizeRequestV1, moved: NixieComponentEntitySnapshotV1): NixieTransformFinalizeResultV1 {
    const entities = request.context.entities;
    const connector = connectorComponent(moved)!;
    const gesture = request.geometryGesture;
    // A rigid group moves together: its existing internal links are occupied,
    // not candidates to detach or rediscover during this transform.
    const movingIds = new Set(gesture ? [moved.entityId] : request.movingEntityIds ?? [moved.entityId]);
    const rigidGroup = !gesture && movingIds.size > 1;
    let pose: ReturnType<typeof socketSnapPose> = null;
    let finalizedTransform: SnapTransform = { x: request.transform.x, y: request.transform.y };
    const role = gesture?.handleId === 'start' || gesture?.handleId === 'polyline-vertex-0' ? 'start'
        : gesture?.handleId === 'end' || gesture?.handleId === 'polyline-vertex-' + (Array.isArray(connector.data.points) ? connector.data.points.length / 2 - 1 : -1) ? 'end' : null;
    const projection = createFoxholeSpatialProjection(entities.map(entity => entity.entityId !== moved.entityId
        ? entity : withFoxholeSceneV2TransformProposal(entity, request.transform)));
    if (gesture && !role) {
        const tangentRole = gesture.handleId === 'start-rotation' ? 'start' : gesture.handleId === 'end-rotation' ? 'end' : null;
        if (!tangentRole || connector.componentId !== 'spline-connector') return { contractVersion: 1, transform: { x: request.transform.x, y: request.transform.y } };
        if (readRailPathSocket(String(connector.data[tangentRole + 'AttachmentSocketName'] ?? ''))
            || readFixedRailEndpoint(connector.data[tangentRole + 'FixedRailEnd'])) {
            return { contractVersion: 1, transform: { x: request.transform.x, y: request.transform.y } };
        }
        const attachment = trenchEndRotationTarget(moved, tangentRole, entities);
        if (attachment && !attachment.connector) {
            throw new Error('This end is locked to the attached structure.');
        }
        const point = projection.toLocal(moved, [gesture.worldPoint.x, gesture.worldPoint.y, gesture.worldPoint.z ?? 0]);
        const key = String(connector.data.foxholeKey ?? '').toLowerCase();
        const reversedEnd = tangentRole === 'end' && !(key.includes('pipe') && !key.includes('underground'));
        const peer = attachment?.target;
        const socket = peer && resolveFoxholeEntityAttachmentSockets(peer, assetMetadata(peer))
            .find(candidate => normalizeFoxholeBuildSocketName(candidate.name).toLowerCase() === attachment.targetSocket);
        const origin = socket && peer ? projection.toLocal(moved, projection.toWorld(peer, [socket.x, socket.y, socket.z ?? 0]))
            : [Number(connector.data[tangentRole + 'X']), Number(connector.data[tangentRole + 'Y'])];
        const angle = Math.atan2(point[1] - origin[1]!, point[0] - origin[0]!) + (reversedEnd ? Math.PI : 0);
        const operations: NixieComponentOperationV1[] = [{ op: 'patch', entityId: moved.entityId,
            componentId: connector.componentId, set: { [tangentRole + 'Rotation']: Math.atan2(Math.sin(angle), Math.cos(angle)) } }];
        const peerEnd = attachment?.peerEnd;
        if (peer && peerEnd && attachment.connector?.componentId === 'spline-connector'
            && isTrenchConnector(String(attachment.connector.data.foxholeKey))) {
            const peerAngle = angle + (peerEnd === tangentRole ? Math.PI : 0);
            const origin = projection.toLocal(peer, projection.toWorld(moved, [0, 0, 0]));
            const direction = projection.toLocal(peer, projection.toWorld(moved, [Math.cos(peerAngle), Math.sin(peerAngle), 0]));
            operations.push({ op: 'patch', entityId: peer.entityId, componentId: 'spline-connector',
                set: { [peerEnd + 'Rotation']: Math.atan2(direction[1] - origin[1], direction[0] - origin[0]) } });
        }
        return { contractVersion: 1, transform: { x: request.transform.x, y: request.transform.y }, transaction: { contractVersion: 1,
            transactionId: 'connector-tangent-' + globalThis.crypto.randomUUID(), operations } };
    }
    const matrices = worldMatrices(entities, moved.entityId, request.transform);
    const matrix = matrices.get(moved.entityId) ?? localMatrix(moved, request.transform);
    const endpoints = connectorEndpoints(moved);
    const dragged = endpoints.find(endpoint => endpoint.role === role);
    const byId = new Map(entities.map(entity => [entity.entityId, entity]));
    const nextAttachments = new Map(entities.map(entity => [entity.entityId, readAttachments(entity).filter(item =>
        !(item.targetEntityId === moved.entityId && !movingIds.has(entity.entityId)
            && (!gesture || normalizedName(item.targetSocketName) === normalizedName(dragged!.socket.name)))
        && !(gesture && entity.entityId === moved.entityId && normalizedName(item.localSocketName) === normalizedName(dragged!.socket.name)))]));
    const operations: NixieComponentOperationV1[] = [];
    const set: Record<string, import('@nixiejs/extension-sdk/scene-v2').NixieComponentJsonValueV1> = {};
    const unset: string[] = [];
    const claimed = new Set<string>();
    const movingSockets = sockets(moved, matrix, projection);
    const straight = connector.componentId === 'spline-connector'
        && requiresStraightConnectorSocketAlignment(String(connector.data.foxholeKey ?? ''));
    const spline = connector.data as unknown as FoxholeSceneV2SplineConnectorData;
    const rail = connector.componentId === 'spline-connector' ? railPathSocketPolicy(spline.foxholeKey) : undefined;
    const worldRail = rail && !spline.foxholeKey.toLowerCase().startsWith('small');
    const railPaths = new Map<string, { path: ReturnType<typeof sampleFoxholeSceneV2Connector>; startZ: number; endZ: number }>();
    const worldSockets = new Map<string, WorldSocket[]>();
    const socketsFor = (entity: NixieComponentEntitySnapshotV1) => {
        let result = worldSockets.get(entity.entityId);
        if (!result) {
            result = sockets(entity, matrices.get(entity.entityId) ?? localMatrix(entity), projection);
            worldSockets.set(entity.entityId, result);
        }
        return result;
    };
    const aligned = (axis: readonly number[], dx: number, dy: number) => {
        const divisor = Math.hypot(axis[0]!, axis[1]!) * Math.hypot(dx, dy);
        return divisor > 1e-8 && (axis[0]! * dx + axis[1]! * dy) / divisor >= STRAIGHT_SOCKET_ALIGNMENT;
    };
    const power = connector.data.foxholeKey === 'powerline';
    const connections: FoxholePowerSocketConnection[] = !power ? [] : entities.flatMap(entity => {
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
    const candidatesByEndpoint = new Map<typeof endpoints[number], Array<{ target: WorldSocket; score: number }>>();
    const eligibleTargets = (endpoint: typeof endpoints[number]) => {
        const moving = movingSockets.find(socket => socket.socket.name === endpoint.socket.name)!;
        const opposite = endpoints.find(other => other.role !== endpoint.role);
        const oppositeLink = opposite && (endpointAttachmentAt(moved, opposite.socket.name)
            ?? (straight ? attachmentAt(readAttachments(moved), opposite.socket.name) : undefined));
        const lockedEntity = straight && oppositeLink && entities.find(entity => entity.entityId === oppositeLink.targetEntityId);
        const fixedOpposite = opposite && readFixedRailEndpoint(connector.data[`${opposite.role}FixedRailEnd`]);
        const lockedSocket = (lockedEntity && socketsFor(lockedEntity)
            .find(socket => normalizedName(socket.socket.name) === normalizedName(oppositeLink.targetSocketName)))
            || (fixedOpposite && fixedWorldSocket(fixedOpposite));
        const anchor = lockedSocket || (opposite && movingSockets.find(socket => socket.socket.name === opposite.socket.name));
        const cursor = gesture && [gesture.worldPoint.x, gesture.worldPoint.y, gesture.worldPoint.z ?? moving.world[2]];
        const placingFirstEnd = request.interaction === 'placement' && role === 'start';
        const eligible: Array<{ entityId: string; id: string; position: [number, number, number]; target: WorldSocket; }> = [];
        for (const entity of entities) {
            if (gesture && !gesture.snappingEnabled) break;
            if (movingIds.has(entity.entityId)) continue;
            // Occupied path sockets follow the host spline, but remain unavailable as snap targets.
            const targets = socketsFor(entity).filter(target => !readRailPathSocket(target.socket.name));
            const peer = rail && connectorComponent(entity);
            if (peer && peer.componentId === 'spline-connector') {
                const data = peer.data as unknown as FoxholeSceneV2SplineConnectorData;
                if (railPathSocketPolicy(data.foxholeKey)?.category === rail?.category
                    && data.startAttachmentNodeId !== moved.entityId && data.endAttachmentNodeId !== moved.entityId) {
                    let resolved = railPaths.get(entity.entityId);
                    if (!resolved) {
                        const geometry = data.startAttachmentNodeId || data.endAttachmentNodeId || data.startFixedRailEnd || data.endFixedRailEnd
                            ? resolveFoxholeSpatialSplineAttachments(entity, data, request.context, foxholeSceneV2Assets, projection)
                            : { ...data, startZ: 0, endZ: 0 };
                        resolved = { path: sampleFoxholeSceneV2Connector(geometry, assetMetadata(entity) ?? undefined),
                            startZ: geometry.startZ, endZ: geometry.endZ };
                        railPaths.set(entity.entityId, resolved);
                    }
                    const reference: SpatialPoint = cursor ? [cursor[0]!, cursor[1]!, cursor[2]!] : moving.world;
                    const local = projection.toLocal(entity, reference);
                    const towardBranch = placingFirstEnd || !anchor
                        ? projection.toLocal(entity, [reference[0] - moving.direction[0], reference[1] - moving.direction[1], reference[2]])
                        : projection.toLocal(entity, anchor.world);
                    const station = nearestRailPathSocket(data.foxholeKey, resolved.path, { x: local[0], y: local[1] },
                        { x: towardBranch[0] - local[0], y: towardBranch[1] - local[1] },
                        (nextAttachments.get(entity.entityId) ?? []).filter(link => readRailPathSocket(link.localSocketName)
                            && railPathSocketHasBranch(entity.entityId, link.localSocketName, byId.get(link.targetEntityId)))
                            .map(link => link.localSocketName), SNAP_DISTANCE);
                    const socket = station && railPathSocket(data.foxholeKey, resolved.path, station.name, resolved);
                    if (socket) {
                        const target = worldSocket(entity, socket, matrices.get(entity.entityId) ?? localMatrix(entity), projection);
                        // Both rail CDOs permit a 50 cm height difference at the junction.
                        if (Math.abs(target.z - reference[2]) <= 16) targets.push(target);
                    }
                }
            }
            for (const target of targets) {
                if (cursor && !power && Math.hypot(target.world[0] - cursor[0]!, target.world[1] - cursor[1]!,
                    target.world[2] - cursor[2]!) > SNAP_DISTANCE) continue;
                const key = target.entityId + ':' + target.socket.name;
                const endpointLink = endpointAttachmentAt(entity, target.socket.name);
                const fixedEnd = peer && connectorEndpoints(entity).find(value => value.socket.name === target.socket.name)?.role;
                if (fixedEnd && readFixedRailEndpoint(peer.data[`${fixedEnd}FixedRailEnd`])) continue;
                if (endpointLink && (endpointLink.targetEntityId !== moved.entityId
                    || normalizedName(endpointLink.targetSocketName) !== normalizedName(endpoint.socket.name))) continue;
                const available = power && !connectorComponent(entity)
                    ? isFoxholePowerSocketConnectionAvailable({ targetNodeId: target.entityId, targetSocketName: target.socket.name,
                        maxConnections: assetMetadata(entity)?.powerSocketMaxConnections, connections,
                        movingConnectorNodeId: moved.entityId, movingConnectorSocketName: endpoint.socket.name })
                    : readRailPathSocket(target.socket.name) || !attachmentAt(nextAttachments.get(target.entityId) ?? [], target.socket.name);
                if (claimed.has(key) || !available || compatible(moving, target) <= 0) continue;
                if ((power || straight) && oppositeLink?.targetEntityId === target.entityId
                    && normalizedName(oppositeLink.targetSocketName) === normalizedName(target.socket.name)) continue;
                if (pose && !power) {
                    const direction = pose.rotate(moving.direction);
                    if (!aligned(target.direction, -direction[0], -direction[1])) continue;
                }
                if (gesture && straight && anchor && !placingFirstEnd) {
                    const dx = target.x - anchor.x, dy = target.y - anchor.y;
                    const localAnchor = projection.toLocal(moved, anchor.world);
                    const localTarget = projection.toLocal(moved, target.world);
                    const reach = Math.hypot(localTarget[0] - localAnchor[0], localTarget[1] - localAnchor[1]);
                    if (!aligned(target.direction, -dx, -dy)
                        || (lockedSocket && !aligned(lockedSocket.direction, dx, dy))
                        || reach < spline.minLength - 0.01 || reach > spline.maxLength + 0.01) continue;
                }
                eligible.push({ entityId: target.entityId, id: target.socket.name, position: power ? [target.world[0], target.world[1], 0] : target.world, target });
            }
        }
        const fixedEndpoints = worldRail && (!gesture || gesture.snappingEnabled)
            ? nearbyFixedRailRegions(request.context, cursor?.[0] ?? moving.world[0], cursor?.[1] ?? moving.world[1])
                .flatMap(id => fixedRailNetwork(id)?.endpoints ?? []) : [];
        for (const endpoint of fixedEndpoints) {
            if (claimed.has(endpoint.id + ':' + endpoint.socket.name) || endpoint.id === fixedOpposite?.id
                || entities.some(entity => !movingIds.has(entity.entityId) && (['start', 'end'] as const).some(role =>
                    connectorComponent(entity)?.data[`${role}FixedRailEnd`] === endpoint.id))) continue;
            const target = fixedWorldSocket(endpoint);
            if (compatible(moving, target) <= 0) continue;
            if (gesture && straight && anchor && !placingFirstEnd) {
                const dx = target.x - anchor.x, dy = target.y - anchor.y;
                const a = projection.toLocal(moved, anchor.world), b = projection.toLocal(moved, target.world);
                const reach = Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (!aligned(target.direction, -dx, -dy) || (lockedSocket && !aligned(lockedSocket.direction, dx, dy))
                    || reach < spline.minLength - 0.01 || reach > spline.maxLength + 0.01) continue;
            }
            eligible.push({ entityId: endpoint.id, id: endpoint.socket.name, position: endpoint.point, target });
        }
        return { moving, lockedSocket, placingFirstEnd, eligible };
    };
    if (!gesture) {
        for (const endpoint of endpoints) {
            const internal = endpointAttachmentAt(moved, endpoint.socket.name);
            if (internal && movingIds.has(internal.targetEntityId)) continue;
            const { moving, eligible } = eligibleTargets(endpoint);
            const candidates = eligible.flatMap(({ target }) => {
                const distance = Math.hypot(target.world[0] - moving.world[0], target.world[1] - moving.world[1],
                    power ? 0 : target.world[2] - moving.world[2]);
                if (distance > SNAP_DISTANCE) return [];
                const score = distance + (power ? 0 : Math.abs(facingCorrection(moving, target)) * SNAP_DISTANCE / Math.PI);
                return [{ target, score }];
            }).sort((a, b) => a.score - b.score);
            candidatesByEndpoint.set(endpoint, candidates);
        }
        endpoints.sort((a, b) => (candidatesByEndpoint.get(a)?.[0]?.score ?? Infinity)
            - (candidatesByEndpoint.get(b)?.[0]?.score ?? Infinity));
    }
    for (const endpoint of endpoints) {
        const internal = !gesture && endpointAttachmentAt(moved, endpoint.socket.name);
        if (internal && internal.targetEntityId !== moved.entityId && movingIds.has(internal.targetEntityId)) {
            claimed.add(internal.targetEntityId + ':' + internal.targetSocketName);
            continue;
        }
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
        const { moving, lockedSocket, placingFirstEnd, eligible } = eligibleTargets(endpoint);
        const proposedPoint = pose?.apply(moving.world) ?? moving.world;
        const requestedPort = power ? gesture?.connectionTarget : undefined;
        const targets = requestedPort ? eligible.filter(candidate => candidate.entityId === requestedPort.entityId
            && (!requestedPort.portId || candidate.id.toLowerCase() === requestedPort.portId)) : eligible;
        const selected = !gesture && !pose ? candidatesByEndpoint.get(endpoint)?.[0]
            : !gesture || gesture.snappingEnabled ? selectNixieConnectionTargetV1({
                point: gesture ? [gesture.worldPoint.x, gesture.worldPoint.y, power ? 0 : gesture.worldPoint.z ?? moving.world[2]]
                    : [proposedPoint[0], proposedPoint[1], power ? 0 : proposedPoint[2]],
                targets,
                maximumDistance: pose ? 1 : SNAP_DISTANCE,
                ...((power || rail) && gesture ? { hoveredEntityIds: gesture.hoveredEntityIds } : {}),
            }) : null;
        const best = selected ? { target: selected.target } : null;
        if (gesture) for (const peer of entities) {
            const peerGeometry = connectorComponent(peer);
            if (peer.entityId === moved.entityId || !peerGeometry
                || (connectorAttachment(peerGeometry, 'start')?.targetEntityId !== moved.entityId
                    && connectorAttachment(peerGeometry, 'end')?.targetEntityId !== moved.entityId)) continue;
            for (const peerEndpoint of connectorEndpoints(peer)) {
                const link = endpointAttachmentAt(peer, peerEndpoint.socket.name);
                if (link?.targetEntityId !== moved.entityId || normalizedName(link.targetSocketName) !== normalizedName(endpoint.socket.name)) continue;
                operations.push({ op: 'patch', entityId: peer.entityId, componentId: peerGeometry.componentId,
                    unset: peerGeometry.componentId === 'spline-connector' ? [peerEndpoint.role + 'AttachmentNodeId', peerEndpoint.role + 'AttachmentSocketName'] : [peerEndpoint.role + 'Attachment'] });
            }
        }
        const nodeField = `${endpoint.role}AttachmentNodeId`;
        const socketField = `${endpoint.role}AttachmentSocketName`;
        const fixedField = `${endpoint.role}FixedRailEnd`;
        if (!best) {
            if (gesture && connector.componentId === 'spline-connector' && !(request.interaction === 'placement' && role === 'start')) {
                const endpoints = foxholeSceneV2ConnectorEndpoints(spline);
                const pointer = projection.toLocal(moved, [gesture.worldPoint.x, gesture.worldPoint.y, gesture.worldPoint.z ?? moving.world[2]]);
                const constraints = foxholeSceneV2ConnectorConstraints(spline, assetMetadata(moved) ?? undefined);
                let position = { x: pointer[0], y: pointer[1] };
                if (lockedSocket) {
                    const origin = projection.toLocal(moved, lockedSocket.world);
                    const facing = projection.toLocal(moved, lockedSocket.world.map((value, i) =>
                        value + lockedSocket.direction[i]!) as [number, number, number]);
                    const angle = Math.atan2(facing[1] - origin[1], facing[0] - origin[0]);
                    const x = Math.cos(angle), y = Math.sin(angle);
                    const distance = (position.x - origin[0]) * x + (position.y - origin[1]) * y;
                    const length = Math.min(spline.maxLength, Math.max(spline.minLength, distance));
                    position = { x: origin[0] + length * x, y: origin[1] + length * y };
                } else {
                    position = clampDraggedSplineEndpoint(endpoint.role,
                        { ...endpoints.start, ...(endpoint.role === 'start' ? position : {}) },
                        { ...endpoints.end, ...(endpoint.role === 'end' ? position : {}) }, constraints)[endpoint.role];
                }
                Object.assign(set, { [endpoint.role + 'X']: position.x, [endpoint.role + 'Y']: position.y });
            }
            if (connector.componentId === 'spline-connector') {
                unset.push(nodeField, socketField, fixedField);
            } else {
                unset.push(`${endpoint.role}Attachment`);
            }
            continue;
        }
        if (!gesture) {
            pose ??= socketSnapPose(request, moved, moving, best.target, !power);
            if (!pose) continue;
            finalizedTransform = pose.transform;
        } else {
            let endpointProjection = projection;
            if (placingFirstEnd && (power || readRailPathSocket(best.target.socket.name) || readFixedRailEndpoint(best.target.entityId))) {
                // Keep the free preview end at the socket's height as the pointer crosses uneven model surfaces.
                const snap = socketSnapPose(request, moved, moving, best.target, false, true);
                if (snap) {
                    finalizedTransform = snap.transform;
                    const posed = withFoxholeSceneV2TransformProposal(moved, { ...request.transform, ...snap.transform }, snap.transform.elevation);
                    endpointProjection = createFoxholeSpatialProjection(entities.map(entity => entity === moved ? posed : entity));
                }
            }
            const patch = connectorEndpointPatch(moved, endpoint.role, best.target, matrix, endpointProjection);
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
                if (placingFirstEnd && connector.componentId === 'spline-connector') {
                    const angle = Number(patch.startRotation);
                    const previewLength = power ? Math.min(spline.maxLength, FOXHOLE_POWERLINE_PREVIEW_LENGTH) : spline.minLength;
                    set.endX = Number(patch.startX) + previewLength * Math.cos(angle);
                    set.endY = Number(patch.startY) + previewLength * Math.sin(angle);
                    set.endRotation = angle + (String(spline.foxholeKey).includes('pipe') && !String(spline.foxholeKey).includes('underground') ? Math.PI : 0);
                }
            }
        }
        if (readFixedRailEndpoint(best.target.entityId)) {
            set[fixedField] = best.target.entityId;
            unset.push(nodeField, socketField);
            claimed.add(`${best.target.entityId}:${best.target.socket.name}`);
            continue;
        }
        if (connector.componentId === 'spline-connector') {
            unset.push(fixedField);
            Object.assign(set, { [nodeField]: best.target.entityId, [socketField]: best.target.socket.name });
        } else {
            set[`${endpoint.role}Attachment`] = { nodeId: best.target.entityId, socketName: best.target.socket.name };
        }
        claimed.add(`${best.target.entityId}:${best.target.socket.name}`);
        const links = nextAttachments.get(best.target.entityId)!;
        if (readRailPathSocket(best.target.socket.name)) {
            const previous = links.findIndex(link => link.localSocketName === best.target.socket.name);
            if (previous >= 0) links.splice(previous, 1);
        }
        links.push({ localSocketName: best.target.socket.name, targetEntityId: moved.entityId, targetSocketName: endpoint.socket.name });
    }
    if (request.interaction === 'placement' && role === 'end' && isTrenchConnector(String(connector.data.foxholeKey))) {
        const data = { ...connector.data, ...set } as unknown as FoxholeSceneV2SplineConnectorData;
        const heading = Math.atan2(data.endY - data.startY, data.endX - data.startX);
        if (!data.startAttachmentNodeId) set.startRotation = heading;
        if (!data.endAttachmentNodeId || unset.includes('endAttachmentNodeId')) set.endRotation = heading;
    }
    const changed = Object.fromEntries(Object.entries(set).filter(([key, value]) => JSON.stringify(connector.data[key]) !== JSON.stringify(value)));
    const removed = unset.filter(field => field in connector.data);
    if (Object.keys(changed).length || removed.length) {
        operations.push({ op: 'patch', entityId: moved.entityId, componentId: connector.componentId, ...(Object.keys(changed).length ? { set: changed } : {}), ...(removed.length ? { unset: removed } : {}) });
    }
    if (nextAttachments.get(moved.entityId)!.length) {
        const finalizedData = Object.fromEntries(Object.entries({ ...connector.data, ...set }).filter(([field]) => !removed.includes(field)));
        const finalizedMoved = { ...moved, components: moved.components.map(candidate => candidate === connector
            ? { ...connector, data: finalizedData }
            : candidate.ownerId === FOXHOLE_OWNER_ID && candidate.componentId === SOCKET_ATTACHMENTS_COMPONENT_ID
                ? { ...candidate, data: { ...candidate.data, attachments: nextAttachments.get(moved.entityId)!.map(link => ({ ...link })) } } : candidate) };
        const finalProposal = { ...request.transform, ...finalizedTransform };
        const posedMoved = withFoxholeSceneV2TransformProposal(finalizedMoved, finalProposal, finalizedTransform.elevation);
        const finalizedEntities = entities.map(entity => entity.entityId === moved.entityId ? posedMoved : entity);
        const finalProjection = createFoxholeSpatialProjection(finalizedEntities);
        for (const [entityId, carried] of carriedConnectorPatches(posedMoved, finalizedEntities, matrices,
            sockets(posedMoved, matrix, finalProjection))) {
            if (rigidGroup && movingIds.has(entityId)) continue;
            const entity = entities.find(candidate => candidate.entityId === entityId)!;
            const geometry = connectorComponent(entity)!;
            const delta = Object.fromEntries(Object.entries(carried).filter(([field, value]) => JSON.stringify(geometry.data[field]) !== JSON.stringify(value)));
            if (Object.keys(delta).length) {
                operations.push({ op: 'patch', entityId, componentId: geometry.componentId, set: delta });
            }
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
    return { contractVersion: 1, transform: finalizedTransform, ...(operations.length ? { transaction: { contractVersion: 1, transactionId: `connector-snap-${globalThis.crypto.randomUUID()}`, operations } } : {}) };
}

function finalizeFoxholeSceneV2TransformCore(
    request: NixieTransformFinalizeRequestV1 & { previousSnapId?: string; },
): NixieTransformFinalizeResultV1 {
    const entities = request.context.entities;
    const projection = createFoxholeSpatialProjection(entities.map(entity => entity.entityId !== request.entityId
        ? entity : withFoxholeSceneV2TransformProposal(entity, request.transform)));
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
    const entitiesById = new Map(entities.map(entity => [entity.entityId, entity]));
    const internallyOccupied = new Set(movingSockets.flatMap(socket => {
        const attachments = attachmentsByEntity.get(socket.entityId) ?? [];
        const entity = entitiesById.get(socket.entityId);
        const endpoint = entity && endpointAttachmentAt(entity, socket.socket.name);
        return attachments.some(link => normalizedName(link.localSocketName) === normalizedName(socket.socket.name)
            && movingIds.has(link.targetEntityId)) || (endpoint && movingIds.has(endpoint.targetEntityId))
            ? [`${socket.entityId}:${normalizedName(socket.socket.name)}`] : [];
    }));
    const showSnap = request.interaction === 'placement' && request.context.settings?.['nixie.scene.snapFeedback'] === true;
    let best: { moving: WorldSocket; target: WorldSocket; score: number; snapId?: string; retained: boolean; } | null = null;
    const candidates: Array<{ moving: WorldSocket; target: WorldSocket; overlap: number; }> = [];
    for (const entity of request.interaction === 'exchange' || request.snappingEnabled === false ? [] : entities) {
        if (movingIds.has(entity.entityId)) {
            continue;
        }
        const targetAttachments = attachmentsByEntity.get(entity.entityId) ?? [];
        for (const target of sockets(entity, matrices.get(entity.entityId) ?? localMatrix(entity), projection)) {
            const occupied = attachmentAt(targetAttachments, target.socket.name) ?? endpointAttachmentAt(entity, target.socket.name);
            for (const moving of movingSockets) {
                if (internallyOccupied.has(`${moving.entityId}:${normalizedName(moving.socket.name)}`)) {
                    continue;
                }
                if (occupied && occupied.targetEntityId !== moving.entityId) {
                    continue;
                }
                const overlap = compatible(moving, target);
                if (overlap <= 0) {
                    continue;
                }
                candidates.push({ moving, target, overlap });
                const distance = Math.hypot(...target.world.map((value, axis) => value - moving.world[axis]!));
                if (!Number.isFinite(distance) || distance > (showSnap && request.previousSnapId ? SNAP_RELEASE_DISTANCE : SNAP_DISTANCE)) continue;
                const angle = Math.abs(facingCorrection(moving, target));
                if (angle > MAX_MOVE_SNAP_ROTATION + 1e-8) continue;
                const snapId = showSnap ? JSON.stringify([moving.socket.name, target.entityId, target.socket.name]) : undefined;
                const retained = snapId !== undefined && snapId === request.previousSnapId;
                if (!retained && distance > SNAP_DISTANCE) continue;
                const score = distance - overlap * 0.01 + angle * SNAP_DISTANCE / Math.PI;
                if (!best || (retained && !best.retained) || (retained === best.retained && score < best.score)) {
                    best = { moving, target, score, snapId, retained };
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
        const retained = previousAttachments.filter(attachment => request.interaction === 'exchange' || movingIds.has(attachment.targetEntityId)
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

    const pose = best && socketSnapPose(request, moved, best.moving, best.target);
    const finalizedTransform = pose?.transform ?? { x: request.transform.x, y: request.transform.y };
    const snapPoints: Array<{ x: number; y: number; z: number; }> = [];
    if (pose) {
            // One pair determines the pose. Record other pairs only if both position and facing still agree.
            const aligned = candidates.map(candidate => {
                const point = pose.apply(candidate.moving.world);
                const direction = pose.rotate(candidate.moving.direction);
                const facing = -direction.reduce((sum, value, axis) => sum + value * candidate.target.direction[axis]!, 0)
                    / (Math.hypot(...direction) * Math.hypot(...candidate.target.direction));
                return { ...candidate, facing, distance: Math.hypot(...candidate.target.world.map((value, axis) => value - point[axis]!)) };
            }).filter(candidate => candidate.distance <= 1 && candidate.facing >= Math.cos(MAX_FACING_ERROR))
                .sort((left, right) => left.distance - right.distance || right.overlap - left.overlap);
        const claimedMoving = new Set(movers.flatMap(member => (nextByEntity.get(member.entityId) ?? []).map(attachment => member.entityId + ':' + normalizedName(attachment.localSocketName))));
        const claimedTargets = new Set<string>();
        for (const match of aligned) {
            const movingName = match.moving.entityId + ':' + normalizedName(match.moving.socket.name);
            const targetKey = `${match.target.entityId}:${normalizedName(match.target.socket.name)}`;
            if (claimedMoving.has(movingName) || claimedTargets.has(targetKey)) continue;
            claimedMoving.add(movingName);
            claimedTargets.add(targetKey);
            if (showSnap && snapPoints.length < 8) {
                const [x, y, z] = match.target.world;
                if (!snapPoints.some(point => Math.hypot(point.x - x, point.y - y, point.z - z) <= 1)) {
                    snapPoints.push({ x, y, z });
                }
            }
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

    const operations: NixieComponentOperationV1[] = [];
    const finalizedEntities = entities.map(entity => {
        if (!movingIds.has(entity.entityId)) return entity;
        const parent = entities.find(candidate => candidate.entityId === parentId(entity));
        const origin = projection.toWorld(entity, [0, 0, 0]);
        const desired = pose?.apply(origin) ?? origin;
        const local = parent ? projection.toLocal(parent, desired) : desired;
        const current = readFoxholeSceneV2CoreTransform(entity)!;
        const rotation = pose?.transform.rotation === undefined ? undefined
            : entity.entityId === moved.entityId ? pose.transform.rotation
            : pose.localHeading(entity, [current.position.x, current.position.y, current.position.z], origin, current.rotation.z);
        return withFoxholeSceneV2TransformProposal(entity, { x: local[0], y: local[1], ...(rotation === undefined ? {} : { rotation }) }, local[2]);
    });
    const finalizedMatrices = worldMatrices(finalizedEntities, moved.entityId, { ...request.transform, ...finalizedTransform });
    const finalizedProjection = createFoxholeSpatialProjection(finalizedEntities);
    const connectorPatches = new Map<string, NixieComponentJsonObjectV1>();
    for (const member of finalizedEntities.filter(entity => movingIds.has(entity.entityId))) {
        for (const [id, patch] of carriedConnectorPatches(member, finalizedEntities, finalizedMatrices, sockets(member, finalizedMatrices.get(member.entityId)!, finalizedProjection))) {
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
        transform: finalizedTransform,
        ...(best?.snapId && snapPoints.length ? { snap: { id: best.snapId, points: snapPoints } } : {}),
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

/** A changed asset/modification can retire sockets while its entity identity remains stable. */
function reconcileStructureAttachments(request: NixieTransformFinalizeRequestV1) {
    const entities = request.context.entities;
    const worldSockets = new Map(entities.map(entity => [entity.entityId, sockets(entity, localMatrix(entity))]));
    const knownMetadata = new Set(entities.filter(entity => assetMetadata(entity) !== null).map(entity => entity.entityId));
    const valid = (sourceId: string, localName: string, targetId: string, targetName: string) => {
        const source = worldSockets.get(sourceId)?.find(socket => normalizedName(socket.socket.name) === normalizedName(localName));
        const target = worldSockets.get(targetId)?.find(socket => normalizedName(socket.socket.name) === normalizedName(targetName));
        if ((!source && knownMetadata.has(sourceId)) || (!target && knownMetadata.has(targetId))) {
            return false;
        }
        // Missing context/catalog data cannot prove a relationship invalid.
        return !source || !target || compatible(source, target) > 0;
    };
    const operations: NixieComponentOperationV1[] = [];
    const cleaned = entities.map(entity => ({ ...entity, components: entity.components.map(candidate => {
        if (candidate.ownerId !== FOXHOLE_OWNER_ID) {
            return candidate;
        }
        if (candidate.componentId === SOCKET_ATTACHMENTS_COMPONENT_ID) {
            const previous = readAttachments(entity);
            const attachments = previous.filter(link => (entity.entityId !== request.entityId && link.targetEntityId !== request.entityId)
                || valid(entity.entityId, link.localSocketName, link.targetEntityId, link.targetSocketName));
            if (attachments.length === previous.length) {
                return candidate;
            }
            operations.push({ op: 'patch', entityId: entity.entityId, componentId: candidate.componentId,
                set: { attachments: attachments.map(link => ({ ...link })) } });
            return { ...candidate, data: { ...candidate.data, attachments: attachments.map(link => ({ ...link })) } };
        }
        if (candidate.componentId !== 'spline-connector' && candidate.componentId !== 'connector') {
            return candidate;
        }
        const unset: string[] = [];
        for (const endpoint of connectorEndpoints(entity)) {
            const link = endpointAttachmentAt(entity, endpoint.socket.name);
            if (link?.targetEntityId !== request.entityId
                || valid(entity.entityId, link.localSocketName, link.targetEntityId, link.targetSocketName)) {
                continue;
            }
            unset.push(...(candidate.componentId === 'spline-connector'
                ? [`${endpoint.role}AttachmentNodeId`, `${endpoint.role}AttachmentSocketName`]
                : [`${endpoint.role}Attachment`]));
        }
        if (!unset.length) {
            return candidate;
        }
        operations.push({ op: 'patch', entityId: entity.entityId, componentId: candidate.componentId, unset });
        return { ...candidate, data: Object.fromEntries(Object.entries(candidate.data).filter(([key]) => !unset.includes(key))) };
    }) }));
    return { entities: cleaned, operations };
}

export function finalizeFoxholeSceneV2Transform(
    request: NixieTransformFinalizeRequestV1 & { previousSnapId?: string; },
): NixieTransformFinalizeResultV1 {
    const moved = request.context.entities.find(entity => entity.entityId === request.entityId);
    if (!moved || connectorComponent(moved) || !assetMetadata(moved)) {
        return finalizeFoxholeSceneV2TransformCore(request);
    }
    const cleanup = reconcileStructureAttachments(request);
    const result = finalizeFoxholeSceneV2TransformCore({ ...request, context: { ...request.context, entities: cleanup.entities } });
    if (!cleanup.operations.length) {
        return result;
    }
    return { ...result, transaction: { contractVersion: 1, transactionId: `socket-reconcile-${globalThis.crypto.randomUUID()}`,
        operations: [...cleanup.operations, ...(result.transaction?.operations ?? [])] } };
}
