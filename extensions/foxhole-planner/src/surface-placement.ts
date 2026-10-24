import type { NixieExperimentalComponentEntitySnapshotV1 as Entity, NixieExperimentalTransformFinalizeRequestV1 as Request,
    NixieExperimentalTransformFinalizeResultV1 as Result } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import type { FoxholeModelLayerMetadata } from './model-layer-nodes.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';
import { foxholeFootprintPolygons, foxholePointInPolygon } from './scene-v2-footprints.ts';
import { foxholeAquaticWaterline } from './aquatic-placement.ts';

const data = (entity: Entity, owner: string, id: string) => entity.components.find(component =>
    component.ownerId === owner && component.componentId === id && component.definitionAvailable)?.data;

/** Vertical surface query against authored foundation footprints and their packed floor mesh.
 * Borders, underground bases, vehicles and connector geometry are not support surfaces.
 */
export function finalizeFoxholeSurfacePlacement(request: Request, metadata = assets as Record<string, FoxholeModelLayerMetadata>): Result {
    const result: Result = { contractVersion: 1, transform: { x: request.transform.x, y: request.transform.y } };
    if (request.interaction !== 'placement' && request.interaction !== 'planar-translation') return result;
    const original = request.context.entities.find(entity => entity.entityId === request.entityId);
    if (!original) return result;
    const moving = new Set(request.movingEntityIds ?? [original.entityId]);
    // Internal sockets retain the group's rigid pose. A stationary structure
    // connection owns XYZ; flexible connectors continue following their endpoints.
    for (const member of request.context.entities.filter(entity => moving.has(entity.entityId))) {
        const attachments = data(member, 'nixie.foxhole-planner', 'socket-attachments')?.attachments;
        if (Array.isArray(attachments) && attachments.some(attachment => {
            if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return false;
            if (moving.has(String(attachment.targetEntityId))) return false;
            const target = request.context.entities.find(entity => entity.entityId === attachment.targetEntityId);
            const targetAsset = target && metadata[String(data(target, 'nixie.foxhole-planner', 'asset')?.assetId)];
            return !target || (!targetAsset?.connector && !data(target, 'nixie.foxhole-planner', 'connector') && !data(target, 'nixie.foxhole-planner', 'spline-connector'));
        })) return result;
    }
    const asset = metadata[String(data(original, 'nixie.foxhole-planner', 'asset')?.assetId)];
    const foundationSubject = asset && (asset.category === 'foundation' || /^Foundation/i.test(asset.codeName));
    if (!asset || asset.isItem || ((asset.isVehicle || foundationSubject) && request.groundElevation === undefined) || asset.connector
        || data(original, 'nixie.foxhole-planner', 'spline-connector') || data(original, 'nixie.foxhole-planner', 'connector')) return result;
    const subject = { ...original, components: original.components.map(component => component.ownerId === 'nixie.core'
        && component.componentId === 'transform' ? { ...component, data: { ...request.transform } } : component) };
    const entities = request.context.entities.map(entity => entity.entityId === subject.entityId ? subject : entity);
    const projection = createFoxholeSpatialProjection(entities);
    const origin = projection.toWorld(subject, [0, 0, 0]);
    let surface = request.groundElevation ?? (moving.size > 1 ? origin[2] : 0);
    const members = moving.size > 1 ? entities.filter(entity => moving.has(entity.entityId)) : [subject];
    // The host's rigid-group support is measured at entity origins. In water,
    // compare the members' floating references instead of their hull bottoms.
    const water = request.waterElevation;
    const lowestOrigin = Math.min(...members.map(member => projection.toWorld(member, [0, 0, 0])[2]));
    const supportedByWater = water !== undefined && request.groundElevation !== undefined
        && Math.abs(request.groundElevation - (origin[2] + water - lowestOrigin)) < 0.01;
    let floatingSurface: number | undefined;
    if (supportedByWater) {
        const correction = Math.max(...members.map(member => {
            const memberAsset = metadata[String(data(member, 'nixie.foxhole-planner', 'asset')?.assetId)];
            const waterline = memberAsset && foxholeAquaticWaterline(memberAsset);
            return water - projection.toWorld(member, [0, 0, waterline ?? 0])[2];
        }));
        surface = floatingSurface = origin[2] + correction;
    }
    for (const member of members) {
    const memberAsset = metadata[String(data(member, 'nixie.foxhole-planner', 'asset')?.assetId)];
    if (memberAsset?.category === 'foundation' || /^Foundation/i.test(memberAsset?.codeName ?? '')) continue;
    const memberOrigin = projection.toWorld(member, [0, 0, 0]);
    for (const foundation of entities) {
        if (moving.has(foundation.entityId)) continue;
        const floor = metadata[String(data(foundation, 'nixie.foxhole-planner', 'asset')?.assetId)];
        if (!floor || !Number.isFinite(floor.foundationSurfaceZ)) continue;
        const a = projection.toWorld(foundation, [0, 0, floor.foundationSurfaceZ!]);
        const b = projection.toWorld(foundation, [1, 0, floor.foundationSurfaceZ!]);
        const c = projection.toWorld(foundation, [0, 1, floor.foundationSurfaceZ!]);
        const u = b.map((value, axis) => value - a[axis]!);
        const v = c.map((value, axis) => value - a[axis]!);
        const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        if (Math.abs(normal[2]!) < 1e-6) continue;
        const z = a[2] - (normal[0]! * (memberOrigin[0] - a[0]) + normal[1]! * (memberOrigin[1] - a[1])) / normal[2]!;
        const local = projection.toLocal(foundation, [memberOrigin[0], memberOrigin[1], z]);
        const target = origin[2] + z - memberOrigin[2];
        if (Number.isFinite(target) && target > surface && foxholeFootprintPolygons(floor).some(polygon => foxholePointInPolygon({ x: local[0], y: local[1] }, polygon))) surface = target;
    }
    }
    const parentId = data(subject, 'nixie.core', 'hierarchy')?.parentId;
    const parent = entities.find(entity => entity.entityId === parentId);
    let placement: [number, number, number] = [origin[0], origin[1], surface];
    const waterline = foxholeAquaticWaterline(asset);
    if (request.interaction === 'placement' && waterline !== undefined && floatingSurface !== undefined
        && Math.abs(surface - floatingSurface) < 0.01) {
        const reference = projection.toWorld(subject, [0, 0, waterline]);
        placement = [origin[0] - (reference[0] - origin[0]), origin[1] - (reference[1] - origin[1]), surface];
    }
    const local = parent ? projection.toLocal(parent, placement) : placement;
    result.transform = { x: local[0]!, y: local[1]!, elevation: local[2]! };
    return result;
}
