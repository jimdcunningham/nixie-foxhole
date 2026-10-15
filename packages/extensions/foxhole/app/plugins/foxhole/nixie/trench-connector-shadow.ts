import type { FoxholeContactShadowProjection } from './contact-shadow.ts';
import { clipPiece } from './trench-connector-pieces.ts';
import type { TrenchPiece } from './trench-connector-pieces.ts';

/** Recover the native UV-to-board transform, including clipped remainder pieces. */
export function trenchContactShadow(surface: TrenchPiece, projection: FoxholeContactShadowProjection): TrenchPiece | null {
    const { positions: p, uvs: uv } = surface;
    for (let i = 2; i < uv.length - 2; i += 2) {
        const j = i + 2;
        const u1 = uv[i]! - uv[0]!, v1 = uv[i + 1]! - uv[1]!;
        const u2 = uv[j]! - uv[0]!, v2 = uv[j + 1]! - uv[1]!;
        const det = u1 * v2 - u2 * v1;
        if (Math.abs(det) < 1e-8) continue;
        const dx1 = p[i]! - p[0]!, dy1 = p[i + 1]! - p[1]!;
        const dx2 = p[j]! - p[0]!, dy2 = p[j + 1]! - p[1]!;
        const ux = (dx1 * v2 - dx2 * v1) / det, uy = (dy1 * v2 - dy2 * v1) / det;
        const vx = (dx2 * u1 - dx1 * u2) / det, vy = (dy2 * u1 - dy1 * u2) / det;
        const left = 0.5 + (projection.offsetX - projection.surfaceOffsetX - projection.width / 2) / projection.surfaceWidth;
        const top = 0.5 + (projection.offsetY - projection.surfaceOffsetY - projection.height / 2) / projection.surfaceHeight;
        const right = left + projection.width / projection.surfaceWidth, bottom = top + projection.height / projection.surfaceHeight;
        let shadow: TrenchPiece = { id: `shadow:${surface.id}`, textureUrl: projection.textureUrl, alpha: surface.alpha,
            uvs: [0, 0, 1, 0, 1, 1, 0, 1], positions: [[left, top], [right, top], [right, bottom], [left, bottom]].flatMap(([u, v]) => [
                p[0]! + ux * (u! - uv[0]!) + vx * (v! - uv[1]!), p[1]! + uy * (u! - uv[0]!) + vy * (v! - uv[1]!),
            ]) };
        for (const polygon of surface.shadowClips ?? []) shadow = clipPiece(shadow, polygon);
        return shadow.positions.length >= 6 ? shadow : null;
    }
    return null;
}
