import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeStatisticsRecipe } from './production-statistics.ts';
import { filterFoxholeSameWallInfrastructureSelections } from './modification-wall-conflicts.ts';
import type { FoxholeWallModificationSlot } from './modification-wall-conflicts.ts';

export interface FoxholeResourceStatisticsMetadata {
    cost: Record<string, number>;
    modificationCosts: Record<string, Record<string, Record<string, number>>>;
    parentId?: string | null;
    upgradeCodeName?: string;
    canBackfillUpgrade?: boolean;
    legacyKey?: string;
    liquidCapacity?: number | null;
    powerDelta?: number | null;
    decays?: boolean | null;
    decaySupplyDrain?: number | null;
    repairCost?: number | null;
    inventorySlots?: number | null;
    fuelCapacity: number;
    structuralIntegrity?: number | null;
}

export interface FoxholeResourceStatisticsAsset {
    modifications?: Record<string, FoxholeWallModificationSlot>;
    codeName: string;
    isItem: boolean;
    isUpgrade?: boolean;
    isDestroyed?: boolean;
    isBreached?: boolean;
    isVehicle?: boolean;
    isFacility?: boolean;
    isBunker?: boolean;
    statistics?: FoxholeResourceStatisticsMetadata;
}

export function normalizeFoxholeStatisticsCost(source: Record<string, unknown> | undefined): Record<string, number> {
    return Object.fromEntries(Object.entries(source ?? {}).flatMap(([id, value]) => {
        const resource = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        const quantity = resource.quantity ?? resource.q;
        return typeof quantity === 'number' && Number.isFinite(quantity) ? [[id, quantity]] : [];
    }));
}

/** Resolve the same canonical production route and upgrade ancestry used by the bundled catalog. */
export function resolveFoxholeStatisticsCosts(assets: Record<string, FoxholeResourceStatisticsAsset>, recipes: Record<string, FoxholeStatisticsRecipe>): void {
    const byCode = new Map(Object.entries(assets).map(([id, asset]) => [asset.codeName.toLowerCase(), id]));
    const order = new Map(Object.keys(assets).map((id, index) => [id, index]));
    const routes = Object.values(recipes).sort((a, b) => (order.get(a.sourceStructureId) ?? 0) - (order.get(b.sourceStructureId) ?? 0)
        || Number(a.sourceType === 'modification') - Number(b.sourceType === 'modification'));
    const downgrade = new Map<string, string>();
    for (const [id, asset] of Object.entries(assets)) {
        if (asset.isItem || !asset.statistics) {
            continue;
        }
        const target = byCode.get((asset.statistics.upgradeCodeName ?? '').trim().toLowerCase());
        if (target && target !== id && asset.statistics.canBackfillUpgrade && !downgrade.has(target)) {
            downgrade.set(target, id);
        }
        let derived: Record<string, number> | null = null;
        const seen = new Set<string>();
        for (const key of [asset.codeName, id, asset.statistics.legacyKey].filter((value): value is string => !!value)) {
            for (const channel of ['item', 'crate', 'liquid'] as const) {
                for (const recipe of routes) {
                    const output = recipe[`${channel}Output`][key];
                    if (!output || output <= 0 || seen.has(recipe.id)) {
                        continue;
                    }
                    seen.add(recipe.id);
                    const cost: Record<string, number> = {};
                    for (const inputs of [recipe.itemInput, recipe.crateInput, recipe.liquidInput]) {
                        for (const [resourceId, quantity] of Object.entries(inputs)) {
                            if (quantity > 0) {
                                cost[resourceId] = (cost[resourceId] ?? 0) + quantity / output;
                            }
                        }
                    }
                    if (Object.keys(cost).length) {
                        derived = cost;
                        break;
                    }
                }
                if (derived) {
                    break;
                }
            }
            if (derived) {
                break;
            }
        }
        if (derived) {
            asset.statistics.cost = derived;
        }
    }
    const resolved = new Map<string, Record<string, number>>();
    const resolve = (id: string, seen: Set<string>): Record<string, number> => {
        if (resolved.has(id)) {
            return resolved.get(id)!;
        }
        const asset = assets[id];
        if (!asset?.statistics) {
            return {};
        }
        const parentId = downgrade.get(id) ?? asset.statistics.parentId;
        const cost = parentId && !seen.has(parentId) && assets[parentId]
            ? { ...resolve(parentId, new Set([...seen, id])) }
            : {};
        for (const [resourceId, quantity] of Object.entries(asset.statistics.cost)) {
            cost[resourceId] = (cost[resourceId] ?? 0) + quantity;
        }
        resolved.set(id, cost);
        asset.statistics.cost = cost;
        return cost;
    };
    for (const [id, asset] of Object.entries(assets)) {
        if (!asset.isItem) {
            resolve(id, new Set());
        }
    }
}

const siloKeys = new Set(['facilitysilooil', 'fuel_silo', 'fuelsilo']);
const pipelineKeys = new Set(['facilitypipe', 'facilitypipeoverhead', 'facilitypipeunderground', 'pipeline', 'pipeline_overhead', 'pipeline_underground']);
const capacityFallbacks: Record<string, number> = { facilitysilooil: 5000, fuel_silo: 5000, fuelsilo: 5000,
    facilitypipe: 100, facilitypipeoverhead: 100, facilitypipeunderground: 50, pipeline: 100, pipeline_overhead: 100, pipeline_underground: 50 };
const finite = (value: number | null | undefined) => Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0;

export function aggregateFoxholeEcsResources(entities: readonly NixieExperimentalComponentEntitySnapshotV1[],
    assets: Readonly<Record<string, FoxholeResourceStatisticsAsset>>, intervalSeconds: number) {
    const costs = new Map<string, number>();
    const result = { structureCount: 0, vehicles: 0, facilities: 0, bunkers: 0, missingCostCount: 0,
        liquid: { total: 0, silo: 0, pipeline: 0 }, power: { producedMw: 0, consumedMw: 0, netMw: 0 },
        maintenancePerHour: 0, maintenanceSupplies: 0, repairCost: 0, inventorySlots: 0, fuelCapacity: 0, structuralIntegrity: null as number | null,
        costs: [] as Array<{ resourceId: string; quantity: number; }> };
    let integrityTotal = 0;
    let integrityCount = 0;
    for (const entity of entities) {
        const component = (id: string) => entity.components.find(value => value.ownerId === 'nixie.foxhole-planner' && value.componentId === id && value.definitionAvailable)?.data;
        const id = component('asset')?.assetId;
        const asset = typeof id === 'string' ? assets[id] : null;
        const stats = asset?.statistics;
        if (!asset || asset.isItem || !stats) {
            continue;
        }
        result.structureCount += 1;
        if (asset.isVehicle) {
            result.vehicles += 1;
        }
        if (asset.isFacility) {
            result.facilities += 1;
        }
        if (asset.isBunker) {
            result.bunkers += 1;
        }
        const selections = component('modification')?.selections;
        const selected = new Map(filterFoxholeSameWallInfrastructureSelections(asset.modifications ?? {}, Array.isArray(selections)
            ? selections.flatMap(value => value && typeof value === 'object' && !Array.isArray(value)
                && typeof value.slotId === 'string' && typeof value.variantId === 'string'
                ? [{ slotId: value.slotId.trim(), variantId: value.variantId.trim() }]
                : [])
            : []).map(value => [value.slotId, value.variantId]));
        const sources = [stats.cost, ...Object.entries(stats.modificationCosts).flatMap(([slotId, variants]) => {
            const variant = selected.get(slotId);
            return variant && variants[variant] ? [variants[variant]!] : [];
        })];
        let published = false;
        for (const source of sources) {
            for (const [resourceId, quantity] of Object.entries(source)) {
                if (!Number.isFinite(quantity) || quantity <= 0) {
                    continue;
                }
                published = true;
                const key = resourceId.trim().toLowerCase();
                costs.set(key, (costs.get(key) ?? 0) + quantity);
            }
        }
        if (!published) {
            result.missingCostCount += 1;
        }
        const keys = [String(id), asset.codeName, stats.legacyKey ?? ''].map(value => value.trim().toLowerCase());
        const volume = finite(stats.liquidCapacity) > 0 ? finite(stats.liquidCapacity) : keys.map(key => capacityFallbacks[key] ?? 0).find(value => value > 0) ?? 0;
        result.liquid.total += volume;
        if (keys.some(key => siloKeys.has(key))) {
            result.liquid.silo += volume;
        } else if (keys.some(key => pipelineKeys.has(key))) {
            result.liquid.pipeline += volume;
        }
        const power = finite(stats.powerDelta) / 1000;
        result.power.netMw += power;
        if (power > 0) {
            result.power.producedMw += power;
        } else if (power < 0) {
            result.power.consumedMw -= power;
        }
        const drain = finite(stats.decaySupplyDrain);
        if (stats.decays === true || drain > 0) {
            result.maintenancePerHour += drain > 0 ? drain : 1;
        }
        result.repairCost += finite(stats.repairCost);
        result.inventorySlots += finite(stats.inventorySlots);
        result.fuelCapacity += stats.fuelCapacity;
        if (finite(stats.structuralIntegrity) > 0) {
            integrityTotal += finite(stats.structuralIntegrity);
            integrityCount += 1;
        }
    }
    result.maintenanceSupplies = intervalSeconds > 0 ? result.maintenancePerHour * intervalSeconds / 3600 : 0;
    result.structuralIntegrity = integrityCount ? integrityTotal / integrityCount : null;
    result.costs = [...costs].map(([resourceId, quantity]) => ({ resourceId, quantity })).sort((a, b) => a.resourceId.localeCompare(b.resourceId));
    return result;
}
