import { buildSplineRibbonMeshData } from '../../../../../../../extensions/foxhole-planner/src/spline-ribbon-mesh.ts';
import type { BuildSplineRibbonMeshOptions } from '../../../../../../../extensions/foxhole-planner/src/spline-ribbon-mesh.ts';
import type { SplinePathConstraints, SplinePathEndpoint } from '@nixie/extension-sdk/experimental/scene-v2';

export const REFERENCE_ROAD_SPLINE_KEYS: ReadonlySet<string> = new Set([
    'dirtroad', 'gravelroad', 'greatmarchroad', 'packeddirtroad',
    'snowdirtroad', 'snowgravelroad', 'snowpackeddirtroad',
]);

export function isReferenceRoadSplineKey(resolvedKey: string | undefined): boolean {
    return REFERENCE_ROAD_SPLINE_KEYS.has(String(resolvedKey ?? '').trim().toLowerCase());
}

interface Point { x: number; y: number; }
const EPSILON = 0.001; // Below a Float32 ribbon vertex's precision at normal road lengths.

function cross(a: Point, b: Point, c: Point): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
    if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPSILON
        || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPSILON
        || Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPSILON
        || Math.max(c.y, d.y) < Math.min(a.y, b.y) - EPSILON) return false;
    const abC = cross(a, b, c), abD = cross(a, b, d);
    const cdA = cross(c, d, a), cdB = cross(c, d, b);
    return abC * abD <= 0 && cdA * cdB <= 0;
}

/** Check the rendered strip, including its full native width and asymmetric offset.
 * Only interactive board edits call this: saved/imported/remote/Undo state is untouched.
 */
export function isWorldRoadEditCandidateValid(
    resolvedKey: string | undefined,
    options: BuildSplineRibbonMeshOptions | undefined,
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
): boolean {
    if (!isReferenceRoadSplineKey(resolvedKey)) return true;
    if (!options || !Number.isFinite(options.spanLayer.height) || Number(options.spanLayer.height) <= 0) return false;
    if ([start.x, start.y, start.rotation, end.x, end.y, end.rotation].some(value => !Number.isFinite(value))) return false;
    if (options.pathSample && (!Number.isFinite(options.pathSample.totalLength)
        || options.pathSample.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) return false;
    const data = buildSplineRibbonMeshData(options, start, end, constraints);
    if (!data || [...data.positions].some(value => !Number.isFinite(value))) return false;
    const sections = Array.from({ length: data.positions.length / 4 }, (_, i) => ({
        left: { x: data.positions[i * 4]!, y: data.positions[i * 4 + 1]! },
        right: { x: data.positions[i * 4 + 2]!, y: data.positions[i * 4 + 3]! },
    }));
    const duplicate = (a: typeof sections[number], b: typeof a) => (
        Math.hypot(a.left.x - b.left.x, a.left.y - b.left.y) <= EPSILON
        && Math.hypot(a.right.x - b.right.x, a.right.y - b.right.y) <= EPSILON
    );
    // The renderer may append the final cross-section a second time after its sampling loop.
    if (sections.length > 2 && duplicate(sections.at(-1)!, sections.at(-2)!)) sections.pop();
    if (sections.length < 2) return false;
    for (let i = 1; i < sections.length; i++) {
        const a = sections[i - 1]!, b = sections[i]!;
        // Positive winding is the current renderer's order for both triangles of each cell.
        if (duplicate(a, b) || cross(a.left, a.right, b.left) <= 0
            || cross(a.right, b.right, b.left) <= 0) return false;
    }
    const boundary = [...sections.map(section => section.left), ...sections.map(section => section.right).reverse()];
    for (let i = 0; i < boundary.length; i++) {
        for (let j = i + 2; j < boundary.length; j++) {
            if (i === 0 && j === boundary.length - 1) continue; // Adjacent closing edges.
            if (intersects(boundary[i]!, boundary[(i + 1) % boundary.length]!,
                boundary[j]!, boundary[(j + 1) % boundary.length]!)) return false;
        }
    }
    return true;
}
