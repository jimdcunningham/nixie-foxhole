import type { SplinePathConstraints, SplinePathEndpoint } from '@nixie/extension-sdk/experimental/scene-v2';
export interface ConnectorSplinePathSample {
    points: Array<{ x: number; y: number; }>;
    lengths: number[];
    totalLength: number;
}
import {
    FOXHOLE_PIPE_ROTATION_SNAP_STEP_RAD,
    normalizePipeCurveT,
    snapPipeRotationRadians,
} from './pipe-spline-constraints.ts';
import type { FoxholeConnectorBehaviorSource } from './connector-behavior.ts';
import { resolveConnectorBehavior } from './connector-behavior.ts';

interface Vec2 {
    x: number;
    y: number;
}

export interface PipeExtensionEndpoints {
    start: Vec2;
    depart: Vec2;
    arrive: Vec2;
    end: Vec2;
    extension: number;
}

const EPSILON = 1e-4;
const MIN_MIDDLE_SEGMENT = 8;
const EXTENSION_BUFFER_SCALE = 0.5;
const JUNCTION_LEG_BUDGET = 0.52;
const JUNCTION_RADIUS_CAP = 0.9;
const MIN_JUNCTION_TURN_RAD = (4 * Math.PI) / 180;
const ARC_STEP_DEG = 6;
const MIN_ARC_STEPS = 6;
const MAX_ARC_STEPS = 32;

function normalizeAngleRadians(value: number): number {
    let angle = value;
    while (angle > Math.PI) {
        angle -= Math.PI * 2;
    }
    while (angle < -Math.PI) {
        angle += Math.PI * 2;
    }
    return angle;
}

function normalize(v: Vec2): Vec2 {
    const len = length(v);
    if (len <= EPSILON) {
        return { x: 1, y: 0 };
    }
    return scale(v, 1 / len);
}

function cross(a: Vec2, b: Vec2): number {
    return (a.x * b.y) - (a.y * b.x);
}

function perpendicular(v: Vec2): Vec2 {
    return { x: -v.y, y: v.x };
}

function appendPoint(points: Vec2[], point: Vec2): void {
    const last = points[points.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) <= EPSILON) {
        return;
    }
    points.push(point);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v: Vec2, scalar: number): Vec2 {
    return { x: v.x * scalar, y: v.y * scalar };
}

function length(v: Vec2): number {
    return Math.hypot(v.x, v.y);
}

function dot(a: Vec2, b: Vec2): number {
    return (a.x * b.x) + (a.y * b.y);
}

function direction(rotation: number): Vec2 {
    return { x: Math.cos(rotation), y: Math.sin(rotation) };
}

function endpointToPoint(endpoint: SplinePathEndpoint): Vec2 {
    return { x: endpoint.x, y: endpoint.y };
}

function snapRoutingEndpoint(endpoint: SplinePathEndpoint): SplinePathEndpoint {
    return {
        ...endpoint,
        rotation: snapPipeRotationRadians(endpoint.rotation, FOXHOLE_PIPE_ROTATION_SNAP_STEP_RAD),
    };
}

export function enforceRigidPipeEndpoints(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
): { start: SplinePathEndpoint; end: SplinePathEndpoint; } {
    const snappedStart = snapRoutingEndpoint(start);
    const snappedEnd = snapRoutingEndpoint(end);
    const chord = sub(endpointToPoint(snappedEnd), endpointToPoint(snappedStart));
    const chordLength = length(chord);
    if (chordLength <= EPSILON) {
        return { start: snappedStart, end: snappedEnd };
    }

    const chordDir = scale(chord, 1 / chordLength);
    const startDir = direction(snappedStart.rotation);
    const endDir = direction(snappedEnd.rotation);
    let nextStartRotation = snappedStart.rotation;
    let nextEndRotation = snappedEnd.rotation;

    if (dot(startDir, chordDir) < 0) {
        nextStartRotation = snapPipeRotationRadians(
            snappedStart.rotation + Math.PI,
            FOXHOLE_PIPE_ROTATION_SNAP_STEP_RAD,
        );
    }

    if (dot(endDir, chordDir) < 0) {
        nextEndRotation = snapPipeRotationRadians(
            snappedEnd.rotation + Math.PI,
            FOXHOLE_PIPE_ROTATION_SNAP_STEP_RAD,
        );
    }

    return {
        start: { ...snappedStart, rotation: nextStartRotation },
        end: { ...snappedEnd, rotation: nextEndRotation },
    };
}

export function resolveConnectorExtensionLength(constraints: SplinePathConstraints): number {
    return Math.max(0, (constraints.maxBuffer ?? 0) * EXTENSION_BUFFER_SCALE);
}

export function resolveExtensionEndpoints(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints = {},
): PipeExtensionEndpoints {
    const startPoint = endpointToPoint(start);
    const endPoint = endpointToPoint(end);
    const startDir = direction(start.rotation);
    const endDir = direction(end.rotation);
    const requestedExtension = resolveConnectorExtensionLength(constraints);
    const minMiddle = Math.max(1, constraints.minLength ? constraints.minLength * 0.1 : MIN_MIDDLE_SEGMENT);

    let extension = requestedExtension;
    let depart = add(startPoint, scale(startDir, extension));
    let arrive = add(endPoint, scale(endDir, extension));

    while (extension > EPSILON && length(sub(arrive, depart)) < minMiddle) {
        extension *= 0.5;
        depart = add(startPoint, scale(startDir, extension));
        arrive = add(endPoint, scale(endDir, extension));
    }

    if (length(sub(arrive, depart)) < minMiddle) {
        extension = 0;
        depart = startPoint;
        arrive = endPoint;
    }

    return {
        start: startPoint,
        depart,
        arrive,
        end: endPoint,
        extension,
    };
}

function resolveSignedTurn(inDir: Vec2, outDir: Vec2): number {
    return Math.atan2(cross(inDir, outDir), dot(inDir, outDir));
}

function resolveJunctionFilletRadius(
    turnMagnitude: number,
    incomingLength: number,
    outgoingLength: number,
): number {
    const legBudget = Math.min(incomingLength, outgoingLength) * JUNCTION_LEG_BUDGET;
    if (legBudget <= EPSILON) {
        return 0;
    }

    const geometricMax = legBudget / Math.max(Math.tan(turnMagnitude * 0.5), EPSILON);
    if (!Number.isFinite(geometricMax) || geometricMax <= EPSILON) {
        return 0;
    }

    return Math.min(geometricMax, legBudget * JUNCTION_RADIUS_CAP);
}

function sampleArc(
    center: Vec2,
    radius: number,
    startAngle: number,
    sweep: number,
    points: Vec2[],
): void {
    const steps = clamp(
        Math.ceil(Math.abs(sweep) / ((ARC_STEP_DEG * Math.PI) / 180)),
        MIN_ARC_STEPS,
        MAX_ARC_STEPS,
    );

    for (let index = 1; index <= steps; index += 1) {
        const angle = startAngle + ((sweep * index) / steps);
        appendPoint(points, {
            x: center.x + (Math.cos(angle) * radius),
            y: center.y + (Math.sin(angle) * radius),
        });
    }
}

interface JunctionFillet {
    arcStart: Vec2;
    arcEnd: Vec2;
    center: Vec2;
    radius: number;
    startAngle: number;
    sweep: number;
}

function buildJunctionFillet(
    corner: Vec2,
    incoming: Vec2,
    outgoing: Vec2,
): JunctionFillet | null {
    const incomingLength = length(incoming);
    const outgoingLength = length(outgoing);
    if (incomingLength <= EPSILON || outgoingLength <= EPSILON) {
        return null;
    }

    const inDir = normalize(incoming);
    const outDir = normalize(outgoing);
    const signedTurn = resolveSignedTurn(inDir, outDir);
    const turnMagnitude = Math.abs(signedTurn);
    if (turnMagnitude <= MIN_JUNCTION_TURN_RAD) {
        return null;
    }

    const radius = resolveJunctionFilletRadius(
        turnMagnitude,
        incomingLength,
        outgoingLength,
    );
    if (radius <= EPSILON) {
        return null;
    }

    const tangent = radius * Math.tan(turnMagnitude * 0.5);
    const incomingTangent = Math.min(tangent, incomingLength * 0.98);
    const outgoingTangent = Math.min(tangent, outgoingLength * 0.98);
    if (incomingTangent <= EPSILON || outgoingTangent <= EPSILON) {
        return null;
    }

    const arcStart = sub(corner, scale(inDir, incomingTangent));
    const arcEnd = add(corner, scale(outDir, outgoingTangent));
    const turnSign = Math.sign(signedTurn) || 1;
    const interiorNormal = scale(perpendicular(inDir), turnSign);
    const center = add(arcStart, scale(interiorNormal, radius));
    const startAngle = Math.atan2(arcStart.y - center.y, arcStart.x - center.x);
    const endAngle = Math.atan2(arcEnd.y - center.y, arcEnd.x - center.x);
    let sweep = normalizeAngleRadians(endAngle - startAngle);
    if (turnSign > 0 && sweep < 0) {
        sweep += Math.PI * 2;
    } else if (turnSign < 0 && sweep > 0) {
        sweep -= Math.PI * 2;
    }

    return {
        arcStart,
        arcEnd,
        center,
        radius,
        startAngle,
        sweep,
    };
}

function appendJunctionFillet(points: Vec2[], fillet: JunctionFillet): void {
    appendPoint(points, fillet.arcStart);
    sampleArc(fillet.center, fillet.radius, fillet.startAngle, fillet.sweep, points);
    appendPoint(points, fillet.arcEnd);
}

function sampleExtensionPathWithJunctionFillets(
    start: Vec2,
    depart: Vec2,
    arrive: Vec2,
    end: Vec2,
): Vec2[] {
    const departFillet = buildJunctionFillet(
        depart,
        sub(depart, start),
        sub(arrive, depart),
    );
    const arriveIncoming = departFillet
        ? sub(arrive, departFillet.arcEnd)
        : sub(arrive, depart);
    const arriveFillet = buildJunctionFillet(
        arrive,
        arriveIncoming,
        sub(end, arrive),
    );

    const points: Vec2[] = [start];

    if (departFillet) {
        appendJunctionFillet(points, departFillet);
    } else {
        appendPoint(points, depart);
    }

    if (arriveFillet) {
        appendJunctionFillet(points, arriveFillet);
    } else {
        appendPoint(points, arrive);
    }

    appendPoint(points, end);
    return points;
}

function densifySegment(from: Vec2, to: Vec2, targetStep = 4): Vec2[] {
    const segmentLength = length(sub(to, from));
    if (segmentLength <= EPSILON) {
        return [from];
    }

    const steps = Math.max(1, Math.ceil(segmentLength / targetStep));
    const points: Vec2[] = [];
    for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        points.push({
            x: from.x + ((to.x - from.x) * t),
            y: from.y + ((to.y - from.y) * t),
        });
    }
    return points;
}

function densifyPath(points: readonly Vec2[], targetStep = 4): Vec2[] {
    if (!points.length) {
        return [];
    }
    if (points.length === 1) {
        return [{ x: points[0]!.x, y: points[0]!.y }];
    }

    const densified: Vec2[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        appendSegment(densified, densifySegment(points[index]!, points[index + 1]!, targetStep));
    }
    return densified;
}

function appendSegment(points: Vec2[], segment: Vec2[]): void {
    for (const point of segment) {
        const last = points[points.length - 1];
        if (last && Math.hypot(point.x - last.x, point.y - last.y) <= EPSILON) {
            continue;
        }
        points.push(point);
    }
}

function buildArcLengthTable(points: readonly Vec2[]): number[] {
    if (!points.length) {
        return [];
    }

    const lengths = [0];
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1]!;
        const current = points[index]!;
        lengths.push(lengths[index - 1]! + Math.hypot(current.x - previous.x, current.y - previous.y));
    }
    return lengths;
}

function toPathSample(points: readonly Vec2[]): ConnectorSplinePathSample {
    const lengths = buildArcLengthTable(points);
    return {
        points: points.map(point => ({ x: point.x, y: point.y })),
        lengths,
        totalLength: lengths[lengths.length - 1] ?? 0,
    };
}

function samplePointAtNormalizedLength(sample: ConnectorSplinePathSample, t: number): Vec2 {
    const clamped = clamp(t, 0, 1);
    const target = clamped * sample.totalLength;
    for (let index = 1; index < sample.lengths.length; index += 1) {
        const endDistance = sample.lengths[index]!;
        if (target > endDistance && index < sample.lengths.length - 1) {
            continue;
        }

        const startDistance = sample.lengths[index - 1]!;
        const from = sample.points[index - 1]!;
        const to = sample.points[index]!;
        const span = Math.max(EPSILON, endDistance - startDistance);
        const localT = clamp((target - startDistance) / span, 0, 1);
        return {
            x: from.x + ((to.x - from.x) * localT),
            y: from.y + ((to.y - from.y) * localT),
        };
    }

    const last = sample.points[sample.points.length - 1] ?? { x: 0, y: 0 };
    return { x: last.x, y: last.y };
}

export function usesPipeExtensionPath(
    pathStyle?: string,
    foxholeKey?: string,
    connector?: FoxholeConnectorBehaviorSource | null,
): boolean {
    return pathStyle === 'spline' && resolveConnectorBehavior(foxholeKey, connector).pipeExtension;
}

export function sampleExtensionPipePath(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
): ConnectorSplinePathSample {
    const { start: startPoint, depart, arrive, end: endPoint } = resolveExtensionEndpoints(start, end, constraints);
    const path = sampleExtensionPathWithJunctionFillets(
        startPoint,
        depart,
        arrive,
        endPoint,
    );

    return toPathSample(densifyPath(path));
}

export function isExtensionPipeGeometryViable(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
): boolean {
    const { depart, arrive } = resolveExtensionEndpoints(start, end, constraints);
    const minMiddle = Math.max(1, constraints.minLength ? constraints.minLength * 0.1 : MIN_MIDDLE_SEGMENT);
    return length(sub(arrive, depart)) + EPSILON >= minMiddle;
}

export function blendConnectorPathSamples(
    rigid: ConnectorSplinePathSample,
    curved: ConnectorSplinePathSample,
    curveT: number,
): ConnectorSplinePathSample {
    const blendT = normalizePipeCurveT(curveT);
    const easedBlend = blendT * blendT;
    if (easedBlend <= 0) {
        return rigid;
    }
    if (easedBlend >= 1) {
        return curved;
    }

    const steps = Math.max(
        32,
        Math.ceil(Math.max(rigid.totalLength, curved.totalLength) / 4),
    );
    const points: Vec2[] = [];
    for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const rigidPoint = samplePointAtNormalizedLength(rigid, t);
        const curvedPoint = samplePointAtNormalizedLength(curved, t);
        points.push({
            x: rigidPoint.x + ((curvedPoint.x - rigidPoint.x) * easedBlend),
            y: rigidPoint.y + ((curvedPoint.y - rigidPoint.y) * easedBlend),
        });
    }

    return toPathSample(points);
}
