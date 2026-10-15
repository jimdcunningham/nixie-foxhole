export type FoxholeProductionChannel = 'item' | 'crate' | 'liquid' | 'build';

export type FoxholeProductionBuildTargetKind = 'structure' | 'vehicle' | 'upgrade' | 'modification';

export interface FoxholeProductionBuildTarget {
    id: string;
    kind: FoxholeProductionBuildTargetKind;
    structureId: string;
    slotId: string | null;
    variantId: string | null;
}

export interface FoxholeProductionResourceAmount {
    quantity: number;
    limit: number | null;
}

export interface FoxholeProductionDemand {
    channel: FoxholeProductionChannel;
    resourceId: string;
    quantity: number;
}

export interface FoxholeProductionRecipe {
    id: string;
    sourceType: 'structure' | 'modification';
    sourceStructureId: string;
    sourceStructureKey: string;
    sourceStructureName: string;
    sourceSlotId: string | null;
    sourceSlotName: string | null;
    sourceVariantId: string | null;
    sourceVariantName: string | null;
    sourceModificationId: string | null;
    isUpgrade: boolean;
    durationSeconds: number | null;
    powerDelta: number | null;
    consumesResourceNodes: boolean;
    itemInput: Record<string, FoxholeProductionResourceAmount>;
    crateInput: Record<string, FoxholeProductionResourceAmount>;
    liquidInput: Record<string, FoxholeProductionResourceAmount>;
    itemOutput: Record<string, FoxholeProductionResourceAmount>;
    crateOutput: Record<string, FoxholeProductionResourceAmount>;
    liquidOutput: Record<string, FoxholeProductionResourceAmount>;
    buildOutput: Record<string, FoxholeProductionResourceAmount>;
}

export interface FoxholeProductionIndex {
    recipeById: Record<string, FoxholeProductionRecipe>;
    recipeIdsByOutput: Record<string, string[]>;
    structureRecipeIdsByStructureId: Record<string, string[]>;
    modificationRecipeIdsBySlotVariantKey: Record<string, string[]>;
    parentBuildTargetIdByTargetId: Record<string, string>;
}

export type FoxholeProductionPlanNodeSource = 'recipe' | 'external' | 'stock' | 'missing' | 'ambiguous' | 'cycle';

export type FoxholeProductionPlanBlockerKind = Extract<FoxholeProductionPlanNodeSource, 'missing' | 'ambiguous' | 'cycle'>;

export type FoxholeProductionPlanDecisionSelectionKind = 'planner' | 'external' | 'recipe';

export interface FoxholeProductionPlanNode {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    requestedQuantity: number;
    satisfiedQuantity: number;
    consumedFromStock: number;
    consumedFromExternal: number;
    source: FoxholeProductionPlanNodeSource;
    recipeId: string | null;
    recipeRunCount: number | null;
    producedQuantity: number;
    surplusQuantity: number;
    candidateRecipeIds: string[];
    children: FoxholeProductionPlanNode[];
}

export interface FoxholeProductionPlanRequest {
    demands: FoxholeProductionDemand[];
    externalSupplyByCommodityKey?: Record<string, number | 'unbounded'>;
    preferredRecipeIdByOutput?: Record<string, string>;
    includeParentBuildCosts?: boolean;
}

export interface FoxholeProductionPlanTargetStep {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    buildTarget: FoxholeProductionBuildTarget | null;
    buildRollupRootTarget: FoxholeProductionBuildTarget | null;
    buildRollupDepth: number;
    buildRollupChain: FoxholeProductionBuildTarget[];
    requestedQuantity: number;
    satisfiedQuantity: number;
    source: FoxholeProductionPlanNodeSource;
    recipeId: string | null;
    recipeRunCount: number | null;
    producedQuantity: number;
    surplusQuantity: number;
    candidateRecipeIds: string[];
}

export interface FoxholeProductionPlanBuildCostEntry {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    quantity: number;
}

export interface FoxholeProductionPlanBuildCostContribution {
    buildTarget: FoxholeProductionBuildTarget;
    rootBuildTarget: FoxholeProductionBuildTarget;
    depth: number;
    recipeId: string | null;
    recipeRunCount: number | null;
    costEntries: FoxholeProductionPlanBuildCostEntry[];
}

export interface FoxholeProductionPlanBuildCostLedger {
    rootBuildTarget: FoxholeProductionBuildTarget;
    includesParentBuildCosts: boolean;
    contributions: FoxholeProductionPlanBuildCostContribution[];
    totalCostEntries: FoxholeProductionPlanBuildCostEntry[];
}

export type FoxholeProductionPlanBuildCostTableRowKind = 'contribution' | 'total';

export interface FoxholeProductionPlanBuildCostTableRow {
    kind: FoxholeProductionPlanBuildCostTableRowKind;
    rootBuildTarget: FoxholeProductionBuildTarget;
    includesParentBuildCosts: boolean;
    buildTarget: FoxholeProductionBuildTarget | null;
    depth: number | null;
    recipeId: string | null;
    recipeRunCount: number | null;
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    quantity: number;
}

export interface FoxholeProductionPlanMachineRequirementRow {
    id: string;
    placementRecipeId: string | null;
    sourceType: FoxholeProductionRecipe['sourceType'];
    sourceStructureId: string;
    sourceStructureName: string;
    sourceSlotId: string | null;
    sourceVariantId: string | null;
    sourceVariantName: string | null;
    sourceModificationId: string | null;
    isUpgrade: boolean;
    requiredRunCount: number;
    recipeRuns: FoxholeProductionMachineRequirementRecipeRun[];
}

export interface FoxholeProductionPlanMachineRun {
    recipeId: string;
    runCount: number;
}

export interface FoxholeProductionPlanBlocker {
    kind: FoxholeProductionPlanBlockerKind;
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    buildTarget: FoxholeProductionBuildTarget | null;
    requestedQuantity: number;
    unresolvedQuantity: number;
    candidateRecipeIds: string[];
}

export interface FoxholeProductionPlanBranchDecision {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    buildTarget: FoxholeProductionBuildTarget | null;
    requestedQuantity: number;
    satisfiedQuantity: number;
    depth: number;
    allowExternal: boolean;
    availableRecipeIds: string[];
    currentSources: FoxholeProductionPlanNodeSource[];
    currentRecipeIds: string[];
    consumedFromExternal: number;
    consumedFromStock: number;
    selectionKind: FoxholeProductionPlanDecisionSelectionKind;
    selectedRecipeId: string | null;
    externalSupplyAmount: number | 'unbounded' | null;
}

export interface FoxholeProductionPlanBranchDecisionRow {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    buildTarget: FoxholeProductionBuildTarget | null;
    requestedQuantity: number;
    satisfiedQuantity: number;
    depth: number;
    allowExternal: boolean;
    availableRecipeIds: string[];
    availableRecipeCount: number;
    currentSources: FoxholeProductionPlanNodeSource[];
    currentRecipeIds: string[];
    currentRecipeCount: number;
    consumedFromExternal: number;
    consumedFromStock: number;
    selectionKind: FoxholeProductionPlanDecisionSelectionKind;
    selectedRecipeId: string | null;
    externalSupplyAmount: number | 'unbounded' | null;
}

export interface FoxholeProductionPlanResult {
    status: 'ok' | 'ambiguous' | 'missing' | 'cycle';
    demandNodes: FoxholeProductionPlanNode[];
    targetSteps: FoxholeProductionPlanTargetStep[];
    buildCostLedgers: FoxholeProductionPlanBuildCostLedger[];
    buildCostTableRows: FoxholeProductionPlanBuildCostTableRow[];
    machineRequirementRows: FoxholeProductionPlanMachineRequirementRow[];
    branchDecisions: FoxholeProductionPlanBranchDecision[];
    branchDecisionRows: FoxholeProductionPlanBranchDecisionRow[];
    recipeRunsById: Record<string, number>;
    machineRecipeRunsById: Record<string, number>;
    machineRuns: FoxholeProductionPlanMachineRun[];
    blockers: FoxholeProductionPlanBlocker[];
    missingCommodityAmounts: Record<string, number>;
    ambiguousCommodityRecipeIds: Record<string, string[]>;
    cycleCommodityKeys: string[];
    externalSupplyConsumed: Record<string, number>;
    surplusByCommodityKey: Record<string, number>;
}

export interface FoxholeProductionMachineInstance {
    id: string;
    nodeId: string;
    foxholeKey: string;
    structureId: string;
    recipeIds: string[];
    selectedModificationVariantIds: Record<string, string>;
    destroyed: boolean;
    packaged: boolean;
    blueprint: boolean;
}

export type FoxholeProductionSceneCoverageStatus = 'covered' | 'upgradeable' | 'uncovered';

export interface FoxholeProductionMachineRequirementRecipeRun {
    recipeId: string;
    runCount: number;
}

export interface FoxholeProductionMachineRequirementCoverage {
    id: string;
    placementRecipeId: string | null;
    sourceType: FoxholeProductionRecipe['sourceType'];
    sourceStructureId: string;
    sourceSlotId: string | null;
    sourceVariantId: string | null;
    requiredRunCount: number;
    recipeRuns: FoxholeProductionMachineRequirementRecipeRun[];
    matchedMachineIds: string[];
    matchedMachineCount: number;
    upgradeableMachineIds: string[];
    upgradeableMachineCount: number;
    status: FoxholeProductionSceneCoverageStatus;
    canUpgradeExisting: boolean;
    needsFreshPlacement: boolean;
}

export interface FoxholeProductionSceneCoverage {
    machineRequirementByKey: Record<string, FoxholeProductionMachineRequirementCoverage>;
    machineRequirementKeyByRecipeId: Record<string, string>;
    machineRequirements: FoxholeProductionMachineRequirementCoverage[];
    executionRows: FoxholeProductionExecutionMachineRow[];
    coveredRequirementCount: number;
    upgradeableRequirementCount: number;
    uncoveredRequirementCount: number;
}

export interface FoxholeProductionExecutionMachineRow {
    id: string;
    placementRecipeId: string | null;
    sourceType: FoxholeProductionRecipe['sourceType'];
    sourceStructureId: string;
    sourceStructureName: string;
    sourceSlotId: string | null;
    sourceVariantId: string | null;
    sourceVariantName: string | null;
    sourceModificationId: string | null;
    isUpgrade: boolean;
    requiredRunCount: number;
    recipeRuns: FoxholeProductionMachineRequirementRecipeRun[];
    matchedMachineIds: string[];
    matchedMachineCount: number;
    upgradeableMachineIds: string[];
    upgradeableMachineCount: number;
    status: FoxholeProductionSceneCoverageStatus;
    canUpgradeExisting: boolean;
    needsFreshPlacement: boolean;
}

export type FoxholeProductionViewTableKey = 'targets' | 'buildCosts' | 'machineRequirements' | 'branchDecisions' | 'executionMachines' | 'blockers';

export interface FoxholeProductionViewTableSection {
    key: FoxholeProductionViewTableKey;
    label: string;
    rowCount: number;
}

export interface FoxholeProductionViewTables {
    targets: FoxholeProductionPlanTargetStep[];
    buildCosts: FoxholeProductionPlanBuildCostTableRow[];
    machineRequirements: FoxholeProductionPlanMachineRequirementRow[];
    branchDecisions: FoxholeProductionPlanBranchDecisionRow[];
    executionMachines: FoxholeProductionExecutionMachineRow[];
    blockers: FoxholeProductionPlanBlocker[];
}

export type FoxholeProductionViewGraphNodeKind = 'target' | 'buildCostRoot' | 'buildCostContribution' | 'machineRequirement' | 'branchDecision' | 'executionMachine' | 'blocker';

export interface FoxholeProductionViewGraphNode {
    id: string;
    kind: FoxholeProductionViewGraphNodeKind;
    tableKey: FoxholeProductionViewTableKey;
    label: string;
    commodityKey: string | null;
    buildTargetId: string | null;
    depth: number | null;
}

export type FoxholeProductionViewGraphEdgeKind = 'targetBuild' | 'buildCost' | 'decision' | 'execution' | 'blocker';

export interface FoxholeProductionViewGraphEdge {
    id: string;
    kind: FoxholeProductionViewGraphEdgeKind;
    sourceId: string;
    targetId: string;
}

export interface FoxholeProductionViewSummary {
    status: FoxholeProductionPlanResult['status'];
    targetCount: number;
    buildCostRowCount: number;
    machineRequirementCount: number;
    branchDecisionCount: number;
    executionMachineCount: number;
    blockerCount: number;
    coveredExecutionMachineCount: number;
    upgradeableExecutionMachineCount: number;
    uncoveredExecutionMachineCount: number;
}

export interface FoxholeProductionViewModelBundle {
    summary: FoxholeProductionViewSummary;
    tableSections: FoxholeProductionViewTableSection[];
    tables: FoxholeProductionViewTables;
    graph: {
        nodes: FoxholeProductionViewGraphNode[];
        edges: FoxholeProductionViewGraphEdge[];
    };
}

export interface FoxholeProductionStructureSnapshotLike {
    nodeId?: unknown;
    state?: {
        foxholeKey?: unknown;
        modificationVariantIds?: unknown;
        destroyed?: unknown;
        packaged?: unknown;
        blueprint?: unknown;
    } | null | undefined;
}

/** Output-first catalog entry for itinerary / assistant queries. */
export interface FoxholeProductionOutputCatalogEntry {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    label: string;
    searchText: string;
    producerCount: number;
    sampleProducerNames: string[];
    /**
     * When channel is build and the target is a fixed world structure
     * (Refinery, Factory, …), cost recipes mean reconstruction — not free placement.
     */
    isWorldStructure?: boolean;
}

export type FoxholeProductionItineraryStepKind
    = | 'obtain'
        | 'produce'
        | 'build'
        | 'choose'
        | 'blocked';

export type FoxholeProductionItineraryRouteRankHint
    = | 'worldStructure'
        | 'fewerInputs'
        | 'faster'
        | 'lowerPower';

export interface FoxholeProductionItineraryRouteOptionInput {
    commodityKey: string;
    label: string;
    quantity: number;
}

export interface FoxholeProductionItineraryRouteOption {
    recipeId: string;
    label: string;
    structureId: string;
    structureName: string;
    isWorldStructure: boolean;
    runCount: number;
    durationSeconds: number | null;
    powerDelta: number | null;
    inputSummary: FoxholeProductionItineraryRouteOptionInput[];
    rankHints: FoxholeProductionItineraryRouteRankHint[];
    score: number;
}

export interface FoxholeProductionItineraryPendingChoice {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    label: string;
    requestedQuantity: number;
    options: FoxholeProductionItineraryRouteOption[];
}

export interface FoxholeProductionItineraryStep {
    id: string;
    kind: FoxholeProductionItineraryStepKind;
    title: string;
    summary: string;
    commodityKey: string | null;
    channel: FoxholeProductionChannel | null;
    resourceId: string | null;
    recipeId: string | null;
    structureId: string | null;
    structureName: string | null;
    /** True when this build step reconstructs a fixed world structure. */
    isWorldStructure?: boolean;
    quantity: number | null;
    runCount: number | null;
    durationSeconds: number | null;
    candidateRecipeIds: string[];
    options: FoxholeProductionItineraryRouteOption[];
}

export type FoxholeProductionLeafGatherSourceKind
    = | 'resource_field'
        | 'resource_mine'
        | 'stationary_harvester';

/** World / gather sources for raw leaves (fields, mines, harvesters). */
export interface FoxholeProductionLeafGatherSource {
    structureId: string;
    label: string;
    kind: FoxholeProductionLeafGatherSourceKind;
    note?: string;
}

export interface FoxholeProductionItineraryLeafRequirement {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    label: string;
    quantity: number;
    source: Extract<FoxholeProductionPlanNodeSource, 'external' | 'stock' | 'missing'>;
    /** Where players can obtain this leaf in the world (when known). */
    gatherSources?: FoxholeProductionLeafGatherSource[];
}

export interface FoxholeProductionItineraryProducer {
    recipeId: string;
    structureId: string;
    structureName: string;
    runCount: number;
    durationSeconds: number | null;
    label: string;
}

export interface FoxholeProductionItineraryBoardSummary {
    coveredRequirementCount: number;
    upgradeableRequirementCount: number;
    uncoveredRequirementCount: number;
    rows: Array<{
        id: string;
        structureId: string;
        structureName: string;
        status: FoxholeProductionSceneCoverageStatus;
        requiredRunCount: number;
        matchedMachineCount: number;
    }>;
}

export interface FoxholeProductionItineraryGoal {
    commodityKey: string;
    channel: FoxholeProductionChannel;
    resourceId: string;
    label: string;
    quantity: number;
    /** True when the goal is reconstructing a fixed world structure. */
    isWorldStructure?: boolean;
}

export type FoxholeProductionItineraryAssumptions = 'full' | 'public_logi';

export interface FoxholeProductionItineraryResult {
    goal: FoxholeProductionItineraryGoal;
    status: FoxholeProductionPlanResult['status'];
    assumptions: FoxholeProductionItineraryAssumptions;
    steps: FoxholeProductionItineraryStep[];
    leafRequirements: FoxholeProductionItineraryLeafRequirement[];
    producers: FoxholeProductionItineraryProducer[];
    blockers: FoxholeProductionPlanBlocker[];
    pendingChoices: FoxholeProductionItineraryPendingChoice[];
    board: FoxholeProductionItineraryBoardSummary | null;
    plan: FoxholeProductionPlanResult;
}
