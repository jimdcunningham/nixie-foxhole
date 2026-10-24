import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalComponentJsonObjectV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';

export interface FoxholePublishedProductionEntry {
    duration?: number | null; d?: number | null;
    powerDelta?: number | null; p?: number | null;
    itemInput?: Record<string, unknown>; ii?: Record<string, unknown>;
    crateInput?: Record<string, unknown>; ci?: Record<string, unknown>;
    liquidInput?: Record<string, unknown>; li?: Record<string, unknown>;
    itemOutput?: Record<string, unknown>; io?: Record<string, unknown>;
    crateOutput?: Record<string, unknown>; co?: Record<string, unknown>;
    liquidOutput?: Record<string, unknown>; lo?: Record<string, unknown>;
}

export interface FoxholeStatisticsRecipe {
    id: string;
    sourceType: 'structure' | 'modification';
    sourceStructureId: string;
    sourceVariantId: string | null;
    durationSeconds: number | null;
    powerDelta: number | null;
    itemInput: Record<string, number>; crateInput: Record<string, number>; liquidInput: Record<string, number>;
    itemOutput: Record<string, number>; crateOutput: Record<string, number>; liquidOutput: Record<string, number>;
}

export interface FoxholeStatisticsStructure {
    maxOrders?: number | null;
    parentStructureId?: string | null;
    powerDelta?: number | null;
}

function quantities(resources: Record<string, unknown> | undefined): Record<string, number> {
    return Object.fromEntries(Object.entries(resources ?? {}).flatMap(([key, value]) => {
        const resource = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        const quantity = resource.quantity ?? resource.q;
        return key.trim() && typeof quantity === 'number' && Number.isFinite(quantity) ? [[key.trim(), quantity]] : [];
    }));
}

export function createFoxholeStatisticsRecipe(id: string, structureId: string, entry: FoxholePublishedProductionEntry,
    variantId: string | null = null): FoxholeStatisticsRecipe {
    const duration = entry.duration ?? entry.d;
    const power = entry.powerDelta ?? entry.p;
    return { id, sourceType: variantId === null ? 'structure' : 'modification', sourceStructureId: structureId, sourceVariantId: variantId,
        durationSeconds: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
        powerDelta: typeof power === 'number' && Number.isFinite(power) ? power : null,
        itemInput: quantities(entry.itemInput ?? entry.ii), crateInput: quantities(entry.crateInput ?? entry.ci), liquidInput: quantities(entry.liquidInput ?? entry.li),
        itemOutput: quantities(entry.itemOutput ?? entry.io), crateOutput: quantities(entry.crateOutput ?? entry.co), liquidOutput: quantities(entry.liquidOutput ?? entry.lo) };
}

export interface FoxholeStatisticsResource { channel: 'item' | 'crate' | 'liquid'; resourceId: string; quantity: number; }
export interface FoxholeStatisticsOrder { entityId: string; recipeId: string; completedCycles: number; }
export const FOXHOLE_STATISTICS_INTERVALS = [
    { id: '15m', label: '15 Minutes', seconds: 900 }, { id: '30m', label: '30 Minutes', seconds: 1800 },
    { id: '1h', label: '1 Hour', seconds: 3600 }, { id: '3h', label: '3 Hours', seconds: 10800 },
    { id: '6h', label: '6 Hours', seconds: 21600 }, { id: '12h', label: '12 Hours', seconds: 43200 },
    { id: '24h', label: '24 Hours', seconds: 86400 }, { id: '3d', label: '3 Days', seconds: 259200 },
] as const;
const singleOrderStructures = new Set(['facilityvehiclefactory1', 'facilityvehiclefactory2', 'facilityvehiclefactory3', 'facilitymodificationcenter', 'rocketsite']);

export function aggregateFoxholeEcsProduction(entities: readonly NixieExperimentalComponentEntitySnapshotV1[],
    assets: Readonly<Record<string, { production?: FoxholeStatisticsStructure; }>>, recipes: Readonly<Record<string, FoxholeStatisticsRecipe>>, intervalSeconds: number) {
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
        throw new Error('The production interval is invalid.');
    }
    const inputs = new Map<string, FoxholeStatisticsResource>();
    const outputs = new Map<string, FoxholeStatisticsResource>();
    const orders: FoxholeStatisticsOrder[] = [];
    let powerMw = 0;
    const add = (store: Map<string, FoxholeStatisticsResource>, source: Record<string, number>, channel: FoxholeStatisticsResource['channel'], cycles: number) => {
        for (const [resourceId, amount] of Object.entries(source)) {
            const quantity = amount * cycles;
            if (!Number.isFinite(quantity) || quantity <= 0) {
                continue;
            }
            const key = `${channel}:${resourceId}`;
            const existing = store.get(key);
            if (existing) {
                existing.quantity += quantity;
            } else {
                store.set(key, { channel, resourceId, quantity });
            }
        }
    };
    for (const entity of entities) {
        const data = (componentId: string) => entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
            && component.componentId === componentId && component.definitionAvailable)?.data;
        const assetId = data('asset')?.assetId;
        const asset = typeof assetId === 'string' ? assets[assetId] : undefined;
        const production = data('production-order');
        if (!asset || production?.disabled === true) {
            continue;
        }
        const structure = asset.production ?? {};
        const maximum = Number(structure.maxOrders);
        const limit = Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : singleOrderStructures.has(String(assetId).toLowerCase()) ? 1 : 5;
        const selections = data('modification')?.selections;
        const variants = Array.isArray(selections)
            ? selections.flatMap(value => value && typeof value === 'object' && !Array.isArray(value)
                && typeof value.variantId === 'string'
                ? [value.variantId.trim()]
                : [])
            : [];
        const configured = Array.isArray(production?.orders)
            ? production.orders.filter((value): value is NixieExperimentalComponentJsonObjectV1 =>
                value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.recipeId === 'string' && !!value.recipeId.trim()).slice(0, limit)
            : [];
        let structurePower: number | null = null;
        let active = 0;
        for (const order of configured) {
            const recipe = recipes[String(order.recipeId).trim()];
            const expectedId = order.parent === true ? structure.parentStructureId : assetId;
            const allowed = recipe?.sourceType === 'structure'
                ? recipe.sourceStructureId === expectedId
                : order.parent !== true && recipe?.sourceStructureId === assetId && variants.includes(recipe.sourceVariantId ?? '');
            if (!recipe || !allowed) {
                continue;
            }
            const available = recipe.durationSeconds !== null && recipe.durationSeconds > 0 ? Math.floor(intervalSeconds / recipe.durationSeconds) : 0;
            const requested = Number(order.cycles);
            const completedCycles = Math.min(available, Number.isFinite(requested) && requested > 0 ? requested : Infinity);
            if (completedCycles <= 0) {
                continue;
            }
            orders.push({ entityId: entity.entityId, recipeId: recipe.id, completedCycles });
            active += 1;
            for (const channel of ['item', 'crate', 'liquid'] as const) {
                add(inputs, recipe[`${channel}Input`], channel, completedCycles);
                add(outputs, recipe[`${channel}Output`], channel, completedCycles);
            }
            const power = (recipe.powerDelta ?? 0) / 1000;
            if (power !== 0) {
                structurePower = structurePower === null ? power : Math.min(structurePower, power);
            }
        }
        const compact = String(assetId).replace(/[_-]/g, '').toLowerCase();
        if (active === 0 && ['fieldmodificationcenter', 'bmsforemanstacker'].includes(compact)) {
            structurePower = (structure.powerDelta ?? 0) / 1000;
        }
        powerMw += structurePower ?? 0;
    }
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
    const sorted = (values: Iterable<FoxholeStatisticsResource>) => [...values].filter(value => value.quantity > 0)
        .sort((a, b) => a.channel.localeCompare(b.channel) || a.resourceId.localeCompare(b.resourceId));
    return { inputs: sorted(inputs.values()), outputs: sorted(outputs.values()), orders, activeOrderCount: orders.length, powerMw };
}
