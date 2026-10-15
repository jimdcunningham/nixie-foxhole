import { samplePointAlongSplinePath } from '@nixie/extension-sdk/experimental/scene-v2';
import type { ConnectorSplinePathSample } from './spline-ribbon-mesh.ts';
import { usesRailTrackSpline } from './spline-connector.ts';

const RAISED_SPLINE_KEYS = new Set([
    'barbedwirespline',
    'facilitycatwalkbridge',
    'facilitypipe',
    'facilitypipeoverhead',
    'fieldbridge',
    'fieldpier',
    'tankstopsplinet3',
    'wallsplinet1',
    'wallsplinet2',
    'wallsplinet3',
]);

export function hasSplineContactShadow(foxholeKey: string): boolean {
    const key = foxholeKey.trim().toLowerCase();
    return usesRailTrackSpline(key) || RAISED_SPLINE_KEYS.has(key);
}

export interface SplineContactShadowPath {
    points: Array<{ x: number; y: number; }>;
    width: number;
    offset: number;
}

/** The shadow uses the same trimmed centerline and cross-section as the visible ribbon. */
export function resolveSplineContactShadowPath(
    sampled: ConnectorSplinePathSample,
    spanHeight: number,
    spriteScale: number,
    startInset = 0,
    endInset = 0,
): SplineContactShadowPath | null {
    const width = spanHeight * spriteScale;
    const start = Math.max(0, startInset);
    const end = Math.min(sampled.totalLength, sampled.totalLength - Math.max(0, endInset));
    if (!Number.isFinite(width) || width <= 0 || end - start <= 0.001) {
        return null;
    }

    const first = samplePointAlongSplinePath(sampled.points, sampled.lengths, start);
    const last = samplePointAlongSplinePath(sampled.points, sampled.lengths, end);
    if (!first || !last) {
        return null;
    }

    const points = [{ x: first.x, y: first.y }];
    for (let index = 1; index < sampled.points.length - 1; index += 1) {
        const distance = sampled.lengths[index] ?? 0;
        if (distance > start && distance < end) {
            points.push(sampled.points[index]!);
        }
    }
    points.push({ x: last.x, y: last.y });

    return {
        points,
        width,
        offset: Math.max(2, Math.min(6, width * 0.06)),
    };
}
