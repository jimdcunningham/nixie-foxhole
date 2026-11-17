import { nearestPointOnSegment } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieComponentEntitySnapshotV1 as Entity, NixieTransformFinalizeRequestV1 as Request,
    NixieTransformFinalizeResultV1 as Result } from '@nixiejs/extension-sdk/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import { railPathSocketPolicy } from './rail-path-sockets.ts';
import { fitFoxholeRailWheelbase, foxholeRailWheelbase } from './rail-wheelbase.ts';
import { sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import { withFoxholeSceneV2TransformProposal } from './scene-v2-core-transforms.ts';
import { resolveFoxholeSpatialSplineAttachments } from './scene-v2-spatial-attachments.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';
import type { FoxholeSpatialPoint } from './scene-v2-spatial-transforms.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';

const SNAP_DISTANCE = 20;
// RailZOffset on the standard and small-gauge RailTrackSpline blueprint CDOs (cm).
const RAIL_Z_OFFSET_CM = { standard: 36, small: 20, crane: 0 };
const vehicleGauge = new Map<string, 'standard' | 'small' | 'crane'>([['largecrane', 'crane']]);
for (const [id, asset] of Object.entries(assets)) {
    if (asset.isRailVehicle) vehicleGauge.set(id, id.startsWith('smalltrain') ? 'small' : 'standard');
}
export function foxholeRailVehicleGauge(assetId: string) {
    return vehicleGauge.get(assetId);
}
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
    const gauge = trackGauge(spline.foxholeKey.toLowerCase());
    const railHeight = gauge ? RAIL_Z_OFFSET_CM[gauge] * 0.32 : 0;
    return path.points.map(({ x, y }, index) => ({ x, y,
        z: railHeight + spline.startZ + (spline.endZ - spline.startZ) * path.lengths[index]! / path.totalLength }));
}

export const foxholeRailTrackFinalizers = Object.fromEntries(
    [...vehicleGauge.keys()].map(id => [`transforms.track-snapping-${id}`, finalizeFoxholeRailVehicleSnap]),
);

type RunningRail = FoxholeSpatialPoint[];
const railDistance = (a: FoxholeSpatialPoint, b: FoxholeSpatialPoint) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function followRailFromCoupler(rails: RunningRail[], source: FoxholeSpatialPoint, proposed: FoxholeSpatialPoint) {
    const direction = [proposed[0] - source[0], proposed[1] - source[1]];
    let remaining = Math.hypot(...direction);
    if (remaining <= 0) return undefined;
    let best: { rail: RunningRail; next: number; step: number; point: FoxholeSpatialPoint; score: number } | undefined;
    for (const rail of rails) for (let i = 1; i < rail.length; i++) {
        const a = rail[i - 1]!, b = rail[i]!;
        const nearest = nearestPointOnSegment({ x: source[0], y: source[1] }, { x: a[0], y: a[1] }, { x: b[0], y: b[1] });
        const point: FoxholeSpatialPoint = [nearest.x, nearest.y, a[2] + (b[2] - a[2]) * nearest.t];
        if (nearest.distance > SNAP_DISTANCE || Math.abs(point[2] - source[2]) > SNAP_DISTANCE) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const alignment = (dx * direction[0]! + dy * direction[1]!) / (Math.hypot(dx, dy) * remaining);
        if (!(Math.abs(alignment) >= 0.5)) continue;
        const score = railDistance(source, point) + 4 * (1 - Math.abs(alignment));
        if (best && score >= best.score) continue;
        const step = Math.sign(alignment);
        best = { rail, next: step > 0 ? i : i - 1, step, point, score };
    }
    if (!best) return undefined;
    let { rail, next, step, point } = best;
    const visited = new Set([rail]);
    let heading = Math.atan2(direction[1]!, direction[0]!);
    while (remaining > 1e-6) {
        const end = rail[next];
        if (end) {
            const distance = railDistance(point, end);
            if (distance > 1e-6) {
                heading = Math.atan2(end[1] - point[1], end[0] - point[0]);
                if (remaining <= distance) {
                    const t = remaining / distance;
                    return { point: point.map((value, i) => value + (end[i]! - value) * t) as FoxholeSpatialPoint, heading };
                }
            }
            remaining -= distance;
            point = end;
            next += step;
            continue;
        }
        // At a joined end, prefer the continuation with the least change in heading.
        const continuations = rails.filter(candidate => !visited.has(candidate)).flatMap(candidate => [1, -1].flatMap(sign => {
            const index = sign > 0 ? 0 : candidate.length - 1;
            const start = candidate[index]!, following = candidate[index + sign]!;
            if (railDistance(point, start) > 3) return [];
            const angle = Math.atan2(following[1] - start[1], following[0] - start[0]);
            const alignment = Math.cos(angle - heading);
            return alignment > 0 ? [{ candidate, index, sign, alignment }] : [];
        })).sort((a, b) => b.alignment - a.alignment);
        const continuation = continuations[0];
        if (!continuation) return undefined;
        rail = continuation.candidate;
        step = continuation.sign;
        point = rail[continuation.index]!;
        next = continuation.index + step;
        visited.add(rail);
    }
    return { point, heading };
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
    let best: { distance: number; heightDifference: number; point: FoxholeSpatialPoint; heading: number } | undefined;

    const rails = request.context.entities.flatMap(track => {
        const component = data(track, 'spline-connector');
        const key = String(component?.foxholeKey ?? '').toLowerCase();
        if (!component || trackGauge(key) !== gauge || data(track, 'visibility', 'nixie.core')?.visible === false) return [];
        const spline = resolveFoxholeSpatialSplineAttachments(track, component as unknown as FoxholeSceneV2SplineConnectorData,
            request.context, assets, projection);
        const points = sampleRailCenterline(spline, assets[key]).map(point => projection.toWorld(track, [point.x, point.y, point.z]));
        return points.length >= 2 ? [points] : [];
    });
    const wheelbase = foxholeRailWheelbase(String(asset?.assetId));
    const fitBody = (point: FoxholeSpatialPoint, heading: number) => {
        const body = wheelbase && fitFoxholeRailWheelbase(wheelbase, distance => followRailFromCoupler(rails, point,
            [point[0] + distance * Math.cos(heading), point[1] + distance * Math.sin(heading), point[2]])?.point);
        const center = body ? body.point : point;
        const direction = body ? body.heading : heading;
        const local = toParent(center);
        const ahead = toParent([center[0] + Math.cos(direction), center[1] + Math.sin(direction), center[2]]);
        return { local, angle: Math.atan2(ahead[1] - local[1], ahead[0] - local[0]) };
    };
    if (request.geometryGesture?.handleId === 'product-placement-port') {
        if (!request.geometryGesture.snappingEnabled || request.interaction !== 'placement') return unchanged;
        const source = request.geometryGesture.worldPoint;
        const result = followRailFromCoupler(rails, [source.x, source.y, source.z ?? origin[2]], origin);
        if (!result) return unchanged;
        const { local: point, angle: outward } = fitBody(result.point, result.heading);
        const baseHeading = Math.atan2(origin[1] - source.y, origin[0] - source.x);
        const forward = projection.toWorld(subject, [1, 0, 0]);
        const reversed = Math.cos(Math.atan2(forward[1] - origin[1], forward[0] - origin[0]) - baseHeading) < 0;
        return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2],
            rotation: reversed ? outward + Math.PI : outward } };
    }

    for (const points of rails) {
        for (let index = 1; index < points.length; index++) {
            const start = points[index - 1]!, end = points[index]!;
            const nearest = nearestPointOnSegment({ x: origin[0], y: origin[1] }, { x: start[0], y: start[1] }, { x: end[0], y: end[1] });
            if (!(nearest.distance <= SNAP_DISTANCE) || (best && nearest.distance > best.distance)) continue;
            const height = start[2] + (end[2] - start[2]) * nearest.t;
            const heightDifference = Math.abs(height - origin[2]);
            if (best && nearest.distance === best.distance && heightDifference >= best.heightDifference) continue;
            if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-6) continue;
            best = { distance: nearest.distance, heightDifference, point: [nearest.x, nearest.y, height],
                heading: Math.atan2(end[1] - start[1], end[0] - start[0]) };
        }
    }

    if (!best) return unchanged;
    // Either heading fits the track. Keep the vehicle facing the nearer direction.
    const { local: point, angle } = fitBody(best.point, best.heading);
    const turn = Math.atan2(Math.sin(angle - rotation), Math.cos(angle - rotation));
    const heading = Math.abs(turn) > Math.PI / 2 ? rotation + turn - Math.sign(turn) * Math.PI : rotation + turn;
    return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: heading } };
}
