import type {
    NixieSettingDefinition,
    ProjectSettingDefinition,
    UserSettingDefinition,
} from '#nixie/plugins/nixie/registry/types.ts';
import type { NixieProjectSettings } from '#nixie/plugins/nixie/project.ts';
import {
    FOXHOLE_MAP_SETTINGS_PAGE_SECTION,
    FOXHOLE_MAP_VIEW_SETTINGS_PAGE_SECTION,
    withSettingsPageSection,
} from './settings-page-sections.ts';

export const FOXHOLE_MAP_LAYER_DEFINITIONS = {
    colors: {
        name: 'Improved Map Mod',
        alias: 'IMM Topo',
        description: 'A variant of the default map for Foxhole with more contrast colors and better detail.',
        disables: ['base_map', 'base_map_full'],
    },
    base_map: {
        name: 'Base Map',
        alias: 'IMM Base',
        description: 'The base Improved Map Mod layer.',
        disables: ['colors', 'base_map_full'],
    },
    base_map_full: {
        name: 'Base Map Full',
        alias: 'IMM Full',
        description: 'The full-detail Improved Map Mod base layer.',
        disables: ['colors', 'base_map'],
    },
    background: {
        name: 'World',
        alias: 'World',
        description: 'A high-definition background of the world map.',
    },
    grid: {
        name: 'Grid',
        alias: 'Grid',
        description: 'A grid overlay for the map.',
    },
    names: {
        name: 'Names',
        alias: 'Regions',
        description: 'A labels overlay of region names for the map.',
    },
    majorLabels: {
        name: 'Bases',
        alias: 'Towns',
        description: 'A labels overlay of captureable divisions for the map.',
    },
    minorLabels: {
        name: 'Sub-div',
        alias: 'Districts',
        description: 'A labels overlay of sub-divisions for the map.',
    },
    victoryTownBadges: {
        name: 'Victory Towns',
        alias: 'V-Towns',
        description: 'Show faction-tiered victory town badges for each region when zoomed out.',
    },
    hourlyCasualties: {
        name: 'Hourly Casualties',
        alias: 'KIA / H',
        description: 'Show Colonial and Warden hourly casualties for each region when zoomed out.',
        disables: ['totalCasualties'],
    },
    totalCasualties: {
        name: 'Total Casualties',
        alias: 'KIA Total',
        description: 'Show Colonial and Warden total casualties for each region when zoomed out.',
        disables: ['hourlyCasualties'],
    },
    borders: {
        name: 'Borders',
        alias: 'Borders',
        description: 'A borders overlay for the map.',
    },
    voronoi: {
        name: 'Voronoi',
        alias: 'Divisions',
        description: 'A sub-region voronoi overlay for the map.',
    },
    faction: {
        name: 'Faction',
        alias: 'Faction',
        description: 'A shaded faction overlay for the map.',
    },
    frontline: {
        name: 'Frontline',
        alias: 'Front',
        description: 'Highlight the inferred frontline on the map.',
        disables: ['frontAlt'],
    },
    frontAlt: {
        name: 'Front Alt',
        alias: 'Front Alt',
        description: 'Highlight the alternative inferred frontline overlay on the map.',
        disables: ['frontline'],
    },
    hotspots: {
        name: 'Hotspots',
        alias: 'Hotspots',
        description: 'Highlight active combat hotspots on the map.',
    },
    icons: {
        name: 'Icons',
        alias: 'Icons',
        description: 'An icon overlay for the map.',
    },
    roads: {
        name: 'Roads',
        alias: 'Road',
        description: 'A roads overlay for the map.',
        disables: ['roads_tiers'],
    },
    roads_tiers: {
        name: 'Road Tiers',
        alias: 'Road Tiers',
        description: 'A roads overlay for the map with colored tiers.',
        disables: ['roads'],
    },
    rdz: {
        name: 'Rapid Decay Zone',
        alias: 'RDZ (Red)',
        description: 'A rapid decay zone overlay for the map.',
        disables: ['dark_rdz'],
    },
    dark_rdz: {
        name: 'Dark Rapid Decay Zone',
        alias: 'RDZ (Dark)',
        description: 'A dark variant of the rapid decay zone overlay for the map.',
        disables: ['rdz'],
    },
    glaciers: {
        name: 'Glaciers',
        alias: 'Glaciers',
        description: 'A glaciers overlay for the map.',
    },
    bulwark: {
        name: 'Bulwark',
        alias: 'Bulwark',
        description: 'A bulwark overlay for the map.',
    },
    rail_bridge: {
        name: 'Rail Bridge',
        alias: 'Rail',
        description: 'A rail bridge overlay for the map.',
    },
    rocks: {
        name: 'Rocks',
        alias: 'Rocks',
        description: 'A rocks overlay for the map.',
    },
    underwater_rocks_stripes: {
        name: 'Underwater Rocks Stripes',
        alias: 'UW Rocks',
        description: 'An underwater rocks stripes overlay for the map.',
    },
} as const;

export type FoxholeMapLayerKey = keyof typeof FOXHOLE_MAP_LAYER_DEFINITIONS;

export const FOXHOLE_MAP_LAYER_GROUPS = [
    {
        heading: 'Labels',
        layers: ['names', 'majorLabels', 'minorLabels', 'victoryTownBadges', 'hourlyCasualties', 'totalCasualties'],
    },
    {
        heading: 'Layers',
        layers: ['background', 'grid', 'borders', 'voronoi', 'faction', 'frontline', 'frontAlt', 'hotspots', 'icons'],
    },
    {
        heading: 'Improved Map Mod',
        subheading: 'by Rust',
        layers: ['base_map', 'colors', 'base_map_full', 'roads', 'roads_tiers', 'rdz', 'dark_rdz', 'glaciers', 'bulwark', 'rail_bridge', 'rocks', 'underwater_rocks_stripes'],
    },
] as const satisfies ReadonlyArray<{
    heading: string;
    subheading?: string;
    layers: readonly FoxholeMapLayerKey[];
}>;

export const FOXHOLE_MAP_ICON_CATEGORY_KEYS = ['bases', 'resources', 'structures'] as const;

export type FoxholeMapIconCategoryKey = typeof FOXHOLE_MAP_ICON_CATEGORY_KEYS[number];

export interface FoxholeMapSettings {
    enabled: boolean;
    shardId: string;
    regionKeys: string[];
    background: boolean;
    grid: boolean;
    names: boolean;
    majorLabels: boolean;
    minorLabels: boolean;
    victoryTownBadges: boolean;
    hourlyCasualties: boolean;
    totalCasualties: boolean;
    borders: boolean;
    voronoi: boolean;
    faction: boolean;
    frontline: boolean;
    frontAlt: boolean;
    hotspots: boolean;
    icons: boolean;
    colors: boolean;
    baseMap: boolean;
    baseMapFull: boolean;
    roads: boolean;
    roadsTiers: boolean;
    rdz: boolean;
    darkRdz: boolean;
    glaciers: boolean;
    bulwark: boolean;
    railBridge: boolean;
    rocks: boolean;
    underwaterRocksStripes: boolean;
    modded: boolean;
    darkBackground: boolean;
    coloredIcons: boolean;
    lockCameraToMap: boolean;
    eventFeedToasts: boolean;
    iconBlacklist: string[];
    iconCategories: Record<FoxholeMapIconCategoryKey, boolean>;
    cropEnabled: boolean;
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
}

export const FOXHOLE_MAP_SETTING_KEYS = {
    enabled: 'foxhole.map.enabled',
    shardId: 'foxhole.map.shardId',
    regionKeys: 'foxhole.map.regionKeys',
    background: 'foxhole.map.background',
    grid: 'foxhole.map.grid',
    names: 'foxhole.map.names',
    majorLabels: 'foxhole.map.majorLabels',
    minorLabels: 'foxhole.map.minorLabels',
    victoryTownBadges: 'foxhole.map.victoryTownBadges',
    hourlyCasualties: 'foxhole.map.hourlyCasualties',
    totalCasualties: 'foxhole.map.totalCasualties',
    borders: 'foxhole.map.borders',
    voronoi: 'foxhole.map.voronoi',
    faction: 'foxhole.map.faction',
    frontline: 'foxhole.map.frontline',
    frontAlt: 'foxhole.map.frontAlt',
    hotspots: 'foxhole.map.hotspots',
    icons: 'foxhole.map.icons',
    colors: 'foxhole.map.colors',
    baseMap: 'foxhole.map.base_map',
    baseMapFull: 'foxhole.map.base_map_full',
    roads: 'foxhole.map.roads',
    roadsTiers: 'foxhole.map.roads_tiers',
    rdz: 'foxhole.map.rdz',
    darkRdz: 'foxhole.map.dark_rdz',
    glaciers: 'foxhole.map.glaciers',
    bulwark: 'foxhole.map.bulwark',
    railBridge: 'foxhole.map.rail_bridge',
    rocks: 'foxhole.map.rocks',
    underwaterRocksStripes: 'foxhole.map.underwater_rocks_stripes',
    modded: 'foxhole.map.modded',
    darkBackground: 'foxhole.map.darkBackground',
    coloredIcons: 'foxhole.map.coloredIcons',
    lockCameraToMap: 'foxhole.map.lockCameraToMap',
    eventFeedToasts: 'foxhole.map.eventFeedToasts',
    iconBlacklist: 'foxhole.map.iconBlacklist',
    iconCategoryBases: 'foxhole.map.iconCategories.bases',
    iconCategoryResources: 'foxhole.map.iconCategories.resources',
    iconCategoryStructures: 'foxhole.map.iconCategories.structures',
    cropEnabled: 'foxhole.map.crop.enabled',
    cropX: 'foxhole.map.crop.x',
    cropY: 'foxhole.map.crop.y',
    cropWidth: 'foxhole.map.crop.width',
    cropHeight: 'foxhole.map.crop.height',
} as const;

function createBooleanProjectSetting(
    projectKey: string,
    name: string,
    description: string,
    icon: string,
    order: number,
    defaultValue: boolean,
): ProjectSettingDefinition {
    return {
        id: projectKey,
        scope: 'project',
        type: 'boolean',
        name,
        description,
        icon,
        group: 'project',
        order,
        defaultValue,
        projectKey,
    };
}

function createStringProjectSetting(
    projectKey: string,
    name: string,
    description: string,
    icon: string,
    order: number,
    defaultValue = '',
): ProjectSettingDefinition {
    return {
        id: projectKey,
        scope: 'project',
        type: 'string',
        name,
        description,
        icon,
        group: 'project',
        order,
        defaultValue,
        projectKey,
    };
}

function createBooleanUserSetting(
    settingId: string,
    name: string,
    description: string,
    icon: string,
    order: number,
    defaultValue: boolean,
    options: {
        persist?: 'account' | 'local';
    } = {},
): UserSettingDefinition {
    return {
        id: settingId,
        scope: 'user',
        type: 'boolean',
        ...(options.persist ? { persist: options.persist } : {}),
        name,
        description,
        icon,
        group: 'general',
        order,
        defaultValue,
    };
}

function createStringUserSetting(
    settingId: string,
    name: string,
    description: string,
    icon: string,
    order: number,
    defaultValue = '',
): UserSettingDefinition {
    return {
        id: settingId,
        scope: 'user',
        type: 'string',
        name,
        description,
        icon,
        group: 'general',
        order,
        defaultValue,
    };
}

function createNumberProjectSetting(
    projectKey: string,
    name: string,
    description: string,
    icon: string,
    order: number,
    defaultValue: number,
    options?: {
        disabled?: ProjectSettingDefinition['disabled'];
    },
): ProjectSettingDefinition {
    return {
        id: projectKey,
        scope: 'project',
        type: 'number',
        name,
        description,
        icon,
        group: 'project',
        order,
        defaultValue,
        min: 0,
        step: 1,
        disabled: options?.disabled,
        projectKey,
    };
}

export const foxholeMapProjectSettings: readonly ProjectSettingDefinition[] = withSettingsPageSection([
    createBooleanProjectSetting(
        FOXHOLE_MAP_SETTING_KEYS.enabled,
        'Foxhole Map Enabled',
        'Render the Foxhole world map behind board content in the active project.',
        'ph:map-trifold',
        200,
        false,
    ),
    createStringProjectSetting(
        FOXHOLE_MAP_SETTING_KEYS.shardId,
        'Foxhole Map Shard',
        'Foxhole shard identifier used for live map data.',
        'ph:share-network',
        201,
    ),
    createStringProjectSetting(
        FOXHOLE_MAP_SETTING_KEYS.regionKeys,
        'Foxhole Map Regions',
        'Comma-separated list of selected Foxhole region keys. Leave empty to show all regions.',
        'ph:hexagon',
        202,
    ),
    createBooleanProjectSetting(
        FOXHOLE_MAP_SETTING_KEYS.cropEnabled,
        'Foxhole Map Crop',
        'Apply a crop mask to the Foxhole world map using the stored crop bounds.',
        'ph:crop',
        232,
        false,
    ),
    createNumberProjectSetting(
        FOXHOLE_MAP_SETTING_KEYS.cropX,
        'Foxhole Map Crop X',
        'Crop mask left position in world units.',
        'ph:arrows-left-right',
        233,
        0,
        {
            disabled: ({ getValue }) => getValue(FOXHOLE_MAP_SETTING_KEYS.cropEnabled) === false,
        },
    ),
    createNumberProjectSetting(
        FOXHOLE_MAP_SETTING_KEYS.cropY,
        'Foxhole Map Crop Y',
        'Crop mask top position in world units.',
        'ph:arrows-down-up',
        234,
        0,
        {
            disabled: ({ getValue }) => getValue(FOXHOLE_MAP_SETTING_KEYS.cropEnabled) === false,
        },
    ),
    createNumberProjectSetting(
        FOXHOLE_MAP_SETTING_KEYS.cropWidth,
        'Foxhole Map Crop Width',
        'Crop mask width in world units.',
        'ph:arrows-horizontal',
        235,
        0,
        {
            disabled: ({ getValue }) => getValue(FOXHOLE_MAP_SETTING_KEYS.cropEnabled) === false,
        },
    ),
    createNumberProjectSetting(
        FOXHOLE_MAP_SETTING_KEYS.cropHeight,
        'Foxhole Map Crop Height',
        'Crop mask height in world units.',
        'ph:arrows-vertical',
        236,
        0,
        {
            disabled: ({ getValue }) => getValue(FOXHOLE_MAP_SETTING_KEYS.cropEnabled) === false,
        },
    ),
], FOXHOLE_MAP_SETTINGS_PAGE_SECTION);

export const foxholeMapUserSettings: readonly UserSettingDefinition[] = withSettingsPageSection([
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.background,
        'Foxhole Map Background',
        'Show the Foxhole world background behind the region tiles.',
        'ph:image',
        202,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.grid,
        'Foxhole Map Grid',
        'Show the Foxhole world grid layer.',
        'ph:grid-four',
        203,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.names,
        'Foxhole Map Names',
        'Show region labels on the Foxhole world map.',
        'ph:text-t',
        204,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.majorLabels,
        'Foxhole Map Major Labels',
        'Show major location labels on the Foxhole world map.',
        'ph:map-pin-area',
        205,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.minorLabels,
        'Foxhole Map Minor Labels',
        'Show minor location labels on the Foxhole world map.',
        'ph:map-pin',
        206,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.victoryTownBadges,
        'Foxhole Map Victory Town Badges',
        'Show faction-tiered victory town badges for each region when zoomed out.',
        'ph:castle-turret',
        206.125,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.hourlyCasualties,
        'Foxhole Map Hourly Casualties',
        'Show Colonial and Warden hourly casualties for each region when zoomed out.',
        'ph:chart-line',
        206.25,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.totalCasualties,
        'Foxhole Map Total Casualties',
        'Show Colonial and Warden total casualties for each region when zoomed out.',
        'ph:hash',
        206.5,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.borders,
        'Foxhole Map Borders',
        'Draw region borders on the Foxhole world map.',
        'ph:square',
        207,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.voronoi,
        'Foxhole Map Voronoi',
        'Show the Voronoi overlay on the Foxhole world map.',
        'ph:polygon',
        208,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.faction,
        'Foxhole Map Faction',
        'Show faction ownership shading on the Foxhole world map.',
        'ph:flag',
        209,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.frontline,
        'Foxhole Map Frontline',
        'Show the inferred frontline overlay on the Foxhole world map.',
        'ph:sword',
        209.25,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.frontAlt,
        'Foxhole Map Front Alt',
        'Show the alternative inferred frontline overlay on the Foxhole world map.',
        'ph:path',
        209.375,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.hotspots,
        'Foxhole Map Hotspots',
        'Show active combat hotspot highlights on the Foxhole world map.',
        'ph:fire',
        209.5,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.icons,
        'Foxhole Map Icons',
        'Show strategic icons on the Foxhole world map.',
        'ph:star',
        210,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.colors,
        'Foxhole Map Improved Colors',
        'Enable the Improved Map Mod color layer.',
        'ph:palette',
        211,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.baseMap,
        'Foxhole Map Base Map',
        'Enable the Improved Map Mod base layer.',
        'ph:crosshair',
        212,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.baseMapFull,
        'Foxhole Map Base Map Full',
        'Enable the full-detail Improved Map Mod base layer.',
        'ph:resize',
        213,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.roads,
        'Foxhole Map Roads',
        'Enable the roads overlay.',
        'ph:road-horizon',
        214,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.roadsTiers,
        'Foxhole Map Road Tiers',
        'Enable the color-tiered roads overlay.',
        'ph:roads',
        215,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.rdz,
        'Foxhole Map RDZ',
        'Enable the red rapid decay zone overlay.',
        'ph:warning-circle',
        216,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.darkRdz,
        'Foxhole Map Dark RDZ',
        'Enable the dark rapid decay zone overlay.',
        'ph:moon-stars',
        217,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.glaciers,
        'Foxhole Map Glaciers',
        'Enable the glaciers overlay.',
        'ph:snowflake',
        218,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.bulwark,
        'Foxhole Map Bulwark',
        'Enable the Bulwark overlay.',
        'ph:wall',
        219,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.railBridge,
        'Foxhole Map Rail Bridge',
        'Enable the rail bridge overlay.',
        'ph:train',
        220,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.rocks,
        'Foxhole Map Rocks',
        'Enable the rocks overlay.',
        'ph:mountains',
        221,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.underwaterRocksStripes,
        'Foxhole Map Underwater Rocks',
        'Enable the underwater rocks stripes overlay.',
        'ph:waves',
        222,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.modded,
        'Foxhole Map Modded Layer',
        'Show your locally imported custom map mod underlay when available. Stored on this device only and not shared with collaborators.',
        'ph:puzzle-piece',
        223,
        false,
        { persist: 'local' },
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.darkBackground,
        'Foxhole Map Dark Background',
        'Use the dark Foxhole world background.',
        'ph:moon-stars',
        224,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.coloredIcons,
        'Foxhole Map Colored Icons',
        'Use colored strategic icons when available.',
        'ph:drop',
        225,
        false,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.lockCameraToMap,
        'Foxhole Map Camera Lock',
        'Clamp camera movement to Foxhole map bounds only for your editor view.',
        'ph:lock-key',
        226,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.eventFeedToasts,
        'Foxhole Map Event Toasts',
        'Show live toast notifications for Foxhole war history events on the active shard only for you.',
        'ph:bell',
        227,
        true,
    ),
    createStringUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.iconBlacklist,
        'Foxhole Map Icon Blacklist',
        'Comma-separated list of hidden Foxhole map icon keys for your local map view.',
        'ph:eye-slash',
        228,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.iconCategoryBases,
        'Foxhole Map Base Icons',
        'Show base icons on the Foxhole world map in your local map view.',
        'ph:castle-turret',
        229,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.iconCategoryResources,
        'Foxhole Map Resource Icons',
        'Show resource icons on the Foxhole world map in your local map view.',
        'ph:pickaxe',
        230,
        true,
    ),
    createBooleanUserSetting(
        FOXHOLE_MAP_SETTING_KEYS.iconCategoryStructures,
        'Foxhole Map Structure Icons',
        'Show structure icons on the Foxhole world map in your local map view.',
        'ph:factory',
        231,
        true,
    ),
], FOXHOLE_MAP_VIEW_SETTINGS_PAGE_SECTION);

export const foxholeMapSettings: readonly NixieSettingDefinition[] = [
    ...foxholeMapProjectSettings,
    ...foxholeMapUserSettings,
];

const FOXHOLE_MAP_USER_SETTING_KEYS = new Set<string>(foxholeMapUserSettings.map(definition => definition.id));

export function isFoxholeMapUserSettingKey(settingId: string): boolean {
    return FOXHOLE_MAP_USER_SETTING_KEYS.has(String(settingId ?? '').trim());
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readStringList(value: unknown): string[] {
    if (typeof value !== 'string') {
        return [];
    }

    return value
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
}

export function serializeFoxholeMapStringList(values: readonly string[]): string {
    return Array.from(new Set(values.map(entry => String(entry ?? '').trim()).filter(Boolean))).join(',');
}

function readSettingValue(
    settings: Partial<NixieProjectSettings>,
    settingId: string,
    getUserSetting?: ((settingId: string) => unknown) | null,
): unknown {
    if (!getUserSetting || !isFoxholeMapUserSettingKey(settingId)) {
        return settings[settingId];
    }

    const userValue = getUserSetting(settingId);
    return typeof userValue === 'undefined' ? settings[settingId] : userValue;
}

export function readFoxholeMapSettings(
    settings: Partial<NixieProjectSettings> | null | undefined,
    getUserSetting?: ((settingId: string) => unknown) | null,
): FoxholeMapSettings {
    const source = settings ?? {};
    const readBooleanSetting = (settingId: string, fallback: boolean): boolean => {
        return readBoolean(readSettingValue(source, settingId, getUserSetting), fallback);
    };
    const readNumberSetting = (settingId: string, fallback: number): number => {
        return readNumber(readSettingValue(source, settingId, getUserSetting), fallback);
    };
    const readStringSetting = (settingId: string): string => {
        return String(readSettingValue(source, settingId, getUserSetting) ?? '').trim();
    };
    const readStringListSetting = (settingId: string): string[] => {
        return readStringList(readSettingValue(source, settingId, getUserSetting));
    };

    const hourlyCasualties = readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.hourlyCasualties, true);
    const totalCasualties = !hourlyCasualties && readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.totalCasualties, false);
    const frontAlt = readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.frontAlt, false);
    const frontline = !frontAlt && readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.frontline, false);

    return {
        enabled: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.enabled, false),
        shardId: readStringSetting(FOXHOLE_MAP_SETTING_KEYS.shardId),
        regionKeys: readStringListSetting(FOXHOLE_MAP_SETTING_KEYS.regionKeys),
        background: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.background, true),
        grid: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.grid, false),
        names: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.names, true),
        majorLabels: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.majorLabels, true),
        minorLabels: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.minorLabels, true),
        victoryTownBadges: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.victoryTownBadges, true),
        hourlyCasualties,
        totalCasualties,
        borders: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.borders, true),
        voronoi: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.voronoi, true),
        faction: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.faction, true),
        frontline,
        frontAlt,
        hotspots: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.hotspots, true),
        icons: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.icons, true),
        colors: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.colors, false),
        baseMap: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.baseMap, false),
        baseMapFull: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.baseMapFull, false),
        roads: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.roads, false),
        roadsTiers: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.roadsTiers, false),
        rdz: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.rdz, false),
        darkRdz: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.darkRdz, false),
        glaciers: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.glaciers, false),
        bulwark: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.bulwark, false),
        railBridge: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.railBridge, false),
        rocks: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.rocks, false),
        underwaterRocksStripes: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.underwaterRocksStripes, false),
        modded: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.modded, false),
        darkBackground: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.darkBackground, true),
        coloredIcons: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.coloredIcons, false),
        lockCameraToMap: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.lockCameraToMap, true),
        eventFeedToasts: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.eventFeedToasts, true),
        iconBlacklist: readStringListSetting(FOXHOLE_MAP_SETTING_KEYS.iconBlacklist),
        iconCategories: {
            bases: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.iconCategoryBases, true),
            resources: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.iconCategoryResources, true),
            structures: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.iconCategoryStructures, true),
        },
        cropEnabled: readBooleanSetting(FOXHOLE_MAP_SETTING_KEYS.cropEnabled, false),
        cropX: readNumberSetting(FOXHOLE_MAP_SETTING_KEYS.cropX, 0),
        cropY: readNumberSetting(FOXHOLE_MAP_SETTING_KEYS.cropY, 0),
        cropWidth: readNumberSetting(FOXHOLE_MAP_SETTING_KEYS.cropWidth, 0),
        cropHeight: readNumberSetting(FOXHOLE_MAP_SETTING_KEYS.cropHeight, 0),
    };
}
