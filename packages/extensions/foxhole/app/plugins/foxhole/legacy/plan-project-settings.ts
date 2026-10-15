import {
    FOXHOLE_MAP_SETTING_KEYS,
    serializeFoxholeMapStringList,
} from '../nixie/map-settings.ts';
import type { LegacyPlanProjectSettings } from './plan-types.ts';

export type LegacyPlanMappedProjectSettings = Record<string, boolean | string>;

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeRegionKeys(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map(entry => normalizeString(entry))
        .filter(Boolean);
}

/**
 * Map legacy per-plan map context into Nixie's project-scoped map settings.
 * View-layer and range settings remain user preferences; crop support is deferred.
 */
export function mapLegacyPlanProjectSettings(
    settings: LegacyPlanProjectSettings | null | undefined,
): LegacyPlanMappedProjectSettings {
    if (!settings) {
        return {};
    }

    const shardId = normalizeString(settings.shardId);
    const regionKeys = normalizeRegionKeys(settings.regionKeys);
    const serializedRegionKeys = serializeFoxholeMapStringList(regionKeys);
    const enabled = settings.showWorldRegion === true
        || (typeof settings.showWorldRegion !== 'boolean' && (Boolean(shardId) || Boolean(serializedRegionKeys)));
    const next: LegacyPlanMappedProjectSettings = {
        [FOXHOLE_MAP_SETTING_KEYS.enabled]: enabled,
    };

    if (shardId) {
        next[FOXHOLE_MAP_SETTING_KEYS.shardId] = shardId;
    }
    if (serializedRegionKeys) {
        next[FOXHOLE_MAP_SETTING_KEYS.regionKeys] = serializedRegionKeys;
    }
    return next;
}
