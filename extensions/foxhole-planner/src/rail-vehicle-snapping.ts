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
const RAIL_Z_OFFSET_CM = { standard: 36, small: 20 };
// The crane track blueprint has no RailZOffset. Use the exported railhead
// height as a fallback when the catalog does not include the spatial model.
const CRANE_RAILHEAD_HEIGHT_CM = 26.506;
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
    const model = asset?.model;
    const railHeight = gauge === 'crane'
        ? (model ? model.offsetZ + model.height / 2 : CRANE_RAILHEAD_HEIGHT_CM * 0.32)
        : (gauge ? RAIL_Z_OFFSET_CM[gauge] * 0.32 : 0);
    return path.points.map(({ x, y }, index) => ({ x, y,
        z: railHeight + spline.startZ + (spline.endZ - spline.startZ) * path.lengths[index]! / path.totalLength }));
}

export const foxholeRailTrackFinalizers = Object.fromEntries(
    [...vehicleGauge.keys()].map(id => [`transforms.track-snapping-${id}`, finalizeFoxholeRailVehicleSnap]),
);

interface RunningRail {
    entityId: string;
    points: FoxholeSpatialPoint[];
    stations: number[];
}

interface RailLocation {
    rail: RunningRail;
    station: number;
    segmentEnd: number;
    point: FoxholeSpatialPoint;
    heading: number;
}

const ATTACHMENT_COMPONENT = 'rail-attachment';
const railDistance = (a: FoxholeSpatialPoint, b: FoxholeSpatialPoint) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function railLocation(rail: RunningRail, index: number, t: number): RailLocation {
    const start = rail.points[index - 1]!, end = rail.points[index]!;
    const startStation = rail.stations[index - 1]!, endStation = rail.stations[index]!;
    return {
        rail,
        segmentEnd: index,
        station: startStation + (endStation - startStation) * t,
        point: start.map((value, axis) => value + (end[axis]! - value) * t) as FoxholeSpatialPoint,
        heading: Math.atan2(end[1] - start[1], end[0] - start[0]),
    };
}

function locationAtStation(rail: RunningRail, station: number): RailLocation | undefined {
    const target = Math.max(0, Math.min(station, rail.stations.at(-1)!));
    for (let index = 1; index < rail.stations.length; index++) {
        const start = rail.stations[index - 1]!, end = rail.stations[index]!;
        if (end >= target && end > start) return railLocation(rail, index, (target - start) / (end - start));
    }
}

function followRailFromCoupler(rails: RunningRail[], source: FoxholeSpatialPoint, proposed: FoxholeSpatialPoint) {
    const direction = [proposed[0] - source[0], proposed[1] - source[1]];
    const distance = Math.hypot(...direction);
    if (distance <= 0) return undefined;
    let best: { location: RailLocation; step: number; score: number; } | undefined;
    for (const rail of rails) for (let i = 1; i < rail.points.length; i++) {
        const a = rail.points[i - 1]!, b = rail.points[i]!;
        const nearest = nearestPointOnSegment({ x: source[0], y: source[1] }, { x: a[0], y: a[1] }, { x: b[0], y: b[1] });
        const point: FoxholeSpatialPoint = [nearest.x, nearest.y, a[2] + (b[2] - a[2]) * nearest.t];
        if (nearest.distance > SNAP_DISTANCE || Math.abs(point[2] - source[2]) > SNAP_DISTANCE) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const alignment = (dx * direction[0]! + dy * direction[1]!) / (Math.hypot(dx, dy) * distance);
        if (!(Math.abs(alignment) >= 0.5)) continue;
        const score = railDistance(source, point) + 4 * (1 - Math.abs(alignment));
        if (best && score >= best.score) continue;
        best = { location: railLocation(rail, i, nearest.t), step: Math.sign(alignment), score };
    }
    return best && advanceOnRail(rails, best.location, distance * best.step);
}

function advanceOnRail(rails: RunningRail[], location: RailLocation, delta: number) {
    let { rail, point, heading } = location;
    let remaining = Math.abs(delta);
    let step = delta < 0 ? -1 : 1;
    let next = step > 0 ? location.segmentEnd : location.segmentEnd - 1;
    if (step < 0) heading += Math.PI;
    const visited = new Set([rail]);
    while (remaining > 1e-6) {
        const end = rail.points[next];
        if (end) {
            const distance = railDistance(point, end);
            if (distance > 1e-6) {
                heading = Math.atan2(end[1] - point[1], end[0] - point[0]);
                if (remaining <= distance) {
                    const index = step > 0 ? next : next + 1;
                    const fractionFromEnd = (distance - remaining) / (rail.stations[index]! - rail.stations[index - 1]!);
                    return { ...railLocation(rail, index, step > 0 ? 1 - fractionFromEnd : fractionFromEnd), step };
                }
            }
            remaining -= distance;
            point = end;
            next += step;
            continue;
        }
        // At a joined end, prefer the continuation with the least change in heading.
        const continuations = rails.filter(candidate => !visited.has(candidate)).flatMap(candidate => [1, -1].flatMap(sign => {
            const index = sign > 0 ? 0 : candidate.points.length - 1;
            const start = candidate.points[index]!, following = candidate.points[index + sign]!;
            if (railDistance(point, start) > 3) return [];
            const angle = Math.atan2(following[1] - start[1], following[0] - start[0]);
            const alignment = Math.cos(angle - heading);
            return alignment > 0 ? [{ candidate, index, sign, alignment }] : [];
        })).sort((a, b) => b.alignment - a.alignment);
        const continuation = continuations[0];
        if (!continuation) return undefined;
        rail = continuation.candidate;
        step = continuation.sign;
        point = rail.points[continuation.index]!;
        next = continuation.index + step;
        visited.add(rail);
    }
    return { ...location, step };
}

export function finalizeFoxholeRailVehicleSnap(request: Request): Result {
    const { x, y, rotation } = request.transform;
    const unchanged: Result = { contractVersion: 1, transform: { x, y } };
    if ((request.movingEntityIds?.length ?? 1) > 1) return unchanged;

    const original = request.context.entities.find(entity => entity.entityId === request.entityId);
    const asset = original && data(original, 'asset');
    const gauge = asset?.catalogId === 'foxhole.structures' && vehicleGauge.get(String(asset.assetId));
    if (!original || !gauge) return unchanged;

    const saved = data(original, ATTACHMENT_COMPONENT);
    const attachment = (location?: RailLocation, reversed = false): Result['transaction'] => {
        if (!location && !saved) return undefined;
        const set = location && { rail: location.rail.entityId, station: location.station, reversed };
        if (set && saved?.rail === set.rail && saved.station === set.station && saved.reversed === set.reversed) return undefined;
        return { contractVersion: 1, transactionId: `rail-attachment-${crypto.randomUUID()}`,
            operations: [set
                ? saved ? { op: 'patch', entityId: original.entityId, componentId: ATTACHMENT_COMPONENT, set }
                    : { op: 'add', entityId: original.entityId, componentId: ATTACHMENT_COMPONENT, data: set }
                : { op: 'remove', entityId: original.entityId, componentId: ATTACHMENT_COMPONENT }] };
    };
    const detach = (): Result => {
        const transaction = attachment();
        return transaction ? { ...unchanged, transaction } : unchanged;
    };
    if (!request.followedEntityId && request.interaction !== 'placement' && request.interaction !== 'planar-translation') {
        return request.interaction === 'transform' && !request.geometryGesture ? detach() : unchanged;
    }

    if (!request.followedEntityId && request.snappingEnabled === false) return detach();

    const subject = withFoxholeSceneV2TransformProposal(original, request.transform);
    const entities = request.context.entities.map(entity => entity === original ? subject : entity);
    const projection = createFoxholeSpatialProjection(entities);
    const origin = projection.toWorld(subject, [0, 0, 0]);
    const parent = entities.find(entity => entity.entityId === data(subject, 'hierarchy', 'nixie.core')?.parentId);
    const toParent = (point: FoxholeSpatialPoint) => parent ? projection.toLocal(parent, point) : point;
    let best: (RailLocation & { distance: number; heightDifference: number; }) | undefined;

    const rails = request.context.entities.flatMap(track => {
        const component = data(track, 'spline-connector');
        const key = String(component?.foxholeKey ?? '').toLowerCase();
        if (!component || trackGauge(key) !== gauge || (track.entityId !== request.followedEntityId
            && data(track, 'visibility', 'nixie.core')?.visible === false)) return [];
        const spline = resolveFoxholeSpatialSplineAttachments(track, component as unknown as FoxholeSceneV2SplineConnectorData,
            request.context, assets, projection);
        const points = sampleRailCenterline(spline, assets[key]).map(point => projection.toWorld(track, [point.x, point.y, point.z]));
        if (points.length < 2) return [];
        const stations = [0];
        for (let index = 1; index < points.length; index++) {
            stations.push(stations[index - 1]! + railDistance(points[index - 1]!, points[index]!));
        }
        return [{ entityId: track.entityId, points, stations }];
    });
    const wheelbase = foxholeRailWheelbase(String(asset?.assetId));
    const fitBody = (location: RailLocation, step = 1) => {
        const heading = location.heading + (step < 0 ? Math.PI : 0);
        const body = wheelbase && fitFoxholeRailWheelbase(wheelbase, distance => advanceOnRail(rails, location, step * distance)?.point);
        const center = body ? body.point : location.point;
        const direction = body ? body.heading : heading;
        const local = toParent(center);
        const ahead = toParent([center[0] + Math.cos(direction), center[1] + Math.sin(direction), center[2]]);
        return { local, angle: Math.atan2(ahead[1] - local[1], ahead[0] - local[0]) };
    };
    if (request.followedEntityId) {
        if (saved?.rail !== request.followedEntityId || typeof saved.station !== 'number') return unchanged;
        const rail = rails.find(rail => rail.entityId === saved.rail);
        const location = rail && locationAtStation(rail, saved.station);
        if (!location) return unchanged;
        const { local: point, angle } = fitBody(location);
        const heading = angle + (saved.reversed ? Math.PI : 0);
        const turn = Math.atan2(Math.sin(heading - rotation), Math.cos(heading - rotation));
        return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: rotation + turn } };
    }

    if (request.geometryGesture?.handleId === 'product-placement-port') {
        if (!request.geometryGesture.snappingEnabled || request.interaction !== 'placement') return unchanged;
        const source = request.geometryGesture.worldPoint;
        const result = followRailFromCoupler(rails, [source.x, source.y, source.z ?? origin[2]], origin);
        if (!result) return unchanged;
        const { local: point, angle: outward } = fitBody(result, result.step);
        const baseHeading = Math.atan2(origin[1] - source.y, origin[0] - source.x);
        const forward = projection.toWorld(subject, [1, 0, 0]);
        const reversed = Math.cos(Math.atan2(forward[1] - origin[1], forward[0] - origin[0]) - baseHeading) < 0;
        const transaction = attachment(result, reversed !== (result.step < 0));
        return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2],
            rotation: reversed ? outward + Math.PI : outward }, ...(transaction ? { transaction } : {}) };
    }

    for (const rail of rails) {
        const { points } = rail;
        for (let index = 1; index < points.length; index++) {
            const start = points[index - 1]!, end = points[index]!;
            const nearest = nearestPointOnSegment({ x: origin[0], y: origin[1] }, { x: start[0], y: start[1] }, { x: end[0], y: end[1] });
            if (!(nearest.distance <= SNAP_DISTANCE) || (best && nearest.distance > best.distance)) continue;
            const height = start[2] + (end[2] - start[2]) * nearest.t;
            const heightDifference = Math.abs(height - origin[2]);
            if (best && nearest.distance === best.distance && heightDifference >= best.heightDifference) continue;
            if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-6) continue;
            best = { ...railLocation(rail, index, nearest.t), distance: nearest.distance, heightDifference };
        }
    }

    if (!best) return detach();
    // Either heading fits the track. Keep the vehicle facing the nearer direction.
    const { local: point, angle } = fitBody(best);
    const turn = Math.atan2(Math.sin(angle - rotation), Math.cos(angle - rotation));
    const reversed = Math.abs(turn) > Math.PI / 2;
    const heading = reversed ? rotation + turn - Math.sign(turn) * Math.PI : rotation + turn;
    const transaction = attachment(best, reversed);
    return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: heading },
        ...(transaction ? { transaction } : {}) };
}
