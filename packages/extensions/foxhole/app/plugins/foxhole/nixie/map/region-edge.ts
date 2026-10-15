import {
    FOXHOLE_MAP_REGIONS,
    FOXHOLE_REGION_POLYGON,
    getFoxholeRegionPosition,
} from './constants.ts';
import type { FoxholeMapRegionRecord } from './constants.ts';

export type FoxholeRegionEdgePoint = {
    x: number;
    y: number;
    regionKey: string;
    regionLabel: string;
};

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asWorldPolygon(region: Pick<FoxholeMapRegionRecord, 'gridCoord'>): Array<{ x: number; y: number; }> {
    const center = getFoxholeRegionPosition(region);
    const points: Array<{ x: number; y: number; }> = [];
    for (let i = 0; i < FOXHOLE_REGION_POLYGON.length; i += 2) {
        points.push({
            x: center.x + FOXHOLE_REGION_POLYGON[i]!,
            y: center.y + FOXHOLE_REGION_POLYGON[i + 1]!,
        });
    }
    return points;
}

function segmentIntersection(
    a: { x: number; y: number; },
    b: { x: number; y: number; },
    c: { x: number; y: number; },
    d: { x: number; y: number; },
): { x: number; y: number; t: number; } | null {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const cdx = d.x - c.x;
    const cdy = d.y - c.y;
    const den = (abx * cdy) - (aby * cdx);
    if (Math.abs(den) < 1e-9) {
        return null;
    }
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const t = ((acx * cdy) - (acy * cdx)) / den;
    const u = ((acx * aby) - (acy * abx)) / den;
    if (t < 0 || u < 0 || u > 1) {
        return null;
    }
    return {
        x: a.x + (abx * t),
        y: a.y + (aby * t),
        t,
    };
}

export function resolveFoxholeMapRegionByQuery(query: string): FoxholeMapRegionRecord | null {
    const needle = normalizeString(query).toLowerCase();
    if (!needle) {
        return null;
    }

    const exactKey = FOXHOLE_MAP_REGIONS.find(region => region.key.toLowerCase() === needle);
    if (exactKey) {
        return exactKey;
    }

    const exactName = FOXHOLE_MAP_REGIONS.find(region => region.name.toLowerCase() === needle);
    if (exactName) {
        return exactName;
    }

    const partial = FOXHOLE_MAP_REGIONS.filter(region => (
        region.name.toLowerCase().includes(needle)
        || region.key.toLowerCase().includes(needle)
    ));
    if (partial.length === 1) {
        return partial[0]!;
    }

    // Prefer hex-key suffix matches like "Acrithia" → AcrithiaHex
    const hexish = partial.find(region => region.key.toLowerCase().replace(/hex$/i, '') === needle.replace(/\s+/g, ''));
    return hexish ?? partial[0] ?? null;
}

/**
 * Find where the ray from `from` toward the region's center first hits the region hex boundary.
 * Used for binocular lines to "the edge of <region>".
 */
export function resolveFoxholeRegionEdgePoint(options: {
    fromX: number;
    fromY: number;
    towardRegion: string;
}): FoxholeRegionEdgePoint | null {
    const region = resolveFoxholeMapRegionByQuery(options.towardRegion);
    if (!region) {
        return null;
    }

    const from = { x: Number(options.fromX), y: Number(options.fromY) };
    if (![from.x, from.y].every(Number.isFinite)) {
        return null;
    }

    const center = getFoxholeRegionPosition(region);
    const direction = { x: center.x - from.x, y: center.y - from.y };
    const length = Math.hypot(direction.x, direction.y);
    if (length < 1e-6) {
        return {
            x: center.x + FOXHOLE_REGION_POLYGON[0]!,
            y: center.y + FOXHOLE_REGION_POLYGON[1]!,
            regionKey: region.key,
            regionLabel: region.name,
        };
    }

    // Extend past the center so the ray always crosses the far/near edge.
    const far = {
        x: from.x + (direction.x / length) * (length + FOXHOLE_REGION_POLYGON.reduce((max, value, index) => (
            index % 2 === 0 ? max : Math.max(max, Math.abs(value))
        ), 0) * 2),
        y: from.y + (direction.y / length) * (length + FOXHOLE_REGION_POLYGON.reduce((max, value, index) => (
            index % 2 === 1 ? max : Math.max(max, Math.abs(value))
        ), 0) * 2),
    };

    const polygon = asWorldPolygon(region);
    let best: { x: number; y: number; t: number; } | null = null;
    for (let i = 0; i < polygon.length; i += 1) {
        const c = polygon[i]!;
        const d = polygon[(i + 1) % polygon.length]!;
        const hit = segmentIntersection(from, far, c, d);
        if (!hit) {
            continue;
        }
        if (!best || hit.t < best.t) {
            best = hit;
        }
    }

    if (!best) {
        return null;
    }

    return {
        x: best.x,
        y: best.y,
        regionKey: region.key,
        regionLabel: region.name,
    };
}
