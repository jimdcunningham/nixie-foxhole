import type { NixieExperimentalComponentEntitySnapshotV1 as Entity, NixieExperimentalEntityRendererContextV1 as Context,
    NixieExperimentalSpatialEndpointBindingsV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { resolveFoxholeEntityAttachmentSockets } from './scene-v2-attachment-sockets.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';

const data = (entity: Entity, id: string, owner = 'nixie.core') => entity.components.find(component => component.ownerId === owner
    && component.componentId === id && component.definitionAvailable)?.data;
const socketName = (value: string) => value.replace(/_GEN_VARIABLE$/iu, '').split(':').at(-1)!.toLowerCase();

/** Derive spatial sockets independently of the preserved 2D attachment projection. */
export function resolveFoxholeSpatialSplineAttachments(entity: Entity, spline: FoxholeSceneV2SplineConnectorData,
    context: Context, metadata: Record<string, FoxholeSceneV2AssetMetadata>) {
    const entities = new Map(context.entities.map(entity => [entity.entityId, entity]));
    const projection = createFoxholeSpatialProjection(context.entities);
    const endpointBindings: NixieExperimentalSpatialEndpointBindingsV1 = {};
    const result = { ...spline, startZ: 0, endZ: 0, endpointBindings };
    for (const prefix of ['start', 'end'] as const) {
        const subject = entities.get(String(spline[`${prefix}AttachmentNodeId`] ?? ''));
        if (!subject) continue;
        const assetId = String(data(subject, 'asset', 'nixie.foxhole-planner')?.assetId ?? '');
        const requested = String(spline[`${prefix}AttachmentSocketName`] ?? '');
        const socket = resolveFoxholeEntityAttachmentSockets(subject, metadata[assetId]).find(socket => socketName(socket.name) === socketName(requested));
        if (!socket) continue;
        const point = projection.toLocal(entity, projection.toWorld(subject, [socket.x, socket.y, socket.z ?? 0]));
        const direction = projection.toLocal(entity, projection.toWorld(subject, [socket.x + Math.cos(socket.rotation), socket.y + Math.sin(socket.rotation), socket.z ?? 0]));
        if (![...point, ...direction].every(Number.isFinite)) continue;
        Object.assign(result, { [`${prefix}X`]: point[0], [`${prefix}Y`]: point[1], [`${prefix}Z`]: point[2],
            [`${prefix}Rotation`]: Math.atan2(direction[1] - point[1], direction[0] - point[0]) });
        endpointBindings[prefix] = { entityId: subject.entityId, point: [socket.x, socket.y, socket.z ?? 0] };
    }
    return result;
}
