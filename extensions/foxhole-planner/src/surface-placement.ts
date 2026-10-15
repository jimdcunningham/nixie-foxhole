import type { NixieExperimentalComponentEntitySnapshotV1 as Entity, NixieExperimentalTransformFinalizeRequestV1 as Request,
    NixieExperimentalTransformFinalizeResultV1 as Result } from '@nixie/extension-sdk/experimental/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import type { FoxholeModelLayerMetadata } from './model-layer-nodes.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';
import { foxholeFootprintPolygons, foxholePointInPolygon } from './scene-v2-footprints.ts';

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
    const asset = metadata[String(data(original, 'nixie.foxhole-planner', 'asset')?.assetId)];
    if (!asset || asset.isVehicle || asset.isItem || asset.category === 'foundation'
        || /^Foundation/i.test(asset.codeName) || asset.connector
        || data(original, 'nixie.foxhole-planner', 'spline-connector') || data(original, 'nixie.foxhole-planner', 'connector')) return result;
    const subject = { ...original, components: original.components.map(component => component.ownerId === 'nixie.core'
        && component.componentId === 'transform' ? { ...component, data: { ...request.transform } } : component) };
    const entities = request.context.entities.map(entity => entity.entityId === subject.entityId ? subject : entity);
    const projection = createFoxholeSpatialProjection(entities);
    const origin = projection.toWorld(subject, [0, 0, 0]);
    let surface = 0;
    for (const foundation of entities) {
        if (foundation.entityId === subject.entityId) continue;
        const floor = metadata[String(data(foundation, 'nixie.foxhole-planner', 'asset')?.assetId)];
        if (!floor || !Number.isFinite(floor.foundationSurfaceZ)) continue;
        const a = projection.toWorld(foundation, [0, 0, floor.foundationSurfaceZ!]);
        const b = projection.toWorld(foundation, [1, 0, floor.foundationSurfaceZ!]);
        const c = projection.toWorld(foundation, [0, 1, floor.foundationSurfaceZ!]);
        const u = b.map((value, axis) => value - a[axis]!);
        const v = c.map((value, axis) => value - a[axis]!);
        const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        if (Math.abs(normal[2]!) < 1e-6) continue;
        const z = a[2] - (normal[0]! * (origin[0] - a[0]) + normal[1]! * (origin[1] - a[1])) / normal[2]!;
        const local = projection.toLocal(foundation, [origin[0], origin[1], z]);
        if (Number.isFinite(z) && z > surface && foxholeFootprintPolygons(floor).some(polygon => foxholePointInPolygon({ x: local[0], y: local[1] }, polygon))) surface = z;
    }
    const parentId = data(subject, 'nixie.core', 'hierarchy')?.parentId;
    const parent = entities.find(entity => entity.entityId === parentId);
    const local = parent ? projection.toLocal(parent, [origin[0], origin[1], surface]) : [origin[0], origin[1], surface];
    result.transform = { x: local[0]!, y: local[1]!, elevation: local[2]! };
    return result;
}
