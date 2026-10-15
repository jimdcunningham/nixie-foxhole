import type { FoxholeManifestStructure } from '../manifest.ts';
import { getFoxholeProductionIndex } from './index.ts';
import { resolveFoxholePowerDeltaMw } from '../facility-power.ts';
import type { FoxholeProductionChannel, FoxholeProductionIndex, FoxholeProductionRecipe } from './types.ts';
import { clampFoxholeStructureProductionOrders, resolveFoxholeStructureMaxOrders } from './orders.ts';
import type { FoxholeStructureProductionOrder } from '../types.ts';

export type FoxholeProductionAggregateResource = {
    channel: Exclude<FoxholeProductionChannel, 'build'>;
    resourceId: string;
    quantity: number;
};

export type FoxholeResolvedStructureProductionOrder = FoxholeStructureProductionOrder & {
    recipe: FoxholeProductionRecipe;
    completedCycles: number;
};

export type FoxholeStructureProductionInput = {
    nodeId: string;
    state?: {
        foxholeKey?: unknown;
        productionOrders?: unknown;
        disableProduction?: unknown;
        modificationVariantIds?: unknown;
    } | null;
};

export type FoxholeProductionAggregate = {
    inputs: FoxholeProductionAggregateResource[];
    outputs: FoxholeProductionAggregateResource[];
    orders: Array<FoxholeResolvedStructureProductionOrder & { nodeId: string; }>;
    activeOrderCount: number;
    powerMw: number;
    powerMwByNodeId: Partial<Record<string, number>>;
};

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function hasLegacyAlwaysPoweredFacility(foxholeKey: string): boolean {
    const compact = normalizeKey(foxholeKey).replace(/[_-]/g, '').toLowerCase();
    return compact === 'fieldmodificationcenter' || compact === 'bmsforemanstacker';
}

function resourceKey(channel: string, resourceId: string): string {
    return `${channel}:${resourceId}`;
}

function addResources(
    store: Map<string, FoxholeProductionAggregateResource>,
    source: Record<string, { quantity: number; }> | undefined,
    channel: Exclude<FoxholeProductionChannel, 'build'>,
    multiplier: number,
): void {
    for (const [resourceId, resource] of Object.entries(source ?? {})) {
        const quantity = Number(resource?.quantity ?? 0) * multiplier;
        if (!Number.isFinite(quantity) || quantity <= 0) {
            continue;
        }
        const id = normalizeKey(resourceId);
        if (!id) {
            continue;
        }
        const key = resourceKey(channel, id);
        const existing = store.get(key);
        if (existing) {
            existing.quantity += quantity;
        } else {
            store.set(key, { channel, resourceId: id, quantity });
        }
    }
}

function sortResources(resources: Iterable<FoxholeProductionAggregateResource>): FoxholeProductionAggregateResource[] {
    return [...resources]
        .filter(entry => entry.quantity > 0)
        .sort((left, right) => (
            left.channel.localeCompare(right.channel) || left.resourceId.localeCompare(right.resourceId)
        ));
}

/** Completed whole recipe cycles in the selected statistics interval, capped by the queued order. */
export function resolveFoxholeProductionCompletedCycles(
    durationSeconds: number | null | undefined,
    intervalSeconds: number,
    orderCycles: number | null | undefined,
): number {
    const duration = Number(durationSeconds ?? 0);
    const cyclesInInterval = Number.isFinite(duration) && duration > 0
        ? Math.floor(intervalSeconds / duration)
        : 0;
    return Math.min(cyclesInInterval, orderCycles ?? Number.POSITIVE_INFINITY);
}

export function resolveFoxholeStructureProductionOrders(options: {
    state: FoxholeStructureProductionInput['state'];
    structure: Pick<FoxholeManifestStructure, 'id' | 'parentStructureId' | 'maxOrders'>;
    baseAssetsUrl: string;
    intervalSeconds: number;
    productionIndex?: FoxholeProductionIndex;
}): FoxholeResolvedStructureProductionOrder[] {
    if (options.state?.disableProduction === true) {
        return [];
    }
    const index = options.productionIndex ?? getFoxholeProductionIndex(options.baseAssetsUrl);
    const orders = clampFoxholeStructureProductionOrders(options.state?.productionOrders, resolveFoxholeStructureMaxOrders(options.structure));
    const structureId = normalizeKey(options.structure.id);
    const parentStructureId = normalizeKey(options.structure.parentStructureId);
    return orders.flatMap(order => {
        const recipe = index.recipeById[order.recipeId];
        const expectedStructureId = order.parent ? parentStructureId : structureId;
        const selectedVariants = options.state?.modificationVariantIds && typeof options.state.modificationVariantIds === 'object'
            ? Object.values(options.state.modificationVariantIds as Record<string, unknown>).map(normalizeKey)
            : [];
        const isAllowed = recipe?.sourceType === 'structure'
            ? recipe.sourceStructureId === expectedStructureId
            : (!order.parent && recipe?.sourceStructureId === structureId && selectedVariants.includes(normalizeKey(recipe.sourceVariantId)));
        if (!recipe || !isAllowed) {
            return [];
        }
        const completedCycles = resolveFoxholeProductionCompletedCycles(
            recipe.durationSeconds,
            options.intervalSeconds,
            order.cycles,
        );
        return completedCycles > 0 ? [{ ...order, recipe, completedCycles }] : [];
    });
}

/** Legacy-compatible production totals for a scene scope. */
export function aggregateFoxholeProduction(options: {
    nodes: readonly FoxholeStructureProductionInput[];
    structureByKey: Readonly<Record<string, FoxholeManifestStructure>>;
    baseAssetsUrl: string;
    intervalSeconds: number;
    productionIndex?: FoxholeProductionIndex;
}): FoxholeProductionAggregate {
    const inputs = new Map<string, FoxholeProductionAggregateResource>();
    const outputs = new Map<string, FoxholeProductionAggregateResource>();
    const orders: FoxholeProductionAggregate['orders'] = [];
    let powerMw = 0;
    const powerMwByNodeId: FoxholeProductionAggregate['powerMwByNodeId'] = {};

    for (const node of options.nodes) {
        const foxholeKey = normalizeKey(node.state?.foxholeKey);
        const structure = options.structureByKey[foxholeKey] ?? options.structureByKey[foxholeKey.toLowerCase()];
        if (!structure || node.state?.disableProduction === true) {
            continue;
        }
        const resolved = resolveFoxholeStructureProductionOrders({
            state: node.state,
            structure,
            baseAssetsUrl: options.baseAssetsUrl,
            intervalSeconds: options.intervalSeconds,
            productionIndex: options.productionIndex,
        });
        let structurePower: number | null = null;
        for (const order of resolved) {
            orders.push({ ...order, nodeId: node.nodeId });
            addResources(inputs, order.recipe.itemInput, 'item', order.completedCycles);
            addResources(inputs, order.recipe.crateInput, 'crate', order.completedCycles);
            addResources(inputs, order.recipe.liquidInput, 'liquid', order.completedCycles);
            addResources(outputs, order.recipe.itemOutput, 'item', order.completedCycles);
            addResources(outputs, order.recipe.crateOutput, 'crate', order.completedCycles);
            addResources(outputs, order.recipe.liquidOutput, 'liquid', order.completedCycles);
            const recipePower = resolveFoxholePowerDeltaMw(order.recipe.powerDelta);
            if (recipePower !== 0) {
                structurePower = structurePower === null ? recipePower : Math.min(structurePower, recipePower);
            }
        }
        if (resolved.length === 0 && hasLegacyAlwaysPoweredFacility(foxholeKey)) {
            const idlePower = resolveFoxholePowerDeltaMw(structure.powerGridInfo?.powerDelta);
            if (idlePower !== 0) {
                structurePower = idlePower;
            }
        }
        powerMw += structurePower ?? 0;
        if (structurePower !== null) {
            powerMwByNodeId[node.nodeId] = structurePower;
        }
    }

    // Net only identical channel/resource pairs; crates and liquids are not interchangeable with items.
    for (const [key, input] of inputs) {
        const output = outputs.get(key);
        if (!output) {
            continue;
        }
        const net = input.quantity - output.quantity;
        if (net > 0) {
            input.quantity = net;
            outputs.delete(key);
        } else if (net < 0) {
            output.quantity = -net;
            inputs.delete(key);
        } else {
            inputs.delete(key);
            outputs.delete(key);
        }
    }

    return {
        inputs: sortResources(inputs.values()),
        outputs: sortResources(outputs.values()),
        orders,
        activeOrderCount: orders.length,
        powerMw,
        powerMwByNodeId,
    };
}
