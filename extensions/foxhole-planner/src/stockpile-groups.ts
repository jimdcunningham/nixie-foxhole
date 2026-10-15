export interface NativeStockpileGroup {
    componentName: string;
    stockpileIndex?: number;
    configs: Array<{ entryType: string; validEntriesOverride?: string[]; quantityLimit?: number; totalQuantityLimit?: number; }>;
}

function normalizeMarkedItemCodenames(value: unknown): string[] {
    return Array.isArray(value) ? [...new Set(value.filter((code): code is string => typeof code === 'string').map(code => code.trim()).filter(Boolean))] : [];
}

export interface FoxholeStockpileSelectionGroup {
    key: string;
    label: string;
    entryType: string;
    allowed: string[];
    quantityLimit?: number;
    totalQuantityLimit?: number;
}

export function resolveFoxholeStockpileSelectionGroups(stockpiles: NativeStockpileGroup[] | undefined): FoxholeStockpileSelectionGroup[] {
    if (!stockpiles || (stockpiles.length < 2 && (stockpiles[0]?.configs.length ?? 0) < 2)) return [];
    return stockpiles.flatMap((store, storeIndex) => store.configs.flatMap((config, index) => {
        if (!['Items', 'Vehicles', 'Structures'].includes(config.entryType)) return [];
        return [{
            key: `${store.componentName}:${index}`,
            label: `Hold ${(store.stockpileIndex ?? storeIndex) + 1} · ${config.entryType}`,
            entryType: config.entryType,
            allowed: normalizeMarkedItemCodenames(config.validEntriesOverride),
            quantityLimit: config.quantityLimit,
            totalQuantityLimit: config.totalQuantityLimit,
        }];
    }));
}

/** A present empty group intentionally overrides legacy cargo; absence preserves old projects. */
export function resolveFoxholeStockpileGroupSelection(group: FoxholeStockpileSelectionGroup, selections: unknown, legacy: unknown): string[] {
    const map = selections && typeof selections === 'object' && !Array.isArray(selections) ? selections as Record<string, unknown> : {};
    const candidate = Object.hasOwn(map, group.key) ? map[group.key] : legacy;
    const allowed = new Map(group.allowed.map(code => [code.toLowerCase(), code]));
    return normalizeMarkedItemCodenames(normalizeMarkedItemCodenames(candidate).flatMap(code => {
        const canonical = allowed.get(code.toLowerCase());
        return canonical ? [canonical] : [];
    }));
}

export function resolveFoxholeGroupedCargoCodenames(stockpiles: NativeStockpileGroup[] | undefined, selections: unknown, legacy: unknown): string[] | null {
    const groups = resolveFoxholeStockpileSelectionGroups(stockpiles);
    return groups.length ? normalizeMarkedItemCodenames(groups.flatMap(group => resolveFoxholeStockpileGroupSelection(group, selections, legacy))) : null;
}

export function formatFoxholeStockpileLimits(group: Pick<FoxholeStockpileSelectionGroup, 'quantityLimit' | 'totalQuantityLimit'>): string {
    const parts = [group.quantityLimit == null ? '' : `Entry limit: ${group.quantityLimit.toLocaleString('en-US')}`,
        group.totalQuantityLimit == null ? '' : `total limit: ${group.totalQuantityLimit.toLocaleString('en-US')}`].filter(Boolean);
    return parts.length ? parts.join('; ') + '.' : '';
}

export function stockpileSelectionsToEntries(groups: FoxholeStockpileSelectionGroup[], selections: unknown, legacy: unknown): Array<{ groupKey: string; codename: string; }> {
    return groups.flatMap(group => resolveFoxholeStockpileGroupSelection(group, selections, legacy).map(codename => ({ groupKey: group.key, codename })));
}

export function stockpileEntriesToSelections(groups: FoxholeStockpileSelectionGroup[], entries: unknown): Record<string, string[]> {
    const result = Object.fromEntries(groups.map(group => [group.key, [] as string[]]));
    if (!Array.isArray(entries)) return result;
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || typeof entry.groupKey !== 'string' || typeof entry.codename !== 'string') continue;
        const group = groups.find(group => group.key === entry.groupKey);
        if (!group) continue;
        result[group.key] = resolveFoxholeStockpileGroupSelection(group, { [group.key]: [...result[group.key]!, entry.codename] }, []);
    }
    return result;
}
