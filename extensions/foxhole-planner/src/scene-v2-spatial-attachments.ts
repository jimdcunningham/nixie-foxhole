import type { NixieComponentEntitySnapshotV1 as Entity, NixieEntityRendererContextV1 as Context,
    NixieSpatialEndpointBindingsV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { isTrenchConnector } from './trench-connector.ts';
import { trenchEndRotationTarget } from './trench-end-rotation.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { resolveFoxholeEntityAttachmentSockets } from './scene-v2-attachment-sockets.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';
import { railPathSocketPolicy, readRailPathSocket } from './rail-path-sockets.ts';

const data = (entity: Entity, id: string, owner = 'nixie.core') => entity.components.find(component => component.ownerId === owner
    && component.componentId === id && component.definitionAvailable)?.data;
const socketName = (value: string) => value.replace(/_GEN_VARIABLE$/iu, '').split(':').at(-1)!.toLowerCase();

/** Derive spatial sockets independently of the preserved 2D attachment projection. */
export function resolveFoxholeSpatialSplineAttachments(entity: Entity, spline: FoxholeSceneV2SplineConnectorData,
    context: Context, metadata: Record<string, FoxholeSceneV2AssetMetadata>,
    projection = createFoxholeSpatialProjection(context.entities), visited: ReadonlySet<string> = new Set()) {
    const entities = new Map(context.entities.map(entity => [entity.entityId, entity]));
    const resolving = new Set(visited).add(entity.entityId);
    const endpointBindings: NixieSpatialEndpointBindingsV1 = {};
    const result = { ...spline, startZ: 0, endZ: 0, endpointBindings };
    for (const prefix of ['start', 'end'] as const) {
        const subject = entities.get(String(spline[`${prefix}AttachmentNodeId`] ?? ''));
        if (!subject) continue;
        const subjectSpline = data(subject, 'spline-connector', 'nixie.foxhole-planner');
        const assetId = String(data(subject, 'asset', 'nixie.foxhole-planner')?.assetId ?? subjectSpline?.foxholeKey ?? '');
        const requested = String(spline[`${prefix}AttachmentSocketName`] ?? '');
        const pathSocket = readRailPathSocket(requested);
        if (pathSocket && resolving.has(subject.entityId)) continue;
        const resolvedRail = pathSocket && subjectSpline ? resolveFoxholeSpatialSplineAttachments(subject,
            subjectSpline as unknown as FoxholeSceneV2SplineConnectorData, context, metadata, projection, resolving) : undefined;
        const socket = resolveFoxholeEntityAttachmentSockets(subject, metadata[assetId], resolvedRail)
            .find(socket => socketName(socket.name) === socketName(requested));
        if (!socket) continue;
        const point = projection.toLocal(entity, projection.toWorld(subject, [socket.x, socket.y, socket.z ?? 0]));
        const direction = projection.toLocal(entity, projection.toWorld(subject, [socket.x + Math.cos(socket.rotation), socket.y + Math.sin(socket.rotation), socket.z ?? 0]));
        if (![...point, ...direction].every(Number.isFinite)) continue;
        const facing = prefix === 'end' && (pathSocket || railPathSocketPolicy(spline.foxholeKey) || isTrenchConnector(spline.foxholeKey)) ? -1 : 1;
        Object.assign(result, { [`${prefix}X`]: point[0], [`${prefix}Y`]: point[1], [`${prefix}Z`]: point[2],
            [`${prefix}Rotation`]: trenchEndRotationTarget(entity, prefix, context.entities)?.connector
                ? spline[`${prefix}Rotation`] : Math.atan2(facing * (direction[1] - point[1]), facing * (direction[0] - point[0])) });
        endpointBindings[prefix] = { entityId: subject.entityId, point: [socket.x, socket.y, socket.z ?? 0] };
    }
    return result;
}
