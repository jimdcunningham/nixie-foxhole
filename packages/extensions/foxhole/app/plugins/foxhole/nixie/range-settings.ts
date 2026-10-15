import type { UserSettingDefinition } from '#nixie/plugins/nixie/registry/types.ts';
import type { FoxholeManifestRange } from './manifest.ts';
import { FOXHOLE_NIGHTTIME_RANGES_SETTING_ID, FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID } from './night-ranges.ts';
import {
    FOXHOLE_DEBUG_SETTINGS_PAGE_SECTION,
    FOXHOLE_RANGES_SETTINGS_PAGE_SECTION,
    withDevSettingsAccess,
    withSettingsPageSection,
} from './settings-page-sections.ts';

export const FOXHOLE_RANGE_SETTING_GROUP = 'foxhole.ranges';

export const FOXHOLE_RANGE_OVERLAY_DEFINITIONS = {
    supply: { label: 'Supply', description: 'Show maintenance supply coverage ranges.', icon: 'ph:package', type: 'preventDecay', color: 0x4ECDC4 },
    garrison: { label: 'Garrison', description: 'Show garrison coverage ranges.', icon: 'ph:shield-check', type: 'garrison', color: 0xD2B48C },
    harvest: { label: 'Harvest', description: 'Show resource field ranges.', icon: 'ph:plant', type: 'resourceField', color: 0x5BC0FF },
    crane: { label: 'Crane', description: 'Show crane operating ranges.', icon: 'ph:crane', type: 'crane', color: 0x70D6FF },
    rifle: { label: 'Rifle', description: 'Show rifle garrison ranges.', icon: 'ph:crosshair', type: 'killbox', color: 0xE16931 },
    machineGun: { label: 'MG', description: 'Show machine gun garrison ranges.', icon: 'ph:crosshair-simple', type: 'killboxMG', color: 0x3A86FF },
    antiTank: { label: 'Anti-Tank', description: 'Show anti-tank engagement ranges.', icon: 'ph:tank', type: 'killboxAT', color: 0xF45B69 },
    artillery: { label: 'Artillery', description: 'Show artillery engagement ranges.', icon: 'ph:target', type: 'killboxArty', color: 0xF6D55C },
    rpg: { label: 'RPG', description: 'Show rocket engagement ranges.', icon: 'ph:rocket-launch', type: 'killboxRocket', color: 0xE16931 },
    antiAir: { label: 'Anti-Air', description: 'Show anti-air engagement ranges.', icon: 'ph:airplane-tilt', type: 'killboxAA', color: 0xFF6B35 },
    intel: { label: 'Intel', description: 'Show intelligence coverage ranges.', icon: 'ph:radar', type: 'intel', color: 0x9D7CFF },
    overlap: { label: 'Overlap', description: 'Show crane overlap exclusion ranges.', icon: 'ph:circles-three', type: 'overlap', color: 0xFF6B6B },
} as const;

export type FoxholeRangeOverlayKey = keyof typeof FOXHOLE_RANGE_OVERLAY_DEFINITIONS;

export interface FoxholeRangeSettings {
    selectionOnly: boolean;
    vehicleWeaponsDebug: boolean;
    overlays: Record<FoxholeRangeOverlayKey, boolean>;
}

export interface FoxholeRangeVisibilityContext {
    isVehicle: boolean;
}

export const FOXHOLE_RANGE_SETTING_KEYS = {
    selectionOnly: 'foxhole.ranges.selectionOnly',
    supply: 'foxhole.ranges.supply',
    garrison: 'foxhole.ranges.garrison',
    harvest: 'foxhole.ranges.harvest',
    crane: 'foxhole.ranges.crane',
    rifle: 'foxhole.ranges.rifle',
    machineGun: 'foxhole.ranges.machineGun',
    antiTank: 'foxhole.ranges.antiTank',
    artillery: 'foxhole.ranges.artillery',
    rpg: 'foxhole.ranges.rpg',
    antiAir: 'foxhole.ranges.antiAir',
    intel: 'foxhole.ranges.intel',
    overlap: 'foxhole.ranges.overlap',
    // Retained as fallbacks for saved projects that used the original grouped controls.
    defenseSmallArms: 'foxhole.ranges.defense.smallArms',
    defenseAntiTank: 'foxhole.ranges.defense.antiTank',
    defenseArtillery: 'foxhole.ranges.defense.artillery',
    coverageSupport: 'foxhole.ranges.coverage.support',
    logisticsUtility: 'foxhole.ranges.logistics.utility',
} as const;

export const FOXHOLE_RANGE_DEBUG_SETTING_KEYS = {
    vehicleWeapons: 'foxhole.debug.ranges.vehicleWeapons',
} as const;

export const FOXHOLE_RANGE_OVERLAY_SETTING_IDS = Object.entries(FOXHOLE_RANGE_OVERLAY_DEFINITIONS).map(([key]) => {
    return FOXHOLE_RANGE_SETTING_KEYS[key as FoxholeRangeOverlayKey];
});

const FOXHOLE_RANGE_TYPE_TO_OVERLAY_KEY = Object.entries(FOXHOLE_RANGE_OVERLAY_DEFINITIONS).reduce<Record<string, FoxholeRangeOverlayKey>>((accumulator, [overlayKey, definition]) => {
    accumulator[definition.type] = overlayKey as FoxholeRangeOverlayKey;
    return accumulator;
}, {});

const FOXHOLE_RANGE_COLOR_BY_TYPE: Record<string, number> = {
    killbox: 0xE16931,
    killboxMG: 0x3A86FF,
    killboxAT: 0xF45B69,
    killboxArty: 0xF6D55C,
    killboxRocket: 0xE16931,
    killboxAA: 0xFF6B35,
    garrison: 0xD2B48C,
    intel: 0x9D7CFF,
    resourceField: 0x5BC0FF,
    preventDecay: 0x4ECDC4,
    crane: 0x70D6FF,
    overlap: 0xFF6B6B,
};

function createBooleanUserSetting(
    settingId: string,
    name: string,
    description: string,
    icon: string,
    order: number,
    defaultValue: boolean,
): UserSettingDefinition {
    return {
        id: settingId,
        scope: 'user',
        type: 'boolean',
        name,
        description,
        icon,
        group: 'general',
        order,
        defaultValue,
    };
}

const foxholeLegacyRangeUserSettings: readonly UserSettingDefinition[] = [
    createBooleanUserSetting(FOXHOLE_RANGE_SETTING_KEYS.defenseSmallArms, 'Foxhole Range Small Arms', 'Legacy fallback for rifle and machine gun ranges.', 'ph:crosshair', 0, false),
    createBooleanUserSetting(FOXHOLE_RANGE_SETTING_KEYS.defenseAntiTank, 'Foxhole Range Anti-Tank', 'Legacy fallback for anti-tank ranges.', 'ph:tank', 0, false),
    createBooleanUserSetting(FOXHOLE_RANGE_SETTING_KEYS.defenseArtillery, 'Foxhole Range Artillery', 'Legacy fallback for artillery, RPG, and anti-air ranges.', 'ph:target', 0, false),
    createBooleanUserSetting(FOXHOLE_RANGE_SETTING_KEYS.coverageSupport, 'Foxhole Range Support', 'Legacy fallback for garrison and intel ranges.', 'ph:wifi-high', 0, false),
    createBooleanUserSetting(FOXHOLE_RANGE_SETTING_KEYS.logisticsUtility, 'Foxhole Range Utility', 'Legacy fallback for supply, harvest, crane, and overlap ranges.', 'ph:wrench', 0, false),
].map(setting => ({
    ...setting,
    visible: false,
}));

export const foxholeRangeUserSettings: readonly UserSettingDefinition[] = withSettingsPageSection([
    {
        ...createBooleanUserSetting(FOXHOLE_NIGHTTIME_RANGES_SETTING_ID, 'Nighttime Ranges', 'Preview the smallest AI detection ranges, at midnight.', 'ph:moon', 234, false),
        visible: false,
    },
    {
        ...createBooleanUserSetting(FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID, 'Powered Spotlights', 'Assume powered spotlights for tier 2 and tier 3 rifle, machine gun, and anti-tank bunker garrisons.', 'ph:flashlight', 235, false),
        visible: false,
    },
    createBooleanUserSetting(
        FOXHOLE_RANGE_SETTING_KEYS.selectionOnly,
        'Foxhole Range Selection Overlay',
        'Show range overlays for selected Foxhole structures even when their group is disabled.',
        'ph:cursor-click',
        236,
        true,
    ),
    ...Object.entries(FOXHOLE_RANGE_OVERLAY_DEFINITIONS).map(([key, definition], index) => createBooleanUserSetting(
        FOXHOLE_RANGE_SETTING_KEYS[key as FoxholeRangeOverlayKey],
        `Foxhole Range ${definition.label}`,
        definition.description,
        definition.icon,
        237 + index,
        false,
    )),
    ...foxholeLegacyRangeUserSettings,
], FOXHOLE_RANGES_SETTINGS_PAGE_SECTION);

export const foxholeRangeDebugUserSettings: readonly UserSettingDefinition[] = withSettingsPageSection(withDevSettingsAccess([
    createBooleanUserSetting(
        FOXHOLE_RANGE_DEBUG_SETTING_KEYS.vehicleWeapons,
        'Foxhole Vehicle Weapon Ranges',
        'Show unverified gunner-seat range overlays for Foxhole vehicles.',
        'ph:crosshair-simple',
        249,
        false,
    ),
]), FOXHOLE_DEBUG_SETTINGS_PAGE_SECTION);

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

export function readFoxholeRangeSettings(settings: Partial<Record<string, unknown>> | null | undefined): FoxholeRangeSettings {
    const source = settings ?? {};

    return {
        selectionOnly: readBoolean(source[FOXHOLE_RANGE_SETTING_KEYS.selectionOnly], true),
        vehicleWeaponsDebug: readBoolean(source[FOXHOLE_RANGE_DEBUG_SETTING_KEYS.vehicleWeapons], false),
        overlays: readFoxholeRangeOverlays(settingId => source[settingId]),
    };
}

export function readFoxholeRangeSettingsFromGetter(getValue: (settingId: string) => unknown): FoxholeRangeSettings {
    return {
        selectionOnly: readBoolean(getValue(FOXHOLE_RANGE_SETTING_KEYS.selectionOnly), true),
        vehicleWeaponsDebug: readBoolean(getValue(FOXHOLE_RANGE_DEBUG_SETTING_KEYS.vehicleWeapons), false),
        overlays: readFoxholeRangeOverlays(getValue),
    };
}

function readFoxholeRangeOverlays(getValue: (settingId: string) => unknown): Record<FoxholeRangeOverlayKey, boolean> {
    const legacyFallbacks: Record<FoxholeRangeOverlayKey, string> = {
        supply: FOXHOLE_RANGE_SETTING_KEYS.logisticsUtility,
        garrison: FOXHOLE_RANGE_SETTING_KEYS.coverageSupport,
        harvest: FOXHOLE_RANGE_SETTING_KEYS.logisticsUtility,
        crane: FOXHOLE_RANGE_SETTING_KEYS.logisticsUtility,
        rifle: FOXHOLE_RANGE_SETTING_KEYS.defenseSmallArms,
        machineGun: FOXHOLE_RANGE_SETTING_KEYS.defenseSmallArms,
        antiTank: FOXHOLE_RANGE_SETTING_KEYS.defenseAntiTank,
        artillery: FOXHOLE_RANGE_SETTING_KEYS.defenseArtillery,
        rpg: FOXHOLE_RANGE_SETTING_KEYS.defenseArtillery,
        antiAir: FOXHOLE_RANGE_SETTING_KEYS.defenseArtillery,
        intel: FOXHOLE_RANGE_SETTING_KEYS.coverageSupport,
        overlap: FOXHOLE_RANGE_SETTING_KEYS.logisticsUtility,
    };

    return Object.keys(FOXHOLE_RANGE_OVERLAY_DEFINITIONS).reduce<Record<FoxholeRangeOverlayKey, boolean>>((overlays, key) => {
        const overlayKey = key as FoxholeRangeOverlayKey;
        overlays[overlayKey] = readBoolean(
            getValue(FOXHOLE_RANGE_SETTING_KEYS[overlayKey]),
            readBoolean(getValue(legacyFallbacks[overlayKey]), false),
        );
        return overlays;
    }, {} as Record<FoxholeRangeOverlayKey, boolean>);
}

export function getFoxholeRangeOverlayKey(rangeType: string | null | undefined): FoxholeRangeOverlayKey | null {
    return FOXHOLE_RANGE_TYPE_TO_OVERLAY_KEY[String(rangeType ?? '').trim()] ?? null;
}

export function isFoxholeRangeVisible(
    range: Pick<FoxholeManifestRange, 'type'>,
    settings: FoxholeRangeSettings,
    selected: boolean,
    context: FoxholeRangeVisibilityContext = { isVehicle: false },
): boolean {
    if (context.isVehicle && range.type.startsWith('killbox') && !settings.vehicleWeaponsDebug) {
        return false;
    }

    const overlayKey = getFoxholeRangeOverlayKey(range.type);
    if (!overlayKey) {
        return false;
    }

    if (settings.overlays[overlayKey]) {
        return true;
    }

    return settings.selectionOnly && selected;
}

export function getFoxholeRangeColor(rangeType: string | null | undefined): number {
    const normalizedType = String(rangeType ?? '').trim();
    if (normalizedType && typeof FOXHOLE_RANGE_COLOR_BY_TYPE[normalizedType] === 'number') {
        return FOXHOLE_RANGE_COLOR_BY_TYPE[normalizedType];
    }

    const overlayKey = getFoxholeRangeOverlayKey(rangeType);
    if (overlayKey) {
        return FOXHOLE_RANGE_OVERLAY_DEFINITIONS[overlayKey].color;
    }

    return 0xE7E3DA;
}

export function getFoxholeRangeOverlaySettingKey(overlayKey: FoxholeRangeOverlayKey): string {
    return FOXHOLE_RANGE_SETTING_KEYS[overlayKey];
}
