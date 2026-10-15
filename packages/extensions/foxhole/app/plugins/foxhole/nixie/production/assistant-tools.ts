import type { FoxholeItemCatalog, FoxholeStructureCatalog } from '../catalog.ts';
import { resolveFoxholeCatalogCanonicalKeyFromAlias } from '../catalog-search-aliases.ts';
import {
    parseFoxholeProductionCommodityKey,
    queryFoxholeProductionItinerary,
    resolveFoxholeProductionOutputRef,
    searchFoxholeProductionOutputs,
} from './itinerary.ts';
import {
    getFoxholeCommodityUseNote,
    listFoxholeProductionCommodityConsumers,
    resolveFoxholeProductionCommodityRef,
} from './commodity-uses.ts';
import {
    getFoxholeAircraftObtainNote,
    getFoxholeCommodityObtainNote,
    getFoxholeCrateLogisticsNote,
    listFoxholeAircraftObtainRelated,
    listFoxholeObtainRelatedForDescribe,
} from './obtain-notes.ts';
import { listFoxholeProductionLeafGatherSources } from './leaf-sources.ts';
import { getFoxholeProductionIndex, parseFoxholeProductionBuildTargetId } from './index.ts';
import {
    resolveFoxholeStructureRecipes,
} from './recipe-display.ts';
import {
    buildFoxholeProductionItineraryUiBlocks,
    buildFoxholeProductionDescribeUiBlocks,
    buildFoxholeProductionResolveUiBlocks,
    buildFoxholeProductionSearchUiBlocks,
} from './assistant-ui-blocks.ts';
import type {
    FoxholeProductionChannel,
    FoxholeProductionIndex,
    FoxholeProductionItineraryAssumptions,
    FoxholeProductionItineraryResult,
    FoxholeProductionOutputCatalogEntry,
    FoxholeProductionStructureSnapshotLike,
} from './types.ts';
import { FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE } from '../assistant-grounding.ts';

export type FoxholeProductionAssistantJsonSchema = {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
};

export type FoxholeProductionAssistantToolDescriptor = {
    name: string;
    description: string;
    parameters: FoxholeProductionAssistantJsonSchema;
    statusLabel?: string;
};

export type FoxholeProductionAssistantToolContext = {
    baseAssetsUrl: string;
    index?: FoxholeProductionIndex;
    itemCatalog?: FoxholeItemCatalog | null;
    structureCatalog?: FoxholeStructureCatalog | null;
    sceneSnapshots?: readonly FoxholeProductionStructureSnapshotLike[];
    /** Default true when sceneSnapshots are present. */
    includeBoard?: boolean;
};

export type FoxholeProductionAssistantToolSuccess = {
    ok: true;
    tool: string;
    result: unknown;
};

export type FoxholeProductionAssistantToolFailure = {
    ok: false;
    tool: string;
    error: string;
};

export type FoxholeProductionAssistantToolResult
    = | FoxholeProductionAssistantToolSuccess
        | FoxholeProductionAssistantToolFailure;

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function resolveIndex(context: FoxholeProductionAssistantToolContext): FoxholeProductionIndex {
    return context.index ?? getFoxholeProductionIndex(normalizeKey(context.baseAssetsUrl) || '/foxhole/assets/');
}

function catalogContext(context: FoxholeProductionAssistantToolContext) {
    return {
        itemCatalog: context.itemCatalog ?? null,
        structureCatalog: context.structureCatalog ?? null,
    };
}

function compactOutputEntry(entry: FoxholeProductionOutputCatalogEntry) {
    return {
        commodityKey: entry.commodityKey,
        label: entry.label,
        producerCount: entry.producerCount,
        sampleProducerNames: entry.sampleProducerNames,
        channel: entry.channel,
        resourceId: entry.resourceId,
        ...(entry.isWorldStructure ? { isWorldStructure: true } : {}),
    };
}

function compactItineraryResult(result: FoxholeProductionItineraryResult) {
    return {
        goal: result.goal,
        status: result.status,
        assumptions: result.assumptions,
        steps: result.steps,
        leafRequirements: result.leafRequirements,
        producers: result.producers,
        blockers: result.blockers,
        pendingChoices: result.pendingChoices,
        board: result.board,
    };
}

export const FOXHOLE_PRODUCTION_ASSISTANT_TOOLS: readonly FoxholeProductionAssistantToolDescriptor[] = [
    {
        name: 'search_production_outputs',
        statusLabel: 'Searching production outputs…',
        description:
            'Search the Foxhole production catalog by product/output name or commodity id (e.g. "diesel", "cloth", "item:Cloth"). Use to find a product key. Do NOT use this to answer "what can structure X produce" — use list_structure_production instead.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Free-text or commodity key to search for among producible outputs.',
                },
                limit: {
                    type: 'integer',
                    description: 'Max results to return (default 25).',
                    minimum: 1,
                    maximum: 100,
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
    },
    {
        name: 'list_structure_production',
        statusLabel: 'Listing structure recipes…',
        description:
            'List conversion products a specific Foxhole structure/facility can produce (recipes hosted on that structure). Use for "what can I make there/at the Refinery/Factory/LAS/MPF". Pass structureId from prior tools (e.g. "refinery", "facilityvehiclefactory2", "massproduction") or a structure name/acronym query (e.g. "Refinery", "LAS", "MPF"). Returns products of that structure only — not other facilities whose names happen to contain the same letters. Also returns modificationOptions (upgrade names on that structure); never invent upgrades from other facilities.',
        parameters: {
            type: 'object',
            properties: {
                structureId: {
                    type: 'string',
                    description: 'Structure key such as "refinery", or build resource id "structure:refinery".',
                },
                query: {
                    type: 'string',
                    description: 'Optional structure name or acronym when structureId is unknown (e.g. "Refinery", "LAS", "MPF", "SAS").',
                },
                includeModifications: {
                    type: 'boolean',
                    description: 'When true, include modification-slot conversion recipes (e.g. LAS Heavy Tank / Aircraft Assembly). Default false returns base recipes only (e.g. LAS trains). Check modificationOptions in the result for real upgrade names.',
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'describe_commodity',
        statusLabel: 'Looking up commodity…',
        description:
            'Describe how to obtain a commodity and what uses it. Use for "what is X used for", "how do I get Copper/Salvage", "what consumes Copper Alloy". Returns gatherSources, facility recipe consumers, producers, and authored useNotes. Never invent mines or POIs beyond gatherSources.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Free-text name such as "Copper", "Copper Alloy", or "salvage".',
                },
                commodityKey: {
                    type: 'string',
                    description: 'Optional explicit commodity key such as "item:Copper" or "item:CopperA".',
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'resolve_production_output',
        statusLabel: 'Resolving production output…',
        description:
            'Resolve a free-text product name or commodity key to a single catalog output entry. Prefer this before querying an itinerary when the user named a product informally.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Free-text label or commodity key such as "item:Cloth" or "Cloth".',
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
    },
    {
        name: 'query_production_itinerary',
        statusLabel: 'Building production itinerary…',
        description:
            'Build an output-first production itinerary: ordered leaves-first steps, leaf requirements the player must bring, required producers, blockers, and optional board coverage when the host provides scene context. Call after resolving the target output.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Optional free-text or commodity key. Used when channel/resourceId are omitted.',
                },
                commodityKey: {
                    type: 'string',
                    description: 'Optional explicit commodity key such as "item:Cloth".',
                },
                channel: {
                    type: 'string',
                    enum: ['item', 'crate', 'liquid', 'build'],
                    description: 'Output channel when resourceId is provided.',
                },
                resourceId: {
                    type: 'string',
                    description: 'Output resource id when channel is provided.',
                },
                quantity: {
                    type: 'number',
                    description: 'Desired output quantity (default 1).',
                    minimum: 0,
                },
                assumptions: {
                    type: 'string',
                    enum: ['full', 'public_logi'],
                    description:
                        'Planning assumptions. Default public_logi prefers world structures and treats common town-logi inputs as external. Use full to expand everything and stall on ties.',
                },
                preferredRecipeIdByOutput: {
                    type: 'object',
                    description: 'Map of commodityKey → preferred recipe id for ambiguous branches.',
                    additionalProperties: { type: 'string' },
                },
                externalSupplyByCommodityKey: {
                    type: 'object',
                    description: 'Map of commodityKey → number or "unbounded" for inputs treated as already available.',
                    additionalProperties: {
                        anyOf: [
                            { type: 'number' },
                            { type: 'string', const: 'unbounded' },
                        ],
                    },
                },
                includeParentBuildCosts: {
                    type: 'boolean',
                    description: 'When true, include parent build-cost rollups for build targets.',
                },
            },
            required: ['quantity'],
            additionalProperties: false,
        },
    },
] as const;

function normalizeAssumptions(value: unknown): FoxholeProductionItineraryAssumptions {
    return value === 'full' ? 'full' : 'public_logi';
}

function resolveStructureIdForProductionList(
    args: Record<string, unknown>,
    catalogs: {
        itemCatalog?: FoxholeItemCatalog | null;
        structureCatalog?: FoxholeStructureCatalog | null;
    },
): string | null {
    const candidates = [
        normalizeKey(args.structureId),
        normalizeKey(args.query),
    ].filter(Boolean);

    const catalog = catalogs.structureCatalog;
    if (!catalog) {
        const fallback = candidates[0] ?? '';
        const buildTarget = parseFoxholeProductionBuildTargetId(fallback);
        return buildTarget?.structureId || fallback.replace(/^(?:structure|vehicle):/i, '') || null;
    }

    for (const candidate of candidates) {
        const buildTarget = parseFoxholeProductionBuildTargetId(candidate);
        const stripped = (buildTarget?.structureId || candidate.replace(/^(?:structure|vehicle):/i, '')).trim();
        if (!stripped) {
            continue;
        }

        const aliasCanonical = resolveFoxholeCatalogCanonicalKeyFromAlias(stripped);
        const keysToTry = [
            stripped,
            stripped.toLowerCase(),
            aliasCanonical ?? '',
            aliasCanonical?.toLowerCase() ?? '',
        ].filter(Boolean);

        for (const key of keysToTry) {
            const asset = catalog.assetByKey[key];
            if (asset) {
                return normalizeKey(asset.foxholeKey) || key;
            }
        }

        const lowered = stripped.toLowerCase();
        const byName = catalog.assets.find(asset => {
            if (normalizeKey(asset.name).toLowerCase() === lowered) {
                return true;
            }
            return (asset.aliases ?? []).some(alias => normalizeKey(alias).toLowerCase() === lowered);
        });
        if (byName) {
            return normalizeKey(byName.foxholeKey) || stripped;
        }
    }

    return null;
}

function executeListStructureProduction(
    args: Record<string, unknown>,
    context: FoxholeProductionAssistantToolContext,
): FoxholeProductionAssistantToolResult {
    const catalogs = catalogContext(context);
    const structureId = resolveStructureIdForProductionList(args, catalogs);
    if (!structureId) {
        return {
            ok: false,
            tool: 'list_structure_production',
            error: 'provide structureId or query for a known structure',
        };
    }

    const includeModifications = args.includeModifications === true;
    const index = resolveIndex(context);
    const view = resolveFoxholeStructureRecipes({
        structureId,
        baseAssetsUrl: context.baseAssetsUrl,
        productionIndex: index,
        itemCatalog: catalogs.itemCatalog,
        structureCatalog: catalogs.structureCatalog,
        includeModifications,
    });

    if (!view.structure && view.recipes.length === 0) {
        return {
            ok: true,
            tool: 'list_structure_production',
            result: {
                found: false,
                error: 'not_found',
                structureId,
                guidance: FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE,
            },
        };
    }

    const conversionRecipes = view.recipes.filter(recipe => !recipe.isBuildCost);
    const productsByKey = new Map<string, FoxholeProductionOutputCatalogEntry>();

    const pushProduct = (
        channel: FoxholeProductionChannel,
        resourceId: string,
        labelHint?: string | null,
    ) => {
        const normalizedResourceId = normalizeKey(resourceId);
        if (!normalizedResourceId || normalizedResourceId.toLowerCase() === 'power') {
            return;
        }
        if (channel === 'build') {
            return;
        }
        const dedupeKey = `${channel}:${normalizedResourceId}`.toLowerCase();
        if (productsByKey.has(dedupeKey)) {
            return;
        }
        const commodityKey = `${channel}:${normalizedResourceId}`;
        const fromView = conversionRecipes
            .flatMap(recipe => recipe.outputs)
            .find(output => (
                output.channel === channel
                && normalizeKey(output.id).toLowerCase() === normalizedResourceId.toLowerCase()
            ));
        productsByKey.set(dedupeKey, {
            commodityKey,
            channel,
            resourceId: normalizedResourceId,
            label: fromView?.resolvedName || labelHint || formatLabelFallback(normalizedResourceId),
            searchText: '',
            producerCount: 1,
            sampleProducerNames: [
                view.structure?.name || structureId,
            ],
        });
    };

    for (const recipeView of conversionRecipes) {
        const raw = recipeView.recipe;
        for (const resourceId of Object.keys(raw.itemOutput ?? {})) {
            pushProduct('item', resourceId);
        }
        for (const resourceId of Object.keys(raw.crateOutput ?? {})) {
            pushProduct('crate', resourceId);
        }
        for (const resourceId of Object.keys(raw.liquidOutput ?? {})) {
            pushProduct('liquid', resourceId);
        }
    }

    const products = [...productsByKey.values()].sort((left, right) => (
        left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
    ));

    const structureLabel = view.structure?.name || structureId;
    const modificationOptions = (view.structure?.modificationSlots ?? [])
        .flatMap(slot => (slot.variants ?? []).map(variant => ({
            slotId: slot.id,
            variantId: variant.id,
            label: normalizeKey(variant.name) || normalizeKey(variant.id) || variant.id,
        })))
        .filter(option => option.label)
        .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));

    const structureBlockEntries: FoxholeProductionOutputCatalogEntry[] = [{
        commodityKey: `build:structure:${structureId}`,
        channel: 'build',
        resourceId: `structure:${structureId}`,
        label: structureLabel,
        searchText: '',
        producerCount: 1,
        sampleProducerNames: [structureLabel],
        ...(view.structure?.isWorldStructure ? { isWorldStructure: true } : {}),
    }];

    return {
        ok: true,
        tool: 'list_structure_production',
        result: {
            structureId,
            structureName: structureLabel,
            isWorldStructure: view.structure?.isWorldStructure === true,
            recipeCount: conversionRecipes.length,
            includeModifications,
            // Base listing omits upgrade-slot recipes; names are still returned so the
            // model can mention real upgrades without inventing unrelated facilities.
            modificationOptions,
            productsIncludeModificationRecipes: includeModifications,
            products: products.map(compactOutputEntry),
            uiBlocks: buildFoxholeProductionSearchUiBlocks(
                [...structureBlockEntries, ...products],
                catalogs,
            ),
        },
    };
}

function executeDescribeCommodity(
    args: Record<string, unknown>,
    context: FoxholeProductionAssistantToolContext,
): FoxholeProductionAssistantToolResult {
    const catalogs = catalogContext(context);
    const index = resolveIndex(context);
    const commodityKeyArg = normalizeKey(args.commodityKey);
    const query = normalizeKey(args.query) || commodityKeyArg;
    if (!query && !commodityKeyArg) {
        return { ok: false, tool: 'describe_commodity', error: 'provide query or commodityKey' };
    }

    const resolved = commodityKeyArg
        ? resolveFoxholeProductionCommodityRef(commodityKeyArg, index, catalogs)
        ?? resolveFoxholeProductionOutputRef(commodityKeyArg, index, catalogs)
        : resolveFoxholeProductionCommodityRef(query, index, catalogs)
            ?? resolveFoxholeProductionOutputRef(query, index, catalogs);

    if (!resolved) {
        return {
            ok: true,
            tool: 'describe_commodity',
            result: {
                found: false,
                error: 'not_found',
                query,
                guidance: FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE,
            },
        };
    }

    const commodityKey = resolved.commodityKey;
    const gatherSources = listFoxholeProductionLeafGatherSources(
        commodityKey,
        catalogs.structureCatalog,
    );
    const consumers = listFoxholeProductionCommodityConsumers(index, commodityKey, catalogs);
    const producerRecipeIds = index.recipeIdsByOutput[commodityKey] ?? [];
    const producers = producerRecipeIds.slice(0, 8).map(recipeId => {
        const recipe = index.recipeById[recipeId];
        return {
            recipeId,
            structureId: recipe?.sourceStructureId ?? null,
            structureName: recipe?.sourceStructureName ?? null,
            label: recipe?.sourceVariantName
                ? `${recipe.sourceStructureName} → ${recipe.sourceVariantName}`
                : (recipe?.sourceStructureName ?? recipeId),
        };
    });
    const useNotes = getFoxholeCommodityUseNote(commodityKey);
    const obtainNotes = getFoxholeCommodityObtainNote(commodityKey)
        ?? getFoxholeAircraftObtainNote(commodityKey, resolved.resourceId)
        ?? getFoxholeCrateLogisticsNote(resolved.channel, producerRecipeIds.length);
    const description = resolved.channel === 'build'
        ? String(
            catalogs.structureCatalog?.assetByKey?.[resolved.resourceId.replace(/^(?:structure|vehicle):/i, '')]?.description
            ?? catalogs.structureCatalog?.assetByKey?.[resolved.resourceId.replace(/^(?:structure|vehicle):/i, '').toLowerCase()]?.description
            ?? '',
        ).trim() || null
        : String(
            catalogs.itemCatalog?.assetByKey?.[resolved.resourceId]?.description
            ?? catalogs.itemCatalog?.assetByKey?.[resolved.resourceId.toLowerCase()]?.description
            ?? '',
        ).trim() || null;

    const outputEntry: FoxholeProductionOutputCatalogEntry = {
        commodityKey,
        channel: resolved.channel,
        resourceId: resolved.resourceId,
        label: resolved.label,
        searchText: commodityKey.toLowerCase(),
        producerCount: producerRecipeIds.length,
        sampleProducerNames: producers.map(row => row.label).filter(Boolean) as string[],
    };

    const enrichedGatherSources = gatherSources.map(source => ({
        ...source,
        // Prefer authored how-to; catalog text is backup context for the model.
        note: source.note || source.description || undefined,
    }));

    const related = listFoxholeObtainRelatedForDescribe(
        commodityKey,
        resolved.channel,
        producerRecipeIds.length,
        resolved.resourceId,
    );
    const relatedItems = related
        .filter((ref): ref is Extract<typeof ref, { kind: 'item'; }> => ref.kind === 'item')
        .map(ref => ({
            channel: ref.channel,
            resourceId: ref.resourceId,
            label: ref.label,
            commodityKey: `${ref.channel}:${ref.resourceId}`,
        }));
    const relatedStructures = related
        .filter((ref): ref is Extract<typeof ref, { kind: 'structure'; }> => ref.kind === 'structure')
        .map(ref => ({
            structureId: ref.structureId,
            structureName: ref.label,
            label: ref.label,
        }));

    return {
        ok: true,
        tool: 'describe_commodity',
        result: {
            commodityKey,
            channel: resolved.channel,
            resourceId: resolved.resourceId,
            label: resolved.label,
            description,
            gatherSources: enrichedGatherSources,
            producers,
            consumers: consumers.map(consumer => ({
                recipeId: consumer.recipeId,
                structureId: consumer.structureId,
                structureName: consumer.structureName,
                label: consumer.label,
                outputLabels: consumer.outputLabels,
            })),
            useNotes,
            obtainNotes,
            uiBlocks: buildFoxholeProductionDescribeUiBlocks(
                outputEntry,
                {
                    producers,
                    consumers,
                    gatherSources: enrichedGatherSources,
                    relatedItems,
                    relatedStructures,
                    preferGatherOverConsumers: enrichedGatherSources.length > 0,
                },
                catalogs,
            ),
        },
    };
}

function formatLabelFallback(resourceId: string): string {
    const spaced = resourceId
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
    return spaced || resourceId;
}

function executeSearch(
    args: Record<string, unknown>,
    context: FoxholeProductionAssistantToolContext,
): FoxholeProductionAssistantToolResult {
    const query = normalizeKey(args.query);
    if (!query) {
        return { ok: false, tool: 'search_production_outputs', error: 'query is required' };
    }
    const limitRaw = Number(args.limit ?? 25);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 25;
    const index = resolveIndex(context);
    const matched = searchFoxholeProductionOutputs(query, index, catalogContext(context), limit);
    const outputs = matched.map(compactOutputEntry);
    if (outputs.length === 0) {
        return {
            ok: true,
            tool: 'search_production_outputs',
            result: {
                found: false,
                error: 'not_found',
                query,
                outputs: [],
                guidance: FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE,
                uiBlocks: [],
            },
        };
    }
    const catalogs = catalogContext(context);
    let uiBlocks = buildFoxholeProductionSearchUiBlocks(matched, catalogs, index);
    const allAircraft = matched.length > 0
        && matched.every(entry => (
            entry.channel === 'build' && /^vehicle:aircraft(?!crate)/i.test(entry.resourceId)
        ));
    if (allAircraft) {
        const siteRefs = listFoxholeAircraftObtainRelated(
            matched[0]!.commodityKey,
            matched[0]!.resourceId.includes('scout')
                ? matched[0]!.resourceId
                : 'vehicle:aircraftbomberw',
        );
        // For a mixed scout+combat roster, include the full build-site set.
        const related = matched.some(entry => /aircraftscout/i.test(entry.resourceId))
            && matched.some(entry => !/aircraftscout/i.test(entry.resourceId))
            ? listFoxholeAircraftObtainRelated('build:vehicle:aircraftbomberw', 'vehicle:aircraftbomberw')
            : siteRefs;
        const siteBlocks = buildFoxholeProductionDescribeUiBlocks(
            matched[0]!,
            {
                relatedStructures: related
                    .filter((ref): ref is Extract<typeof ref, { kind: 'structure'; }> => ref.kind === 'structure')
                    .map(ref => ({
                        structureId: ref.structureId,
                        structureName: ref.label,
                        label: ref.label,
                    })),
                preferGatherOverConsumers: true,
            },
            catalogs,
        ).filter(block => block.id !== `item:${matched[0]!.resourceId}`);
        const seen = new Set(uiBlocks.map(block => block.id));
        for (const block of siteBlocks) {
            if (seen.has(block.id)) {
                continue;
            }
            seen.add(block.id);
            uiBlocks = [...uiBlocks, block];
        }
    }
    return {
        ok: true,
        tool: 'search_production_outputs',
        result: {
            found: true,
            outputs,
            ...(allAircraft
                ? {
                    obtainNotes: [
                        'Scout aircraft: build with a Hammer at an Aircraft Hangar.',
                        'Other aircraft: Large Assembly Station (Aircraft Assembly) → unpack at Aircraft Depot → install parts from Aircraft Maintenance Factory (parts only, not the plane).',
                    ].join(' '),
                }
                : {}),
            uiBlocks,
        },
    };
}

function executeResolve(
    args: Record<string, unknown>,
    context: FoxholeProductionAssistantToolContext,
): FoxholeProductionAssistantToolResult {
    const query = normalizeKey(args.query);
    if (!query) {
        return { ok: false, tool: 'resolve_production_output', error: 'query is required' };
    }
    const index = resolveIndex(context);
    const entry = resolveFoxholeProductionOutputRef(query, index, catalogContext(context));
    if (!entry) {
        return {
            ok: true,
            tool: 'resolve_production_output',
            result: {
                found: false,
                error: 'not_found',
                query,
                guidance: FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE,
            },
        };
    }
    const catalogs = catalogContext(context);
    const related = listFoxholeObtainRelatedForDescribe(
        entry.commodityKey,
        entry.channel,
        entry.producerCount,
        entry.resourceId,
    );
    const relatedItems = related
        .filter((ref): ref is Extract<typeof ref, { kind: 'item'; }> => ref.kind === 'item')
        .map(ref => ({
            channel: ref.channel,
            resourceId: ref.resourceId,
            label: ref.label,
            commodityKey: `${ref.channel}:${ref.resourceId}`,
        }));
    const relatedStructures = related
        .filter((ref): ref is Extract<typeof ref, { kind: 'structure'; }> => ref.kind === 'structure')
        .map(ref => ({
            structureId: ref.structureId,
            structureName: ref.label,
            label: ref.label,
        }));
    const producerBlocks = buildFoxholeProductionResolveUiBlocks(entry, catalogs, index);
    const relatedBlocks = relatedItems.length || relatedStructures.length
        ? buildFoxholeProductionDescribeUiBlocks(
            entry,
            { relatedItems, relatedStructures, preferGatherOverConsumers: true },
            catalogs,
        )
        : [];
    const uiBlocks = [...producerBlocks];
    const seen = new Set(uiBlocks.map(block => block.id));
    for (const block of relatedBlocks) {
        if (seen.has(block.id)) {
            continue;
        }
        seen.add(block.id);
        uiBlocks.push(block);
    }
    return {
        ok: true,
        tool: 'resolve_production_output',
        result: {
            ...compactOutputEntry(entry),
            obtainNotes: getFoxholeCommodityObtainNote(entry.commodityKey)
                ?? getFoxholeAircraftObtainNote(entry.commodityKey, entry.resourceId)
                ?? getFoxholeCrateLogisticsNote(entry.channel, entry.producerCount),
            uiBlocks,
        },
    };
}

function resolveDemandFromArgs(
    args: Record<string, unknown>,
    context: FoxholeProductionAssistantToolContext,
): { channel: FoxholeProductionChannel; resourceId: string; } | { error: string; } {
    const channelArg = normalizeKey(args.channel).toLowerCase();
    const resourceIdArg = normalizeKey(args.resourceId);
    if (
        (channelArg === 'item' || channelArg === 'crate' || channelArg === 'liquid' || channelArg === 'build')
        && resourceIdArg
    ) {
        return { channel: channelArg, resourceId: resourceIdArg };
    }

    const commodityKey = normalizeKey(args.commodityKey);
    if (commodityKey) {
        const parsed = parseFoxholeProductionCommodityKey(commodityKey);
        if (parsed) {
            return { channel: parsed.channel, resourceId: parsed.resourceId };
        }
    }

    const query = normalizeKey(args.query);
    if (query) {
        const index = resolveIndex(context);
        const resolved = resolveFoxholeProductionOutputRef(query, index, catalogContext(context));
        if (resolved) {
            return { channel: resolved.channel, resourceId: resolved.resourceId };
        }
        const parsed = parseFoxholeProductionCommodityKey(query);
        if (parsed) {
            return { channel: parsed.channel, resourceId: parsed.resourceId };
        }
        return { error: `could not resolve output from query "${query}"` };
    }

    return { error: 'provide channel+resourceId, commodityKey, or query' };
}

function normalizeExternalSupply(
    value: unknown,
): Record<string, number | 'unbounded'> | undefined {
    const record = asRecord(value);
    const entries = Object.entries(record);
    if (!entries.length) {
        return undefined;
    }
    /** @type {Record<string, number | 'unbounded'>} */
    const out: Record<string, number | 'unbounded'> = {};
    for (const [key, raw] of entries) {
        const commodityKey = normalizeKey(key);
        if (!commodityKey) {
            continue;
        }
        if (raw === 'unbounded') {
            out[commodityKey] = 'unbounded';
            continue;
        }
        const amount = Number(raw);
        if (Number.isFinite(amount) && amount > 0) {
            out[commodityKey] = amount;
        }
    }
    return Object.keys(out).length ? out : undefined;
}

function normalizePreferredRecipes(value: unknown): Record<string, string> | undefined {
    const record = asRecord(value);
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(record)) {
        const commodityKey = normalizeKey(key);
        const recipeId = normalizeKey(raw);
        if (commodityKey && recipeId) {
            out[commodityKey] = recipeId;
        }
    }
    return Object.keys(out).length ? out : undefined;
}

function executeItinerary(
    args: Record<string, unknown>,
    context: FoxholeProductionAssistantToolContext,
): FoxholeProductionAssistantToolResult {
    const demand = resolveDemandFromArgs(args, context);
    if ('error' in demand) {
        return { ok: false, tool: 'query_production_itinerary', error: demand.error };
    }

    const quantityRaw = Number(args.quantity ?? 1);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
    const includeBoard = context.includeBoard !== false
        && Array.isArray(context.sceneSnapshots)
        && context.sceneSnapshots.length > 0;

    const itinerary = queryFoxholeProductionItinerary({
        baseAssetsUrl: context.baseAssetsUrl,
        index: context.index,
        itemCatalog: context.itemCatalog,
        structureCatalog: context.structureCatalog,
        demand: {
            channel: demand.channel,
            resourceId: demand.resourceId,
            quantity,
        },
        assumptions: normalizeAssumptions(args.assumptions),
        preferredRecipeIdByOutput: normalizePreferredRecipes(args.preferredRecipeIdByOutput),
        externalSupplyByCommodityKey: normalizeExternalSupply(args.externalSupplyByCommodityKey),
        includeParentBuildCosts: args.includeParentBuildCosts === true,
        sceneSnapshots: includeBoard ? context.sceneSnapshots : undefined,
    });

    const catalogs = catalogContext(context);
    return {
        ok: true,
        tool: 'query_production_itinerary',
        result: {
            ...compactItineraryResult(itinerary),
            uiBlocks: buildFoxholeProductionItineraryUiBlocks(itinerary, catalogs),
        },
    };
}

export function executeFoxholeProductionAssistantTool(
    name: string,
    args: unknown,
    context: FoxholeProductionAssistantToolContext,
): FoxholeProductionAssistantToolResult {
    const tool = normalizeKey(name);
    const record = asRecord(args);

    switch (tool) {
        case 'search_production_outputs':
            return executeSearch(record, context);
        case 'list_structure_production':
            return executeListStructureProduction(record, context);
        case 'describe_commodity':
            return executeDescribeCommodity(record, context);
        case 'resolve_production_output':
            return executeResolve(record, context);
        case 'query_production_itinerary':
            return executeItinerary(record, context);
        default:
            return {
                ok: false,
                tool: tool || String(name ?? ''),
                error: `unknown tool: ${tool || '(empty)'}`,
            };
    }
}
