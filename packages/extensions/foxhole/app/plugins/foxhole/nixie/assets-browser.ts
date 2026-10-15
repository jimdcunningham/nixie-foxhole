import type {
    NixieAssetBrowserContext,
    NixieResolvedAssetEntry,
    NixieSettingValue,
} from '#nixie/plugins/nixie/registry/types.ts';

export const FOXHOLE_ASSET_SOURCE_ID = 'foxhole.structures';
export const FOXHOLE_CATEGORY_FILTERS = ['bunkers', 'facilities', 'world', 'items'] as const;
export const FOXHOLE_VEHICLE_FILTER_KEY = 'vehicles' as const;
export const FOXHOLE_ASSET_FILTER_ORDER = ['bunkers', 'facilities', FOXHOLE_VEHICLE_FILTER_KEY, 'world', 'items'] as const;
export const FOXHOLE_ASSET_ICON_SET_SETTING_ID = 'foxhole.assets.browser.iconSet';
const FOXHOLE_DESTROYED_FILTER_SETTING_ID = 'foxhole.assets.filter.destroyed';
const FOXHOLE_BREACHED_FILTER_SETTING_ID = 'foxhole.assets.filter.breached';
const FOXHOLE_VEHICLE_FILTER_SETTING_ID = `foxhole.assets.filter.category.${FOXHOLE_VEHICLE_FILTER_KEY}`;
export const FOXHOLE_ASSET_ICON_SETS = [
    {
        id: 'default',
        name: 'Default',
        description: 'Use the blueprint icon extracted from Foxhole assets.',
    },
    {
        id: 'rendered',
        name: 'Rendered',
        description: 'Use the generated FoxWatch rendered icon.',
    },
] as const;

export function isFoxholeStructureAsset(entry: NixieResolvedAssetEntry): boolean {
    return entry.sourceId === FOXHOLE_ASSET_SOURCE_ID;
}

export function getFoxholeAssetMetadata(entry: NixieResolvedAssetEntry): Record<string, unknown> {
    return entry.asset.metadata ?? {};
}

export function getFoxholeFactionLabel(value: NixieSettingValue | undefined): string {
    if (value === 'c') {
        return 'Colonial';
    }
    if (value === 'w') {
        return 'Warden';
    }
    return 'Faction';
}

export function resolveFoxholeTierValue(value: NixieSettingValue | undefined): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.min(3, Math.max(1, Math.round(value)));
    }

    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (Number.isFinite(parsed)) {
        return Math.min(3, Math.max(1, parsed));
    }

    return 3;
}

export function getFoxholeTierLabel(value: NixieSettingValue | undefined): string {
    return `Tier ${resolveFoxholeTierValue(value)}`;
}

export function getNextFoxholeFactionValue(value: NixieSettingValue | undefined): string {
    if (value === 'c') {
        return 'w';
    }
    if (value === 'w') {
        return 'all';
    }
    return 'c';
}

export function getNextFoxholeTierValue(value: NixieSettingValue | undefined): string {
    const tier = resolveFoxholeTierValue(value);
    return String(tier >= 3 ? 1 : tier + 1);
}

function readBooleanSetting(context: NixieAssetBrowserContext, settingId: string, fallback = false): boolean {
    const value = typeof context.getSetting === 'function'
        ? context.getSetting(settingId)
        : context.getProjectSetting?.(settingId);
    return typeof value === 'boolean' ? value : fallback;
}

function readMetadataString(entry: NixieResolvedAssetEntry['asset'], key: string): string {
    const value = entry.metadata?.[key];
    return typeof value === 'string' ? value.trim() : '';
}

function readMetadataBoolean(entry: NixieResolvedAssetEntry['asset'], key: string): boolean {
    return entry.metadata?.[key] === true;
}

function inferTierFromValue(value: unknown): number | null {
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue) {
        return null;
    }

    const codeNameMatch = normalizedValue.match(/T(\d+)$/i);
    if (codeNameMatch) {
        const parsedTier = Number.parseInt(codeNameMatch[1] ?? '', 10);
        return Number.isFinite(parsedTier) ? parsedTier : null;
    }

    const nameMatch = normalizedValue.match(/\(Tier\s+(\d+)\)$/i);
    if (nameMatch) {
        const parsedTier = Number.parseInt(nameMatch[1] ?? '', 10);
        return Number.isFinite(parsedTier) ? parsedTier : null;
    }

    return null;
}

function resolveFoxholeImplicitUpgradeTier(entry: NixieResolvedAssetEntry['asset']): number | null {
    return inferTierFromValue(entry.metadata?.upgradeStructureCodeName)
        ?? inferTierFromValue(entry.metadata?.upgradeStructureId);
}

function isFoxholeDestroyedAsset(entry: NixieResolvedAssetEntry): boolean {
    return readMetadataBoolean(entry.asset, 'defaultDestroyedState')
        || readMetadataBoolean(entry.asset, 'isDestroyed');
}

function isFoxholeBreachedAsset(entry: NixieResolvedAssetEntry): boolean {
    return readMetadataBoolean(entry.asset, 'isBreached');
}

function isFoxholeVehicleAsset(entry: NixieResolvedAssetEntry): boolean {
    return readMetadataBoolean(entry.asset, 'isVehicle');
}

function matchesFoxholeCategorySignal(entry: NixieResolvedAssetEntry, filterId: string): boolean {
    switch (filterId) {
        case 'bunkers':
            return readMetadataBoolean(entry.asset, 'isBunker');
        case 'facilities':
            return readMetadataBoolean(entry.asset, 'isFacility');
        case 'world':
            return readMetadataBoolean(entry.asset, 'isWorldStructure');
        case 'items':
            return readMetadataBoolean(entry.asset, 'isItem');
        default:
            return false;
    }
}

function hasFoxholeAuthoritativeFilterOverride(entry: NixieResolvedAssetEntry, context: NixieAssetBrowserContext): boolean {
    const isBreached = isFoxholeBreachedAsset(entry);

    if (readBooleanSetting(context, FOXHOLE_VEHICLE_FILTER_SETTING_ID, true) && isFoxholeVehicleAsset(entry)) {
        return true;
    }

    if (readBooleanSetting(context, FOXHOLE_DESTROYED_FILTER_SETTING_ID) && (isFoxholeDestroyedAsset(entry) || isBreached)) {
        return true;
    }

    return readBooleanSetting(context, FOXHOLE_BREACHED_FILTER_SETTING_ID) && isBreached;
}

export function getFoxholeAssetIconSetOptions(includeRendered = true): Array<{ id: string; name: string; description?: string; }> {
    return FOXHOLE_ASSET_ICON_SETS.filter(option => includeRendered || option.id !== 'rendered')
        .map(option => ({
            id: option.id,
            name: option.name,
            description: option.description,
        }));
}

export function resolveFoxholeAssetBrowserIconUrl(entry: NixieResolvedAssetEntry['asset'], iconSetId: string): string {
    const defaultIconUrl = readMetadataString(entry, 'itemIconUrl') || readMetadataString(entry, 'iconUrl');
    if (iconSetId === 'rendered') {
        return readMetadataString(entry, 'previewIconUrl') || defaultIconUrl;
    }

    return defaultIconUrl;
}

export function matchesFoxholeFactionFilter(entry: NixieResolvedAssetEntry, value: NixieSettingValue | undefined): boolean {
    const selectedFaction = value === 'c' || value === 'w' ? value : 'all';
    if (selectedFaction === 'all') {
        return true;
    }

    const faction = getFoxholeAssetMetadata(entry).faction;
    return !faction || faction === selectedFaction;
}

export function matchesFoxholeTierFilter(
    entry: NixieResolvedAssetEntry,
    value: NixieSettingValue | undefined,
    context: NixieAssetBrowserContext,
): boolean {
    const tier = resolveFoxholeTierValue(value);
    const showPreviousTiers = readBooleanSetting(context, 'foxhole.assets.filter.showPreviousTiers');
    const metadata = getFoxholeAssetMetadata(entry);
    const techId = String(metadata.techId ?? '').trim();
    const assetTierValue = metadata.tier;
    const assetTier = typeof assetTierValue === 'number' && Number.isFinite(assetTierValue) ? assetTierValue : null;
    const hasHigherTierSibling = metadata.hasHigherTierSibling === true;

    if (techId === 'unlockfacilitytier3' && tier < 3) {
        return false;
    }
    if (techId && techId !== 'unlockfacilitytier3' && tier < 2) {
        return false;
    }

    // A standalone facility's structural tier is not a technology unlock.
    if (metadata.isFacility === true && !techId && !hasHigherTierSibling
        && !metadata.downgradeStructureId && !metadata.parentStructureId) {
        return true;
    }

    if (assetTier == null) {
        if (!showPreviousTiers && hasHigherTierSibling) {
            const implicitUpgradeTier = resolveFoxholeImplicitUpgradeTier(entry.asset);
            return implicitUpgradeTier != null
                ? implicitUpgradeTier === tier
                : false;
        }

        return true;
    }

    if (showPreviousTiers) {
        return assetTier <= tier;
    }

    if (assetTier === tier) {
        return true;
    }

    return assetTier < tier && !hasHigherTierSibling;
}

export function matchesFoxholePreviousTierToggle(): boolean {
    return true;
}

export function matchesFoxholeUpgradeFilter(entry: NixieResolvedAssetEntry, value: NixieSettingValue | undefined): boolean {
    const showUpgrades = value === true;
    const isUpgrade = getFoxholeAssetMetadata(entry).isUpgrade === true;
    return showUpgrades || !isUpgrade;
}

export function matchesFoxholeDestroyedFilter(
    entry: NixieResolvedAssetEntry,
    value: NixieSettingValue | undefined,
    context?: NixieAssetBrowserContext,
): boolean {
    const showDestroyed = value === true;
    const showBreached = context
        ? readBooleanSetting(context, FOXHOLE_BREACHED_FILTER_SETTING_ID)
        : false;
    const isDestroyed = isFoxholeDestroyedAsset(entry);
    const isBreached = isFoxholeBreachedAsset(entry);

    if (isBreached) {
        return showDestroyed || showBreached;
    }

    return showDestroyed || !isDestroyed;
}

export function matchesFoxholeBreachedFilter(
    entry: NixieResolvedAssetEntry,
    value: NixieSettingValue | undefined,
    context?: NixieAssetBrowserContext,
): boolean {
    const showBreached = value === true;
    const showDestroyed = context
        ? readBooleanSetting(context, FOXHOLE_DESTROYED_FILTER_SETTING_ID)
        : false;
    const isBreached = isFoxholeBreachedAsset(entry);

    if (isBreached) {
        return showBreached || showDestroyed;
    }

    return true;
}

export function matchesFoxholeCategoryFilter(
    entry: NixieResolvedAssetEntry,
    value: NixieSettingValue | undefined,
    filterId: string,
    context?: NixieAssetBrowserContext,
): boolean {
    const enabled = value !== false;

    if (context && hasFoxholeAuthoritativeFilterOverride(entry, context)) {
        return true;
    }

    if (!matchesFoxholeCategorySignal(entry, filterId)) {
        return true;
    }

    return enabled;
}

export function matchesFoxholeVehicleFilter(
    entry: NixieResolvedAssetEntry,
    value: NixieSettingValue | undefined,
    context?: NixieAssetBrowserContext,
): boolean {
    const enabled = value !== false;
    if (!isFoxholeVehicleAsset(entry)) {
        return true;
    }

    if (enabled) {
        return true;
    }

    return context ? hasFoxholeAuthoritativeFilterOverride(entry, context) : false;
}

export function shouldShowFoxholePreviousTierFilter(context: NixieAssetBrowserContext): boolean {
    const value = typeof context.getSetting === 'function'
        ? context.getSetting('foxhole.assets.filter.tier')
        : context.getProjectSetting?.('foxhole.assets.filter.tier');
    return resolveFoxholeTierValue(value) > 1;
}
