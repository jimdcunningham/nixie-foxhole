import type {
    FoxholeProductionExecutionMachineRow,
    FoxholeProductionIndex,
    FoxholeProductionMachineInstance,
    FoxholeProductionMachineRequirementCoverage,
    FoxholeProductionMachineRequirementRecipeRun,
    FoxholeProductionPlanMachineRun,
    FoxholeProductionPlanResult,
    FoxholeProductionPlanMachineRequirementRow,
    FoxholeProductionRecipe,
    FoxholeProductionSceneCoverage,
    FoxholeProductionSceneCoverageStatus,
} from './types.ts';

type FoxholeProductionMachineRequirementBuilder = {
    id: string;
    placementRecipeId: string | null;
    sourceType: FoxholeProductionRecipe['sourceType'];
    sourceStructureId: string;
    sourceSlotId: string | null;
    sourceVariantId: string | null;
    requiredRunCount: number;
    recipeRuns: FoxholeProductionMachineRequirementRecipeRun[];
};

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function createMachineRequirementKey(
    sourceType: FoxholeProductionRecipe['sourceType'],
    sourceStructureId: string,
    sourceSlotId: string | null,
    sourceVariantId: string | null,
): string {
    const normalizedStructureId = normalizeKey(sourceStructureId);
    if (!normalizedStructureId) {
        return '';
    }

    if (sourceType === 'modification') {
        const normalizedSlotId = normalizeKey(sourceSlotId);
        const normalizedVariantId = normalizeKey(sourceVariantId);
        return normalizedSlotId && normalizedVariantId
            ? `modification:${normalizedStructureId}:${normalizedSlotId}:${normalizedVariantId}`
            : `modification:${normalizedStructureId}`;
    }

    return `structure:${normalizedStructureId}`;
}

function createEmptyCoverage(
    requirementId: string,
    placementRecipeId: string | null,
    requiredRunCount: number,
    recipeRuns: FoxholeProductionMachineRequirementRecipeRun[],
): FoxholeProductionMachineRequirementCoverage {
    return {
        id: requirementId,
        placementRecipeId,
        sourceType: 'structure',
        sourceStructureId: '',
        sourceSlotId: null,
        sourceVariantId: null,
        requiredRunCount,
        recipeRuns,
        matchedMachineIds: [],
        matchedMachineCount: 0,
        upgradeableMachineIds: [],
        upgradeableMachineCount: 0,
        status: 'uncovered',
        canUpgradeExisting: false,
        needsFreshPlacement: true,
    };
}

function resolveExactMatchMachineIds(
    requirement: Pick<
        FoxholeProductionMachineRequirementCoverage,
        'sourceType' | 'sourceStructureId' | 'sourceSlotId' | 'sourceVariantId'
    >,
    machineInstances: readonly FoxholeProductionMachineInstance[],
): string[] {
    const requiredStructureId = normalizeKey(requirement.sourceStructureId);
    if (!requiredStructureId) {
        return [];
    }

    const requiredSlotId = normalizeKey(requirement.sourceSlotId);
    const requiredVariantId = normalizeKey(requirement.sourceVariantId);

    return machineInstances
        .filter(machine => normalizeKey(machine.structureId) === requiredStructureId)
        .filter(machine => requirement.sourceType !== 'modification'
            || (requiredSlotId
                && requiredVariantId
                && normalizeKey(machine.selectedModificationVariantIds[requiredSlotId]) === requiredVariantId))
        .map(machine => machine.id)
        .filter(Boolean);
}

function resolveUpgradeableMachineIds(
    requirement: Pick<
        FoxholeProductionMachineRequirementCoverage,
        'sourceType' | 'sourceStructureId' | 'sourceSlotId' | 'sourceVariantId'
    >,
    machineInstances: readonly FoxholeProductionMachineInstance[],
): string[] {
    if (requirement.sourceType !== 'modification') {
        return [];
    }

    const requiredStructureId = normalizeKey(requirement.sourceStructureId);
    const requiredSlotId = normalizeKey(requirement.sourceSlotId);
    const requiredVariantId = normalizeKey(requirement.sourceVariantId);
    if (!requiredStructureId || !requiredSlotId || !requiredVariantId) {
        return [];
    }

    return machineInstances
        .filter(machine => normalizeKey(machine.structureId) === requiredStructureId)
        .filter(machine => normalizeKey(machine.selectedModificationVariantIds[requiredSlotId]) !== requiredVariantId)
        .map(machine => machine.id)
        .filter(Boolean);
}

function determineCoverageStatus(
    matchedMachineCount: number,
    upgradeableMachineCount: number,
): FoxholeProductionSceneCoverageStatus {
    if (matchedMachineCount > 0) {
        return 'covered';
    }

    if (upgradeableMachineCount > 0) {
        return 'upgradeable';
    }

    return 'uncovered';
}

function createMachineRequirementBuilders(
    recipeRuns: readonly FoxholeProductionPlanMachineRun[],
    recipeById: Record<string, FoxholeProductionRecipe>,
): FoxholeProductionMachineRequirementBuilder[] {
    const builders = new Map<string, FoxholeProductionMachineRequirementBuilder>();

    for (const recipeRun of recipeRuns) {
        const recipe = recipeById[recipeRun.recipeId];
        const requirementId = recipe
            ? (createMachineRequirementKey(
                recipe.sourceType,
                recipe.sourceStructureId,
                recipe.sourceSlotId,
                recipe.sourceVariantId,
            ) || `recipe:${normalizeKey(recipeRun.recipeId)}`)
            : `recipe:${normalizeKey(recipeRun.recipeId)}`;
        const existing = builders.get(requirementId);

        if (existing) {
            existing.requiredRunCount += recipeRun.runCount;
            existing.recipeRuns.push({
                recipeId: recipeRun.recipeId,
                runCount: recipeRun.runCount,
            });
            if (!existing.placementRecipeId || recipeRun.recipeId.localeCompare(existing.placementRecipeId, undefined, { sensitivity: 'base' }) < 0) {
                existing.placementRecipeId = recipeRun.recipeId;
            }
            continue;
        }

        builders.set(requirementId, {
            id: requirementId,
            placementRecipeId: recipeRun.recipeId,
            sourceType: recipe?.sourceType ?? 'structure',
            sourceStructureId: recipe?.sourceStructureId ?? '',
            sourceSlotId: recipe?.sourceSlotId ?? null,
            sourceVariantId: recipe?.sourceVariantId ?? null,
            requiredRunCount: recipeRun.runCount,
            recipeRuns: [{
                recipeId: recipeRun.recipeId,
                runCount: recipeRun.runCount,
            }],
        });
    }

    return Array.from(builders.values())
        .map(builder => ({
            ...builder,
            recipeRuns: [...builder.recipeRuns].sort((left, right) => left.recipeId.localeCompare(right.recipeId, undefined, { sensitivity: 'base' })),
        }))
        .sort((left, right) => left.id.localeCompare(right.id, undefined, { sensitivity: 'base' }));
}

function createMachineRequirementCoverage(
    builder: FoxholeProductionMachineRequirementBuilder,
    recipeRun: FoxholeProductionPlanMachineRun,
    recipeById: Record<string, FoxholeProductionRecipe>,
    machineInstances: readonly FoxholeProductionMachineInstance[],
): FoxholeProductionMachineRequirementCoverage {
    const recipe = builder.placementRecipeId ? recipeById[builder.placementRecipeId] : null;
    if (!recipe) {
        return createEmptyCoverage(
            builder.id,
            builder.placementRecipeId,
            builder.requiredRunCount,
            builder.recipeRuns,
        );
    }

    const matchedMachineIds = resolveExactMatchMachineIds(builder, machineInstances);
    const upgradeableMachineIds = matchedMachineIds.length === 0
        ? resolveUpgradeableMachineIds(builder, machineInstances)
        : [];
    const matchedMachineCount = matchedMachineIds.length;
    const upgradeableMachineCount = upgradeableMachineIds.length;
    const status = determineCoverageStatus(matchedMachineCount, upgradeableMachineCount);

    return {
        id: builder.id,
        placementRecipeId: builder.placementRecipeId,
        sourceType: recipe.sourceType,
        sourceStructureId: recipe.sourceStructureId,
        sourceSlotId: recipe.sourceSlotId,
        sourceVariantId: recipe.sourceVariantId,
        requiredRunCount: builder.requiredRunCount,
        recipeRuns: builder.recipeRuns,
        matchedMachineIds,
        matchedMachineCount,
        upgradeableMachineIds,
        upgradeableMachineCount,
        status,
        canUpgradeExisting: status === 'upgradeable',
        needsFreshPlacement: status === 'uncovered',
    };
}

function createExecutionRows(
    planRows: readonly FoxholeProductionPlanMachineRequirementRow[],
    machineRequirementByKey: Record<string, FoxholeProductionMachineRequirementCoverage>,
): FoxholeProductionExecutionMachineRow[] {
    return planRows.map(planRow => {
        const coverage = machineRequirementByKey[planRow.id];
        return {
            id: planRow.id,
            placementRecipeId: planRow.placementRecipeId,
            sourceType: planRow.sourceType,
            sourceStructureId: planRow.sourceStructureId,
            sourceStructureName: planRow.sourceStructureName,
            sourceSlotId: planRow.sourceSlotId,
            sourceVariantId: planRow.sourceVariantId,
            sourceVariantName: planRow.sourceVariantName,
            sourceModificationId: planRow.sourceModificationId,
            isUpgrade: planRow.isUpgrade,
            requiredRunCount: planRow.requiredRunCount,
            recipeRuns: planRow.recipeRuns,
            matchedMachineIds: coverage?.matchedMachineIds ?? [],
            matchedMachineCount: coverage?.matchedMachineCount ?? 0,
            upgradeableMachineIds: coverage?.upgradeableMachineIds ?? [],
            upgradeableMachineCount: coverage?.upgradeableMachineCount ?? 0,
            status: coverage?.status ?? 'uncovered',
            canUpgradeExisting: coverage?.canUpgradeExisting ?? false,
            needsFreshPlacement: coverage?.needsFreshPlacement ?? true,
        };
    });
}

export function reconcileFoxholeProductionSceneCoverage(
    index: Pick<FoxholeProductionIndex, 'recipeById'>,
    plan: Pick<FoxholeProductionPlanResult, 'machineRuns' | 'machineRequirementRows'>,
    machineInstances: readonly FoxholeProductionMachineInstance[],
): FoxholeProductionSceneCoverage {
    const machineRequirements = createMachineRequirementBuilders(plan.machineRuns, index.recipeById).map(builder => createMachineRequirementCoverage(
        builder,
        {
            recipeId: builder.placementRecipeId ?? '',
            runCount: builder.requiredRunCount,
        },
        index.recipeById,
        machineInstances,
    ));
    const machineRequirementByKey = Object.fromEntries(machineRequirements.map(requirement => [
        requirement.id,
        requirement,
    ]));
    const executionRows = createExecutionRows(plan.machineRequirementRows, machineRequirementByKey);

    return {
        machineRequirementByKey,
        machineRequirementKeyByRecipeId: Object.fromEntries(machineRequirements.flatMap(requirement => requirement.recipeRuns.map(recipeRun => [
            recipeRun.recipeId,
            requirement.id,
        ]))),
        machineRequirements,
        executionRows,
        coveredRequirementCount: machineRequirements.filter(requirement => requirement.status === 'covered').length,
        upgradeableRequirementCount: machineRequirements.filter(requirement => requirement.status === 'upgradeable').length,
        uncoveredRequirementCount: machineRequirements.filter(requirement => requirement.status === 'uncovered').length,
    };
}
