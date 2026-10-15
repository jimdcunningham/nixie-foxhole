export const HOURLY_CASUALTY_SAMPLE_INTERVAL_MS = 150_000;
export const HOURLY_CASUALTY_WINDOW_MS = 3_600_000;

export interface FactionCasualtySummary {
    totalCasualties: number;
    totalHourlyCasualties: number | null;
}

export function getHourlyCasualtyRingCapacity(
    sampleIntervalMs = HOURLY_CASUALTY_SAMPLE_INTERVAL_MS,
): number {
    return HOURLY_CASUALTY_WINDOW_MS / sampleIntervalMs;
}

export function isHourlyCasualtyRingWarm(
    casualtyValues: readonly number[],
    requiredSampleCount = getHourlyCasualtyRingCapacity(),
): boolean {
    return casualtyValues.length >= requiredSampleCount;
}

export function computeHourlyCasualties(
    totalCasualties: number,
    casualtyValues: readonly number[],
): number | null {
    if (!isHourlyCasualtyRingWarm(casualtyValues)) {
        return null;
    }

    const values = casualtyValues.filter((value): value is number => Number.isFinite(value) && value >= 0);
    if (!values.length) {
        return null;
    }

    let totalHourlyCasualties = values.reduce((total, value) => total + value, 0);
    if (totalHourlyCasualties === totalCasualties) {
        totalHourlyCasualties = Math.ceil(totalHourlyCasualties / values.length);
    }

    return totalHourlyCasualties;
}

export function buildFactionCasualtySummary(
    totalCasualties: number,
    casualtyValues: readonly number[] | undefined,
): FactionCasualtySummary {
    return {
        totalCasualties,
        totalHourlyCasualties: computeHourlyCasualties(totalCasualties, casualtyValues ?? []),
    };
}
