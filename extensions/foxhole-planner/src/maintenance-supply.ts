export const FOXHOLE_MAINTENANCE_CATEGORIES = [
    'defense', 'bunker', 'misc', 'facility', 'mining', 'power', 'liquids', 'foundation', 'shippables',
] as const;

export interface FoxholeMaintenanceFilters {
    range: number;
    exclusions: string[];
}

const categoryAliases: Record<string, string> = {
    defenses: 'defense', entrenchments: 'bunker', factories: 'facility', harvesters: 'mining', foundations: 'foundation',
};

export function isFoxholeMaintenanceTunnel(key: unknown): boolean {
    return typeof key === 'string' && key.replaceAll('_', '').toLowerCase() === 'maintenancetunnel';
}

export function normalizeFoxholeMaintenanceFilters(value: unknown): FoxholeMaintenanceFilters {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const range = typeof source.range === 'number' && Number.isFinite(source.range) ? source.range : 100;
    return {
        range: Math.round(Math.max(0, Math.min(100, range))),
        exclusions: [...new Set(Array.isArray(source.exclusions)
            ? source.exclusions.flatMap(key => {
                const canonical = typeof key === 'string' ? categoryAliases[key] ?? key : '';
                return (FOXHOLE_MAINTENANCE_CATEGORIES as readonly string[]).includes(canonical) ? [canonical] : [];
            })
            : [])],
    };
}

/** Unknown legacy fields remain preserved by the converter rather than claiming complete parity. */
export function supportsFoxholeMaintenanceFilters(value: unknown): boolean {
    if (value === undefined || value === null) {
        return true;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const source = value as Record<string, unknown>;
    return Object.keys(source).every(key => key === 'range' || key === 'exclusions')
        && (source.range === undefined || (typeof source.range === 'number' && Number.isInteger(source.range) && source.range >= 0 && source.range <= 100))
        && (source.exclusions === undefined || (Array.isArray(source.exclusions) && source.exclusions.every(key =>
            typeof key === 'string' && (FOXHOLE_MAINTENANCE_CATEGORIES as readonly string[]).includes(categoryAliases[key] ?? key))));
}

/** Only the maintenance envelope changes; unrelated ranges retain their authored geometry. */
export function resolveFoxholeMaintenanceRanges<T extends { type: string; max?: number | null; }>(
    key: unknown, ranges: readonly T[], filters: unknown,
): T[] {
    if (!isFoxholeMaintenanceTunnel(key)) {
        return [...ranges];
    }
    const { range } = normalizeFoxholeMaintenanceFilters(filters);
    return ranges.map(entry => entry.type === 'preventDecay' ? { ...entry, max: range } : entry);
}

export interface FoxholeMaintenanceCandidate {
    id: string;
    assetId: string;
    category: string;
    x: number;
    y: number;
    /** Base maintenance supplies per hour; zero means this asset does not decay. */
    drain: number;
    operational: boolean;
}

/** Whether an in-range neighboring structure consumes supplies under these filters. */
export function includesFoxholeMaintenanceNeighbor(
    candidate: Pick<FoxholeMaintenanceCandidate, 'operational' | 'drain' | 'category'>,
    exclusions: readonly string[],
): boolean {
    return candidate.operational && candidate.drain > 0 && !exclusions.includes(candidate.category);
}

/** Positions are in board pixels (32 px/m). Each tunnel is estimated independently. */
export function resolveFoxholeMaintenanceCoverage(
    tunnel: FoxholeMaintenanceCandidate, candidates: readonly FoxholeMaintenanceCandidate[], filters: unknown,
): { structures: FoxholeMaintenanceCandidate[]; suppliesPerHour: number; } {
    if (!tunnel.operational) {
        return { structures: [], suppliesPerHour: 0 };
    }
    const { range, exclusions } = normalizeFoxholeMaintenanceFilters(filters);
    const unique = new Map([[tunnel.id, tunnel], ...candidates.map(candidate => [candidate.id, candidate] as const)]);
    const structures = [...unique.values()].filter(candidate => candidate.operational && (
        candidate.id === tunnel.id || (includesFoxholeMaintenanceNeighbor(candidate, exclusions)
            && range > 0 && Math.hypot(candidate.x - tunnel.x, candidate.y - tunnel.y) <= range * 32)
    ));
    return { structures, suppliesPerHour: structures.reduce((total, candidate) => total + candidate.drain, 0) };
}
