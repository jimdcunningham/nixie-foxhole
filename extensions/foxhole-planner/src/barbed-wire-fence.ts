import { buildArcLengthTable } from '@nixie/extension-sdk/experimental/scene-v2';
import type { SplinePathConstraints, SplinePathEndpoint } from '@nixie/extension-sdk/experimental/scene-v2';
import type { ConnectorSplinePathSample } from './spline-ribbon-mesh.ts';

export function isBarbedWireFence(key?: string): boolean {
    return String(key ?? '').trim().toLowerCase() === 'barbedwirewallspline';
}

/** Two rigid end sections meet a straight section between the fence's bends. */
export function sampleBarbedWireFencePath(start: SplinePathEndpoint, end: SplinePathEndpoint,
    constraints: SplinePathConstraints): ConnectorSplinePathSample {
    const chord = Math.hypot(end.x - start.x, end.y - start.y);
    const maximum = Math.min(constraints.maxBuffer ?? 128, chord * 0.45);
    const minimum = Math.min(32, maximum);
    const curve = Math.max(0, Math.min(1, constraints.curveT ?? 0));
    const handle = (endpoint: SplinePathEndpoint) => Math.max(minimum,
        Math.min(maximum, endpoint.handleLength ?? minimum + (maximum - minimum) * curve));
    const a = handle(start), b = handle(end);
    const points = [
        { x: start.x, y: start.y },
        { x: start.x + Math.cos(start.rotation) * a, y: start.y + Math.sin(start.rotation) * a },
        { x: end.x - Math.cos(end.rotation) * b, y: end.y - Math.sin(end.rotation) * b },
        { x: end.x, y: end.y },
    ];
    const lengths = buildArcLengthTable(points);
    return { points, lengths, totalLength: lengths.at(-1) ?? 0 };
}

/** Retain a post at each bend and repeat native 220 cm posts inside each section. */
export function resolveBarbedWireFencePosts(path: ConnectorSplinePathSample, config?: { interval?: number; }) {
    const spacing = Math.max(8, (Number(config?.interval) > 0 ? Number(config?.interval) : 220) * 0.32);
    const posts: Array<{ x: number; y: number; rotation: number; bend: boolean; }> = [];
    for (let index = 1; index < path.points.length; index++) {
        const start = path.points[index - 1]!, end = path.points[index]!;
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length <= 1e-6) continue;
        const rotation = Math.atan2(end.y - start.y, end.x - start.x);
        for (let repeat = 1; repeat <= 64 && repeat * spacing < length - 1e-6; repeat++) {
            const fraction = repeat * spacing / length;
            posts.push({ x: start.x + (end.x - start.x) * fraction,
                y: start.y + (end.y - start.y) * fraction, rotation, bend: false });
        }
        if (index < path.points.length - 1) {
            const next = path.points[index + 1]!;
            posts.push({ ...end, rotation: index === path.points.length - 2
                ? Math.atan2(next.y - end.y, next.x - end.x) : rotation, bend: true });
        }
    }
    return posts;
}
