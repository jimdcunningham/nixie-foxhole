import type { AssetContribution, NixieSettingValue } from '#nixie/plugins/nixie/registry/types.ts';
import type { NixiePaletteBinding, NixieUserSettings } from '#nixie/stores/settings.ts';
import { isNixieRotationDegrees, NIXIE_MOUSE_ROTATION_DEGREES_SETTING_ID, NIXIE_KEYBOARD_ROTATION_DEGREES_SETTING_ID } from '#nixie/utils/nixie-rotation-settings.ts';

export const LEGACY_SETTINGS_MAX_BYTES = 5 * 1024 * 1024;
export const LEGACY_SETTINGS_ASSET_SOURCE = 'foxhole.structures';

export interface LegacySettingsAsset {
    legacyKey: string;
    legacyType: 'building' | 'icon';
    binding: NixiePaletteBinding;
}

export interface LegacySettingsChange {
    source: string;
    label: string;
    value: NixieSettingValue;
    settingId?: string;
    paletteKey?: 'selectedPaletteRow' | 'paletteDock' | 'paletteBuildMode';
}

export interface LegacySettingsSlot {
    row: number;
    slot: number;
    source: string;
    binding: NixiePaletteBinding;
}

export interface LegacySettingsReport {
    version: number;
    changes: LegacySettingsChange[];
    slots: LegacySettingsSlot[];
    skipped: Array<{ source: string; reason: string; }>;
}

type PreferencePatch = Pick<Partial<NixieUserSettings>, 'values' | 'paletteRows' | 'selectedPaletteRow' | 'paletteDock' | 'paletteBuildMode'>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Only authored legacy identifiers, never display names, URLs, or search aliases. */
export function createLegacySettingsAssetIndex(sources: readonly AssetContribution[]): LegacySettingsAsset[] {
    const source = sources.find(entry => entry.id === LEGACY_SETTINGS_ASSET_SOURCE);
    return (source?.assets ?? []).flatMap((asset): LegacySettingsAsset[] => {
        const metadata = asset.metadata ?? {};
        const item = metadata.isItem === true;
        // Exclude generated upgrades and destroyed variants sharing a legacy key.
        if (!item && asset.id !== metadata.foxholeKey) {
            return [];
        }
        // Foxhole's catalog contribution authors buildingKey/resourceKey first.
        const legacyKey = asset.keywords?.[0];
        if (!legacyKey) {
            return [];
        }
        return [{
            legacyKey,
            legacyType: item ? 'icon' : 'building',
            binding: {
                kind: 'asset', sourceId: source!.id, assetId: asset.id,
                label: asset.name.slice(0, 160), icon: item ? 'ph:package' : 'ph:wall',
            },
        }];
    });
}

/** Bound the parsed graph as well as bytes, including ignored embedded payloads. */
function validateGraph(source: unknown): void {
    let count = 0;
    const visit = (value: unknown, depth: number): void => {
        if (++count > 20000 || depth > 12) {
            throw new Error('This settings file is too complex to import.');
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                visit(entry, depth + 1);
            }
        } else if (isRecord(value)) {
            for (const [key, entry] of Object.entries(value)) {
                if (key.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(key)) {
                    throw new Error('This settings file contains an invalid property.');
                }
                visit(entry, depth + 1);
            }
        }
    };
    visit(source, 0);
}

const BOOLEAN_SETTINGS = {
    enableGrid: ['nixie.viewport.snapToGrid', 'Snap To Grid'],
    enableSnapRotation: ['nixie.viewport.snapRotation', 'Snap Rotation'],
    enablePasteSnapToCursor: ['nixie.clipboard.pasteAtCursor', 'Paste At Cursor'],
    trackpad: ['nixie.viewport.dragTrackpad', 'Trackpad Scroll Drag'],
    smoothNavigation: ['nixie.viewport.dragSmoothing', 'Viewport Drag Smoothing'],
    showToolbelt: ['nixie.palette.show', 'Show Palette'],
    autoShowSidebarWhenSelection: ['nixie.shell.autoOpenInspectorOnSelection', 'Auto-Open Inspector On Selection'],
    showBuildingListFilters: ['nixie.assets.showFilters', 'Asset Filters Drawer'],
    showUpgradesAsBuildings: ['foxhole.assets.filter.upgrades', 'Show Foxhole Upgrades'],
} as const;

const INVERTED_SETTINGS = {
    showBuildingCategories: ['nixie.assets.hideCategories', 'Hide Asset Categories'],
    showSelectedTierOnly: ['foxhole.assets.filter.showPreviousTiers', 'Show Previous Foxhole Tiers'],
} as const;

const SPECIAL_SETTINGS = ['snapRotationDegrees', 'keySnapRotationDegrees', 'selectedFaction', 'selectedTier', 'projectBrowserView', 'projectBrowserIconScale', 'selectedToolbelt', 'toolbeltPosition', 'toolbeltMode', 'buildingListFilters', 'toolbelts'];

/** Accept the actual { settings } download and raw browser-local versions 1–2. */
export function parseLegacySettings(text: string, assets: readonly LegacySettingsAsset[]): LegacySettingsReport {
    if (text.length > LEGACY_SETTINGS_MAX_BYTES || new TextEncoder().encode(text).byteLength > LEGACY_SETTINGS_MAX_BYTES) {
        throw new Error('Choose a settings JSON file smaller than 5 MB.');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('This file is not valid JSON. Export settings from the legacy planner and try again.');
    }
    validateGraph(parsed);
    const settings = isRecord(parsed) && Object.hasOwn(parsed, 'settings') ? parsed.settings : parsed;
    if (!isRecord(settings) || !Object.keys(settings).some(key => Object.hasOwn(BOOLEAN_SETTINGS, key) || Object.hasOwn(INVERTED_SETTINGS, key) || SPECIAL_SETTINGS.includes(key))) {
        throw new Error('This file does not contain legacy planner settings. Choose its settings export, rather than a project or Nixie bundle.');
    }
    const version = settings.version === undefined ? 1 : settings.version;
    if (![1, 2, '1', '2'].includes(version as number)) {
        throw new Error('This legacy settings version is unsupported. Versions 1 and 2 can be imported.');
    }
    const report: LegacySettingsReport = { version: Number(version), changes: [], slots: [], skipped: [] };
    const handled = new Set(['version']);
    const skip = (source: string, reason = 'No supported equivalent; kept your current preference.'): void => {
        report.skipped.push({ source, reason });
    };
    const read = (key: string, map: (value: unknown) => void): void => {
        handled.add(key);
        if (Object.hasOwn(settings, key)) {
            map(settings[key]);
        }
    };
    const setting = (source: string, settingId: string, label: string, value: NixieSettingValue): void => {
        report.changes.push({ source, settingId, label, value });
    };
    const palette = (source: string, paletteKey: LegacySettingsChange['paletteKey'], label: string, value: NixieSettingValue): void => {
        report.changes.push({ source, paletteKey, label, value });
    };
    for (const [key, [id, label]] of Object.entries(BOOLEAN_SETTINGS)) {
        read(key, value => typeof value === 'boolean' ? setting(key, id, label, value) : skip(key, 'Expected true or false.'));
    }
    for (const [key, [id, label]] of Object.entries(INVERTED_SETTINGS)) {
        read(key, value => typeof value === 'boolean' ? setting(key, id, label, !value) : skip(key, 'Expected true or false.'));
    }
    for (const [key, id, label] of [
        ['snapRotationDegrees', NIXIE_MOUSE_ROTATION_DEGREES_SETTING_ID, 'Mouse Rotation Snap (Degrees)'],
        ['keySnapRotationDegrees', NIXIE_KEYBOARD_ROTATION_DEGREES_SETTING_ID, 'Keyboard Rotation Step (Degrees)'],
    ] as const) {
        read(key, value => isNixieRotationDegrees(value)
            ? setting(key, id, label, value)
            : skip(key, 'Expected a finite angle from 1 to 360 degrees.'));
    }
    read('selectedFaction', value => value === null || value === 'c' || value === 'w'
        ? setting('selectedFaction', 'foxhole.assets.filter.faction', 'Foxhole Asset Faction', value ?? 'all')
        : skip('selectedFaction', 'Unknown faction.'));
    read('selectedTier', value => [1, 2, 3].includes(value as number)
        ? setting('selectedTier', 'foxhole.assets.filter.tier', 'Foxhole Asset Tier', String(value))
        : skip('selectedTier', 'Expected tier 1, 2, or 3.'));
    read('projectBrowserView', value => value === 'grid' || value === 'list'
        ? setting('projectBrowserView', 'nixie.assets.viewMode', 'Asset Browser View', value)
        : skip('projectBrowserView', 'Unknown browser view.'));
    read('projectBrowserIconScale', value => [1, 2, 3].includes(value as number)
        ? setting('projectBrowserIconScale', 'nixie.assets.iconScale', 'Asset Browser Icon Size', String(value))
        : skip('projectBrowserIconScale', 'Expected icon scale 1, 2, or 3.'));
    read('selectedToolbelt', value => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 9
        ? palette('selectedToolbelt', 'selectedPaletteRow', 'Selected Palette Row (1–10)', Number(value))
        : skip('selectedToolbelt', 'Expected a toolbelt index from 0 to 9.'));
    read('toolbeltPosition', value => value === 'top' || value === 'bottom'
        ? palette('toolbeltPosition', 'paletteDock', 'Palette Position', value)
        : skip('toolbeltPosition', 'Expected top or bottom.'));
    read('toolbeltMode', value => [0, 1, 2].includes(value as number)
        ? palette('toolbeltMode', 'paletteBuildMode', 'Palette Build Mode', ['create', 'exchange-single', 'exchange-all'][Number(value)]!)
        : skip('toolbeltMode', 'Unknown toolbelt mode.'));
    read('buildingListFilters', value => {
        if (!isRecord(value)) {
            return skip('buildingListFilters', 'Expected category filters.');
        }
        for (const [key, enabled] of Object.entries(value)) {
            const path = `buildingListFilters.${key}`;
            if (!['bunkers', 'facilities', 'vehicles', 'world', 'items'].includes(key)) {
                skip(path);
            } else if (typeof enabled !== 'boolean') {
                skip(path, 'Expected true or false.');
            } else {
                setting(path, `foxhole.assets.filter.category.${key}`, `Foxhole ${key[0]!.toUpperCase()}${key.slice(1)}`, enabled);
            }
        }
    });
    read('toolbelts', value => {
        if (!isRecord(value) && !Array.isArray(value)) {
            return skip('toolbelts', 'Expected numbered toolbelts.');
        }
        for (const [rowKey, row] of Object.entries(value)) {
            const rowPath = `toolbelts.${rowKey}`;
            if (!/^[0-9]$/.test(rowKey)) {
                skip(rowPath, 'Only ten palette rows are supported.');
                continue;
            }
            if (row === null && Array.isArray(value)) {
                continue;
            }
            if (!isRecord(row) && !Array.isArray(row)) {
                skip(rowPath, 'Expected numbered slots.');
                continue;
            }
            for (const [slotKey, item] of Object.entries(row)) {
                const path = `${rowPath}.${slotKey}`;
                if (!/^[0-9]$/.test(slotKey)) {
                    skip(path, 'Only ten slots per row are supported.');
                    continue;
                }
                if (item === null || (isRecord(item) && Object.keys(item).length === 0)) {
                    continue;
                }
                if (!isRecord(item) || !['building', 'icon'].includes(String(item.type)) || typeof item.subtype !== 'string' || item.subtype.length > 160) {
                    skip(path, 'Blueprint, saved-selection, styled-tool, or invalid slot; kept your current slot.');
                    continue;
                }
                const matches = assets.filter(asset => asset.legacyType === item.type && asset.legacyKey === item.subtype);
                if (matches.length !== 1) {
                    skip(path, `Unknown or ambiguous ${item.type} identifier: ${item.subtype}. Kept your current slot.`);
                    continue;
                }
                report.slots.push({ row: Number(rowKey), slot: Number(slotKey), source: path, binding: structuredClone(matches[0]!.binding) });
            }
        }
    });
    for (const key of Object.keys(settings)) {
        if (!handled.has(key)) {
            skip(key);
        }
    }
    return report;
}

/** Merge only reviewed values and resolved slots. Empty/unknown slots never erase existing bindings. */
export function buildLegacySettingsPatch(current: NixieUserSettings, report: LegacySettingsReport, preferences = true, toolbelts = true): PreferencePatch {
    const patch: PreferencePatch = {};
    for (const change of report.changes) {
        if (change.settingId && (change.source === 'showToolbelt' ? toolbelts : preferences)) {
            patch.values ??= {};
            patch.values[change.settingId] = change.value;
        } else if (change.paletteKey && toolbelts) {
            Object.assign(patch, { [change.paletteKey]: change.value });
        }
    }
    if (toolbelts && report.slots.length) {
        patch.paletteRows = structuredClone(current.paletteRows);
        for (const item of report.slots) {
            patch.paletteRows[item.row]![item.slot] = structuredClone(item.binding);
        }
    }
    return patch;
}

/** Restore only imported fields that have not subsequently changed. */
export function buildLegacySettingsUndo(current: NixieUserSettings, before: NixieUserSettings, applied: PreferencePatch): PreferencePatch {
    const patch: PreferencePatch = {};
    const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    for (const [id, value] of Object.entries(applied.values ?? {})) {
        if (equal(current.values[id], value)) {
            patch.values ??= {};
            patch.values[id] = before.values[id]!;
        }
    }
    for (const key of ['paletteDock', 'paletteBuildMode', 'selectedPaletteRow'] as const) {
        if (applied[key] !== undefined && equal(current[key], applied[key])) {
            Object.assign(patch, { [key]: before[key] });
        }
    }
    if (applied.paletteRows) {
        const rows = structuredClone(current.paletteRows);
        for (let row = 0; row < 10; row++) {
            for (let slot = 0; slot < 10; slot++) {
                if (!equal(before.paletteRows[row]![slot], applied.paletteRows[row]![slot])
                    && equal(rows[row]![slot], applied.paletteRows[row]![slot])) {
                    rows[row]![slot] = structuredClone(before.paletteRows[row]![slot]!);
                }
            }
        }
        patch.paletteRows = rows;
    }
    return patch;
}
