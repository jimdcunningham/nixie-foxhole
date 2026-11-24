import { nearestPointOnSegment, NIXIE_COMPONENT_MAX_DATA_BYTES, NIXIE_SIMULATION_PATH_MAX_FRAMES, NIXIE_SIMULATION_PATH_PROPERTY,
    NIXIE_SIMULATION_COLLIDER_PROPERTY,
    NIXIE_SIMULATION_ROUTING_PROPERTY, NIXIE_SIMULATION_ROUTING_SCHEMA_V1, NIXIE_TRANSFORM_FINALIZER_MAX_BYTES,
    validateNixieComponentDataV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieComponentEntitySnapshotV1 as Entity, NixieTransformFinalizeRequestV1 as Request,
    NixieTransformFinalizeResultV1 as Result, NixieEntityRendererContextV1 as Context, NixieSimulationPathV1,
    NixieSimulationColliderV1, NixieSimulationRouteConnectionV1, NixieSimulationRouteV1, NixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import { railPathSocketPolicy, readRailPathSocket } from './rail-path-sockets.ts';
import { fixedRailNetwork, fixedRailRegionId, nearbyFixedRailRegions, readFixedRailEndpoint } from './fixed-region-rails.ts';
import { foxholeRailVehicleBogies } from './rail-vehicle-rigs.ts';
import { fitFoxholeRailWheelbase, foxholeRailWheelbase } from './rail-wheelbase.ts';
import { sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import { FOXHOLE_BOARD_UNITS_PER_METRE as UNITS_PER_METRE } from './scene-v2-footprints.ts';
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

export function foxholeRailContactPorts(assetId: string) {
    const asset = assets[assetId], gauge = vehicleGauge.get(assetId);
    if (!asset || !gauge || gauge === 'crane') return [];
    return railCouplers(asset, gauge).map(({ point }) => {
        const end = point.x > 0 ? 1 as const : -1 as const;
        return { end, point: [point.x, point.y, point.z] as FoxholeSpatialPoint,
            compatibility: gauge, captureDistance: .65 * UNITS_PER_METRE, maxLatchSpeed: 1.5 * UNITS_PER_METRE,
            effect: end > 0 ? 'coupler-front' : 'coupler-rear' };
    });
}

function railVehicleCollider(assetId: string) {
    const asset = assets[assetId], gauge = vehicleGauge.get(assetId);
    const model = asset?.model;
    if (!model || !gauge || gauge === 'crane') return;
    const ports = foxholeRailContactPorts(assetId);
    const forward = ports.find(port => port.end > 0)?.point[0];
    const rear = ports.find(port => port.end < 0)?.point[0];
    const minX = model.offsetX - model.width / 2;
    const maxX = model.offsetX + model.width / 2;
    const start = Math.min(Math.max(minX, rear ?? minX), model.offsetX - .5);
    const end = Math.max(Math.min(maxX, forward ?? maxX), model.offsetX + .5);
    const wheelOffsets = (foxholeRailVehicleBogies[assetId] ?? [])
        .flatMap(bogie => bogie.wheelOffsets.map(offset => (bogie.pivot + offset) * UNITS_PER_METRE));
    // The first driver is on the locomotive's rigid frame, outside the rear truck.
    if (assetId === 'trainengine') wheelOffsets.push(2.51 * UNITS_PER_METRE);
    const fallback = (foxholeRailWheelbase(assetId) ?? model.width * .65) / 2;
    return { center: [(start + end) / 2, model.offsetY, model.offsetZ],
        halfExtents: [(end - start) / 2, model.depth / 2, model.height / 2],
        wheelSpan: wheelOffsets.length ? [Math.min(...wheelOffsets), Math.max(...wheelOffsets)] : [-fallback, fallback],
        guidedContact: { massKg: railVehicleMass(assetId), ports } } satisfies NixieSimulationColliderV1;
}

const railVehicleMass = (assetId: string) => assetId === 'trainengine' ? 72_000
    : assetId === 'trainlrartillery' ? 135_000
        : assetId === 'smalltrainengine' ? 15_000
            : assetId.startsWith('smalltrain') ? 50_000 : 32_000;
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
    fixed?: boolean;
    points: FoxholeSpatialPoint[];
    stations: number[];
    endpointLinks: readonly [string, string];
    endpointSockets?: readonly [string, string];
    loop?: boolean;
}

interface RailLocation {
    rail: RunningRail;
    station: number;
    segmentEnd: number;
    point: FoxholeSpatialPoint;
    heading: number;
}

const ATTACHMENT_COMPONENT = 'rail-attachment';
const ROUTING_COMPONENTS = ['rail-simulation-routing', 'rail-simulation-routing-overflow'] as const;
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
    if (!Number.isFinite(target)) return;
    let low = 1, high = rail.stations.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (rail.stations[middle]! >= target && rail.stations[middle]! > 0) high = middle;
        else low = middle + 1;
    }
    const start = rail.stations[low - 1]!, end = rail.stations[low]!;
    if (end > start) return railLocation(rail, low, (target - start) / (end - start));
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
    allowExtendedDrawbar?: boolean;
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
        if (!!rail.fixed !== !!candidate.fixed && !connected) return [];
        return alignment > 0 ? [{ candidate, index, sign, alignment, connected }] : [];
    })).sort((a, b) => Number(b.connected) - Number(a.connected) || b.alignment - a.alignment
        || a.candidate.entityId.localeCompare(b.candidate.entityId))[0];
}

function advanceOnRail(rails: RunningRail[], location: RailLocation, delta: number, traversal?: RailTraversal) {
    let { rail, point, heading } = location;
    let remaining = Math.abs(delta);
    let step = delta < 0 ? -1 : 1;
    const station = location.station + delta;
    if (station >= 0 && station <= rail.stations.at(-1)!) {
        const next = locationAtStation(rail, station);
        return next && { ...next, step };
    }
    if (rail.loop) {
        const next = locationAtStation(rail, wrapStation(station, routeLength(rail)));
        return next && { ...next, step };
    }
    if (rails.length === 1) return undefined;
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
    origin: FoxholeSpatialPoint, boundRailId?: string): RunningRail[] {
    const makeStations = (points: FoxholeSpatialPoint[]) => {
        const stations = [0];
        for (let index = 1; index < points.length; index++) {
            stations.push(stations[index - 1]! + railDistance(points[index - 1]!, points[index]!));
        }
        return stations;
    };
    const authored: RunningRail[] = context.entities.flatMap(track => {
        const component = data(track, 'spline-connector');
        const key = String(component?.foxholeKey ?? '').toLowerCase();
        if (!component || trackGauge(key) !== gauge || (track.entityId !== boundRailId
            && data(track, 'visibility', 'nixie.core')?.visible === false)) return [];
        const spline = resolveFoxholeSpatialSplineAttachments(track, component as unknown as FoxholeSceneV2SplineConnectorData,
            context, metadata, projection);
        const points = sampleRailCenterline(spline, metadata[key]).map(point => projection.toWorld(track, [point.x, point.y, point.z]));
        if (points.length < 2) return [];
        const fixedStart = readFixedRailEndpoint(component.startFixedRailEnd);
        const fixedEnd = readFixedRailEndpoint(component.endFixedRailEnd);
        return [{ entityId: track.entityId, points, stations: makeStations(points),
            endpointLinks: [fixedStart?.railId ?? String(component.startAttachmentNodeId ?? ''),
                fixedEnd?.railId ?? String(component.endAttachmentNodeId ?? '')] as const,
            endpointSockets: [String(component.startAttachmentSocketName ?? ''), String(component.endAttachmentSocketName ?? '')] as const }];
    });
    if (gauge !== 'standard') return authored;
    const ids = new Set(nearbyFixedRailRegions(context, origin[0], origin[1]));
    for (const reference of [...authored.flatMap(rail => rail.endpointLinks),
        ...context.entities.map(entity => data(entity, ATTACHMENT_COMPONENT)?.fixedRail)]) {
        const region = fixedRailRegionId(reference);
        if (region) ids.add(region);
    }
    const offset = RAIL_Z_OFFSET_CM.standard * 0.32;
    return authored.concat([...ids].flatMap(region => fixedRailNetwork(region)?.rails ?? []).map(({ id, points: base }) => {
        const points = base.map(([x, y, z]): FoxholeSpatialPoint => [x, y, z + offset]);
        return { entityId: id, fixed: true, points, stations: makeStations(points), endpointLinks: ['', ''] };
    }));
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
    return [...traversed].filter(id => !rails.find(rail => rail.entityId === id)?.fixed).slice(0, 16);
}

function readRailRoute(value: unknown, rails: RunningRail[]): ReadonlySet<string> | undefined {
    return Array.isArray(value) ? new Set([...value.filter((id): id is string => typeof id === 'string'),
        ...rails.filter(rail => rail.fixed).map(rail => rail.entityId)]) : undefined;
}

/** Model-local deltas for the wheel groups split around the original pivots by FoxWatch. */
export function poseFoxholeRailBogies(entity: Entity, assetId: string, context: Context,
    metadata = assets): NixieSpatialPlanV1['modelNodeTransforms'] {
    const bogies = foxholeRailVehicleBogies[assetId];
    const attachment = data(entity, ATTACHMENT_COMPONENT);
    const gauge = foxholeRailVehicleGauge(assetId);
    const railId = attachment?.fixedRail ?? attachment?.rail;
    if (!bogies || !gauge || typeof railId !== 'string' || typeof attachment?.station !== 'number') return undefined;

    const projection = createFoxholeSpatialProjection(context.entities);
    const rails = sampleRunningRails(context, gauge, projection, metadata, projection.toWorld(entity, [0, 0, 0]), railId);
    const rail = rails.find(rail => rail.entityId === railId);
    const location = rail && locationAtStation(rail, attachment.station);
    if (!location) return undefined;
    const chassis = resolveRailChassis(assetId, rails, location, attachment.reversed ? -1 : 1,
        { route: readRailRoute(attachment.route, rails) });
    const toLocal = (point: FoxholeSpatialPoint) => projection.toLocal(entity, point);
    const [x, y, z] = toLocal(chassis.point);
    const [aheadX, aheadY] = toLocal([chassis.point[0] + Math.cos(chassis.heading),
        chassis.point[1] + Math.sin(chassis.heading), chassis.point[2]]);
    // A gizmo can preview or commit a group transform while retaining old rail stations.
    // Use the authored rest pose until the saved station and rendered chassis agree.
    if (Math.hypot(x, y, z) > 1 || Math.abs(Math.atan2(aheadY - y, aheadX - x)) > .01) return undefined;
    return railModelNodeTransforms(bogies, chassis, toLocal);
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

function railSimulationFrame(assetId: string, chassis: RailChassis, distance: number) {
    const bogies = foxholeRailVehicleBogies[assetId] ?? [];
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
const smallEngineId = 'smalltrainengine';
const cannonId = 'trainlrartillery';
const drawbarLength = .5 * UNITS_PER_METRE;
const drawbarSlack = .3 * UNITS_PER_METRE;

function railDrive(leader: string, massKg: number, startDistance: number, loop: boolean, passive = false, smallGauge = false) {
    // Yard simulation tuning. Higher brake force keeps the stopping distance at top speed comparable.
    // The small locomotive's movement blueprint caps its speed at 4 m/s.
    return { contractVersion: 1 as const, speed: (smallGauge ? 4 : 8) * UNITS_PER_METRE,
        drive: { leader, acceleration: 195_000 / massKg * UNITS_PER_METRE,
            braking: 400_000 / massKg * UNITS_PER_METRE, manual: { startDistance, loop, ...(passive ? { passive } : {}) } } };
}

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
    if (!best || Math.abs(best.error) > drawbarSlack) {
        if (!traversal.allowExtendedDrawbar) return undefined;
        // A tight turnout can make the gap nonmonotonic as individual bogies
        // cross the points. Search the full feasible drawbar range before giving up.
        let bestOffset = separation + drawbarLength;
        for (let offset = separation - 100; offset <= separation + 150; offset += 12) {
            const sample = evaluate(offset);
            if (sample && (!best || Math.abs(sample.error) < Math.abs(best.error))) {
                best = sample;
                bestOffset = offset;
            }
        }
        for (let offset = bestOffset - 10; offset <= bestOffset + 10; offset += 2) {
            const sample = evaluate(offset);
            if (sample && (!best || Math.abs(sample.error) < Math.abs(best.error))) best = sample;
        }
        if (!best || Math.abs(best.error) > 2.5 * UNITS_PER_METRE) return undefined;
    }
    return { fixed, coupled: best.chassis, location: best.facing };
}

function simplifyConsistFrames(engine: SimulationFrame[], cannon: SimulationFrame[] = engine, tolerance = 1): number[] {
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
        let worst = tolerance;
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
    const spans: { rail: RunningRail; step: number }[] = [];
    let { rail, step } = start;
    let distance = 0;
    for (let i = 0; i < rails.length; i++) {
        spans.push({ rail, step });
        distance += rail.stations.at(-1)!;
        const end = step > 0 ? rail.points.length - 1 : 0;
        const point = rail.points[end]!, previous = rail.points[end - step]!;
        const heading = Math.atan2(point[1] - previous[1], point[0] - previous[0]);
        const next = railContinuation(rails, rail, step, point, heading, () => true);
        if (!next || railDistance(point, next.candidate.points[next.index]!) > .02) return undefined;
        if (next.candidate === start.rail && next.sign === start.step) {
            return { distance, rails: visited, spans };
        }
        if (visited.has(next.candidate)) return undefined;
        visited.add(next.candidate);
        rail = next.candidate;
        step = next.sign;
    }
}

function openRunningLine(rails: RunningRail[], start: DirectedRailLocation) {
    const visited = new Set([start.rail]);
    const follow = (direction: number) => {
        let { rail, step } = start;
        const spans: { rail: RunningRail; step: number }[] = [];
        step *= direction;
        while (true) {
            const end = step > 0 ? rail.points.length - 1 : 0;
            const point = rail.points[end]!, previous = rail.points[end - step]!;
            const heading = Math.atan2(point[1] - previous[1], point[0] - previous[0]);
            const next = railContinuation(rails, rail, step, point, heading, candidate => !visited.has(candidate));
            if (!next) return spans;
            rail = next.candidate;
            step = next.sign;
            visited.add(rail);
            spans.push({ rail, step: step * direction });
        }
    };
    const backward = follow(-1), forward = follow(1);
    return { rails: visited, spans: [...backward.reverse(), start, ...forward] };
}

interface RouteSpan {
    rail: RunningRail;
    step: number;
    offset: number;
}

interface RouteGeometry {
    path: RunningRail;
    spans: RouteSpan[];
    first: number;
    last: number;
    loop: boolean;
}

const routeLength = (rail: RunningRail) => rail.stations.at(-1)!;
const wrapStation = (value: number, length: number) => ((value % length) + length) % length;

function appendRoutePoints(path: RunningRail, points: FoxholeSpatialPoint[]) {
    for (const point of points) {
        const previous = path.points.at(-1);
        const distance = previous ? railDistance(previous, point) : 0;
        if (previous && distance < 1e-6) continue;
        path.points.push(point);
        path.stations.push((path.stations.at(-1) ?? 0) + distance);
    }
}

function appendRouteSpans(path: RunningRail, spans: { rail: RunningRail; step: number }[]): RouteSpan[] {
    return spans.map(({ rail, step }) => {
        const points = step > 0 ? rail.points : [...rail.points].reverse();
        appendRoutePoints(path, [points[0]!]);
        const offset = routeLength(path);
        appendRoutePoints(path, points.slice(1));
        return { rail, step, offset };
    });
}

interface ParkedRailVehicle {
    entity: Entity;
    assetId: string;
    location: DirectedRailLocation;
    chassis: RailChassis;
}

function railVehicleAt(entity: Entity, rails: RunningRail[]): ParkedRailVehicle | undefined {
    const assetId = String(data(entity, 'asset')?.assetId);
    const attachment = data(entity, ATTACHMENT_COMPONENT);
    const rail = rails.find(entry => entry.entityId === (attachment?.fixedRail ?? attachment?.rail));
    const location = rail && typeof attachment?.station === 'number' && locationAtStation(rail, attachment.station);
    if (!location || !vehicleGauge.has(assetId) || vehicleGauge.get(assetId) === 'crane') return;
    const step = attachment?.reversed ? -1 : 1;
    return { entity, assetId, location: { ...location, step }, chassis: resolveRailChassis(assetId, rails, location, step) };
}

function packRailFrames(frames: SimulationFrame[]) {
    const first = frames[0]!.distance;
    const nodes = frames[0]!.modelNodeTransforms.map((node, index) => ({ name: node.nodeName, index }))
        .filter(({ index }) => frames.some(frame => {
            const node = frame.modelNodeTransforms[index]!;
            return [...node.translation, ...node.rotation].some(value => value !== 0);
        }));
    return {
        ...(nodes.length ? { modelNodes: nodes.map(node => node.name) } : {}),
        frames: frames.map(frame => ({
            distance: frame.distance - first,
            position: frame.position.map(value => Number(value.toFixed(3))) as FoxholeSpatialPoint,
            heading: Math.max(-Math.PI, Math.min(Math.PI, Number(frame.heading.toFixed(6)))), modelNodeTransforms: [],
            ...(nodes.length ? { modelOffsets: nodes.flatMap(({ index }) => {
                const node = frame.modelNodeTransforms[index]!;
                return [...node.translation, ...node.rotation].map(value => Number(value.toFixed(4)));
            }) } : {}),
        })),
    };
}

/** Reconstruct couplings from the saved socket poses on the same running line.
 * Older scenes saved rail stations for socket placements, with no coupling links. */
function buildTrainDrive(leader: ParkedRailVehicle, vehicles: ParkedRailVehicle[], rails: RunningRail[], subjectId: string,
    options?: { requireAdditionalCars?: boolean; portOwnerId?: string; passive?: boolean; }) {
    const closed = closedRunningLine(rails, leader.location);
    const line = closed ?? openRunningLine(rails, leader.location);
    const path: RunningRail = { entityId: '', points: [], stations: [], endpointLinks: ['', ''], loop: !!closed };
    const spans = appendRouteSpans(path, line.spans);
    const length = routeLength(path);
    const locate = ({ location }: ParkedRailVehicle) => {
        const span = spans.find(entry => entry.rail === location.rail);
        if (!span) return;
        return { station: span.offset + (span.step > 0 ? location.station : routeLength(span.rail) - location.station),
            facing: span.step * location.step };
    };
    const origin = locate(leader)!.station;
    const candidates = [leader, ...vehicles.filter(vehicle => vehicle !== leader && vehicle.assetId !== engineId
        && vehicle.assetId !== smallEngineId)].flatMap(vehicle => {
        const parked = locate(vehicle);
        if (!parked) return [];
        const distance = parked.station - origin;
        const offset = closed ? wrapStation(distance + length / 2, length) - length / 2 : distance;
        const gauge = vehicleGauge.get(vehicle.assetId);
        const sockets = (gauge === 'standard' || gauge === 'small' ? railCouplers(assets[vehicle.assetId]!, gauge) : []).map(socket => ({
            point: couplerPoint(vehicle.chassis, socket.point),
            side: Math.sign(socket.point.x) * parked.facing,
        }));
        return [{ ...vehicle, offset, facing: parked.facing, sockets }];
    });
    const members = [candidates[0]!];
    const matched = new Set([leader.entity.entityId]);
    const portOwnerId = options?.portOwnerId;
    for (const side of [-1, 1]) {
        let tail = members[0]!;
        while (members.length < 32) {
            const socket = tail.sockets.find(entry => entry.side === side);
            if (!socket) break;
            let nearest: typeof tail | undefined;
            let score = 24;
            for (const next of candidates) {
                if (matched.has(next.entity.entityId) || (next.offset - tail.offset) * side <= 0) continue;
                const mating = next.sockets.find(entry => entry.side === -side);
                if (!mating) continue;
                const distance = railDistance(socket.point, mating.point);
                const fromPort = (tail.entity.entityId === portOwnerId && next.entity.entityId === subjectId)
                    || (next.entity.entityId === portOwnerId && tail.entity.entityId === subjectId);
                const candidateScore = fromPort && distance < 100 ? distance - 100 : distance;
                if (candidateScore >= score) continue;
                score = candidateScore;
                nearest = next;
            }
            if (!nearest) break;
            matched.add(nearest.entity.entityId);
            members.push(nearest);
            tail = nearest;
        }
    }
    if (!matched.has(subjectId) || options?.requireAdditionalCars && members.length < 3) return;
    const sources = [...line.rails].filter(rail => !rail.fixed).map(rail => rail.entityId);
    if (sources.length + members.length > 65) return;
    const sample = (rail: RunningRail, station: number, distance: number) => members.map(member => {
        const target = station + member.offset;
        if (!rail.loop && (target < 0 || target > routeLength(rail))) return;
        const position = locationAtStation(rail, rail.loop ? wrapStation(target, routeLength(rail)) : target);
        if (!position) return;
        return railSimulationFrame(member.assetId, resolveRailChassis(member.assetId, [rail], position, member.facing), distance);
    });
    const samples: SimulationFrame[][] = members.map(() => []);
    const pose = (distance: number) => {
        const frames = sample(path, origin + distance, distance);
        return frames.every((frame): frame is SimulationFrame => !!frame) ? frames : undefined;
    };
    const rest = pose(0);
    if (!rest) return;
    const walk = (side: number, limit: number) => {
        const frames: SimulationFrame[][] = [];
        for (let distance = 16; distance < limit; distance += 16) {
            const row = pose(distance * side);
            if (!row) break;
            frames.push(row);
        }
        return frames;
    };
    const forward = walk(1, closed ? Math.min(length, 40_000) : Math.min(16_000, length - origin));
    const loop = !!closed && length <= 40_000 && (forward.at(-1)?.[0]?.distance ?? 0) >= length - 16;
    const backward = loop ? [] : walk(-1, Math.min(16_000, closed ? length - (forward.at(-1)?.[0]?.distance ?? 0) : origin)).reverse();
    for (const row of [...backward, rest, ...forward, ...(loop ? [rest.map(frame => ({ ...frame, distance: length }))] : [])]) {
        row.forEach((frame, index) => samples[index]!.push(frame));
    }
    if (samples[0]!.length < 2) return;
    const mass = members.reduce((total, member) => total + railVehicleMass(member.assetId), 0);
    const drive = railDrive(leader.entity.entityId, mass, 0 - samples[0]![0]!.distance, loop, options?.passive,
        vehicleGauge.get(leader.assetId) === 'small');
    const encoder = new TextEncoder();
    const before = Math.max(...members.map(member => member.offset)) + 192;
    const after = -Math.min(...members.map(member => member.offset)) + 192;
    const shouldRoute = (!closed || loop) && rails.some(rail => rail.endpointSockets?.some(socket => readRailPathSocket(socket)));
    const pack = (member: (typeof members)[number], index: number, tolerance: number) => {
        const frames = samples[index]!;
        const selected = simplifyConsistFrames(frames, frames, tolerance);
        if (!selected.includes(backward.length)) selected.push(backward.length);
        selected.sort((a, b) => a - b);
        return { ...drive,
            sources: [...sources, ...members.filter(other => other !== member).map(other => other.entity.entityId)],
            ...packRailFrames(selected.map(i => frames[i]!)) } satisfies NixieSimulationPathV1;
    };
    let fallback: ((typeof members)[number] & { path: ReturnType<typeof pack>; routes: NixieSimulationRouteV1[]; })[] | undefined;
    for (const tolerance of [1, 2, 4, 8, 12, 16]) {
        const paths = members.map((member, index) => pack(member, index, tolerance));
        const bytes = encoder.encode(JSON.stringify(paths)).byteLength;
        if (paths.some(entry => entry.frames.length > NIXIE_SIMULATION_PATH_MAX_FRAMES
            || encoder.encode(JSON.stringify(entry)).byteLength > NIXIE_COMPONENT_MAX_DATA_BYTES - 1024)
            || bytes > NIXIE_TRANSFORM_FINALIZER_MAX_BYTES - 16_384) continue;
        const routing = shouldRoute ? buildConsistRoutes(rails, line, leader.location, paths[0]!, NIXIE_TRANSFORM_FINALIZER_MAX_BYTES - bytes - 16_384,
                members.length, (rail, station) => {
                    const frames = sample(rail, station, station);
                    return frames.every((frame): frame is SimulationFrame => !!frame) ? frames : undefined;
                }, { before, after, room: Math.max(before, after) + 180 }, tolerance)
            : undefined;
        const plan = members.map((member, index) => ({ ...member, path: paths[index]!, routes: routing?.routes[index] ?? [] }));
        if (!routing?.overBudget || routing.routes[0]!.length) return plan;
        // Try fitting the primary line and the turnout together before discarding the turnout.
        fallback ??= plan;
    }
    return fallback;
}

function routePiece(geometry: RouteGeometry, from: number, to: number): FoxholeSpatialPoint[] {
    if (to < from) return routePiece(geometry, to, from).reverse();
    const { path, loop } = geometry;
    const length = routeLength(path);
    const origin = loop ? wrapStation(from, length) : from;
    const limit = origin + to - from;
    if (origin < 0 || (!loop && limit > length) || (loop && to - from > length)) return [];
    const slice = (start: number, end: number) => [
        locationAtStation(path, start)!.point,
        ...path.points.filter((_, index) => path.stations[index]! > start && path.stations[index]! < end),
        locationAtStation(path, end)!.point,
    ];
    return limit <= length ? slice(origin, limit) : [...slice(origin, length), ...slice(0, limit - length)];
}

function buildConsistRoutes(rails: RunningRail[], line: ReturnType<typeof openRunningLine>,
    engineStart: DirectedRailLocation, primary: NixieSimulationPathV1, byteBudget: number, vehicleCount: number,
    sample: (path: RunningRail, station: number) => SimulationFrame[] | undefined,
    handoff = { before: 192, after: 800, room: 900 }, tolerance = 1) {
    const makePath = (entityId: string): RunningRail => ({ entityId, points: [], stations: [], endpointLinks: ['', ''] });
    const mainPath = makePath('');
    const mainSpans = appendRouteSpans(mainPath, line.spans);
    const parked = mainSpans.find(span => span.rail === engineStart.rail)!;
    const manual = primary.drive!.manual!;
    const primaryLength = primary.frames.at(-1)!.distance;
    const first = parked.offset + (engineStart.step > 0 ? engineStart.station : routeLength(engineStart.rail) - engineStart.station)
        - manual.startDistance;
    const geometries: RouteGeometry[] = [
        { path: mainPath, spans: mainSpans, first, last: first + primaryLength, loop: manual.loop },
    ];
    const used = new Set(line.rails);
    const encoder = new TextEncoder();
    let remaining = byteBudget;
    const result: NixieSimulationRouteV1[][] = Array.from({ length: vehicleCount }, () => []);
    // Leave room for the entire consist on either side of a switch handoff.
    const fittingRoom = handoff.room;
    let overBudget = false;
    const station = (span: RouteSpan, fraction: number) =>
        span.offset + routeLength(span.rail) * (span.step > 0 ? fraction : 1 - fraction);
    const connection = (geometry: RouteGeometry, span: RouteSpan, name: string, point: number, transfer: number): NixieSimulationRouteConnectionV1 => ({
        id: `${span.rail.entityId}:${name}`,
        rail: span.rail.entityId,
        position: locationAtStation(geometry.path, point)!.point,
        route: geometry.path.entityId,
        distance: geometry.loop ? wrapStation(transfer - geometry.first, primaryLength) : transfer - geometry.first,
        occupancyRadius: 1.5 * UNITS_PER_METRE,
    });
    for (const source of geometries) for (const span of source.spans) for (const branch of rails) {
        if (used.has(branch) || result[0]!.length >= 16) continue;
        const side = branch.endpointLinks.findIndex((id, i) => id === span.rail.entityId
            && readRailPathSocket(branch.endpointSockets?.[i] ?? ''));
        if (side < 0) continue;
        const socket = branch.endpointSockets![side]!;
        const entry = readRailPathSocket(socket)!;
        const direction = span.step * (entry.reverse ? -1 : 1);
        const fork = station(span, entry.fraction);
        const startTransfer = fork - direction * (direction > 0 ? handoff.before : handoff.after);
        if (!source.loop && (startTransfer < source.first || startTransfer > source.last)) continue;
        const prefix = routePiece(source, startTransfer - direction * fittingRoom, fork);
        if (!prefix.length) continue;
        const run: { rail: RunningRail; step: number }[] = [];
        const visited = new Set<RunningRail>();
        let rail = branch, step = side === 0 ? 1 : -1;
        let merge: NixieSimulationRouteConnectionV1 | undefined;
        let suffix: FoxholeSpatialPoint[] = [];
        while (!visited.has(rail)) {
            visited.add(rail);
            run.push({ rail, step });
            const end = step > 0 ? 1 : 0;
            const index = step > 0 ? rail.points.length - 1 : 0;
            const point = rail.points[index]!, previous = rail.points[index - step]!;
            const socketName = rail.endpointSockets?.[end] ?? '';
            const location = readRailPathSocket(socketName);
            if (location) {
                const target = geometries.find(geometry => geometry.spans.some(entry => entry.rail.entityId === rail.endpointLinks[end]));
                const targetSpan = target?.spans.find(entry => entry.rail.entityId === rail.endpointLinks[end]);
                if (target && targetSpan && targetSpan.step * (location.reverse ? 1 : -1) === direction) {
                    const mergeAt = station(targetSpan, location.fraction);
                    const transfer = mergeAt + direction * (direction > 0 ? handoff.after : handoff.before);
                    if (target.loop || (transfer >= target.first && transfer <= target.last)) {
                        suffix = routePiece(target, mergeAt, transfer + direction * fittingRoom);
                        if (suffix.length) merge = connection(target, targetSpan, socketName, mergeAt, transfer);
                    }
                }
                break;
            }
            const heading = Math.atan2(point[1] - previous[1], point[0] - previous[0]);
            const continuation = railContinuation(rails, rail, step, point, heading, candidate => !used.has(candidate) && !visited.has(candidate));
            if (!continuation?.connected) break;
            rail = continuation.candidate;
            step = continuation.sign;
        }
        const path = makePath(branch.entityId);
        appendRoutePoints(path, direction > 0 ? prefix : [...suffix].reverse());
        const spans = appendRouteSpans(path, direction > 0 ? run : [...run].reverse().map(entry => ({ ...entry, step: -entry.step })));
        appendRoutePoints(path, direction > 0 ? suffix : [...prefix].reverse());
        const length = routeLength(path);
        const from = direction > 0 || merge ? fittingRoom : 0;
        const to = direction < 0 || merge ? length - fittingRoom : length;
        const poses: SimulationFrame[][] = [];
        for (let at = from; at <= to; at += 12) {
            const row = sample(path, at);
            if (row) poses.push(row);
            else if (poses.length || (at === from && (direction > 0 || merge))) break;
        }
        if (poses.length < 2 || (direction < 0 || merge) && poses.at(-1)![0]!.distance < to - 12) continue;
        if (direction < 0 || merge) {
            const endPose = sample(path, to);
            if (!endPose) continue;
            if (poses.at(-1)![0]!.distance < to) poses.push(endPose);
        }
        const firstPose = poses[0]![0]!.distance;
        const junction = connection(source, span, socket, fork, startTransfer);
        const start = direction > 0 ? junction : merge;
        const end = direction > 0 ? merge : junction;
        const routes = result.map((_, vehicle): NixieSimulationRouteV1 => {
            const frames = poses.map(row => row[vehicle]!);
            const indices = simplifyConsistFrames(frames, frames, tolerance);
            return { id: branch.entityId, ...(start ? { start } : {}), ...(end ? { end } : {}),
                sources: [...visited].filter(rail => !rail.fixed).map(rail => rail.entityId),
                ...packRailFrames(indices.map(index => frames[index]!)) };
        });
        const size = encoder.encode(JSON.stringify(routes)).byteLength;
        if (size > remaining || routes.some((route, index) => route.frames.length > NIXIE_SIMULATION_PATH_MAX_FRAMES
            || routingDataBytes([route]) > NIXIE_COMPONENT_MAX_DATA_BYTES
            || routeBank([...result[index]!, route]).length > ROUTING_COMPONENTS.length)) {
            overBudget = true;
            continue;
        }
        remaining -= size;
        routes.forEach((route, index) => result[index]!.push(route));
        for (const rail of visited) used.add(rail);
        geometries.push({ path, spans, first: firstPose, last: poses.at(-1)![0]!.distance, loop: false });
    }
    return { routes: result, overBudget };
}

function routingDataBytes(routes: NixieSimulationRouteV1[]) {
    return new TextEncoder().encode(JSON.stringify({ [NIXIE_SIMULATION_ROUTING_PROPERTY]: { routes } })).byteLength;
}

function routeBank(poses: NixieSimulationRouteV1[]) {
    const banks: NixieSimulationRouteV1[][] = [];
    for (const route of poses) {
        const active = banks.at(-1);
        if (active && routingDataBytes([...active, route]) <= NIXIE_COMPONENT_MAX_DATA_BYTES) active.push(route);
        else banks.push([route]);
    }
    return banks;
}

function routingOperations(entity: Entity, paths: NixieSimulationRouteV1[]): NonNullable<Result['transaction']>['operations'] {
    const banks = routeBank(paths);
    return ROUTING_COMPONENTS.flatMap((componentId, index): NonNullable<Result['transaction']>['operations'] => {
        const routes = banks[index];
        const existing = data(entity, componentId);
        const component = { entityId: entity.entityId, componentId };
        if (!routes) return existing ? [{ ...component, op: 'remove' }] : [];
        const routing = { [NIXIE_SIMULATION_ROUTING_PROPERTY]: validateNixieComponentDataV1(
            NIXIE_SIMULATION_ROUTING_SCHEMA_V1, { routes }) };
        return [existing ? { ...component, op: 'patch', set: routing } : { ...component, op: 'add', data: routing }];
    });
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
    const common = railDrive(engineEntityId, 72_000 + 135_000, 0 - initialDistance, loop);
    const pack = (vehicle: 'engine' | 'cannon', peer: string) => {
        const frames = indices.map(index => pairs[index]![vehicle]);
        const nodes = rest[vehicle].modelNodeTransforms.map((node, index) => ({ name: node.nodeName, index }))
            .filter(({ index }) => frames.some(frame => {
                const node = frame.modelNodeTransforms[index]!;
                return [...node.translation, ...node.rotation].some(value => value !== 0);
            }));
        return {
            ...common, sources: [...sources].filter(id => !rails.find(rail => rail.entityId === id)?.fixed).concat(peer),
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
    const routeBudget = NIXIE_TRANSFORM_FINALIZER_MAX_BYTES
        - encoder.encode(JSON.stringify([engine, cannon])).byteLength - 4096;
    const routes = rails.some(rail => rail.endpointSockets?.some(socket => readRailPathSocket(socket)))
        ? buildConsistRoutes(rails, line ?? openRunningLine(rails, engineStart), engineStart, engine, routeBudget, 2, (path, at) => {
            const location = locationAtStation(path, at);
            const consist = location && findCoupledChassis([path], { ...location, step: 1 }, engineId, { allowExtendedDrawbar: true });
            if (!consist) return;
            const engineFrame = railSimulationFrame(engineId, consist.fixed, at);
            const cannonFrame = railSimulationFrame(cannonId, consist.coupled, at);
            if (engineFrame && cannonFrame) return [engineFrame, cannonFrame];
        }).routes
        : undefined;
    return { location: initial.location, engine, cannon, routes };
}

export function finalizeFoxholeRailVehicleSnap(request: Request): Result {
    const { x, y, rotation } = request.transform;
    const preview = request.preview === true || request.geometryGesture?.phase === 'preview';
    const unchanged: Result = { contractVersion: 1, transform: { x, y } };
    if ((request.movingEntityIds?.length ?? 1) > 1) return unchanged;

    const original = request.context.entities.find(entity => entity.entityId === request.entityId);
    const asset = original && data(original, 'asset');
    const assetId = String(asset?.assetId);
    const gauge = asset?.catalogId === 'foxhole.structures' && vehicleGauge.get(assetId);
    if (!original || !gauge) return unchanged;

    const saved = data(original, ATTACHMENT_COMPONENT);
    const previous = saved?.simulationPath as unknown as NixieSimulationPathV1 | undefined;
    const previousLeader = previous?.drive?.leader;
    const collider = railVehicleCollider(assetId);
    const attachment = (location?: RailLocation, reversed = false, route: string[] = [], simulationPath?: NonNullable<ReturnType<typeof buildTrainDrive>>[number]['path']): Result['transaction'] => {
        if (!location && !saved) return undefined;
        const anchor = location?.rail.fixed ? simulationPath?.sources.find(id =>
            request.context.entities.some(entity => entity.entityId === id && data(entity, 'spline-connector'))) : location?.rail.entityId;
        const fixedRail = location?.rail.fixed ? location.rail.entityId : undefined;
        const set = location && { ...(anchor ? { rail: anchor } : {}), ...(fixedRail ? { fixedRail } : {}),
            station: location.station, reversed, route,
            ...(collider ? { [NIXIE_SIMULATION_COLLIDER_PROPERTY]: collider } : {}),
            ...(simulationPath ? { [NIXIE_SIMULATION_PATH_PROPERTY]: simulationPath } : {}) };
        if (set && saved && saved.rail === anchor && saved.fixedRail === fixedRail && saved.station === set.station && saved.reversed === set.reversed
            && JSON.stringify(saved.route) === JSON.stringify(route)
            && JSON.stringify(saved[NIXIE_SIMULATION_PATH_PROPERTY]) === JSON.stringify(simulationPath)
            && JSON.stringify(saved[NIXIE_SIMULATION_COLLIDER_PROPERTY]) === JSON.stringify(collider)) return undefined;
        const unset = saved && set ? ['rail', 'fixedRail', NIXIE_SIMULATION_PATH_PROPERTY]
            .filter(key => key in saved && !(key in set)) : [];
        return { contractVersion: 1, transactionId: `rail-attachment-${crypto.randomUUID()}`,
            operations: [set
                ? saved ? { op: 'patch', entityId: original.entityId, componentId: ATTACHMENT_COMPONENT, set,
                    ...(unset.length ? { unset } : {}) }
                    : { op: 'add', entityId: original.entityId, componentId: ATTACHMENT_COMPONENT, data: set }
                : { op: 'remove', entityId: original.entityId, componentId: ATTACHMENT_COMPONENT }] };
    };
    const subject = withFoxholeSceneV2TransformProposal(original, request.transform);
    const entities = request.context.entities.map(entity => entity === original ? subject : entity);
    const projection = createFoxholeSpatialProjection(entities);
    const origin = projection.toWorld(subject, [0, 0, 0]);
    const parent = entities.find(entity => entity.entityId === data(subject, 'hierarchy', 'nixie.core')?.parentId);
    const toParent = (point: FoxholeSpatialPoint) => parent ? projection.toLocal(parent, point) : point;
    let best: (RailLocation & { distance: number; heightDifference: number; }) | undefined;

    const rails = sampleRunningRails(request.context, gauge, projection, assets, origin, request.followedEntityId);
    const poweredAssetId = gauge === 'small' ? smallEngineId : engineId;
    const parkedPlan = (vehicle: ParkedRailVehicle | undefined) =>
        vehicle && buildTrainDrive(vehicle, [], rails, vehicle.entity.entityId, { passive: true })?.[0];
    const attachTrain = (location?: RailLocation, step = 1, options?: { requireAdditionalCars?: boolean; portOwnerId?: string; }) => {
        if (preview) return;
        const route = location ? buildRailRoute(assetId, rails, location, step) : [];
        if (gauge === 'crane') return attachment(location, step < 0, route);
        const railData = location && { [location.rail.fixed ? 'fixedRail' : 'rail']: location.rail.entityId,
            station: location.station, reversed: step < 0, route };
        const parkedSubject = railData ? { ...subject, components: [
            ...subject.components.filter(component => component.ownerId !== 'nixie.foxhole-planner' || component.componentId !== ATTACHMENT_COMPONENT),
            { ownerId: 'nixie.foxhole-planner', componentId: ATTACHMENT_COMPONENT, version: 1, definitionAvailable: true, data: railData },
        ] } : undefined;
        const vehicles = entities.map(entity => {
            const candidate = entity === subject ? parkedSubject : entity;
            return candidate && railVehicleAt(candidate, rails);
        })
            .filter((vehicle): vehicle is ParkedRailVehicle => !!vehicle);
        const lead = vehicles.filter(vehicle => vehicle.assetId === poweredAssetId);
        const leaders = assetId === poweredAssetId ? lead.filter(vehicle => vehicle.entity.entityId === subject.entityId) : lead;
        let train: ReturnType<typeof buildTrainDrive>;
        if (location) for (const leader of leaders) {
            train = buildTrainDrive(leader, vehicles, rails, subject.entityId, options);
            if (train) break;
        }
        if (options?.requireAdditionalCars && !train) return;
        const members = new Map(train?.map(member => [member.entity.entityId, member]));
        if (previousLeader && previousLeader !== subject.entityId && !members.has(previousLeader)) {
            const leader = lead.find(vehicle => vehicle.entity.entityId === previousLeader);
            const remaining = vehicles.filter(vehicle => vehicle.entity.entityId !== subject.entityId && !members.has(vehicle.entity.entityId));
            if (leader) for (const member of buildTrainDrive(leader, remaining, rails, previousLeader) ?? []) {
                members.set(member.entity.entityId, member);
            }
        }
        const own = members.get(subject.entityId) ?? parkedPlan(vehicles.find(vehicle => vehicle.entity === parkedSubject));
        const transaction = attachment(location, step < 0, route, own?.path)
            ?? { contractVersion: 1, transactionId: `rail-consist-${crypto.randomUUID()}`, operations: [] };
        const detached: Entity[] = [];
        for (const entity of entities) {
            const member = members.get(entity.entityId);
            const old = data(entity, ATTACHMENT_COMPONENT)?.simulationPath as unknown as NixieSimulationPathV1 | undefined;
            if (entity === subject) {
                transaction.operations.push(...routingOperations(entity, own?.routes ?? []));
            } else if (member) {
                const shape = railVehicleCollider(String(data(entity, 'asset')?.assetId));
                transaction.operations.push({ op: 'patch', entityId: entity.entityId, componentId: ATTACHMENT_COMPONENT,
                    set: { [NIXIE_SIMULATION_PATH_PROPERTY]: member.path,
                        ...(shape ? { [NIXIE_SIMULATION_COLLIDER_PROPERTY]: shape } : {}) } },
                ...routingOperations(entity, member.routes));
            } else if (previousLeader && old?.drive?.leader === previousLeader) {
                detached.push(entity);
            }
        }
        const encoder = new TextEncoder();
        const detachedIds = new Set(detached.map(entity => entity.entityId));
        const outdated = assetId === poweredAssetId && own ? vehicles.filter(vehicle => {
            if (vehicle.assetId === poweredAssetId || members.has(vehicle.entity.entityId) || detachedIds.has(vehicle.entity.entityId)
                || !own.path.sources.includes(vehicle.location.rail.entityId)) return false;
            const saved = data(vehicle.entity, ATTACHMENT_COMPONENT);
            const path = saved?.[NIXIE_SIMULATION_PATH_PROPERTY] as unknown as NixieSimulationPathV1 | undefined;
            const shape = saved?.[NIXIE_SIMULATION_COLLIDER_PROPERTY] as unknown as NixieSimulationColliderV1 | undefined;
            return !path?.drive?.manual || (path.drive.manual.passive && (!shape?.guidedContact?.massKg || !shape.wheelSpan));
        }).map(vehicle => vehicle.entity) : [];
        for (const entity of [...detached, ...outdated]) {
            const passive = parkedPlan(vehicles.find(vehicle => vehicle.entity === entity));
            const shape = railVehicleCollider(String(data(entity, 'asset')?.assetId));
            const patch = { op: 'patch' as const, entityId: entity.entityId, componentId: ATTACHMENT_COMPONENT };
            if (passive) {
                const replacement = [{ ...patch, set: { [NIXIE_SIMULATION_PATH_PROPERTY]: passive.path,
                    ...(shape ? { [NIXIE_SIMULATION_COLLIDER_PROPERTY]: shape } : {}) } },
                    ...routingOperations(entity, passive.routes)];
                if (encoder.encode(JSON.stringify([...transaction.operations, ...replacement])).byteLength
                    < NIXIE_TRANSFORM_FINALIZER_MAX_BYTES - 16_384) {
                    transaction.operations.push(...replacement);
                    continue;
                }
            }
            if (detachedIds.has(entity.entityId)) {
                transaction.operations.push({ ...patch, unset: [NIXIE_SIMULATION_PATH_PROPERTY] }, ...routingOperations(entity, []));
            }
        }
        return transaction.operations.length ? transaction : undefined;
    };
    const detach = (): Result => {
        const transaction = attachTrain();
        return transaction ? { ...unchanged, transaction } : unchanged;
    };
    if (!request.followedEntityId && request.interaction !== 'placement' && request.interaction !== 'planar-translation') {
        return request.interaction === 'transform' && !request.geometryGesture ? detach() : unchanged;
    }
    if (!request.followedEntityId && request.snappingEnabled === false) return detach();
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
        const { local: point, angle } = fitBody(initial.location, initial.location.step);
        if (preview) {
            return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: angle } };
        }
        const extended = attachTrain(initial.location, initial.location.step, { requireAdditionalCars: true, portOwnerId: anchor.entityId });
        if (extended) return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: angle },
            transaction: extended };
        const engineEntityId = assetId === engineId ? original.entityId : anchor.entityId;
        const cannonEntityId = assetId === cannonId ? original.entityId : anchor.entityId;
        const pair = buildRailConsist(rails, directed, anchorAsset, engineEntityId, cannonEntityId);
        if (!pair) return;
        let transaction = attachment(pair.location, pair.location.step < 0,
            buildRailRoute(assetId, rails, pair.location, pair.location.step), assetId === engineId ? pair.engine : pair.cannon);
        const anchorPath = assetId === engineId ? pair.cannon : pair.engine;
        const anchorCollider = railVehicleCollider(anchorAsset);
        if (JSON.stringify(anchorAttachment?.simulationPath) !== JSON.stringify(anchorPath)
            || JSON.stringify(anchorAttachment?.[NIXIE_SIMULATION_COLLIDER_PROPERTY]) !== JSON.stringify(anchorCollider)) {
            transaction ??= { contractVersion: 1, transactionId: `rail-consist-${crypto.randomUUID()}`, operations: [] };
            transaction.operations.push({ op: 'patch', entityId: anchor.entityId, componentId: ATTACHMENT_COMPONENT,
                set: { [NIXIE_SIMULATION_PATH_PROPERTY]: anchorPath,
                    ...(anchorCollider ? { [NIXIE_SIMULATION_COLLIDER_PROPERTY]: anchorCollider } : {}) } });
        }
        for (const [entity, index] of [[original, assetId === engineId ? 0 : 1],
            [anchor, assetId === engineId ? 1 : 0]] as const) {
            const operations = routingOperations(entity, pair.routes?.[index] ?? []);
            if (operations.length) {
                transaction ??= { contractVersion: 1, transactionId: `rail-consist-${crypto.randomUUID()}`, operations: [] };
                transaction.operations.push(...operations);
            }
        }
        return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: angle },
            ...(transaction ? { transaction } : {}) };
    };
    if (request.followedEntityId) {
        if (saved?.rail !== request.followedEntityId || typeof saved.station !== 'number') return unchanged;
        const rail = rails.find(rail => rail.entityId === (saved.fixedRail ?? saved.rail));
        const location = rail && locationAtStation(rail, saved.station);
        if (!location) return unchanged;
        const step = saved.reversed ? -1 : 1;
        const rebuild = request.followPhase === 'commit' && (assetId === poweredAssetId || !previousLeader || previous?.drive?.manual?.passive);
        const { local: point, angle } = fitBody(location, step, rebuild ? undefined : readRailRoute(saved.route, rails));
        const turn = Math.atan2(Math.sin(angle - rotation), Math.cos(angle - rotation));
        const transaction = rebuild ? attachTrain(location, step) : undefined;
        return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: rotation + turn },
            ...(transaction ? { transaction } : {}) };
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
            if (!existingPath?.drive || existingPath.drive.leader === anchor.entityId) {
                const coupled = couple(anchor, anchorAsset as PoweredTestVehicle, 100);
                if (coupled) return coupled;
            }
        }
        const railElevation = anchor ? projection.toWorld(anchor, [0, 0, 0])[2] : source.z ?? origin[2];
        const result = followRailFromCoupler(rails, [source.x, source.y, railElevation], origin);
        if (!result) return unchanged;
        const step = reversed ? -result.step : result.step;
        const { local: point, angle } = fitBody(result, step);
        const transaction = attachTrain(result, step, { portOwnerId: anchor?.entityId });
        return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2],
            rotation: angle }, ...(transaction ? { transaction } : {}) };
    }

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
    const transaction = attachTrain(best, step);
    return { contractVersion: 1, transform: { x: point[0], y: point[1], elevation: point[2], rotation: heading },
        ...(transaction ? { transaction } : {}) };
}
