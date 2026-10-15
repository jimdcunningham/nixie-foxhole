/**
 * Facility power aggregation for statistics.
 * Manifest `powerGridInfo.powerDelta` is milliwatts-scale (legacy `/ 1000` → MW).
 */

export interface FoxholeFacilityPowerBreakdown {
    producedMw: number;
    consumedMw: number;
    netMw: number;
}

export function createEmptyFoxholeFacilityPowerBreakdown(): FoxholeFacilityPowerBreakdown {
    return {
        producedMw: 0,
        consumedMw: 0,
        netMw: 0,
    };
}

export function resolveFoxholePowerDeltaMw(powerDelta: number | null | undefined): number {
    const raw = Number(powerDelta ?? NaN);
    if (!Number.isFinite(raw) || raw === 0) {
        return 0;
    }

    return raw / 1000;
}

export function accumulateFoxholeFacilityPower(
    breakdown: FoxholeFacilityPowerBreakdown,
    powerDeltaMw: number,
): void {
    if (!Number.isFinite(powerDeltaMw) || powerDeltaMw === 0) {
        return;
    }

    breakdown.netMw += powerDeltaMw;
    if (powerDeltaMw > 0) {
        breakdown.producedMw += powerDeltaMw;
        return;
    }

    breakdown.consumedMw += Math.abs(powerDeltaMw);
}
