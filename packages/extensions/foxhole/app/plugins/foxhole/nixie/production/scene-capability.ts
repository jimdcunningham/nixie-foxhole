import type {
    FoxholeProductionIndex,
    FoxholeProductionMachineInstance,
    FoxholeProductionStructureSnapshotLike,
} from './types.ts';
import { createFoxholeProductionSlotVariantKey } from './index.ts';

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeSelectionMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const normalized: Record<string, string> = {};
    for (const [slotId, variantId] of Object.entries(value)) {
        const normalizedSlotId = normalizeKey(slotId);
        const normalizedVariantId = normalizeKey(variantId);
        if (!normalizedSlotId || !normalizedVariantId) {
            continue;
        }

        normalized[normalizedSlotId] = normalizedVariantId;
    }

    return normalized;
}

export function resolveFoxholeProductionMachineInstances(
    index: Pick<
        FoxholeProductionIndex,
        'structureRecipeIdsByStructureId' | 'modificationRecipeIdsBySlotVariantKey'
    >,
    snapshots: readonly FoxholeProductionStructureSnapshotLike[],
): FoxholeProductionMachineInstance[] {
    return snapshots.flatMap(snapshot => {
        const nodeId = normalizeKey(snapshot.nodeId);
        const structureId = normalizeKey(snapshot.state?.foxholeKey);
        if (!nodeId || !structureId) {
            return [];
        }

        const destroyed = snapshot.state?.destroyed === true;
        const packaged = snapshot.state?.packaged === true;
        const blueprint = snapshot.state?.blueprint === true;
        if (destroyed || packaged || blueprint) {
            return [];
        }

        const selectedModificationVariantIds = normalizeSelectionMap(snapshot.state?.modificationVariantIds);
        const recipeIds = new Set(index.structureRecipeIdsByStructureId[structureId] ?? []);
        for (const [slotId, variantId] of Object.entries(selectedModificationVariantIds)) {
            const slotVariantKey = createFoxholeProductionSlotVariantKey(structureId, slotId, variantId);
            for (const recipeId of index.modificationRecipeIdsBySlotVariantKey[slotVariantKey] ?? []) {
                recipeIds.add(recipeId);
            }
        }

        if (recipeIds.size === 0) {
            return [];
        }

        return [{
            id: nodeId,
            nodeId,
            foxholeKey: structureId,
            structureId,
            recipeIds: Array.from(recipeIds),
            selectedModificationVariantIds,
            destroyed,
            packaged,
            blueprint,
        }];
    });
}
