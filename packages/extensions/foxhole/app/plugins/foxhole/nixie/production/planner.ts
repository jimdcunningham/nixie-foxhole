import {
    createFoxholeProductionCommodityKey,
    isFoxholeProductionBuildRecipe,
    parseFoxholeProductionBuildTargetId,
} from './index.ts';
import type {
    FoxholeProductionMachineRequirementRecipeRun,
    FoxholeProductionPlanBuildCostContribution,
    FoxholeProductionPlanBuildCostEntry,
    FoxholeProductionPlanBuildCostLedger,
    FoxholeProductionPlanBuildCostTableRow,
    FoxholeProductionPlanBranchDecisionRow,
    FoxholeProductionPlanBranchDecision,
    FoxholeProductionChannel,
    FoxholeProductionDemand,
    FoxholeProductionIndex,
    FoxholeProductionPlanMachineRequirementRow,
    FoxholeProductionPlanBlocker,
    FoxholeProductionPlanBlockerKind,
    FoxholeProductionPlanDecisionSelectionKind,
    FoxholeProductionPlanMachineRun,
    FoxholeProductionPlanNode,
    FoxholeProductionPlanRequest,
    FoxholeProductionPlanResult,
    FoxholeProductionPlanTargetStep,
    FoxholeProductionRecipe,
} from './types.ts';

const EPSILON = 1e-9;

interface FoxholeProductionPlannerContext {
    index: FoxholeProductionIndex;
    preferredRecipeIdByOutput: Record<string, string>;
    stockByCommodityKey: Record<string, number>;
    externalSupplyRemaining: Record<string, number | 'unbounded'>;
    recipeRunsById: Record<string, number>;
    missingCommodityAmounts: Record<string, number>;
    ambiguousCommodityRecipeIds: Record<string, string[]>;
    cycleCommodityKeys: Set<string>;
    externalSupplyConsumed: Record<string, number>;
}

interface FoxholeProductionPlannerDemand extends FoxholeProductionDemand {
    buildRollupRootTargetId: string | null;
    buildRollupDepth: number;
    buildRollupChainTargetIds: string[];
}

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeQuantity(value: unknown): number {
    const normalized = Number(value ?? 0);
    return Number.isFinite(normalized) && normalized > 0
        ? normalized
        : 0;
}

function addQuantity(store: Record<string, number>, key: string, quantity: number): void {
    if (!key || quantity <= EPSILON) {
        return;
    }

    store[key] = (store[key] ?? 0) + quantity;
}

function consumeQuantity(store: Record<string, number>, key: string, requestedQuantity: number): number {
    if (!key || requestedQuantity <= EPSILON) {
        return 0;
    }

    const available = Math.max(0, Number(store[key] ?? 0));
    const consumed = Math.min(available, requestedQuantity);
    if (consumed <= EPSILON) {
        return 0;
    }

    const remaining = available - consumed;
    if (remaining <= EPSILON) {
        delete store[key];
    } else {
        store[key] = remaining;
    }

    return consumed;
}

function consumeExternalSupply(
    context: FoxholeProductionPlannerContext,
    commodityKey: string,
    requestedQuantity: number,
): number {
    if (requestedQuantity <= EPSILON) {
        return 0;
    }

    const available = context.externalSupplyRemaining[commodityKey];
    if (available === 'unbounded') {
        addQuantity(context.externalSupplyConsumed, commodityKey, requestedQuantity);
        return requestedQuantity;
    }

    const normalizedAvailable = Math.max(0, Number(available ?? 0));
    const consumed = Math.min(normalizedAvailable, requestedQuantity);
    if (consumed <= EPSILON) {
        return 0;
    }

    const remaining = normalizedAvailable - consumed;
    if (remaining <= EPSILON) {
        delete context.externalSupplyRemaining[commodityKey];
    } else {
        context.externalSupplyRemaining[commodityKey] = remaining;
    }
    addQuantity(context.externalSupplyConsumed, commodityKey, consumed);
    return consumed;
}

function iterateRecipeResources(
    recipe: Pick<FoxholeProductionRecipe, 'itemInput' | 'crateInput' | 'liquidInput' | 'itemOutput' | 'crateOutput' | 'liquidOutput' | 'buildOutput'>,
    direction: 'input' | 'output',
): Array<{ commodityKey: string; channel: FoxholeProductionChannel; resourceId: string; quantity: number; }> {
    const entries: Array<{ commodityKey: string; channel: FoxholeProductionChannel; resourceId: string; quantity: number; }> = [];
    const maps = direction === 'input'
        ? [
            ['item', recipe.itemInput],
            ['crate', recipe.crateInput],
            ['liquid', recipe.liquidInput],
        ] as const
        : [
            ['item', recipe.itemOutput],
            ['crate', recipe.crateOutput],
            ['liquid', recipe.liquidOutput],
            ['build', recipe.buildOutput],
        ] as const;

    for (const [channel, resourceMap] of maps) {
        for (const [resourceId, resource] of Object.entries(resourceMap ?? {})) {
            const quantity = normalizeQuantity(resource?.quantity);
            if (quantity <= EPSILON) {
                continue;
            }

            entries.push({
                commodityKey: createFoxholeProductionCommodityKey(channel, resourceId),
                channel,
                resourceId,
                quantity,
            });
        }
    }

    return entries;
}

function getRecipeOutputQuantity(recipe: FoxholeProductionRecipe, commodityKey: string): number {
    return iterateRecipeResources(recipe, 'output')
        .find(entry => entry.commodityKey === commodityKey)
        ?.quantity ?? 0;
}

function getRequiredRecipeRunCount(outputQuantity: number, requestedQuantity: number): number {
    if (outputQuantity <= EPSILON || requestedQuantity <= EPSILON) {
        return 0;
    }

    return Math.max(1, Math.ceil((requestedQuantity - EPSILON) / outputQuantity));
}

type FoxholeProductionRecipeCandidateProfile = {
    recipeId: string;
    runCount: number;
    surplusQuantity: number;
    durationSeconds: number | null;
    inputByCommodityKey: Record<string, number>;
};

function buildRecipeCandidateProfile(
    index: FoxholeProductionIndex,
    commodityKey: string,
    requestedQuantity: number,
    recipeId: string,
): FoxholeProductionRecipeCandidateProfile | null {
    const recipe = index.recipeById[recipeId];
    if (!recipe) {
        return null;
    }

    const outputQuantity = getRecipeOutputQuantity(recipe, commodityKey);
    const runCount = getRequiredRecipeRunCount(outputQuantity, requestedQuantity);
    if (runCount <= 0) {
        return null;
    }

    const inputByCommodityKey: Record<string, number> = {};
    for (const input of iterateRecipeResources(recipe, 'input')) {
        addQuantity(inputByCommodityKey, input.commodityKey, input.quantity * runCount);
    }

    const durationSeconds = recipe.durationSeconds === null
        ? null
        : recipe.durationSeconds * runCount;

    return {
        recipeId,
        runCount,
        surplusQuantity: Math.max(0, (outputQuantity * runCount) - requestedQuantity),
        durationSeconds,
        inputByCommodityKey,
    };
}

function doesRecipeCandidateDominate(
    left: FoxholeProductionRecipeCandidateProfile,
    right: FoxholeProductionRecipeCandidateProfile,
): boolean {
    let hasStrictImprovement = false;

    if (left.surplusQuantity > right.surplusQuantity + EPSILON) {
        return false;
    }
    if (left.surplusQuantity + EPSILON < right.surplusQuantity) {
        hasStrictImprovement = true;
    }

    const commodityKeys = new Set([
        ...Object.keys(left.inputByCommodityKey),
        ...Object.keys(right.inputByCommodityKey),
    ]);
    for (const commodityKey of commodityKeys) {
        const leftQuantity = left.inputByCommodityKey[commodityKey] ?? 0;
        const rightQuantity = right.inputByCommodityKey[commodityKey] ?? 0;
        if (leftQuantity > rightQuantity + EPSILON) {
            return false;
        }
        if (leftQuantity + EPSILON < rightQuantity) {
            hasStrictImprovement = true;
        }
    }

    if (left.durationSeconds !== null && right.durationSeconds !== null) {
        if (left.durationSeconds > right.durationSeconds + EPSILON) {
            return false;
        }
        if (left.durationSeconds + EPSILON < right.durationSeconds) {
            hasStrictImprovement = true;
        }
    }

    return hasStrictImprovement;
}

function selectDominantRecipeId(
    index: FoxholeProductionIndex,
    commodityKey: string,
    requestedQuantity: number,
    candidateRecipeIds: readonly string[],
): string | null {
    const candidateProfiles = candidateRecipeIds
        .map(recipeId => buildRecipeCandidateProfile(index, commodityKey, requestedQuantity, recipeId))
        .filter((profile): profile is FoxholeProductionRecipeCandidateProfile => profile !== null);
    if (candidateProfiles.length !== candidateRecipeIds.length) {
        return null;
    }

    const dominantCandidates = candidateProfiles.filter(candidate => candidateProfiles.every(other => {
        return candidate.recipeId === other.recipeId
            || doesRecipeCandidateDominate(candidate, other);
    }));

    return dominantCandidates.length === 1
        ? dominantCandidates[0]!.recipeId
        : null;
}

function normalizeDemands(demands: readonly FoxholeProductionDemand[]): FoxholeProductionPlannerDemand[] {
    return demands
        .map(demand => ({
            channel: demand.channel,
            resourceId: normalizeKey(demand.resourceId),
            quantity: normalizeQuantity(demand.quantity),
            buildRollupRootTargetId: demand.channel === 'build'
                ? normalizeKey(demand.resourceId) || null
                : null,
            buildRollupDepth: 0,
            buildRollupChainTargetIds: demand.channel === 'build' && normalizeKey(demand.resourceId)
                ? [normalizeKey(demand.resourceId)]
                : [],
        }))
        .filter(demand => Boolean(demand.resourceId) && demand.quantity > EPSILON);
}

function expandDemandWithParentBuildCosts(
    index: Pick<FoxholeProductionIndex, 'parentBuildTargetIdByTargetId'>,
    demand: FoxholeProductionPlannerDemand,
): FoxholeProductionPlannerDemand[] {
    const normalizedQuantity = normalizeQuantity(demand.quantity);
    if (demand.channel !== 'build' || normalizedQuantity <= EPSILON) {
        return [demand];
    }

    const expandedDemands: FoxholeProductionPlannerDemand[] = [];
    const seenTargetIds = new Set<string>();
    let currentTargetId = normalizeKey(demand.resourceId);
    let currentDepth = 0;
    const chainTargetIds: string[] = [];

    while (currentTargetId && !seenTargetIds.has(currentTargetId)) {
        seenTargetIds.add(currentTargetId);
        chainTargetIds.push(currentTargetId);
        expandedDemands.push({
            channel: 'build',
            resourceId: currentTargetId,
            quantity: normalizedQuantity,
            buildRollupRootTargetId: demand.buildRollupRootTargetId,
            buildRollupDepth: currentDepth,
            buildRollupChainTargetIds: [...chainTargetIds],
        });

        if (!parseFoxholeProductionBuildTargetId(currentTargetId)) {
            break;
        }

        currentTargetId = normalizeKey(index.parentBuildTargetIdByTargetId[currentTargetId]);
        currentDepth += 1;
    }

    return expandedDemands;
}

function normalizePlanDemands(
    index: Pick<FoxholeProductionIndex, 'parentBuildTargetIdByTargetId'>,
    request: Pick<FoxholeProductionPlanRequest, 'demands' | 'includeParentBuildCosts'>,
): FoxholeProductionPlannerDemand[] {
    const normalizedDemands = normalizeDemands(request.demands);
    if (request.includeParentBuildCosts !== true) {
        return normalizedDemands;
    }

    return normalizedDemands.flatMap(demand => expandDemandWithParentBuildCosts(index, demand));
}

function resolveDemand(
    context: FoxholeProductionPlannerContext,
    demand: FoxholeProductionDemand,
    path: readonly string[],
): FoxholeProductionPlanNode {
    const commodityKey = createFoxholeProductionCommodityKey(demand.channel, demand.resourceId);
    const requestedQuantity = normalizeQuantity(demand.quantity);
    const consumedFromStock = consumeQuantity(context.stockByCommodityKey, commodityKey, requestedQuantity);
    let remainingQuantity = Math.max(0, requestedQuantity - consumedFromStock);
    const consumedFromExternal = consumeExternalSupply(context, commodityKey, remainingQuantity);
    remainingQuantity = Math.max(0, remainingQuantity - consumedFromExternal);

    if (remainingQuantity <= EPSILON) {
        return {
            commodityKey,
            channel: demand.channel,
            resourceId: demand.resourceId,
            requestedQuantity,
            satisfiedQuantity: requestedQuantity,
            consumedFromStock,
            consumedFromExternal,
            source: consumedFromExternal > EPSILON ? 'external' : 'stock',
            recipeId: null,
            recipeRunCount: null,
            producedQuantity: 0,
            surplusQuantity: 0,
            candidateRecipeIds: [],
            children: [],
        };
    }

    if (path.includes(commodityKey)) {
        context.cycleCommodityKeys.add(commodityKey);
        addQuantity(context.missingCommodityAmounts, commodityKey, remainingQuantity);
        return {
            commodityKey,
            channel: demand.channel,
            resourceId: demand.resourceId,
            requestedQuantity,
            satisfiedQuantity: requestedQuantity - remainingQuantity,
            consumedFromStock,
            consumedFromExternal,
            source: 'cycle',
            recipeId: null,
            recipeRunCount: null,
            producedQuantity: 0,
            surplusQuantity: 0,
            candidateRecipeIds: [],
            children: [],
        };
    }

    const candidateRecipeIds = context.index.recipeIdsByOutput[commodityKey] ?? [];
    if (candidateRecipeIds.length === 0) {
        addQuantity(context.missingCommodityAmounts, commodityKey, remainingQuantity);
        return {
            commodityKey,
            channel: demand.channel,
            resourceId: demand.resourceId,
            requestedQuantity,
            satisfiedQuantity: requestedQuantity - remainingQuantity,
            consumedFromStock,
            consumedFromExternal,
            source: 'missing',
            recipeId: null,
            recipeRunCount: null,
            producedQuantity: 0,
            surplusQuantity: 0,
            candidateRecipeIds: [],
            children: [],
        };
    }

    const preferredRecipeId = normalizeKey(context.preferredRecipeIdByOutput[commodityKey]);
    const selectedRecipeId = candidateRecipeIds.length === 1
        ? candidateRecipeIds[0]!
        : candidateRecipeIds.includes(preferredRecipeId)
            ? preferredRecipeId
            : selectDominantRecipeId(context.index, commodityKey, remainingQuantity, candidateRecipeIds);
    if (!selectedRecipeId) {
        context.ambiguousCommodityRecipeIds[commodityKey] = [...candidateRecipeIds];
        return {
            commodityKey,
            channel: demand.channel,
            resourceId: demand.resourceId,
            requestedQuantity,
            satisfiedQuantity: requestedQuantity - remainingQuantity,
            consumedFromStock,
            consumedFromExternal,
            source: 'ambiguous',
            recipeId: null,
            recipeRunCount: null,
            producedQuantity: 0,
            surplusQuantity: 0,
            candidateRecipeIds: [...candidateRecipeIds],
            children: [],
        };
    }

    const recipe = context.index.recipeById[selectedRecipeId];
    const outputQuantity = recipe ? getRecipeOutputQuantity(recipe, commodityKey) : 0;
    if (!recipe || outputQuantity <= EPSILON) {
        addQuantity(context.missingCommodityAmounts, commodityKey, remainingQuantity);
        return {
            commodityKey,
            channel: demand.channel,
            resourceId: demand.resourceId,
            requestedQuantity,
            satisfiedQuantity: requestedQuantity - remainingQuantity,
            consumedFromStock,
            consumedFromExternal,
            source: 'missing',
            recipeId: null,
            recipeRunCount: null,
            producedQuantity: 0,
            surplusQuantity: 0,
            candidateRecipeIds: [...candidateRecipeIds],
            children: [],
        };
    }

    const recipeRunCount = getRequiredRecipeRunCount(outputQuantity, remainingQuantity);
    const producedQuantity = outputQuantity * recipeRunCount;
    addQuantity(context.recipeRunsById, selectedRecipeId, recipeRunCount);

    const children = iterateRecipeResources(recipe, 'input').map(input => resolveDemand(context, {
        channel: input.channel,
        resourceId: input.resourceId,
        quantity: input.quantity * recipeRunCount,
    }, [...path, commodityKey]));

    for (const output of iterateRecipeResources(recipe, 'output')) {
        addQuantity(context.stockByCommodityKey, output.commodityKey, output.quantity * recipeRunCount);
    }
    const consumedFromRecipeOutput = consumeQuantity(context.stockByCommodityKey, commodityKey, remainingQuantity);
    const satisfiedQuantity = consumedFromStock + consumedFromExternal + consumedFromRecipeOutput;
    const surplusQuantity = Math.max(0, producedQuantity - consumedFromRecipeOutput);
    if (consumedFromRecipeOutput + EPSILON < remainingQuantity) {
        addQuantity(context.missingCommodityAmounts, commodityKey, remainingQuantity - consumedFromRecipeOutput);
    }

    return {
        commodityKey,
        channel: demand.channel,
        resourceId: demand.resourceId,
        requestedQuantity,
        satisfiedQuantity,
        consumedFromStock,
        consumedFromExternal,
        source: 'recipe',
        recipeId: selectedRecipeId,
        recipeRunCount,
        producedQuantity,
        surplusQuantity,
        candidateRecipeIds: [...candidateRecipeIds],
        children,
    };
}

function resolveStatus(result: Pick<FoxholeProductionPlanResult, 'cycleCommodityKeys' | 'missingCommodityAmounts' | 'ambiguousCommodityRecipeIds'>): FoxholeProductionPlanResult['status'] {
    if (result.cycleCommodityKeys.length > 0) {
        return 'cycle';
    }

    if (Object.keys(result.missingCommodityAmounts).length > 0) {
        return 'missing';
    }

    if (Object.keys(result.ambiguousCommodityRecipeIds).length > 0) {
        return 'ambiguous';
    }

    return 'ok';
}

function appendUniqueValues(store: string[], values: readonly string[]): void {
    for (const value of values) {
        if (!store.includes(value)) {
            store.push(value);
        }
    }
}

function normalizeExternalSupplyAmount(value: unknown): number | 'unbounded' | null {
    if (value === 'unbounded') {
        return 'unbounded';
    }

    const normalized = Number(value ?? 0);
    return Number.isFinite(normalized) && normalized > EPSILON
        ? normalized
        : null;
}

function getBranchDecisionSelectionKind(
    preferredRecipeId: string,
    externalSupplyAmount: number | 'unbounded' | null,
): FoxholeProductionPlanDecisionSelectionKind {
    if (externalSupplyAmount === 'unbounded') {
        return 'external';
    }

    return preferredRecipeId
        ? 'recipe'
        : 'planner';
}

function shouldIncludeBranchDecision(
    node: FoxholeProductionPlanNode,
    depth: number,
    hasExplicitOverride: boolean,
): boolean {
    if (depth === 0) {
        return node.candidateRecipeIds.length > 1 || hasExplicitOverride;
    }

    return (node.source !== 'stock' && node.source !== 'cycle') || hasExplicitOverride;
}

function createPlanTargetStep(
    node: FoxholeProductionPlanNode,
    demand: FoxholeProductionPlannerDemand,
): FoxholeProductionPlanTargetStep {
    return {
        commodityKey: node.commodityKey,
        channel: node.channel,
        resourceId: node.resourceId,
        buildTarget: node.channel === 'build'
            ? parseFoxholeProductionBuildTargetId(node.resourceId)
            : null,
        buildRollupRootTarget: demand.buildRollupRootTargetId
            ? parseFoxholeProductionBuildTargetId(demand.buildRollupRootTargetId)
            : null,
        buildRollupDepth: demand.buildRollupDepth,
        buildRollupChain: demand.buildRollupChainTargetIds
            .map(buildTargetId => parseFoxholeProductionBuildTargetId(buildTargetId))
            .filter((buildTarget): buildTarget is NonNullable<typeof buildTarget> => buildTarget !== null),
        requestedQuantity: node.requestedQuantity,
        satisfiedQuantity: node.satisfiedQuantity,
        source: node.source,
        recipeId: node.recipeId,
        recipeRunCount: node.recipeRunCount,
        producedQuantity: node.producedQuantity,
        surplusQuantity: node.surplusQuantity,
        candidateRecipeIds: [...node.candidateRecipeIds],
    };
}

function createMachineRuns(machineRecipeRunsById: Record<string, number>): FoxholeProductionPlanMachineRun[] {
    return Object.entries(machineRecipeRunsById)
        .map(([recipeId, runCount]) => ({ recipeId, runCount }))
        .sort((left, right) => left.recipeId.localeCompare(right.recipeId, undefined, { sensitivity: 'base' }));
}

function createMachineRequirementRowKey(
    recipe: Pick<FoxholeProductionRecipe, 'sourceType' | 'sourceStructureId' | 'sourceSlotId' | 'sourceVariantId'>,
): string {
    const structureId = normalizeKey(recipe.sourceStructureId);
    if (!structureId) {
        return '';
    }

    if (recipe.sourceType === 'modification') {
        const slotId = normalizeKey(recipe.sourceSlotId);
        const variantId = normalizeKey(recipe.sourceVariantId);
        return slotId && variantId
            ? `modification:${structureId}:${slotId}:${variantId}`
            : `modification:${structureId}`;
    }

    return `structure:${structureId}`;
}

function createMachineRequirementRows(
    index: FoxholeProductionIndex,
    machineRuns: readonly FoxholeProductionPlanMachineRun[],
): FoxholeProductionPlanMachineRequirementRow[] {
    const rowsById = new Map<string, FoxholeProductionPlanMachineRequirementRow>();

    for (const machineRun of machineRuns) {
        const recipe = index.recipeById[machineRun.recipeId];
        if (!recipe) {
            continue;
        }

        const rowId = createMachineRequirementRowKey(recipe) || machineRun.recipeId;
        const existing = rowsById.get(rowId);
        const recipeRun: FoxholeProductionMachineRequirementRecipeRun = {
            recipeId: machineRun.recipeId,
            runCount: machineRun.runCount,
        };

        if (existing) {
            existing.requiredRunCount += machineRun.runCount;
            existing.recipeRuns.push(recipeRun);
            if (!existing.placementRecipeId || machineRun.recipeId.localeCompare(existing.placementRecipeId, undefined, { sensitivity: 'base' }) < 0) {
                existing.placementRecipeId = machineRun.recipeId;
                existing.sourceStructureName = recipe.sourceStructureName;
                existing.sourceVariantName = recipe.sourceVariantName;
                existing.sourceModificationId = recipe.sourceModificationId;
                existing.isUpgrade = recipe.isUpgrade;
            }
            continue;
        }

        rowsById.set(rowId, {
            id: rowId,
            placementRecipeId: machineRun.recipeId,
            sourceType: recipe.sourceType,
            sourceStructureId: recipe.sourceStructureId,
            sourceStructureName: recipe.sourceStructureName,
            sourceSlotId: recipe.sourceSlotId,
            sourceVariantId: recipe.sourceVariantId,
            sourceVariantName: recipe.sourceVariantName,
            sourceModificationId: recipe.sourceModificationId,
            isUpgrade: recipe.isUpgrade,
            requiredRunCount: machineRun.runCount,
            recipeRuns: [recipeRun],
        });
    }

    return Array.from(rowsById.values())
        .map(row => ({
            ...row,
            recipeRuns: [...row.recipeRuns].sort((left, right) => left.recipeId.localeCompare(right.recipeId, undefined, { sensitivity: 'base' })),
        }))
        .sort((left, right) => left.id.localeCompare(right.id, undefined, { sensitivity: 'base' }));
}

function sortBuildCostEntries(entries: FoxholeProductionPlanBuildCostEntry[]): FoxholeProductionPlanBuildCostEntry[] {
    return [...entries].sort((left, right) => left.commodityKey.localeCompare(right.commodityKey, undefined, { sensitivity: 'base' }));
}

function aggregateBuildCostEntries(entries: readonly FoxholeProductionPlanBuildCostEntry[]): FoxholeProductionPlanBuildCostEntry[] {
    const quantitiesByCommodityKey = new Map<string, FoxholeProductionPlanBuildCostEntry>();

    for (const entry of entries) {
        const existing = quantitiesByCommodityKey.get(entry.commodityKey);
        if (existing) {
            existing.quantity += entry.quantity;
            continue;
        }

        quantitiesByCommodityKey.set(entry.commodityKey, { ...entry });
    }

    return sortBuildCostEntries(Array.from(quantitiesByCommodityKey.values()).filter(entry => entry.quantity > EPSILON));
}

function createBuildCostEntries(
    recipe: FoxholeProductionRecipe | null,
    recipeRunCount: number | null,
): FoxholeProductionPlanBuildCostEntry[] {
    if (!recipe || recipeRunCount === null || recipeRunCount <= EPSILON) {
        return [];
    }

    return sortBuildCostEntries(iterateRecipeResources(recipe, 'input')
        .map(input => ({
            commodityKey: input.commodityKey,
            channel: input.channel,
            resourceId: input.resourceId,
            quantity: input.quantity * recipeRunCount,
        }))
        .filter(entry => entry.quantity > EPSILON));
}

function createBuildCostLedgers(
    index: FoxholeProductionIndex,
    targetSteps: readonly FoxholeProductionPlanTargetStep[],
): FoxholeProductionPlanBuildCostLedger[] {
    const ledgersByRootTargetId = new Map<string, FoxholeProductionPlanBuildCostLedger>();

    for (const targetStep of targetSteps) {
        if (!targetStep.buildTarget || !targetStep.buildRollupRootTarget) {
            continue;
        }

        const rootTargetId = targetStep.buildRollupRootTarget.id;
        if (!rootTargetId) {
            continue;
        }

        const ledger = ledgersByRootTargetId.get(rootTargetId) ?? {
            rootBuildTarget: targetStep.buildRollupRootTarget,
            includesParentBuildCosts: false,
            contributions: [],
            totalCostEntries: [],
        };

        const recipe = targetStep.recipeId
            ? (index.recipeById[targetStep.recipeId] ?? null)
            : null;
        const contribution: FoxholeProductionPlanBuildCostContribution = {
            buildTarget: targetStep.buildTarget,
            rootBuildTarget: targetStep.buildRollupRootTarget,
            depth: targetStep.buildRollupDepth,
            recipeId: targetStep.recipeId,
            recipeRunCount: targetStep.recipeRunCount,
            costEntries: createBuildCostEntries(recipe, targetStep.recipeRunCount),
        };

        ledger.includesParentBuildCosts = ledger.includesParentBuildCosts || targetStep.buildRollupDepth > 0;
        ledger.contributions.push(contribution);
        ledgersByRootTargetId.set(rootTargetId, ledger);
    }

    return Array.from(ledgersByRootTargetId.values())
        .map(ledger => ({
            ...ledger,
            contributions: [...ledger.contributions]
                .sort((left, right) => left.depth - right.depth || left.buildTarget.id.localeCompare(right.buildTarget.id, undefined, { sensitivity: 'base' })),
            totalCostEntries: aggregateBuildCostEntries(ledger.contributions.flatMap(contribution => contribution.costEntries)),
        }))
        .sort((left, right) => left.rootBuildTarget.id.localeCompare(right.rootBuildTarget.id, undefined, { sensitivity: 'base' }));
}

function createBuildCostTableRows(
    buildCostLedgers: readonly FoxholeProductionPlanBuildCostLedger[],
): FoxholeProductionPlanBuildCostTableRow[] {
    return buildCostLedgers
        .flatMap(ledger => {
            const contributionRows: FoxholeProductionPlanBuildCostTableRow[] = ledger.contributions.flatMap(contribution => contribution.costEntries.map(costEntry => ({
                kind: 'contribution',
                rootBuildTarget: ledger.rootBuildTarget,
                includesParentBuildCosts: ledger.includesParentBuildCosts,
                buildTarget: contribution.buildTarget,
                depth: contribution.depth,
                recipeId: contribution.recipeId,
                recipeRunCount: contribution.recipeRunCount,
                commodityKey: costEntry.commodityKey,
                channel: costEntry.channel,
                resourceId: costEntry.resourceId,
                quantity: costEntry.quantity,
            })));

            const totalRows: FoxholeProductionPlanBuildCostTableRow[] = ledger.totalCostEntries.map(costEntry => ({
                kind: 'total',
                rootBuildTarget: ledger.rootBuildTarget,
                includesParentBuildCosts: ledger.includesParentBuildCosts,
                buildTarget: null,
                depth: null,
                recipeId: null,
                recipeRunCount: null,
                commodityKey: costEntry.commodityKey,
                channel: costEntry.channel,
                resourceId: costEntry.resourceId,
                quantity: costEntry.quantity,
            }));

            return [...contributionRows, ...totalRows];
        })
        .sort((left, right) => {
            const rootCompare = left.rootBuildTarget.id.localeCompare(right.rootBuildTarget.id, undefined, { sensitivity: 'base' });
            if (rootCompare !== 0) {
                return rootCompare;
            }

            const kindCompare = left.kind.localeCompare(right.kind, undefined, { sensitivity: 'base' });
            if (kindCompare !== 0) {
                return kindCompare;
            }

            const depthCompare = (left.depth ?? Number.MAX_SAFE_INTEGER) - (right.depth ?? Number.MAX_SAFE_INTEGER);
            if (depthCompare !== 0) {
                return depthCompare;
            }

            const buildTargetCompare = (left.buildTarget?.id ?? '').localeCompare(right.buildTarget?.id ?? '', undefined, { sensitivity: 'base' });
            if (buildTargetCompare !== 0) {
                return buildTargetCompare;
            }

            return left.commodityKey.localeCompare(right.commodityKey, undefined, { sensitivity: 'base' });
        });
}

function createPlanBlockers(demandNodes: readonly FoxholeProductionPlanNode[]): FoxholeProductionPlanBlocker[] {
    const blockersByKey = new Map<string, FoxholeProductionPlanBlocker>();
    const visit = (node: FoxholeProductionPlanNode) => {
        if (node.source === 'missing' || node.source === 'ambiguous' || node.source === 'cycle') {
            const kind = node.source as FoxholeProductionPlanBlockerKind;
            const blockerKey = `${kind}:${node.commodityKey}`;
            const unresolvedQuantity = Math.max(0, node.requestedQuantity - node.satisfiedQuantity);
            const existing = blockersByKey.get(blockerKey);
            if (existing) {
                existing.requestedQuantity += node.requestedQuantity;
                existing.unresolvedQuantity += unresolvedQuantity;
                appendUniqueValues(existing.candidateRecipeIds, node.candidateRecipeIds);
            } else {
                blockersByKey.set(blockerKey, {
                    kind,
                    commodityKey: node.commodityKey,
                    channel: node.channel,
                    resourceId: node.resourceId,
                    buildTarget: node.channel === 'build'
                        ? parseFoxholeProductionBuildTargetId(node.resourceId)
                        : null,
                    requestedQuantity: node.requestedQuantity,
                    unresolvedQuantity,
                    candidateRecipeIds: [...node.candidateRecipeIds],
                });
            }
        }

        for (const child of node.children) {
            visit(child);
        }
    };

    for (const demandNode of demandNodes) {
        visit(demandNode);
    }

    return Array.from(blockersByKey.values())
        .sort((left, right) => {
            const kindCompare = left.kind.localeCompare(right.kind, undefined, { sensitivity: 'base' });
            return kindCompare !== 0
                ? kindCompare
                : left.commodityKey.localeCompare(right.commodityKey, undefined, { sensitivity: 'base' });
        });
}

function createBranchDecisions(
    index: FoxholeProductionIndex,
    demandNodes: readonly FoxholeProductionPlanNode[],
    request: FoxholeProductionPlanRequest,
): FoxholeProductionPlanBranchDecision[] {
    const decisionsByCommodityKey = new Map<string, FoxholeProductionPlanBranchDecision>();
    const preferredRecipeIdByOutput = request.preferredRecipeIdByOutput ?? {};
    const externalSupplyByCommodityKey = request.externalSupplyByCommodityKey ?? {};

    const visit = (node: FoxholeProductionPlanNode, depth: number) => {
        const preferredRecipeId = normalizeKey(preferredRecipeIdByOutput[node.commodityKey]);
        const externalSupplyAmount = normalizeExternalSupplyAmount(externalSupplyByCommodityKey[node.commodityKey]);
        const hasExplicitOverride = Boolean(preferredRecipeId) || externalSupplyAmount !== null;
        if (shouldIncludeBranchDecision(node, depth, hasExplicitOverride)) {
            const availableRecipeIds = node.candidateRecipeIds.length > 0
                ? [...node.candidateRecipeIds]
                : [...(index.recipeIdsByOutput[node.commodityKey] ?? [])];
            const existing = decisionsByCommodityKey.get(node.commodityKey);
            if (existing) {
                existing.requestedQuantity += node.requestedQuantity;
                existing.satisfiedQuantity += node.satisfiedQuantity;
                existing.depth = Math.min(existing.depth, depth);
                existing.consumedFromExternal += node.consumedFromExternal;
                existing.consumedFromStock += node.consumedFromStock;
                appendUniqueValues(existing.availableRecipeIds, availableRecipeIds);
                appendUniqueValues(existing.currentSources, [node.source]);
                appendUniqueValues(existing.currentRecipeIds, node.recipeId ? [node.recipeId] : []);
            } else {
                decisionsByCommodityKey.set(node.commodityKey, {
                    commodityKey: node.commodityKey,
                    channel: node.channel,
                    resourceId: node.resourceId,
                    buildTarget: node.channel === 'build'
                        ? parseFoxholeProductionBuildTargetId(node.resourceId)
                        : null,
                    requestedQuantity: node.requestedQuantity,
                    satisfiedQuantity: node.satisfiedQuantity,
                    depth,
                    allowExternal: depth > 0,
                    availableRecipeIds,
                    currentSources: [node.source],
                    currentRecipeIds: node.recipeId ? [node.recipeId] : [],
                    consumedFromExternal: node.consumedFromExternal,
                    consumedFromStock: node.consumedFromStock,
                    selectionKind: getBranchDecisionSelectionKind(preferredRecipeId, externalSupplyAmount),
                    selectedRecipeId: preferredRecipeId || null,
                    externalSupplyAmount,
                });
            }
        }

        for (const child of node.children) {
            visit(child, depth + 1);
        }
    };

    for (const demandNode of demandNodes) {
        visit(demandNode, 0);
    }

    return Array.from(decisionsByCommodityKey.values())
        .sort((left, right) => left.depth - right.depth || left.commodityKey.localeCompare(right.commodityKey, undefined, { sensitivity: 'base' }));
}

function createBranchDecisionRows(
    branchDecisions: readonly FoxholeProductionPlanBranchDecision[],
): FoxholeProductionPlanBranchDecisionRow[] {
    return branchDecisions.map(decision => ({
        commodityKey: decision.commodityKey,
        channel: decision.channel,
        resourceId: decision.resourceId,
        buildTarget: decision.buildTarget,
        requestedQuantity: decision.requestedQuantity,
        satisfiedQuantity: decision.satisfiedQuantity,
        depth: decision.depth,
        allowExternal: decision.allowExternal,
        availableRecipeIds: [...decision.availableRecipeIds],
        availableRecipeCount: decision.availableRecipeIds.length,
        currentSources: [...decision.currentSources],
        currentRecipeIds: [...decision.currentRecipeIds],
        currentRecipeCount: decision.currentRecipeIds.length,
        consumedFromExternal: decision.consumedFromExternal,
        consumedFromStock: decision.consumedFromStock,
        selectionKind: decision.selectionKind,
        selectedRecipeId: decision.selectedRecipeId,
        externalSupplyAmount: decision.externalSupplyAmount,
    }));
}

export function planFoxholeProduction(
    index: FoxholeProductionIndex,
    request: FoxholeProductionPlanRequest,
): FoxholeProductionPlanResult {
    const context: FoxholeProductionPlannerContext = {
        index,
        preferredRecipeIdByOutput: { ...(request.preferredRecipeIdByOutput ?? {}) },
        stockByCommodityKey: {},
        externalSupplyRemaining: { ...(request.externalSupplyByCommodityKey ?? {}) },
        recipeRunsById: {},
        missingCommodityAmounts: {},
        ambiguousCommodityRecipeIds: {},
        cycleCommodityKeys: new Set<string>(),
        externalSupplyConsumed: {},
    };

    const planDemands = normalizePlanDemands(index, request);
    const demandNodes = planDemands.map(demand => resolveDemand(context, demand, []));
    const targetSteps = demandNodes.map((node, index) => createPlanTargetStep(node, planDemands[index]!));
    const buildCostLedgers = createBuildCostLedgers(index, targetSteps);
    const buildCostTableRows = createBuildCostTableRows(buildCostLedgers);
    const branchDecisions = createBranchDecisions(index, demandNodes, request);
    const branchDecisionRows = createBranchDecisionRows(branchDecisions);
    const machineRecipeRunsById = Object.fromEntries(Object.entries(context.recipeRunsById)
        .filter(([recipeId]) => {
            const recipe = index.recipeById[recipeId];
            return recipe && !isFoxholeProductionBuildRecipe(recipe);
        }));
    const machineRuns = createMachineRuns(machineRecipeRunsById);
    const machineRequirementRows = createMachineRequirementRows(index, machineRuns);
    const blockers = createPlanBlockers(demandNodes);
    const result: FoxholeProductionPlanResult = {
        status: 'ok',
        demandNodes,
        targetSteps,
        buildCostLedgers,
        buildCostTableRows,
        machineRequirementRows,
        branchDecisions,
        branchDecisionRows,
        recipeRunsById: context.recipeRunsById,
        machineRecipeRunsById,
        machineRuns,
        blockers,
        missingCommodityAmounts: context.missingCommodityAmounts,
        ambiguousCommodityRecipeIds: context.ambiguousCommodityRecipeIds,
        cycleCommodityKeys: Array.from(context.cycleCommodityKeys),
        externalSupplyConsumed: context.externalSupplyConsumed,
        surplusByCommodityKey: Object.fromEntries(Object.entries(context.stockByCommodityKey)
            .filter(([, quantity]) => quantity > EPSILON)),
    };

    result.status = resolveStatus(result);
    return result;
}
