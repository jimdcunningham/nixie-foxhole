import type { FoxholeItemCatalog, FoxholeStructureCatalog } from '../catalog.ts';
import { FOXHOLE_PRODUCTION_LEAF_GATHER_COMMODITY_KEYS } from './leaf-sources.ts';
import { FOXHOLE_COMMODITY_OBTAIN_NOTES } from './obtain-notes.ts';
import type {
    FoxholeProductionChannel,
    FoxholeProductionIndex,
    FoxholeProductionRecipe,
} from './types.ts';

/**
 * Authored use notes for commodities that are not consumed by facility conversion
 * recipes in the FoxWatch production catalog (e.g. Engineering Center tech).
 */
export const FOXHOLE_COMMODITY_USE_NOTES: Readonly<Record<string, string>> = {
    'item:Copper':
        'Refine into Copper Alloy at a Refinery. Raw Copper has no other uses.',
    'item:CopperA':
        'Used at the Engineering Center to advance vehicle technology and produce Vehicle Prototype Kits. Not consumed by facility conversion recipes in the catalog.',
    'item:Aluminum':
        'Refine into Aluminum Alloy at a Refinery. Raw Aluminum has no other uses.',
    'item:AluminumA':
        'Used at the Engineering Center to advance vehicle technology and produce Vehicle Prototype Kits. Not consumed by facility conversion recipes in the catalog.',
    'item:Iron':
        'Refine into Iron Alloy at a Refinery. Raw Iron has no other uses.',
    'item:IronA':
        'Used at the Engineering Center to advance vehicle technology and produce Vehicle Prototype Kits. Not consumed by facility conversion recipes in the catalog.',
};

export type FoxholeProductionCommodityUseRef = {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    label: string;
};

export type FoxholeProductionCommodityConsumer = {
    recipeId: string;
    structureId: string;
    structureName: string;
    label: string;
    outputLabels: string[];
};

export type FoxholeProductionCommodityCatalogContext = {
    itemCatalog?: FoxholeItemCatalog | null;
    structureCatalog?: FoxholeStructureCatalog | null;
};

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeLookupKey(value: unknown): string {
    return normalizeKey(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function createCommodityKey(channel: FoxholeProductionChannel, resourceId: string): string {
    return `${channel}:${resourceId}`;
}

function parseCommodityKey(
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
            commodityKey: createCommodityKey(channel, resourceId),
        };
    }
    return {
        channel: 'item',
        resourceId: normalized,
        commodityKey: createCommodityKey('item', normalized),
    };
}

function formatFallbackLabel(resourceId: string): string {
    const spaced = resourceId
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
    return spaced || resourceId;
}

function labelForCommodity(
    commodityKey: string,
    catalogs: FoxholeProductionCommodityCatalogContext,
): string {
    const parsed = parseCommodityKey(commodityKey);
    if (!parsed) {
        return commodityKey;
    }
    if (parsed.channel === 'build') {
        const structureId = parsed.resourceId.replace(/^(?:structure|vehicle):/i, '');
        const structure = catalogs.structureCatalog?.assetByKey?.[structureId]
            ?? catalogs.structureCatalog?.assetByKey?.[structureId.toLowerCase()];
        return structure?.name ?? formatFallbackLabel(structureId);
    }
    const item = catalogs.itemCatalog?.assetByKey?.[parsed.resourceId]
        ?? catalogs.itemCatalog?.assetByKey?.[parsed.resourceId.toLowerCase()]
        ?? catalogs.itemCatalog?.assets?.find(asset => (
            normalizeLookupKey(asset.foxholeKey) === normalizeLookupKey(parsed.resourceId)
            || normalizeLookupKey(asset.codeName) === normalizeLookupKey(parsed.resourceId)
            || normalizeLookupKey(asset.resourceKey) === normalizeLookupKey(parsed.resourceId)
        ));
    // Prefer human alloy names over "Copper A" fallbacks when catalog is absent.
    if (!item && /A$/i.test(parsed.resourceId) && parsed.resourceId.length > 1) {
        const base = parsed.resourceId.slice(0, -1);
        return `${formatFallbackLabel(base)} Alloy`;
    }
    return item?.name ?? formatFallbackLabel(parsed.resourceId);
}

function recipeOutputLabels(
    recipe: FoxholeProductionRecipe,
    catalogs: FoxholeProductionCommodityCatalogContext,
): string[] {
    const labels: string[] = [];
    const push = (channel: FoxholeProductionChannel, resourceId: string) => {
        labels.push(labelForCommodity(createCommodityKey(channel, resourceId), catalogs));
    };
    for (const resourceId of Object.keys(recipe.itemOutput ?? {})) {
        push('item', resourceId);
    }
    for (const resourceId of Object.keys(recipe.crateOutput ?? {})) {
        push('crate', resourceId);
    }
    for (const resourceId of Object.keys(recipe.liquidOutput ?? {})) {
        push('liquid', resourceId);
    }
    for (const resourceId of Object.keys(recipe.buildOutput ?? {})) {
        push('build', resourceId);
    }
    return labels;
}

function recipeConsumesCommodity(
    recipe: FoxholeProductionRecipe,
    channel: FoxholeProductionChannel,
    resourceId: string,
): boolean {
    const needle = resourceId.toLowerCase();
    const bag = channel === 'item'
        ? recipe.itemInput
        : channel === 'crate'
            ? recipe.crateInput
            : channel === 'liquid'
                ? recipe.liquidInput
                : null;
    if (!bag) {
        return false;
    }
    return Object.keys(bag).some(id => id.toLowerCase() === needle);
}

/** Collect item/crate/liquid resource ids that appear as recipe inputs or outputs. */
export function collectFoxholeProductionKnownResourceIds(
    index: FoxholeProductionIndex,
): { channel: FoxholeProductionChannel; resourceId: string; }[] {
    const seen = new Set<string>();
    const out: { channel: FoxholeProductionChannel; resourceId: string; }[] = [];
    const push = (channel: FoxholeProductionChannel, resourceId: string) => {
        const id = String(resourceId ?? '').trim();
        if (!id) {
            return;
        }
        const key = `${channel}:${id}`.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        out.push({ channel, resourceId: id });
    };

    for (const recipe of Object.values(index.recipeById)) {
        for (const resourceId of Object.keys(recipe.itemInput ?? {})) {
            push('item', resourceId);
        }
        for (const resourceId of Object.keys(recipe.itemOutput ?? {})) {
            push('item', resourceId);
        }
        for (const resourceId of Object.keys(recipe.crateInput ?? {})) {
            push('crate', resourceId);
        }
        for (const resourceId of Object.keys(recipe.crateOutput ?? {})) {
            push('crate', resourceId);
        }
        for (const resourceId of Object.keys(recipe.liquidInput ?? {})) {
            push('liquid', resourceId);
        }
        for (const resourceId of Object.keys(recipe.liquidOutput ?? {})) {
            push('liquid', resourceId);
        }
    }

    for (const commodityKey of Object.keys(FOXHOLE_COMMODITY_USE_NOTES)) {
        const parsed = parseCommodityKey(commodityKey);
        if (parsed) {
            push(parsed.channel, parsed.resourceId);
        }
    }
    for (const commodityKey of Object.keys(FOXHOLE_COMMODITY_OBTAIN_NOTES)) {
        const parsed = parseCommodityKey(commodityKey);
        if (parsed) {
            push(parsed.channel, parsed.resourceId);
        }
    }
    for (const commodityKey of FOXHOLE_PRODUCTION_LEAF_GATHER_COMMODITY_KEYS) {
        const parsed = parseCommodityKey(commodityKey);
        if (parsed) {
            push(parsed.channel, parsed.resourceId);
        }
    }

    return out;
}

function resolveFromItemCatalog(
    query: string,
    catalogs: FoxholeProductionCommodityCatalogContext,
): FoxholeProductionCommodityUseRef | null {
    const normalized = normalizeLookupKey(query);
    if (!normalized || !catalogs.itemCatalog) {
        return null;
    }

    const assets = catalogs.itemCatalog.assets ?? [];
    let best: FoxholeProductionCommodityUseRef | null = null;
    for (const asset of assets) {
        const name = normalizeLookupKey(asset.name);
        const foxholeKey = normalizeLookupKey(asset.foxholeKey);
        const codeName = normalizeLookupKey(asset.codeName);
        const resourceKey = normalizeLookupKey(asset.resourceKey);
        const exactName = name === normalized;
        const exactId = foxholeKey === normalized
            || codeName === normalized
            || resourceKey === normalized;
        if (!exactName && !exactId) {
            continue;
        }
        const resourceId = normalizeKey(asset.codeName) || normalizeKey(asset.foxholeKey);
        if (!resourceId) {
            continue;
        }
        const candidate: FoxholeProductionCommodityUseRef = {
            commodityKey: createCommodityKey('item', resourceId),
            channel: 'item',
            resourceId,
            label: normalizeKey(asset.name) || resourceId,
        };
        // Prefer exact display-name matches (Hammer) over id-only hits.
        if (exactName) {
            return candidate;
        }
        best = best ?? candidate;
    }
    return best;
}

/**
 * Resolve a commodity for obtain/use questions. Prefers exact resource-id matches
 * (so "copper" → Copper, not Copper Alloy / CopperA).
 */
export function resolveFoxholeProductionCommodityRef(
    query: string,
    index: FoxholeProductionIndex,
    catalogs: FoxholeProductionCommodityCatalogContext = {},
): FoxholeProductionCommodityUseRef | null {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return null;
    }

    const parsedExplicit = /^(item|crate|liquid|build):/i.test(raw)
        ? parseCommodityKey(raw)
        : null;
    if (parsedExplicit) {
        return {
            commodityKey: parsedExplicit.commodityKey,
            channel: parsedExplicit.channel,
            resourceId: parsedExplicit.resourceId,
            label: labelForCommodity(parsedExplicit.commodityKey, catalogs),
        };
    }

    const normalized = normalizeLookupKey(raw);
    if (!normalized) {
        return null;
    }

    const known = collectFoxholeProductionKnownResourceIds(index);

    // Exact display-name match first (e.g. "Copper Alloy" → CopperA).
    for (const entry of known) {
        const commodityKey = createCommodityKey(entry.channel, entry.resourceId);
        const label = labelForCommodity(commodityKey, catalogs);
        if (normalizeLookupKey(label) === normalized) {
            return {
                commodityKey,
                channel: entry.channel,
                resourceId: entry.resourceId,
                label,
            };
        }
    }

    // Catalog-only gear (Hammer / WorkHammer) before fuzzy production ids.
    const fromCatalog = resolveFromItemCatalog(raw, catalogs);
    if (fromCatalog && normalizeLookupKey(fromCatalog.label) === normalized) {
        return fromCatalog;
    }

    const exact = known.find(entry => normalizeLookupKey(entry.resourceId) === normalized);
    if (exact) {
        const commodityKey = createCommodityKey(exact.channel, exact.resourceId);
        return {
            commodityKey,
            channel: exact.channel,
            resourceId: exact.resourceId,
            label: labelForCommodity(commodityKey, catalogs),
        };
    }

    return fromCatalog;
}

export function listFoxholeProductionCommodityConsumers(
    index: FoxholeProductionIndex,
    commodityKey: string,
    catalogs: FoxholeProductionCommodityCatalogContext = {},
): FoxholeProductionCommodityConsumer[] {
    const parsed = parseCommodityKey(commodityKey);
    if (!parsed || parsed.channel === 'build') {
        return [];
    }

    const consumers: FoxholeProductionCommodityConsumer[] = [];
    for (const recipe of Object.values(index.recipeById)) {
        if (!recipeConsumesCommodity(recipe, parsed.channel, parsed.resourceId)) {
            continue;
        }
        const outputLabels = recipeOutputLabels(recipe, catalogs);
        consumers.push({
            recipeId: recipe.id,
            structureId: recipe.sourceStructureId,
            structureName: recipe.sourceStructureName,
            label: recipe.sourceVariantName
                ? `${recipe.sourceStructureName} → ${recipe.sourceVariantName}`
                : recipe.sourceStructureName,
            outputLabels,
        });
    }

    return consumers.sort((left, right) => left.label.localeCompare(right.label));
}

export function getFoxholeCommodityUseNote(commodityKey: string): string | null {
    const note = FOXHOLE_COMMODITY_USE_NOTES[String(commodityKey ?? '').trim()];
    return note || null;
}
