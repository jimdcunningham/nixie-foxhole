type HitboxPoint = {
    x: number;
    y: number;
};

type DirectedEdge = {
    from: string;
    to: string;
};

const VERTEX_PRECISION = 1_000;

function vertexKey(point: HitboxPoint): string {
    return `${Math.round(point.x * VERTEX_PRECISION)},${Math.round(point.y * VERTEX_PRECISION)}`;
}

function polygonArea(points: readonly HitboxPoint[]): number {
    return points.reduce((area, point, index) => {
        const next = points[(index + 1) % points.length]!;
        return area + (point.x * next.y) - (next.x * point.y);
    }, 0) * 0.5;
}

function removeCollinearVertices(keys: readonly string[], vertices: ReadonlyMap<string, HitboxPoint>): string[] {
    return keys.filter((key, index) => {
        const previous = vertices.get(keys[(index - 1 + keys.length) % keys.length]!);
        const current = vertices.get(key);
        const next = vertices.get(keys[(index + 1) % keys.length]!);
        if (!previous || !current || !next) {
            return true;
        }
        const cross = ((current.x - previous.x) * (next.y - current.y))
            - ((current.y - previous.y) * (next.x - current.x));
        return Math.abs(cross) > 0.000001;
    });
}

/**
 * Converts adjacent clockwise or counter-clockwise polygons into their outside
 * boundary loops. A shared edge is two matching endpoints, regardless of the
 * polygon's winding. Returns null when the input is not a clean mesh.
 */
export function dissolveHitboxPolygons(polygons: readonly number[][]): number[][] | null {
    if (polygons.length < 2 || polygons.some(points => points.length < 6 || points.length % 2 !== 0 || points.some(point => !Number.isFinite(point)))) {
        return null;
    }

    const vertices = new Map<string, HitboxPoint>();
    const edgeCounts = new Map<string, { count: number; edge: DirectedEdge; }>();

    for (const polygon of polygons) {
        const points: HitboxPoint[] = [];
        for (let index = 0; index < polygon.length; index += 2) {
            const point = { x: polygon[index]!, y: polygon[index + 1]! };
            const key = vertexKey(point);
            vertices.set(key, vertices.get(key) ?? point);
            points.push(point);
        }
        if (Math.abs(polygonArea(points)) < Number.EPSILON) {
            return null;
        }
        if (polygonArea(points) < 0) {
            points.reverse();
        }
        for (let index = 0; index < points.length; index += 1) {
            const from = vertexKey(points[index]!);
            const to = vertexKey(points[(index + 1) % points.length]!);
            const key = from < to ? `${from}|${to}` : `${to}|${from}`;
            const entry = edgeCounts.get(key);
            if (entry) {
                entry.count += 1;
            } else {
                edgeCounts.set(key, { count: 1, edge: { from, to } });
            }
        }
    }

    const boundaryEdges = [...edgeCounts.values()];
    if (boundaryEdges.some(entry => entry.count > 2)) {
        return null;
    }
    const remaining = boundaryEdges
        .filter(entry => entry.count === 1)
        .map(entry => entry.edge);
    if (remaining.length < 3) {
        return null;
    }

    const outgoing = new Map<string, DirectedEdge[]>();
    for (const edge of remaining) {
        const edges = outgoing.get(edge.from) ?? [];
        edges.push(edge);
        outgoing.set(edge.from, edges);
    }

    const loops: number[][] = [];
    while (remaining.length > 0) {
        const first = remaining.pop()!;
        const loop = [first.from];
        let edge = first;
        while (true) {
            loop.push(edge.to);
            if (edge.to === first.from) {
                break;
            }
            const candidates = outgoing.get(edge.to) ?? [];
            const nextIndex = candidates.findIndex(candidate => remaining.includes(candidate));
            if (nextIndex < 0) {
                return null;
            }
            edge = candidates[nextIndex]!;
            remaining.splice(remaining.indexOf(edge), 1);
        }
        loop.pop();
        if (loop.length < 3) {
            return null;
        }
        const flattenedLoop = removeCollinearVertices(loop, vertices);
        loops.push(flattenedLoop.flatMap(key => {
            const point = vertices.get(key);
            return point ? [point.x, point.y] : [];
        }));
    }

    return loops.every(points => points.length >= 6) ? loops : null;
}

export function canDissolveHitboxPolygons(polygons: readonly number[][]): boolean {
    const dissolved = dissolveHitboxPolygons(polygons);
    return Boolean(dissolved && dissolved.length < polygons.length);
}

/** @deprecated Use dissolveHitboxPolygons. */
export const dissolveHitboxTriangles = dissolveHitboxPolygons;
/** @deprecated Use canDissolveHitboxPolygons. */
export const canDissolveHitboxTriangles = canDissolveHitboxPolygons;
