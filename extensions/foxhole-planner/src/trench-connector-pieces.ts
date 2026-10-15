import type { TrenchEndpoint, TrenchLayerFrame } from './trench-connector.ts';
import { trenchConnectorCorners, trenchLayerQuad } from './trench-connector.ts';

export interface TrenchPieceFrame extends TrenchLayerFrame { textureUrl: string; }
export interface TrenchPiece {
    id: string;
    textureUrl: string;
    positions: number[];
    uvs: number[];
    alpha: number;
    shadowClips?: readonly (readonly Point[])[];
}
export interface Point { x: number; y: number; }

/** Reach beneath the end-wall centre; protruding details are not its solid face. */
export function trenchFloorEndCorners(start: TrenchEndpoint, end: TrenchEndpoint, layers: readonly TrenchPieceFrame[], startConnected = false, endConnected = false): Point[] {
    const extend = (endpoint: TrenchEndpoint, back: boolean, connected: boolean): TrenchEndpoint => {
        const wall = layers.find(layer => layer.id === (back ? 'wallback' : 'wallfront'));
        if (!wall || connected) return endpoint;
        const quad = trenchLayerQuad(wall, start, end);
        const along = quad.filter((_, i) => i % 2 === 0).map((x, i) =>
            (x - endpoint.x) * Math.cos(endpoint.rotation) + (quad[i * 2 + 1]! - endpoint.y) * Math.sin(endpoint.rotation));
        const wallCenter = (Math.min(...along) + Math.max(...along)) / 2;
        const distance = back ? Math.min(0, wallCenter - 1) : Math.max(0, wallCenter + 1);
        return { ...endpoint, x: endpoint.x + Math.cos(endpoint.rotation) * distance, y: endpoint.y + Math.sin(endpoint.rotation) * distance };
    };
    return trenchConnectorCorners(extend(start, true, startConnected), extend(end, false, endConnected));
}

export function trenchFloorPolygon(start: TrenchEndpoint, end: TrenchEndpoint, layers: readonly TrenchPieceFrame[], startConnected = false, endConnected = false): Point[] {
    const extended = trenchFloorEndCorners(start, end, layers, startConnected, endConnected);
    if ((!pieceFrame(layers, 'TrenchT2ShortSpline01') && !pieceFrame(layers, 'TrenchT3Short02')) || (startConnected && endConnected)) return extended;
    // Rotated end extensions also move sideways. Preserve the original corners
    // so extending beneath an end wall cannot cut away floor along a side wall.
    const points = [...trenchConnectorCorners(start, end), ...extended].sort((a, b) => a.x - b.x || a.y - b.y);
    const half = (input: readonly Point[]) => {
        const hull: Point[] = [];
        for (const p of input) {
            while (hull.length >= 2) {
                const a = hull[hull.length - 2]!, b = hull[hull.length - 1]!;
                if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 1e-7) break;
                hull.pop();
            }
            hull.push(p);
        }
        return hull.slice(0, -1);
    };
    return [...half(points), ...half([...points].reverse())];
}

export function offsetEndpoint(p: TrenchEndpoint, across: number, along = 0): Point {
    return { x: p.x + Math.cos(p.rotation) * along - Math.sin(p.rotation) * across,
        y: p.y + Math.sin(p.rotation) * along + Math.cos(p.rotation) * across };
}

export function trenchRoofPolygon(start: TrenchEndpoint, end: TrenchEndpoint): Point[] {
    const length = Math.hypot(end.x - start.x, end.y - start.y), angle = Math.atan2(end.y - start.y, end.x - start.x);
    const convergence = Math.abs(Math.sin(start.rotation - angle) - Math.sin(end.rotation - angle));
    // The roof overhang is wider than the trench. At minimum length and opposing
    // 45-degree handles its inner corners would cross; trim only that overhang.
    const width = convergence > 1e-6 ? Math.min(58.1, Math.max(0, length - 0.5) / convergence) : 58.1;
    return [offsetEndpoint(start, -width), offsetEndpoint(end, -width), offsetEndpoint(end, width), offsetEndpoint(start, width)];
}

export function polygonCentroid(points: readonly Point[]): Point {
    let area = 0, x = 0, y = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!, b = points[(i + 1) % points.length]!;
        const cross = a.x * b.y - b.x * a.y;
        area += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross;
    }
    return Math.abs(area) > 1e-6 ? { x: x / (3 * area), y: y / (3 * area) }
        : { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
}

/** Planar UVs: the image centre is at the polygon's area centroid, at native scale. */
export function centeredPolygonUvs(points: readonly Point[], width: number, height: number, rotation: number, center = polygonCentroid(points)): number[] {
    const c = Math.cos(rotation), s = Math.sin(rotation);
    return points.flatMap(p => [0.5 + ((p.x - center.x) * c + (p.y - center.y) * s) / width,
        0.5 + (-(p.x - center.x) * s + (p.y - center.y) * c) / height]);
}

/** Clip geometry and UVs together; never resize the remaining part of a native mesh. */
export function clipPiece(piece: TrenchPiece, polygon: readonly Point[]): TrenchPiece {
    let vertices = piece.uvs.filter((_, i) => i % 2 === 0).map((_, i) => ({
        x: piece.positions[i * 2]!, y: piece.positions[i * 2 + 1]!, u: piece.uvs[i * 2]!, v: piece.uvs[i * 2 + 1]!,
    }));
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
        const distance = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        const input = vertices;
        vertices = [];
        for (let j = 0; j < input.length; j++) {
            const p = input[j]!, q = input[(j + 1) % input.length]!;
            const dp = distance(p), dq = distance(q);
            if (dp >= -1e-7) vertices.push(p);
            if ((dp >= 0) !== (dq >= 0)) {
                const t = dp / (dp - dq);
                vertices.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y), u: p.u + t * (q.u - p.u), v: p.v + t * (q.v - p.v) });
            }
        }
    }
    return { ...piece, shadowClips: [...piece.shadowClips ?? [], polygon], positions: vertices.flatMap(p => [p.x, p.y]), uvs: vertices.flatMap(p => [p.u, p.v]) };
}

export function nativePiece(frame: TrenchPieceFrame, id: string, origin: Point, rotation: number, alpha = 1): TrenchPiece {
    const w = (frame.width ?? 0) / 2, h = (frame.height ?? 0) / 2;
    const x = (frame.offsetX ?? 0) / 2 - w * (frame.anchorX ?? 0.5);
    const y = (frame.offsetY ?? 0) / 2 - h * (frame.anchorY ?? 0.5);
    const c = Math.cos(rotation), s = Math.sin(rotation);
    return { id, textureUrl: frame.textureUrl, alpha, uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        positions: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].flatMap(([a, b]) => [origin.x + c * a! - s * b!, origin.y + s * a! + c * b!]) };
}

export function pieceFrame(layers: readonly TrenchPieceFrame[], name: string): TrenchPieceFrame | undefined {
    return layers.find(layer => layer.id === `piece-${name.toLowerCase()}`);
}

/** Rigid instances along a straight side spline (blueprints ignore target angle). */
export function intervalPieces(frames: readonly TrenchPieceFrame[], id: string, a: Point, b: Point, interval: number,
    options: { start?: number; end?: number; center?: boolean; fromEnd?: boolean; even?: boolean; max?: number; alpha?: number } = {}): TrenchPiece[] {
    if (!frames.length || interval <= 0) return [];
    const length = Math.hypot(b.x - a.x, b.y - a.y), rotation = Math.atan2(b.y - a.y, b.x - a.x);
    const start = options.start ?? 0, end = options.end ?? 0;
    const available = length - start - end;
    if (available < 0) return [];
    const count = Math.min(options.max ?? 64, Math.floor((available + 1e-7) / interval) + 1);
    const step = options.even && count > 1 ? available / (count - 1) : interval;
    const first = start + (options.center ? (available - step * (count - 1)) / 2 : 0);
    const distance = (i: number) => options.fromEnd ? length - first - i * step : first + i * step;
    return Array.from({ length: count }, (_, i) => nativePiece(frames[i % frames.length]!, `${id}:${i}`,
        { x: a.x + Math.cos(rotation) * (distance(i)), y: a.y + Math.sin(rotation) * (distance(i)) }, rotation, options.alpha));
}

/** Anchor native-size repeats at the connector start, independently of mesh facing. */
export function stripPieces(frame: TrenchPieceFrame, id: string, a: Point, b: Point, alpha = 1, repeatDistance?: number, fromEnd = false, centered = false): TrenchPiece[] {
    const length = Math.hypot(b.x - a.x, b.y - a.y), angle = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(angle), s = Math.sin(angle), w = (frame.width ?? 0) / 2;
    if (w <= 0 || length < 1e-6) return [];
    const left = (frame.offsetX ?? 0) / 2 - w * (frame.anchorX ?? 0.5);
    const polygon = [{ x: a.x + s * 500, y: a.y - c * 500 }, { x: b.x + s * 500, y: b.y - c * 500 },
        { x: b.x - s * 500, y: b.y + c * 500 }, { x: a.x - s * 500, y: a.y + c * 500 }];
    const step = Math.max(1, repeatDistance ?? w);
    const count = Math.min(64, Math.max(1, Math.ceil((length - w) / step) + 1));
    const first = centered ? (length - (w + (count - 1) * step)) / 2 : 0;
    const distance = (i: number) => fromEnd ? length - w - first - i * step : first + i * step;
    return Array.from({ length: count }, (_, i) => clipPiece(nativePiece(frame, `${id}:${i}`,
        { x: a.x + c * (distance(i) - left), y: a.y + s * (distance(i) - left) }, angle, alpha), polygon));
}

export function trenchWallPieces(layers: readonly TrenchPieceFrame[], start: TrenchEndpoint, end: TrenchEndpoint, startConnected = false, endConnected = false): TrenchPiece[] {
    const tier = pieceFrame(layers, 'TrenchT3Short02') ? 3 : pieceFrame(layers, 'TrenchT2ShortSpline01') ? 2 : 1;
    const result: TrenchPiece[] = [];
    const floor = trenchFloorEndCorners(start, end, layers, startConnected, endConnected);
    for (const side of [-1, 1]) {
        const a = offsetEndpoint(side < 0 ? end : start, side * 48);
        const b = offsetEndpoint(side < 0 ? start : end, side * 48);
        const wall = pieceFrame(layers, tier === 1 ? 'TrenchT1Short01' : tier === 2 ? 'TrenchT2ShortSpline01' : 'TrenchT3Short02');
        const dirt = tier === 3 ? pieceFrame(layers, 'TrenchT3ShortSpline01') : undefined;
        // The dirt mesh includes a tapered edge beyond its 400cm repeat, so the
        // authored interval deliberately overlaps adjacent native instances.
        if (dirt) result.push(...stripPieces(dirt, `dirt:${side}`, a, b, 1, 128, side < 0));
        if (wall) {
            const pieces = stripPieces(wall, `wall:${side}`, a, b, 1, undefined, side < 0);
            const length = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / length, s = (b.y - a.y) / length;
            const project = (p: Point) => (p.x - a.x) * c + (p.y - a.y) * s;
            const min = Math.min(0, project(floor[side < 0 ? 1 : 3]!));
            const max = Math.max(length, project(floor[side < 0 ? 0 : 2]!));
            const point = (along: number, across: number) => ({ x: a.x + c * along - s * across, y: a.y + s * along + c * across });
            // Keep surface cuts at the sockets, but let the padded contact
            // shadow reach the floor beneath the recessed end walls.
            const shadowClip = [point(min, -500), point(max, -500), point(max, 500), point(min, 500)];
            result.push(...pieces.map(piece => ({ ...piece, shadowClips: [shadowClip] })));
        }
        const detail = (first: number, last: number, interval: number, even = false, max?: number) => {
            const frames = Array.from({ length: last - first + 1 }, (_, i) => pieceFrame(layers, `TrenchT${tier}ShortSpline${String(first + i).padStart(2, '0')}`)).filter((f): f is TrenchPieceFrame => !!f);
            const angle = Math.atan2(b.y - a.y, b.x - a.x), across = tier === 1 ? -3.2 : 0;
            const offset = (p: Point) => ({ x: p.x - Math.sin(angle) * across, y: p.y + Math.cos(angle) * across });
            result.push(...intervalPieces(frames, `detail:${side}:${first}`, offset(a), offset(b), interval * 0.32, { even, max, fromEnd: side < 0, center: tier === 3 }));
        };
        if (tier === 1) detail(2, 5, 250, true);
        if (tier === 2) { detail(2, 5, 70); detail(6, 10, 250, true); }
        if (tier === 3) detail(2, 4, 256, false, 2);
    }
    if (tier === 2) {
        const frames = Array.from({ length: 5 }, (_, i) => pieceFrame(layers, `TrenchT2FloorCover0${i + 1}`)).filter((f): f is TrenchPieceFrame => !!f);
        result.unshift(...intervalPieces(frames, 'floorcover', start, end, 48, { start: 16, end: 16, center: true })
            .map(piece => clipPiece(piece, trenchConnectorCorners(start, end))).filter(piece => piece.positions.length >= 6));
    }
    return result;
}
