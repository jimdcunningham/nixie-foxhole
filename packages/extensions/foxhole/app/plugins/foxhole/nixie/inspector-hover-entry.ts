import { resolveFoxholeAssetCompletionMetadata } from '#foxhole/plugins/foxhole/nixie/asset-completion.ts';
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import type {
    FoxholeItemAsset,
    FoxholeStructureAsset,
    FoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import type { NixieResolvedAssetEntry } from '#nixie/plugins/nixie/registry/index.ts';

export const FOXHOLE_ITEM_FALLBACK_ICON = 'ph:package';
export const FOXHOLE_STRUCTURE_FALLBACK_ICON = 'ph:buildings';

export function resolveFoxholeItemDefaultIconUrl(item: FoxholeItemAsset | null | undefined): string {
    return String(item?.iconUrl ?? '').trim();
}

export function resolveFoxholeStructureDefaultIconUrl(asset: FoxholeStructureAsset | null | undefined): string {
    return String(asset?.iconUrl ?? asset?.previewIconUrl ?? '').trim();
}

/** Native stockpiles may name vehicles/structures as well as inventory items. */
export function resolveFoxholeStoredStructureAsset(
    codename: string,
    item: FoxholeItemAsset | null | undefined,
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey'>,
): FoxholeStructureAsset | null {
    if (item) return null; // Keep existing item identity/icon precedence, even without an icon.
    const key = String(codename ?? '').trim();
    return catalog.assetByKey[key] ?? catalog.assetByKey[key.toLowerCase()] ?? null;
}

export function createFoxholeItemHoverEntry(
    item: FoxholeItemAsset | null,
    codename: string,
    resolveLabel: (item: FoxholeItemAsset | null, codename: string) => string,
    resolveDescription: (item: FoxholeItemAsset | null) => string,
    resolveCategory: (item: FoxholeItemAsset | null) => string,
): NixieResolvedAssetEntry {
    const displayName = resolveLabel(item, codename);
    const description = resolveDescription(item);
    const categoryName = resolveCategory(item);
    const previewUrl = String(item?.previewUrl ?? '').trim();
    const iconUrl = resolveFoxholeItemDefaultIconUrl(item);
    const assetId = String(item?.foxholeKey ?? codename).trim() || codename;

    return {
        sourceId: FOXHOLE_ASSET_SOURCE_ID,
        sourceName: 'Foxhole Assets',
        sourceDescription: 'Structures and item icons contributed by the Foxhole Planner addon.',
        asset: {
            id: assetId,
            name: displayName,
            description: description || undefined,
            previewUrl: previewUrl || undefined,
            category: categoryName,
            order: Number(item?.buildOrder ?? 0),
            keywords: [
                item?.foxholeKey,
                item?.codeName,
                item?.resourceKey,
                item?.legacyKey,
                item?.categoryKey,
                item?.faction,
                codename,
                ...(item?.aliases ?? []),
            ].filter((keyword): keyword is string => Boolean(String(keyword ?? '').trim())),
            metadata: {
                foxholeKey: item?.foxholeKey,
                codeName: item?.codeName ?? codename,
                faction: item?.faction,
                isItem: true,
                categoryIcon: item?.categoryIconUrl,
                categoryOrder: item?.categoryOrder,
                categoryLocalizationId: item?.categoryNameLocalizationId,
                nameLocalizationId: item?.nameLocalizationId,
                descriptionLocalizationId: item?.descriptionLocalizationId,
                itemIconUrl: iconUrl || undefined,
                previewIconUrl: iconUrl || undefined,
                assetIdentifier: `#${assetId}`,
                assetClipboardValue: assetId,
                ...resolveFoxholeAssetCompletionMetadata(
                    String(item?.resourceKey ?? item?.foxholeKey ?? codename),
                    item?.categoryKey,
                ),
            },
            createSnapshot: async () => null,
        },
        displayName,
        description,
        previewUrl,
        icon: FOXHOLE_ITEM_FALLBACK_ICON,
        iconUrl,
        categoryName,
        categoryOrder: item?.categoryOrder ?? 0,
        searchText: [
            displayName,
            description,
            categoryName,
            item?.searchText,
            codename,
        ].filter(Boolean).join(' ').toLowerCase(),
    };
}

export function createFoxholeStructureHoverEntry(
    structure: FoxholeStructureAsset,
    resolveLabel: (structure: FoxholeStructureAsset) => string,
    resolveDescription: (structure: FoxholeStructureAsset) => string,
    resolveCategory: (structure: FoxholeStructureAsset) => string,
): NixieResolvedAssetEntry {
    const displayName = resolveLabel(structure);
    const description = resolveDescription(structure);
    const categoryName = resolveCategory(structure);
    const previewUrl = String(structure.previewUrl ?? '').trim();
    const iconUrl = resolveFoxholeStructureDefaultIconUrl(structure);
    const assetId = String(structure.foxholeKey ?? structure.codeName).trim();

    return {
        sourceId: FOXHOLE_ASSET_SOURCE_ID,
        sourceName: 'Foxhole Assets',
        sourceDescription: 'Structures and item icons contributed by the Foxhole Planner addon.',
        asset: {
            id: assetId,
            name: displayName,
            description: description || undefined,
            previewUrl: previewUrl || undefined,
            category: categoryName,
            order: Number(structure.buildOrder ?? 0),
            keywords: [
                structure.foxholeKey,
                structure.codeName,
                structure.buildingKey,
                structure.legacyKey,
                structure.categoryKey,
                structure.faction,
                ...(structure.aliases ?? []),
            ].filter((keyword): keyword is string => Boolean(String(keyword ?? '').trim())),
            metadata: {
                foxholeKey: structure.foxholeKey,
                codeName: structure.codeName,
                faction: structure.faction,
                isItem: false,
                categoryIcon: structure.categoryIconUrl,
                categoryOrder: structure.categoryOrder,
                categoryLocalizationId: structure.categoryNameLocalizationId,
                nameLocalizationId: structure.nameLocalizationId,
                descriptionLocalizationId: structure.descriptionLocalizationId,
                itemIconUrl: iconUrl || undefined,
                previewIconUrl: (structure.previewIconUrl ?? iconUrl) || undefined,
                assetIdentifier: `#${assetId}`,
                assetClipboardValue: assetId,
                ...resolveFoxholeAssetCompletionMetadata(structure.foxholeKey, structure.categoryKey),
            },
            createSnapshot: async () => null,
        },
        displayName,
        description,
        previewUrl,
        icon: FOXHOLE_STRUCTURE_FALLBACK_ICON,
        iconUrl,
        categoryName,
        categoryOrder: structure.categoryOrder ?? 0,
        searchText: [
            displayName,
            description,
            categoryName,
            structure.searchText,
            structure.codeName,
        ].filter(Boolean).join(' ').toLowerCase(),
    };
}
