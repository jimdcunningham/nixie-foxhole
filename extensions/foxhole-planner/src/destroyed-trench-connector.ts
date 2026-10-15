import { trenchConnectorCorners, trenchLayerQuad } from './trench-connector.ts';
import type { TrenchEndpoint, TrenchLayerFrame } from './trench-connector.ts';

export interface DestroyedTrenchFrame extends TrenchLayerFrame { textureUrl: string; }
export interface DestroyedTrenchPiece {
    id: string;
    textureUrl: string;
    positions: number[];
    uvs: number[];
    alpha: number;
}
interface Point { x: number; y: number; }

function nativePiece(frame: DestroyedTrenchFrame, id: string, origin: Point, rotation: number): DestroyedTrenchPiece {
    const width = (frame.width ?? 0) / 2, height = (frame.height ?? 0) / 2;
    const left = (frame.offsetX ?? 0) / 2 - width * (frame.anchorX ?? 0.5);
    const top = (frame.offsetY ?? 0) / 2 - height * (frame.anchorY ?? 0.5);
    const c = Math.cos(rotation), s = Math.sin(rotation);
    return { id, textureUrl: frame.textureUrl, alpha: 1, uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        positions: [[left, top], [left + width, top], [left + width, top + height], [left, top + height]]
            .flatMap(([x, y]) => [origin.x + c * x! - s * y!, origin.y + s * x! + c * y!]) };
}

function clipPiece(piece: DestroyedTrenchPiece, polygon: readonly Point[]): DestroyedTrenchPiece {
    let vertices = piece.positions.filter((_, i) => i % 2 === 0).map((x, i) => ({
        x, y: piece.positions[i * 2 + 1]!, u: piece.uvs[i * 2]!, v: piece.uvs[i * 2 + 1]!,
    }));
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
        const distance = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        const input = vertices;
        vertices = [];
        for (let j = 0; j < input.length; j++) {
            const p = input[j]!, q = input[(j + 1) % input.length]!;
            const dp = distance(p), dq = distance(q);
            if (dp >= -1e-7) {
                vertices.push(p);
            }
            if ((dp >= 0) !== (dq >= 0)) {
                const t = dp / (dp - dq);
                vertices.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y),
                    u: p.u + t * (q.u - p.u), v: p.v + t * (q.v - p.v) });
            }
        }
    }
    return { ...piece, positions: vertices.flatMap(p => [p.x, p.y]), uvs: vertices.flatMap(p => [p.u, p.v]) };
}

function offset(endpoint: TrenchEndpoint, across: number): Point {
    return { x: endpoint.x - Math.sin(endpoint.rotation) * across,
        y: endpoint.y + Math.cos(endpoint.rotation) * across };
}

function intervals(frames: DestroyedTrenchFrame[], id: string, a: Point, b: Point, interval: number,
    start: number, end: number, across = 0, center = false, fillRemainder = false): DestroyedTrenchPiece[] {
    if (!frames.length || interval <= 0) {
        return [];
    }
    const length = Math.hypot(b.x - a.x, b.y - a.y), angle = Math.atan2(b.y - a.y, b.x - a.x);
    const available = length - start - end;
    // The decoded connector spawner still places one native repeat when its
    // source offsets exceed the span; it never scales the remainder mesh.
    if (available < 0 && !fillRemainder) {
        return [];
    }
    const count = Math.min(64, Math.floor(Math.max(0, available) / interval + 1e-7) + 1);
    const first = start + (center ? (available - (count - 1) * interval) / 2 : 0);
    return Array.from({ length: count }, (_, i) => nativePiece(frames[i % frames.length]!, `${id}:${i}`,
        { x: a.x + Math.cos(angle) * (first + i * interval) - Math.sin(angle) * across,
            y: a.y + Math.sin(angle) * (first + i * interval) + Math.cos(angle) * across }, angle));
}

/** Game-authored centre rubble, endpoint caps and interval meshes; no intact sprite fallback. */
export function destroyedTrenchConnectorPieces(tier: number, layers: readonly DestroyedTrenchFrame[],
    start: TrenchEndpoint, end: TrenchEndpoint, startConnected = false, endConnected = false): DestroyedTrenchPiece[] {
    const result: DestroyedTrenchPiece[] = [];
    const frame = (name: string) => layers.find(layer => layer.id === `piece-${name.toLowerCase()}`);
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const polygon = trenchConnectorCorners(start, end);
    // Floor and Destroyed are tagged ConnectorCentre in all three decoded
    // blueprints. Clip their rigid native frames with UVs, rather than stretch
    // a whole fixed-length wreck image across the edited connector.
    for (const id of ['floor', 'destroyed']) {
        const layer = layers.find(entry => entry.id === id);
        if (layer) {
            result.push(clipPiece(nativePiece(layer, id, center, angle), polygon));
        }
    }
    for (const layer of layers) {
        if (!/^(?:dirt|visualdirt)(?:corner)?(?:back|front)/u.test(layer.id)) {
            continue;
        }
        if (layer.id.includes('back') ? startConnected : endConnected) {
            continue;
        }
        result.push({ id: layer.id, textureUrl: layer.textureUrl, positions: trenchLayerQuad(layer, start, end),
            uvs: [0, 0, 1, 0, 1, 1, 0, 1], alpha: 1 });
    }
    for (const side of [-1, 1]) {
        // The blueprint side spline origins are +/-150cm (48 board units).
        const a = offset(side < 0 ? end : start, side * 48), b = offset(side < 0 ? start : end, side * 48);
        const dirt = frame(tier === 3 ? 'TrenchT3ShortSpline01' : 'TrenchT1ShortDirtSpline01');
        if (dirt) {
            result.push(...intervals([dirt], `dirt-side:${side}`, a, b, 128, 73.6, 73.6, 0, false, true));
        }
        if (tier <= 2) {
            const destroyed = frame('TrenchT1ShortDirtSplineDestroyed01');
            // BPTrenchConnectorDestroyedCommonT1T2: 400cm interval, 160cm
            // offsets, with -10/-20cm local lateral offsets on the two sides.
            if (destroyed) {
                result.push(...intervals([destroyed], `destroyed-side:${side}`, a, b, 128, 51.2, 51.2,
                    side < 0 ? -3.2 : -6.4, false, true));
            }
        } else {
            const wall = frame('TrenchT3Short02');
            if (wall) {
                const length = Math.hypot(b.x - a.x, b.y - a.y), rotation = Math.atan2(b.y - a.y, b.x - a.x);
                const width = (wall.width ?? 0) / 2;
                const left = (wall.offsetX ?? 0) / 2 - width * (wall.anchorX ?? 0.5);
                const c = Math.cos(rotation), s = Math.sin(rotation);
                const point = (along: number, across: number) => ({ x: a.x + c * along - s * across, y: a.y + s * along + c * across });
                const clip = [point(0, -500), point(length, -500), point(length, 500), point(0, 500)];
                if (width > 0) {
                    for (let i = 0; i < Math.min(64, Math.ceil(length / width)); i++) {
                        result.push(clipPiece(nativePiece(wall, `wall-side:${side}:${i}`, point(i * width - left, 0), rotation), clip));
                    }
                }
            }
            const details = [2, 3, 4].map(i => frame(`TrenchT3ShortSpline0${i}`)).filter((entry): entry is DestroyedTrenchFrame => Boolean(entry));
            result.push(...intervals(details, `concrete-detail:${side}`, a, b, 81.92, 0, 0, 0, true));
        }
    }
    // Floors/ground precede rubble and concrete details, independently of the
    // order in which authored render layers were serialized.
    return result.filter(piece => piece.positions.length >= 6).sort((a, b) => {
        const rank = (id: string) => id === 'floor' ? 0 : id.startsWith('dirt') || id.startsWith('visualdirt') ? 1 : 2;
        return rank(a.id) - rank(b.id);
    });
}
