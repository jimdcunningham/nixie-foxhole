/**
 * Facility liquid volume (liters) for statistics.
 * Prefer published `liquidCapacity` (MaxLiquidAmount). Fallbacks cover legacy keys
 * until the next FoxWatch extract/refresh lands those values for every client.
 */

const LIQUID_SILO_KEYS = new Set([
    'facilitysilooil',
    'fuel_silo',
    'fuelsilo',
]);

const LIQUID_PIPELINE_KEYS = new Set([
    'facilitypipe',
    'facilitypipeoverhead',
    'facilitypipeunderground',
    'pipeline',
    'pipeline_overhead',
    'pipeline_underground',
]);

/** Legacy MaxLiquidAmount values by foxhole / legacy key. */
const LIQUID_CAPACITY_FALLBACKS: Record<string, number> = {
    facilitysilooil: 5000,
    fuel_silo: 5000,
    fuelsilo: 5000,
    facilitypipe: 100,
    facilitypipeoverhead: 100,
    facilitypipeunderground: 50,
    pipeline: 100,
    pipeline_overhead: 100,
    pipeline_underground: 50,
};

export type FoxholeLiquidCapacityKind = 'silo' | 'pipeline' | 'other';

export interface FoxholeLiquidCapacityBreakdown {
    total: number;
    silo: number;
    pipeline: number;
}

function normalizeLiquidCapacityKey(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

export function resolveFoxholeLiquidCapacityKind(
    foxholeKey: string,
    codeName?: string | null,
    legacyKey?: string | null,
): FoxholeLiquidCapacityKind {
    const keys = [foxholeKey, codeName, legacyKey].map(normalizeLiquidCapacityKey).filter(Boolean);
    if (keys.some(key => LIQUID_SILO_KEYS.has(key))) {
        return 'silo';
    }
    if (keys.some(key => LIQUID_PIPELINE_KEYS.has(key))) {
        return 'pipeline';
    }
    return 'other';
}

export function resolveFoxholeStructureLiquidCapacity(options: {
    foxholeKey: string;
    codeName?: string | null;
    legacyKey?: string | null;
    liquidCapacity?: number | null;
}): number {
    const published = Number(options.liquidCapacity ?? NaN);
    if (Number.isFinite(published) && published > 0) {
        return published;
    }

    for (const candidate of [options.foxholeKey, options.codeName, options.legacyKey]) {
        const fallback = LIQUID_CAPACITY_FALLBACKS[normalizeLiquidCapacityKey(candidate)];
        if (typeof fallback === 'number' && fallback > 0) {
            return fallback;
        }
    }

    return 0;
}

export function accumulateFoxholeLiquidCapacity(
    breakdown: FoxholeLiquidCapacityBreakdown,
    amount: number,
    kind: FoxholeLiquidCapacityKind,
): void {
    if (!(amount > 0)) {
        return;
    }

    breakdown.total += amount;
    if (kind === 'silo') {
        breakdown.silo += amount;
    } else if (kind === 'pipeline') {
        breakdown.pipeline += amount;
    }
}

export function createEmptyFoxholeLiquidCapacityBreakdown(): FoxholeLiquidCapacityBreakdown {
    return {
        total: 0,
        silo: 0,
        pipeline: 0,
    };
}
