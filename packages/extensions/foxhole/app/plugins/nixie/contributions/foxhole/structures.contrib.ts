import FoxholeAssetHoverCard from '#foxhole/components/nixie/foxhole/FoxholeAssetHoverCard.vue';
import FoxholeStructureInspectorCard from '#foxhole/components/nixie/foxhole/FoxholeStructureInspectorCard.vue';
import { resolveFoxholeAssetCompletionMetadata } from '#foxhole/plugins/foxhole/nixie/asset-completion.ts';
import {
    createFoxholeAssetsBaseUrl,
    findFoxholeAppliedModificationAssetFromCatalog,
    getFoxholeItemCatalog,
    getFoxholeStructureCatalog,
    loadFoxholeLocalizationStrings,
    resolveFoxholeStructureBuildRouteSourceAsset,
    resolveFoxholeStructureCatalogSortOrder,
    resolveFoxholeSharedPackagedPalletFromCatalog,
    resolveFoxholeTextureUrl,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    getFoxholeLocalizedText,
    getFoxholePreferredLocale,
} from '#foxhole/plugins/foxhole/nixie/localization.ts';
import {
    FOXHOLE_ASSET_FILTER_ORDER,
    FOXHOLE_ASSET_ICON_SET_SETTING_ID,
    FOXHOLE_ASSET_SOURCE_ID,
    FOXHOLE_VEHICLE_FILTER_KEY,
    getFoxholeAssetIconSetOptions,
    getFoxholeFactionLabel,
    getFoxholeTierLabel,
    getNextFoxholeFactionValue,
    getNextFoxholeTierValue,
    isFoxholeStructureAsset,
    matchesFoxholeBreachedFilter,
    matchesFoxholeCategoryFilter,
    matchesFoxholeDestroyedFilter,
    matchesFoxholeFactionFilter,
    matchesFoxholeTierFilter,
    matchesFoxholeUpgradeFilter,
    matchesFoxholeVehicleFilter,
    resolveFoxholeAssetBrowserIconUrl,
    shouldShowFoxholePreviousTierFilter,
} from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import {
    getFoxholeLocaleIcon,
    getFoxholeLocaleOption,
    FOXHOLE_LOCALE_OPTIONS,
    FOXHOLE_LOCALE_SETTING_ID,
    foxholeAssetFilterSettings,
} from '#foxhole/plugins/foxhole/nixie/asset-settings.ts';
import {
    foxholeRangeDebugUserSettings,
    foxholeRangeUserSettings,
} from '#foxhole/plugins/foxhole/nixie/range-settings.ts';
import { getFoxholeProductionIndex } from '#foxhole/plugins/foxhole/nixie/production/index.ts';
import { resolveFoxholeProductionOverlayOutputs } from '#foxhole/plugins/foxhole/nixie/production/overlay-outputs.ts';
import type { FoxholeProductionOverlayOutput } from '#foxhole/plugins/foxhole/nixie/production/overlay-outputs.ts';
import { foxholeStructureDebugSettings } from '#foxhole/plugins/foxhole/nixie/structure-debug-settings.ts';
import { createFoxholeStructureAssetSnapshot } from '#foxhole/plugins/foxhole/nixie/structure-asset-snapshot.ts';
import {
    FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION,
    withCommandSettingsPageSection,
} from '#foxhole/plugins/foxhole/nixie/settings-page-sections.ts';
import { foxholeStructureStateSchema } from '#foxhole/plugins/foxhole/nixie/schema.ts';
import { remapFoxholeStructureSnapshotCloneReferences } from '#foxhole/plugins/foxhole/nixie/snapshot-clone-references.ts';
import {
    isFoxholeConversionTargetAsset,
    resolveFoxholeStructureTierMutation,

} from '#foxhole/plugins/foxhole/nixie/structure-tier-actions.ts';
import type { FoxholeStructureTierDirection, FoxholeStructureTierMutation } from '#foxhole/plugins/foxhole/nixie/structure-tier-actions.ts';
import { setFoxholeModificationSlotVariantSelection } from '#foxhole/plugins/foxhole/nixie/modification-slots.ts';
import { getFoxholeSnapshotDependencies } from '#foxhole/plugins/foxhole/nixie/snapshot-dependencies.ts';
import { FOXHOLE_ASSET_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { FOXHOLE_CONNECTOR_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/connector.ts';
import { FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import type { FoxholeStructureState } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { FoxholeStructureNode } from '#foxhole/plugins/nixie/board/types/foxhole-structure.ts';
import { NX_BOOTSTRAP_LIGHTNING_SVG } from '#nixie/utils/nx-bootstrap-lightning.ts';
import { createFoxholeItemHoverEntry } from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import type { NixieResolvedAssetEntry } from '#nixie/plugins/nixie/registry/index.ts';
import { createNixieIconAssetSnapshot } from '#nixie/plugins/nixie/contributions/assets/shared/icon-asset.ts';
import { NIXIE_ICON_NODE_TYPE } from '#nixie/plugins/nixie/contributions/assets/shared/icon.ts';
import { createNixieHitboxNodeId, createNixieHitboxSnapshot } from '#nixie/plugins/nixie/contributions/assets/shared/hitbox.ts';
import { registerNixieHitboxHostNodeType } from '#nixie/plugins/nixie/board/parenting.ts';
import { listHitboxChildren } from '#nixie/plugins/nixie/board/utils/hitbox-host.ts';
import { getHitboxHostSizeScale, readHitboxHostMetrics, scaleHitboxPointsToCurrentHostLocal } from '#nixie/plugins/nixie/board/utils/hitbox-texture.ts';
import type { NixieHitboxState } from '#nixie/plugins/nixie/contributions/assets/shared/hitbox.ts';
import { canDissolveHitboxPolygons, dissolveHitboxPolygons } from '#foxhole/plugins/foxhole/nixie/hitbox-dissolve.ts';
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import { getNixieEditorDocumentSessionBridge } from '#nixie/utils/nixie-editor-document-session-bridge.ts';
import { NIXIE_DEBUG_MENU_ID } from '#nixie/plugins/nixie/registry/menu-ids.ts';
import type { NixieCommandContext } from '#nixie/plugins/nixie/registry/types.ts';
import type { NixieProjectOperation } from '#nixie/plugins/nixie/project.ts';

const FOXHOLE_ASSET_BASE_URL = createFoxholeAssetsBaseUrl('/');
const FOXHOLE_CATALOG = getFoxholeStructureCatalog(FOXHOLE_ASSET_BASE_URL);
const FOXHOLE_ITEM_CATALOG = getFoxholeItemCatalog(FOXHOLE_ASSET_BASE_URL);
const FOXHOLE_PRODUCTION_INDEX = getFoxholeProductionIndex(FOXHOLE_ASSET_BASE_URL);
const FOXHOLE_STRUCTURE_POWER_DELTA_BY_ID = Object.fromEntries(
    Object.values(FOXHOLE_CATALOG.structureByKey).map(structure => [
        structure.id,
        structure.powerGridInfo?.powerDelta ?? null,
    ]),
);
const FOXHOLE_ASSET_GRID_CELL_PADDING_X = 96;
const FOXHOLE_ASSET_GRID_CELL_PADDING_Y = 96;
const FOXHOLE_ASSET_GRID_CELL_MIN_WIDTH = 180;
const FOXHOLE_ASSET_GRID_CELL_MIN_HEIGHT = 140;
const FOXHOLE_ITEM_GRID_CELL_SIZE = 160;
const FOXWATCH_RENDER_PIXELS_PER_METER = 64;
const FOXHOLE_BOARD_PIXELS_PER_METER = 32;
const CENTIMETERS_PER_METER = 100;
const FOXHOLE_HITBOX_CLIPBOARD_KIND = 'foxhole-hitboxes';
const FOXHOLE_HITBOX_CLIPBOARD_VERSION = 1;

registerNixieHitboxHostNodeType(FOXHOLE_ASSET_NODE_TYPE);
const FOXHOLE_STICKY_SORT_VARIANT_RANKS = {
    destroyed: -20,
    buildsite: -10,
    base: 0,
    upgrade: 10,
    upgradeDestroyed: 9,
} as const;
const DESTROYED_STRUCTURE_NAME_FORMATS: Record<string, { prefix: string; suffix: string; }> = {
    en: { prefix: 'Destroyed ', suffix: '' },
    de: { prefix: 'Zerst\u00F6rtes ', suffix: '' },
    fr: { prefix: '', suffix: ' d\u00E9truit' },
    pt: { prefix: '', suffix: ' destru\u00EDdo' },
    ru: { prefix: '\u0420\u0430\u0437\u0440\u0443\u0448\u0435\u043D\u043D\u044B\u0439 ', suffix: '' },
    zh: { prefix: '\u88AB\u6467\u6BC1\u7684', suffix: '' },
};

function resolveFoxholeOverlayItemIconUrl(codename: string): string | null {
    const key = String(codename ?? '').trim();
    if (!key) {
        return null;
    }
    const item = FOXHOLE_ITEM_CATALOG.assetByKey[key]
        ?? FOXHOLE_ITEM_CATALOG.assetByKey[key.toLowerCase()];
    if (item?.iconUrl || item?.previewIconUrl) {
        return item.iconUrl ?? item.previewIconUrl;
    }
    const structure = FOXHOLE_CATALOG.assetByKey[key]
        ?? FOXHOLE_CATALOG.assetByKey[key.toLowerCase()];
    return structure?.iconUrl ?? structure?.previewIconUrl ?? null;
}

const overlayHoverEntries = new Map<string, NixieResolvedAssetEntry>();
function resolveFoxholeOverlayItemHoverEntry(codename: string): NixieResolvedAssetEntry | null {
    const key = String(codename ?? '').trim();
    if (!key) {
        return null;
    }
    const cached = overlayHoverEntries.get(key);
    if (cached) {
        return cached;
    }
    const item = FOXHOLE_ITEM_CATALOG.assetByKey[key]
        ?? FOXHOLE_ITEM_CATALOG.assetByKey[key.toLowerCase()]
        ?? null;
    const structure = FOXHOLE_CATALOG.assetByKey[key]
        ?? FOXHOLE_CATALOG.assetByKey[key.toLowerCase()];
    const entry = createFoxholeItemHoverEntry(
        item,
        key,
        (asset, fallback) => asset?.name ?? structure?.name ?? (fallback === 'power' ? 'Power' : fallback),
        asset => asset?.description ?? structure?.description ?? '',
        asset => asset?.categoryName ?? 'Production',
    );
    entry.iconUrl = entry.iconUrl || resolveFoxholeOverlayItemIconUrl(key) || '';
    if (!item && key === 'power') {
        entry.iconUrl = `data:image/svg+xml,${encodeURIComponent(NX_BOOTSTRAP_LIGHTNING_SVG)}`;
    }
    overlayHoverEntries.set(key, entry);
    return entry;
}

function resolveFoxholeStructureProductionOverlayOutputs(recipeId: string): FoxholeProductionOverlayOutput[] {
    const recipe = FOXHOLE_PRODUCTION_INDEX.recipeById[String(recipeId ?? '').trim()];
    if (!recipe) {
        return [];
    }
    return resolveFoxholeProductionOverlayOutputs(
        recipe,
        FOXHOLE_STRUCTURE_POWER_DELTA_BY_ID[recipe.sourceStructureId],
    );
}

function normalizeTierFamilyCodeName(value: string | null | undefined): string {
    return String(value ?? '')
        .trim()
        .replace(/T\d+$/i, '')
        .toLowerCase();
}

function resolveFoxholeStructureAssetGridCellMetadata(asset: typeof FOXHOLE_CATALOG.assets[number]): {
    gridCellWidth: number;
    gridCellHeight: number;
} {
    const structure = FOXHOLE_CATALOG.structureByKey[asset.foxholeKey];
    const spriteWidth = Number(structure?.sprite?.width ?? 0);
    const spriteHeight = Number(structure?.sprite?.height ?? 0);

    return {
        gridCellWidth: Math.max(
            FOXHOLE_ASSET_GRID_CELL_MIN_WIDTH,
            spriteWidth + FOXHOLE_ASSET_GRID_CELL_PADDING_X,
        ),
        gridCellHeight: Math.max(
            FOXHOLE_ASSET_GRID_CELL_MIN_HEIGHT,
            spriteHeight + FOXHOLE_ASSET_GRID_CELL_PADDING_Y,
        ),
    };
}

function resolveFoxholeItemAssetGridCellMetadata(): {
    gridCellWidth: number;
    gridCellHeight: number;
} {
    return {
        gridCellWidth: FOXHOLE_ITEM_GRID_CELL_SIZE,
        gridCellHeight: FOXHOLE_ITEM_GRID_CELL_SIZE,
    };
}

function normalizeTierFamilyName(value: string | null | undefined): string {
    return String(value ?? '')
        .trim()
        .replace(/\s*\(Tier\s+\d+\)$/i, '')
        .toLowerCase();
}

function inferFoxholeStructureTier(value: string | null | undefined): number | null {
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

function resolveFoxholeStructureTier(asset: typeof FOXHOLE_CATALOG.assets[number]): number | null {
    if (Number.isFinite(asset.tier)) {
        return asset.tier;
    }

    return inferFoxholeStructureTier(asset.codeName)
        ?? inferFoxholeStructureTier(asset.name);
}

function hasHigherTierFoxholeStructureAsset(asset: typeof FOXHOLE_CATALOG.assets[number]): boolean {
    if (asset.isUpgrade) {
        return false;
    }

    const explicitUpgradeAsset = asset.upgradeStructureId
        ? (FOXHOLE_CATALOG.assetByKey[String(asset.upgradeStructureId).trim()] ?? null)
        : (asset.upgradeStructureCodeName
            ? (FOXHOLE_CATALOG.assetByKey[String(asset.upgradeStructureCodeName).trim().toLowerCase()] ?? null)
            : null);
    if (explicitUpgradeAsset && explicitUpgradeAsset.foxholeKey !== asset.foxholeKey && !explicitUpgradeAsset.isUpgrade) {
        return true;
    }

    const assetTier = resolveFoxholeStructureTier(asset);
    if (!Number.isFinite(assetTier)) {
        return false;
    }

    const normalizedCodeName = normalizeTierFamilyCodeName(asset.codeName);
    const normalizedName = normalizeTierFamilyName(asset.name);
    if (!normalizedCodeName && !normalizedName) {
        return false;
    }

    return FOXHOLE_CATALOG.assets.some(entry => {
        const entryTier = resolveFoxholeStructureTier(entry);
        if (entry.foxholeKey === asset.foxholeKey || entry.isUpgrade || !Number.isFinite(entryTier)) {
            return false;
        }

        if (entryTier <= assetTier) {
            return false;
        }

        if (entry.categoryKey !== asset.categoryKey) {
            return false;
        }

        if (Boolean(entry.faction) !== Boolean(asset.faction) || entry.faction !== asset.faction) {
            return false;
        }

        return normalizedCodeName
            ? normalizeTierFamilyCodeName(entry.codeName) === normalizedCodeName
            : normalizeTierFamilyName(entry.name) === normalizedName;
    });
}

function getFoxholeLocaleLabel(value: unknown): string {
    const locale = getFoxholeLocaleOption(value);
    return `Language: ${locale.label}`;
}

function createFoxholeItemAssetId(resourceKey: string): string {
    return `item:${resourceKey}`;
}

function resolveFoxholeAssetSignalKeywords(asset: {
    isBunker?: boolean | null;
    isFacility?: boolean | null;
    isVehicle?: boolean | null;
    isWorldStructure?: boolean | null;
    isItem?: boolean | null;
}): string[] {
    const keywords: string[] = [];
    if (asset.isBunker) {
        keywords.push('bunkers');
    }
    if (asset.isFacility) {
        keywords.push('facilities');
    }
    if (asset.isVehicle) {
        keywords.push('vehicles');
    }
    if (asset.isWorldStructure) {
        keywords.push('world');
    }
    if (asset.isItem) {
        keywords.push('items');
    }

    return keywords;
}

function createFoxholeUpgradePlacementAssetId(
    asset: typeof FOXHOLE_CATALOG.assets[number],
    slotId: string,
    variantId: string,
    destroyed = false,
): string {
    const baseId = `upgrade:${asset.foxholeKey}:${String(slotId ?? '').trim()}:${String(variantId ?? '').trim()}`;
    return destroyed ? `${baseId}:destroyed` : baseId;
}

function resolveFoxholeStructureStickySortMetadata(
    asset: typeof FOXHOLE_CATALOG.assets[number],
    buildRouteSourceAsset: typeof FOXHOLE_CATALOG.assets[number],
    destroyed = false,
): { anchorId: string; variantRank: number; } {
    if (destroyed) {
        return {
            anchorId: asset.foxholeKey,
            variantRank: FOXHOLE_STICKY_SORT_VARIANT_RANKS.destroyed,
        };
    }

    if (asset.isDestroyed) {
        return {
            anchorId: asset.intactStructureId ?? asset.upgradeStructureId ?? buildRouteSourceAsset.foxholeKey ?? asset.foxholeKey,
            variantRank: FOXHOLE_STICKY_SORT_VARIANT_RANKS.destroyed,
        };
    }

    if (
        asset.isUpgrade
        && asset.tier == null
        && buildRouteSourceAsset.foxholeKey !== asset.foxholeKey
    ) {
        return {
            anchorId: buildRouteSourceAsset.foxholeKey,
            variantRank: FOXHOLE_STICKY_SORT_VARIANT_RANKS.buildsite,
        };
    }

    return {
        anchorId: asset.foxholeKey,
        variantRank: FOXHOLE_STICKY_SORT_VARIANT_RANKS.base,
    };
}

function resolveFoxholeUpgradeStickySortMetadata(
    asset: typeof FOXHOLE_CATALOG.assets[number],
    slotId: string,
    variantId: string,
    destroyed = false,
): { anchorId: string; variantRank: number; } {
    return {
        anchorId: destroyed
            ? createFoxholeUpgradePlacementAssetId(asset, slotId, variantId)
            : asset.foxholeKey,
        variantRank: destroyed
            ? FOXHOLE_STICKY_SORT_VARIANT_RANKS.upgradeDestroyed
            : FOXHOLE_STICKY_SORT_VARIANT_RANKS.upgrade,
    };
}

function resolveFoxholeAssetPreferredLocale(context: { getSetting: (settingId: string) => unknown; }): string | undefined {
    const configuredLocale = String(context.getSetting(FOXHOLE_LOCALE_SETTING_ID) ?? '').trim().toLowerCase();
    return !configuredLocale || configuredLocale === 'auto'
        ? undefined
        : configuredLocale;
}

function getFoxholeAssetMetadataString(asset: { metadata?: Record<string, unknown> | null | undefined; }, key: string): string {
    if (!asset.metadata || typeof asset.metadata !== 'object' || Array.isArray(asset.metadata)) {
        return '';
    }

    const value = asset.metadata[key];
    return typeof value === 'string'
        ? value.trim()
        : '';
}

function formatDestroyedStructureName(locale: string | null | undefined, baseName: string): string {
    const trimmedBaseName = String(baseName ?? '').trim();
    if (!trimmedBaseName) {
        return trimmedBaseName;
    }

    const normalizedLocale = String(locale ?? '').trim().toLowerCase();
    const primaryLocale = normalizedLocale.split(/[-_]/)[0] ?? '';
    const format = DESTROYED_STRUCTURE_NAME_FORMATS[normalizedLocale]
        ?? DESTROYED_STRUCTURE_NAME_FORMATS[primaryLocale]
        ?? DESTROYED_STRUCTURE_NAME_FORMATS.en;

    return `${format.prefix}${trimmedBaseName}${format.suffix}`.trim();
}

function resolveFoxholeSyntheticStructureName(
    asset: { id?: string | null; metadata?: Record<string, unknown> | null | undefined; },
    fallback: string | null | undefined,
    context: { appBaseUrl: string; getSetting: (settingId: string) => unknown; },
): string | undefined {
    const assetId = String(asset.id ?? '').trim();
    const isDestroyed = asset.metadata?.defaultDestroyedState === true;
    const isUpgradePlacement = assetId.startsWith('upgrade:');
    if (!isDestroyed && !isUpgradePlacement) {
        return undefined;
    }

    const baseNameLocalizationId = getFoxholeAssetMetadataString(asset, 'nameLocalizationId');
    if (!baseNameLocalizationId) {
        return undefined;
    }

    const preferredLocale = resolveFoxholeAssetPreferredLocale(context);
    const locale = getFoxholePreferredLocale(preferredLocale);
    const baseNameFallback = getFoxholeAssetMetadataString(asset, 'baseNameFallback') || String(fallback ?? '').trim();
    let localizedName = getFoxholeLocalizedText(
        context.appBaseUrl,
        baseNameLocalizationId,
        baseNameFallback,
        preferredLocale,
    );

    if (isUpgradePlacement) {
        const upgradeNameFallback = getFoxholeAssetMetadataString(asset, 'upgradeNameFallback');
        const upgradeNameLocalizationId = getFoxholeAssetMetadataString(asset, 'upgradeNameLocalizationId');
        const localizedUpgradeName = upgradeNameLocalizationId
            ? getFoxholeLocalizedText(
                context.appBaseUrl,
                upgradeNameLocalizationId,
                upgradeNameFallback,
                preferredLocale,
            )
            : upgradeNameFallback;

        if (localizedUpgradeName) {
            localizedName = `${localizedName} (${localizedUpgradeName})`;
        }
    }

    return isDestroyed
        ? formatDestroyedStructureName(locale, localizedName)
        : localizedName;
}

function isFoxholeStructureAssetVisible(
    asset: typeof FOXHOLE_CATALOG.assets[number],
    destroyed = false,
): boolean {
    if (asset.hideInList) {
        return false;
    }

    return !destroyed || Boolean(asset.destroyed);
}

function createFoxholeStructureAssetDefinition(asset: typeof FOXHOLE_CATALOG.assets[number], destroyed = false) {
    const parentAsset = asset.parentStructureId
        ? (FOXHOLE_CATALOG.assetByKey[String(asset.parentStructureId).trim()] ?? null)
        : null;
    const publicAssetId = parentAsset?.foxholeKey ?? asset.foxholeKey;
    const buildRouteSourceAsset = resolveFoxholeStructureBuildRouteSourceAsset(FOXHOLE_CATALOG, asset);
    const isUpgradeAsset = asset.isUpgrade || isFoxholeConversionTargetAsset(FOXHOLE_CATALOG, asset);
    const resolvedTier = resolveFoxholeStructureTier(asset);
    const hasHigherTierSibling = hasHigherTierFoxholeStructureAsset(asset);
    const destroyedVisual = destroyed ? asset.destroyed : null;
    const name = destroyed ? formatDestroyedStructureName('en', asset.name) : asset.name;
    const description = asset.description;
    const stickySort = resolveFoxholeStructureStickySortMetadata(asset, buildRouteSourceAsset, destroyed);

    return {
        id: destroyed ? `${asset.foxholeKey}:destroyed` : asset.foxholeKey,
        type: FOXHOLE_ASSET_NODE_TYPE,
        visible: () => isFoxholeStructureAssetVisible(asset, destroyed),
        name,
        description,
        previewUrl: (destroyedVisual?.previewUrl ?? asset.previewUrl) ?? undefined,
        category: asset.categoryName,
        order: resolveFoxholeStructureCatalogSortOrder(FOXHOLE_CATALOG, asset),
        keywords: [
            asset.buildingKey,
            asset.categoryKey,
            ...resolveFoxholeAssetSignalKeywords(asset),
            ...(asset.faction ? [asset.faction] : []),
            ...(resolvedTier ? [`tier-${resolvedTier}`] : []),
            ...(asset.aliases ?? []),
            ...(destroyed ? ['destroyed', 'wreck', 'ruined'] : []),
        ],
        metadata: {
            foxholeKey: asset.foxholeKey,
            codeName: asset.codeName,
            legacyKeys: asset.legacyKeys,
            itemIconUrl: destroyed ? (destroyedVisual?.iconUrl ?? asset.iconUrl) : asset.iconUrl,
            previewIconUrl: destroyed ? (destroyedVisual?.previewIconUrl ?? asset.previewIconUrl) : asset.previewIconUrl,
            previewIsIconFallback: asset.previewIsIconFallback,
            previewDirection: destroyed ? (destroyedVisual?.previewDirection ?? asset.previewDirection) : asset.previewDirection,
            categoryIcon: asset.categoryIconUrl,
            categoryOrder: asset.categoryOrder,
            categoryLocalizationId: asset.categoryNameLocalizationId,
            faction: asset.faction,
            tier: resolvedTier,
            techId: asset.techId,
            isVehicle: asset.isVehicle,
            isBunker: asset.isBunker,
            isFacility: asset.isFacility,
            isWorldStructure: asset.isWorldStructure,
            isDestroyed: asset.isDestroyed,
            isBreached: asset.isBreached,
            profileType: asset.profileType,
            armourType: asset.armourType,
            hideInList: asset.hideInList,
            hasHigherTierSibling,
            upgradeStructureCodeName: asset.upgradeStructureCodeName,
            conversionCodeNames: asset.conversionCodeNames,
            downgradeStructureCodeName: asset.downgradeStructureCodeName,
            upgradeStructureId: asset.upgradeStructureId,
            conversionStructureIds: asset.conversionStructureIds,
            downgradeStructureId: asset.downgradeStructureId,
            isUpgrade: isUpgradeAsset,
            upgradeName: asset.upgradeName,
            parentStructureId: asset.parentStructureId,
            rootStructureId: asset.rootStructureId,
            appliedModificationId: asset.appliedModificationId,
            buildRouteSourceId: buildRouteSourceAsset.foxholeKey,
            baseNameFallback: asset.name,
            nameLocalizationId: asset.nameLocalizationId,
            descriptionLocalizationId: asset.descriptionLocalizationId,
            assetIdentifier: `#${publicAssetId}`,
            assetClipboardValue: publicAssetId,
            defaultDestroyedState: destroyed,
            stickySortAnchorId: stickySort.anchorId,
            stickySortVariantRank: stickySort.variantRank,
            ...resolveFoxholeStructureAssetGridCellMetadata(asset),
            ...resolveFoxholeAssetCompletionMetadata(asset.foxholeKey, asset.categoryKey),
        },
        createSnapshot: ({ x, y, z, asIcon }) => asIcon
            ? createNixieIconAssetSnapshot({
                key: asset.foxholeKey,
                label: name,
                textureUrl: destroyed ? (destroyedVisual?.iconUrl ?? asset.iconUrl ?? '') : (asset.iconUrl ?? ''),
                x,
                y,
                z,
            })
            : createFoxholeStructureAssetSnapshot({
                asset,
                structure: FOXHOLE_CATALOG.structureByKey[asset.foxholeKey],
                parentAsset,
                label: name,
                destroyed,
                x,
                y,
                z,
            }),
    };
}

function createFoxholeUpgradeAssetDefinition(
    asset: typeof FOXHOLE_CATALOG.assets[number],
    slot: typeof asset.modificationSlots[number],
    variant: typeof slot.variants[number],
    destroyed = false,
) {
    const appliedModificationId = String(variant.appliedModificationId ?? variant.id ?? '').trim();
    if (!variant.isUpgrade || !appliedModificationId) {
        return null;
    }

    if (findFoxholeAppliedModificationAssetFromCatalog(FOXHOLE_CATALOG, {
        parentStructureId: asset.foxholeKey,
        appliedModificationId,
    })) {
        return null;
    }

    const modificationVariantIds = setFoxholeModificationSlotVariantSelection({}, slot, variant.id);
    const buildRouteSourceAsset = resolveFoxholeStructureBuildRouteSourceAsset(FOXHOLE_CATALOG, asset);
    const upgradeName = String(variant.upgradeName ?? variant.name ?? '').trim() || 'Upgrade';
    const resolvedTier = resolveFoxholeStructureTier(asset);
    const hasHigherTierSibling = hasHigherTierFoxholeStructureAsset(asset);
    const baseUpgradeName = `${asset.name} (${upgradeName})`;
    const name = destroyed ? formatDestroyedStructureName('en', baseUpgradeName) : baseUpgradeName;
    const description = variant.description || '';
    const destroyedVisual = destroyed ? asset.destroyed : null;
    const stickySort = resolveFoxholeUpgradeStickySortMetadata(asset, slot.id, variant.id, destroyed);

    return {
        id: createFoxholeUpgradePlacementAssetId(asset, slot.id, variant.id, destroyed),
        type: FOXHOLE_ASSET_NODE_TYPE,
        visible: () => isFoxholeStructureAssetVisible(asset, destroyed),
        name,
        description,
        previewUrl: destroyed
            ? (destroyedVisual?.previewUrl ?? asset.previewUrl) ?? undefined
            : (variant.previewUrl ?? asset.previewUrl) ?? undefined,
        category: asset.categoryName,
        order: resolveFoxholeStructureCatalogSortOrder(FOXHOLE_CATALOG, asset),
        keywords: [
            asset.buildingKey,
            asset.codeName,
            asset.categoryKey,
            ...resolveFoxholeAssetSignalKeywords(asset),
            ...(asset.faction ? [asset.faction] : []),
            ...(resolvedTier ? [`tier-${resolvedTier}`] : []),
            appliedModificationId,
            variant.id,
            upgradeName,
            ...(asset.aliases ?? []),
            ...(destroyed ? ['destroyed', 'wreck', 'ruined'] : []),
        ],
        metadata: {
            foxholeKey: asset.foxholeKey,
            codeName: asset.codeName,
            legacyKeys: asset.legacyKeys,
            itemIconUrl: destroyed
                ? (destroyedVisual?.iconUrl ?? asset.iconUrl)
                : (variant.iconUrl ?? asset.iconUrl),
            previewIconUrl: destroyed
                ? (destroyedVisual?.previewIconUrl ?? asset.previewIconUrl)
                : (variant.previewIconUrl ?? asset.previewIconUrl),
            previewIsIconFallback: asset.previewIsIconFallback,
            previewDirection: destroyed
                ? (destroyedVisual?.previewDirection ?? asset.previewDirection)
                : (variant.previewDirection ?? asset.previewDirection),
            categoryIcon: asset.categoryIconUrl,
            categoryOrder: asset.categoryOrder,
            categoryLocalizationId: asset.categoryNameLocalizationId,
            faction: asset.faction,
            tier: resolvedTier,
            techId: asset.techId,
            isVehicle: asset.isVehicle,
            isBunker: asset.isBunker,
            isFacility: asset.isFacility,
            isWorldStructure: asset.isWorldStructure,
            isDestroyed: asset.isDestroyed,
            isBreached: asset.isBreached,
            profileType: asset.profileType,
            armourType: asset.armourType,
            hideInList: asset.hideInList,
            hasHigherTierSibling,
            upgradeStructureCodeName: asset.upgradeStructureCodeName,
            conversionCodeNames: asset.conversionCodeNames,
            downgradeStructureCodeName: asset.downgradeStructureCodeName,
            upgradeStructureId: asset.upgradeStructureId,
            conversionStructureIds: asset.conversionStructureIds,
            downgradeStructureId: asset.downgradeStructureId,
            isUpgrade: true,
            upgradeName,
            parentStructureId: asset.foxholeKey,
            rootStructureId: asset.rootStructureId ?? asset.foxholeKey,
            appliedModificationId,
            buildRouteSourceId: buildRouteSourceAsset.foxholeKey,
            baseNameFallback: asset.name,
            nameLocalizationId: asset.nameLocalizationId,
            upgradeNameFallback: upgradeName,
            upgradeNameLocalizationId: variant.nameLocalizationId,
            descriptionLocalizationId: variant.descriptionLocalizationId,
            assetIdentifier: `#${asset.foxholeKey}`,
            assetClipboardValue: asset.foxholeKey,
            defaultDestroyedState: destroyed,
            stickySortAnchorId: stickySort.anchorId,
            stickySortVariantRank: stickySort.variantRank,
            ...resolveFoxholeStructureAssetGridCellMetadata(asset),
            ...resolveFoxholeAssetCompletionMetadata(asset.foxholeKey, asset.categoryKey),
        },
        createSnapshot: ({ x, y, z, asIcon }) => asIcon
            ? createNixieIconAssetSnapshot({
                key: asset.foxholeKey,
                label: name,
                textureUrl: asset.iconUrl ?? '',
                x,
                y,
                z,
            })
            : createFoxholeStructureAssetSnapshot({
                asset,
                structure: FOXHOLE_CATALOG.structureByKey[asset.foxholeKey],
                label: name,
                destroyed,
                modificationVariantIds,
                x,
                y,
                z,
            }),
    };
}

function createFoxholeUpgradeAssetDefinitions(asset: typeof FOXHOLE_CATALOG.assets[number]) {
    if (asset.isUpgrade) {
        return [];
    }

    return asset.modificationSlots.flatMap(slot => slot.variants.flatMap(variant => {
        const definitions = [createFoxholeUpgradeAssetDefinition(asset, slot, variant)];
        if (asset.destroyed) {
            definitions.push(createFoxholeUpgradeAssetDefinition(asset, slot, variant, true));
        }

        return definitions.filter(Boolean);
    }));
}

interface FoxholeSelectionTierMutationEntry {
    nodeId: string;
    mutation: FoxholeStructureTierMutation;
}

function collectFoxholeSelectionTierMutationEntries(
    context: NixieCommandContext,
    direction: FoxholeStructureTierDirection,
): FoxholeSelectionTierMutationEntry[] {
    const selectedNodeIds = Array.from(new Set(context.getSelectedNodeIds().map(id => String(id ?? '').trim()).filter(Boolean)));
    return selectedNodeIds.flatMap(nodeId => {
        const node = context.project.scene.getNodeById(nodeId);
        const snapshot = node?.toBoardSnapshot();
        if (!snapshot || snapshot.type !== FOXHOLE_ASSET_NODE_TYPE) {
            return [];
        }

        const state = (snapshot.state ?? {}) as Partial<FoxholeStructureState>;
        if (state.destroyed === true || state.packaged === true) {
            return [];
        }

        const mutation = resolveFoxholeStructureTierMutation(FOXHOLE_CATALOG, state, direction);
        return mutation ? [{ nodeId, mutation }] : [];
    });
}

function canRunFoxholeSelectionTierCommand(
    context: NixieCommandContext,
    direction: FoxholeStructureTierDirection,
): boolean {
    if (!context.capabilities.canEdit) {
        return false;
    }

    const entries = collectFoxholeSelectionTierMutationEntries(context, direction);
    return entries.length > 0 && context.project.canMutateNodeIds(entries.map(entry => entry.nodeId));
}

function createFoxholeSelectionTierMutationGroupKey(patch: Record<string, unknown>): string {
    return JSON.stringify(patch);
}

function cloneFoxholeTierMutationValue<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
}

function buildFoxholeSelectionTierInversePatch(
    state: Partial<FoxholeStructureState>,
): Pick<FoxholeStructureState, 'foxholeKey' | 'modificationVariantIds'> {
    return {
        foxholeKey: String(state.foxholeKey ?? '').trim(),
        modificationVariantIds: cloneFoxholeTierMutationValue(state.modificationVariantIds ?? {}),
    };
}

async function runFoxholeSelectionTierCommand(
    context: NixieCommandContext,
    direction: FoxholeStructureTierDirection,
    reason: string,
): Promise<void> {
    const entries = collectFoxholeSelectionTierMutationEntries(context, direction);
    const eligibleNodeIds = entries.map(entry => entry.nodeId);
    if (!eligibleNodeIds.length || !context.project.canMutateNodeIds(eligibleNodeIds)) {
        return;
    }

    const operations: NixieProjectOperation[] = [];
    const inverseOperations: NixieProjectOperation[] = [];
    for (const entry of entries) {
        const node = context.project.scene.getNodeById(entry.nodeId);
        const snapshot = node?.toBoardSnapshot();
        if (!snapshot || snapshot.type !== FOXHOLE_ASSET_NODE_TYPE) {
            continue;
        }

        const currentState = (snapshot.state ?? {}) as Partial<FoxholeStructureState>;
        const patch = cloneFoxholeTierMutationValue(entry.mutation.patch as Record<string, unknown>);
        operations.push({
            type: 'update',
            nodeId: entry.nodeId,
            patch,
        });
        inverseOperations.unshift({
            type: 'update',
            nodeId: entry.nodeId,
            patch: buildFoxholeSelectionTierInversePatch(currentState),
        });
    }

    if (!operations.length) {
        return;
    }

    await context.project.executeBatch(
        operations,
        inverseOperations,
        reason,
        direction === 'down' ? 'Tier Down Foxhole Structures' : 'Tier Up Foxhole Structures',
    );
}

function getSingleSelectedFoxholeStructure(context: NixieCommandContext): FoxholeStructureNode | null {
    const selectedIds = context.getSelectedNodeIds();
    if (selectedIds.length !== 1) {
        return null;
    }
    const node = context.project.scene.getNodeById(selectedIds[0]!);
    return node instanceof FoxholeStructureNode ? node : null;
}

function exportFoxholeLineOfSightOverride(context: NixieCommandContext): void {
    const structure = getSingleSelectedFoxholeStructure(context);
    const foxholeKey = String(structure?.boardState.foxholeKey ?? '').trim().toLowerCase();
    if (!structure || !foxholeKey) {
        return;
    }

    const metrics = readHitboxHostMetrics(structure);
    const lineOfSightPolygons = listHitboxChildren(structure)
        .map(hitbox => {
            const state = hitbox.boardState as NixieHitboxState;
            const points = scaleHitboxPointsToCurrentHostLocal(
                state.points,
                Number(state.basisWidth) || metrics.width,
                Number(state.basisHeight) || metrics.height,
                metrics,
            ).map(point => Math.round((point / FOXHOLE_BOARD_PIXELS_PER_METER) * 1000) / 1000);
            return { shape: points };
        })
        .filter(polygon => polygon.shape.length >= 6);
    if (lineOfSightPolygons.length === 0 || typeof window === 'undefined') {
        return;
    }

    const blob = new Blob([JSON.stringify({ lineOfSightPolygons }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${foxholeKey}.manifest.json`;
    link.click();
    URL.revokeObjectURL(url);
}

async function copyFoxholeLineOfSightAgentPrompt(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    const foxholeKey = String(structure?.boardState.foxholeKey ?? '').trim().toLowerCase();
    if (!structure || !foxholeKey) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    const lineOfSightPolygons = listHitboxChildren(structure)
        .map(hitbox => {
            const state = hitbox.boardState as NixieHitboxState;
            return {
                shape: scaleHitboxPointsToCurrentHostLocal(
                    state.points,
                    Number(state.basisWidth) || metrics.width,
                    Number(state.basisHeight) || metrics.height,
                    metrics,
                ).map(point => Math.round((point / FOXHOLE_BOARD_PIXELS_PER_METER) * 1000) / 1000),
            };
        })
        .filter(polygon => polygon.shape.length >= 6);
    if (!lineOfSightPolygons.length) {
        return;
    }
    await context.clipboard.writeText([
        `Update the authored FoxWatch override for \`${foxholeKey}\`.`,
        '',
        'Repository: `https://github.com/jimdcunningham/nixie-foxhole`',
        '',
        `Edit \`tools/foxwatch/asset-overrides/${foxholeKey}/manifest.json\` and set \`lineOfSightPolygons\` to exactly:`,
        '```json',
        JSON.stringify(lineOfSightPolygons, null, 2),
        '```',
        '',
        `Preserve every other existing manifest property. From the nixie-foxhole repository root, run \`node ./tools/foxwatch/run-foxwatch.mjs refresh --only ${foxholeKey}\` to refresh the generated Foxhole assets. Do not edit generated public manifests directly.`,
    ].join('\n'));
}

async function addFoxholeLineOfSightHitbox(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure || !context.project.capabilities.value.canEdit) {
        return;
    }

    const metrics = readHitboxHostMetrics(structure);
    const existingCount = listHitboxChildren(structure).length;
    const fallback = [
        -metrics.width * metrics.anchorX, -metrics.height * metrics.anchorY,
        metrics.width * (1 - metrics.anchorX), -metrics.height * metrics.anchorY,
        metrics.width * (1 - metrics.anchorX), metrics.height * (1 - metrics.anchorY),
        -metrics.width * metrics.anchorX, metrics.height * (1 - metrics.anchorY),
    ];
    // Reuse the asset's authored LOS shape whenever it has one, so every added
    // hitbox begins at the same useful size instead of an arbitrary editor box.
    const points = structure.getDefaultLineOfSightHitboxes()[0]?.slice() ?? fallback;
    const created = await context.project.createNode(createNixieHitboxSnapshot({
        id: createNixieHitboxNodeId(),
        points,
        name: existingCount === 0 ? 'solid' : `solid-${existingCount + 1}`,
        role: 'solid',
        basisWidth: metrics.width,
        basisHeight: metrics.height,
    }), String(structure.boardId), undefined, 'foxhole-hitbox-add:create');

    if (created) {
        context.setSelectedNodeIds([String(structure.boardId)], 'foxhole-hitbox-add:select');
    }
}

async function ensureFoxholeLineOfSightHitboxes(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure || !context.project.capabilities.value.canEdit || listHitboxChildren(structure).length > 0) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    const sourcePolygons = structure.getDefaultLineOfSightHitboxes();
    if (sourcePolygons.length === 0) {
        return;
    }
    for (const [index, points] of sourcePolygons.entries()) {
        await context.project.createNode(createNixieHitboxSnapshot({
            id: createNixieHitboxNodeId(),
            points,
            name: index === 0 ? 'solid' : `solid-${index + 1}`,
            role: 'solid',
            basisWidth: metrics.width,
            basisHeight: metrics.height,
        }), String(structure.boardId), undefined, 'foxhole-hitbox-ensure:create');
    }
    context.setSelectedNodeIds([String(structure.boardId)], 'foxhole-hitbox-ensure:select');
}

async function dissolveFoxholeLineOfSightHitboxTriangles(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure || !context.project.capabilities.value.canEdit) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    const hitboxes = listHitboxChildren(structure)
        .map(hitbox => ({ hitbox, state: hitbox.boardState as NixieHitboxState }))
        .filter(({ state }) => state.points.length >= 6 && state.points.length % 2 === 0);
    const hitboxesByRole = new Map<NixieHitboxState['role'], typeof hitboxes>();
    for (const entry of hitboxes) {
        const entries = hitboxesByRole.get(entry.state.role) ?? [];
        entries.push(entry);
        hitboxesByRole.set(entry.state.role, entries);
    }

    let changed = false;
    for (const entries of hitboxesByRole.values()) {
        const dissolved = dissolveHitboxPolygons(entries.map(({ state }) => scaleHitboxPointsToCurrentHostLocal(
            state.points,
            Number(state.basisWidth) || metrics.width,
            Number(state.basisHeight) || metrics.height,
            metrics,
        )));
        if (!dissolved || dissolved.length >= entries.length) {
            continue;
        }
        for (const [index, points] of dissolved.entries()) {
            const { hitbox, state } = entries[index]!;
            const { scaleX, scaleY } = getHitboxHostSizeScale(
                Number(state.basisWidth) || metrics.width,
                Number(state.basisHeight) || metrics.height,
                metrics,
            );
            await context.project.patchNode(String(hitbox.boardId), {
                points: points.map((point, pointIndex) => point / (pointIndex % 2 === 0 ? scaleX : scaleY)),
                basisWidth: metrics.width,
                basisHeight: metrics.height,
            }, 'foxhole-hitbox-dissolve:update');
        }
        for (const { hitbox } of entries.slice(dissolved.length)) {
            await context.project.deleteNode(String(hitbox.boardId), 'foxhole-hitbox-dissolve:delete');
        }
        changed = true;
    }
    if (changed) {
        context.setSelectedNodeIds([String(structure.boardId)], 'foxhole-hitbox-dissolve:select');
    }
}

type FoxholeHitboxClipboardPayload = {
    kind: typeof FOXHOLE_HITBOX_CLIPBOARD_KIND;
    version: typeof FOXHOLE_HITBOX_CLIPBOARD_VERSION;
    polygons: Array<{
        points: number[];
        name?: string;
        role?: NixieHitboxState['role'];
    }>;
};

function parseFoxholeHitboxClipboardPayload(value: string): FoxholeHitboxClipboardPayload | null {
    try {
        const parsed = JSON.parse(value) as Partial<FoxholeHitboxClipboardPayload>;
        if (parsed.kind !== FOXHOLE_HITBOX_CLIPBOARD_KIND
            || parsed.version !== FOXHOLE_HITBOX_CLIPBOARD_VERSION
            || !Array.isArray(parsed.polygons)) {
            return null;
        }
        const polygons = parsed.polygons
            .filter((polygon): polygon is { points: unknown; name?: unknown; role?: unknown; } => !!polygon && typeof polygon === 'object')
            .map(polygon => ({
                points: Array.isArray(polygon.points)
                    ? polygon.points.filter((point): point is number => typeof point === 'number' && Number.isFinite(point))
                    : [],
                ...(typeof polygon.name === 'string' ? { name: polygon.name } : {}),
                ...(polygon.role === 'solid' || polygon.role === 'hurt' || polygon.role === 'sensor' || polygon.role === 'custom'
                    ? { role: polygon.role }
                    : {}),
            }))
            .filter(polygon => polygon.points.length >= 6 && polygon.points.length % 2 === 0);
        return polygons.length > 0 ? { kind: parsed.kind, version: parsed.version, polygons } : null;
    } catch {
        return null;
    }
}

async function copyFoxholeLineOfSightHitboxes(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    if (!(metrics.width > 0) || !(metrics.height > 0)) {
        return;
    }
    const polygons = listHitboxChildren(structure).map(hitbox => {
        const state = hitbox.boardState as NixieHitboxState;
        const localPoints = scaleHitboxPointsToCurrentHostLocal(
            state.points,
            Number(state.basisWidth) || metrics.width,
            Number(state.basisHeight) || metrics.height,
            metrics,
        );
        return {
            points: localPoints.map((point, index) => index % 2 === 0
                ? (point / metrics.width) + metrics.anchorX
                : (point / metrics.height) + metrics.anchorY),
            name: state.name,
            role: state.role,
        };
    }).filter(polygon => polygon.points.length >= 6);
    if (!polygons.length) {
        return;
    }
    await context.clipboard.writeText(JSON.stringify({
        kind: FOXHOLE_HITBOX_CLIPBOARD_KIND,
        version: FOXHOLE_HITBOX_CLIPBOARD_VERSION,
        polygons,
    } satisfies FoxholeHitboxClipboardPayload));
}

async function pasteFoxholeLineOfSightHitboxes(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure || !context.project.capabilities.value.canEdit) {
        return;
    }
    const payload = parseFoxholeHitboxClipboardPayload(await context.clipboard.readText());
    if (!payload) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    const existingCount = listHitboxChildren(structure).length;
    let createdCount = 0;
    for (const polygon of payload.polygons) {
        const points = polygon.points.map((point, index) => index % 2 === 0
            ? (point - metrics.anchorX) * metrics.width
            : (point - metrics.anchorY) * metrics.height);
        const created = await context.project.createNode(createNixieHitboxSnapshot({
            id: createNixieHitboxNodeId(),
            points,
            name: polygon.name?.trim() || `solid-${existingCount + createdCount + 1}`,
            role: polygon.role ?? 'solid',
            basisWidth: metrics.width,
            basisHeight: metrics.height,
        }), String(structure.boardId), undefined, 'foxhole-hitbox-paste:create');
        if (created) {
            createdCount += 1;
        }
    }
    if (createdCount > 0) {
        context.setSelectedNodeIds([String(structure.boardId)], 'foxhole-hitbox-paste:select');
    }
}

function exportFoxholeLineOfSightHandoff(context: NixieCommandContext): void {
    const entries = context.getSelectedNodeIds()
        .map(id => context.project.scene.getNodeById(id))
        .filter((node): node is FoxholeStructureNode => node instanceof FoxholeStructureNode)
        .map(structure => {
            const foxholeKey = String(structure.boardState.foxholeKey ?? '').trim().toLowerCase();
            const metrics = readHitboxHostMetrics(structure);
            const lineOfSightPolygons = listHitboxChildren(structure).map(hitbox => {
                const state = hitbox.boardState as NixieHitboxState;
                return { shape: scaleHitboxPointsToCurrentHostLocal(state.points, Number(state.basisWidth) || metrics.width, Number(state.basisHeight) || metrics.height, metrics)
                    .map(point => Math.round((point / FOXHOLE_BOARD_PIXELS_PER_METER) * 1000) / 1000) };
            }).filter(polygon => polygon.shape.length >= 6);
            return { foxholeKey, lineOfSightPolygons };
        })
        .filter(entry => entry.foxholeKey && entry.lineOfSightPolygons.length > 0);
    const uniqueEntries = [...new Map(entries.map(entry => [entry.foxholeKey, entry])).values()];
    if (uniqueEntries.length === 0 || typeof window === 'undefined') return;
    const handoff = {
        kind: 'foxhole-line-of-sight-handoff', version: 1,
        repository: 'https://github.com/jimdcunningham/nixie-foxhole',
        instructions: 'In the nixie-foxhole repository, merge each lineOfSightPolygons value into tools/foxwatch/asset-overrides/<foxholeKey>/manifest.json, then run node ./tools/foxwatch/run-foxwatch.mjs refresh --only <comma-separated foxholeKey values> from that repository root.',
        overrides: uniqueEntries,
    };
    const payload = JSON.stringify(handoff, null, 2);
    void context.clipboard.writeText(payload);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a'); link.href = url; link.download = 'foxhole-line-of-sight-handoff.json'; link.click(); URL.revokeObjectURL(url);
}

export default defineContribution({
    settings: [
        ...foxholeRangeUserSettings,
        ...foxholeRangeDebugUserSettings,
        ...foxholeAssetFilterSettings,
        ...foxholeStructureDebugSettings,
    ],
    commands: withCommandSettingsPageSection([
        {
            id: 'foxhole.selection.tierDown',
            type: 'editor',
            icon: 'ph:arrow-down',
            name: 'Tier Down Foxhole Structures',
            description: 'Downgrade selected Foxhole structures, including clearing active facility upgrades back to their base structure.',
            defaultKeybinding: {
                primary: { key: '[' },
            },
            enabled: context => canRunFoxholeSelectionTierCommand(context, 'down'),
            run: async context => {
                await runFoxholeSelectionTierCommand(context, 'down', 'command:foxhole.selection.tierDown');
            },
        },
        {
            id: 'foxhole.selection.tierUp',
            type: 'editor',
            icon: 'ph:arrow-up',
            name: 'Tier Up Foxhole Structures',
            description: 'Upgrade selected Foxhole structures to their next explicit tier when available.',
            defaultKeybinding: {
                primary: { key: ']' },
            },
            enabled: context => canRunFoxholeSelectionTierCommand(context, 'up'),
            run: async context => {
                await runFoxholeSelectionTierCommand(context, 'up', 'command:foxhole.selection.tierUp');
            },
        },
        {
            id: 'foxhole.lineOfSight.addHitbox',
            type: 'editor',
            icon: 'ph:plus-circle',
            name: 'Add Foxhole Hitbox',
            description: 'Add a centered rectangle hitbox to the selected asset.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => Boolean(getSingleSelectedFoxholeStructure(context) && context.project.capabilities.value.canEdit),
            run: async context => await addFoxholeLineOfSightHitbox(context),
        },
        {
            id: 'foxhole.lineOfSight.ensureHitboxes',
            type: 'editor',
            icon: 'ph:polygon',
            name: 'Prepare Foxhole Hitboxes',
            description: 'Load authored Foxhole hitboxes into the selected asset for editing.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                return Boolean(structure
                    && context.project.capabilities.value.canEdit
                    && listHitboxChildren(structure).length === 0
                    && structure.getDefaultLineOfSightHitboxes().length > 0);
            },
            run: async context => await ensureFoxholeLineOfSightHitboxes(context),
        },
        {
            id: 'foxhole.lineOfSight.dissolveTriangles',
            type: 'editor',
            icon: 'ph:magic-wand',
            name: 'Dissolve Foxhole Hitbox Triangles',
            description: 'Merge same-role hitboxes that share an edge into their outside polygons.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                if (!structure || !context.project.capabilities.value.canEdit) {
                    return false;
                }
                const metrics = readHitboxHostMetrics(structure);
                const polygonsByRole = new Map<NixieHitboxState['role'], number[][]>();
                for (const hitbox of listHitboxChildren(structure)) {
                    const state = hitbox.boardState as NixieHitboxState;
                    const polygons = polygonsByRole.get(state.role) ?? [];
                    polygons.push(scaleHitboxPointsToCurrentHostLocal(
                        state.points,
                        Number(state.basisWidth) || metrics.width,
                        Number(state.basisHeight) || metrics.height,
                        metrics,
                    ));
                    polygonsByRole.set(state.role, polygons);
                }
                return [...polygonsByRole.values()].some(polygons => canDissolveHitboxPolygons(polygons));
            },
            run: async context => await dissolveFoxholeLineOfSightHitboxTriangles(context),
        },
        {
            id: 'foxhole.lineOfSight.copyHitboxes',
            type: 'editor',
            icon: 'ph:copy',
            name: 'Copy Foxhole Hitboxes',
            description: 'Copy the selected asset’s hitboxes for another Foxhole asset.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                return Boolean(structure && listHitboxChildren(structure).length > 0);
            },
            run: async context => await copyFoxholeLineOfSightHitboxes(context),
        },
        {
            id: 'foxhole.lineOfSight.pasteHitboxes',
            type: 'editor',
            icon: 'ph:clipboard',
            name: 'Paste Foxhole Hitboxes',
            description: 'Paste copied hitboxes onto the selected asset.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => Boolean(getSingleSelectedFoxholeStructure(context) && context.project.capabilities.value.canEdit),
            run: async context => await pasteFoxholeLineOfSightHitboxes(context),
        },
        {
            id: 'foxhole.lineOfSight.exportOverride',
            type: 'editor',
            icon: 'ph:eye',
            name: 'Export Foxhole Line of Sight Override',
            description: 'Export the selected asset’s drawn hitboxes to its FoxWatch manifest override payload.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                return Boolean(structure && listHitboxChildren(structure).length > 0);
            },
            run: context => {
                exportFoxholeLineOfSightOverride(context);
            },
        },
        {
            id: 'foxhole.lineOfSight.copyAgentPrompt',
            type: 'editor',
            icon: 'ph:robot',
            name: 'Copy Foxhole Hitbox Agent Prompt',
            description: 'Copy an agent-ready FoxWatch override prompt for the selected asset.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                return Boolean(structure && listHitboxChildren(structure).length > 0);
            },
            run: async context => await copyFoxholeLineOfSightAgentPrompt(context),
        },
        {
            id: 'foxhole.lineOfSight.exportHandoff', type: 'editor', icon: 'ph:clipboard-text',
            name: 'Export Foxhole Hitbox Handoff', description: 'Download and copy all selected assets’ hitbox overrides for an agent handoff.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => context.getSelectedNodeIds().some(id => context.project.scene.getNodeById(id) instanceof FoxholeStructureNode),
            run: context => exportFoxholeLineOfSightHandoff(context),
        },
    ], FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION),
    menus: [
        {
            menu: NIXIE_DEBUG_MENU_ID, order: 356,
            item: { label: 'Export Hitbox Handoff', commandId: 'foxhole.lineOfSight.exportHandoff' },
        },
    ],
    textureResolvers: [
        {
            id: 'foxhole.textures',
            order: 100,
            resolveTextureUrl: (textureKey, context) => resolveFoxholeTextureUrl(
                textureKey,
                createFoxholeAssetsBaseUrl(context.appBaseUrl),
            ),
        },
    ],
    assets: [
        {
            id: FOXHOLE_ASSET_SOURCE_ID,
            name: 'Foxhole Assets',
            visible: () => getNixieEditorDocumentSessionBridge()?.isSceneV2Active.value !== true,
            description: 'Structures and item icons contributed by the Foxhole Planner addon.',
            order: 100,
            getPreferredLocales: context => {
                const value = String(context.getSetting(FOXHOLE_LOCALE_SETTING_ID) ?? '').trim().toLowerCase();
                return !value || value === 'auto' ? [] : [value];
            },
            loadLocalizedTextResources: async context => {
                const configuredLocale = String(context.getSetting(FOXHOLE_LOCALE_SETTING_ID) ?? '').trim().toLowerCase();
                const preferredLocale = !configuredLocale || configuredLocale === 'auto'
                    ? 'en'
                    : configuredLocale;

                await loadFoxholeLocalizationStrings(
                    createFoxholeAssetsBaseUrl(context.appBaseUrl),
                    preferredLocale,
                );
            },
            resolveLocalizedText: (asset, metadataKey, fallback, context) => {
                if (metadataKey === 'nameLocalizationId') {
                    const syntheticStructureName = resolveFoxholeSyntheticStructureName(asset, fallback, context);
                    if (syntheticStructureName) {
                        return syntheticStructureName;
                    }
                }

                const localizationId = getFoxholeAssetMetadataString(asset, metadataKey);
                if (!localizationId) {
                    return undefined;
                }

                const preferredLocale = resolveFoxholeAssetPreferredLocale(context);

                return getFoxholeLocalizedText(
                    context.appBaseUrl,
                    localizationId,
                    fallback,
                    preferredLocale,
                );
            },
            assets: [
                ...FOXHOLE_CATALOG.assets.flatMap(asset => [
                    createFoxholeStructureAssetDefinition(asset),
                    ...(asset.destroyed ? [createFoxholeStructureAssetDefinition(asset, true)] : []),
                    ...createFoxholeUpgradeAssetDefinitions(asset),
                ]),
                ...FOXHOLE_ITEM_CATALOG.assets.map(asset => ({
                    id: createFoxholeItemAssetId(asset.resourceKey),
                    type: NIXIE_ICON_NODE_TYPE,
                    visible: () => true,
                    name: asset.name,
                    description: asset.description || undefined,
                    previewUrl: asset.previewUrl ?? undefined,
                    category: asset.categoryName,
                    order: asset.buildOrder,
                    keywords: [
                        asset.resourceKey,
                        asset.categoryKey,
                        ...(asset.faction ? [asset.faction] : []),
                        ...resolveFoxholeAssetSignalKeywords(asset),
                        ...(asset.aliases ?? []),
                    ],
                    metadata: {
                        foxholeKey: asset.resourceKey,
                        assetIdentifier: `#${asset.foxholeKey}`,
                        assetClipboardValue: asset.foxholeKey,
                        codeName: asset.codeName,
                        legacyKeys: asset.legacyKeys,
                        faction: asset.faction,
                        isItem: asset.isItem,
                        itemIconUrl: asset.iconUrl,
                        previewIconUrl: asset.previewIconUrl,
                        previewIsIconFallback: asset.previewIsIconFallback,
                        categoryIcon: asset.categoryIconUrl,
                        categoryOrder: asset.categoryOrder,
                        categoryLocalizationId: asset.categoryNameLocalizationId,
                        nameLocalizationId: asset.nameLocalizationId,
                        descriptionLocalizationId: asset.descriptionLocalizationId,
                        assetType: NIXIE_ICON_NODE_TYPE,
                        ...resolveFoxholeItemAssetGridCellMetadata(),
                        ...resolveFoxholeAssetCompletionMetadata(asset.resourceKey, asset.categoryKey),
                    },
                    createSnapshot: ({ x, y, z }) => createNixieIconAssetSnapshot({
                        key: asset.name,
                        label: asset.name,
                        textureUrl: asset.iconUrl ?? '',
                        x,
                        y,
                        z,
                    }),
                })),
            ],
        },
    ],
    assetHover: [
        {
            id: 'foxhole.assets.hover',
            order: 100,
            matches: asset => isFoxholeStructureAsset(asset),
            component: FoxholeAssetHoverCard,
        },
    ],
    assetIconSets: [
        {
            id: 'foxhole.assets.icon-set',
            sourceId: FOXHOLE_ASSET_SOURCE_ID,
            settingId: FOXHOLE_ASSET_ICON_SET_SETTING_ID,
            getIconSets: () => getFoxholeAssetIconSetOptions(FOXHOLE_CATALOG.assets.some(asset => Boolean(asset.previewIconUrl))),
            resolveAssetIconUrl: (asset, iconSetId) => resolveFoxholeAssetBrowserIconUrl(asset, iconSetId),
        },
    ],
    assetFilters: [
        {
            id: 'foxhole.assets.filter.faction',
            sourceId: FOXHOLE_ASSET_SOURCE_ID,
            settingId: 'foxhole.assets.filter.faction',
            label: value => getFoxholeFactionLabel(value),
            icon: 'ph:flag',
            group: 'foxhole',
            order: 10,
            isActive: value => value === 'c' || value === 'w',
            nextValue: value => getNextFoxholeFactionValue(value),
            matches: (asset, value) => isFoxholeStructureAsset(asset) && matchesFoxholeFactionFilter(asset, value),
        },
        {
            id: 'foxhole.assets.filter.tier',
            sourceId: FOXHOLE_ASSET_SOURCE_ID,
            settingId: 'foxhole.assets.filter.tier',
            label: value => getFoxholeTierLabel(value),
            icon: 'ph:stack-simple',
            group: 'foxhole',
            order: 20,
            isActive: () => true,
            nextValue: value => getNextFoxholeTierValue(value),
            matches: (asset, value, context) => isFoxholeStructureAsset(asset) && matchesFoxholeTierFilter(asset, value, context),
        },
        {
            id: 'foxhole.assets.filter.showPreviousTiers',
            sourceId: FOXHOLE_ASSET_SOURCE_ID,
            settingId: 'foxhole.assets.filter.showPreviousTiers',
            label: 'Previous Tiers',
            icon: 'ph:stack',
            group: 'foxhole',
            order: 30,
            enabled: context => shouldShowFoxholePreviousTierFilter(context),
            isActive: value => value === true,
            matches: asset => isFoxholeStructureAsset(asset),
        },
        {
            id: 'foxhole.assets.filter.upgrades',
            sourceId: FOXHOLE_ASSET_SOURCE_ID,
            settingId: 'foxhole.assets.filter.upgrades',
            label: 'Upgrades',
            icon: 'ph:arrow-square-out',
            group: 'foxhole',
            order: 40,
            isActive: value => value === true,
            matches: (asset, value) => isFoxholeStructureAsset(asset) && matchesFoxholeUpgradeFilter(asset, value),
        },
        {
            id: 'foxhole.assets.filter.destroyed',
            sourceId: FOXHOLE_ASSET_SOURCE_ID,
            settingId: 'foxhole.assets.filter.destroyed',
            label: 'Destroyed',
            icon: 'ph:traffic-cone',
            group: 'foxhole',
            order: 50,
            isActive: value => value === true,
            matches: (asset, value, context) => isFoxholeStructureAsset(asset) && matchesFoxholeDestroyedFilter(asset, value, context),
        },
        {
            id: 'foxhole.assets.filter.breached',
            sourceId: FOXHOLE_ASSET_SOURCE_ID,
            settingId: 'foxhole.assets.filter.breached',
            label: 'Breached',
            icon: 'ph:shield-warning',
            group: 'foxhole',
            order: 55,
            isActive: value => value === true,
            matches: (asset, value, context) => isFoxholeStructureAsset(asset) && matchesFoxholeBreachedFilter(asset, value, context),
        },
        ...FOXHOLE_ASSET_FILTER_ORDER.map((filterKey, index) => ({
            id: `foxhole.assets.filter.category.${filterKey}`,
            sourceId: FOXHOLE_ASSET_SOURCE_ID,
            settingId: `foxhole.assets.filter.category.${filterKey}`,
            label: filterKey.charAt(0).toUpperCase() + filterKey.slice(1),
            icon: 'ph:funnel',
            group: 'foxhole',
            order: -100 + index,
            isActive: (value: unknown) => value !== false,
            matches: (asset: any, value: unknown, context: any) => isFoxholeStructureAsset(asset) && (
                filterKey === FOXHOLE_VEHICLE_FILTER_KEY
                    ? matchesFoxholeVehicleFilter(asset, value, context)
                    : matchesFoxholeCategoryFilter(asset, value, filterKey, context)
            ),
        })),
        {
            id: 'foxhole.assets.filter.locale',
            sourceId: FOXHOLE_ASSET_SOURCE_ID,
            settingId: FOXHOLE_LOCALE_SETTING_ID,
            label: value => getFoxholeLocaleLabel(value),
            icon: value => getFoxholeLocaleIcon(value),
            control: 'menu',
            group: 'foxhole',
            order: 60,
            isActive: value => getFoxholeLocaleOption(value).value !== 'auto',
            menuItems: () => FOXHOLE_LOCALE_OPTIONS.flatMap((option, index) => {
                const items = [{
                    value: option.value,
                    label: option.label,
                    icon: option.icon,
                }];

                if (index === 0 && FOXHOLE_LOCALE_OPTIONS.length > 1) {
                    items.push({
                        type: 'separator' as const,
                    });
                }

                return items;
            }),
            matches: () => true,
        },
    ],
    nodes: [
        {
            type: FOXHOLE_ASSET_NODE_TYPE,
            name: 'Foxhole Asset',
            description: 'A Foxhole catalog asset node for structures, vehicles, and related placements.',
            icon: 'ph:factory',
            capabilities: {
                move: true,
                rotate: true,
                scale: false,
                transformGizmo: true,
                tint: true,
            },
        },
    ],
    boardNodes: [
        {
            type: FOXHOLE_ASSET_NODE_TYPE,
            stateSchema: foxholeStructureStateSchema,
            getSnapshotDependencies: snapshot => getFoxholeSnapshotDependencies(snapshot, FOXHOLE_CATALOG),
            remapCloneReferences: (snapshot, { idMap }) => remapFoxholeStructureSnapshotCloneReferences(snapshot, idMap),
            create: (snapshot, context) => {
                const state = snapshot.state as FoxholeStructureState;
                const foxholeKey = String(state.foxholeKey ?? '').trim();
                const catalogAsset = foxholeKey ? FOXHOLE_CATALOG.assetByKey[foxholeKey] : null;

                return new FoxholeStructureNode({
                    id: snapshot.id,
                    type: snapshot.type,
                    key: snapshot.key ?? catalogAsset?.name ?? foxholeKey ?? String(snapshot.id),
                    version: snapshot.version,
                    state,
                    historyRecorder: context.historyRecorder,
                    syncAdapter: context.syncAdapter,
                    definition: {
                        assetResolver: foxholeKey => FOXHOLE_CATALOG.assetByKey[String(foxholeKey ?? '').trim()],
                        structureResolver: foxholeKey => FOXHOLE_CATALOG.structureByKey[String(foxholeKey ?? '').trim()],
                        packagedPalletResolver: shippableType => resolveFoxholeSharedPackagedPalletFromCatalog(FOXHOLE_CATALOG, shippableType),
                        modificationVisualResolver: (foxholeKey, slotId, variantId) => {
                            const asset = FOXHOLE_CATALOG.assetByKey[String(foxholeKey ?? '').trim()];
                            const slot = asset?.modificationSlotById[String(slotId ?? '').trim()];
                            const variant = slot?.variantById[String(variantId ?? '').trim()];
                            const isUpgrade = variant?.isUpgrade === true;
                            const textureUrl = variant?.textureUrl ?? null;
                            if (!textureUrl) {
                                return null;
                            }

                            const slotOffsetX = isUpgrade
                                ? 0
                                : Number(slot?.x ?? 0) * (FOXWATCH_RENDER_PIXELS_PER_METER / CENTIMETERS_PER_METER);
                            const slotOffsetY = isUpgrade
                                ? 0
                                : Number(slot?.y ?? 0) * (FOXWATCH_RENDER_PIXELS_PER_METER / CENTIMETERS_PER_METER);
                            const slotRotationDegrees = isUpgrade ? 0 : Number(slot?.rotation ?? 0);

                            return {
                                kind: 'full-structure' as const,
                                variantId: variant?.id,
                                textureUrl,
                                width: variant?.textureWidth ?? null,
                                height: variant?.textureHeight ?? null,
                                anchorX: variant?.anchorX ?? 0.5,
                                anchorY: variant?.anchorY ?? 0.5,
                                offsetX: variant?.offsetX ?? 0,
                                offsetY: variant?.offsetY ?? 0,
                                worldOffsetX: Number.isFinite(slotOffsetX) ? slotOffsetX : 0,
                                worldOffsetY: Number.isFinite(slotOffsetY) ? slotOffsetY : 0,
                                rotationDegrees: Number.isFinite(slotRotationDegrees) ? slotRotationDegrees : 0,
                            };
                        },
                        textureResolver: context.textureResolver,
                        textureUrlResolver: textureKey => resolveFoxholeTextureUrl(textureKey, FOXHOLE_ASSET_BASE_URL),
                        itemIconUrlResolver: resolveFoxholeOverlayItemIconUrl,
                        itemHoverEntryResolver: resolveFoxholeOverlayItemHoverEntry,
                        productionOutputsResolver: resolveFoxholeStructureProductionOverlayOutputs,
                    },
                });
            },
        },
    ],
    inspector: [
        {
            id: 'foxhole.inspector.structure',
            target: [
                FOXHOLE_ASSET_NODE_TYPE,
                FOXHOLE_CONNECTOR_NODE_TYPE,
                FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
            ],
            order: 90,
            supportsMultiTarget: true,
            component: FoxholeStructureInspectorCard,
        },

    ],
});
