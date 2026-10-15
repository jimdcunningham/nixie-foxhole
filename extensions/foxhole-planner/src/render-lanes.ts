import { resolveFoxholeHeightCategory } from './height-categories.ts';

export interface FoxholeBoardRenderLaneDefinition {
    /** Stable lane key used by BoardSceneRenderLaneManager. */
    laneId: string;
    /** Lower values render first (behind higher values). */
    laneOrder: number;
    /** Human-readable label for debugging and docs. */
    label: string;
}

export function foxholeRenderLane(lane: FoxholeBoardRenderLaneDefinition): { laneId: string; laneOrder: number; } {
    return { laneId: lane.laneId, laneOrder: lane.laneOrder };
}

/** Generic board nodes (sprites, lines, etc.) when they do not override lanes. */
export const NIXIE_DEFAULT_RENDER_LANE = {
    laneId: 'default',
    laneOrder: 0,
    label: 'Default board nodes',
} as const satisfies FoxholeBoardRenderLaneDefinition;

export const FOXHOLE_STRUCTURE_RENDER_LANES = {
    bunkerDirt: {
        laneId: 'foxhole:structure:bunker-dirt',
        laneOrder: -1,
        label: 'Bunker exterior dirt beneath floors',
    },
    floorDetail: {
        laneId: 'foxhole:structure:floor-detail',
        laneOrder: 25,
        label: 'Structure interior machinery and floor details',
    },
    contactShadow: {
        laneId: 'foxhole:structure:contact-shadow',
        laneOrder: 5,
        label: 'Structure contact shadows',
    },
    floor: {
        laneId: 'foxhole:structure:floor',
        laneOrder: 0,
        label: 'Structure floor / packaged pallet',
    },
    lowerModification: {
        laneId: 'foxhole:structure:lower-modification',
        laneOrder: 10,
        label: 'Structure lower modification overlays (stairs, one-way)',
    },
    base: {
        laneId: 'foxhole:structure:base',
        laneOrder: 40,
        label: 'Structure walls / main sprite',
    },
    modification: {
        laneId: 'foxhole:structure:modification',
        laneOrder: 30,
        label: 'Structure mid modification overlays',
    },
    dirt: {
        laneId: 'foxhole:structure:dirt',
        laneOrder: 32,
        label: 'Structure exterior dirt',
    },
    roof: {
        laneId: 'foxhole:structure:roof',
        laneOrder: 35,
        label: 'Structure roof',
    },
    corners: {
        laneId: 'foxhole:structure:corners',
        laneOrder: 50,
        label: 'Structure corner trim',
    },
    upperModification: {
        laneId: 'foxhole:structure:upper-modification',
        laneOrder: 60,
        label: 'Structure upper modification overlays (bridge, trench roof)',
    },
    trenchDefense: {
        laneId: 'foxhole:structure:trench-defense',
        laneOrder: 100,
        label: 'Trench berms and barbed wire above roofs and walls',
    },
    spotlight: {
        laneId: 'foxhole:structure:spotlight',
        laneOrder: 180,
        label: 'Bunker spotlights above structure visuals',
    },
    hitboxDebug: {
        laneId: 'foxhole:debug:hitbox',
        laneOrder: 1_000,
        label: 'Hitbox authoring overlays',
    },
    vehicle: {
        laneId: 'foxhole:structure:vehicle',
        laneOrder: 80,
        label: 'Rail vehicles / locomotives',
    },
    crane: {
        laneId: 'foxhole:structure:crane',
        laneOrder: 160,
        label: 'Cranes above facility structures',
    },
    skyHauler: {
        laneId: 'foxhole:structure:sky-hauler',
        laneOrder: 161,
        label: 'Sky Hauler above power lines',
    },
} as const satisfies Record<string, FoxholeBoardRenderLaneDefinition>;

export const FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE = {
    laneId: 'foxhole:connector:spline',
    laneOrder: 35,
    label: 'Spline connectors (powerline, pipe, rail track, …)',
} as const satisfies FoxholeBoardRenderLaneDefinition;

export const FOXHOLE_SPLINE_SHADOW_RENDER_LANE = {
    laneId: 'foxhole:connector:spline-shadow',
    laneOrder: 34,
    label: 'Spline contact shadows beneath connector ribbons',
} as const satisfies FoxholeBoardRenderLaneDefinition;

export const FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE = {
    laneId: 'foxhole:connector:legacy',
    laneOrder: 35,
    label: 'Legacy straight connectors',
} as const satisfies FoxholeBoardRenderLaneDefinition;

export const FOXHOLE_POWERLINE_RENDER_LANE = {
    laneId: 'foxhole:connector:powerline',
    laneOrder: 75,
    label: 'Power lines above facilities and most vehicles',
} as const satisfies FoxholeBoardRenderLaneDefinition;

export const FOXHOLE_OVERHEAD_PIPE_RENDER_LANE = {
    laneId: 'foxhole:connector:overhead-pipe',
    laneOrder: 120,
    label: 'Overhead pipelines above facilities and below cranes',
} as const satisfies FoxholeBoardRenderLaneDefinition;

/** Semantic object heights. Component lanes remain available inside ordinary buildings. */
export const FOXHOLE_HEIGHT_RENDER_LANES = {
    road: { laneId: 'foxhole:height:road', laneOrder: -30, label: 'Roads and build sites' },
    trench: { laneId: 'foxhole:height:trench', laneOrder: -20, label: 'Ground trenches and mines' },
    foundation: FOXHOLE_STRUCTURE_RENDER_LANES.floor,
    rail: { laneId: 'foxhole:height:rail', laneOrder: 20, label: 'Rail tracks' },
    resource: { laneId: 'foxhole:height:resource', laneOrder: 25, label: 'Ground resources' },
    pipe: FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE,
    upgrade: { laneId: 'foxhole:height:upgrade', laneOrder: 60, label: 'Elevated bunker upgrades' },
    upgrade2: { laneId: 'foxhole:height:upper-upgrade', laneOrder: 70, label: 'Upper bunker structures' },
    power_line: FOXHOLE_POWERLINE_RENDER_LANE,
    vehicle: FOXHOLE_STRUCTURE_RENDER_LANES.vehicle,
    container: { laneId: 'foxhole:height:container', laneOrder: 90, label: 'Containers and shippables' },
    wall: { laneId: 'foxhole:height:wall', laneOrder: 105, label: 'Walls and gates' },
    overhead: FOXHOLE_OVERHEAD_PIPE_RENDER_LANE,
    power_pole: { laneId: 'foxhole:height:power-pole', laneOrder: 130, label: 'Power poles and boxes' },
    player: { laneId: 'foxhole:height:player', laneOrder: 150, label: 'Player markers' },
    crane: FOXHOLE_STRUCTURE_RENDER_LANES.crane,
} as const satisfies Record<string, FoxholeBoardRenderLaneDefinition>;

export function resolveFoxholeAssetHeightLane(assetId: string | null | undefined): FoxholeBoardRenderLaneDefinition | undefined {
    const key = String(assetId ?? '').trim().toLowerCase();
    if (key === 'largecrane') {
        return FOXHOLE_STRUCTURE_RENDER_LANES.skyHauler;
    }
    const category = resolveFoxholeHeightCategory(key);
    if (category) {
        return FOXHOLE_HEIGHT_RENDER_LANES[category];
    }
    // New tiers and connector forms inherit their family, rather than requiring another ID list.
    if (/^(?:small|crane)?railtrack/.test(key)) {
        return FOXHOLE_HEIGHT_RENDER_LANES.rail;
    }
    if (/^(?:wall|gate)(?:spline)?t\d/.test(key)) {
        return FOXHOLE_HEIGHT_RENDER_LANES.wall;
    }
    if (key.startsWith('foundation')) {
        return FOXHOLE_HEIGHT_RENDER_LANES.foundation;
    }
    if (key.startsWith('facilitycatwalk')) {
        return FOXHOLE_HEIGHT_RENDER_LANES.overhead;
    }
    return undefined;
}

export function resolveFoxholeAssetComponentLane(assetId: string | null | undefined, fallback: FoxholeBoardRenderLaneDefinition): FoxholeBoardRenderLaneDefinition {
    if (fallback === FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug || fallback === FOXHOLE_STRUCTURE_RENDER_LANES.spotlight) {
        return fallback;
    }
    const height = resolveFoxholeAssetHeightLane(assetId);
    if ((height === FOXHOLE_HEIGHT_RENDER_LANES.trench || String(assetId).toLowerCase() === 'trenchempt1') && fallback !== FOXHOLE_STRUCTURE_RENDER_LANES.floor
        && fallback !== FOXHOLE_STRUCTURE_RENDER_LANES.dirt) {
        return fallback;
    }
    return height ?? fallback;
}

export const FOXHOLE_RANGE_RENDER_LANE = { laneId: 'foxhole:overlay:range', laneOrder: 200, label: 'Range overlays above construction' } as const;

export function resolveFoxholeStructurePrimaryRenderLane(
    foxholeKey: string | null | undefined,
    isRailVehicle = false,
    isVehicle = false,
): FoxholeBoardRenderLaneDefinition {
    const height = resolveFoxholeAssetHeightLane(foxholeKey);
    if (height) {
        return height;
    }
    switch (String(foxholeKey ?? '').trim().toLowerCase()) {
        case 'largecrane': return FOXHOLE_STRUCTURE_RENDER_LANES.skyHauler;
        case 'crane':
        case 'facilitycrane': return FOXHOLE_STRUCTURE_RENDER_LANES.crane;
        default: return isRailVehicle || isVehicle ? FOXHOLE_STRUCTURE_RENDER_LANES.vehicle : FOXHOLE_STRUCTURE_RENDER_LANES.base;
    }
}

export function resolveFoxholeConnectorRenderLane(
    foxholeKey: string | null | undefined,
    fallback: FoxholeBoardRenderLaneDefinition,
): FoxholeBoardRenderLaneDefinition {
    const height = resolveFoxholeAssetHeightLane(foxholeKey);
    if (height) {
        return height;
    }
    switch (String(foxholeKey ?? '').trim().toLowerCase()) {
        case 'powerline': return FOXHOLE_POWERLINE_RENDER_LANE;
        case 'facilitypipeoverhead': return FOXHOLE_OVERHEAD_PIPE_RENDER_LANE;
        default: return fallback;
    }
}

/**
 * Modification overlay buckets inside a layered structure node.
 * Each bucket maps 1:1 to a board scene lane above.
 */
export type FoxholeModificationTextureLayer = 'lower' | 'base' | 'roof' | 'trenchDefense' | 'upper';

export const FOXHOLE_MODIFICATION_TEXTURE_LAYER_LANES = {
    lower: FOXHOLE_STRUCTURE_RENDER_LANES.lowerModification,
    base: FOXHOLE_STRUCTURE_RENDER_LANES.modification,
    roof: FOXHOLE_STRUCTURE_RENDER_LANES.roof,
    upper: FOXHOLE_STRUCTURE_RENDER_LANES.upperModification,
    trenchDefense: FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense,
} as const satisfies Record<FoxholeModificationTextureLayer, FoxholeBoardRenderLaneDefinition>;

/**
 * Canonical modification variant → texture-layer rules.
 * First matching rule wins. Unmatched variants fall back to slot Z (see resolver).
 */
export const FOXHOLE_MODIFICATION_VARIANT_LAYER_RULES = [
    { layer: 'lower', variantIds: ['stairs', 'oneway'] },
    { layer: 'trenchDefense', profileType: 'trench', variantIds: ['barbedwire', 'sandbags'] },
    { layer: 'upper', variantIds: ['bridge', 'trenchroof'] },
] as const satisfies readonly {
    layer: FoxholeModificationTextureLayer;
    profileType?: string;
    variantIds: readonly string[];
}[];

/**
 * Within-lane draw priority (higher = painted later / appears on top).
 * Only applies when two mods share the same texture layer.
 */
export const FOXHOLE_MODIFICATION_VARIANT_RENDER_PRIORITY: Readonly<Record<string, number>> = {
    stairs: 0,
    oneway: 0,
    barbedwire: 10,
    sandbags: 10,
    bridge: 30,
    trenchroof: 30,
};

export const FOXHOLE_MODIFICATION_VARIANT_RENDER_PRIORITY_DEFAULT = 20;

/**
 * Bottom-to-top render lane stack for the Foxhole board.
 * Single source of truth when diagnosing z-order across node types.
 *
 * Typical trench mod placement on this stack:
 * - lane 10: stairs / one-way
 * - lane 20: rails; lane 35: ground pipes
 * - lane 75: power lines; lane 80: vehicles above buildings
 * - lane 120: overhead walkways / pipes; lane 130: poles
 * - lane 160: cranes; lane 161: Sky Hauler
 * - lane 100: trench barbed wire / sandbag berms (above structure visuals)
 * - lane 180: bunker spotlight meshes; lane 200: range overlays
 */
export const FOXHOLE_BOARD_RENDER_LANE_STACK = [
    FOXHOLE_STRUCTURE_RENDER_LANES.bunkerDirt,
    NIXIE_DEFAULT_RENDER_LANE,
    FOXHOLE_STRUCTURE_RENDER_LANES.floor,
    FOXHOLE_STRUCTURE_RENDER_LANES.contactShadow,
    FOXHOLE_STRUCTURE_RENDER_LANES.lowerModification,
    FOXHOLE_STRUCTURE_RENDER_LANES.floorDetail,
    FOXHOLE_STRUCTURE_RENDER_LANES.modification,
    FOXHOLE_STRUCTURE_RENDER_LANES.dirt,
    FOXHOLE_SPLINE_SHADOW_RENDER_LANE,
    FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE,
    FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE,
    FOXHOLE_STRUCTURE_RENDER_LANES.roof,
    FOXHOLE_STRUCTURE_RENDER_LANES.vehicle,
    FOXHOLE_STRUCTURE_RENDER_LANES.base,
    FOXHOLE_STRUCTURE_RENDER_LANES.corners,
    FOXHOLE_STRUCTURE_RENDER_LANES.upperModification,
    FOXHOLE_OVERHEAD_PIPE_RENDER_LANE,
    FOXHOLE_STRUCTURE_RENDER_LANES.crane,
    FOXHOLE_POWERLINE_RENDER_LANE,
    FOXHOLE_STRUCTURE_RENDER_LANES.skyHauler,
    FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense,
    FOXHOLE_STRUCTURE_RENDER_LANES.spotlight,
    FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug,
    FOXHOLE_RANGE_RENDER_LANE,
    ...Object.values(FOXHOLE_HEIGHT_RENDER_LANES),
]
    .filter((lane, index, lanes) => lanes.findIndex(candidate => candidate.laneId === lane.laneId) === index)
    .sort((a, b) => a.laneOrder - b.laneOrder || a.laneId.localeCompare(b.laneId)) satisfies readonly FoxholeBoardRenderLaneDefinition[];

export function resolveFoxholeStructureDirtRenderLane(codeName: string | null | undefined): FoxholeBoardRenderLaneDefinition {
    return /^fort(?:corner)?t[23]$/i.test(String(codeName ?? '').trim())
        ? FOXHOLE_STRUCTURE_RENDER_LANES.bunkerDirt
        : FOXHOLE_STRUCTURE_RENDER_LANES.dirt;
}

/** @deprecated Prefer FOXHOLE_STRUCTURE_RENDER_LANES.*.laneId */
export const FOXHOLE_STRUCTURE_LANE_IDS = {
    spotlight: FOXHOLE_STRUCTURE_RENDER_LANES.spotlight.laneId,
    floorDetail: FOXHOLE_STRUCTURE_RENDER_LANES.floorDetail.laneId,
    contactShadow: FOXHOLE_STRUCTURE_RENDER_LANES.contactShadow.laneId,
    floor: FOXHOLE_STRUCTURE_RENDER_LANES.floor.laneId,
    lowerModification: FOXHOLE_STRUCTURE_RENDER_LANES.lowerModification.laneId,
    base: FOXHOLE_STRUCTURE_RENDER_LANES.base.laneId,
    modification: FOXHOLE_STRUCTURE_RENDER_LANES.modification.laneId,
    trenchDefense: FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense.laneId,
    dirt: FOXHOLE_STRUCTURE_RENDER_LANES.dirt.laneId,
    roof: FOXHOLE_STRUCTURE_RENDER_LANES.roof.laneId,
    corners: FOXHOLE_STRUCTURE_RENDER_LANES.corners.laneId,
    upperModification: FOXHOLE_STRUCTURE_RENDER_LANES.upperModification.laneId,
    hitboxDebug: FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug.laneId,
    vehicle: FOXHOLE_STRUCTURE_RENDER_LANES.vehicle.laneId,
    crane: FOXHOLE_STRUCTURE_RENDER_LANES.crane.laneId,
    skyHauler: FOXHOLE_STRUCTURE_RENDER_LANES.skyHauler.laneId,
} as const;

/** @deprecated Prefer FOXHOLE_STRUCTURE_RENDER_LANES.*.laneOrder */
export const FOXHOLE_STRUCTURE_LANE_ORDER = {
    spotlight: FOXHOLE_STRUCTURE_RENDER_LANES.spotlight.laneOrder,
    floorDetail: FOXHOLE_STRUCTURE_RENDER_LANES.floorDetail.laneOrder,
    contactShadow: FOXHOLE_STRUCTURE_RENDER_LANES.contactShadow.laneOrder,
    floor: FOXHOLE_STRUCTURE_RENDER_LANES.floor.laneOrder,
    lowerModification: FOXHOLE_STRUCTURE_RENDER_LANES.lowerModification.laneOrder,
    base: FOXHOLE_STRUCTURE_RENDER_LANES.base.laneOrder,
    modification: FOXHOLE_STRUCTURE_RENDER_LANES.modification.laneOrder,
    trenchDefense: FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense.laneOrder,
    dirt: FOXHOLE_STRUCTURE_RENDER_LANES.dirt.laneOrder,
    roof: FOXHOLE_STRUCTURE_RENDER_LANES.roof.laneOrder,
    corners: FOXHOLE_STRUCTURE_RENDER_LANES.corners.laneOrder,
    upperModification: FOXHOLE_STRUCTURE_RENDER_LANES.upperModification.laneOrder,
    hitboxDebug: FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug.laneOrder,
    vehicle: FOXHOLE_STRUCTURE_RENDER_LANES.vehicle.laneOrder,
    crane: FOXHOLE_STRUCTURE_RENDER_LANES.crane.laneOrder,
    skyHauler: FOXHOLE_STRUCTURE_RENDER_LANES.skyHauler.laneOrder,
} as const;
