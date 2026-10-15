import type {
    FoxholeManifest,
    FoxholeManifestConversionEntry,
    FoxholeManifestModificationSlot,
    FoxholeManifestModificationSlotVariant,
    FoxholeManifestRecipeResource,
    FoxholeManifestStructure,
} from '../manifest.ts';
import { getFoxholeManifest } from '../manifest.ts';
import type {
    FoxholeProductionBuildTarget,
    FoxholeProductionBuildTargetKind,
    FoxholeProductionChannel,
    FoxholeProductionIndex,
    FoxholeProductionRecipe,
    FoxholeProductionResourceAmount,
} from './types.ts';

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

const productionIndexCache = new Map<string, FoxholeProductionIndex>();

function normalizeOptionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : null;
}

function resolveConversionRecipeOrdinal(
    entry: FoxholeManifestConversionEntry,
    entryIndex: number,
): number {
    return typeof entry.id === 'number' && Number.isFinite(entry.id)
        ? entry.id
        : entryIndex;
}

function normalizeRecipeResources(
    resources: Record<string, FoxholeManifestRecipeResource> | null | undefined,
): Record<string, FoxholeProductionResourceAmount> {
    const normalized: Record<string, FoxholeProductionResourceAmount> = {};
    for (const [resourceId, resource] of Object.entries(resources ?? {})) {
        const normalizedResourceId = normalizeKey(resourceId);
        const quantity = typeof resource?.quantity === 'number' && Number.isFinite(resource.quantity)
            ? resource.quantity
            : null;
        if (!normalizedResourceId || quantity === null) {
            continue;
        }

        normalized[normalizedResourceId] = {
            quantity,
            limit: normalizeOptionalNumber(resource.limit),
        };
    }

    return normalized;
}

function hasRecipeResources(resources: Record<string, FoxholeProductionResourceAmount>): boolean {
    return Object.keys(resources).length > 0;
}

function createBuildOutputMap(buildTargetId: string): Record<string, FoxholeProductionResourceAmount> {
    const normalizedBuildTargetId = normalizeKey(buildTargetId);
    return normalizedBuildTargetId
        ? {
            [normalizedBuildTargetId]: {
                quantity: 1,
                limit: null,
            },
        }
        : {};
}

export function createFoxholeProductionBuildTargetId(
    kind: FoxholeProductionBuildTargetKind,
    ...parts: string[]
): string {
    const normalizedParts = parts.map(part => normalizeKey(part)).filter(Boolean);
    return kind && normalizedParts.length > 0
        ? [kind, ...normalizedParts].join(':')
        : '';
}

export function parseFoxholeProductionBuildTargetId(value: string): FoxholeProductionBuildTarget | null {
    const normalizedValue = normalizeKey(value);
    if (!normalizedValue) {
        return null;
    }

    const [kindValue, ...parts] = normalizedValue.split(':');
    const kind = kindValue as FoxholeProductionBuildTargetKind;
    switch (kind) {
        case 'structure':
        case 'vehicle':
            return parts.length === 1
                ? {
                    id: normalizedValue,
                    kind,
                    structureId: parts[0]!,
                    slotId: null,
                    variantId: null,
                }
                : null;
        case 'upgrade':
        case 'modification':
            return parts.length >= 3
                ? {
                    id: normalizedValue,
                    kind,
                    structureId: parts[0]!,
                    slotId: parts[1]!,
                    variantId: parts.slice(2).join(':'),
                }
                : null;
        default:
            return null;
    }
}

export function getFoxholeProductionRecipeBuildTarget(
    recipe: Pick<FoxholeProductionRecipe, 'buildOutput'>,
): FoxholeProductionBuildTarget | null {
    const buildTargetIds = Object.keys(recipe.buildOutput).map(buildTargetId => normalizeKey(buildTargetId)).filter(Boolean);
    return buildTargetIds.length === 1
        ? parseFoxholeProductionBuildTargetId(buildTargetIds[0]!)
        : null;
}

export function isFoxholeProductionBuildRecipe(
    recipe: Pick<FoxholeProductionRecipe, 'buildOutput'>,
): boolean {
    return getFoxholeProductionRecipeBuildTarget(recipe) !== null;
}

function createStructureBuildTargetId(
    structure: Pick<FoxholeManifestStructure, 'id' | 'isVehicle'>,
): string {
    const structureId = normalizeKey(structure.id);
    if (!structureId) {
        return '';
    }

    return createFoxholeProductionBuildTargetId(
        structure.isVehicle === true ? 'vehicle' : 'structure',
        structureId,
    );
}

function createModificationBuildTargetId(
    structureId: string,
    slotId: string,
    variantId: string,
    isUpgrade: boolean,
): string {
    const normalizedStructureId = normalizeKey(structureId);
    const normalizedSlotId = normalizeKey(slotId);
    const normalizedVariantId = normalizeKey(variantId);
    if (!normalizedStructureId || !normalizedSlotId || !normalizedVariantId) {
        return '';
    }

    return createFoxholeProductionBuildTargetId(
        isUpgrade ? 'upgrade' : 'modification',
        normalizedStructureId,
        normalizedSlotId,
        normalizedVariantId,
    );
}

function canCreateStructureBuildRecipe(
    structure: Pick<FoxholeManifestStructure, 'hideInList' | 'isDestroyed' | 'isBreached'>,
): boolean {
    return structure.hideInList !== true
        && structure.isDestroyed !== true
        && structure.isBreached !== true;
}

function pushIndexEntry(store: Record<string, string[]>, key: string, recipeId: string): void {
    if (!key) {
        return;
    }

    const existing = store[key] ?? [];
    existing.push(recipeId);
    store[key] = existing;
}

function indexRecipeOutputs(
    store: Record<string, string[]>,
    recipe: Pick<FoxholeProductionRecipe, 'id' | 'itemOutput' | 'crateOutput' | 'liquidOutput' | 'buildOutput'>,
): void {
    for (const resourceId of Object.keys(recipe.itemOutput)) {
        pushIndexEntry(store, createFoxholeProductionCommodityKey('item', resourceId), recipe.id);
    }
    for (const resourceId of Object.keys(recipe.crateOutput)) {
        pushIndexEntry(store, createFoxholeProductionCommodityKey('crate', resourceId), recipe.id);
    }
    for (const resourceId of Object.keys(recipe.liquidOutput)) {
        pushIndexEntry(store, createFoxholeProductionCommodityKey('liquid', resourceId), recipe.id);
    }
    for (const resourceId of Object.keys(recipe.buildOutput)) {
        pushIndexEntry(store, createFoxholeProductionCommodityKey('build', resourceId), recipe.id);
    }
}

function createRecipe(
    id: string,
    sourceType: FoxholeProductionRecipe['sourceType'],
    structure: Pick<FoxholeManifestStructure, 'id' | 'codeName' | 'name'>,
    entry: FoxholeManifestConversionEntry,
    options?: {
        slot?: Pick<FoxholeManifestModificationSlot, 'name'> | null;
        variantId?: string | null;
        variant?: Pick<FoxholeManifestModificationSlotVariant, 'name' | 'modificationId' | 'isUpgrade'> | null;
    },
): FoxholeProductionRecipe {
    const slotName = normalizeKey(options?.slot?.name);
    const variantId = normalizeKey(options?.variantId);

    return {
        id,
        sourceType,
        sourceStructureId: structure.id,
        sourceStructureKey: structure.id,
        sourceStructureName: structure.name.fallback,
        sourceSlotId: slotName || null,
        sourceSlotName: slotName || null,
        sourceVariantId: variantId || null,
        sourceVariantName: options?.variant?.name?.fallback ?? null,
        sourceModificationId: normalizeKey(options?.variant?.modificationId) || null,
        isUpgrade: options?.variant?.isUpgrade === true,
        durationSeconds: normalizeOptionalNumber(entry.duration),
        powerDelta: normalizeOptionalNumber(entry.powerDelta),
        consumesResourceNodes: entry.bConsumeResourceNodes === true,
        itemInput: normalizeRecipeResources(entry.itemInput),
        crateInput: normalizeRecipeResources(entry.crateInput),
        liquidInput: normalizeRecipeResources(entry.liquidInput),
        itemOutput: normalizeRecipeResources(entry.itemOutput),
        crateOutput: normalizeRecipeResources(entry.crateOutput),
        liquidOutput: normalizeRecipeResources(entry.liquidOutput),
        buildOutput: {},
    };
}

function createBuildRecipe(
    id: string,
    sourceType: FoxholeProductionRecipe['sourceType'],
    structure: Pick<FoxholeManifestStructure, 'id' | 'codeName' | 'name'>,
    cost: Record<string, FoxholeManifestRecipeResource> | null | undefined,
    buildTargetId: string,
    options?: {
        slot?: Pick<FoxholeManifestModificationSlot, 'name'> | null;
        variantId?: string | null;
        variant?: Pick<FoxholeManifestModificationSlotVariant, 'name' | 'modificationId' | 'isUpgrade'> | null;
    },
): FoxholeProductionRecipe {
    const slotName = normalizeKey(options?.slot?.name);
    const variantId = normalizeKey(options?.variantId);

    return {
        id,
        sourceType,
        sourceStructureId: structure.id,
        sourceStructureKey: structure.id,
        sourceStructureName: structure.name.fallback,
        sourceSlotId: slotName || null,
        sourceSlotName: slotName || null,
        sourceVariantId: variantId || null,
        sourceVariantName: options?.variant?.name?.fallback ?? null,
        sourceModificationId: normalizeKey(options?.variant?.modificationId) || null,
        isUpgrade: options?.variant?.isUpgrade === true,
        durationSeconds: null,
        powerDelta: null,
        consumesResourceNodes: false,
        itemInput: normalizeRecipeResources(cost),
        crateInput: {},
        liquidInput: {},
        itemOutput: {},
        crateOutput: {},
        liquidOutput: {},
        buildOutput: createBuildOutputMap(buildTargetId),
    };
}

export function createFoxholeProductionCommodityKey(
    channel: FoxholeProductionChannel,
    resourceId: string,
): string {
    const normalizedResourceId = normalizeKey(resourceId);
    return normalizedResourceId
        ? `${channel}:${normalizedResourceId}`
        : '';
}

export function createFoxholeProductionSlotVariantKey(
    structureId: string,
    slotId: string,
    variantId: string,
): string {
    const normalizedStructureId = normalizeKey(structureId);
    const normalizedSlotId = normalizeKey(slotId);
    const normalizedVariantId = normalizeKey(variantId);
    return normalizedStructureId && normalizedSlotId && normalizedVariantId
        ? `${normalizedStructureId}::${normalizedSlotId}::${normalizedVariantId}`
        : '';
}

export function buildFoxholeProductionIndex(
    manifest: Pick<FoxholeManifest, 'assets'>,
): FoxholeProductionIndex {
    const recipeById: Record<string, FoxholeProductionRecipe> = {};
    const recipeIdsByOutput: Record<string, string[]> = {};
    const structureRecipeIdsByStructureId: Record<string, string[]> = {};
    const modificationRecipeIdsBySlotVariantKey: Record<string, string[]> = {};
    const parentBuildTargetIdByTargetId: Record<string, string> = {};
    const structureById = Object.fromEntries(manifest.assets.map(structure => [normalizeKey(structure.id), structure]));

    for (const structure of manifest.assets) {
        const structureId = normalizeKey(structure.id);
        if (!structureId) {
            continue;
        }

        if (canCreateStructureBuildRecipe(structure)) {
            const buildTargetId = createStructureBuildTargetId(structure);
            const buildRecipeId = buildTargetId
                ? `build:${buildTargetId}:recipe:0`
                : '';
            const buildRecipe = buildRecipeId
                ? createBuildRecipe(buildRecipeId, 'structure', structure, structure.cost, buildTargetId)
                : null;
            const parentStructureId = normalizeKey(structure.parentStructureId);
            const parentStructure = parentStructureId
                ? structureById[parentStructureId]
                : null;
            const parentBuildTargetId = parentStructure && canCreateStructureBuildRecipe(parentStructure)
                ? createStructureBuildTargetId(parentStructure)
                : '';
            if (buildTargetId && parentBuildTargetId) {
                parentBuildTargetIdByTargetId[buildTargetId] = parentBuildTargetId;
            }
            if (buildRecipe && hasRecipeResources(buildRecipe.itemInput)) {
                recipeById[buildRecipe.id] = buildRecipe;
                indexRecipeOutputs(recipeIdsByOutput, buildRecipe);
            }
        }

        structure.conversionEntries.forEach((entry, entryIndex) => {
            const recipeOrdinal = resolveConversionRecipeOrdinal(entry, entryIndex);
            const recipeId = `structure:${structureId}:recipe:${recipeOrdinal}`;
            const recipe = createRecipe(recipeId, 'structure', structure, entry);
            recipeById[recipeId] = recipe;
            pushIndexEntry(structureRecipeIdsByStructureId, structureId, recipeId);
            indexRecipeOutputs(recipeIdsByOutput, recipe);
        });

        structure.modificationSlots.forEach(slot => {
            const slotId = normalizeKey(slot.name);
            if (!slotId) {
                return;
            }

            Object.entries(slot.variants).forEach(([variantId, variant]) => {
                const normalizedVariantId = normalizeKey(variantId);
                if (!normalizedVariantId) {
                    return;
                }

                const buildTargetId = createModificationBuildTargetId(
                    structureId,
                    slotId,
                    normalizedVariantId,
                    variant.isUpgrade === true,
                );
                const buildRecipeId = buildTargetId
                    ? `build:${buildTargetId}:recipe:0`
                    : '';
                const buildRecipe = buildRecipeId
                    ? createBuildRecipe(buildRecipeId, 'modification', structure, variant.cost, buildTargetId, {
                        slot,
                        variantId: normalizedVariantId,
                        variant,
                    })
                    : null;
                const parentBuildTargetId = canCreateStructureBuildRecipe(structure)
                    ? createStructureBuildTargetId(structure)
                    : '';
                if (buildTargetId && parentBuildTargetId) {
                    parentBuildTargetIdByTargetId[buildTargetId] = parentBuildTargetId;
                }
                if (buildRecipe && hasRecipeResources(buildRecipe.itemInput)) {
                    recipeById[buildRecipe.id] = buildRecipe;
                    indexRecipeOutputs(recipeIdsByOutput, buildRecipe);
                }

                variant.conversionEntries.forEach((entry, entryIndex) => {
                    const recipeOrdinal = resolveConversionRecipeOrdinal(entry, entryIndex);
                    const recipeId = `modification:${structureId}:${slotId}:${normalizedVariantId}:recipe:${recipeOrdinal}`;
                    const recipe = createRecipe(recipeId, 'modification', structure, entry, {
                        slot,
                        variantId: normalizedVariantId,
                        variant,
                    });
                    recipeById[recipeId] = recipe;
                    pushIndexEntry(
                        modificationRecipeIdsBySlotVariantKey,
                        createFoxholeProductionSlotVariantKey(structureId, slotId, normalizedVariantId),
                        recipeId,
                    );
                    indexRecipeOutputs(recipeIdsByOutput, recipe);
                });
            });
        });
    }

    return {
        recipeById,
        recipeIdsByOutput,
        structureRecipeIdsByStructureId,
        modificationRecipeIdsBySlotVariantKey,
        parentBuildTargetIdByTargetId,
    };
}

export function getFoxholeProductionIndex(baseAssetsUrl: string): FoxholeProductionIndex {
    const cacheKey = normalizeKey(baseAssetsUrl) || '/foxhole/assets/';
    const existing = productionIndexCache.get(cacheKey);
    if (existing) {
        return existing;
    }

    const index = buildFoxholeProductionIndex(getFoxholeManifest(cacheKey));
    productionIndexCache.set(cacheKey, index);
    return index;
}
