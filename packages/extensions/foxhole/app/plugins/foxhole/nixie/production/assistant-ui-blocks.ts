import type { NxAssistantChatBlock } from '#nixie/components/nx-assistant-chat.model.ts';
import { cleanNxAssistantChatDisplayLabel } from '#nixie/plugins/nixie/assistant/blocks.ts';
import {
    resolveFoxholeItemDefaultIconUrl,
    resolveFoxholeStructureDefaultIconUrl,
} from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import type {
    FoxholeItemCatalog,
    FoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { parseFoxholeProductionBuildTargetId } from './index.ts';
import {
    formatFoxholeProductionCommodityBaseLabel,
    isFoxholeProductionSelfReferentialRecipe,
} from './itinerary.ts';
import type {
    FoxholeProductionIndex,
    FoxholeProductionItineraryResult,
    FoxholeProductionOutputCatalogEntry,
} from './types.ts';

const CONSTRUCTION_VEHICLE_STRUCTURE_ID = 'construction';

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function structureLookupKey(resourceId: string): string {
    const normalized = normalizeKey(resourceId);
    const buildTarget = parseFoxholeProductionBuildTargetId(normalized);
    if (buildTarget?.structureId) {
        return buildTarget.structureId;
    }
    return normalized.replace(/^(?:structure|vehicle):/i, '');
}

function lookupItem(
    itemCatalog: FoxholeItemCatalog | null | undefined,
    resourceId: string,
) {
    const key = normalizeKey(resourceId).toLowerCase();
    if (!key || !itemCatalog) {
        return null;
    }
    return itemCatalog.assetByKey[key]
        ?? itemCatalog.assets.find(asset => (
            String(asset.foxholeKey ?? '').trim().toLowerCase() === key
            || String(asset.codeName ?? '').trim().toLowerCase() === key
            || String(asset.resourceKey ?? '').trim().toLowerCase() === key
            || String(asset.legacyKey ?? '').trim().toLowerCase() === key
        ))
        ?? null;
}

function lookupStructure(
    structureCatalog: FoxholeStructureCatalog | null | undefined,
    structureId: string,
) {
    const key = structureLookupKey(structureId);
    if (!key || !structureCatalog) {
        return null;
    }
    return structureCatalog.assetByKey[key]
        ?? structureCatalog.assetByKey[key.toLowerCase()]
        ?? null;
}

function looksLikeInternalId(value: string, resourceId: string): boolean {
    const label = value.trim();
    if (!label) {
        return true;
    }
    if (label.includes(':')) {
        return true;
    }
    const resource = normalizeKey(resourceId);
    if (resource && label.toLowerCase() === resource.toLowerCase()) {
        return true;
    }
    const structureKey = structureLookupKey(resource);
    if (structureKey && label.toLowerCase() === structureKey.toLowerCase()) {
        return true;
    }
    return false;
}

function isUsefulDisplayName(value: string, resourceId: string): boolean {
    const label = normalizeKey(value);
    if (!label || label === 'Unknown commodity' || label === 'Asset') {
        return false;
    }
    return !looksLikeInternalId(label, resourceId);
}

function resolveItemDisplayLabel(
    entry: Pick<
        FoxholeProductionOutputCatalogEntry,
        'commodityKey' | 'label' | 'channel' | 'resourceId'
    >,
    catalogs: {
        itemCatalog?: FoxholeItemCatalog | null;
        structureCatalog?: FoxholeStructureCatalog | null;
    },
): string {
    const resourceId = normalizeKey(entry.resourceId);
    const channel = normalizeKey(entry.channel).toLowerCase();
    const commodityKey = normalizeKey(entry.commodityKey)
        || (channel && resourceId ? `${channel}:${resourceId}` : '');

    if (channel === 'build') {
        const structure = lookupStructure(catalogs.structureCatalog, resourceId);
        // Prefer catalog identity whenever the structure resolves (even if name ≈ key).
        const structureName = normalizeKey(structure?.name)
            || normalizeKey(structure?.codeName)
            || normalizeKey(structure?.foxholeKey);
        if (structureName) {
            return structureName;
        }
    } else {
        const item = lookupItem(catalogs.itemCatalog, resourceId);
        const itemName = normalizeKey(item?.name)
            || normalizeKey(item?.codeName)
            || normalizeKey(item?.foxholeKey);
        if (itemName && isUsefulDisplayName(itemName, resourceId)) {
            return itemName;
        }
        if (itemName && !itemName.includes(':')) {
            return itemName;
        }
        // LAS / FMC emit vehicle codenames on the item channel.
        const structure = lookupStructure(catalogs.structureCatalog, resourceId);
        const structureName = normalizeKey(structure?.name)
            || normalizeKey(structure?.codeName)
            || normalizeKey(structure?.foxholeKey);
        if (structureName && isUsefulDisplayName(structureName, resourceId)) {
            return structureName;
        }
        if (structureName && !structureName.includes(':')) {
            return structureName;
        }
    }

    const cleaned = cleanNxAssistantChatDisplayLabel(entry.label);
    if (isUsefulDisplayName(cleaned, resourceId)) {
        return cleaned;
    }

    if (commodityKey) {
        const fromCommodity = formatFoxholeProductionCommodityBaseLabel(commodityKey, catalogs);
        if (isUsefulDisplayName(fromCommodity, resourceId)) {
            return fromCommodity;
        }
    }

    return 'Asset';
}

function itemBlockFromOutput(
    entry: Pick<
        FoxholeProductionOutputCatalogEntry,
        'commodityKey' | 'label' | 'channel' | 'resourceId' | 'isWorldStructure'
    >,
    catalogs: {
        itemCatalog?: FoxholeItemCatalog | null;
        structureCatalog?: FoxholeStructureCatalog | null;
    },
): NxAssistantChatBlock {
    const resourceId = normalizeKey(entry.resourceId);
    const channel = normalizeKey(entry.channel).toLowerCase();
    const commodityKey = normalizeKey(entry.commodityKey)
        || (channel && resourceId ? `${channel}:${resourceId}` : '');

    if (channel === 'build') {
        const structure = lookupStructure(catalogs.structureCatalog, resourceId);
        return {
            id: `item:${resourceId}`,
            kind: 'item',
            resourceId,
            channel: 'build',
            label: resolveItemDisplayLabel(entry, catalogs),
            commodityKey: commodityKey || undefined,
            iconUrl: resolveFoxholeStructureDefaultIconUrl(structure) || null,
        };
    }

    const item = lookupItem(catalogs.itemCatalog, resourceId);
    if (item) {
        return {
            id: `item:${resourceId}`,
            kind: 'item',
            resourceId,
            channel: channel || undefined,
            label: resolveItemDisplayLabel(entry, catalogs),
            commodityKey: commodityKey || undefined,
            iconUrl: resolveFoxholeItemDefaultIconUrl(item) || null,
        };
    }

    // Large Assembly Station / Field Modification Center style outputs: vehicle
    // codenames arrive on the item channel but live in the structure catalog.
    const structure = lookupStructure(catalogs.structureCatalog, resourceId);
    if (structure) {
        const buildKind = structure.isVehicle === true ? 'vehicle' : 'structure';
        const buildResourceId = `${buildKind}:${structure.foxholeKey}`;
        return {
            id: `item:${buildResourceId}`,
            kind: 'item',
            resourceId: buildResourceId,
            channel: 'build',
            label: resolveItemDisplayLabel({
                ...entry,
                channel: 'build',
                resourceId: buildResourceId,
            }, catalogs),
            commodityKey: commodityKey || undefined,
            iconUrl: resolveFoxholeStructureDefaultIconUrl(structure) || null,
        };
    }

    return {
        id: `item:${resourceId}`,
        kind: 'item',
        resourceId,
        channel: channel || undefined,
        label: resolveItemDisplayLabel(entry, catalogs),
        commodityKey: commodityKey || undefined,
        iconUrl: null,
    };
}

function constructionVehicleBlock(catalogs: {
    itemCatalog?: FoxholeItemCatalog | null;
    structureCatalog?: FoxholeStructureCatalog | null;
}): NxAssistantChatBlock {
    const structure = lookupStructure(catalogs.structureCatalog, CONSTRUCTION_VEHICLE_STRUCTURE_ID);
    return itemBlockFromOutput({
        commodityKey: `build:structure:${CONSTRUCTION_VEHICLE_STRUCTURE_ID}`,
        label: normalizeKey(structure?.name) || 'Construction Vehicle',
        channel: 'build',
        resourceId: CONSTRUCTION_VEHICLE_STRUCTURE_ID,
    }, catalogs);
}

function recipeDisplayLabel(
    preferred: unknown,
    structureName: unknown,
    recipeId: string,
): string {
    const cleanedPreferred = cleanNxAssistantChatDisplayLabel(preferred);
    if (cleanedPreferred && !looksLikeInternalId(cleanedPreferred, recipeId)) {
        // Step titles like "Produce 1× Basic Materials" are poor chip labels.
        if (!/^(produce|build|rebuild|obtain|choose|blocked)\b/i.test(cleanedPreferred)) {
            return cleanedPreferred;
        }
    }
    const cleanedStructure = cleanNxAssistantChatDisplayLabel(structureName);
    if (cleanedStructure && !looksLikeInternalId(cleanedStructure, recipeId)) {
        return cleanedStructure;
    }
    return 'Recipe';
}

export function buildFoxholeProductionSearchUiBlocks(
    outputs: readonly FoxholeProductionOutputCatalogEntry[],
    catalogs: {
        itemCatalog?: FoxholeItemCatalog | null;
        structureCatalog?: FoxholeStructureCatalog | null;
    },
    index?: Pick<FoxholeProductionIndex, 'recipeById' | 'recipeIdsByOutput'> | null,
): NxAssistantChatBlock[] {
    const blocks: NxAssistantChatBlock[] = [];
    const seen = new Set<string>();
    const push = (block: NxAssistantChatBlock | null) => {
        if (!block || seen.has(block.id)) {
            return;
        }
        seen.add(block.id);
        blocks.push(block);
    };

    for (const entry of outputs) {
        push(itemBlockFromOutput(entry, catalogs));
        if (!index?.recipeIdsByOutput || !index.recipeById) {
            continue;
        }
        for (const recipeId of (index.recipeIdsByOutput[entry.commodityKey] ?? []).slice(0, 4)) {
            const recipe = index.recipeById[recipeId];
            const structureId = normalizeKey(recipe?.sourceStructureId);
            if (!structureId) {
                continue;
            }
            // Build-cost recipes often list the vehicle as its own source — skip those
            // so we don't emit fake structure:aircraftbomberw chips beside the plane.
            if (isFoxholeProductionSelfReferentialRecipe(recipe, entry.resourceId)) {
                continue;
            }
            push(itemBlockFromOutput({
                commodityKey: `build:structure:${structureId}`,
                label: normalizeKey(recipe?.sourceStructureName) || structureId,
                channel: 'build',
                resourceId: `structure:${structureId}`,
            }, catalogs));
        }
    }
    return blocks;
}

export function buildFoxholeProductionResolveUiBlocks(
    entry: FoxholeProductionOutputCatalogEntry,
    catalogs: {
        itemCatalog?: FoxholeItemCatalog | null;
        structureCatalog?: FoxholeStructureCatalog | null;
    },
    index?: Pick<FoxholeProductionIndex, 'recipeById' | 'recipeIdsByOutput'> | null,
): NxAssistantChatBlock[] {
    return buildFoxholeProductionSearchUiBlocks([entry], catalogs, index);
}

export type FoxholeProductionDescribeStructureRef = {
    structureId?: string | null;
    structureName?: string | null;
    label?: string | null;
};

export type FoxholeProductionDescribeItemRef = {
    channel: string;
    resourceId: string;
    label?: string | null;
    commodityKey?: string | null;
};

/**
 * uiBlocks for describe_commodity: the commodity plus producer / gather /
 * (usually build) consumer structures so prose names hover.
 *
 * When gather sources exist (raw field/mine resources), skip craft consumers so
 * every Materials Factory / Engine Room that eats Salvage does not become a
 * random auto-link target. Build consumers (foundations, roads) still link when
 * gather sources are absent.
 */
export function buildFoxholeProductionDescribeUiBlocks(
    entry: FoxholeProductionOutputCatalogEntry,
    refs: {
        producers?: readonly FoxholeProductionDescribeStructureRef[];
        consumers?: readonly FoxholeProductionDescribeStructureRef[];
        gatherSources?: readonly FoxholeProductionDescribeStructureRef[];
        /** Items/structures cited in obtain notes (e.g. Sledge Hammer next to Hammer). */
        relatedItems?: readonly FoxholeProductionDescribeItemRef[];
        relatedStructures?: readonly FoxholeProductionDescribeStructureRef[];
        /** When true, omit craft/facility consumers from link targets. */
        preferGatherOverConsumers?: boolean;
    },
    catalogs: {
        itemCatalog?: FoxholeItemCatalog | null;
        structureCatalog?: FoxholeStructureCatalog | null;
    },
    limit = 64,
): NxAssistantChatBlock[] {
    const blocks: NxAssistantChatBlock[] = [];
    const seen = new Set<string>();

    const push = (block: NxAssistantChatBlock | null) => {
        if (!block || seen.has(block.id)) {
            return;
        }
        // Soft ceiling only — never drop the commodity / gather / producer set mid-flight
        // by a tiny cap; callers pass focused refs.
        if (blocks.length >= Math.max(1, limit)) {
            return;
        }
        seen.add(block.id);
        blocks.push(block);
    };

    push(itemBlockFromOutput(entry, catalogs));

    const pushStructure = (ref: FoxholeProductionDescribeStructureRef | null | undefined) => {
        const structureId = normalizeKey(ref?.structureId);
        if (!structureId) {
            return;
        }
        const label = normalizeKey(ref?.structureName) || normalizeKey(ref?.label) || structureId;
        push(itemBlockFromOutput({
            commodityKey: `build:structure:${structureId}`,
            label,
            channel: 'build',
            resourceId: `structure:${structureId}`,
        }, catalogs));
    };

    const pushItem = (ref: FoxholeProductionDescribeItemRef | null | undefined) => {
        const resourceId = normalizeKey(ref?.resourceId);
        const channel = normalizeKey(ref?.channel).toLowerCase() || 'item';
        if (!resourceId) {
            return;
        }
        push(itemBlockFromOutput({
            commodityKey: normalizeKey(ref?.commodityKey) || `${channel}:${resourceId}`,
            label: normalizeKey(ref?.label) || resourceId,
            channel,
            resourceId,
        }, catalogs));
    };

    for (const source of refs.gatherSources ?? []) {
        pushStructure(source);
    }
    for (const producer of refs.producers ?? []) {
        pushStructure(producer);
    }
    for (const related of refs.relatedItems ?? []) {
        pushItem(related);
    }
    for (const related of refs.relatedStructures ?? []) {
        pushStructure(related);
    }

    const includeConsumers = refs.preferGatherOverConsumers !== true
        || (refs.gatherSources?.length ?? 0) === 0;
    if (includeConsumers) {
        for (const consumer of refs.consumers ?? []) {
            pushStructure(consumer);
        }
    }

    return blocks;
}

export function buildFoxholeProductionItineraryUiBlocks(
    itinerary: FoxholeProductionItineraryResult,
    catalogs: {
        itemCatalog?: FoxholeItemCatalog | null;
        structureCatalog?: FoxholeStructureCatalog | null;
    },
): NxAssistantChatBlock[] {
    const blocks: NxAssistantChatBlock[] = [];
    const seen = new Set<string>();

    const push = (block: NxAssistantChatBlock | null) => {
        if (!block || seen.has(block.id)) {
            return;
        }
        seen.add(block.id);
        blocks.push(block);
    };

    push(itemBlockFromOutput(itinerary.goal, catalogs));

    for (const leaf of itinerary.leafRequirements) {
        push(itemBlockFromOutput(leaf, catalogs));
        for (const source of leaf.gatherSources ?? []) {
            const structureId = normalizeKey(source.structureId);
            if (!structureId) {
                continue;
            }
            push(itemBlockFromOutput({
                commodityKey: `build:structure:${structureId}`,
                label: source.label,
                channel: 'build',
                resourceId: `structure:${structureId}`,
            }, catalogs));
        }
    }

    for (const step of itinerary.steps) {
        if (step.resourceId && step.channel) {
            push(itemBlockFromOutput({
                commodityKey: step.commodityKey || `${step.channel}:${step.resourceId}`,
                label: step.resourceId,
                channel: step.channel,
                resourceId: step.resourceId,
                ...(step.isWorldStructure ? { isWorldStructure: true } : {}),
            }, catalogs));
        }
        const stepStructureId = normalizeKey(step.structureId);
        if (stepStructureId) {
            push(itemBlockFromOutput({
                commodityKey: `build:structure:${stepStructureId}`,
                label: normalizeKey(step.structureName) || stepStructureId,
                channel: 'build',
                resourceId: `structure:${stepStructureId}`,
            }, catalogs));
        }
        const recipeId = normalizeKey(step.recipeId);
        if (recipeId) {
            push({
                id: `recipe:${recipeId}`,
                kind: 'recipe',
                recipeId,
                label: recipeDisplayLabel(step.title, step.structureName, recipeId),
                structureId: step.structureId,
            });
        }
    }

    for (const producer of itinerary.producers) {
        const producerStructureId = normalizeKey(producer.structureId);
        if (producerStructureId) {
            push(itemBlockFromOutput({
                commodityKey: `build:structure:${producerStructureId}`,
                label: normalizeKey(producer.structureName) || producerStructureId,
                channel: 'build',
                resourceId: `structure:${producerStructureId}`,
            }, catalogs));
        }
        const recipeId = normalizeKey(producer.recipeId);
        if (recipeId) {
            push({
                id: `recipe:${recipeId}`,
                kind: 'recipe',
                recipeId,
                label: recipeDisplayLabel(producer.label, producer.structureName, recipeId),
                structureId: producer.structureId,
            });
        }
    }

    for (const choice of itinerary.pendingChoices) {
        for (const option of choice.options.slice(0, 4)) {
            const recipeId = normalizeKey(option.recipeId);
            if (recipeId) {
                push({
                    id: `recipe:${recipeId}`,
                    kind: 'recipe',
                    recipeId,
                    label: recipeDisplayLabel(option.label, option.structureName, recipeId),
                    structureId: option.structureId,
                });
            }
            const structureId = normalizeKey(option.structureId);
            if (structureId) {
                push(itemBlockFromOutput({
                    commodityKey: `build:structure:${structureId}`,
                    label: normalizeKey(option.structureName) || structureId,
                    channel: 'build',
                    resourceId: `structure:${structureId}`,
                }, catalogs));
            }
            for (const input of option.inputSummary ?? []) {
                const commodityKey = normalizeKey(input.commodityKey);
                const match = commodityKey.match(/^(item|crate|liquid|build):(.+)$/i);
                if (!match) {
                    continue;
                }
                push(itemBlockFromOutput({
                    commodityKey,
                    label: normalizeKey(input.label) || match[2]!,
                    channel: match[1]!.toLowerCase(),
                    resourceId: match[2]!,
                }, catalogs));
            }
        }
    }

    const needsConstructionVehicle = Boolean(itinerary.goal.isWorldStructure)
        || itinerary.steps.some(step => step.isWorldStructure);
    if (needsConstructionVehicle) {
        push(constructionVehicleBlock(catalogs));
    }

    return blocks;
}
