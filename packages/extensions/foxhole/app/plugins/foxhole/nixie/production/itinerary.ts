import type { FoxholeItemCatalog, FoxholeStructureCatalog } from '../catalog.ts';
import { getFoxholeItemCatalog, getFoxholeStructureCatalog } from '../catalog.ts';
import { resolveFoxholeCatalogCanonicalKeyFromAlias } from '../catalog-search-aliases.ts';
import {
    createFoxholeProductionCommodityKey,
    getFoxholeProductionIndex,
    parseFoxholeProductionBuildTargetId,
} from './index.ts';
import { planFoxholeProduction } from './planner.ts';
import { resolveFoxholeProductionMachineInstances } from './scene-capability.ts';
import {
    formatFoxholeProductionLeafGatherSummary,
    listFoxholeProductionLeafGatherSources,
} from './leaf-sources.ts';
import { resolveFoxholeProductionCommodityRef } from './commodity-uses.ts';
import { reconcileFoxholeProductionSceneCoverage } from './scene-coverage.ts';
import type {
    FoxholeProductionChannel,
    FoxholeProductionDemand,
    FoxholeProductionIndex,
    FoxholeProductionItineraryAssumptions,
    FoxholeProductionItineraryBoardSummary,
    FoxholeProductionItineraryGoal,
    FoxholeProductionItineraryLeafRequirement,
    FoxholeProductionItineraryPendingChoice,
    FoxholeProductionItineraryProducer,
    FoxholeProductionItineraryResult,
    FoxholeProductionItineraryRouteOption,
    FoxholeProductionItineraryRouteOptionInput,
    FoxholeProductionItineraryRouteRankHint,
    FoxholeProductionItineraryStep,
    FoxholeProductionItineraryStepKind,
    FoxholeProductionOutputCatalogEntry,
    FoxholeProductionPlanNode,
    FoxholeProductionPlanResult,
    FoxholeProductionRecipe,
    FoxholeProductionStructureSnapshotLike,
} from './types.ts';

const PUBLIC_LOGI_EXTERNAL_ITEM_IDS = [
    'Salvage',
    'Components',
    'Sulfur',
    'Coal',
    'Aluminum',
    'Iron',
    'Copper',
    'Cloth',
    'Metal',
] as const;

const PUBLIC_LOGI_EXTERNAL_LIQUID_IDS = [
    'Oil',
    'Water',
    'Petrol',
    'Diesel',
] as const;

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeLookupKey(value: unknown): string {
    return normalizeKey(value).toLowerCase();
}

/** True when `haystack` starts with `needle` as a whole token (not "copper"→"coppera"). */
function lookupKeyStartsWithToken(haystack: string, needle: string): boolean {
    if (!needle || !haystack.startsWith(needle)) {
        return false;
    }
    const next = haystack[needle.length];
    return next === undefined || next === ':' || next === ' ' || next === '-' || next === '_';
}

/**
 * True when `term` appears in `searchText` as its own token (not a substring of a
 * longer word). Prevents acronym queries like "LAS" matching "blast furnace" /
 * "flask" / "plasma".
 */
function searchTextContainsBoundedTerm(searchText: string, term: string): boolean {
    if (!term || !searchText) {
        return false;
    }
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(searchText);
}

function normalizeQuantity(value: unknown): number {
    const normalized = Number(value ?? 0);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

export function parseFoxholeProductionCommodityKey(
    value: string | null | undefined,
): { commodityKey: string; channel: FoxholeProductionChannel; resourceId: string; } | null {
    const normalized = normalizeKey(value);
    if (!normalized) {
        return null;
    }

    const explicitMatch = normalized.match(/^(item|crate|liquid|build):(.*)$/i);
    if (explicitMatch) {
        const channel = explicitMatch[1]!.toLowerCase() as FoxholeProductionChannel;
        const resourceId = normalizeKey(explicitMatch[2]);
        if (!resourceId) {
            return null;
        }
        return {
            channel,
            resourceId,
            commodityKey: createFoxholeProductionCommodityKey(channel, resourceId),
        };
    }

    return {
        channel: 'item',
        resourceId: normalized,
        commodityKey: createFoxholeProductionCommodityKey('item', normalized),
    };
}

function formatFallbackLabel(resourceId: string): string {
    const spaced = resourceId
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
    return spaced || resourceId;
}

function isWorldStructureBuildResource(
    resourceId: string,
    catalogs: FoxholeProductionItineraryCatalogContext,
): boolean {
    return resolveStructureForProductionResource(resourceId, catalogs)?.isWorldStructure === true;
}

export type FoxholeProductionItineraryCatalogContext = {
    itemCatalog?: Pick<FoxholeItemCatalog, 'assets' | 'assetByKey'> | null;
    structureCatalog?: Pick<FoxholeStructureCatalog, 'assets' | 'assetByKey'> | null;
};

function buildItemLookup(
    itemCatalog: FoxholeProductionItineraryCatalogContext['itemCatalog'],
): Map<string, { name: string; searchText: string; }> {
    const lookup = new Map<string, { name: string; searchText: string; }>();
    for (const item of itemCatalog?.assets ?? []) {
        const entry = {
            name: item.name,
            searchText: item.searchText || item.name,
        };
        for (const candidate of [item.foxholeKey, item.resourceKey, item.codeName, item.legacyKey]) {
            const key = normalizeLookupKey(candidate);
            if (!key || lookup.has(key)) {
                continue;
            }
            lookup.set(key, entry);
        }
    }
    return lookup;
}

function resolveStructureForProductionResource(
    resourceId: string,
    catalogs: FoxholeProductionItineraryCatalogContext,
) {
    const buildTarget = parseFoxholeProductionBuildTargetId(resourceId);
    const structureId = buildTarget?.structureId ?? resourceId;
    return catalogs.structureCatalog?.assetByKey?.[structureId]
        ?? catalogs.structureCatalog?.assetByKey?.[structureId.toLowerCase()]
        ?? null;
}

function productionEntryMatchesAliasCanonical(
    entry: FoxholeProductionOutputCatalogEntry,
    canonicalKey: string,
    catalogs: FoxholeProductionItineraryCatalogContext,
): boolean {
    const resourceKey = normalizeLookupKey(entry.resourceId);
    if (resourceKey === canonicalKey) {
        return true;
    }
    // build:vehicle:aircraftbomberw / item:Cloth style ids
    if (resourceKey.endsWith(`:${canonicalKey}`)) {
        return true;
    }
    if (entry.channel === 'build') {
        const buildTarget = parseFoxholeProductionBuildTargetId(entry.resourceId);
        // Acronym aliases should hit the facility itself, not every upgrade row
        // that shares the parent structure id (those are labeled with the parent name).
        if (buildTarget?.kind === 'upgrade' || buildTarget?.kind === 'modification') {
            return false;
        }
        if (buildTarget && normalizeLookupKey(buildTarget.structureId) === canonicalKey) {
            return true;
        }
        const structure = resolveStructureForProductionResource(entry.resourceId, catalogs);
        if (!structure) {
            return false;
        }
        return [structure.foxholeKey, structure.codeName, structure.legacyKey, structure.buildingKey]
            .some(candidate => normalizeLookupKey(candidate) === canonicalKey);
    }
    return false;
}

export function formatFoxholeProductionCommodityBaseLabel(
    commodityKey: string,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
): string {
    const parsed = parseFoxholeProductionCommodityKey(commodityKey);
    if (!parsed) {
        return 'Unknown commodity';
    }

    if (parsed.channel === 'build') {
        const buildTarget = parseFoxholeProductionBuildTargetId(parsed.resourceId);
        const structureId = buildTarget?.structureId ?? parsed.resourceId;
        const structure = catalogs.structureCatalog?.assetByKey?.[structureId]
            ?? catalogs.structureCatalog?.assetByKey?.[structureId.toLowerCase()];
        return structure?.name ?? formatFallbackLabel(structureId);
    }

    const itemLookup = buildItemLookup(catalogs.itemCatalog);
    const item = itemLookup.get(normalizeLookupKey(parsed.resourceId));
    return item?.name ?? formatFallbackLabel(parsed.resourceId);
}

export function formatFoxholeProductionCommodityLabel(
    commodityKey: string,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
): string {
    // Player-facing labels stay as display names only (no channel/codename suffixes).
    // Channel and isWorldStructure are separate fields for tools/UI.
    return formatFoxholeProductionCommodityBaseLabel(commodityKey, catalogs);
}

function recipeProducerLabel(recipe: FoxholeProductionRecipe): string {
    const variantLabel = recipe.sourceVariantName ?? recipe.sourceVariantId ?? recipe.sourceModificationId;
    return variantLabel
        ? `${recipe.sourceStructureName} → ${variantLabel}`
        : recipe.sourceStructureName;
}

function listSampleProducerNames(
    index: FoxholeProductionIndex,
    recipeIds: readonly string[],
    limit = 3,
    outputResourceId?: string,
): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const recipeId of recipeIds) {
        const recipe = index.recipeById[recipeId];
        if (!recipe) {
            continue;
        }
        if (outputResourceId && isFoxholeProductionSelfReferentialRecipe(recipe, outputResourceId)) {
            continue;
        }
        const label = recipeProducerLabel(recipe);
        const key = normalizeLookupKey(label);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        names.push(label);
        if (names.length >= limit) {
            break;
        }
    }
    return names;
}

function aircraftVehicleSearchHints(resourceId: string): string[] {
    const id = normalizeLookupKey(resourceId).replace(/^vehicle:/, '');
    if (id.startsWith('aircraftbomber')) {
        return ['heavy bomber', 'bomber', 'aircraft'];
    }
    if (id.startsWith('aircraftfighter')) {
        return ['fighter', 'aircraft'];
    }
    if (id.startsWith('aircraftscout') || id.startsWith('aircraftdive') || id.startsWith('aircraft')) {
        return ['aircraft'];
    }
    return [];
}

function queryLooksLikeAircraftVehicleAsk(query: string): boolean {
    return /\b(bomber|fighter|aircraft|plane|planes)\b/i.test(query);
}

function isAircraftVehicleOutput(entry: Pick<FoxholeProductionOutputCatalogEntry, 'channel' | 'resourceId'>): boolean {
    return entry.channel === 'build'
        && /^vehicle:aircraft(?!crate)/i.test(String(entry.resourceId ?? ''));
}

function isAircraftNoiseOutput(entry: Pick<FoxholeProductionOutputCatalogEntry, 'commodityKey' | 'resourceId' | 'label'>): boolean {
    const haystack = `${entry.commodityKey} ${entry.resourceId} ${entry.label}`.toLowerCase();
    return /aircraftpart|aircraftammo|aaammo|lightaaammo|emplacedaircraft|radioaircraft|wrecked|facilityfactoryaircraft|aircraft maintenance/
        .test(haystack);
}

function isAircraftSupportOutput(entry: Pick<FoxholeProductionOutputCatalogEntry, 'commodityKey' | 'resourceId' | 'label'>): boolean {
    const haystack = `${entry.commodityKey} ${entry.resourceId} ${entry.label}`.toLowerCase();
    return /aircraftcrate|aircraftdepot|aircraftfactory|aircraftrunway|facilityfactoryaircraft|aircraft hangar|aircraft depot|aircraft maintenance|aircraft runway|large assembly|aircraftassembly/
        .test(haystack);
}

/** Build-cost recipes often list the vehicle as its own “source structure”. */
export function isFoxholeProductionSelfReferentialRecipe(
    recipe: { sourceStructureId?: string | null; } | null | undefined,
    resourceId: string,
): boolean {
    const sourceId = String(recipe?.sourceStructureId ?? '').trim().toLowerCase();
    if (!sourceId) {
        return false;
    }
    const outputId = String(resourceId ?? '')
        .trim()
        .toLowerCase()
        .replace(/^(?:structure|vehicle):/, '');
    return Boolean(outputId) && sourceId === outputId;
}

export function listFoxholeProductionOutputs(
    index: FoxholeProductionIndex,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
): FoxholeProductionOutputCatalogEntry[] {
    const itemLookup = buildItemLookup(catalogs.itemCatalog);
    const entries: FoxholeProductionOutputCatalogEntry[] = [];

    for (const [commodityKey, recipeIds] of Object.entries(index.recipeIdsByOutput)) {
        const parsed = parseFoxholeProductionCommodityKey(commodityKey);
        if (!parsed || !recipeIds.length) {
            continue;
        }

        const label = formatFoxholeProductionCommodityLabel(commodityKey, catalogs);
        const item = parsed.channel === 'build'
            ? null
            : itemLookup.get(normalizeLookupKey(parsed.resourceId)) ?? null;
        const structure = parsed.channel === 'build'
            ? resolveStructureForProductionResource(parsed.resourceId, catalogs)
            : null;
        const searchText = [
            label,
            commodityKey,
            parsed.resourceId,
            item?.searchText ?? '',
            structure?.searchText ?? '',
            ...(structure?.aliases ?? []),
            ...aircraftVehicleSearchHints(parsed.resourceId),
            ...listSampleProducerNames(index, recipeIds, 6, parsed.resourceId),
        ].join(' ').toLowerCase();

        entries.push({
            commodityKey: parsed.commodityKey,
            channel: parsed.channel,
            resourceId: parsed.resourceId,
            label,
            searchText,
            producerCount: recipeIds.length,
            sampleProducerNames: listSampleProducerNames(index, recipeIds, 3, parsed.resourceId),
            ...(parsed.channel === 'build' && structure?.isWorldStructure === true
                ? { isWorldStructure: true }
                : {}),
        });
    }

    return entries.sort((left, right) => left.label.localeCompare(right.label, undefined, {
        sensitivity: 'base',
    }));
}

/** Items present in the asset catalog but absent from recipe outputs (e.g. Hammer). */
function listFoxholeCatalogOnlyObtainOutputs(
    index: FoxholeProductionIndex,
    catalogs: FoxholeProductionItineraryCatalogContext,
    producedResourceKeys: ReadonlySet<string>,
): FoxholeProductionOutputCatalogEntry[] {
    const assets = catalogs.itemCatalog?.assets;
    if (!assets?.length) {
        return [];
    }
    const out: FoxholeProductionOutputCatalogEntry[] = [];
    for (const asset of assets) {
        const resourceId = normalizeKey(asset.codeName) || normalizeKey(asset.foxholeKey);
        if (!resourceId) {
            continue;
        }
        const resourceKey = normalizeLookupKey(resourceId);
        if (!resourceKey || producedResourceKeys.has(resourceKey)) {
            continue;
        }
        const itemKey = createFoxholeProductionCommodityKey('item', resourceId);
        const crateKey = createFoxholeProductionCommodityKey('crate', resourceId);
        if ((index.recipeIdsByOutput[itemKey]?.length ?? 0) > 0
            || (index.recipeIdsByOutput[crateKey]?.length ?? 0) > 0) {
            continue;
        }
        const label = normalizeKey(asset.name) || resourceId;
        out.push({
            commodityKey: itemKey,
            channel: 'item',
            resourceId,
            label,
            searchText: [
                label,
                itemKey,
                resourceId,
                asset.searchText ?? '',
                ...(asset.aliases ?? []),
            ].join(' ').toLowerCase(),
            producerCount: 0,
            sampleProducerNames: [],
        });
    }
    return out;
}

export function searchFoxholeProductionOutputs(
    query: string,
    index: FoxholeProductionIndex,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
    limit = 25,
): FoxholeProductionOutputCatalogEntry[] {
    const rawQuery = normalizeKey(query);
    const normalizedQuery = normalizeLookupKey(rawQuery);
    const productionEntries = listFoxholeProductionOutputs(index, catalogs);
    const producedResourceKeys = new Set(
        productionEntries.map(entry => normalizeLookupKey(entry.resourceId)),
    );
    const entries = [
        ...productionEntries,
        ...listFoxholeCatalogOnlyObtainOutputs(index, catalogs, producedResourceKeys),
    ];
    if (!normalizedQuery) {
        return entries.slice(0, Math.max(0, limit));
    }

    const aliasCanonicalKey = resolveFoxholeCatalogCanonicalKeyFromAlias(query);
    const wantsAircraftVehicle = queryLooksLikeAircraftVehicleAsk(rawQuery);
    const wantsBigAircraft = /\b(big|heavy|bomber)\b/i.test(rawQuery);
    const queryTokens = normalizedQuery
        .split(/[^a-z0-9]+/)
        .map(token => token.trim())
        .filter(token => token.length >= 3);

    const scored = entries
        .map(entry => {
            const key = normalizeLookupKey(entry.commodityKey);
            const resource = normalizeLookupKey(entry.resourceId);
            const label = normalizeLookupKey(entry.label);
            let score = 0;
            if (aliasCanonicalKey) {
                // Exact community aliases/acronyms (LAS, MPF, bmats) must not fall
                // through to weak substring matches — short aliases are also folded
                // into structure searchText and would otherwise hit every related row.
                if (!productionEntryMatchesAliasCanonical(entry, aliasCanonicalKey, catalogs)) {
                    return null;
                }
                score = 100;
            } else if (key === normalizedQuery || resource === normalizedQuery) {
                score = 100;
            } else if (label === normalizedQuery) {
                score = 95;
            } else if (
                lookupKeyStartsWithToken(key, normalizedQuery)
                || lookupKeyStartsWithToken(resource, normalizedQuery)
            ) {
                score = 80;
            } else if (lookupKeyStartsWithToken(label, normalizedQuery)) {
                score = 70;
            } else if (searchTextContainsBoundedTerm(entry.searchText, normalizedQuery)) {
                score = 40;
            } else if (queryTokens.length > 1) {
                let tokenHits = 0;
                for (const token of queryTokens) {
                    if (
                        searchTextContainsBoundedTerm(entry.searchText, token)
                        || searchTextContainsBoundedTerm(label, token)
                        || lookupKeyStartsWithToken(resource, token)
                        || lookupKeyStartsWithToken(key, token)
                        || (token.length >= 4 && (
                            resource.includes(token)
                            || key.includes(token)
                        ))
                    ) {
                        tokenHits += 1;
                    }
                }
                if (tokenHits === 0) {
                    return null;
                }
                score = 15 + (tokenHits * 18);
            } else {
                return null;
            }

            if (wantsAircraftVehicle) {
                if (isAircraftVehicleOutput(entry)) {
                    score += wantsBigAircraft && /aircraftbomber/i.test(entry.resourceId)
                        ? 55
                        : 35;
                } else if (isAircraftNoiseOutput(entry)) {
                    score -= 80;
                } else if (isAircraftSupportOutput(entry)) {
                    score -= 45;
                }
            }

            return { entry, score };
        })
        .filter((row): row is { entry: FoxholeProductionOutputCatalogEntry; score: number; } => row !== null)
        .sort((left, right) => right.score - left.score || left.entry.label.localeCompare(right.entry.label));

    if (wantsAircraftVehicle) {
        const vehicles = scored.filter(row => isAircraftVehicleOutput(row.entry));
        const wantsSupportSites = /\b(part|parts|hangar|depot|maintenance|assembly|airfield|where)\b/i.test(rawQuery);
        // Default aircraft/plane searches should list flyable vehicles — not ammo, AA, or part factories.
        if (vehicles.length >= 3 && !wantsSupportSites) {
            return vehicles.slice(0, Math.max(0, limit)).map(row => row.entry);
        }
    }

    return scored.slice(0, Math.max(0, limit)).map(row => row.entry);
}

export function resolveFoxholeProductionOutputRef(
    query: string,
    index: FoxholeProductionIndex,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
): FoxholeProductionOutputCatalogEntry | null {
    const parsed = parseFoxholeProductionCommodityKey(query);
    if (parsed && /^(item|crate|liquid|build):/i.test(String(query ?? '').trim())) {
        const recipeIds = index.recipeIdsByOutput[parsed.commodityKey] ?? [];
        const isWorldStructure = parsed.channel === 'build'
            && isWorldStructureBuildResource(parsed.resourceId, catalogs);
        return {
            commodityKey: parsed.commodityKey,
            channel: parsed.channel,
            resourceId: parsed.resourceId,
            label: formatFoxholeProductionCommodityLabel(parsed.commodityKey, catalogs),
            searchText: parsed.commodityKey.toLowerCase(),
            producerCount: recipeIds.length,
            sampleProducerNames: listSampleProducerNames(index, recipeIds),
            ...(isWorldStructure ? { isWorldStructure: true } : {}),
        };
    }

    // Prefer exact resource / display-name hits (e.g. "copper" → Copper, not CopperA).
    const exactCommodity = resolveFoxholeProductionCommodityRef(query, index, catalogs);
    if (exactCommodity) {
        const recipeIds = index.recipeIdsByOutput[exactCommodity.commodityKey] ?? [];
        const isWorldStructure = exactCommodity.channel === 'build'
            && isWorldStructureBuildResource(exactCommodity.resourceId, catalogs);
        return {
            commodityKey: exactCommodity.commodityKey,
            channel: exactCommodity.channel,
            resourceId: exactCommodity.resourceId,
            label: exactCommodity.label,
            searchText: exactCommodity.commodityKey.toLowerCase(),
            producerCount: recipeIds.length,
            sampleProducerNames: listSampleProducerNames(index, recipeIds),
            ...(isWorldStructure ? { isWorldStructure: true } : {}),
        };
    }

    const aliasCanonicalKey = resolveFoxholeCatalogCanonicalKeyFromAlias(query);
    if (aliasCanonicalKey) {
        const aliasHit = listFoxholeProductionOutputs(index, catalogs)
            .find(entry => productionEntryMatchesAliasCanonical(entry, aliasCanonicalKey, catalogs));
        if (aliasHit) {
            return aliasHit;
        }
    }

    return searchFoxholeProductionOutputs(query, index, catalogs, 1)[0] ?? null;
}

function stepKindForNode(
    node: FoxholeProductionPlanNode,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
): FoxholeProductionItineraryStepKind {
    switch (node.source) {
        case 'ambiguous':
            return 'choose';
        case 'missing':
            if (listFoxholeProductionLeafGatherSources(node.commodityKey, catalogs.structureCatalog).length > 0) {
                return 'obtain';
            }
            return 'blocked';
        case 'cycle':
            return 'blocked';
        case 'recipe':
            return node.channel === 'build' ? 'build' : 'produce';
        case 'external':
        case 'stock':
        default:
            return 'obtain';
    }
}

function formatQuantity(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    if (Number.isInteger(value)) {
        return String(value);
    }
    return value.toFixed(2).replace(/\.?0+$/, '');
}

/** Player-facing amount token, e.g. x1 / x250. */
function formatAmount(value: number): string {
    return `x${formatQuantity(value)}`;
}

function formatRouteInputPhrase(
    inputs: readonly FoxholeProductionItineraryRouteOptionInput[],
): string {
    return inputs
        .map(input => `${input.label} ${formatAmount(input.quantity)}`)
        .join(' + ');
}

function disambiguateRouteOptionLabels(
    drafts: Array<Omit<FoxholeProductionItineraryRouteOption, 'score' | 'rankHints'>>,
): void {
    const countByStructure = new Map<string, number>();
    for (const draft of drafts) {
        const key = draft.structureId || draft.label;
        countByStructure.set(key, (countByStructure.get(key) ?? 0) + 1);
    }
    for (const draft of drafts) {
        const key = draft.structureId || draft.label;
        if ((countByStructure.get(key) ?? 0) < 2 || draft.inputSummary.length === 0) {
            continue;
        }
        draft.label = `${draft.structureName || draft.label} · ${formatRouteInputPhrase(draft.inputSummary)}`;
    }
}

function isWorldStructureId(
    structureId: string,
    catalogs: FoxholeProductionItineraryCatalogContext,
): boolean {
    const normalized = normalizeKey(structureId);
    if (!normalized) {
        return false;
    }
    const asset = catalogs.structureCatalog?.assetByKey?.[normalized]
        ?? catalogs.structureCatalog?.assetByKey?.[normalized.toLowerCase()];
    return asset?.isWorldStructure === true;
}

function listRecipeInputs(
    recipe: FoxholeProductionRecipe,
    runCount: number,
): Array<{ commodityKey: string; channel: FoxholeProductionChannel; resourceId: string; quantity: number; }> {
    const entries: Array<{ commodityKey: string; channel: FoxholeProductionChannel; resourceId: string; quantity: number; }> = [];
    const maps = [
        ['item', recipe.itemInput],
        ['crate', recipe.crateInput],
        ['liquid', recipe.liquidInput],
    ] as const;
    for (const [channel, resourceMap] of maps) {
        for (const [resourceId, resource] of Object.entries(resourceMap ?? {})) {
            const quantity = normalizeQuantity(resource?.quantity) * runCount;
            if (quantity <= 0) {
                continue;
            }
            const normalizedResourceId = normalizeKey(resourceId);
            entries.push({
                channel,
                resourceId: normalizedResourceId,
                commodityKey: createFoxholeProductionCommodityKey(channel, normalizedResourceId),
                quantity,
            });
        }
    }
    return entries;
}

function getRecipeOutputQuantityForCommodity(recipe: FoxholeProductionRecipe, commodityKey: string): number {
    const maps = [
        ['item', recipe.itemOutput],
        ['crate', recipe.crateOutput],
        ['liquid', recipe.liquidOutput],
        ['build', recipe.buildOutput],
    ] as const;
    for (const [channel, resourceMap] of maps) {
        for (const [resourceId, resource] of Object.entries(resourceMap ?? {})) {
            const key = createFoxholeProductionCommodityKey(channel, normalizeKey(resourceId));
            if (key === commodityKey) {
                return normalizeQuantity(resource?.quantity);
            }
        }
    }
    return 0;
}

function getRequiredRunCount(outputQuantity: number, requestedQuantity: number): number {
    if (outputQuantity <= 0 || requestedQuantity <= 0) {
        return 0;
    }
    return Math.max(1, Math.ceil(requestedQuantity / outputQuantity));
}

function compareRouteOptions(
    left: FoxholeProductionItineraryRouteOption,
    right: FoxholeProductionItineraryRouteOption,
): number {
    if (left.isWorldStructure !== right.isWorldStructure) {
        return left.isWorldStructure ? -1 : 1;
    }
    const leftInputs = left.inputSummary.length;
    const rightInputs = right.inputSummary.length;
    if (leftInputs !== rightInputs) {
        return leftInputs - rightInputs;
    }
    const leftDuration = left.durationSeconds ?? Number.POSITIVE_INFINITY;
    const rightDuration = right.durationSeconds ?? Number.POSITIVE_INFINITY;
    if (leftDuration !== rightDuration) {
        return leftDuration - rightDuration;
    }
    const leftPower = Math.abs(left.powerDelta ?? 0);
    const rightPower = Math.abs(right.powerDelta ?? 0);
    if (leftPower !== rightPower) {
        return leftPower - rightPower;
    }
    return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
}

function scoreRouteOption(
    option: Omit<FoxholeProductionItineraryRouteOption, 'score' | 'rankHints'>,
    cohort: readonly Omit<FoxholeProductionItineraryRouteOption, 'score' | 'rankHints'>[],
): { score: number; rankHints: FoxholeProductionItineraryRouteRankHint[]; } {
    const rankHints: FoxholeProductionItineraryRouteRankHint[] = [];
    let score = 0;
    if (option.isWorldStructure) {
        score += 1000;
        rankHints.push('worldStructure');
    }
    const minInputs = Math.min(...cohort.map(entry => entry.inputSummary.length));
    if (option.inputSummary.length === minInputs) {
        score += 100;
        rankHints.push('fewerInputs');
    }
    const finiteDurations = cohort
        .map(entry => entry.durationSeconds)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (
        option.durationSeconds != null
        && finiteDurations.length > 0
        && option.durationSeconds === Math.min(...finiteDurations)
    ) {
        score += 10;
        rankHints.push('faster');
    }
    const powers = cohort.map(entry => Math.abs(entry.powerDelta ?? 0));
    const minPower = Math.min(...powers);
    if (Math.abs(option.powerDelta ?? 0) === minPower) {
        score += 1;
        rankHints.push('lowerPower');
    }
    return { score, rankHints };
}

export function buildFoxholeProductionItineraryRouteOptions(
    index: FoxholeProductionIndex,
    commodityKey: string,
    requestedQuantity: number,
    candidateRecipeIds: readonly string[],
    catalogs: FoxholeProductionItineraryCatalogContext = {},
): FoxholeProductionItineraryRouteOption[] {
    const quantity = normalizeQuantity(requestedQuantity) || 1;
    const drafts: Array<Omit<FoxholeProductionItineraryRouteOption, 'score' | 'rankHints'>> = [];

    for (const recipeId of candidateRecipeIds) {
        const recipe = index.recipeById[recipeId];
        if (!recipe) {
            continue;
        }
        const outputQuantity = getRecipeOutputQuantityForCommodity(recipe, commodityKey);
        const runCount = getRequiredRunCount(outputQuantity, quantity) || 1;
        const inputs = listRecipeInputs(recipe, runCount);
        const inputSummary: FoxholeProductionItineraryRouteOptionInput[] = inputs.map(input => ({
            commodityKey: input.commodityKey,
            label: formatFoxholeProductionCommodityLabel(input.commodityKey, catalogs),
            quantity: input.quantity,
        }));
        drafts.push({
            recipeId,
            label: recipeProducerLabel(recipe),
            structureId: recipe.sourceStructureId,
            structureName: recipe.sourceStructureName,
            isWorldStructure: isWorldStructureId(recipe.sourceStructureId, catalogs),
            runCount,
            durationSeconds: recipe.durationSeconds == null
                ? null
                : recipe.durationSeconds * runCount,
            powerDelta: recipe.powerDelta,
            inputSummary,
        });
    }

    disambiguateRouteOptionLabels(drafts);

    const ranked = drafts
        .map(draft => {
            const { score, rankHints } = scoreRouteOption(draft, drafts);
            return { ...draft, score, rankHints };
        })
        .sort(compareRouteOptions);

    return ranked;
}

function buildStepFromNode(
    node: FoxholeProductionPlanNode,
    index: FoxholeProductionIndex,
    catalogs: FoxholeProductionItineraryCatalogContext,
    stepIndex: number,
    assumptions: FoxholeProductionItineraryAssumptions = 'full',
): FoxholeProductionItineraryStep {
    const recipe = node.recipeId ? index.recipeById[node.recipeId] ?? null : null;
    const kind = stepKindForNode(node, catalogs);
    const label = formatFoxholeProductionCommodityLabel(node.commodityKey, catalogs);
    const baseLabel = formatFoxholeProductionCommodityBaseLabel(node.commodityKey, catalogs);
    const quantity = node.requestedQuantity;
    const runCount = node.recipeRunCount;
    const structureName = recipe ? recipeProducerLabel(recipe) : null;
    const isWorldStructure = node.channel === 'build'
        && isWorldStructureBuildResource(node.resourceId, catalogs);
    const options = kind === 'choose'
        ? filterFoxholeProductionRouteOptionsForAssumptions(
            buildFoxholeProductionItineraryRouteOptions(
                index,
                node.commodityKey,
                node.requestedQuantity,
                node.candidateRecipeIds,
                catalogs,
            ),
            assumptions,
        )
        : [];

    let title = label;
    let summary = '';

    switch (kind) {
        case 'produce':
            title = `Produce ${formatAmount(quantity)} ${label}`;
            summary = runCount != null
                ? `Run ${formatAmount(runCount)} on ${structureName ?? 'facility'}`
                : `Produce using ${structureName ?? 'facility'}`;
            break;
        case 'build':
            if (isWorldStructure) {
                title = `Rebuild ${baseLabel}`;
                summary = [
                    `World structure — reconstruct a destroyed ${baseLabel} at its fixed map location`,
                    'with a Construction Vehicle.',
                    'Nearby Town Base needs the Industry upgrade.',
                    `Players cannot place a new ${baseLabel}.`,
                ].join(' ');
            } else {
                title = `Build ${baseLabel}`;
                summary = structureName
                    ? `Construction path via ${structureName}`
                    : 'Construction / upgrade path';
            }
            break;
        case 'obtain':
            title = `Obtain ${formatAmount(quantity)} ${label}`;
            if (node.source === 'stock') {
                summary = 'Use on-hand / stocked supply';
            } else if (node.source === 'external' || node.source === 'missing') {
                summary = formatFoxholeProductionLeafGatherSummary(
                    node.commodityKey,
                    catalogs.structureCatalog,
                ) ?? (node.source === 'external'
                    ? 'Treat as externally supplied'
                    : 'Bring this input into the chain');
            } else {
                summary = formatFoxholeProductionLeafGatherSummary(
                    node.commodityKey,
                    catalogs.structureCatalog,
                ) ?? 'Bring this input into the chain';
            }
            break;
        case 'choose': {
            title = `Choose route for ${label}`;
            const top = options[0];
            summary = top
                ? `${options.length} options — top pick: ${top.label}`
                : `${node.candidateRecipeIds.length} producer options — pick a preferred recipe`;
            break;
        }
        case 'blocked':
            title = `Blocked: ${label}`;
            summary = node.source === 'cycle'
                ? 'Dependency cycle detected'
                : `Missing ${formatAmount(quantity - node.satisfiedQuantity)}`;
            break;
    }

    return {
        id: `step:${stepIndex}:${node.commodityKey}:${node.source}`,
        kind,
        title,
        summary,
        commodityKey: node.commodityKey,
        channel: node.channel,
        resourceId: node.resourceId,
        recipeId: node.recipeId,
        structureId: recipe?.sourceStructureId ?? null,
        structureName,
        ...(kind === 'build' && isWorldStructure ? { isWorldStructure: true } : {}),
        quantity,
        runCount,
        durationSeconds: recipe?.durationSeconds ?? null,
        candidateRecipeIds: options.length > 0
            ? options.map(option => option.recipeId)
            : [...node.candidateRecipeIds],
        options,
    };
}

/** Project plan tree into leaves-first itinerary steps. */
export function projectFoxholeProductionItinerarySteps(
    plan: FoxholeProductionPlanResult,
    index: FoxholeProductionIndex,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
    assumptions: FoxholeProductionItineraryAssumptions = 'full',
): FoxholeProductionItineraryStep[] {
    const steps: FoxholeProductionItineraryStep[] = [];
    let stepIndex = 0;

    const visit = (node: FoxholeProductionPlanNode): void => {
        for (const child of node.children) {
            visit(child);
        }
        steps.push(buildStepFromNode(node, index, catalogs, stepIndex++, assumptions));
    };

    for (const root of plan.demandNodes) {
        visit(root);
    }

    return steps;
}

export function collectFoxholeProductionItineraryPendingChoices(
    plan: FoxholeProductionPlanResult,
    index: FoxholeProductionIndex,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
    assumptions: FoxholeProductionItineraryAssumptions = 'full',
): FoxholeProductionItineraryPendingChoice[] {
    const byKey = new Map<string, FoxholeProductionItineraryPendingChoice>();

    const visit = (node: FoxholeProductionPlanNode): void => {
        for (const child of node.children) {
            visit(child);
        }
        if (node.source !== 'ambiguous' || node.candidateRecipeIds.length < 2) {
            return;
        }
        if (byKey.has(node.commodityKey)) {
            return;
        }
        const options = filterFoxholeProductionRouteOptionsForAssumptions(
            buildFoxholeProductionItineraryRouteOptions(
                index,
                node.commodityKey,
                node.requestedQuantity,
                node.candidateRecipeIds,
                catalogs,
            ),
            assumptions,
        );
        if (options.length < 2) {
            return;
        }
        byKey.set(node.commodityKey, {
            commodityKey: node.commodityKey,
            channel: node.channel,
            resourceId: node.resourceId,
            label: formatFoxholeProductionCommodityLabel(node.commodityKey, catalogs),
            requestedQuantity: node.requestedQuantity,
            options,
        });
    };

    for (const root of plan.demandNodes) {
        visit(root);
    }

    return Array.from(byKey.values());
}

export function collectFoxholeProductionItineraryLeafRequirements(
    plan: FoxholeProductionPlanResult,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
): FoxholeProductionItineraryLeafRequirement[] {
    const byKey = new Map<string, FoxholeProductionItineraryLeafRequirement>();

    const visit = (node: FoxholeProductionPlanNode): void => {
        for (const child of node.children) {
            visit(child);
        }

        if (node.source !== 'external' && node.source !== 'stock' && node.source !== 'missing') {
            return;
        }

        const quantity = node.source === 'missing'
            ? Math.max(0, node.requestedQuantity - node.satisfiedQuantity)
            : Math.max(node.consumedFromExternal, node.consumedFromStock, node.requestedQuantity);
        if (quantity <= 0) {
            return;
        }

        const existing = byKey.get(node.commodityKey);
        if (existing) {
            existing.quantity += quantity;
            return;
        }

        const gatherSources = listFoxholeProductionLeafGatherSources(
            node.commodityKey,
            catalogs.structureCatalog,
        );
        const leafSource = gatherSources.length > 0 && node.source === 'missing'
            ? 'external'
            : node.source;
        byKey.set(node.commodityKey, {
            commodityKey: node.commodityKey,
            channel: node.channel,
            resourceId: node.resourceId,
            label: formatFoxholeProductionCommodityLabel(node.commodityKey, catalogs),
            quantity,
            source: leafSource,
            ...(gatherSources.length > 0 ? { gatherSources } : {}),
        });
    };

    for (const root of plan.demandNodes) {
        visit(root);
    }

    return Array.from(byKey.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function collectProducers(
    plan: FoxholeProductionPlanResult,
    index: FoxholeProductionIndex,
): FoxholeProductionItineraryProducer[] {
    return plan.machineRuns.map(run => {
        const recipe = index.recipeById[run.recipeId];
        const structureName = recipe?.sourceStructureName ?? run.recipeId;
        const label = recipe ? recipeProducerLabel(recipe) : run.recipeId;
        return {
            recipeId: run.recipeId,
            structureId: recipe?.sourceStructureId ?? '',
            structureName,
            runCount: run.runCount,
            durationSeconds: recipe?.durationSeconds ?? null,
            label,
        };
    });
}

function buildBoardSummary(
    plan: FoxholeProductionPlanResult,
    index: FoxholeProductionIndex,
    sceneSnapshots: readonly FoxholeProductionStructureSnapshotLike[],
): FoxholeProductionItineraryBoardSummary {
    const machines = resolveFoxholeProductionMachineInstances(index, sceneSnapshots);
    const coverage = reconcileFoxholeProductionSceneCoverage(index, plan, machines);
    return {
        coveredRequirementCount: coverage.coveredRequirementCount,
        upgradeableRequirementCount: coverage.upgradeableRequirementCount,
        uncoveredRequirementCount: coverage.uncoveredRequirementCount,
        rows: coverage.executionRows.map(row => ({
            id: row.id,
            structureId: row.sourceStructureId,
            structureName: row.sourceStructureName,
            status: row.status,
            requiredRunCount: row.requiredRunCount,
            matchedMachineCount: row.matchedMachineCount,
        })),
    };
}

export type FoxholeProductionItineraryQueryRequest = {
    demand: FoxholeProductionDemand;
    index?: FoxholeProductionIndex;
    baseAssetsUrl?: string;
    itemCatalog?: FoxholeItemCatalog | null;
    structureCatalog?: FoxholeStructureCatalog | null;
    /** Default `'full'` — expand everything and stall on ties. */
    assumptions?: FoxholeProductionItineraryAssumptions;
    preferredRecipeIdByOutput?: Record<string, string>;
    externalSupplyByCommodityKey?: Record<string, number | 'unbounded'>;
    includeParentBuildCosts?: boolean;
    sceneSnapshots?: readonly FoxholeProductionStructureSnapshotLike[];
};

export function buildPublicLogiPreferredRecipes(
    index: FoxholeProductionIndex,
    catalogs: FoxholeProductionItineraryCatalogContext = {},
): Record<string, string> {
    const preferred: Record<string, string> = {};
    for (const [commodityKey, recipeIds] of Object.entries(index.recipeIdsByOutput)) {
        if (!recipeIds || recipeIds.length < 2) {
            continue;
        }
        const options = buildFoxholeProductionItineraryRouteOptions(
            index,
            commodityKey,
            1,
            recipeIds,
            catalogs,
        );
        const worldOptions = options.filter(option => option.isWorldStructure);
        // Only auto-pick when a single world route exists (e.g. world Refinery vs facility).
        // Multiple world recipes (Refinery gravel from Coal vs Salvage) must stay choosable.
        if (worldOptions.length === 1) {
            preferred[commodityKey] = worldOptions[0]!.recipeId;
        }
    }
    return preferred;
}

/** Under public_logi, drop facility routes when any world-structure route exists. */
export function filterFoxholeProductionRouteOptionsForAssumptions(
    options: readonly FoxholeProductionItineraryRouteOption[],
    assumptions: FoxholeProductionItineraryAssumptions,
): FoxholeProductionItineraryRouteOption[] {
    if (assumptions !== 'public_logi' || options.length < 2) {
        return [...options];
    }
    const worldOptions = options.filter(option => option.isWorldStructure);
    return worldOptions.length > 0 ? worldOptions : [...options];
}

export function buildPublicLogiExternalSupply(
    goalCommodityKey: string,
): Record<string, number | 'unbounded'> {
    const supply: Record<string, number | 'unbounded'> = {};
    for (const resourceId of PUBLIC_LOGI_EXTERNAL_ITEM_IDS) {
        const key = createFoxholeProductionCommodityKey('item', resourceId);
        if (key !== goalCommodityKey) {
            supply[key] = 'unbounded';
        }
    }
    for (const resourceId of PUBLIC_LOGI_EXTERNAL_LIQUID_IDS) {
        const key = createFoxholeProductionCommodityKey('liquid', resourceId);
        if (key !== goalCommodityKey) {
            supply[key] = 'unbounded';
        }
    }
    return supply;
}

function resolveItineraryAssumptions(
    assumptions: FoxholeProductionItineraryAssumptions | undefined,
): FoxholeProductionItineraryAssumptions {
    return assumptions === 'public_logi' ? 'public_logi' : 'full';
}

export function queryFoxholeProductionItinerary(
    request: FoxholeProductionItineraryQueryRequest,
): FoxholeProductionItineraryResult {
    const baseAssetsUrl = normalizeKey(request.baseAssetsUrl) || '/foxhole/assets/';
    const index = request.index ?? getFoxholeProductionIndex(baseAssetsUrl);
    const catalogs: FoxholeProductionItineraryCatalogContext = {
        itemCatalog: request.itemCatalog ?? (request.index ? null : getFoxholeItemCatalog(baseAssetsUrl)),
        structureCatalog: request.structureCatalog ?? (request.index ? null : getFoxholeStructureCatalog(baseAssetsUrl)),
    };
    const assumptions = resolveItineraryAssumptions(request.assumptions);

    const channel = request.demand.channel;
    const resourceId = normalizeKey(request.demand.resourceId);
    const quantity = normalizeQuantity(request.demand.quantity);
    const commodityKey = createFoxholeProductionCommodityKey(channel, resourceId);

    const isWorldStructureGoal = channel === 'build'
        && isWorldStructureBuildResource(resourceId, catalogs);
    const goal: FoxholeProductionItineraryGoal = {
        commodityKey,
        channel,
        resourceId,
        label: formatFoxholeProductionCommodityLabel(commodityKey, catalogs),
        quantity,
        ...(isWorldStructureGoal ? { isWorldStructure: true } : {}),
    };

    const preferredRecipeIdByOutput = assumptions === 'public_logi'
        ? {
            ...buildPublicLogiPreferredRecipes(index, catalogs),
            ...(request.preferredRecipeIdByOutput ?? {}),
        }
        : { ...(request.preferredRecipeIdByOutput ?? {}) };

    const externalSupplyByCommodityKey = assumptions === 'public_logi'
        ? {
            ...buildPublicLogiExternalSupply(commodityKey),
            ...(request.externalSupplyByCommodityKey ?? {}),
        }
        : { ...(request.externalSupplyByCommodityKey ?? {}) };

    const plan = planFoxholeProduction(index, {
        demands: [{
            channel,
            resourceId,
            quantity: quantity || 1,
        }],
        preferredRecipeIdByOutput,
        externalSupplyByCommodityKey,
        includeParentBuildCosts: request.includeParentBuildCosts === true,
    });

    const steps = projectFoxholeProductionItinerarySteps(plan, index, catalogs, assumptions);
    const leafRequirements = collectFoxholeProductionItineraryLeafRequirements(plan, catalogs);
    const producers = collectProducers(plan, index);
    const pendingChoices = collectFoxholeProductionItineraryPendingChoices(
        plan,
        index,
        catalogs,
        assumptions,
    );
    const board = request.sceneSnapshots
        ? buildBoardSummary(plan, index, request.sceneSnapshots)
        : null;

    const blockers = plan.blockers.filter(blocker => (
        listFoxholeProductionLeafGatherSources(
            blocker.commodityKey,
            catalogs.structureCatalog,
        ).length === 0
    ));
    const status = plan.status === 'missing' && blockers.length === 0
        ? 'ok'
        : plan.status;

    return {
        goal,
        status,
        assumptions,
        steps,
        leafRequirements,
        producers,
        blockers,
        pendingChoices,
        board,
        plan,
    };
}
