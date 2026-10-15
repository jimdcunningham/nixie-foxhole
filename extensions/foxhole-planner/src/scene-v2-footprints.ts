import type { FoxholeSceneV2Matrix } from './scene-v2-attachments.ts';
import { transformFoxholeSceneV2Point } from './scene-v2-attachments.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';

export interface FoxholeSceneV2Point {
    x: number;
    y: number;
}

export const FOXHOLE_BOARD_UNITS_PER_METRE = 32;
const EPSILON = 1e-7;

export function foxholeFootprintPolygons(
    metadata: Pick<FoxholeSceneV2AssetMetadata, 'footprintPolygons'>,
    matrix?: FoxholeSceneV2Matrix,
): FoxholeSceneV2Point[][] {
    return (metadata.footprintPolygons ?? []).flatMap(({ shape }) => {
        if (shape.length < 6 || shape.length % 2 !== 0 || !shape.every(Number.isFinite)) {
            return [];
        }
        return [Array.from({ length: shape.length / 2 }, (_, index) => {
            const x = shape[index * 2]! * FOXHOLE_BOARD_UNITS_PER_METRE;
            const y = shape[index * 2 + 1]! * FOXHOLE_BOARD_UNITS_PER_METRE;
            return matrix ? transformFoxholeSceneV2Point(matrix, x, y) : { x, y };
        })];
    });
}

export function foxholePointSegmentDistance(point: FoxholeSceneV2Point, start: FoxholeSceneV2Point, end: FoxholeSceneV2Point): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > EPSILON
        ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
        : 0;
    return Math.hypot(point.x - start.x - dx * t, point.y - start.y - dy * t);
}

function orientation(a: FoxholeSceneV2Point, b: FoxholeSceneV2Point, c: FoxholeSceneV2Point): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: FoxholeSceneV2Point, b: FoxholeSceneV2Point, c: FoxholeSceneV2Point, d: FoxholeSceneV2Point): boolean {
    const abC = orientation(a, b, c);
    const abD = orientation(a, b, d);
    const cdA = orientation(c, d, a);
    const cdB = orientation(c, d, b);
    return ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
        && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON));
}

export function foxholeSegmentDistance(
    a: FoxholeSceneV2Point,
    b: FoxholeSceneV2Point,
    c: FoxholeSceneV2Point,
    d: FoxholeSceneV2Point,
): number {
    if (segmentsCross(a, b, c, d)) {
        return 0;
    }
    return Math.min(
        foxholePointSegmentDistance(a, c, d),
        foxholePointSegmentDistance(b, c, d),
        foxholePointSegmentDistance(c, a, b),
        foxholePointSegmentDistance(d, a, b),
    );
}

export function foxholePointInPolygon(
    point: FoxholeSceneV2Point,
    polygon: readonly FoxholeSceneV2Point[],
    includeBoundary = true,
): boolean {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
        const a = polygon[current]!;
        const b = polygon[previous]!;
        if (foxholePointSegmentDistance(point, a, b) <= EPSILON) {
            return includeBoundary;
        }
        if ((a.y > point.y) !== (b.y > point.y)
            && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

export function foxholeLineTouchesPolygon(
    start: FoxholeSceneV2Point,
    end: FoxholeSceneV2Point,
    polygon: readonly FoxholeSceneV2Point[],
    clearance: number,
): boolean {
    if (foxholePointInPolygon(start, polygon) || foxholePointInPolygon(end, polygon)) {
        return true;
    }
    return polygon.some((point, index) => foxholeSegmentDistance(
        start,
        end,
        point,
        polygon[(index + 1) % polygon.length]!,
    ) <= clearance + EPSILON);
}

function polygonCentroid(polygon: readonly FoxholeSceneV2Point[]): FoxholeSceneV2Point {
    return {
        x: polygon.reduce((total, point) => total + point.x, 0) / polygon.length,
        y: polygon.reduce((total, point) => total + point.y, 0) / polygon.length,
    };
}

function edgeMidpoints(polygon: readonly FoxholeSceneV2Point[]): FoxholeSceneV2Point[] {
    return polygon.map((point, index) => {
        const next = polygon[(index + 1) % polygon.length]!;
        return { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
    });
}

/** True only for positive-area contact; shared edges and corners remain valid. */
export function foxholePolygonsOverlap(left: readonly FoxholeSceneV2Point[], right: readonly FoxholeSceneV2Point[]): boolean {
    if (left.some((point, index) => right.some((other, otherIndex) => segmentsCross(
        point,
        left[(index + 1) % left.length]!,
        other,
        right[(otherIndex + 1) % right.length]!,
    )))) {
        return true;
    }
    return [...left, ...edgeMidpoints(left), polygonCentroid(left)].some(point => foxholePointInPolygon(point, right, false))
        || [...right, ...edgeMidpoints(right), polygonCentroid(right)].some(point => foxholePointInPolygon(point, left, false));
}

export function foxholePolygonArea(polygon: readonly FoxholeSceneV2Point[]): number {
    return Math.abs(polygon.reduce((area, point, index) => {
        const next = polygon[(index + 1) % polygon.length]!;
        return area + point.x * next.y - next.x * point.y;
    }, 0) / 2);
}
