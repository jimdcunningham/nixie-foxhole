/**
 * Legacy Foxhole Planner (.plan) save types at ceiling version 1.0.5.
 * Field surface derived from game-kitchen onSave serializers.
 */

export const LEGACY_PLAN_CURRENT_VERSION = '1.0.5' as const;

export type LegacyPlanProperty = {
    key: string;
    type?: string;
    value?: unknown;
};

export type LegacyPlanLayer = {
    id: number;
    name: string;
    visible?: boolean;
    locked?: boolean;
    zIndex?: number;
    selected?: boolean;
};

export type LegacyPlanProjectSettings = {
    compressed?: boolean;
    width?: number | null;
    height?: number | null;
    shardId?: string;
    regionKey?: string;
    regionKeys?: string[];
    showWorldRegion?: boolean;
    regionCrop?: { x?: number; y?: number; };
    region?: {
        background?: boolean;
        grid?: boolean;
        icons?: boolean;
    };
    ranges?: {
        crane?: boolean;
        killbox?: boolean;
    };
    [key: string]: unknown;
};

export type LegacyPlanBezierPoint = {
    x: number;
    y: number;
    rotation?: number;
};

export type LegacyPlanLinePoint = {
    x: number;
    y: number;
    icon?: string;
};

export type LegacyPlanProductionOrder = {
    id: number;
    parent?: number | boolean | null;
    cycles?: number;
    label?: string;
};

export type LegacyPlanConnections = Record<string, Record<string, number | string>>;

export type LegacyPlanEntity = {
    id: number;
    type?: string;
    key?: string;
    subtype?: string;
    x?: number;
    y?: number;
    z?: number;
    rotation?: number;
    locked?: boolean;
    name?: string;
    tint?: number | string;
    brightness?: number;
    layer?: number;
    sortOffset?: number;
    properties?: LegacyPlanProperty[];

    // Geometry
    width?: number;
    height?: number;
    radius?: number;
    polygon?: number[];
    points?: LegacyPlanLinePoint[];
    stroke?: number[];
    bezier?: LegacyPlanBezierPoint[];
    handlePoint?: { x?: number; y?: number; rotation?: number; };
    handlePoints?: Array<{ x: number; y: number; }>;
    railPoints?: Array<{ x: number; y: number; rotation?: number; }>;

    // Shapes / text / images
    label?: string;
    labelStyle?: Record<string, unknown>;
    shapeStyle?: Record<string, unknown>;
    textureFile?: string;
    textureData?: string;
    tile?: string;
    tileset?: string | number;

    // Foxhole building extras
    faction?: string;
    blueprint?: boolean;
    packaged?: boolean;
    disableProduction?: boolean;
    baseUpgrades?: Record<string, string>;
    productionOrders?: LegacyPlanProductionOrder[];
    selectedProduction?: number;
    baseProduction?: number | boolean | null;
    productionScale?: number;
    inventoryItems?: string[];
    stockpileItems?: string[];
    maintenanceFilters?: Record<string, unknown>;
    postExtension?: number;
    modslots?: Record<string, string | null | undefined>;
    connections?: LegacyPlanConnections;
    currentTrackId?: number;
    currentTrackT?: number;
    trackDirection?: number;
    trainCarId?: number;
    carriageType?: 'front' | 'back' | string;

    // Misc / transitional
    upgrading?: boolean;
    mode?: string;
    preset?: boolean;
    dataFile?: string;
    sendToBackground?: boolean;

    [key: string]: unknown;
};

export type LegacyPlanSave = {
    version?: string;
    name?: string;
    description?: string;
    authors?: string;
    tags?: string[];
    properties?: LegacyPlanProperty[];
    faction?: string;
    projectSettings?: LegacyPlanProjectSettings;
    layers?: LegacyPlanLayer[];
    tilesets?: unknown[];
    entities?: LegacyPlanEntity[];
    [key: string]: unknown;
};

export type LegacyPlanArchiveAsset = {
    path: string;
    bytes: Uint8Array;
};

export type LegacyPlanArchiveContents = {
    /** Original archive bytes (never mutated). */
    rawZipBytes: Uint8Array;
    /** Parsed project JSON as found in the archive (pre-upgrade). */
    projectJson: LegacyPlanSave;
    /** Embedded asset files under assets/. */
    assets: LegacyPlanArchiveAsset[];
    /** True when payload came from project.lzma. */
    compressed: boolean;
};
