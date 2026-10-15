/**
 * Legacy sockets that are not Nixie buildSockets (e.g. emplacement pads,
 * along-bezier rail fork points). Connections involving these ids are skipped
 * during import — position already comes from entity transforms / beziers.
 *
 * Regenerated alongside the socket map: npm run legacy:generate-socket-id-map
 * (or npm run legacy:exfil-sockets). Prefer checking type === "emplacement".
 */
export const LEGACY_IGNORED_SOCKET_TYPES = new Set(['emplacement']);

export function isLegacyIgnoredSocketType(type: unknown): boolean {
    const normalized = String(type ?? '').trim().toLowerCase();
    return LEGACY_IGNORED_SOCKET_TYPES.has(normalized);
}

/**
 * Fallback when exfil type is unavailable: known emplacement pad socket ids.
 * Keep in sync with legacy data.js `type: "emplacement"` entries.
 */
const LEGACY_EMPLACEMENT_SOCKET_IDS_BY_KEY: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
    emplacedaircraftc: new Set(['0']),
    emplacedaircraftw: new Set(['0']),
    emplacedatlargew: new Set(['0']),
    emplacedatw: new Set(['0']),
    emplacedcannonlargec: new Set(['0']),
    emplacedheavyartilleryc: new Set(['0']),
    emplacedheavyartilleryw: new Set(['0']),
    emplacedindirectc: new Set(['0']),
    emplacedinfantryc: new Set(['0']),
    emplacedinfantryw: new Set(['0']),
    emplacedlightartilleryw: new Set(['0']),
    emplacedmultic: new Set(['0']),
    trenchempbuildsite: new Set(['8']),
    trenchempt1: new Set(['8']),
    trenchempt2: new Set(['8']),
    trenchempt3: new Set(['8']),
});

/**
 * Rail keys that only author end caps 0/1. Higher ids are runtime along-bezier
 * fork sockets (legacy `temp` snaps), not Nixie buildSockets.
 */
const LEGACY_RAIL_ALONG_BEZIER_KEYS = new Set([
    'rail_large_gauge',
    'rail_small_gauge',
    'railtrackspline',
    'railtracksplinebiarc',
    'railtracksplinefoundation',
    'smallrailtrackspline',
    'smallrailtracksplinebiarc',
    'smallrailtracksplinefoundation',
]);

/**
 * Legacy public roads are connected Bezier splines. Nixie deliberately imports
 * them as independent static scenery meshes, so their legacy end sockets have
 * no compatible attachment target and must not be reported as broken links.
 */
const LEGACY_STATIC_ROAD_KEYS = new Set([
    'world_road',
    'world_road_packed_dirt',
    'world_road_gravel',
    'world_road_great_march',
]);

function isLegacyStaticRoadSocket(
    legacyOrFoxholeKey: string | null | undefined,
    options: { legacyKey?: string | null; foxholeKey?: string | null; },
): boolean {
    const candidates = [
        options.legacyKey,
        legacyOrFoxholeKey,
        options.foxholeKey,
    ]
        .map(value => String(value ?? '').trim().toLowerCase())
        .filter(Boolean);

    return candidates.some(key => LEGACY_STATIC_ROAD_KEYS.has(key));
}

export function isLegacyEmplacementSocket(
    legacyOrFoxholeKey: string | null | undefined,
    legacySocketId: string | number,
    options: { legacyKey?: string | null; foxholeKey?: string | null; type?: string | null; } = {},
): boolean {
    if (isLegacyIgnoredSocketType(options.type)) {
        return true;
    }

    const id = String(legacySocketId);
    const candidates = [
        options.legacyKey,
        legacyOrFoxholeKey,
        options.foxholeKey,
    ]
        .map(value => String(value ?? '').trim())
        .filter(Boolean);

    for (const key of candidates) {
        if (LEGACY_EMPLACEMENT_SOCKET_IDS_BY_KEY[key]?.has(id)) {
            return true;
        }
    }

    return false;
}

export function isLegacyRailAlongBezierSocket(
    legacyOrFoxholeKey: string | null | undefined,
    legacySocketId: string | number,
    options: { legacyKey?: string | null; foxholeKey?: string | null; } = {},
): boolean {
    const id = Number(legacySocketId);
    if (!Number.isFinite(id) || id < 2) {
        return false;
    }

    const candidates = [
        options.legacyKey,
        legacyOrFoxholeKey,
        options.foxholeKey,
    ]
        .map(value => String(value ?? '').trim().toLowerCase())
        .filter(Boolean);

    return candidates.some(key => LEGACY_RAIL_ALONG_BEZIER_KEYS.has(key));
}

/** True when a legacy connection socket should not become a Nixie attachment. */
export function isLegacyIgnoredSocket(
    legacyOrFoxholeKey: string | null | undefined,
    legacySocketId: string | number,
    options: { legacyKey?: string | null; foxholeKey?: string | null; type?: string | null; } = {},
): boolean {
    return isLegacyEmplacementSocket(legacyOrFoxholeKey, legacySocketId, options)
        || isLegacyRailAlongBezierSocket(legacyOrFoxholeKey, legacySocketId, options)
        || isLegacyStaticRoadSocket(legacyOrFoxholeKey, options);
}
