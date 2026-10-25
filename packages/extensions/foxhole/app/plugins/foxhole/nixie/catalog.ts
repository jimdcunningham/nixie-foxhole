import {getFoxholeManifestRevision} from './manifest.ts';
import { getNixieExtensionProductCatalog } from '#nixie/utils/nixie-extension-product-catalog.ts';
import {
    getFoxholeManifest,
    getFoxholeManifestLocalizationMap,
    loadFoxholeManifestLocalizationMap,
    normalizeFoxholePackagedPalletKey,
} from './manifest.ts';
// eslint-disable-next-line no-duplicate-imports -- This repository requires top-level type-only imports.
import type { FoxholeManifestBuildSocket, FoxholeManifest, FoxholeManifestHitPolygon, FoxholeManifestModificationSlot, FoxholeManifestModificationSlotVariant, FoxholeManifestRecipeResource, FoxholeManifestStructure, FoxholeManifestStructureColorVariant, FoxholeManifestStructureRenderLayer } from './manifest.ts';
import {
    createFoxholeStructureTextureKey,
    parseFoxholeStructureTextureKey,
    normalizeFoxholeFaction,
} from './types.ts';
// eslint-disable-next-line no-duplicate-imports -- This repository requires top-level type-only imports.
import type { FoxholeFaction } from './types.ts';
import { resolveFoxholeCatalogSearchAliases } from './catalog-search-aliases.ts';
import { isFoxholeBuildSiteKey } from './hold-profile.ts';
import {
    buildFoxholeProductionIndex,
    createFoxholeProductionCommodityKey,
} from './production/index.ts';
import type { FoxholeProductionChannel, FoxholeProductionRecipe } from './production/types.ts';

export { createFoxholeAssetsBaseUrl } from './manifest.ts';

export interface FoxholeStructureAsset {
    foxholeKey: string;
    codeName: string;
    buildingKey: string;
    legacyKey?: string;
    destroyedStructureId: string | null;
    intactStructureId: string | null;
    categoryKey: string;
    categoryName: string;
    categoryNameLocalizationId: string;
    categoryIconUrl: string | null;
    categoryOrder: number;
    name: string;
    nameLocalizationId: string;
    description: string;
    descriptionLocalizationId: string;
    aliases: string[];
    searchText: string;
    iconUrl: string | null;
    previewIconUrl: string | null;
    previewUrl: string | null;
    previewIsIconFallback: boolean;
    previewDirection: string | null;
    width: number | null;
    height: number | null;
    colors: FoxholeStructureColorVariantAsset[];
    defaultColorHex: string | null;
    textureKey: string;
    destroyed: FoxholeStructureDestroyedAsset | null;
    packaged: FoxholeStructurePackagedAsset | null;
    hasFactionVariants: boolean;
    buildOrder: number;
    faction: FoxholeFaction;
    tier: number | null;
    techId: string | null;
    /** Immediate placement or upgrade cost. */
    cost: Record<string, FoxholeManifestRecipeResource>;
    /** Full cost from the root structure through this asset. */
    totalCost: Record<string, FoxholeManifestRecipeResource>;
    isVehicle: boolean;
    isBunker: boolean;
    isFacility: boolean;
    isWorldStructure: boolean;
    isDestroyed: boolean;
    isBreached: boolean;
    profileType: string | null;
    armourType: string | null;
    canBlueprint: boolean;
    supportsEmplacedStructures: boolean;
    isEmplacedWeapon: boolean;
    emplacementLocation: { x: number | null; y: number | null; z: number | null; } | null;
    railCouplers: Array<{
        name: string | null;
        x: number | null;
        y: number | null;
        z: number | null;
        rotation: number | null;
    }>;
    wheelBase: number | null;
    trackGauge: 'small' | 'standard' | null;
    upgradeStructureCodeName: string | null;
    conversionCodeNames: string[];
    downgradeStructureCodeName: string | null;
    upgradeStructureId: string | null;
    conversionStructureIds: string[];
    downgradeStructureId: string | null;
    hideInList: boolean;
    isUpgrade: boolean;
    upgradeName: string | null;
    parentStructureId: string | null;
    rootStructureId: string | null;
    appliedModificationId: string | null;
    renderLayers: FoxholeStructureRenderLayerAsset[];
    modificationSlots: FoxholeStructureModificationSlotAsset[];
    modificationSlotById: Record<string, FoxholeStructureModificationSlotAsset>;
}

export interface FoxholeStructureDestroyedAsset {
    componentName: string | null;
    textureUrl: string | null;
    iconUrl: string | null;
    previewIconUrl: string | null;
    previewUrl: string | null;
    previewDirection: string | null;
    width: number | null;
    height: number | null;
    anchorX: number | null;
    anchorY: number | null;
    offsetX: number | null;
    offsetY: number | null;
}

export interface FoxholeStructurePackagedAsset {
    shippableType: string | null;
    palletOffset: FoxholeStructurePackagedPalletOffsetAsset | null;
    textureUrl: string | null;
    width: number | null;
    height: number | null;
    anchorX: number | null;
    anchorY: number | null;
    offsetX: number | null;
    offsetY: number | null;
}

export interface FoxholeStructurePackagedPalletOffsetAsset {
    x: number | null;
    y: number | null;
    rotationDegrees: number | null;
}

export interface FoxholeSharedPackagedPalletAsset {
    textureUrl: string | null;
    width: number | null;
    height: number | null;
    anchorX: number | null;
    anchorY: number | null;
    offsetX: number | null;
    offsetY: number | null;
}

export interface FoxholeStructureColorVariantAsset {
    hex: string;
    textureUrl: string;
    previewIconUrl: string | null;
    previewUrl: string | null;
}

export interface FoxholeStructureRenderLayerAsset {
    nativeSurface?: FoxholeManifestStructureRenderLayer['nativeSurface'];
    id: string;
    textureUrl: string;
    width: number | null;
    height: number | null;
    anchorX: number | null;
    anchorY: number | null;
    offsetX: number | null;
    offsetY: number | null;
    componentName: string | null;
    componentTags: readonly string[];
}

export interface FoxholeStructureModificationSlotVariantAsset {
    id: string;
    modificationId: string | null;
    name: string;
    nameLocalizationId: string | null;
    description: string;
    descriptionLocalizationId: string | null;
    requiredSocketConnectionMask: number | null;
    hiddenBySocketConnectionMask: number | null;
    textureUrl: string | null;
    iconUrl: string | null;
    previewIconUrl: string | null;
    previewUrl: string | null;
    previewDirection: string | null;
    textureWidth: number | null;
    textureHeight: number | null;
    anchorX: number | null;
    anchorY: number | null;
    offsetX: number | null;
    offsetY: number | null;
    renderLayers: FoxholeStructureRenderLayerAsset[];
    buildSockets: FoxholeManifestBuildSocket[];
    selectionPolygons: FoxholeManifestHitPolygon[];
    lineOfSightPolygons: FoxholeManifestHitPolygon[];
    cost: Record<string, FoxholeManifestRecipeResource>;
    totalCost: Record<string, FoxholeManifestRecipeResource>;
    isUpgrade: boolean;
    upgradeName: string | null;
    parentStructureId: string | null;
    rootStructureId: string | null;
    appliedModificationId: string | null;
}

export interface FoxholeStructureModificationSlotAsset {
    id: string;
    name: string;
    componentType: string;
    x: number | null;
    y: number | null;
    z: number | null;
    rotation: number | null;
    isLinkedToSocket: boolean;
    linkedSocketNames: string[];
    blockedByModSlotNames: string[];
    blockedByModTypes?: string[];
    variants: FoxholeStructureModificationSlotVariantAsset[];
    variantById: Record<string, FoxholeStructureModificationSlotVariantAsset>;
}

export interface FoxholeCatalogCategory {
    key: string;
    name: string;
    nameLocalizationId: string;
    iconUrl: string | null;
    order: number;
    count: number;
}

export interface FoxholeStructureCatalog {
    assets: FoxholeStructureAsset[];
    categories: FoxholeCatalogCategory[];
    assetByKey: Record<string, FoxholeStructureAsset>;
    packagedPalletByShippableType: Record<string, FoxholeSharedPackagedPalletAsset>;
    bunkerDestructionWeapons: Record<string, NonNullable<FoxholeManifest['shared']>['bunkerDestruction']['weapons'][string]>;
    structureByKey: Record<string, FoxholeManifestStructure>;
    textureUrlByKey: Record<string, string>;
    localizationByLocale: Record<string, Record<string, string>>;
}

export interface FoxholeAppliedModificationLookup {
    parentStructureId: string;
    appliedModificationId: string;
}

export interface FoxholeItemAsset {
    foxholeKey: string;
    resourceKey: string;
    codeName: string;
    legacyKey?: string;
    faction: FoxholeFaction;
    categoryKey: string;
    categoryName: string;
    categoryNameLocalizationId: string;
    categoryIconUrl: string | null;
    categoryOrder: number;
    name: string;
    nameLocalizationId: string;
    description: string;
    descriptionLocalizationId: string;
    aliases: string[];
    searchText: string;
    previewUrl: string | null;
    iconUrl: string | null;
    previewIconUrl: string | null;
    previewIsIconFallback: boolean;
    buildOrder: number;
    /** Immediate manufacturing cost when this item is produced by a recipe. */
    cost: Record<string, FoxholeManifestRecipeResource>;
    /** Full cost from the primary manufacturing route. */
    totalCost: Record<string, FoxholeManifestRecipeResource>;
    isItem: boolean;
}

export interface FoxholeItemCatalog {
    assets: FoxholeItemAsset[];
    categories: FoxholeCatalogCategory[];
    assetByKey: Record<string, FoxholeItemAsset>;
    localizationByLocale: Record<string, Record<string, string>>;
}

const structureCatalogCache = new Map<string, FoxholeStructureCatalog>();
const itemCatalogCache = new Map<string, FoxholeItemCatalog>();

function buildLocalizationByLocale(manifest: FoxholeManifest): Record<string, Record<string, string>> {
    return manifest.localizations.reduce<Record<string, Record<string, string>>>((localizations, bundle) => {
        localizations[bundle.locale] = { ...bundle.strings };
        return localizations;
    }, {});
}

function buildSearchText(parts: Array<string | null | undefined>): string {
    return parts
        .map(entry => String(entry ?? '').trim())
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function normalizeCatalogLookupKey(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

function resolveCatalogRelationshipAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey'>,
    relationshipId: string | null | undefined,
    relationshipCodeName: string | null | undefined,
): FoxholeStructureAsset | null {
    const normalizedRelationshipId = String(relationshipId ?? '').trim();
    if (normalizedRelationshipId) {
        return catalog.assetByKey[normalizedRelationshipId]
            ?? catalog.assetByKey[normalizedRelationshipId.toLowerCase()]
            ?? null;
    }

    const normalizedRelationshipCodeName = normalizeCatalogLookupKey(relationshipCodeName);
    return normalizedRelationshipCodeName
        ? (catalog.assetByKey[normalizedRelationshipCodeName] ?? null)
        : null;
}

function addTextureVariants(
    textureUrlByKey: Record<string, string>,
    foxholeKey: string,
    structure: Pick<FoxholeManifestStructure, 'variants' | 'destroyed' | 'packaged' | 'colors'>,
    asset?: Pick<FoxholeStructureAsset, 'destroyed' | 'packaged'>,
): void {
    if (structure.variants.default?.textureUrl) {
        textureUrlByKey[createFoxholeStructureTextureKey(foxholeKey, null)] = structure.variants.default.textureUrl;
    }
    if (structure.variants.c?.textureUrl) {
        textureUrlByKey[createFoxholeStructureTextureKey(foxholeKey, 'c')] = structure.variants.c.textureUrl;
    }
    if (structure.variants.w?.textureUrl) {
        textureUrlByKey[createFoxholeStructureTextureKey(foxholeKey, 'w')] = structure.variants.w.textureUrl;
    }
    const destroyedTextureUrl = asset?.destroyed?.textureUrl ?? structure.destroyed?.sprite?.source ?? structure.destroyed?.textureUrl;
    if (destroyedTextureUrl) {
        textureUrlByKey[createFoxholeStructureTextureKey(foxholeKey, null, true)] = destroyedTextureUrl;
    }
    const packagedTextureUrl = asset?.packaged?.textureUrl ?? structure.packaged?.sprite?.source ?? structure.packaged?.textureUrl;
    if (packagedTextureUrl) {
        textureUrlByKey[createFoxholeStructureTextureKey(foxholeKey, null, false, null, true)] = packagedTextureUrl;
    }
    for (const color of structure.colors ?? []) {
        if (!color.textureUrl) {
            continue;
        }

        textureUrlByKey[createFoxholeStructureTextureKey(foxholeKey, null, false, color.hex)] = color.textureUrl;
        if (packagedTextureUrl) {
            textureUrlByKey[createFoxholeStructureTextureKey(foxholeKey, null, false, color.hex, true)] = color.textureUrl;
        }
    }
}

function buildCategoryMap(manifest: FoxholeManifest): Map<string, FoxholeManifest['categories'][number]> {
    return new Map(manifest.categories.map(category => [category.id, category]));
}

function resolveCategoryData(
    categoryById: Map<string, FoxholeManifest['categories'][number]>,
    categoryId: string,
): {
    name: string;
    nameLocalizationId: string;
    iconUrl: string | null;
    order: number;
} {
    const category = categoryById.get(categoryId);
    return {
        name: category?.name.fallback ?? categoryId,
        nameLocalizationId: category?.name.id ?? `foxhole:category:${categoryId}:name`,
        iconUrl: category?.iconUrl ?? null,
        order: category?.order ?? Number.MAX_SAFE_INTEGER,
    };
}

function resolveStructureIsVehicle(
    structure: Pick<FoxholeManifestStructure, 'isVehicle' | 'profileType'>,
): boolean {
    return structure.isVehicle === true
        || String(structure.profileType ?? '').trim().toLowerCase() === 'vehicleproxy';
}

type FoxholeRecipeCostAsset = Pick<FoxholeManifestStructure, 'id' | 'codeName' | 'legacyKey'>;

function resolveRecipeCostAssetKeys(asset: FoxholeRecipeCostAsset): string[] {
    return [asset.codeName, asset.id, asset.legacyKey]
        .map(value => String(value ?? '').trim())
        .filter((value, index, values) => value && values.indexOf(value) === index);
}

function collectRecipeCostInputs(
    recipe: FoxholeProductionRecipe,
    outputQuantity: number,
): Record<string, FoxholeManifestRecipeResource> {
    if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) {
        return {};
    }

    const cost: Record<string, FoxholeManifestRecipeResource> = {};
    for (const resources of [recipe.itemInput, recipe.crateInput, recipe.liquidInput]) {
        for (const [resourceId, resource] of Object.entries(resources)) {
            const quantity = Number(resource?.quantity ?? 0);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                continue;
            }

            const existing = cost[resourceId];
            cost[resourceId] = {
                quantity: (Number(existing?.quantity ?? 0) || 0) + (quantity / outputQuantity),
                ...(resource.limit == null ? {} : { limit: resource.limit }),
            };
        }
    }

    return cost;
}

function resolveRecipeOutputQuantity(
    recipe: FoxholeProductionRecipe,
    channel: Exclude<FoxholeProductionChannel, 'build'>,
    resourceId: string,
): number | null {
    const outputs = channel === 'item'
        ? recipe.itemOutput
        : channel === 'crate'
            ? recipe.crateOutput
            : recipe.liquidOutput;
    const quantity = Number(outputs[resourceId]?.quantity ?? 0);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

/**
 * Uses the first authored production route as an asset's canonical cost. The
 * manifest retains every alternative route for the production UI, while the
 * catalog needs one deterministic representation for cards and statistics.
 */
function resolveRecipeDerivedCost(
    asset: FoxholeRecipeCostAsset,
    recipeById: Record<string, FoxholeProductionRecipe>,
    recipeIdsByOutput: Record<string, string[]>,
): Record<string, FoxholeManifestRecipeResource> | null {
    const channels: Array<Exclude<FoxholeProductionChannel, 'build'>> = ['item', 'crate', 'liquid'];
    const seenRecipeIds = new Set<string>();

    for (const resourceId of resolveRecipeCostAssetKeys(asset)) {
        for (const channel of channels) {
            const outputKey = createFoxholeProductionCommodityKey(channel, resourceId);
            for (const recipeId of recipeIdsByOutput[outputKey] ?? []) {
                if (seenRecipeIds.has(recipeId)) {
                    continue;
                }
                seenRecipeIds.add(recipeId);

                const recipe = recipeById[recipeId];
                const outputQuantity = recipe
                    ? resolveRecipeOutputQuantity(recipe, channel, resourceId)
                    : null;
                if (!recipe || outputQuantity == null) {
                    continue;
                }

                const cost = collectRecipeCostInputs(recipe, outputQuantity);
                if (Object.keys(cost).length > 0) {
                    return cost;
                }
            }
        }
    }

    return null;
}

function createCategoryList(
    manifest: FoxholeManifest,
    assets: Array<{ categoryKey: string; }>,
): FoxholeCatalogCategory[] {
    return manifest.categories
        .map(category => ({
            key: category.id,
            name: category.name.fallback,
            nameLocalizationId: category.name.id,
            iconUrl: category.iconUrl ?? null,
            order: category.order,
            count: assets.filter(asset => asset.categoryKey === category.id).length,
        }))
        .filter(category => category.count > 0)
        .sort((left, right) => {
            if (left.order !== right.order) {
                return left.order - right.order;
            }
            return left.name.localeCompare(right.name);
        });
}

function createStructureAsset(
    structure: FoxholeManifestStructure,
    categoryById: Map<string, FoxholeManifest['categories'][number]>,
): FoxholeStructureAsset {
    const category = resolveCategoryData(categoryById, structure.categoryId);
    const colors = (structure.colors ?? []).map(createStructureColorVariantAsset);
    const defaultColorHex = colors[0]?.hex ?? null;
    const renderLayers = (structure.renderLayers ?? [])
        .map(createStructureRenderLayerAsset)
        .filter((layer): layer is FoxholeStructureRenderLayerAsset => layer !== null);
    const modificationSlots = structure.modificationSlots.map(slot => createStructureModificationSlotAsset(slot));
    const modificationSlotById = Object.fromEntries(modificationSlots.map(slot => [slot.id, slot]));
    const aliases = resolveFoxholeCatalogSearchAliases(
        structure.id,
        structure.codeName,
        structure.legacyKey,
    );
    return {
        foxholeKey: structure.id,
        codeName: structure.codeName,
        buildingKey: structure.legacyKey ?? structure.id,
        ...(structure.legacyKey ? { legacyKey: structure.legacyKey } : {}),
        destroyedStructureId: null,
        intactStructureId: null,
        categoryKey: structure.categoryId,
        categoryName: category.name,
        categoryNameLocalizationId: category.nameLocalizationId,
        categoryIconUrl: category.iconUrl,
        categoryOrder: category.order,
        name: structure.name.fallback,
        nameLocalizationId: structure.name.id,
        description: structure.description.fallback,
        descriptionLocalizationId: structure.description.id,
        aliases,
        searchText: buildSearchText([
            structure.id,
            structure.codeName,
            structure.legacyKey,
            structure.name.fallback,
            structure.categoryId,
            category.name,
            ...aliases,
        ]),
        iconUrl: structure.icons?.default ?? structure.iconUrl ?? null,
        previewIconUrl: structure.icons?.rendered ?? structure.previewIconUrl ?? structure.icons?.default ?? structure.iconUrl ?? null,
        previewUrl: structure.previewUrl ?? null,
        previewIsIconFallback: structure.previewIsIconFallback === true,
        previewDirection: structure.previewDirection ?? null,
        width: structure.sprite.width ?? null,
        height: structure.sprite.height ?? null,
        colors,
        defaultColorHex,
        textureKey: createFoxholeStructureTextureKey(structure.id, null, false, defaultColorHex),
        destroyed: structure.destroyed
            ? {
                componentName: structure.destroyed.componentName ?? null,
                textureUrl: structure.destroyed.sprite?.source ?? structure.destroyed.textureUrl ?? null,
                iconUrl: structure.destroyed.icons?.default ?? structure.destroyed.iconUrl ?? null,
                previewIconUrl: structure.destroyed.icons?.rendered ?? structure.destroyed.previewIconUrl ?? structure.destroyed.icons?.default ?? structure.destroyed.iconUrl ?? null,
                previewUrl: structure.destroyed.previewUrl ?? null,
                previewDirection: structure.destroyed.previewDirection ?? null,
                width: structure.destroyed.sprite?.width ?? structure.destroyed.textureWidth ?? null,
                height: structure.destroyed.sprite?.height ?? structure.destroyed.textureHeight ?? null,
                anchorX: structure.destroyed.sprite?.anchorX ?? structure.destroyed.anchorX ?? null,
                anchorY: structure.destroyed.sprite?.anchorY ?? structure.destroyed.anchorY ?? null,
                offsetX: structure.destroyed.sprite?.offsetX ?? structure.destroyed.offsetX ?? null,
                offsetY: structure.destroyed.sprite?.offsetY ?? structure.destroyed.offsetY ?? null,
            }
            : null,
        packaged: structure.packaged
            ? {
                shippableType: structure.packaged.shippableType ?? null,
                palletOffset: structure.packaged.palletOffset
                    ? {
                        x: structure.packaged.palletOffset.x ?? null,
                        y: structure.packaged.palletOffset.y ?? null,
                        rotationDegrees: structure.packaged.palletOffset.rotationDegrees ?? null,
                    }
                    : null,
                textureUrl: structure.packaged.sprite?.source ?? structure.packaged.textureUrl ?? null,
                width: structure.packaged.sprite?.width ?? structure.packaged.textureWidth ?? null,
                height: structure.packaged.sprite?.height ?? structure.packaged.textureHeight ?? null,
                anchorX: structure.packaged.sprite?.anchorX ?? structure.packaged.anchorX ?? null,
                anchorY: structure.packaged.sprite?.anchorY ?? structure.packaged.anchorY ?? null,
                offsetX: structure.packaged.sprite?.offsetX ?? structure.packaged.offsetX ?? null,
                offsetY: structure.packaged.sprite?.offsetY ?? structure.packaged.offsetY ?? null,
            }
            : null,
        isDestroyed: structure.isDestroyed === true,
        isBreached: structure.isBreached === true,
        hasFactionVariants: Boolean(
            structure.variants.c?.textureUrl
            && structure.variants.w?.textureUrl
            && structure.variants.c.textureUrl !== structure.variants.w.textureUrl,
        ),
        buildOrder: structure.buildOrder,
        faction: structure.faction ?? null,
        tier: structure.tier ?? null,
        techId: structure.techId ?? null,
        cost: { ...structure.cost },
        totalCost: { ...(structure.totalCost ?? structure.cost) },
        isVehicle: resolveStructureIsVehicle(structure),
        isBunker: structure.isBunker === true,
        isFacility: structure.isFacility === true,
        isWorldStructure: structure.isWorldStructure === true,
        profileType: structure.profileType ?? null,
        armourType: structure.armourType ?? null,
        canBlueprint: structure.canBlueprint === true,
        supportsEmplacedStructures: structure.supportsEmplacedStructures === true,
        isEmplacedWeapon: structure.isEmplacedWeapon === true,
        emplacementLocation: structure.emplacementLocation
            ? {
                x: structure.emplacementLocation.x ?? null,
                y: structure.emplacementLocation.y ?? null,
                z: structure.emplacementLocation.z ?? null,
            }
            : null,
        railCouplers: (structure.railCouplers ?? []).map(coupler => ({
            name: coupler.name ?? null,
            x: coupler.x ?? null,
            y: coupler.y ?? null,
            z: coupler.z ?? null,
            rotation: coupler.rotation ?? null,
        })),
        wheelBase: structure.wheelBase ?? null,
        trackGauge: structure.trackGauge ?? null,
        upgradeStructureCodeName: structure.upgradeStructureCodeName ?? null,
        conversionCodeNames: [...structure.conversionCodeNames],
        downgradeStructureCodeName: null,
        upgradeStructureId: null,
        conversionStructureIds: [],
        downgradeStructureId: null,
        hideInList: structure.hideInList,
        isUpgrade: structure.isUpgrade,
        upgradeName: structure.upgradeName ?? null,
        parentStructureId: structure.parentStructureId ?? null,
        rootStructureId: structure.rootStructureId ?? null,
        appliedModificationId: structure.appliedModificationId ?? null,
        renderLayers,
        modificationSlots,
        modificationSlotById,
    };
}

function createSharedPackagedPalletAsset(
    pallet: NonNullable<FoxholeManifest['shared']>['packaging'][string],
): FoxholeSharedPackagedPalletAsset {
    return {
        textureUrl: pallet.textureUrl ?? null,
        width: pallet.width ?? null,
        height: pallet.height ?? null,
        anchorX: pallet.anchorX ?? null,
        anchorY: pallet.anchorY ?? null,
        offsetX: pallet.offsetX ?? null,
        offsetY: pallet.offsetY ?? null,
    };
}

function applyInheritedStructureVisuals(assets: FoxholeStructureAsset[], assetByKey: Record<string, FoxholeStructureAsset>): void {
    const resolved = new Set<string>();

    function resolveForAsset(asset: FoxholeStructureAsset, seen: Set<string>): void {
        if (resolved.has(asset.foxholeKey)) {
            return;
        }

        if (asset.modificationSlots.length > 0 && asset.renderLayers.length > 0) {
            resolved.add(asset.foxholeKey);
            return;
        }

        const parentId = String(asset.parentStructureId ?? '').trim();
        if (!parentId || seen.has(parentId)) {
            resolved.add(asset.foxholeKey);
            return;
        }

        const parentAsset = assetByKey[parentId];
        if (!parentAsset) {
            resolved.add(asset.foxholeKey);
            return;
        }

        const nextSeen = new Set(seen);
        nextSeen.add(asset.foxholeKey);
        resolveForAsset(parentAsset, nextSeen);

        if (asset.renderLayers.length === 0 && parentAsset.renderLayers.length > 0) {
            asset.renderLayers = parentAsset.renderLayers;
        }

        if (asset.modificationSlots.length === 0 && parentAsset.modificationSlots.length > 0) {
            asset.modificationSlots = parentAsset.modificationSlots;
            asset.modificationSlotById = parentAsset.modificationSlotById;
        }

        resolved.add(asset.foxholeKey);
    }

    for (const asset of assets) {
        resolveForAsset(asset, new Set<string>());
    }
}

function linkDestroyedStructureVariants(
    assets: FoxholeStructureAsset[],
    assetByKey: Record<string, FoxholeStructureAsset>,
    structureByKey: Record<string, FoxholeManifestStructure>,
): void {
    const intactAssetsByDestroyedKey = new Map<string, FoxholeStructureAsset[]>();
    for (const asset of assets) {
        const structure = structureByKey[asset.foxholeKey];
        const destroyedCodeName = String(structure?.destroyedStructureCodeName ?? '').trim();
        if (!destroyedCodeName) {
            continue;
        }

        const destroyedAsset = assetByKey[destroyedCodeName.toLowerCase()] ?? null;
        if (!destroyedAsset || destroyedAsset.foxholeKey === asset.foxholeKey) {
            continue;
        }

        asset.destroyedStructureId = destroyedAsset.foxholeKey;
        const candidates = intactAssetsByDestroyedKey.get(destroyedAsset.foxholeKey) ?? [];
        candidates.push(asset);
        intactAssetsByDestroyedKey.set(destroyedAsset.foxholeKey, candidates);
        const destroyedStructure = structureByKey[destroyedAsset.foxholeKey];
        asset.destroyed ??= {
            componentName: null,
            textureUrl: destroyedStructure?.variants.default?.textureUrl ?? destroyedStructure?.sprite.source ?? null,
            iconUrl: destroyedAsset.iconUrl,
            previewIconUrl: destroyedAsset.previewIconUrl,
            previewUrl: destroyedAsset.previewUrl,
            previewDirection: destroyedAsset.previewDirection,
            width: destroyedAsset.width,
            height: destroyedAsset.height,
            anchorX: destroyedStructure?.sprite.anchorX ?? null,
            anchorY: destroyedStructure?.sprite.anchorY ?? null,
            offsetX: destroyedStructure?.sprite.offsetX ?? null,
            offsetY: destroyedStructure?.sprite.offsetY ?? null,
        };
    }
    for (const [destroyedKey, candidates] of intactAssetsByDestroyedKey) {
        const declaredRestoreCodeName = String(structureByKey[destroyedKey]?.upgradeStructureCodeName ?? '').trim().toLowerCase();
        const declaredRestore = declaredRestoreCodeName ? assetByKey[declaredRestoreCodeName] : null;
        // A shared wreck's authored rebuild target wins; absent one, only a
        // unique intact source is reversible without inventing its identity.
        const intactAsset = candidates.find(candidate => candidate === declaredRestore)
            ?? (candidates.length === 1 ? candidates[0] : null);
        assetByKey[destroyedKey]!.intactStructureId = intactAsset?.foxholeKey ?? null;
    }
}

function applyRecipeDerivedVehicleConversions(
    assets: FoxholeStructureAsset[],
    assetByKey: Record<string, FoxholeStructureAsset>,
    recipeById: Record<string, FoxholeProductionRecipe>,
): void {
    const isIntactVehicle = (asset: FoxholeStructureAsset) => asset.isVehicle
        && !asset.isDestroyed
        && !asset.isBreached
        && !asset.isUpgrade
        && !asset.intactStructureId;
    const relationshipKey = (codeName: string) => {
        const normalized = codeName.trim().toLowerCase();
        return assetByKey[normalized]?.foxholeKey ?? normalized;
    };
    const conversionKeysBySource = new Map<string, Set<string>>();
    const parentKeysByTarget = new Map<string, Set<string>>();
    const addParent = (source: FoxholeStructureAsset, target: FoxholeStructureAsset) => {
        const parents = parentKeysByTarget.get(target.foxholeKey) ?? new Set<string>();
        parents.add(source.foxholeKey);
        parentKeysByTarget.set(target.foxholeKey, parents);
    };

    for (const source of assets) {
        if (!source.isVehicle) {
            continue;
        }

        const keys = new Set<string>();
        source.conversionCodeNames = source.conversionCodeNames.filter(codeName => {
            const key = relationshipKey(codeName);
            if (keys.has(key)) {
                return false;
            }
            keys.add(key);
            return true;
        });
        conversionKeysBySource.set(source.foxholeKey, keys);
        if (isIntactVehicle(source)) {
            for (const codeName of source.conversionCodeNames) {
                const target = assetByKey[codeName.trim().toLowerCase()];
                if (target && isIntactVehicle(target)) {
                    addParent(source, target);
                }
            }
        }
    }

    const vehicleAmounts = (channels: Array<[FoxholeProductionChannel, FoxholeProductionRecipe['itemInput']]>) => channels.flatMap(([channel, amounts]) => Object.entries(amounts)
        .flatMap(([codeName, amount]) => {
            const asset = assetByKey[codeName.trim().toLowerCase()];
            return asset?.isVehicle ? [{ asset, channel, quantity: amount.quantity }] : [];
        }));
    const conversions: Array<[FoxholeStructureAsset, FoxholeStructureAsset]> = [];
    for (const recipe of Object.values(recipeById)) {
        const inputs = vehicleAmounts([['item', recipe.itemInput], ['crate', recipe.crateInput], ['liquid', recipe.liquidInput]]);
        const outputs = vehicleAmounts([['item', recipe.itemOutput], ['crate', recipe.crateOutput], ['liquid', recipe.liquidOutput]]);
        if (inputs.length !== 1 || outputs.length !== 1) {
            continue;
        }

        const input = inputs[0]!;
        const output = outputs[0]!;
        if (input.channel !== 'item' || output.channel !== 'item'
            || input.quantity !== 1 || output.quantity !== 1
            || input.asset === output.asset
            || !isIntactVehicle(input.asset) || !isIntactVehicle(output.asset)) {
            continue;
        }

        addParent(input.asset, output.asset);
        conversions.push([input.asset, output.asset]);
    }

    for (const [source, target] of conversions) {
        // The relationship selector needs a unique parent, even across facility recipes.
        if (parentKeysByTarget.get(target.foxholeKey)?.size !== 1) {
            continue;
        }

        const keys = conversionKeysBySource.get(source.foxholeKey)!;
        if (!keys.has(target.foxholeKey)) {
            keys.add(target.foxholeKey);
            source.conversionCodeNames.push(target.codeName);
        }
    }
}

function linkStructureRelationshipVariants(
    assets: FoxholeStructureAsset[],
    assetByKey: Record<string, FoxholeStructureAsset>,
): void {
    for (const asset of assets) {
        const conversionStructureIds: string[] = [];
        const seenConversionIds = new Set<string>();
        for (const codeName of asset.conversionCodeNames) {
            const conversionAsset = assetByKey[String(codeName ?? '').trim().toLowerCase()] ?? null;
            if (!conversionAsset || conversionAsset.foxholeKey === asset.foxholeKey || seenConversionIds.has(conversionAsset.foxholeKey)) {
                continue;
            }

            seenConversionIds.add(conversionAsset.foxholeKey);
            conversionStructureIds.push(conversionAsset.foxholeKey);
        }

        asset.conversionStructureIds = conversionStructureIds;

        const normalizedUpgradeCodeName = String(asset.upgradeStructureCodeName ?? '').trim().toLowerCase();
        if (!normalizedUpgradeCodeName) {
            continue;
        }

        const upgradeAsset = assetByKey[normalizedUpgradeCodeName] ?? null;
        if (!upgradeAsset || upgradeAsset.foxholeKey === asset.foxholeKey) {
            continue;
        }

        asset.upgradeStructureId = upgradeAsset.foxholeKey;

        const canBackfillDowngradeLink = asset.isDestroyed !== true
            && asset.isBreached !== true
            && asset.isUpgrade !== true;
        if (canBackfillDowngradeLink && !upgradeAsset.downgradeStructureId) {
            upgradeAsset.downgradeStructureId = asset.foxholeKey;
        }

        if (canBackfillDowngradeLink && !upgradeAsset.downgradeStructureCodeName) {
            upgradeAsset.downgradeStructureCodeName = asset.codeName;
        }
    }
}

function mergeRecipeCosts(
    baseCost: Record<string, FoxholeManifestRecipeResource> | null | undefined,
    addedCost: Record<string, FoxholeManifestRecipeResource> | null | undefined,
): Record<string, FoxholeManifestRecipeResource> {
    const merged = Object.fromEntries(Object.entries(baseCost ?? {})
        .map(([resourceId, resource]) => [resourceId, { ...resource }])) as Record<string, FoxholeManifestRecipeResource>;

    for (const [resourceId, resource] of Object.entries(addedCost ?? {})) {
        const existing = merged[resourceId];
        const existingQuantity = Number(existing?.quantity ?? 0);
        const addedQuantity = Number(resource?.quantity ?? 0);
        merged[resourceId] = {
            ...existing,
            ...resource,
            quantity: (Number.isFinite(existingQuantity) ? existingQuantity : 0)
                + (Number.isFinite(addedQuantity) ? addedQuantity : 0),
        };
    }

    return merged;
}

function applyRecipeDerivedStructureCosts(
    assetEntries: Array<{ asset: FoxholeStructureAsset; structure: FoxholeManifestStructure; }>,
    recipeById: Record<string, FoxholeProductionRecipe>,
    recipeIdsByOutput: Record<string, string[]>,
): void {
    for (const { asset, structure } of assetEntries) {
        const cost = resolveRecipeDerivedCost(structure, recipeById, recipeIdsByOutput);
        if (!cost) {
            continue;
        }

        structure.cost = { ...cost };
        structure.totalCost = { ...cost };
        asset.cost = { ...cost };
        asset.totalCost = { ...cost };
    }
}

function applyStructureTotalCosts(
    assetEntries: Array<{ asset: FoxholeStructureAsset; structure: FoxholeManifestStructure; }>,
    assetByKey: Record<string, FoxholeStructureAsset>,
): void {
    const structureById = new Map(assetEntries.map(entry => [entry.asset.foxholeKey, entry.structure]));
    const resolved = new Set<string>();

    function resolveTotalCost(asset: FoxholeStructureAsset, seen: Set<string>): Record<string, FoxholeManifestRecipeResource> {
        const structure = structureById.get(asset.foxholeKey);
        if (!structure) {
            return {};
        }
        if (resolved.has(asset.foxholeKey)) {
            return structure.totalCost ?? structure.cost;
        }

        const parentId = String(asset.downgradeStructureId ?? asset.parentStructureId ?? '').trim();
        const parent = parentId && !seen.has(parentId)
            ? assetByKey[parentId]
            : null;
        const parentCost = parent
            ? resolveTotalCost(parent, new Set([...seen, asset.foxholeKey]))
            : {};
        structure.totalCost = mergeRecipeCosts(parentCost, structure.cost);
        asset.totalCost = { ...structure.totalCost };
        resolved.add(asset.foxholeKey);
        return structure.totalCost;
    }

    for (const { asset } of assetEntries) {
        resolveTotalCost(asset, new Set());
    }

    for (const { asset, structure } of assetEntries) {
        const totalCost = structure.totalCost ?? structure.cost;
        for (const slot of asset.modificationSlots) {
            const sourceSlot = structure.modificationSlots.find(entry => entry.name === slot.name);
            if (!sourceSlot) {
                continue;
            }
            for (const variant of slot.variants) {
                const sourceVariant = sourceSlot.variants[variant.id];
                if (!sourceVariant) {
                    continue;
                }
                sourceVariant.totalCost = mergeRecipeCosts(totalCost, sourceVariant.cost);
                variant.totalCost = { ...sourceVariant.totalCost };
            }
        }
    }
}

export function resolveFoxholeStructureBuildRouteSourceAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey'>,
    currentAsset: FoxholeStructureAsset,
): FoxholeStructureAsset {
    const seenKeys = new Set<string>([currentAsset.foxholeKey]);
    let activeAsset: FoxholeStructureAsset = currentAsset;

    while (true) {
        const downgradedAsset = resolveCatalogRelationshipAsset(
            catalog,
            activeAsset.downgradeStructureId,
            activeAsset.downgradeStructureCodeName,
        );
        if (
            !downgradedAsset
            || downgradedAsset.foxholeKey === activeAsset.foxholeKey
            || seenKeys.has(downgradedAsset.foxholeKey)
        ) {
            break;
        }

        seenKeys.add(downgradedAsset.foxholeKey);
        activeAsset = downgradedAsset;
    }

    return activeAsset;
}

export function resolveFoxholeStructureCatalogSortOrder(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey'>,
    asset: FoxholeStructureAsset,
): number {
    if (asset.foxholeKey === 'sandbaghalfspline' && catalog.assetByKey.sandbagfullspline) {
        return resolveFoxholeStructureBuildRouteSourceAsset(catalog, catalog.assetByKey.sandbagfullspline).buildOrder - 0.1;
    }
    return resolveFoxholeStructureBuildRouteSourceAsset(catalog, asset).buildOrder;
}

export function compareFoxholeStructureCatalogAssets(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey'>,
    left: FoxholeStructureAsset,
    right: FoxholeStructureAsset,
): number {
    const orderDelta = resolveFoxholeStructureCatalogSortOrder(catalog, left)
        - resolveFoxholeStructureCatalogSortOrder(catalog, right);
    if (orderDelta !== 0) {
        return orderDelta;
    }

    const codeNameDelta = left.codeName.localeCompare(right.codeName);
    if (codeNameDelta !== 0) {
        return codeNameDelta;
    }

    return left.foxholeKey.localeCompare(right.foxholeKey);
}

function createStructureRenderLayerAsset(
    layer: FoxholeManifestStructureRenderLayer,
): FoxholeStructureRenderLayerAsset | null {
    const textureUrl = String(layer.textureUrl ?? '').trim();
    if (!textureUrl) {
        return null;
    }

    return {
        id: layer.id,
        textureUrl,
        width: layer.width ?? null,
        height: layer.height ?? null,
        anchorX: layer.anchorX ?? null,
        anchorY: layer.anchorY ?? null,
        offsetX: layer.offsetX ?? null,
        offsetY: layer.offsetY ?? null,
        componentName: layer.componentName ?? null,
        componentTags: layer.componentTags ?? [],
        ...(layer.nativeSurface ? { nativeSurface: layer.nativeSurface } : {}),
    };
}

function createStructureColorVariantAsset(
    color: FoxholeManifestStructureColorVariant,
): FoxholeStructureColorVariantAsset {
    return {
        hex: color.hex,
        textureUrl: color.textureUrl ?? '',
        previewIconUrl: color.renderedIconUrl ?? null,
        previewUrl: color.previewUrl ?? null,
    };
}

function createStructureModificationSlotVariantAsset(
    variantId: string,
    variant: FoxholeManifestModificationSlotVariant,
): FoxholeStructureModificationSlotVariantAsset {
    const modificationId = String(variant.modificationId ?? '').trim() || null;
    const name = variant.name?.fallback ?? modificationId ?? variantId;
    const description = variant.description?.fallback ?? '';
    return {
        id: variantId,
        modificationId,
        name,
        nameLocalizationId: variant.name?.id ?? null,
        description,
        descriptionLocalizationId: variant.description?.id ?? null,
        requiredSocketConnectionMask: variant.requiredSocketConnectionMask ?? null,
        hiddenBySocketConnectionMask: variant.hiddenBySocketConnectionMask ?? null,
        textureUrl: variant.sprite?.source ?? null,
        iconUrl: variant.icons?.default ?? null,
        previewIconUrl: variant.icons?.rendered ?? null,
        previewUrl: variant.previewUrl ?? null,
        previewDirection: variant.previewDirection ?? null,
        textureWidth: variant.sprite?.width ?? null,
        textureHeight: variant.sprite?.height ?? null,
        anchorX: variant.sprite?.anchorX ?? null,
        anchorY: variant.sprite?.anchorY ?? null,
        offsetX: variant.sprite?.offsetX ?? null,
        offsetY: variant.sprite?.offsetY ?? null,
        renderLayers: (variant.renderLayers ?? [])
            .map(layer => createStructureRenderLayerAsset(layer))
            .filter((layer): layer is FoxholeStructureRenderLayerAsset => Boolean(layer)),
        buildSockets: [...variant.buildSockets],
        selectionPolygons: [...variant.selectionPolygons],
        lineOfSightPolygons: [...variant.lineOfSightPolygons],
        cost: { ...variant.cost },
        totalCost: { ...(variant.totalCost ?? variant.cost) },
        isUpgrade: variant.isUpgrade === true,
        upgradeName: variant.upgradeName ?? null,
        parentStructureId: variant.parentStructureId ?? null,
        rootStructureId: variant.rootStructureId ?? null,
        appliedModificationId: variant.appliedModificationId ?? null,
    };
}

function createStructureModificationSlotAsset(
    slot: FoxholeManifestModificationSlot,
): FoxholeStructureModificationSlotAsset {
    const variants = Object.entries(slot.variants)
        .map(([variantId, variant]) => createStructureModificationSlotVariantAsset(variantId, variant));

    return {
        id: slot.name,
        name: slot.name,
        componentType: slot.componentType,
        x: slot.x ?? null,
        y: slot.y ?? null,
        z: slot.z ?? null,
        rotation: slot.rotation ?? null,
        isLinkedToSocket: slot.isLinkedToSocket,
        linkedSocketNames: [...slot.linkedSocketNames],
        blockedByModSlotNames: [...slot.blockedByModSlotNames],
        blockedByModTypes: [...slot.blockedByModTypes],
        variants,
        variantById: Object.fromEntries(variants.map(variant => [variant.id, variant])),
    };
}

function createItemAsset(
    item: Pick<FoxholeManifestStructure, 'id' | 'legacyKey' | 'codeName' | 'name' | 'description' | 'categoryId' | 'buildOrder' | 'previewUrl' | 'previewIsIconFallback' | 'iconUrl' | 'icons' | 'faction'>,
    categoryById: Map<string, FoxholeManifest['categories'][number]>,
    cost: Record<string, FoxholeManifestRecipeResource> | null = null,
): FoxholeItemAsset {
    const category = resolveCategoryData(categoryById, item.categoryId);
    const aliases = resolveFoxholeCatalogSearchAliases(
        item.id,
        item.codeName,
        item.legacyKey,
    );
    return {
        foxholeKey: item.id,
        resourceKey: item.legacyKey ?? item.id,
        codeName: item.codeName,
        ...(item.legacyKey ? { legacyKey: item.legacyKey } : {}),
        faction: item.faction ?? null,
        categoryKey: item.categoryId,
        categoryName: category.name,
        categoryNameLocalizationId: category.nameLocalizationId,
        categoryIconUrl: category.iconUrl,
        categoryOrder: category.order,
        name: item.name.fallback,
        nameLocalizationId: item.name.id,
        description: item.description.fallback,
        descriptionLocalizationId: item.description.id,
        aliases,
        searchText: buildSearchText([
            item.id,
            item.codeName,
            item.legacyKey,
            item.name.fallback,
            item.categoryId,
            category.name,
            ...aliases,
        ]),
        previewUrl: item.previewUrl ?? null,
        iconUrl: item.icons?.default ?? item.iconUrl ?? null,
        previewIconUrl: item.icons?.rendered ?? item.previewUrl ?? item.icons?.default ?? item.iconUrl ?? null,
        previewIsIconFallback: item.previewIsIconFallback === true,
        buildOrder: item.buildOrder,
        cost: { ...(cost ?? {}) },
        totalCost: { ...(cost ?? {}) },
        isItem: true,
    };
}

export function buildFoxholeStructureCatalog(manifest: FoxholeManifest): FoxholeStructureCatalog {
    const categoryById = buildCategoryMap(manifest);
    const productionIndex = buildFoxholeProductionIndex(manifest);
    const assetByKey: Record<string, FoxholeStructureAsset> = {};
    const packagedPalletByShippableType: Record<string, FoxholeSharedPackagedPalletAsset> = Object.fromEntries(Object.entries(manifest.shared?.packaging ?? {})
        .map(([shippableType, pallet]) => {
            const normalizedShippableType = normalizeFoxholePackagedPalletKey(shippableType);
            if (!normalizedShippableType) {
                return null;
            }

            return [normalizedShippableType, createSharedPackagedPalletAsset(pallet)] as const;
        })
        .filter(Boolean) as Array<readonly [string, FoxholeSharedPackagedPalletAsset]>);
    const structureByKey: Record<string, FoxholeManifestStructure> = {};
    const manifestStructures = manifest.assets.filter(structure => structure.isItem !== true);
    const assetEntries = manifestStructures.map(manifestStructure => {
        // Build sites do not expose cargo selection, even with a published hold profile.
        const structure = isFoxholeBuildSiteKey(manifestStructure.id)
            ? { ...manifestStructure, holdProfile: undefined }
            : manifestStructure;
        const asset = createStructureAsset(structure, categoryById);
        assetByKey[asset.foxholeKey] = asset;
        assetByKey[asset.codeName.toLowerCase()] = asset;
        if (asset.legacyKey) {
            assetByKey[asset.legacyKey] = asset;
        }
        structureByKey[asset.foxholeKey] = structure;
        structureByKey[asset.codeName.toLowerCase()] = structure;
        if (asset.legacyKey) {
            structureByKey[asset.legacyKey] = structure;
        }
        return { asset, structure };
    });

    const assets = assetEntries.map(entry => entry.asset);

    linkDestroyedStructureVariants(assets, assetByKey, structureByKey);
    applyRecipeDerivedVehicleConversions(assets, assetByKey, productionIndex.recipeById);
    linkStructureRelationshipVariants(assets, assetByKey);
    applyRecipeDerivedStructureCosts(
        assetEntries,
        productionIndex.recipeById,
        productionIndex.recipeIdsByOutput,
    );
    applyStructureTotalCosts(assetEntries, assetByKey);

    const textureUrlByKey: Record<string, string> = {};
    for (const { asset, structure } of assetEntries) {
        addTextureVariants(textureUrlByKey, asset.foxholeKey, structure, asset);
    }

    applyInheritedStructureVisuals(assets, assetByKey);

    const catalogSortContext = { assetByKey };
    assets.sort((left, right) => {
        if (left.categoryOrder !== right.categoryOrder) {
            return left.categoryOrder - right.categoryOrder;
        }
        if (left.categoryName !== right.categoryName) {
            return left.categoryName.localeCompare(right.categoryName);
        }

        return compareFoxholeStructureCatalogAssets(catalogSortContext, left, right);
    });

    return {
        assets,
        categories: createCategoryList(manifest, assets),
        assetByKey,
        packagedPalletByShippableType,
        bunkerDestructionWeapons: Object.fromEntries(Object.entries(manifest.shared?.bunkerDestruction?.weapons ?? {})),
        structureByKey,
        textureUrlByKey,
        localizationByLocale: buildLocalizationByLocale(manifest),
    };
}

export function buildFoxholeItemCatalog(manifest: FoxholeManifest): FoxholeItemCatalog {
    const categoryById = buildCategoryMap(manifest);
    const productionIndex = buildFoxholeProductionIndex(manifest);
    const assetByKey: Record<string, FoxholeItemAsset> = {};
    const assets = manifest.assets
        .filter(item => item.isItem === true)
        .map(item => {
            const asset = createItemAsset(
                item,
                categoryById,
                resolveRecipeDerivedCost(
                    item,
                    productionIndex.recipeById,
                    productionIndex.recipeIdsByOutput,
                ),
            );
            assetByKey[asset.foxholeKey] = asset;
            assetByKey[asset.codeName.toLowerCase()] = asset;
            if (asset.legacyKey) {
                assetByKey[asset.legacyKey] = asset;
            }
            return asset;
        });

    assets.sort((left, right) => {
        if (left.categoryOrder !== right.categoryOrder) {
            return left.categoryOrder - right.categoryOrder;
        }
        if (left.categoryName !== right.categoryName) {
            return left.categoryName.localeCompare(right.categoryName);
        }
        if (left.buildOrder !== right.buildOrder) {
            return left.buildOrder - right.buildOrder;
        }
        return left.name.localeCompare(right.name);
    });

    return {
        assets,
        categories: createCategoryList(manifest, assets),
        assetByKey,
        localizationByLocale: buildLocalizationByLocale(manifest),
    };
}

let adoptedManifestRevision = -1;
function refreshManifestCaches(): void {
    const revision = getFoxholeManifestRevision();
    if (revision !== adoptedManifestRevision) {
        adoptedManifestRevision = revision;
        structureCatalogCache.clear(); itemCatalogCache.clear();
    }
}

export function getFoxholeStructureCatalog(baseAssetsUrl: string): FoxholeStructureCatalog {
    refreshManifestCaches();
    const cacheKey = String(baseAssetsUrl ?? '').trim() || '/foxhole/assets/';
    const shared = getNixieExtensionProductCatalog();
    if (shared?.extensions.value.some(entry => entry.ownerId === 'nixie.foxhole-planner')) {
        return shared.domainData('nixie.foxhole-planner', `structures:${cacheKey}`, () => {
            // Adopt any catalog prepared during contribution registration. Later
            // generations rebuild from the current manifest, once for all panels.
            const catalog = structureCatalogCache.get(cacheKey) ?? buildFoxholeStructureCatalog(getFoxholeManifest(cacheKey));
            structureCatalogCache.delete(cacheKey);
            return catalog;
        }, getFoxholeManifestRevision());
    }
    const existing = structureCatalogCache.get(cacheKey);
    if (existing) {
        return existing;
    }

    const catalog = buildFoxholeStructureCatalog(getFoxholeManifest(cacheKey));
    structureCatalogCache.set(cacheKey, catalog);
    return catalog;
}

export function getFoxholeItemCatalog(baseAssetsUrl: string): FoxholeItemCatalog {
    refreshManifestCaches();
    const cacheKey = String(baseAssetsUrl ?? '').trim() || '/foxhole/assets/';
    const shared = getNixieExtensionProductCatalog();
    if (shared?.extensions.value.some(entry => entry.ownerId === 'nixie.foxhole-planner')) {
        return shared.domainData('nixie.foxhole-planner', `items:${cacheKey}`, () => {
            // Adopt any catalog prepared during contribution registration. Later
            // generations rebuild from the current manifest, once for all panels.
            const catalog = itemCatalogCache.get(cacheKey) ?? buildFoxholeItemCatalog(getFoxholeManifest(cacheKey));
            itemCatalogCache.delete(cacheKey);
            return catalog;
        }, getFoxholeManifestRevision());
    }
    const existing = itemCatalogCache.get(cacheKey);
    if (existing) {
        return existing;
    }

    const catalog = buildFoxholeItemCatalog(getFoxholeManifest(cacheKey));
    itemCatalogCache.set(cacheKey, catalog);
    return catalog;
}

export function getFoxholeStructureAsset(foxholeKey: string, baseAssetsUrl: string): FoxholeStructureAsset | null {
    const catalog = getFoxholeStructureCatalog(baseAssetsUrl);
    return catalog.assetByKey[String(foxholeKey ?? '').trim()] ?? null;
}

export function getFoxholeStructureModificationSlots(
    foxholeKey: string,
    baseAssetsUrl: string,
): FoxholeStructureModificationSlotAsset[] {
    return getFoxholeStructureAsset(foxholeKey, baseAssetsUrl)?.modificationSlots ?? [];
}

export function getFoxholeStructureModificationSlot(
    foxholeKey: string,
    slotId: string,
    baseAssetsUrl: string,
): FoxholeStructureModificationSlotAsset | null {
    const asset = getFoxholeStructureAsset(foxholeKey, baseAssetsUrl);
    return asset?.modificationSlotById[String(slotId ?? '').trim()] ?? null;
}

export function getFoxholeLocalizationStrings(baseAssetsUrl: string, locale = 'en'): Record<string, string> {
    return getFoxholeManifestLocalizationMap(baseAssetsUrl, locale);
}

export async function loadFoxholeLocalizationStrings(baseAssetsUrl: string, locale = 'en'): Promise<Record<string, string>> {
    return await loadFoxholeManifestLocalizationMap(baseAssetsUrl, locale);
}

export function resolveFoxholeTextureUrl(textureKey: string, baseAssetsUrl: string): string | null {
    const catalog = getFoxholeStructureCatalog(baseAssetsUrl);
    return resolveFoxholeTextureUrlFromCatalog(textureKey, catalog);
}

export function resolveFoxholeTextureUrlFromCatalog(
    textureKey: string,
    catalog: Pick<FoxholeStructureCatalog, 'textureUrlByKey'>,
): string | null {
    const parsed = parseFoxholeStructureTextureKey(textureKey);
    if (!parsed) {
        return null;
    }

    const normalizedFaction = normalizeFoxholeFaction(parsed.faction);
    const resolvedKey = createFoxholeStructureTextureKey(
        parsed.foxholeKey,
        normalizedFaction,
        parsed.destroyed === true,
        parsed.colorHex,
        parsed.packaged === true,
    );
    const packagedFactionFallback = catalog.textureUrlByKey[
        createFoxholeStructureTextureKey(parsed.foxholeKey, normalizedFaction, parsed.destroyed === true, parsed.colorHex, false)
    ];
    const packagedDefaultFallback = catalog.textureUrlByKey[
        createFoxholeStructureTextureKey(parsed.foxholeKey, null, parsed.destroyed === true, null, false)
    ];
    const packagedFallback = parsed.packaged === true
        ? packagedFactionFallback ?? packagedDefaultFallback
        : null;

    return catalog.textureUrlByKey[resolvedKey]
        ?? catalog.textureUrlByKey[createFoxholeStructureTextureKey(parsed.foxholeKey, null, parsed.destroyed === true, null, parsed.packaged === true)]
        ?? packagedFallback
        ?? null;
}

export function resolveFoxholeSharedPackagedPalletFromCatalog(
    catalog: Pick<FoxholeStructureCatalog, 'packagedPalletByShippableType'>,
    shippableType: string | null | undefined,
): FoxholeSharedPackagedPalletAsset | null {
    const normalizedShippableType = normalizeFoxholePackagedPalletKey(shippableType);
    if (!normalizedShippableType) {
        return null;
    }

    return catalog.packagedPalletByShippableType[normalizedShippableType] ?? null;
}

export function findFoxholeAppliedModificationAssetFromCatalog(
    catalog: Pick<FoxholeStructureCatalog, 'assets'>,
    lookup: FoxholeAppliedModificationLookup,
): FoxholeStructureAsset | null {
    const parentStructureId = String(lookup.parentStructureId ?? '').trim();
    const appliedModificationId = String(lookup.appliedModificationId ?? '').trim();
    if (!parentStructureId || !appliedModificationId) {
        return null;
    }

    return catalog.assets.find(asset => asset.parentStructureId === parentStructureId && asset.appliedModificationId === appliedModificationId) ?? null;
}
