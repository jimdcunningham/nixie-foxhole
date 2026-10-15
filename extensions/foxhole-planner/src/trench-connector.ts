export interface TrenchEndpoint { x: number; y: number; rotation: number; }

export function isTrenchConnectorBuildSite(key?: string): boolean {
    return key?.trim().toLowerCase() === 'trenchconnectorbuildsite';
}

export function trenchConnectorTier(key?: string): number | null {
    const match = /^trenchconnectort([123])$/.exec(key?.trim().toLowerCase() ?? '');
    return match ? Number(match[1]) : null;
}

export function isTrenchConnector(key?: string): boolean {
    return isTrenchConnectorBuildSite(key) || trenchConnectorTier(key) !== null;
}

export interface TrenchLayerFrame {
    id: string;
    width: number | null;
    height: number | null;
    offsetX: number | null;
    offsetY: number | null;
    anchorX: number | null;
    anchorY: number | null;
}

/** Rigid endpoint components. Side splines are assembled separately from native pieces. */
export function trenchLayerQuad(layer: TrenchLayerFrame, start: TrenchEndpoint, end: TrenchEndpoint): number[] {
    const width = (layer.width ?? 0) * 0.5;
    const height = (layer.height ?? 0) * 0.5;
    const left = (layer.offsetX ?? 0) * 0.5 - width * (layer.anchorX ?? 0.5);
    const top = (layer.offsetY ?? 0) * 0.5 - height * (layer.anchorY ?? 0.5);
    const transform = (endpoint: TrenchEndpoint, x: number, y: number) => [
        endpoint.x + Math.cos(endpoint.rotation) * x - Math.sin(endpoint.rotation) * y,
        endpoint.y + Math.sin(endpoint.rotation) * x + Math.cos(endpoint.rotation) * y,
    ];
    const back = layer.id.includes('back');
    return [[left, top], [left + width, top], [left + width, top + height], [left, top + height]].flatMap(([x, y]) => {
        return transform(back ? start : end, x! - (back ? -57.6 : 57.6), y!);
    });
}

/** Board units: 32 px/m. The two posts at each end stay a fixed distance apart. */
export const TRENCH_CONNECTOR_HALF_WIDTH = 52;

export function trenchConnectorCorners(start: TrenchEndpoint, end: TrenchEndpoint) {
    const side = (point: TrenchEndpoint, sign: number) => ({
        x: point.x - Math.sin(point.rotation) * TRENCH_CONNECTOR_HALF_WIDTH * sign,
        y: point.y + Math.cos(point.rotation) * TRENCH_CONNECTOR_HALF_WIDTH * sign,
    });
    return [side(start, -1), side(end, -1), side(end, 1), side(start, 1)];
}

export function isTrenchConnectorViable(start: TrenchEndpoint, end: TrenchEndpoint): boolean {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const difference = (rotation: number) => Math.abs(Math.atan2(Math.sin(rotation - angle), Math.cos(rotation - angle)));
    // Clamped endpoint coordinates can round just beyond either length limit.
    return length >= 80 - 1e-8 && length <= 256 + 1e-8
        && difference(start.rotation) <= Math.PI / 4 + 1e-8
        && difference(end.rotation) <= Math.PI / 4 + 1e-8;
}

/**
 * Nine-slice UV layout for the published 233x267 build-site sprite. Its post
 * centres are (12.5,13.5), (220.5,13.5), and the corresponding y=253.5 pair.
 * End strips move rigidly with their handle; only the rope strips stretch.
 * No generated asset is edited; vertex and index counts remain constant.
 */
export function buildTrenchBuildSiteMesh(start: TrenchEndpoint, end: TrenchEndpoint) {
    const columns = [0, 32, 201, 233];
    const rows = [0, 32, 235, 267];
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row < 4; row++) {
        const endpoint = row < 2 ? start : end;
        const along = (rows[row]! - (row < 2 ? 13.5 : 253.5)) * 0.5;
        const cos = Math.cos(endpoint.rotation);
        const sin = Math.sin(endpoint.rotation);
        for (const column of columns) {
            const across = (column - 116.5) * 0.5;
            positions.push(endpoint.x + cos * along - sin * across, endpoint.y + sin * along + cos * across);
            uvs.push(column / 233, rows[row]! / 267);
        }
    }
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            if (row === 1 && col === 1) continue; // Empty interior: no fragment work.
            const a = row * 4 + col;
            const b = a + 1, c = a + 5, d = a + 4;
            const area = (i: number, j: number, k: number) =>
                (positions[j * 2]! - positions[i * 2]!) * (positions[k * 2 + 1]! - positions[i * 2 + 1]!)
                - (positions[j * 2 + 1]! - positions[i * 2 + 1]!) * (positions[k * 2]! - positions[i * 2]!);
            // A short bent rope patch can be concave. Its exterior diagonal folds
            // the UVs and collapses part of the rope to subpixel width.
            if (area(a, b, c) * area(a, c, d) < 0 && area(a, b, d) * area(b, c, d) > 0) {
                indices.push(a, b, d, b, c, d);
            } else {
                indices.push(a, b, c, a, c, d);
            }
        }
    }
    return { positions, uvs, indices };
}
