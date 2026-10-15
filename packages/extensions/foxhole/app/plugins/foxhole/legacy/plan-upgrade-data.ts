/** Auto-derived upgrade constants from game-kitchen foxhole data. */
export const LEGACY_PLAN_SAVE_VERSION = '1.0.5' as const;

/** Board meter scale constants from legacy game.js */
export const LEGACY_METER_BOARD_PIXEL_SIZE = 32;
export const LEGACY_METER_TEXTURE_PIXEL_SIZE = 52.8;
export const LEGACY_METER_TEXTURE_PIXEL_SCALE = LEGACY_METER_TEXTURE_PIXEL_SIZE / LEGACY_METER_BOARD_PIXEL_SIZE;
export const LEGACY_REGION_WIDTH = 2183.9999 * LEGACY_METER_BOARD_PIXEL_SIZE;
export const LEGACY_REGION_HEIGHT = 1889.9999 * LEGACY_METER_BOARD_PIXEL_SIZE;

/** Crane reposition distance used by 1.0.1 → 1.0.2 upgrade (board pixels). */
export const LEGACY_CRANE_UPGRADE_OFFSET = 215 / LEGACY_METER_TEXTURE_PIXEL_SCALE;

export type LegacyPlanMapData = {
    key: string;
    gridCoord: { x: number; y: number; };
};

export type LegacyPlanBuildingUpgradeFlags = {
    isBezier?: boolean;
    hasHandle?: boolean;
};

export const LEGACY_PLAN_MAPS: Readonly<Record<string, LegacyPlanMapData>> = {
    AcrithiaHex: { key: 'AcrithiaHex', gridCoord: { x: 1, y: 2 } },
    AllodsBightHex: { key: 'AllodsBightHex', gridCoord: { x: 2, y: 0 } },
    AshFieldsHex: { key: 'AshFieldsHex', gridCoord: { x: -2, y: 3 } },
    BasinSionnachHex: { key: 'BasinSionnachHex', gridCoord: { x: 0, y: -3 } },
    CallahansPassageHex: { key: 'CallahansPassageHex', gridCoord: { x: 0, y: -1 } },
    CallumsCapeHex: { key: 'CallumsCapeHex', gridCoord: { x: -2, y: -1 } },
    ClahstraHex: { key: 'ClahstraHex', gridCoord: { x: 2, y: -1 } },
    ClansheadValleyHex: { key: 'ClansheadValleyHex', gridCoord: { x: 2, y: -3 } },
    DeadLandsHex: { key: 'DeadLandsHex', gridCoord: { x: 0, y: 0 } },
    DrownedValeHex: { key: 'DrownedValeHex', gridCoord: { x: 1, y: 0 } },
    EndlessShoreHex: { key: 'EndlessShoreHex', gridCoord: { x: 3, y: -1 } },
    FarranacCoastHex: { key: 'FarranacCoastHex', gridCoord: { x: -3, y: 1 } },
    FishermansRowHex: { key: 'FishermansRowHex', gridCoord: { x: -4, y: 2 } },
    GodcroftsHex: { key: 'GodcroftsHex', gridCoord: { x: 4, y: -3 } },
    GreatMarchHex: { key: 'GreatMarchHex', gridCoord: { x: 0, y: 2 } },
    GutterHex: { key: 'GutterHex', gridCoord: { x: -4, y: 1 } },
    HeartlandsHex: { key: 'HeartlandsHex', gridCoord: { x: -1, y: 2 } },
    HowlCountyHex: { key: 'HowlCountyHex', gridCoord: { x: 1, y: -3 } },
    KalokaiHex: { key: 'KalokaiHex', gridCoord: { x: 0, y: 3 } },
    KingsCageHex: { key: 'KingsCageHex', gridCoord: { x: -2, y: 1 } },
    KuuraStrandHex: { key: 'KuuraStrandHex', gridCoord: { x: -4, y: 0 } },
    LinnMercyHex: { key: 'LinnMercyHex', gridCoord: { x: -1, y: 0 } },
    LochMorHex: { key: 'LochMorHex', gridCoord: { x: -1, y: 1 } },
    LykosIsleHex: { key: 'LykosIsleHex', gridCoord: { x: 5, y: -3 } },
    MooringCountyHex: { key: 'MooringCountyHex', gridCoord: { x: -1, y: -1 } },
    MorgensCrossingHex: { key: 'MorgensCrossingHex', gridCoord: { x: 3, y: -3 } },
    NevishLineHex: { key: 'NevishLineHex', gridCoord: { x: -3, y: 0 } },
    OarbreakerHex: { key: 'OarbreakerHex', gridCoord: { x: -5, y: 3 } },
    OlavisWakeHex: { key: 'OlavisWakeHex', gridCoord: { x: -6, y: 2 } },
    OnyxHex: { key: 'OnyxHex', gridCoord: { x: 4, y: 0 } },
    OriginHex: { key: 'OriginHex', gridCoord: { x: -3, y: 3 } },
    PalantineBermHex: { key: 'PalantineBermHex', gridCoord: { x: -5, y: 2 } },
    PariPeakHex: { key: 'PariPeakHex', gridCoord: { x: -5, y: 1 } },
    PipersEnclaveHex: { key: 'PipersEnclaveHex', gridCoord: { x: 6, y: -2 } },
    ReachingTrailHex: { key: 'ReachingTrailHex', gridCoord: { x: 0, y: -2 } },
    ReaversPassHex: { key: 'ReaversPassHex', gridCoord: { x: 3, y: 0 } },
    RedRiverHex: { key: 'RedRiverHex', gridCoord: { x: -1, y: 3 } },
    SableportHex: { key: 'SableportHex', gridCoord: { x: -2, y: 2 } },
    ShackledChasmHex: { key: 'ShackledChasmHex', gridCoord: { x: 1, y: 1 } },
    SpeakingWoodsHex: { key: 'SpeakingWoodsHex', gridCoord: { x: -1, y: -2 } },
    StemaLandingHex: { key: 'StemaLandingHex', gridCoord: { x: -4, y: 3 } },
    StlicanShelfHex: { key: 'StlicanShelfHex', gridCoord: { x: 3, y: -2 } },
    StonecradleHex: { key: 'StonecradleHex', gridCoord: { x: -2, y: 0 } },
    TempestIslandHex: { key: 'TempestIslandHex', gridCoord: { x: 4, y: -2 } },
    TerminusHex: { key: 'TerminusHex', gridCoord: { x: 2, y: 1 } },
    TheFingersHex: { key: 'TheFingersHex', gridCoord: { x: 5, y: -2 } },
    TyrantFoothillsHex: { key: 'TyrantFoothillsHex', gridCoord: { x: 5, y: -1 } },
    UmbralWildwoodHex: { key: 'UmbralWildwoodHex', gridCoord: { x: 0, y: 1 } },
    ViperPitHex: { key: 'ViperPitHex', gridCoord: { x: 1, y: -2 } },
    WeatheredExpanseHex: { key: 'WeatheredExpanseHex', gridCoord: { x: 2, y: -2 } },
    WestgateHex: { key: 'WestgateHex', gridCoord: { x: -3, y: 2 } },
    WrestaHex: { key: 'WrestaHex', gridCoord: { x: 4, y: -1 } },
};

export const LEGACY_PLAN_BUILDING_FLAGS: Readonly<Record<string, LegacyPlanBuildingUpgradeFlags>> = {
    barbedwirespline: { isBezier: true, hasHandle: true },
    barbedwirewallspline: { isBezier: true, hasHandle: true },
    catwalk_bridge: { hasHandle: true },
    fieldbridge: { hasHandle: true },
    fieldpier: { hasHandle: true },
    minespline: { hasHandle: true },
    pipeline: { isBezier: true, hasHandle: true },
    pipeline_overhead: { hasHandle: true },
    pipeline_underground: { isBezier: true, hasHandle: true },
    power_line: { hasHandle: true },
    provisional_road: { isBezier: true, hasHandle: true },
    rail_large_crane: { hasHandle: true },
    rail_large_gauge: { isBezier: true, hasHandle: true },
    rail_small_gauge: { isBezier: true, hasHandle: true },
    sandbaghalfspline: { isBezier: true, hasHandle: true },
    surfacewaterminespline: { hasHandle: true },
    tankstopsplinet3: { isBezier: true, hasHandle: true },
    trenchconnectort1: { isBezier: true, hasHandle: true },
    wallsplinet1: { hasHandle: true },
    waterminespline: { hasHandle: true },
    world_road: { isBezier: true, hasHandle: true },
};
