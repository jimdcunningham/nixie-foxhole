import { resolveFoxholeModificationTextureAnchor } from './modification-anchor.ts';
import type { FoxholeModificationAnchorSlot, FoxholeModificationAnchorSocket } from './modification-anchor.ts';

/** Opposite end of an emplacement face, reflected across its socket's radial axis. */
export function resolveFoxholeEmplacementModificationSplineEnd(
    codeName: string,
    slot: FoxholeModificationAnchorSlot,
    bounds: { minX: number; minY: number; maxX: number; maxY: number; },
    sockets: readonly FoxholeModificationAnchorSocket[],
): { x: number; y: number; } | null {
    if (!/^trenchempt[123]$/i.test(codeName) || !/DefenseModSlot$/i.test(slot.name)
        || slot.x == null || slot.y == null) {
        return null;
    }
    const normalize = (name: string) => name.split(':').at(-1)!.trim().toLowerCase();
    const names = new Set(slot.linkedSocketNames?.map(normalize));
    const socket = sockets.find(candidate => names.has(normalize(candidate.name)));
    if (!socket) {
        return null;
    }
    const radius = Math.hypot(Number(socket.x ?? 0), Number(socket.y ?? 0));
    if (!Number.isFinite(radius) || radius < 1e-6) {
        return null;
    }
    const normalX = Number(socket.x ?? 0) / radius, normalY = Number(socket.y ?? 0) / radius;
    const alongNormal = slot.x * normalX + slot.y * normalY;
    const end = resolveFoxholeModificationTextureAnchor({ name: slot.name,
        x: 2 * alongNormal * normalX - slot.x, y: 2 * alongNormal * normalY - slot.y }, bounds);
    const start = resolveFoxholeModificationTextureAnchor(slot, bounds);
    return Math.hypot(end.x - start.x, end.y - start.y) > 1e-6 ? end : null;
}

/**
 * The two post caps retain independent rigid frames; the wire interpolates
 * between them. FoxWatch's T1-T3 pillar anchors (0,0) and (330,1) centimetres
 * are (105.6,0.32) in the 32px/metre Scene. The far frame mirrors the first
 * frame about the face tangent, matching the next octagonal corner.
 */
export function createFoxholeBarbedWireSplineGeometry(
    start: { x: number; y: number; },
    end: { x: number; y: number; },
    rotation: number,
    visual: { width: number; height: number; offsetX: number; offsetY: number; anchorX: number; anchorY: number; },
): { positions: number[]; uvs: number[]; indices: number[]; } {
    const endRotation = 2 * Math.atan2(end.y - start.y, end.x - start.x) - rotation;
    const cosStart = Math.cos(rotation), sinStart = Math.sin(rotation);
    const cosEnd = Math.cos(endRotation), sinEnd = Math.sin(endRotation);
    const minX = visual.offsetX - visual.width / 2, maxX = minX + visual.width;
    const minY = visual.offsetY - visual.height / 2;
    // Keep the complete timber caps rigid, including their width. Only the
    // interior wire interpolates straight between the fixed edges of the caps.
    const capWidth = 6, endCap = 105.6 - capWidth;
    const columns = [...new Set([minX, maxX, 0, 105.6, capWidth, endCap,
        ...Array.from({ length: 7 }, (_, index) => capWidth + (endCap - capWidth) * (index + 1) / 8)])]
        .filter(x => x >= minX && x <= maxX).sort((a, b) => a - b);
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (const [column, x] of columns.entries()) {
        const weight = Math.max(0, Math.min(1, (x - capWidth) / (endCap - capWidth)));
        const startAlong = Math.min(x, capWidth), endAlong = Math.max(x, endCap);
        for (const v of [0, 1]) {
            const y = minY + v * visual.height;
            const startX = start.x + startAlong * cosStart - y * sinStart;
            const startY = start.y + startAlong * sinStart + y * cosStart;
            const endX = end.x + (endAlong - 105.6) * cosEnd - (y - 0.32) * sinEnd;
            const endY = end.y + (endAlong - 105.6) * sinEnd + (y - 0.32) * cosEnd;
            positions.push(startX * (1 - weight) + endX * weight, startY * (1 - weight) + endY * weight);
            uvs.push((x - minX) / visual.width, v);
        }
        if (column > 0) {
            const previous = (column - 1) * 2, current = column * 2;
            indices.push(previous, current, current + 1, previous, current + 1, previous + 1);
        }
    }
    return { positions, uvs, indices };
}

/** Straight sandbag ribbon. The authored spline targets 330cm (105.6 scene units). */
export function createFoxholeSandbagSplineGeometry(
    start: { x: number; y: number; },
    end: { x: number; y: number; },
    visual: { width: number; height: number; offsetX: number; offsetY: number; },
): { positions: number[]; uvs: number[]; indices: number[]; } {
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const normalX = -dy / length, normalY = dx / length;
    const positions: number[] = [], uvs: number[] = [];
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const x = visual.offsetX + (u - 0.5) * visual.width;
        const y = visual.offsetY + (v - 0.5) * visual.height;
        positions.push(start.x + dx * x / 105.6 + normalX * y,
            start.y + dy * x / 105.6 + normalY * y);
        uvs.push(u, v);
    }
    return { positions, uvs, indices: [0, 1, 2, 0, 2, 3] };
}
