import type { FoxholeCostBreakdownEntry } from '#foxhole/components/nixie/foxhole/FoxholeCostBreakdownList.vue';
import {
    createFoxholeAssetsBaseUrl,
    getFoxholeItemCatalog,
    getFoxholeStructureCatalog,

} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import type { FoxholeItemAsset, FoxholeItemCatalog, FoxholeStructureAsset, FoxholeStructureCatalog } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholePowerDeltaMw } from '#foxhole/plugins/foxhole/nixie/facility-power.ts';
import {
    resolveFoxholeItemDefaultIconUrl,
    resolveFoxholeStructureDefaultIconUrl,
} from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import { getFoxholeManifest } from '#foxhole/plugins/foxhole/nixie/manifest.ts';
import {
    createFoxholeProductionSlotVariantKey,
    getFoxholeProductionIndex,
    parseFoxholeProductionBuildTargetId,
} from '#foxhole/plugins/foxhole/nixie/production/index.ts';
import {
    FOXHOLE_RECIPE_POWER_RESOURCE_ID,
    isFoxholeBuildOnlyRecipe as isBuildOnlyRecipe,
    resolveFoxholeRecipeEffectivePowerDelta,
} from '#foxhole/plugins/foxhole/nixie/production/operating-power.ts';
import type {
    FoxholeProductionChannel,
    FoxholeProductionIndex,
    FoxholeProductionRecipe,
    FoxholeProductionResourceAmount,
} from '#foxhole/plugins/foxhole/nixie/production/types.ts';

export { FOXHOLE_RECIPE_POWER_RESOURCE_ID } from '#foxhole/plugins/foxhole/nixie/production/operating-power.ts';
export const FOXHOLE_RECIPE_POWER_ICON_NAME = 'nx:lightning';

export type FoxholeRecipeResourceRef = {
    id: string;
    channel: FoxholeProductionChannel;
    quantity: number;
    limit: number | null;
    item: FoxholeItemAsset | null;
    structure: FoxholeStructureAsset | null;
    /** Resolved English name (item, structure/vehicle, or upgrade variant). */
    resolvedName: string | null;
    resolvedNameLocalizationId: string | null;
    resolvedIconUrl: string | null;
    /** Nuxt icon name used when no bitmap icon URL is available (e.g. Power). */
    iconName?: string | null;
    /** When false, the card omits the quantity badge (e.g. producer structure). */
    showQuantity?: boolean;
    /** Alternate quantity formatting (power uses MW). */
    quantityUnit?: 'mw' | null;
};

export type FoxholeRecipeViewModel = {
    id: string;
    recipe: FoxholeProductionRecipe;
    title: string;
    /** Optional secondary line; omitted for compact facility lists. */
    subtitle: string | null;
    groupId: 'facility' | 'upgrades' | 'modifications';
    durationSeconds: number | null;
    powerDelta: number | null;
    /** True when this is a structure/vehicle construction cost (build output only). */
    isBuildCost: boolean;
    consumesResourceNodes: boolean;
    inputs: FoxholeRecipeResourceRef[];
    outputs: FoxholeRecipeResourceRef[];
};

export type FoxholeRecipeGroupViewModel = {
    id: 'facility' | 'upgrades' | 'modifications';
    title: string;
    recipes: FoxholeRecipeViewModel[];
};

export type FoxholeStructureRecipesViewModel = {
    structureId: string;
    structure: FoxholeStructureAsset | null;
    recipes: FoxholeRecipeViewModel[];
    groups: FoxholeRecipeGroupViewModel[];
};

export type FoxholeStructureRecipeOption = {
    id: string;
    name: string;
    recipeCount: number;
};

export type FoxholeRecipeShowcaseCase = {
    id: string;
    label: string;
    description: string;
    /** Optional section heading for verbose showcase grouping. */
    group: string;
    recipe: FoxholeRecipeViewModel;
};

export type ResolveFoxholeStructureRecipesOptions = {
    structureId: string;
    /** Explorer faction filter; shared outputs remain visible. */
    faction?: 'c' | 'w' | 'all';
    appBaseUrl?: string;
    baseAssetsUrl?: string;
    /** Include conversion recipes from modification variants. */
    includeModifications?: boolean;
    /**
     * When set, only include mod recipes for these slot→variant selections.
     * Keys are slot ids; values are variant ids.
     */
    modificationSelections?: Readonly<Record<string, string>>;
    itemCatalog?: FoxholeItemCatalog | null;
    structureCatalog?: FoxholeStructureCatalog | null;
    productionIndex?: FoxholeProductionIndex | null;
};

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function formatFallbackLabel(value: string): string {
    return String(value ?? '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim() || 'Unknown';
}

function resolveItem(
    itemCatalog: FoxholeItemCatalog | null | undefined,
    resourceId: string,
): FoxholeItemAsset | null {
    const key = normalizeKey(resourceId);
    if (!key || !itemCatalog) {
        return null;
    }
    return itemCatalog.assetByKey[key]
        ?? itemCatalog.assets.find(asset => (
            normalizeKey(asset.foxholeKey) === key
            || normalizeKey(asset.codeName) === key
            || normalizeKey(asset.resourceKey) === key
            || normalizeKey(asset.legacyKey) === key
        ))
        ?? null;
}

function resolveStructure(
    structureCatalog: FoxholeStructureCatalog | null | undefined,
    structureId: string,
): FoxholeStructureAsset | null {
    const key = normalizeKey(structureId);
    if (!key || !structureCatalog) {
        return null;
    }
    return structureCatalog.assetByKey[key]
        ?? structureCatalog.assetByKey[key.toLowerCase()]
        ?? null;
}

function resolveBuildResource(
    resourceId: string,
    structureCatalog: FoxholeStructureCatalog | null | undefined,
): Pick<
    FoxholeRecipeResourceRef,
    'structure' | 'resolvedName' | 'resolvedNameLocalizationId' | 'resolvedIconUrl'
> {
    const target = parseFoxholeProductionBuildTargetId(resourceId);
    const structure = resolveStructure(
        structureCatalog,
        target?.structureId ?? resourceId.replace(/^(structure|vehicle):/i, ''),
    );

    if (!structure) {
        return {
            structure: null,
            resolvedName: null,
            resolvedNameLocalizationId: null,
            resolvedIconUrl: null,
        };
    }

    if (
        target
        && (target.kind === 'upgrade' || target.kind === 'modification')
        && target.slotId
        && target.variantId
    ) {
        const variant = structure.modificationSlotById[target.slotId]?.variantById[target.variantId] ?? null;
        if (variant) {
            const variantIcon = String(variant.iconUrl ?? variant.previewIconUrl ?? '').trim();
            return {
                structure,
                resolvedName: String(variant.name ?? '').trim() || structure.name,
                resolvedNameLocalizationId: variant.nameLocalizationId ?? structure.nameLocalizationId,
                resolvedIconUrl: variantIcon || resolveFoxholeStructureDefaultIconUrl(structure) || null,
            };
        }
    }

    return {
        structure,
        resolvedName: structure.name,
        resolvedNameLocalizationId: structure.nameLocalizationId,
        resolvedIconUrl: resolveFoxholeStructureDefaultIconUrl(structure) || null,
    };
}

function mapResourceMap(
    resources: Record<string, FoxholeProductionResourceAmount>,
    channel: FoxholeProductionChannel,
    itemCatalog: FoxholeItemCatalog | null | undefined,
    structureCatalog: FoxholeStructureCatalog | null | undefined,
): FoxholeRecipeResourceRef[] {
    return Object.entries(resources)
        .map(([resourceId, amount]) => {
            const id = normalizeKey(resourceId) || resourceId;
            if (channel === 'build') {
                const build = resolveBuildResource(id, structureCatalog);
                return {
                    id,
                    channel,
                    quantity: Number(amount?.quantity ?? 0),
                    limit: typeof amount?.limit === 'number' && Number.isFinite(amount.limit)
                        ? amount.limit
                        : null,
                    item: null,
                    structure: build.structure,
                    resolvedName: build.resolvedName,
                    resolvedNameLocalizationId: build.resolvedNameLocalizationId,
                    resolvedIconUrl: build.resolvedIconUrl,
                } satisfies FoxholeRecipeResourceRef;
            }

            const item = resolveItem(itemCatalog, id);
            if (item) {
                return {
                    id,
                    channel,
                    quantity: Number(amount?.quantity ?? 0),
                    limit: typeof amount?.limit === 'number' && Number.isFinite(amount.limit)
                        ? amount.limit
                        : null,
                    item,
                    structure: null,
                    resolvedName: item.name,
                    resolvedNameLocalizationId: item.nameLocalizationId,
                    resolvedIconUrl: resolveFoxholeItemDefaultIconUrl(item) || null,
                } satisfies FoxholeRecipeResourceRef;
            }

            // Field Modification Center (and similar) emit vehicle/structure codenames
            // on the item channel — fall back to the structure catalog.
            const structure = resolveStructure(structureCatalog, id);
            return {
                id,
                channel,
                quantity: Number(amount?.quantity ?? 0),
                limit: typeof amount?.limit === 'number' && Number.isFinite(amount.limit)
                    ? amount.limit
                    : null,
                item: null,
                structure,
                resolvedName: structure?.name ?? null,
                resolvedNameLocalizationId: structure?.nameLocalizationId ?? null,
                resolvedIconUrl: resolveFoxholeStructureDefaultIconUrl(structure) || null,
            } satisfies FoxholeRecipeResourceRef;
        })
        .filter(entry => entry.quantity > 0)
        .sort((left, right) => left.id.localeCompare(right.id));
}

function collectRecipeResources(
    recipe: FoxholeProductionRecipe,
    side: 'input' | 'output',
    itemCatalog: FoxholeItemCatalog | null | undefined,
    structureCatalog: FoxholeStructureCatalog | null | undefined,
): FoxholeRecipeResourceRef[] {
    if (side === 'input') {
        return [
            ...mapResourceMap(recipe.itemInput, 'item', itemCatalog, structureCatalog),
            ...mapResourceMap(recipe.crateInput, 'crate', itemCatalog, structureCatalog),
            ...mapResourceMap(recipe.liquidInput, 'liquid', itemCatalog, structureCatalog),
        ];
    }

    return [
        ...mapResourceMap(recipe.itemOutput, 'item', itemCatalog, structureCatalog),
        ...mapResourceMap(recipe.crateOutput, 'crate', itemCatalog, structureCatalog),
        ...mapResourceMap(recipe.liquidOutput, 'liquid', itemCatalog, structureCatalog),
        ...mapResourceMap(recipe.buildOutput, 'build', itemCatalog, structureCatalog),
    ];
}

export function resolveFoxholeRecipeResourceLabel(
    resource: FoxholeRecipeResourceRef,
    localize: (localizationId: string | null | undefined, fallback: string) => string,
): string {
    if (resource.resolvedName) {
        return localize(resource.resolvedNameLocalizationId, resource.resolvedName);
    }
    if (resource.item) {
        return localize(resource.item.nameLocalizationId, resource.item.name);
    }
    if (resource.structure) {
        return localize(resource.structure.nameLocalizationId, resource.structure.name);
    }
    const stripped = resource.id.replace(/^(structure|vehicle|upgrade|modification):/i, '');
    return formatFallbackLabel(stripped || resource.id);
}

export function resolveFoxholeRecipeResourceIconUrl(resource: FoxholeRecipeResourceRef): string {
    return String(
        resource.resolvedIconUrl
        || resolveFoxholeItemDefaultIconUrl(resource.item)
        || resolveFoxholeStructureDefaultIconUrl(resource.structure)
        || '',
    ).trim();
}

function resolveRecipeGroupId(recipe: FoxholeProductionRecipe): FoxholeRecipeViewModel['groupId'] {
    if (recipe.sourceType === 'structure') {
        return 'facility';
    }
    return recipe.isUpgrade ? 'upgrades' : 'modifications';
}

function resourceDisplayName(resource: FoxholeRecipeResourceRef): string {
    return String(
        resource.resolvedName
        ?? resource.item?.name
        ?? resource.structure?.name
        ?? formatFallbackLabel(resource.id.replace(/^(structure|vehicle|upgrade|modification):/i, '')),
    ).trim();
}

function buildRecipeTitle(outputs: readonly FoxholeRecipeResourceRef[]): string {
    // Always title from product outputs (comma-joined), never the producer/upgrade name.
    return outputs
        .map(resourceDisplayName)
        .filter(Boolean)
        .join(', ');
}

function hasCommodityOutputs(outputs: readonly FoxholeRecipeResourceRef[]): boolean {
    return outputs.some(output => output.channel !== 'build');
}

function createProducerStructureInput(
    recipe: FoxholeProductionRecipe,
    structureCatalog: FoxholeStructureCatalog | null | undefined,
): FoxholeRecipeResourceRef | null {
    const structure = resolveStructure(structureCatalog, recipe.sourceStructureId);
    if (!structure) {
        return null;
    }

    if (recipe.sourceSlotId && recipe.sourceVariantId) {
        const variant = structure.modificationSlotById[recipe.sourceSlotId]?.variantById[recipe.sourceVariantId] ?? null;
        if (variant) {
            const variantIcon = String(variant.iconUrl ?? variant.previewIconUrl ?? '').trim();
            return {
                id: `producer:${recipe.sourceStructureId}:${recipe.sourceSlotId}:${recipe.sourceVariantId}`,
                channel: 'build',
                quantity: 1,
                limit: null,
                item: null,
                structure,
                resolvedName: String(variant.name ?? '').trim() || structure.name,
                resolvedNameLocalizationId: variant.nameLocalizationId ?? structure.nameLocalizationId,
                resolvedIconUrl: variantIcon || resolveFoxholeStructureDefaultIconUrl(structure) || null,
                showQuantity: false,
            };
        }
    }

    return {
        id: `producer:${recipe.sourceStructureId}`,
        channel: 'build',
        quantity: 1,
        limit: null,
        item: null,
        structure,
        resolvedName: structure.name,
        resolvedNameLocalizationId: structure.nameLocalizationId,
        resolvedIconUrl: resolveFoxholeStructureDefaultIconUrl(structure) || null,
        showQuantity: false,
    };
}

function withProducerStructureInput(
    recipe: FoxholeProductionRecipe,
    inputs: FoxholeRecipeResourceRef[],
    outputs: readonly FoxholeRecipeResourceRef[],
    structureCatalog: FoxholeStructureCatalog | null | undefined,
): FoxholeRecipeResourceRef[] {
    // Output-only conversions: the facility/upgrade is the implied producer input.
    // Skip pure build recipes (structure/vehicle construction), where the output is the structure itself.
    if (inputs.length > 0 || !hasCommodityOutputs(outputs)) {
        return inputs;
    }
    const producer = createProducerStructureInput(recipe, structureCatalog);
    return producer ? [producer] : inputs;
}

function buildStructurePowerDeltaById(baseAssetsUrl: string): Record<string, number | null> {
    const manifest = getFoxholeManifest(baseAssetsUrl);
    const powerById: Record<string, number | null> = {};
    for (const asset of manifest.assets) {
        const structureId = normalizeKey(asset.id);
        if (!structureId) {
            continue;
        }
        const delta = asset.powerGridInfo?.powerDelta;
        powerById[structureId] = typeof delta === 'number' && Number.isFinite(delta)
            ? delta
            : null;
    }
    return powerById;
}

/**
 * True when 2+ recipes share the same effective power delta.
 * Sibling lists can omit per-card power meta in that case (structure footer / group context covers it).
 */
export function foxholeRecipesSharePowerDelta(
    recipes: readonly Pick<FoxholeRecipeViewModel, 'powerDelta'>[],
): boolean {
    if (recipes.length < 2) {
        return false;
    }
    const first = resolveFoxholePowerDeltaMw(recipes[0]?.powerDelta ?? null);
    return recipes.every(recipe => (
        resolveFoxholePowerDeltaMw(recipe.powerDelta) === first
    ));
}

function createPowerResource(powerDeltaMw: number): FoxholeRecipeResourceRef {
    return {
        id: FOXHOLE_RECIPE_POWER_RESOURCE_ID,
        channel: 'item',
        quantity: Math.abs(powerDeltaMw),
        limit: null,
        item: null,
        structure: null,
        resolvedName: 'Power',
        resolvedNameLocalizationId: null,
        resolvedIconUrl: null,
        iconName: FOXHOLE_RECIPE_POWER_ICON_NAME,
        quantityUnit: 'mw',
    };
}

function withProducedPowerOutput(
    effectivePowerDelta: number | null,
    inputs: FoxholeRecipeResourceRef[],
    outputs: FoxholeRecipeResourceRef[],
): { inputs: FoxholeRecipeResourceRef[]; outputs: FoxholeRecipeResourceRef[]; } {
    const powerDeltaMw = resolveFoxholePowerDeltaMw(effectivePowerDelta);
    // Only generators/co-gen get a Power output tile. Consumer draw stays in meta.
    if (powerDeltaMw <= 0) {
        return { inputs, outputs };
    }

    if (outputs.some(entry => entry.id === FOXHOLE_RECIPE_POWER_RESOURCE_ID)) {
        return { inputs, outputs };
    }

    return {
        inputs,
        outputs: [...outputs, createPowerResource(powerDeltaMw)],
    };
}

const RECIPE_GROUP_TITLES: Record<FoxholeRecipeGroupViewModel['id'], string> = {
    facility: 'Recipes',
    upgrades: 'Upgrades',
    modifications: 'Modifications',
};

function groupRecipes(recipes: readonly FoxholeRecipeViewModel[]): FoxholeRecipeGroupViewModel[] {
    const order: FoxholeRecipeGroupViewModel['id'][] = ['facility', 'upgrades', 'modifications'];
    return order
        .map(id => ({
            id,
            title: RECIPE_GROUP_TITLES[id],
            recipes: recipes.filter(recipe => recipe.groupId === id),
        }))
        .filter(group => group.recipes.length > 0);
}

export function toFoxholeCostBreakdownEntries(
    resources: readonly FoxholeRecipeResourceRef[],
    localize: (localizationId: string | null | undefined, fallback: string) => string,
): FoxholeCostBreakdownEntry[] {
    return resources.map(resource => ({
        id: `${resource.channel}:${resource.id}`,
        name: resolveFoxholeRecipeResourceLabel(resource, localize),
        quantity: resource.quantity,
        iconUrl: resolveFoxholeRecipeResourceIconUrl(resource),
        item: resource.item,
    }));
}

export function listFoxholeStructuresWithRecipes(options: {
    appBaseUrl?: string;
    baseAssetsUrl?: string;
    productionIndex?: FoxholeProductionIndex | null;
    structureCatalog?: FoxholeStructureCatalog | null;
} = {}): FoxholeStructureRecipeOption[] {
    const baseAssetsUrl = options.baseAssetsUrl
        || createFoxholeAssetsBaseUrl(options.appBaseUrl ?? '/');
    const productionIndex = options.productionIndex ?? getFoxholeProductionIndex(baseAssetsUrl);
    const structureCatalog = options.structureCatalog ?? getFoxholeStructureCatalog(baseAssetsUrl);

    return Object.entries(productionIndex.structureRecipeIdsByStructureId)
        .map(([structureId, recipeIds]) => {
            const structure = structureCatalog.assetByKey[structureId] ?? null;
            return {
                id: structureId,
                name: String(structure?.name ?? formatFallbackLabel(structureId)).trim() || structureId,
                recipeCount: recipeIds.length,
            } satisfies FoxholeStructureRecipeOption;
        })
        .filter(entry => entry.recipeCount > 0)
        .sort((left, right) => {
            const countDelta = right.recipeCount - left.recipeCount;
            if (countDelta !== 0) {
                return countDelta;
            }
            return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
        });
}

function toFoxholeRecipeViewModel(
    recipe: FoxholeProductionRecipe,
    itemCatalog: FoxholeItemCatalog | null | undefined,
    structureCatalog: FoxholeStructureCatalog | null | undefined,
    structurePowerById: Readonly<Record<string, number | null>> = {},
): FoxholeRecipeViewModel {
    const effectivePowerDelta = resolveFoxholeRecipeEffectivePowerDelta(
        recipe,
        structurePowerById[normalizeKey(recipe.sourceStructureId)],
    );
    let outputs = collectRecipeResources(recipe, 'output', itemCatalog, structureCatalog);
    let inputs = withProducerStructureInput(
        recipe,
        collectRecipeResources(recipe, 'input', itemCatalog, structureCatalog),
        outputs,
        structureCatalog,
    );
    ({ inputs, outputs } = withProducedPowerOutput(effectivePowerDelta, inputs, outputs));

    // Power-only recipes (generators) still need a producer structure on the left.
    if (
        inputs.length === 0
        && outputs.some(output => output.id === FOXHOLE_RECIPE_POWER_RESOURCE_ID)
    ) {
        const producer = createProducerStructureInput(recipe, structureCatalog);
        if (producer) {
            inputs = [producer];
        }
    }

    const isBuildCost = isBuildOnlyRecipe(recipe);
    const structureIsWorld = Boolean(
        structureCatalog?.assetByKey?.[recipe.sourceStructureId]?.isWorldStructure
        || structureCatalog?.assetByKey?.[String(recipe.sourceStructureId).toLowerCase()]?.isWorldStructure,
    );
    const title = isBuildCost && structureIsWorld
        ? `Rebuild ${recipe.sourceStructureName || buildRecipeTitle(outputs)}`
        : buildRecipeTitle(outputs);

    return {
        id: recipe.id,
        recipe,
        title,
        subtitle: isBuildCost && structureIsWorld
            ? 'World structure reconstruction'
            : null,
        groupId: resolveRecipeGroupId(recipe),
        durationSeconds: recipe.durationSeconds,
        powerDelta: effectivePowerDelta,
        isBuildCost,
        consumesResourceNodes: recipe.consumesResourceNodes,
        inputs,
        outputs,
    };
}

function hasChannel(
    recipe: FoxholeRecipeViewModel,
    channel: FoxholeProductionChannel,
): boolean {
    return recipe.inputs.some(entry => entry.channel === channel)
        || recipe.outputs.some(entry => entry.channel === channel);
}

function formatShowcaseSourceLabel(recipe: FoxholeRecipeViewModel): string {
    const source = recipe.recipe;
    const parts = [
        source.sourceStructureName.trim() || formatFallbackLabel(source.sourceStructureId),
    ];
    if (source.sourceVariantName?.trim()) {
        parts.push(source.sourceVariantName.trim());
    } else if (source.sourceSlotName?.trim()) {
        parts.push(source.sourceSlotName.trim());
    }
    return parts.join(' · ');
}

function formatShowcasePowerNote(recipe: FoxholeRecipeViewModel): string {
    const source = recipe.recipe;
    const authored = source.powerDelta;
    const effective = recipe.powerDelta;

    if (isBuildOnlyRecipe(source)) {
        return authored != null && authored !== 0
            ? `power ${authored} (build-cost override)`
            : 'power none (build cost; does not inherit facility)';
    }

    if (authored != null && authored !== 0) {
        return `power ${authored} (recipe override)`;
    }

    if (effective != null && effective !== 0) {
        return `power ${effective} (inherited from structure)`;
    }

    const authoredLabel = authored === 0 ? 'authored 0' : 'unset';
    return `power none (recipe ${authoredLabel}; no structure inherit)`;
}

function formatShowcaseSourceDescription(
    description: string,
    recipe: FoxholeRecipeViewModel,
): string {
    const source = recipe.recipe;
    const originParts = [
        `${source.sourceType}:${source.sourceStructureId}`,
        source.sourceSlotId ? `slot ${source.sourceSlotId}` : null,
        source.sourceVariantId ? `variant ${source.sourceVariantId}` : null,
        source.isUpgrade ? 'upgrade' : null,
    ].filter((part): part is string => Boolean(part));

    return [
        description,
        `From ${originParts.join(' · ')}.`,
        `${formatShowcasePowerNote(recipe)}.`,
        `id ${source.id}.`,
    ].join(' ');
}

function withShowcaseProvenance(
    id: string,
    label: string,
    description: string,
    group: string,
    recipe: FoxholeRecipeViewModel,
): FoxholeRecipeShowcaseCase {
    const sourceLabel = formatShowcaseSourceLabel(recipe);
    const normalizedLabel = label.toLowerCase();
    const structureName = recipe.recipe.sourceStructureName.trim().toLowerCase();
    const labelAlreadyHasSource = Boolean(structureName)
        && normalizedLabel.includes(structureName);

    return {
        id,
        label: labelAlreadyHasSource ? label : `${label} · ${sourceLabel}`,
        description: formatShowcaseSourceDescription(description, recipe),
        group,
        recipe,
    };
}

function pickShowcaseCase(
    id: string,
    label: string,
    description: string,
    group: string,
    candidates: readonly FoxholeRecipeViewModel[],
    used: Set<string>,
    predicate: (recipe: FoxholeRecipeViewModel) => boolean,
    compare?: (left: FoxholeRecipeViewModel, right: FoxholeRecipeViewModel) => number,
): FoxholeRecipeShowcaseCase | null {
    const matches = candidates
        .filter(recipe => !used.has(recipe.id) && predicate(recipe))
        .sort(compare ?? ((left, right) => left.id.localeCompare(right.id)));
    const recipe = matches[0];
    if (!recipe) {
        return null;
    }
    used.add(recipe.id);
    return withShowcaseProvenance(id, label, description, group, recipe);
}

function pickShowcaseCases(
    idPrefix: string,
    labelPrefix: string,
    description: string,
    group: string,
    candidates: readonly FoxholeRecipeViewModel[],
    used: Set<string>,
    predicate: (recipe: FoxholeRecipeViewModel) => boolean,
    limit: number,
    compare?: (left: FoxholeRecipeViewModel, right: FoxholeRecipeViewModel) => number,
): FoxholeRecipeShowcaseCase[] {
    const matches = candidates
        .filter(recipe => !used.has(recipe.id) && predicate(recipe))
        .sort(compare ?? ((left, right) => left.id.localeCompare(right.id)))
        .slice(0, Math.max(0, limit));

    return matches.map((recipe, index) => {
        used.add(recipe.id);
        const suffix = matches.length > 1 ? ` ${index + 1}` : '';
        return withShowcaseProvenance(
            `${idPrefix}-${index + 1}`,
            `${labelPrefix}${suffix}`,
            description,
            group,
            recipe,
        );
    });
}

const SHOWCASE_FACILITY_SECTIONS: ReadonlyArray<{
    structureId: string;
    group: string;
    take: number;
    description: string;
}> = [
    {
        structureId: 'refinery',
        group: 'Refinery',
        take: 5,
        description: 'Static world refinery conversions (bmats, rmats, diesel, …).',
    },
    {
        structureId: 'facilityrefinery1',
        group: 'Materials Factory',
        take: 6,
        description: 'Facility materials chains, including multi-output and power draw.',
    },
    {
        structureId: 'facilityrefinery2',
        group: 'Metalworks Factory',
        take: 4,
        description: 'Metalworks conversions and upgrade recipes.',
    },
    {
        structureId: 'facilityrefinerycoal',
        group: 'Coal Refinery',
        take: 3,
        description: 'Coal refining with multi-output / liquid products.',
    },
    {
        structureId: 'facilityrefineryoil',
        group: 'Oil Refinery',
        take: 3,
        description: 'Oil refining conversions.',
    },
    {
        structureId: 'massproduction',
        group: 'Mass Production Factory',
        take: 8,
        description: 'MPF crate production across varied item categories.',
    },
    {
        structureId: 'factory',
        group: 'Factory',
        take: 6,
        description: 'Private factory item crafting.',
    },
    {
        structureId: 'facilitymodificationcenter',
        group: 'Field Modification Center',
        take: 6,
        description: 'Vehicle/structure modification recipes (vehicle codenames on item channel).',
    },
    {
        structureId: 'facilitypoweroil',
        group: 'Power Station',
        take: 4,
        description: 'Power generation — lightning-bolt Power output (and sulfur co-products).',
    },
    {
        structureId: 'facilitypowerdiesel',
        group: 'Diesel Power Plant',
        take: 3,
        description: 'Diesel/coal/petrol generators producing Power.',
    },
    {
        structureId: 'facilitymineoil',
        group: 'Oil Well',
        take: 3,
        description: 'Harvest-style liquid output with producer structure + power draw.',
    },
    {
        structureId: 'facilityfactorysmallarms',
        group: 'Infantry Kit Factory',
        take: 4,
        description: 'Power-hungry small-arms production.',
    },
    {
        structureId: 'facilityfactoryammo',
        group: 'Ammunition Factory',
        take: 3,
        description: 'Ammunition crafting with power draw.',
    },
    {
        structureId: 'facilityfactoryaircraft',
        group: 'Aircraft Maintenance Factory',
        take: 4,
        description: 'Long-named aircraft parts and upgrade conversions.',
    },
    {
        structureId: 'concretemixer',
        group: 'Concrete Mixer',
        take: 2,
        description: 'Simple facility conversion.',
    },
];

/**
 * Build a verbose showcase covering layout edge cases and major production buildings
 * (refinery, MPF, FMC, power plants, materials factories, …).
 */
export function resolveFoxholeRecipeShowcase(options: {
    appBaseUrl?: string;
    baseAssetsUrl?: string;
    itemCatalog?: FoxholeItemCatalog | null;
    structureCatalog?: FoxholeStructureCatalog | null;
    productionIndex?: FoxholeProductionIndex | null;
} = {}): FoxholeRecipeShowcaseCase[] {
    const baseAssetsUrl = options.baseAssetsUrl
        || createFoxholeAssetsBaseUrl(options.appBaseUrl ?? '/');
    const productionIndex = options.productionIndex ?? getFoxholeProductionIndex(baseAssetsUrl);
    const itemCatalog = options.itemCatalog ?? getFoxholeItemCatalog(baseAssetsUrl);
    const structureCatalog = options.structureCatalog ?? getFoxholeStructureCatalog(baseAssetsUrl);
    const structurePowerById = buildStructurePowerDeltaById(baseAssetsUrl);

    const candidates = Object.values(productionIndex.recipeById)
        .filter(recipe => recipe.sourceType === 'structure' || recipe.isUpgrade)
        .map(recipe => toFoxholeRecipeViewModel(recipe, itemCatalog, structureCatalog, structurePowerById))
        .filter(recipe => recipe.outputs.length > 0 || recipe.inputs.length > 0);

    const conversionCandidates = candidates.filter(recipe => !recipe.isBuildCost);
    const buildCostCandidates = candidates.filter(recipe => recipe.isBuildCost);

    const used = new Set<string>();
    const layoutGroup = 'Layout Coverage';
    const buildCostGroup = 'Build Costs';

    const layoutCases = [
        pickShowcaseCase(
            'long-title',
            'Long Product Name',
            'Stresses title truncation in the card header.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => recipe.title.length >= 24,
            (left, right) => right.title.length - left.title.length,
        ),
        pickShowcaseCase(
            'multi-input',
            'Multiple Inputs',
            'Several cost badges on the left side of the arrow.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => recipe.inputs.length >= 3,
            (left, right) => right.inputs.length - left.inputs.length,
        ),
        pickShowcaseCase(
            'multi-output',
            'Multiple Outputs',
            'Comma-joined title with several product badges.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => recipe.outputs.filter(output => output.id !== FOXHOLE_RECIPE_POWER_RESOURCE_ID).length >= 2,
            (left, right) => right.outputs.length - left.outputs.length,
        ),
        pickShowcaseCase(
            'producer-only',
            'Producer Only',
            'No material inputs — producing structure on the left.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => (
                recipe.inputs.length === 1
                && recipe.inputs[0]?.id.startsWith('producer:')
                && recipe.outputs.some(output => output.id !== FOXHOLE_RECIPE_POWER_RESOURCE_ID)
            ),
        ),
        pickShowcaseCase(
            'busy',
            'Busy Recipe',
            'Many resources on both sides of the conversion.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => recipe.inputs.length + recipe.outputs.length >= 5,
            (left, right) => (
                (right.inputs.length + right.outputs.length)
                - (left.inputs.length + left.outputs.length)
            ),
        ),
        pickShowcaseCase(
            'simple',
            'Simple Conversion',
            'One input to one output.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => (
                recipe.inputs.length === 1
                && recipe.outputs.length === 1
                && recipe.outputs[0]?.id !== FOXHOLE_RECIPE_POWER_RESOURCE_ID
            ),
        ),
        pickShowcaseCase(
            'liquid',
            'Liquid Channel',
            'Uses liquid inputs or outputs.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => hasChannel(recipe, 'liquid'),
        ),
        pickShowcaseCase(
            'crate',
            'Crate Channel',
            'Uses crate inputs or outputs.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => hasChannel(recipe, 'crate'),
        ),
        pickShowcaseCase(
            'power-produce',
            'Power Produce',
            'Generator recipe with lightning-bolt Power output.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => (
                (recipe.powerDelta ?? 0) > 0
                && recipe.outputs.some(output => output.id === FOXHOLE_RECIPE_POWER_RESOURCE_ID)
            ),
        ),
        pickShowcaseCase(
            'power-consume',
            'Power Consume',
            'Facility/recipe power draw shown as a meta chip (not an input tile).',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => (
                (recipe.powerDelta ?? 0) < 0
                && recipe.inputs.every(input => input.id !== FOXHOLE_RECIPE_POWER_RESOURCE_ID)
                && recipe.outputs.every(output => output.id !== FOXHOLE_RECIPE_POWER_RESOURCE_ID)
            ),
            (left, right) => {
                // Prefer structure-level draw examples like FMC.
                const leftFmc = left.recipe.sourceStructureId === 'facilitymodificationcenter' ? 1 : 0;
                const rightFmc = right.recipe.sourceStructureId === 'facilitymodificationcenter' ? 1 : 0;
                return rightFmc - leftFmc;
            },
        ),
        pickShowcaseCase(
            'power-coproduct',
            'Power + Product',
            'Produces both a material and Power.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => (
                recipe.outputs.some(output => output.id === FOXHOLE_RECIPE_POWER_RESOURCE_ID)
                && recipe.outputs.some(output => output.id !== FOXHOLE_RECIPE_POWER_RESOURCE_ID)
            ),
        ),
        pickShowcaseCase(
            'resource-nodes',
            'Resource Nodes',
            'Flags recipes that consume resource nodes.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => recipe.consumesResourceNodes,
        ),
        pickShowcaseCase(
            'upgrade',
            'Upgrade Recipe',
            'Upgrade-sourced conversion (product title, not variant name).',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => recipe.groupId === 'upgrades',
            (left, right) => right.title.length - left.title.length,
        ),
        pickShowcaseCase(
            'duration',
            'Long Duration',
            'Higher cycle time in the meta chips.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => (recipe.durationSeconds ?? 0) >= 60,
            (left, right) => (right.durationSeconds ?? 0) - (left.durationSeconds ?? 0),
        ),
        pickShowcaseCase(
            'vehicle-item-channel',
            'Vehicle on Item Channel',
            'FMC-style vehicle codename resolved via structure catalog.',
            layoutGroup,
            conversionCandidates,
            used,
            recipe => (
                recipe.recipe.sourceStructureId === 'facilitymodificationcenter'
                && [...recipe.inputs, ...recipe.outputs].some(entry => (
                    entry.channel === 'item' && entry.structure?.isVehicle === true
                ))
            ),
        ),
    ].filter((entry): entry is FoxholeRecipeShowcaseCase => Boolean(entry));

    const buildCostCases = [
        pickShowcaseCase(
            'build-structure',
            'Structure Build Cost',
            'Construction cost for a structure — cost tiles only, no conversion arrow.',
            buildCostGroup,
            buildCostCandidates,
            used,
            recipe => recipe.outputs.some(output => (
                output.channel === 'build'
                && output.structure != null
                && !output.structure.isVehicle
            )),
            (left, right) => right.inputs.length - left.inputs.length,
        ),
        pickShowcaseCase(
            'build-vehicle',
            'Vehicle Build Cost',
            'Construction cost for a vehicle — cost tiles only, no conversion arrow.',
            buildCostGroup,
            buildCostCandidates,
            used,
            recipe => recipe.outputs.some(output => (
                output.channel === 'build'
                && output.structure?.isVehicle === true
            )),
            (left, right) => right.inputs.length - left.inputs.length,
        ),
        pickShowcaseCase(
            'build-multi-input',
            'Many Material Costs',
            'High material count construction cost (layout stress for cost-only cards).',
            buildCostGroup,
            buildCostCandidates,
            used,
            recipe => recipe.inputs.length >= 4,
            (left, right) => right.inputs.length - left.inputs.length,
        ),
        pickShowcaseCase(
            'build-simple',
            'Simple Build Cost',
            'Single-material construction cost.',
            buildCostGroup,
            buildCostCandidates,
            used,
            recipe => recipe.inputs.length === 1,
        ),
    ].filter((entry): entry is FoxholeRecipeShowcaseCase => Boolean(entry));

    const facilityCases = SHOWCASE_FACILITY_SECTIONS.flatMap(section => {
        const structureName = structureCatalog.assetByKey[section.structureId]?.name
            ?? formatFallbackLabel(section.structureId);
        return pickShowcaseCases(
            section.structureId,
            structureName,
            section.description,
            section.group,
            conversionCandidates,
            used,
            recipe => recipe.recipe.sourceStructureId === section.structureId,
            section.take,
            (left, right) => {
                // Prefer diverse I/O shapes, then longer titles.
                const leftScore = left.inputs.length * 3 + left.outputs.length * 4 + left.title.length * 0.05;
                const rightScore = right.inputs.length * 3 + right.outputs.length * 4 + right.title.length * 0.05;
                if (rightScore !== leftScore) {
                    return rightScore - leftScore;
                }
                return left.id.localeCompare(right.id);
            },
        );
    });

    return [...layoutCases, ...buildCostCases, ...facilityCases];
}

/** Resolve a single production recipe id into a display-ready view model. */
export function resolveFoxholeRecipeViewModel(options: {
    recipeId: string;
    appBaseUrl?: string;
    baseAssetsUrl?: string;
    itemCatalog?: FoxholeItemCatalog | null;
    structureCatalog?: FoxholeStructureCatalog | null;
    productionIndex?: FoxholeProductionIndex | null;
}): FoxholeRecipeViewModel | null {
    const recipeId = String(options.recipeId ?? '').trim();
    if (!recipeId) {
        return null;
    }
    const baseAssetsUrl = options.baseAssetsUrl
        || createFoxholeAssetsBaseUrl(options.appBaseUrl ?? '/');
    const productionIndex = options.productionIndex ?? getFoxholeProductionIndex(baseAssetsUrl);
    const recipe = productionIndex.recipeById[recipeId];
    if (!recipe) {
        return null;
    }
    const structureCatalog = options.structureCatalog ?? getFoxholeStructureCatalog(baseAssetsUrl);
    const itemCatalog = options.itemCatalog ?? getFoxholeItemCatalog(baseAssetsUrl);
    const structurePowerById = buildStructurePowerDeltaById(baseAssetsUrl);
    return toFoxholeRecipeViewModel(recipe, itemCatalog, structureCatalog, structurePowerById);
}

/**
 * Resolve every conversion recipe for a structure (and optionally its mods)
 * into a display-ready view model backed by item catalog metadata.
 */
export function resolveFoxholeStructureRecipes(
    options: ResolveFoxholeStructureRecipesOptions,
): FoxholeStructureRecipesViewModel {
    const structureId = normalizeKey(options.structureId);
    const baseAssetsUrl = options.baseAssetsUrl
        || createFoxholeAssetsBaseUrl(options.appBaseUrl ?? '/');
    const productionIndex = options.productionIndex ?? getFoxholeProductionIndex(baseAssetsUrl);
    const structureCatalog = options.structureCatalog ?? getFoxholeStructureCatalog(baseAssetsUrl);
    const itemCatalog = options.itemCatalog ?? getFoxholeItemCatalog(baseAssetsUrl);
    const structure = structureId
        ? (structureCatalog.assetByKey[structureId] ?? null)
        : null;

    const recipeIds = new Set<string>(productionIndex.structureRecipeIdsByStructureId[structureId] ?? []);

    if (options.includeModifications) {
        const selections = options.modificationSelections;
        const structurePrefix = `${structureId}::`;
        for (const [slotVariantKey, ids] of Object.entries(productionIndex.modificationRecipeIdsBySlotVariantKey)) {
            if (!slotVariantKey.startsWith(structurePrefix)) {
                continue;
            }
            if (selections) {
                const [, slotId = '', variantId = ''] = slotVariantKey.split('::');
                const selectedVariant = normalizeKey(selections[slotId]);
                if (!selectedVariant || selectedVariant !== normalizeKey(variantId)) {
                    continue;
                }
                const expectedKey = createFoxholeProductionSlotVariantKey(structureId, slotId, variantId);
                if (expectedKey !== slotVariantKey) {
                    continue;
                }
            }
            for (const recipeId of ids) {
                recipeIds.add(recipeId);
            }
        }
    }

    const structurePowerById = buildStructurePowerDeltaById(baseAssetsUrl);
    const recipes = [...recipeIds]
        .map(recipeId => productionIndex.recipeById[recipeId])
        .filter((recipe): recipe is FoxholeProductionRecipe => Boolean(recipe))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(recipe => toFoxholeRecipeViewModel(recipe, itemCatalog, structureCatalog, structurePowerById))
        .filter(recipe => {
            if (options.faction !== 'c' && options.faction !== 'w') {
                return true;
            }
            const factions = recipe.outputs
                .map(output => output.item?.faction ?? output.structure?.faction)
                .filter(faction => faction === 'c' || faction === 'w');
            return factions.length === 0 || factions.includes(options.faction);
        });

    return {
        structureId,
        structure,
        recipes,
        groups: groupRecipes(recipes),
    };
}
