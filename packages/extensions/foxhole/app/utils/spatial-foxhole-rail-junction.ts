import { Vector3 } from '@pixi/3d';
import type { Matrix4 } from '@pixi/3d';
import type { SpatialPathCutout } from '#nixie-internal/app/plugins/nixie/scene-v2/spatial-path-model.ts';

type Point = readonly [number, number, number];
export interface SpatialRailDeck {
    points: readonly Point[];
    halfWidth: number;
}
type Plane = readonly [x: number, y: number, grade: number, offset: number];
interface JunctionVolume {
    bounds: readonly [minX: number, minY: number, maxX: number, maxY: number];
    planes: readonly Plane[];
}

const JOIN_HEIGHT_TOLERANCE = 16;
const END_OVERLAP = 2;

function railFootprint(deck: SpatialRailDeck): JunctionVolume[] {
    const points = deck.points.filter((point, i, all) => !i || Math.hypot(point[0] - all[i - 1]![0], point[1] - all[i - 1]![1]) > 1e-6);
    const normals = points.slice(1).map((to, i) => {
        const from = points[i]!;
        const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
        return [-dy / length, dx / length] as const;
    });
    const offsets = points.map((_, i) => {
        const before = normals[i - 1] ?? normals[i]!, after = normals[i] ?? before;
        if (!after) return [0, 0] as const;
        const dot = before[0] * after[0] + before[1] * after[1];
        const scale = deck.halfWidth / Math.max(.5, 1 + dot);
        return [(before[0] + after[0]) * scale, (before[1] + after[1]) * scale] as const;
    });
    return normals.map((_, i) => {
        const [x, y, z] = points[i]!, [endX, endY, endZ] = points[i + 1]!;
        const [sx, sy] = offsets[i]!, [ex, ey] = offsets[i + 1]!;
        const dx = endX - x, dy = endY - y, length = Math.hypot(dx, dy);
        // Overlap terminal seams by a small amount so a cut cannot leave a sliver at the socket.
        const startPadding = i === 0 ? END_OVERLAP / length : 0;
        const endPadding = i === normals.length - 1 ? END_OVERLAP / length : 0;
        const ax = x - dx * startPadding, ay = y - dy * startPadding;
        const bx = endX + dx * endPadding, by = endY + dy * endPadding;
        const corners = [[ax - sx, ay - sy], [bx - ex, by - ey], [bx + ex, by + ey], [ax + sx, ay + sy]];
        const xs = corners.map(p => p[0]!), ys = corners.map(p => p[1]!);
        const planes: Plane[] = corners.map(([ax, ay], j) => {
            const [bx, by] = corners[(j + 1) % corners.length]!;
            const dx = bx! - ax!, dy = by! - ay!;
            return [-dy, dx, 0, dy * ax! - dx * ay!];
        });
        const rise = (endZ - z) / (length * length);
        const zx = dx * rise, zy = dy * rise, base = z - zx * x - zy * y;
        planes.push([-zx, -zy, 1, JOIN_HEIGHT_TOLERANCE - base], [zx, zy, -1, JOIN_HEIGHT_TOLERANCE + base]);
        return { bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], planes };
    });
}

function cutPolygon(polygon: number[][], planes: readonly Plane[]): number[][][] {
    const distance = ([x, y, grade, offset]: Plane, p: number[]) => x * p[13]! + y * p[14]! + grade * p[16]! + offset;
    if (planes.some(plane => polygon.every(point => distance(plane, point) < 0))) return [polygon];
    let inside = polygon;
    const outside: number[][][] = [];
    for (const plane of planes) {
        if (inside.length < 3) break;
        const remaining: number[][] = [], rejected: number[][] = [];
        for (let i = 0; i < inside.length; i++) {
            const a = inside[i]!, b = inside[(i + 1) % inside.length]!;
            const da = distance(plane, a), db = distance(plane, b);
            const aInside = da >= 0, bInside = db >= 0;
            (aInside ? remaining : rejected).push(a);
            if (aInside !== bInside) {
                const t = da / (da - db);
                const crossing = a.map((value, axis) => value + (b[axis]! - value) * t);
                remaining.push(crossing);
                rejected.push(crossing);
            }
        }
        if (rejected.length >= 3) outside.push(rejected);
        inside = remaining;
    }
    return outside;
}

function faceNormal(a: number[], b: number[], c: number[]) {
    const ux = b[13]! - a[13]!, uy = b[14]! - a[14]!, uz = b[15]! - a[15]!;
    const vx = c[13]! - a[13]!, vy = c[14]! - a[14]!, vz = c[15]! - a[15]!;
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] as const;
}

function isDeckTop(face: readonly number[][]): boolean {
    if (!face.every(vertex => vertex[15]! >= vertex[16]! - 1)) return false;
    const [nx, ny, nz] = faceNormal(face[0]!, face[1]!, face[2]!);
    return Math.abs(nz) > Math.hypot(nx, ny);
}

/** Remove buried walls and buttresses in the neighboring deck footprint. Keep the running surface continuous. */
export function createFoxholeRailJunctionCutout(neighbors: readonly SpatialRailDeck[], matrix: Matrix4,
    start: readonly number[], end: readonly number[], preserveDeck: boolean): SpatialPathCutout | undefined {
    const volumes = neighbors.flatMap(railFootprint);
    if (!volumes.length) return undefined;
    const world = new Vector3();
    return (vertices, indices, centerAt) => {
        // Append world XYZ and track grade after the path builder's render attributes and arc weight.
        for (const vertex of vertices) {
            const weight = vertex[12]!;
            const center = centerAt(weight);
            const dx = start[0]! * (1 - weight) + end[0]! * weight;
            const dy = start[1]! * (1 - weight) + end[1]! * weight;
            const dz = start[2]! * (1 - weight) + end[2]! * weight;
            world.set(center[0]! + dx, center[1]! + dy, center[2]! + dz).applyAffineMatrix4(matrix);
            const grade = world.z;
            world.set(vertex[0]! + dx, vertex[1]! + dy, vertex[2]! + dz).applyAffineMatrix4(matrix);
            vertex.push(world.x, world.y, world.z, grade);
        }
        const output: number[][] = [], triangles: number[] = [];
        const mapped = new Map<number[], number>();
        const indexOf = (vertex: number[]) => {
            const existing = mapped.get(vertex);
            if (existing !== undefined) return existing;
            const index = output.length;
            mapped.set(vertex, index);
            output.push(vertex);
            return index;
        };
        for (let i = 0; i < indices.length; i += 3) {
            const face = [vertices[indices[i]!]!, vertices[indices[i + 1]!]!, vertices[indices[i + 2]!]!];
            let pieces = [face];
            if (!preserveDeck || !isDeckTop(face)) {
                const xs = face.map(p => p[13]!), ys = face.map(p => p[14]!);
                const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
                for (const { bounds, planes } of volumes) {
                    if (maxX < bounds[0] || maxY < bounds[1] || minX > bounds[2] || minY > bounds[3]) continue;
                    pieces = pieces.flatMap(piece => cutPolygon(piece, planes));
                    if (pieces.length > 2048) throw new Error('The rail junction exceeds the clipping budget.');
                    if (!pieces.length) break;
                }
            }
            for (const piece of pieces) {
                const a = piece[0]!;
                for (let j = 1; j < piece.length - 1; j++) {
                    const b = piece[j]!, c = piece[j + 1]!;
                    // Two neighboring footprint segments can leave a zero-width polygon on their shared edge.
                    if (piece !== face && Math.hypot(...faceNormal(a, b, c)) < 1e-8) continue;
                    triangles.push(indexOf(a), indexOf(b), indexOf(c));
                }
            }
            if (triangles.length > 600_000 || output.length > 600_000) throw new Error('The rail junction exceeds the geometry budget.');
        }
        return { vertices: output, indices: triangles };
    };
}
