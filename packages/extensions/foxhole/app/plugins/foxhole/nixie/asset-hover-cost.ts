export interface FoxholeHoverCostSource {
    cost: Record<string, { quantity: number; limit?: number | null; }>;
    totalCost?: Record<string, { quantity: number; limit?: number | null; }>;
    isUpgrade?: boolean;
}

/** Upgrades and modifications show incremental prices beside their full build totals. */
export function resolveFoxholeHoverCostPresentation(source: FoxholeHoverCostSource | null, isModification: boolean, isStructureUpgrade = false) {
    const showIncrementalCost = isModification || isStructureUpgrade;
    return {
        primaryCost: showIncrementalCost ? source?.cost ?? {} : source?.totalCost ?? source?.cost ?? {},
        totalCost: showIncrementalCost ? source?.totalCost ?? null : null,
        heading: isStructureUpgrade ? 'Upgrade Cost' : isModification ? source?.isUpgrade ? 'Upgrade Cost' : 'Modification Cost' : null,
        showHostAttributes: !isModification,
    };
}
