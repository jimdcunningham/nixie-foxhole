import { nearestPointOnSegment, NIXIE_COMPONENT_MAX_DATA_BYTES, NIXIE_SIMULATION_PATH_MAX_FRAMES, NIXIE_SIMULATION_PATH_PROPERTY } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieComponentEntitySnapshotV1 as Entity, NixieTransformFinalizeRequestV1 as Request,
    NixieTransformFinalizeResultV1 as Result, NixieEntityRendererContextV1 as Context, NixieSimulationPathV1, NixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import { railPathSocketPolicy } from './rail-path-sockets.ts';
import { foxholeRailVehicleBogies } from './rail-vehicle-rigs.ts';
import { fitFoxholeRailWheelbase, foxholeRailWheelbase } from './rail-wheelbase.ts';
import { sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import { withFoxholeSceneV2TransformProposal } from './scene-v2-core-transforms.ts';
import { resolveFoxholeSpatialSplineAttachments } from './scene-v2-spatial-attachments.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';
import type { FoxholeSpatialPoint } from './scene-v2-spatial-transforms.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';

const SNAP_DISTANCE = 20;
const UNITS_PER_METRE = 32;
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

export function railCouplers(asset: FoxholeSceneV2AssetMetadata, gauge: 'small' | 'standard') {
    const model = asset.model;
    if (!model) return [];
    return (asset.overlayRailCouplers ?? []).flatMap(socket => {
        if (socket.name !== 'FrontCoupler' && socket.name !== 'RearCoupler') return [];
        const authoredX = Number(socket.x) * .32;
        if (!Number.isFinite(authoredX) || authoredX === 0) return [];
        const direction = Math.sign(authoredX);
        const end = (model.offsetX ?? 0) + direction * model.width / 2;
        const authoredZ = Number(socket.z) * .32 + (model.blueprintOrigin?.z ?? 0);
        // Some articulated exports place the template marker on an inner segment.
        const x = Math.abs(authoredX) >= Math.abs(end) * .75 ? authoredX : end;
        const z = authoredZ > 0 ? authoredZ : gauge === 'small' ? 17.28 : 33.92;
        return [{ name: socket.name, point: { x, y: Number(socket.y ?? 0) * .32, z },
            rotation: direction > 0 ? 0 : Math.PI }];
    });
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
    endpointLinks: readonly [string, string];
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

interface RailTraversal {
    /** Persisted rails permitted for an attached car. */
    route?: ReadonlySet<string>;
    /** Rails encountered while creating an attachment. */
    traversed?: Set<string>;
}

function railContinuation(rails: RunningRail[], rail: RunningRail, step: number, point: FoxholeSpatialPoint,
    heading: number, allowed: (candidate: RunningRail) => boolean) {
    const linked = rail.endpointLinks[step > 0 ? 1 : 0];
    return rails.filter(candidate => candidate !== rail && allowed(candidate)).flatMap(candidate => [1, -1].flatMap(sign => {
        const index = sign > 0 ? 0 : candidate.points.length - 1;
        const start = candidate.points[index]!, following = candidate.points[index + sign]!;
        if (railDistance(point, start) > 3) return [];
        const angle = Math.atan2(following[1] - start[1], following[0] - start[0]);
        const alignment = Math.cos(angle - heading);
        const connected = linked === candidate.entityId || candidate.endpointLinks[sign > 0 ? 0 : 1] === rail.entityId;
        return alignment > 0 ? [{ candidate, index, sign, alignment, connected }] : [];
    })).sort((a, b) => Number(b.connected) - Number(a.connected) || b.alignment - a.alignment
        || a.candidate.entityId.localeCompare(b.candidate.entityId))[0];
}

function advanceOnRail(rails: RunningRail[], location: RailLocation, delta: number, traversal?: RailTraversal) {
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
        // Prefer explicit rail connections, then least change in heading.
        const continuation = railContinuation(rails, rail, step, point, heading, candidate => !visited.has(candidate)
            && (!traversal?.route || traversal.route.has(candidate.entityId)));
        if (!continuation) return undefined;
        rail = continuation.candidate;
        step = continuation.sign;
        point = rail.points[continuation.index]!;
        next = continuation.index + step;
        visited.add(rail);
        traversal?.traversed?.add(rail.entityId);
    }
    return { ...location, step };
}

function sampleRunningRails(context: Context, gauge: NonNullable<ReturnType<typeof foxholeRailVehicleGauge>>,
    projection: ReturnType<typeof createFoxholeSpatialProjection>, metadata: Record<string, FoxholeSceneV2AssetMetadata>,
    boundRailId?: string) {
    return context.entities.flatMap(track => {
        const component = data(track, 'spline-connector');
        const key = String(component?.foxholeKey ?? '').toLowerCase();
        if (!component || trackGauge(key) !== gauge || (track.entityId !== boundRailId
            && data(track, 'visibility', 'nixie.core')?.visible === false)) return [];
        const spline = resolveFoxholeSpatialSplineAttachments(track, component as unknown as FoxholeSceneV2SplineConnectorData,
            context, metadata, projection);
        const points = sampleRailCenterline(spline, metadata[key]).map(point => projection.toWorld(track, [point.x, point.y, point.z]));
        if (points.length < 2) return [];
        const stations = [0];
        for (let index = 1; index < points.length; index++) {
            stations.push(stations[index - 1]! + railDistance(points[index - 1]!, points[index]!));
        }
        return [{ entityId: track.entityId, points, stations,
            endpointLinks: [String(component.startAttachmentNodeId ?? ''), String(component.endAttachmentNodeId ?? '')] as const }];
    });
}

function resolveRailChassis(assetId: string, rails: RunningRail[], location: RailLocation, step: number, traversal?: RailTraversal) {
    const bogies = foxholeRailVehicleBogies[assetId];
    const pivots = bogies?.length === 2 ? bogies.map(bogie => bogie.pivot * UNITS_PER_METRE) : [];
    const pivotCentre = pivots.length ? (pivots[0]! + pivots[1]!) / 2 : 0;
    const wheelbase = pivots.length ? Math.abs(pivots[0]! - pivots[1]!) : foxholeRailWheelbase(assetId);
    const sample = (offset: number) => advanceOnRail(rails, location, step * offset, traversal)?.point;
    const fit = wheelbase && fitFoxholeRailWheelbase(wheelbase, distance => sample(pivotCentre + distance));
    if (!fit || !wheelbase) return { point: location.point, heading: location.heading + (step < 0 ? Math.PI : 0),
        pitch: 0, sample, railOffset: (offset: number) => offset };
    const horizontalShift = pivotCentre * Math.cos(fit.pitch);
    const point: FoxholeSpatialPoint = [fit.point[0] - horizontalShift * Math.cos(fit.heading),
        fit.point[1] - horizontalShift * Math.sin(fit.heading), fit.point[2] - pivotCentre * Math.sin(fit.pitch)];
    const stretch = 2 * fit.halfSpan / wheelbase;
    return { point, heading: fit.heading, pitch: fit.pitch, sample, railOffset: (offset: number) => pivotCentre + (offset - pivotCentre) * stretch };
}

function sampleBogieAxles(bogie: (typeof foxholeRailVehicleBogies)[string][number],
    chassis: ReturnType<typeof resolveRailChassis>) {
    const [rear, front] = bogie.wheelOffsets;
    const pivot = bogie.pivot * UNITS_PER_METRE;
    const axleCentre = (front + rear) / 2 * UNITS_PER_METRE;
    const centreOffset = chassis.railOffset(pivot + axleCentre);
    const wheelbase = (front - rear) * UNITS_PER_METRE;
    const fit = wheelbase > 0 ? fitFoxholeRailWheelbase(wheelbase, delta => chassis.sample(centreOffset + delta)) : undefined;
    const half = fit?.halfSpan ?? Math.max(0.15 * UNITS_PER_METRE, wheelbase / 2);
    return { pivot, axleCentre, back: chassis.sample(centreOffset - half), ahead: chassis.sample(centreOffset + half) };
}

function buildRailRoute(assetId: string, rails: RunningRail[], location: RailLocation, step: number) {
    const traversed = new Set<string>();
    const chassis = resolveRailChassis(assetId, rails, location, step, { traversed });
    for (const bogie of foxholeRailVehicleBogies[assetId] ?? []) sampleBogieAxles(bogie, chassis);
    return [...traversed].slice(0, 16);
}

function readRailRoute(value: unknown): ReadonlySet<string> | undefined {
    return Array.isArray(value) ? new Set(value.filter((id): id is string => typeof id === 'string')) : undefined;
}

/** Model-local deltas for the wheel groups split around the original pivots by FoxWatch. */
export function poseFoxholeRailBogies(entity: Entity, assetId: string, context: Context,
    metadata = assets): NixieSpatialPlanV1['modelNodeTransforms'] {
    const bogies = foxholeRailVehicleBogies[assetId];
    const attachment = data(entity, ATTACHMENT_COMPONENT);
    const gauge = foxholeRailVehicleGauge(assetId);
    if (!bogies || !gauge || typeof attachment?.rail !== 'string' || typeof attachment.station !== 'number') return undefined;

    const projection = createFoxholeSpatialProjection(context.entities);
    const rails = sampleRunningRails(context, gauge, projection, metadata, attachment.rail);
    const rail = rails.find(rail => rail.entityId === attachment.rail);
    const location = rail && locationAtStation(rail, attachment.station);
    if (!location) return undefined;
    const chassis = resolveRailChassis(assetId, rails, location, attachment.reversed ? -1 : 1,
        { route: readRailRoute(attachment.route) });
    return railModelNodeTransforms(bogies, chassis, point => projection.toLocal(entity, point));
}

function railModelNodeTransforms(bogies: NonNullable<(typeof foxholeRailVehicleBogies)[string]>,
    chassis: ReturnType<typeof resolveRailChassis>, toLocal: (point: FoxholeSpatialPoint) => FoxholeSpatialPoint) {
    const { point, heading, pitch } = chassis;
    const transforms: NonNullable<NixieSpatialPlanV1['modelNodeTransforms']> = [];
    for (const bogie of bogies) {
        const { pivot: x, axleCentre, back: rearContact, ahead: frontContact } = sampleBogieAxles(bogie, chassis);
        if (!rearContact || !frontContact) continue;
        const back = toLocal(rearContact), ahead = toLocal(frontContact);
        if (![...back, ...ahead].every(Number.isFinite)) continue;
        const [dx, dy, dz] = ahead.map((value, axis) => value - back[axis]!) as FoxholeSpatialPoint;
        const axleDirection = Math.hypot(dx, dy, dz);
        if (axleDirection < 1e-6) continue;
        const centre = back.map((value, axis) => (value + ahead[axis]!) / 2);
        const pivotX = centre[0]! - axleCentre * dx / axleDirection;
        const pivotY = centre[1]! - axleCentre * dy / axleDirection;
        const pivotZ = centre[2]! - axleCentre * dz / axleDirection;
        transforms.push({ nodeName: bogie.nodeName,
            translation: [(pivotX - x) / UNITS_PER_METRE, pivotZ / UNITS_PER_METRE, pivotY / UNITS_PER_METRE],
            rotation: [0, -Math.atan2(dy, dx), Math.atan2(dz, Math.hypot(dx, dy))] });
    }
    const origin = toLocal(point);
    const forward = toLocal([point[0] + Math.cos(heading) * Math.cos(pitch),
        point[1] + Math.sin(heading) * Math.cos(pitch), point[2] + Math.sin(pitch)]);
    const bodyPitch = Math.atan2(forward[2] - origin[2], Math.hypot(forward[0] - origin[0], forward[1] - origin[1]));
    if (Number.isFinite(bodyPitch) && Math.abs(bodyPitch) > 1e-6) {
        transforms.push({ nodeName: 'rail-body', translation: [0, 0, 0], rotation: [0, 0, bodyPitch] });
    }
    return transforms.length ? transforms : undefined;
}

type PoweredTestVehicle = 'trainengine' | 'trainlrartillery';
type RailChassis = ReturnType<typeof resolveRailChassis>;

function railSimulationFrame(assetId: PoweredTestVehicle, chassis: RailChassis, distance: number) {
    const bogies = foxholeRailVehicleBogies[assetId]!;
    const clearance = Math.max((foxholeRailWheelbase(assetId) ?? 0) / 2,
        ...bogies.flatMap(bogie => bogie.wheelOffsets.map(offset => Math.abs(bogie.pivot + offset) * UNITS_PER_METRE))) + 6;
    const compact = (vector: FoxholeSpatialPoint): FoxholeSpatialPoint => vector.map(value => Number(value.toFixed(5))) as FoxholeSpatialPoint;
    if (!chassis.sample(-clearance) || !chassis.sample(clearance)) return undefined;
    const { point, heading } = chassis;
    const cosine = Math.cos(heading), sine = Math.sin(heading);
    const posed = railModelNodeTransforms(bogies, chassis, ([x, y, z]) => {
        const dx = x - point[0], dy = y - point[1];
        return [dx * cosine + dy * sine, -dx * sine + dy * cosine, z - point[2]];
    }) ?? [];
    if (bogies.some(bogie => !posed.some(node => node.nodeName === bogie.nodeName))) return undefined;
    if (!posed.some(node => node.nodeName === 'rail-body')) {
        posed.push({ nodeName: 'rail-body', translation: [0, 0, 0], rotation: [0, 0, 0] });
    }
    return { distance, position: compact(point), heading: Math.atan2(sine, cosine),
        modelNodeTransforms: posed.map(node => ({ nodeName: node.nodeName, translation: compact(node.translation), rotation: compact(node.rotation) })) };
}

type SimulationFrame = NonNullable<ReturnType<typeof railSimulationFrame>>;

/** Sample a forward run using the fitted chassis and each independently sampled wheel group. */
function buildRailVehicleSimulationPath(assetId: PoweredTestVehicle, rails: RunningRail[], start: RailLocation, direction: number) {
    const stride = 12;
    const sources = new Set([start.rail.entityId]);
    const frames: SimulationFrame[] = [];
    for (let index = 0; index < 128; index++) {
        const distance = index * stride;
        const traversed = new Set<string>();
        const location = index === 0 ? { ...start, step: direction }
            : advanceOnRail(rails, start, distance * direction, { traversed });
        if (!location) break;
        const frame = railSimulationFrame(assetId, resolveRailChassis(assetId, rails, location, location.step, { traversed }), distance);
        if (!frame) break;
        sources.add(location.rail.entityId);
        for (const id of traversed) sources.add(id);
        frames.push(frame);
    }
    return frames.length >= 2 ? { contractVersion: 1 as const, speed: 96, sources: [...sources], frames } : undefined;
}

interface DirectedRailLocation extends RailLocation {
    step: number;
}

function couplerPoint(chassis: RailChassis, point: ReturnType<typeof railCouplers>[number]['point']): FoxholeSpatialPoint {
    const { heading, pitch, point: origin } = chassis;
    const along = point.x * Math.cos(pitch) - point.z * Math.sin(pitch);
    return [origin[0] + along * Math.cos(heading) - point.y * Math.sin(heading),
        origin[1] + along * Math.sin(heading) + point.y * Math.cos(heading),
        origin[2] + point.x * Math.sin(pitch) + point.z * Math.cos(pitch)];
}

const engineId = 'trainengine';
const cannonId = 'trainlrartillery';
const drawbarLength = .5 * UNITS_PER_METRE;
const drawbarSlack = .3 * UNITS_PER_METRE;

/** Solve the coupled centre station on the same running line as the anchor. */
function findCoupledChassis(rails: RunningRail[], anchor: DirectedRailLocation, anchorId: PoweredTestVehicle, traversal: RailTraversal) {
    const offsetDirection = anchorId === cannonId ? 1 : -1;
    const otherId = anchorId === engineId ? cannonId : engineId;
    const engineCoupler = railCouplers(assets[engineId]!, 'standard').find(coupler => coupler.name === 'RearCoupler')!;
    const cannonCoupler = railCouplers(assets[cannonId]!, 'standard').find(coupler => coupler.name === 'FrontCoupler')!;
    const anchorCoupler = anchorId === engineId ? engineCoupler : cannonCoupler;
    const otherCoupler = anchorId === engineId ? cannonCoupler : engineCoupler;
    const fixed = resolveRailChassis(anchorId, rails, anchor, anchor.step, traversal);
    const fixedPoint = couplerPoint(fixed, anchorCoupler.point);
    const separation = Math.abs(engineCoupler.point.x) + Math.abs(cannonCoupler.point.x);
    const evaluate = (offset: number) => {
        const location = advanceOnRail(rails, anchor, offsetDirection * offset * anchor.step, traversal);
        if (!location) return undefined;
        const facing = { ...location, step: location.step * offsetDirection };
        const chassis = resolveRailChassis(otherId, rails, facing, facing.step, traversal);
        const point = couplerPoint(chassis, otherCoupler.point);
        const tangentDistance = offsetDirection * ((point[0] - fixedPoint[0]) * Math.cos(fixed.heading)
            + (point[1] - fixedPoint[1]) * Math.sin(fixed.heading));
        const gap = railDistance(point, fixedPoint);
        return { facing, chassis, error: tangentDistance < 0 ? -gap - drawbarLength : gap - drawbarLength };
    };
    let low = separation - 96;
    let high = separation + 96;
    let best = evaluate(separation + drawbarLength);
    if (best && Math.abs(best.error) <= .1) return { fixed, coupled: best.chassis, location: best.facing };
    for (let i = 0; i < 17; i++) {
        const mid = (low + high) / 2;
        const sample = evaluate(mid);
        if (!sample || sample.error > 0) high = mid;
        else low = mid;
        if (sample && (!best || Math.abs(sample.error) < Math.abs(best.error))) best = sample;
    }
    if (!best || Math.abs(best.error) > drawbarSlack) return undefined;
    return { fixed, coupled: best.chassis, location: best.facing };
}

function simplifyConsistFrames(engine: SimulationFrame[], cannon: SimulationFrame[]): number[] {
    const indices = [0];
    const error = (frames: SimulationFrame[], start: number, index: number, end: number) => {
        const a = frames[start]!, b = frames[end]!, sample = frames[index]!;
        const fraction = (sample.distance - a.distance) / (b.distance - a.distance);
        const angleError = (from: number, to: number, value: number) => {
            const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
            const difference = value - (from + delta * fraction);
            return Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference)));
        };
        const positionError = (from: number[], to: number[], value: number[]) =>
            Math.hypot(...value.map((coordinate, axis) => coordinate - (from[axis]! + (to[axis]! - from[axis]!) * fraction)));
        let ratio = Math.max(positionError(a.position, b.position, sample.position) / .9,
            angleError(a.heading, b.heading, sample.heading) / .0045);
        for (const [node, pose] of sample.modelNodeTransforms.entries()) {
            const from = a.modelNodeTransforms[node]!, to = b.modelNodeTransforms[node]!;
            ratio = Math.max(ratio, positionError(from.translation, to.translation, pose.translation) / .02,
                ...pose.rotation.map((angle, axis) => angleError(from.rotation[axis]!, to.rotation[axis]!, angle) / .007));
        }
        return ratio;
    };
    const retain = (start: number, end: number) => {
        let split = start;
        let worst = 1;
        for (let index = start + 1; index < end; index++) {
            const ratio = Math.max(error(engine, start, index, end), error(cannon, start, index, end));
            if (ratio > worst) {
                split = index;
                worst = ratio;
            }
        }
        if (split > start) {
            retain(start, split);
            retain(split, end);
        } else {
            indices.push(end);
        }
    };
    retain(0, engine.length - 1);
    return indices;
}

function closedRunningLine(rails: RunningRail[], start: DirectedRailLocation) {
    const visited = new Set([start.rail]);
    let { rail, step } = start;
    let distance = 0;
    for (let i = 0; i < rails.length; i++) {
        distance += rail.stations.at(-1)!;
        const end = step > 0 ? rail.points.length - 1 : 0;
        const point = rail.points[end]!, previous = rail.points[end - step]!;
        const heading = Math.atan2(point[1] - previous[1], point[0] - previous[0]);
        const next = railContinuation(rails, rail, step, point, heading, () => true);
        if (!next || railDistance(point, next.candidate.points[next.index]!) > .02) return undefined;
        if (next.candidate === start.rail && next.sign === start.step) {
            return { distance, rails: visited };
        }
        if (visited.has(next.candidate)) return undefined;
        visited.add(next.candidate);
        rail = next.candidate;
        step = next.sign;
    }
}

function buildRailConsist(rails: RunningRail[], anchor: DirectedRailLocation, anchorId: PoweredTestVehicle,
    engineEntityId: string, cannonEntityId: string) {
    const initial = findCoupledChassis(rails, anchor, anchorId, {});
    if (!initial) return undefined;
    const engineStart = anchorId === engineId ? anchor : initial.location;
    const line = closedRunningLine(rails, engineStart);
    const route = line && new Set([...line.rails].map(rail => rail.entityId));
    const sources = new Set([engineStart.rail.entityId, anchor.rail.entityId]);
    const at = (leader: DirectedRailLocation, distance: number, limit?: ReadonlySet<string>) => {
        const traversed = new Set<string>();
        const traversal = { traversed, route: limit };
        const consist = findCoupledChassis(rails, leader, engineId, traversal);
        if (!consist) return undefined;
        const engine = railSimulationFrame(engineId, consist.fixed, distance);
        const cannon = railSimulationFrame(cannonId, consist.coupled, distance);
        if (!engine || !cannon) return undefined;
        traversed.add(leader.rail.entityId);
        traversed.add(consist.location.rail.entityId);
        if (sources.size + [...traversed].filter(id => !sources.has(id)).length >= 64) return undefined;
        for (const id of traversed) sources.add(id);
        return { engine, cannon };
    };
    const rest = at(engineStart, 0, route);
    if (!rest) return undefined;
    const sample = (direction: 1 | -1, length: number, limit?: ReadonlySet<string>) => {
        const frames: NonNullable<ReturnType<typeof at>>[] = [];
        let leader = engineStart;
        for (let distance = 12; distance < length; distance += 12) {
            const location = advanceOnRail(rails, leader, 12 * leader.step * direction, { route: limit });
            if (!location) break;
            leader = { ...location, step: location.step * direction };
            const frame = at(leader, direction * distance, limit);
            if (!frame) break;
            frames.push(frame);
        }
        return frames;
    };
    const limit = Math.min(line?.distance ?? 8192, 40_000);
    const forward = sample(1, limit, route);
    let loop = !!line && line.distance === limit && (forward.at(-1)?.engine.distance ?? 0) >= limit - 12;
    if (loop) forward.push({ engine: { ...rest.engine, distance: limit }, cannon: { ...rest.cannon, distance: limit } });
    let backward = loop ? [] : sample(-1, Math.min(limit, 8192), route).reverse();
    let pairs = [...backward, rest, ...forward];
    if (pairs.length < 2) return undefined;
    let indices = simplifyConsistFrames(pairs.map(pair => pair.engine), pairs.map(pair => pair.cannon));
    if (loop && indices.length > NIXIE_SIMULATION_PATH_MAX_FRAMES) {
        loop = false;
        forward.pop(); // The last frame was a copy of the loop's start.
        backward = sample(-1, 8192, route).reverse();
        pairs = [...backward, rest, ...forward];
        indices = simplifyConsistFrames(pairs.map(pair => pair.engine), pairs.map(pair => pair.cannon));
    }
    if (!indices.includes(backward.length)) indices = [...indices, backward.length].sort((a, b) => a - b);
    if (indices.length > NIXIE_SIMULATION_PATH_MAX_FRAMES) {
        const startIndex = Math.max(0, indices.indexOf(backward.length) - 128);
        indices = indices.slice(startIndex, startIndex + NIXIE_SIMULATION_PATH_MAX_FRAMES);
    }
    const initialDistance = pairs[indices[0]!]!.engine.distance;
    // Sandbox estimates in SI units. Traction and braking limits apply to the
    // entire consist. Studio integrates the resulting longitudinal rates.
    const massKg = 72_000 + 135_000;
    const common = { contractVersion: 1 as const, speed: 4 * UNITS_PER_METRE,
        drive: { leader: engineEntityId, acceleration: 65_000 / massKg * UNITS_PER_METRE,
            braking: 100_000 / massKg * UNITS_PER_METRE, manual: { startDistance: 0 - initialDistance, loop } } };
    const pack = (vehicle: 'engine' | 'cannon', peer: string) => {
        const frames = indices.map(index => pairs[index]![vehicle]);
        const nodes = rest[vehicle].modelNodeTransforms.map((node, index) => ({ name: node.nodeName, index }))
            .filter(({ index }) => frames.some(frame => {
                const node = frame.modelNodeTransforms[index]!;
                return [...node.translation, ...node.rotation].some(value => value !== 0);
            }));
        return {
            ...common, sources: [...sources, peer],
            ...(nodes.length ? { modelNodes: nodes.map(node => node.name) } : {}),
            frames: frames.map(frame => ({
                distance: frame.distance - initialDistance, position: frame.position,
                heading: Math.min(Math.PI, Math.max(-Math.PI, Number(frame.heading.toFixed(6)))), modelNodeTransforms: [],
                ...(nodes.length ? { modelOffsets: nodes.flatMap(({ index }) => {
                    const node = frame.modelNodeTransforms[index]!;
                    return [...node.translation, ...node.rotation].map(value => Number(value.toFixed(4)));
                }) } : {}),
            })),
        } satisfies NixieSimulationPathV1;
    };
    const engine = pack('engine', cannonEntityId), cannon = pack('cannon', engineEntityId);
    const encoder = new TextEncoder();
    if ([engine, cannon].some(path => encoder.encode(JSON.stringify(path)).byteLength > NIXIE_COMPONENT_MAX_DATA_BYTES - 1024)) return;
    return { location: initial.location, engine, cannon };
}

export function finalizeFoxholeRailVehicleSnap(request: Request): Result {
    const { x, y, rotation } = request.transform;
    const unchanged: Result = { contractVersion: 1, transform: { x, y } };
    if ((request.movingEntityIds?.length ?? 1) > 1) return unchanged;

    const original = request.context.entities.find(entity => entity.entityId === request.entityId);
    const asset = original && data(original, 'asset');
    const assetId = String(asset?.assetId);
    const gauge = asset?.catalogId === 'foxhole.structures' && vehicleGauge.get(assetId);
    if (!original || !gauge) return unchanged;

    const saved = data(original, ATTACHMENT_COMPONENT);
    const attachment = (location?: RailLocation, reversed = false, route: string[] = [], simulationPath?: ReturnType<typeof buildRailVehicleSimulationPath>): Result['transaction'] => {
        if (!location && !saved) return undefined;
        const set = location && { rail: location.rail.entityId, station: location.station, reversed, route,
            ...(simulationPath ? { [NIXIE_SIMULATION_PATH_PROPERTY]: simulationPath } : {}) };
        if (set && saved?.rail === set.rail && saved.station === set.station && saved.reversed === set.reversed
            && JSON.stringify(saved.route) === JSON.stringify(route)
            && JSON.stringify(saved[NIXIE_SIMULATION_PATH_PROPERTY]) === JSON.stringify(simulationPath)) return undefined;
        return { contractVersion: 1, transactionId: `rail-attachment-${crypto.randomUUID()}`,
            operations: [set
                ? saved ? { op: 'patch', entityId: original.entityId, componentId: ATTACHMENT_COMPONENT, set,
                    ...(!simulationPath && saved[NIXIE_SIMULATION_PATH_PROPERTY] ? { unset: [NIXIE_SIMULATION_PATH_PROPERTY] } : {}) }
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

    const rails = sampleRunningRails(request.context, gauge, projection, assets, request.followedEntityId);
    const simulationPath = (location: RailLocation, step: number) =>
        assetId === 'trainengine' || assetId === 'trainlrartillery' ? buildRailVehicleSimulationPath(assetId, rails, location, step) : undefined;
    const fitBody = (location: RailLocation, step = 1, route?: ReadonlySet<string>) => {
        const { point: center, heading } = resolveRailChassis(assetId, rails, location, step, { route });
        const local = toParent(center);
        const ahead = toParent([center[0] + Math.cos(heading), center[1] + Math.sin(heading), center[2]]);
        return { local, angle: Math.atan2(ahead[1] - local[1], ahead[0] - local[0]) };
    };
    const couple = (anchor: Entity, anchorAsset: PoweredTestVehicle, tolerance: number): Result | undefined => {
        const anchorAttachment = data(anchor, ATTACHMENT_COMPONENT);
        const anchorRail = rails.find(rail => rail.entityId === anchorAttachment?.rail);
        const anchorLocation = anchorRail && typeof anchorAttachment?.station === 'number'
            && locationAtStation(anchorRail, anchorAttachment.station);
        if (!anchorLocation) return;
        const directed = { ...anchorLocation, step: anchorAttachment?.reversed ? -1 : 1 };
        const initial = findCoupledChassis(rails, directed, anchorAsset, {});
        if (!initial || railDistance(initial.location.point, origin) > tolerance) return;
        const engineEntityId = assetId === engineId ? original.entityId : anchor.entityId;
        const cannonEntityId = assetId === cannonId ? original.entityId : anchor.entityId;
        const pair = buildRailConsist(rails, directed, anchorAsset, engineEntityId, cannonEntityId);
        if (!pair) return;
        const { local: point, angle } = fitBody(pair.location, pair.location.step);
        let transaction = attachment(pair.location, pair.location.step < 0,
            buildRailRoute(assetId, rails, pair.location, pair.location.step), assetId === engineId ? pair.engine : pair.cannon);
        const anchorPath = assetId === engineId ? pair.cannon : pair.engine;
        if (JSON.stringify(anchorAttachment?.simulationPath) !== JSON.stringify(anchorPath)) {
            transaction ??= { contractVersion: 1, transactionId: `rail-consist-${crypto.randomUUID()}`, operations: [] };
            transaction.operations.push({ op: 'patch', entityId: anchor.entityId, componentId: ATTACHMENT_COMPONENT,
                set: { [NIXIE_SIMULATION_PATH_PROPERTY]: anchorPath } });
        }
        return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: angle },
            ...(transaction ? { transaction } : {}) };
    };
    if (request.followedEntityId) {
        if (saved?.rail !== request.followedEntityId || typeof saved.station !== 'number') return unchanged;
        const rail = rails.find(rail => rail.entityId === saved.rail);
        const location = rail && locationAtStation(rail, saved.station);
        if (!location) return unchanged;
        const { local: point, angle } = fitBody(location, saved.reversed ? -1 : 1, readRailRoute(saved.route));
        const turn = Math.atan2(Math.sin(angle - rotation), Math.cos(angle - rotation));
        return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: rotation + turn } };
    }

    if (request.geometryGesture?.handleId === 'product-placement-port') {
        if (!request.geometryGesture.snappingEnabled || request.interaction !== 'placement') return unchanged;
        const source = request.geometryGesture.worldPoint;
        const baseHeading = Math.atan2(origin[1] - source.y, origin[0] - source.x);
        const forward = projection.toWorld(subject, [1, 0, 0]);
        const reversed = Math.cos(Math.atan2(forward[1] - origin[1], forward[0] - origin[0]) - baseHeading) < 0;
        const anchor = entities.find(entity => entity.entityId === request.geometryGesture!.hoveredEntityIds[0]);
        const anchorAsset = anchor && data(anchor, 'asset')?.assetId;
        if (anchor && ((assetId === engineId && anchorAsset === cannonId && !reversed)
            || (assetId === cannonId && anchorAsset === engineId && reversed))) {
            const existingPath = data(anchor, ATTACHMENT_COMPONENT)?.simulationPath as unknown as NixieSimulationPathV1 | undefined;
            if (existingPath?.drive) return unchanged;
            return couple(anchor, anchorAsset as PoweredTestVehicle, 100) ?? unchanged;
        }
        const railElevation = anchor ? projection.toWorld(anchor, [0, 0, 0])[2] : source.z ?? origin[2];
        const result = followRailFromCoupler(rails, [source.x, source.y, railElevation], origin);
        if (!result) return unchanged;
        const step = reversed ? -result.step : result.step;
        const { local: point, angle } = fitBody(result, step);
        const transaction = attachment(result, step < 0, buildRailRoute(assetId, rails, result, step), simulationPath(result, step));
        return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2],
            rotation: angle }, ...(transaction ? { transaction } : {}) };
    }

    const previous = saved?.simulationPath as unknown as NixieSimulationPathV1 | undefined;
    if (assetId === engineId && request.interaction === 'planar-translation' && previous?.drive?.leader === original.entityId) {
        const cannon = entities.find(entity => previous.sources.includes(entity.entityId) && data(entity, 'asset')?.assetId === cannonId);
        const cannonPath = cannon && data(cannon, ATTACHMENT_COMPONENT)?.simulationPath as unknown as NixieSimulationPathV1 | undefined;
        if (cannon && cannonPath?.drive?.leader === original.entityId) {
            const refreshed = couple(cannon, cannonId, SNAP_DISTANCE);
            if (refreshed) return refreshed;
        }
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
    const reversed = Math.cos(fitBody(best).angle - rotation) < 0;
    const { local: point, angle } = fitBody(best, reversed ? -1 : 1);
    const heading = rotation + Math.atan2(Math.sin(angle - rotation), Math.cos(angle - rotation));
    const step = reversed ? -1 : 1;
    const transaction = attachment(best, reversed, buildRailRoute(assetId, rails, best, step), simulationPath(best, step));
    return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: heading },
        ...(transaction ? { transaction } : {}) };
}
