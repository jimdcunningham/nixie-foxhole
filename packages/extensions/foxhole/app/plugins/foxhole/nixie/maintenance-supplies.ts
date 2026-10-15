/**
 * Building maintenance supply aggregation for statistics.
 * Legacy: decays structures cost `(decaySupplyDrain ?? 1) * floor(seconds / 3600)` MS.
 * We use fractional hours so sub-hour intervals still produce meaningful totals.
 */

export const FOXHOLE_MAINTENANCE_SUPPLIES_RESOURCE_KEY = 'maintenancesupplies';

export interface FoxholeMaintenanceIntervalOption {
    id: string;
    label: string;
    seconds: number;
}

/** Presets aligned with the legacy statistics time menu. */
export const FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS: readonly FoxholeMaintenanceIntervalOption[] = [
    { id: '15m', label: '15 Minutes', seconds: 900 },
    { id: '30m', label: '30 Minutes', seconds: 1800 },
    { id: '1h', label: '1 Hour', seconds: 3600 },
    { id: '3h', label: '3 Hours', seconds: 10800 },
    { id: '6h', label: '6 Hours', seconds: 21600 },
    { id: '12h', label: '12 Hours', seconds: 43200 },
    { id: '24h', label: '24 Hours', seconds: 86400 },
    { id: '3d', label: '3 Days', seconds: 259200 },
];

export const FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID = '1h';
export const FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID = 'custom';
export const FOXHOLE_MAX_CUSTOM_INTERVAL_SECONDS = 30 * 86400;

export function normalizeFoxholeCustomIntervalSeconds(value: number | null | undefined): number | null {
    if (value == null || !Number.isFinite(value) || value <= 0) {
        return null;
    }

    return Math.max(1, Math.min(Math.round(value), FOXHOLE_MAX_CUSTOM_INTERVAL_SECONDS));
}

export function resolveFoxholeMaintenanceIntervalSeconds(
    intervalId: string | null | undefined,
    customSeconds?: number | null,
): number {
    const normalized = String(intervalId ?? '').trim().toLowerCase();
    if (normalized === FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID) {
        return normalizeFoxholeCustomIntervalSeconds(customSeconds)
            ?? resolveFoxholeMaintenanceIntervalSeconds(FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID);
    }
    const match = FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS.find(option => option.id === normalized);
    return match?.seconds
        ?? FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS.find(option => option.id === FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID)!.seconds;
}

export function formatFoxholeMaintenanceIntervalLabel(
    intervalId: string | null | undefined,
    customSeconds?: number | null,
): string {
    const normalized = String(intervalId ?? '').trim().toLowerCase();
    const preset = FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS.find(option => option.id === normalized);
    if (preset) {
        return preset.label;
    }
    if (normalized !== FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID) {
        return formatFoxholeMaintenanceIntervalLabel(FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID);
    }

    let remaining = resolveFoxholeMaintenanceIntervalSeconds(normalized, customSeconds);
    const parts: string[] = [];
    for (const [seconds, suffix] of [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']] as const) {
        const count = Math.floor(remaining / seconds);
        if (count > 0) {
            parts.push(`${count}${suffix}`);
            remaining %= seconds;
        }
    }
    return `Custom (${parts.join(' ')})`;
}

export function resolveFoxholeStructureDecays(options: {
    decays?: boolean | null;
    decaySupplyDrain?: number | null;
}): boolean {
    if (options.decays === true) {
        return true;
    }

    const drain = Number(options.decaySupplyDrain ?? NaN);
    return Number.isFinite(drain) && drain > 0;
}

export function resolveFoxholeMaintenanceSupplyDrain(options: {
    decays?: boolean | null;
    decaySupplyDrain?: number | null;
}): number {
    if (!resolveFoxholeStructureDecays(options)) {
        return 0;
    }

    const drain = Number(options.decaySupplyDrain ?? NaN);
    if (Number.isFinite(drain) && drain > 0) {
        return drain;
    }

    return 1;
}

export function resolveFoxholeMaintenanceSuppliesForInterval(
    decaySupplyDrain: number,
    intervalSeconds: number,
): number {
    if (!(decaySupplyDrain > 0) || !(intervalSeconds > 0)) {
        return 0;
    }

    return decaySupplyDrain * (intervalSeconds / 3600);
}
