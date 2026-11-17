import { nearestPointOnSegment } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieComponentEntitySnapshotV1 as Entity, NixieTransformFinalizeRequestV1 as Request,
    NixieTransformFinalizeResultV1 as Result, NixiePathPlacementV1 } from '@nixiejs/extension-sdk/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import { railPathSocketPolicy } from './rail-path-sockets.ts';
import { sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import { withFoxholeSceneV2TransformProposal } from './scene-v2-core-transforms.ts';
import { resolveFoxholeSpatialSplineAttachments } from './scene-v2-spatial-attachments.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';
import type { FoxholeSpatialPoint } from './scene-v2-spatial-transforms.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';

const SNAP_DISTANCE = 20;
const vehicleGauge = new Map([['trainengine', 'standard'], ['smalltrainengine', 'small'], ['largecrane', 'crane']]);
const data = (entity: Entity, id: string, owner = 'nixie.foxhole-planner') => entity.components.find(component =>
    component.ownerId === owner && component.componentId === id && component.definitionAvailable)?.data;

function trackGauge(key: string) {
    if (key === 'cranerailtrackspline') return 'crane';
    if (!railPathSocketPolicy(key)) return undefined;
    return key.startsWith('small') ? 'small' : 'standard';
}

function sampleRailCenterline(spline: FoxholeSceneV2SplineConnectorData & { startZ: number; endZ: number }, asset?: FoxholeSceneV2AssetMetadata) {
    const path = sampleFoxholeSceneV2Connector(spline, asset);
    if (!(path.totalLength > 0)) return [];
    return path.points.map(({ x, y }, index) => ({ x, y,
        z: spline.startZ + (spline.endZ - spline.startZ) * path.lengths[index]! / path.totalLength }));
}

export function locomotivePlacementPath(spline: FoxholeSceneV2SplineConnectorData & { startZ: number; endZ: number },
    metadata: Record<string, FoxholeSceneV2AssetMetadata>): NixiePathPlacementV1 | undefined {
    const key = spline.foxholeKey.toLowerCase();
    const gauge = trackGauge(key);
    if (!gauge || gauge === 'crane') return undefined;
    const locomotives = [...vehicleGauge].filter(([id, vehicleTrackGauge]) => vehicleTrackGauge === gauge && metadata[id]?.model);
    const model = locomotives[0] && metadata[locomotives[0][0]]?.model;
    if (!model) return undefined;
    const points = sampleRailCenterline(spline, metadata[key]);
    if (points.length < 2) return undefined;
    const stride = Math.ceil((points.length - 1) / 255);
    return { points: points.filter((_, index) => index % stride === 0 || index === points.length - 1),
        size: { length: model.width, width: model.depth, height: model.height }, productIds: locomotives.map(([id]) => `asset.${id}`) };
}

export function finalizeFoxholeRailVehicleSnap(request: Request): Result {
    const { x, y, rotation } = request.transform;
    const unchanged: Result = { contractVersion: 1, transform: { x, y } };
    if (request.interaction !== 'placement' && request.interaction !== 'planar-translation') return unchanged;
    if ((request.movingEntityIds?.length ?? 1) > 1) return unchanged;

    const original = request.context.entities.find(entity => entity.entityId === request.entityId);
    const asset = original && data(original, 'asset');
    const gauge = asset?.catalogId === 'foxhole.structures' && vehicleGauge.get(String(asset.assetId));
    if (!original || !gauge) return unchanged;

    const subject = withFoxholeSceneV2TransformProposal(original, request.transform);
    const entities = request.context.entities.map(entity => entity === original ? subject : entity);
    const projection = createFoxholeSpatialProjection(entities);
    const origin = projection.toWorld(subject, [0, 0, 0]);
    const parent = entities.find(entity => entity.entityId === data(subject, 'hierarchy', 'nixie.core')?.parentId);
    const toParent = (point: FoxholeSpatialPoint) => parent ? projection.toLocal(parent, point) : point;
    let best: { distance: number; heightDifference: number; point: FoxholeSpatialPoint; angle: number } | undefined;

    for (const track of request.context.entities) {
        const component = data(track, 'spline-connector');
        const key = String(component?.foxholeKey ?? '').toLowerCase();
        if (!component || trackGauge(key) !== gauge || data(track, 'visibility', 'nixie.core')?.visible === false) continue;
        const spline = resolveFoxholeSpatialSplineAttachments(track, component as unknown as FoxholeSceneV2SplineConnectorData,
            request.context, assets, projection);
        const points = sampleRailCenterline(spline, assets[key]).map(point => projection.toWorld(track, [point.x, point.y, point.z]));

        for (let index = 1; index < points.length; index++) {
            const start = points[index - 1]!, end = points[index]!;
            const nearest = nearestPointOnSegment({ x: origin[0], y: origin[1] }, { x: start[0], y: start[1] }, { x: end[0], y: end[1] });
            if (!(nearest.distance <= SNAP_DISTANCE) || (best && nearest.distance > best.distance)) continue;
            const height = start[2] + (end[2] - start[2]) * nearest.t;
            const heightDifference = Math.abs(height - origin[2]);
            if (best && nearest.distance === best.distance && heightDifference >= best.heightDifference) continue;
            const a = toParent(start), b = toParent(end);
            if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
            best = { distance: nearest.distance, heightDifference, point: toParent([nearest.x, nearest.y, height]),
                angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
        }
    }

    if (!best) return unchanged;
    // Either heading fits the track. Keep the vehicle facing the nearer direction.
    const turn = Math.atan2(Math.sin(best.angle - rotation), Math.cos(best.angle - rotation));
    const heading = Math.abs(turn) > Math.PI / 2 ? rotation + turn - Math.sign(turn) * Math.PI : rotation + turn;
    return { contractVersion: 1, transform: { x: best.point[0], y: best.point[1], elevation: best.point[2], rotation: heading } };
}
