import { samplePolylineArcLengthPoint } from './spline-ribbon-mesh.ts';
import type { ConnectorSplinePathSample } from './spline-ribbon-mesh.ts';
import { NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_VERTICES, NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_INDICES } from '@nixie/extension-sdk/experimental/scene-v2';

/** Native local XYZ in cm (Y points down on the board); image U runs along the road. */
export interface NativeSplineSurfaceMesh {
    lengthCm: number;
    positions: number[];
    uvs: number[];
    indices: number[];
}

export interface NativeSplineSurface {
    version: 1;
    verticalOffsetCm: number;
    groundHeightCm: number;
    body: NativeSplineSurfaceMesh;
}

export function readNativeSplineSurface(value: unknown): NativeSplineSurface | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const surface = value as NativeSplineSurface;
    if (surface.version !== 1 || !Number.isFinite(surface.verticalOffsetCm) || !Number.isFinite(surface.groundHeightCm)) return undefined;
    for (const mesh of [surface.body]) {
        if (!mesh || !Number.isFinite(mesh.lengthCm) || mesh.lengthCm <= 0 || mesh.lengthCm > 100_000
            || !Array.isArray(mesh.positions) || mesh.positions.length < 9 || mesh.positions.length > 6_000 || mesh.positions.length % 3
            || !Array.isArray(mesh.uvs) || mesh.uvs.length !== mesh.positions.length / 3 * 2
            || !Array.isArray(mesh.indices) || mesh.indices.length < 3 || mesh.indices.length > 12_000 || mesh.indices.length % 3
            || ![...mesh.positions, ...mesh.uvs].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000)
            || !mesh.indices.every(n => Number.isInteger(n) && n >= 0 && n < mesh.positions.length / 3)) return undefined;
    }
    return surface;
}

type Vertex = [number, number, number, number, number];

function clip(polygon: Vertex[], axis: number, boundary: number, greater: boolean): Vertex[] {
    const result: Vertex[] = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]!; const b = polygon[(i + 1) % polygon.length]!;
        const insideA = greater ? a[axis]! >= boundary : a[axis]! <= boundary;
        const insideB = greater ? b[axis]! >= boundary : b[axis]! <= boundary;
        if (insideA) result.push(a);
        if (insideA !== insideB) {
            const t = (boundary - a[axis]!) / (b[axis]! - a[axis]!);
            result.push(a.map((n, k) => n + (b[k]! - n) * t) as Vertex);
        }
    }
    return result;
}

/** Stretch the native body end to end; repeat only its surface material. */
export function buildNativeSplineSurfaceMeshData(
    surface: NativeSplineSurface,
    path: ConnectorSplinePathSample,
    materialScale?: readonly number[] | null,
): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array; } | null {
    return buildSampledSurface(surface, path, materialScale, 16);
}

function buildSampledSurface(
    surface: NativeSplineSurface, path: ConnectorSplinePathSample, materialScale: readonly number[] | null | undefined,
    sectionLength: number,
): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array; } | null {
    const bodyLength = path.totalLength;
    if (bodyLength <= .001 || path.points.length < 2) return null;
    const scale = Number(materialScale?.[1]);
    const bodyUvScale = bodyLength / .32 * (Number.isFinite(scale) && scale > 0 ? scale : 1 / surface.body.lengthCm);
    const positions: number[] = []; const uvs: number[] = []; const indices: number[] = [];
    const panels = [{ mesh: surface.body, from: 0, length: bodyLength, reverse: false, uvScale: bodyUvScale }];
    for (const panel of panels) {
        const { mesh } = panel;
        const vertices = new Map<string, number>();
        const append = (v: Vertex): number => {
            const key = v.map(n => n.toFixed(7)).join(',');
            const existing = vertices.get(key);
            if (existing !== undefined) return existing;
            const fraction = Math.max(0, Math.min(1, v[0] / mesh.lengthCm));
            const distance = panel.from + (panel.reverse ? 1 - fraction : fraction) * panel.length;
            const point = samplePolylineArcLengthPoint(path, distance)!;
            const across = v[1] * .32 * (panel.reverse ? -1 : 1);
            const index = positions.length / 2;
            positions.push(point.x - Math.sin(point.tangent) * across, point.y + Math.cos(point.tangent) * across);
            uvs.push(v[3] * panel.uvScale, v[4]);
            vertices.set(key, index);
            return index;
        };
        const strips = Math.max(1, Math.ceil(panel.length / sectionLength));
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const triangle = mesh.indices.slice(i, i + 3).map(index => [
                ...mesh.positions.slice(index * 3, index * 3 + 3),
                ...mesh.uvs.slice(index * 2, index * 2 + 2),
            ] as Vertex);
            // An orthographic road on flat terrain hides its below-ground skirt.
            const aboveGround = clip(triangle, 2, surface.groundHeightCm - surface.verticalOffsetCm, true);
            if (aboveGround.length < 3) continue;
            const min = Math.min(...aboveGround.map(v => v[0]));
            const max = Math.max(...aboveGround.map(v => v[0]));
            const first = Math.max(0, Math.floor(min / mesh.lengthCm * strips));
            const last = Math.min(strips - 1, Math.floor(max / mesh.lengthCm * strips));
            for (let strip = first; strip <= last; strip++) {
                const polygon = clip(clip(aboveGround, 0, strip / strips * mesh.lengthCm, true), 0, (strip + 1) / strips * mesh.lengthCm, false);
                for (let j = 1; j + 1 < polygon.length; j++) {
                    const a = polygon[0]!; const b = polygon[j]!; const c = polygon[j + 1]!;
                    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-7) continue;
                    indices.push(append(a), append(b), append(c));
                }
            }
        }
    }
    // Preserve the original vertices and material density, reducing only the
    // additional bend tessellation when a long path reaches the public budget.
    if (positions.length / 2 > NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_VERTICES || indices.length > NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_INDICES) {
        return sectionLength < path.totalLength ? buildSampledSurface(surface, path, materialScale, sectionLength * 2) : null;
    }
    return indices.length ? { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) } : null;
}
