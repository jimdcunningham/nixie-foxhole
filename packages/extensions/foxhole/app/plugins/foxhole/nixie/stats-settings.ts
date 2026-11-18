import type { UserSettingDefinition } from '#nixie/plugins/nixie/registry/types.ts';
import {
    FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID,
    FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID,
    FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS,
    FOXHOLE_MAX_CUSTOM_INTERVAL_SECONDS,
} from './maintenance-supplies.ts';
import {
    FOXHOLE_STATS_SETTINGS_PAGE_SECTION,
    withSettingsPageSection,
} from './settings-page-sections.ts';

export const FOXHOLE_STATS_SETTING_KEYS = {
    timeInterval: 'foxhole.stats.timeInterval',
    customIntervalSeconds: 'foxhole.stats.customIntervalSeconds',
} as const;

// The legacy structure production overlay still reads these interval preferences.
export const foxholeStatsUserSettings: readonly UserSettingDefinition[] = withSettingsPageSection([
    {
        id: FOXHOLE_STATS_SETTING_KEYS.timeInterval,
        scope: 'user',
        type: 'select',
        name: 'Statistics Time Interval',
        description: 'Time window used for production, building maintenance, and bunker destruction statistics.',
        icon: 'ph:clock',
        group: 'general',
        order: 30,
        options: [
            { value: FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID, label: 'Custom' },
            ...FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS.map(option => ({
                value: option.id,
                label: option.label,
            })),
        ],
        defaultValue: FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID,
    },
    {
        id: FOXHOLE_STATS_SETTING_KEYS.customIntervalSeconds,
        scope: 'user',
        type: 'number',
        name: 'Custom Statistics Interval',
        description: 'Duration in seconds for the custom statistics interval.',
        icon: 'ph:clock',
        group: 'general',
        order: 35,
        defaultValue: 3600,
        min: 1,
        max: FOXHOLE_MAX_CUSTOM_INTERVAL_SECONDS,
        validate: value => typeof value === 'number' && Number.isInteger(value),
        visible: false,
    },
], FOXHOLE_STATS_SETTINGS_PAGE_SECTION);
