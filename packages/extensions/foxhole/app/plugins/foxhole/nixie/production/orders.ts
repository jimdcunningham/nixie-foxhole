import type { FoxholeStructureProductionOrder } from '../types.ts';

const DEFAULT_FACILITY_MAX_ORDERS = 5;
const LARGE_PRODUCTION_STRUCTURE_IDS = new Set([
    'facilityvehiclefactory1', // Small Assembly Station
    'facilityvehiclefactory2', // Large Assembly Station
    'facilityvehiclefactory3', // Dry Dock
    'facilitymodificationcenter', // Field Modification Center
    'rocketsite', // A0E-9 Rocket Platform
]);

function normalizedText(value: unknown): string {
    return String(value ?? '').trim();
}

/**
 * Facilities run up to five orders concurrently. The large-production sites
 * are the exception and only run one; explicit manifest data always wins.
 */
export function resolveFoxholeStructureMaxOrders(structure: {
    id?: unknown;
    maxOrders?: unknown;
} | null | undefined): number {
    const configured = Number(structure?.maxOrders);
    if (Number.isFinite(configured) && configured > 0) {
        return Math.floor(configured);
    }
    const id = normalizedText(structure?.id).toLowerCase();
    return LARGE_PRODUCTION_STRUCTURE_IDS.has(id) ? 1 : DEFAULT_FACILITY_MAX_ORDERS;
}

export function normalizeFoxholeStructureProductionOrders(value: unknown): FoxholeStructureProductionOrder[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return [];
        }
        const order = entry as Record<string, unknown>;
        const recipeId = normalizedText(order.recipeId);
        if (!recipeId) {
            return [];
        }
        const cyclesValue = Number(order.cycles);
        const label = normalizedText(order.label);
        return [{
            recipeId,
            parent: order.parent === true,
            cycles: Number.isFinite(cyclesValue) && cyclesValue > 0 ? cyclesValue : null,
            label: label || null,
        }];
    });
}

export function clampFoxholeStructureProductionOrders(
    value: unknown,
    maxOrders: number | null | undefined,
): FoxholeStructureProductionOrder[] {
    const orders = normalizeFoxholeStructureProductionOrders(value);
    const max = Number(maxOrders);
    return Number.isFinite(max) && max > 0 ? orders.slice(0, Math.floor(max)) : orders.slice(0, DEFAULT_FACILITY_MAX_ORDERS);
}
