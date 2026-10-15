import {
    FOXHOLE_ASSET_FILTER_ORDER,
    FOXHOLE_ASSET_ICON_SET_SETTING_ID,
    getFoxholeAssetIconSetOptions,
} from './assets-browser.ts';
import {
    FOXHOLE_BROWSER_SETTINGS_PAGE_SECTION,
    withSettingsPageSection,
} from './settings-page-sections.ts';

export const FOXHOLE_FILTER_SETTING_GROUP = 'foxhole.assets';
export const FOXHOLE_LOCALE_SETTING_ID = 'foxhole.locale';
export const FOXHOLE_TIER_SETTING_OPTIONS = [
    { value: '1', label: 'Tier 1' },
    { value: '2', label: 'Tier 2' },
    { value: '3', label: 'Tier 3' },
] as const;

export const FOXHOLE_LOCALE_OPTIONS = [
    { value: 'auto', label: 'Auto', icon: 'ph:globe' },
    { value: 'en', label: 'English', icon: 'circle-flags:gb' },
    { value: 'de', label: 'Deutsch', icon: 'circle-flags:de' },
    { value: 'fr', label: 'Francais', icon: 'circle-flags:fr' },
    { value: 'pt', label: 'Portugues', icon: 'circle-flags:pt' },
    { value: 'ru', label: 'Russian', icon: 'circle-flags:ru' },
    { value: 'zh', label: 'Chinese', icon: 'circle-flags:cn' },
] as const;

export function getFoxholeLocaleOption(value: unknown) {
    const normalizedValue = String(value ?? 'auto').trim().toLowerCase() || 'auto';
    return FOXHOLE_LOCALE_OPTIONS.find(option => option.value === normalizedValue) ?? FOXHOLE_LOCALE_OPTIONS[0];
}

export function getFoxholeLocaleIcon(value: unknown): string {
    return getFoxholeLocaleOption(value).icon;
}

export const foxholeAssetFilterSettings = withSettingsPageSection([
    {
        id: FOXHOLE_ASSET_ICON_SET_SETTING_ID,
        scope: 'user' as const,
        type: 'select' as const,
        name: 'Foxhole Asset Browser Icon Set',
        description: 'Preferred icon set used for Foxhole assets in the asset browser.',
        icon: 'ph:images',
        group: FOXHOLE_FILTER_SETTING_GROUP,
        defaultValue: 'default',
        options: getFoxholeAssetIconSetOptions(true).map(option => ({
            value: option.id,
            label: option.name,
        })),
    },
    {
        id: 'foxhole.assets.filter.faction',
        scope: 'user' as const,
        type: 'select' as const,
        name: 'Foxhole Asset Faction',
        description: 'Preferred faction filter for Foxhole structure assets.',
        icon: 'ph:flag',
        group: FOXHOLE_FILTER_SETTING_GROUP,
        defaultValue: 'all',
        options: [
            { value: 'all', label: 'All Factions' },
            { value: 'c', label: 'Colonial' },
            { value: 'w', label: 'Warden' },
        ],
    },
    {
        id: 'foxhole.assets.filter.tier',
        scope: 'user' as const,
        type: 'select' as const,
        name: 'Foxhole Asset Tier',
        description: 'Selected Foxhole structure tier shown in the asset browser.',
        icon: 'ph:stack-simple',
        group: FOXHOLE_FILTER_SETTING_GROUP,
        defaultValue: '3',
        options: FOXHOLE_TIER_SETTING_OPTIONS,
    },
    {
        id: 'foxhole.assets.filter.showPreviousTiers',
        scope: 'user' as const,
        type: 'boolean' as const,
        name: 'Foxhole Asset Previous Tiers',
        description: 'Include lower Foxhole tiers when filtering by tier.',
        icon: 'ph:stack',
        group: FOXHOLE_FILTER_SETTING_GROUP,
        defaultValue: false,
    },
    {
        id: 'foxhole.assets.filter.upgrades',
        scope: 'user' as const,
        type: 'boolean' as const,
        name: 'Foxhole Asset Upgrades',
        description: 'Show generated Foxhole upgrade variants as standalone assets.',
        icon: 'ph:arrow-square-out',
        group: FOXHOLE_FILTER_SETTING_GROUP,
        defaultValue: false,
    },
    {
        id: 'foxhole.assets.filter.destroyed',
        scope: 'user' as const,
        type: 'boolean' as const,
        name: 'Foxhole Asset Destroyed',
        description: 'Show generated Foxhole destroyed variants as standalone assets.',
        icon: 'ph:traffic-cone',
        group: FOXHOLE_FILTER_SETTING_GROUP,
        defaultValue: false,
    },
    {
        id: 'foxhole.assets.filter.breached',
        scope: 'user' as const,
        type: 'boolean' as const,
        name: 'Foxhole Asset Breached',
        description: 'Show Foxhole breached structures in the browser.',
        icon: 'ph:shield-warning',
        group: FOXHOLE_FILTER_SETTING_GROUP,
        defaultValue: false,
    },
    ...FOXHOLE_ASSET_FILTER_ORDER.map(filterKey => ({
        id: `foxhole.assets.filter.category.${filterKey}`,
        scope: 'user' as const,
        type: 'boolean' as const,
        name: `Foxhole Asset ${filterKey}`,
        description: `Show Foxhole ${filterKey} assets in the browser.`,
        icon: 'ph:funnel',
        group: FOXHOLE_FILTER_SETTING_GROUP,
        defaultValue: true,
    })),
    {
        id: FOXHOLE_LOCALE_SETTING_ID,
        scope: 'user' as const,
        type: 'select' as const,
        name: 'Foxhole Language',
        description: 'Preferred language for Foxhole asset names and descriptions.',
        icon: 'ph:translate',
        group: FOXHOLE_FILTER_SETTING_GROUP,
        defaultValue: 'auto',
        options: FOXHOLE_LOCALE_OPTIONS,
    },
], FOXHOLE_BROWSER_SETTINGS_PAGE_SECTION);
