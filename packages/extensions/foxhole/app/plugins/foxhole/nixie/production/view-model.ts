import type {
    FoxholeProductionExecutionMachineRow,
    FoxholeProductionPlanBlocker,
    FoxholeProductionPlanBuildCostTableRow,
    FoxholeProductionPlanBranchDecisionRow,
    FoxholeProductionPlanMachineRequirementRow,
    FoxholeProductionPlanResult,
    FoxholeProductionPlanTargetStep,
    FoxholeProductionSceneCoverage,
    FoxholeProductionViewGraphEdge,
    FoxholeProductionViewGraphNode,
    FoxholeProductionViewModelBundle,
    FoxholeProductionViewTableKey,
    FoxholeProductionViewTableSection,
    FoxholeProductionViewTables,
} from './types.ts';

function createTableSections(tables: FoxholeProductionViewTables): FoxholeProductionViewTableSection[] {
    const sections: Array<{ key: FoxholeProductionViewTableKey; label: string; rows: readonly unknown[]; }> = [{
        key: 'targets',
        label: 'Targets',
        rows: tables.targets,
    }, {
        key: 'buildCosts',
        label: 'Build Costs',
        rows: tables.buildCosts,
    }, {
        key: 'machineRequirements',
        label: 'Machine Requirements',
        rows: tables.machineRequirements,
    }, {
        key: 'branchDecisions',
        label: 'Branch Decisions',
        rows: tables.branchDecisions,
    }, {
        key: 'executionMachines',
        label: 'Execution Machines',
        rows: tables.executionMachines,
    }, {
        key: 'blockers',
        label: 'Blockers',
        rows: tables.blockers,
    }];

    return sections.map(section => ({
        key: section.key,
        label: section.label,
        rowCount: section.rows.length,
    }));
}

function createTargetNodes(targets: readonly FoxholeProductionPlanTargetStep[]): FoxholeProductionViewGraphNode[] {
    return targets.map((target, index) => ({
        id: `target:${index}:${target.commodityKey}`,
        kind: 'target',
        tableKey: 'targets',
        label: target.buildTarget?.id ?? target.commodityKey,
        commodityKey: target.commodityKey,
        buildTargetId: target.buildTarget?.id ?? null,
        depth: target.buildRollupDepth,
    }));
}

function createBuildCostNodes(rows: readonly FoxholeProductionPlanBuildCostTableRow[]): FoxholeProductionViewGraphNode[] {
    const rootNodes = new Map<string, FoxholeProductionViewGraphNode>();
    const contributionNodes: FoxholeProductionViewGraphNode[] = [];

    for (const row of rows) {
        const rootId = row.rootBuildTarget.id;
        if (!rootNodes.has(rootId)) {
            rootNodes.set(rootId, {
                id: `build-root:${rootId}`,
                kind: 'buildCostRoot',
                tableKey: 'buildCosts',
                label: rootId,
                commodityKey: null,
                buildTargetId: rootId,
                depth: 0,
            });
        }

        if (row.kind === 'contribution' && row.buildTarget) {
            contributionNodes.push({
                id: `build-cost:${rootId}:${row.buildTarget.id}:${row.commodityKey}`,
                kind: 'buildCostContribution',
                tableKey: 'buildCosts',
                label: `${row.buildTarget.id}:${row.commodityKey}`,
                commodityKey: row.commodityKey,
                buildTargetId: row.buildTarget.id,
                depth: row.depth,
            });
        }
    }

    return [
        ...Array.from(rootNodes.values()).sort((left, right) => left.id.localeCompare(right.id, undefined, { sensitivity: 'base' })),
        ...contributionNodes.sort((left, right) => left.id.localeCompare(right.id, undefined, { sensitivity: 'base' })),
    ];
}

function createMachineRequirementNodes(rows: readonly FoxholeProductionPlanMachineRequirementRow[]): FoxholeProductionViewGraphNode[] {
    return rows.map(row => ({
        id: `machine:${row.id}`,
        kind: 'machineRequirement',
        tableKey: 'machineRequirements',
        label: row.id,
        commodityKey: null,
        buildTargetId: row.placementRecipeId,
        depth: null,
    }));
}

function createBranchDecisionNodes(rows: readonly FoxholeProductionPlanBranchDecisionRow[]): FoxholeProductionViewGraphNode[] {
    return rows.map(row => ({
        id: `branch:${row.commodityKey}`,
        kind: 'branchDecision',
        tableKey: 'branchDecisions',
        label: row.commodityKey,
        commodityKey: row.commodityKey,
        buildTargetId: row.buildTarget?.id ?? null,
        depth: row.depth,
    }));
}

function createExecutionNodes(rows: readonly FoxholeProductionExecutionMachineRow[]): FoxholeProductionViewGraphNode[] {
    return rows.map(row => ({
        id: `execution:${row.id}`,
        kind: 'executionMachine',
        tableKey: 'executionMachines',
        label: row.id,
        commodityKey: null,
        buildTargetId: row.placementRecipeId,
        depth: null,
    }));
}

function createBlockerNodes(rows: readonly FoxholeProductionPlanBlocker[]): FoxholeProductionViewGraphNode[] {
    return rows.map(row => ({
        id: `blocker:${row.kind}:${row.commodityKey}`,
        kind: 'blocker',
        tableKey: 'blockers',
        label: `${row.kind}:${row.commodityKey}`,
        commodityKey: row.commodityKey,
        buildTargetId: row.buildTarget?.id ?? null,
        depth: null,
    }));
}

function createGraphEdges(tables: FoxholeProductionViewTables): FoxholeProductionViewGraphEdge[] {
    const targetNodes = tables.targets.map((target, index) => ({
        id: `target:${index}:${target.commodityKey}`,
        target,
    }));

    const edges: FoxholeProductionViewGraphEdge[] = [];

    for (const { id, target } of targetNodes) {
        const rootBuildTargetId = target.buildRollupRootTarget?.id;
        if (rootBuildTargetId) {
            edges.push({
                id: `edge:target-build:${id}:${rootBuildTargetId}`,
                kind: 'targetBuild',
                sourceId: id,
                targetId: `build-root:${rootBuildTargetId}`,
            });
        }

        const branchNodeId = `branch:${target.commodityKey}`;
        if (tables.branchDecisions.some(row => row.commodityKey === target.commodityKey)) {
            edges.push({
                id: `edge:decision:${id}:${branchNodeId}`,
                kind: 'decision',
                sourceId: id,
                targetId: branchNodeId,
            });
        }
    }

    for (const row of tables.buildCosts) {
        if (row.kind !== 'contribution' || !row.buildTarget) {
            continue;
        }

        edges.push({
            id: `edge:build-cost:${row.rootBuildTarget.id}:${row.buildTarget.id}:${row.commodityKey}`,
            kind: 'buildCost',
            sourceId: `build-cost:${row.rootBuildTarget.id}:${row.buildTarget.id}:${row.commodityKey}`,
            targetId: `build-root:${row.rootBuildTarget.id}`,
        });
    }

    for (const row of tables.executionMachines) {
        edges.push({
            id: `edge:execution:${row.id}`,
            kind: 'execution',
            sourceId: `machine:${row.id}`,
            targetId: `execution:${row.id}`,
        });
    }

    for (const row of tables.blockers) {
        if (!tables.branchDecisions.some(decision => decision.commodityKey === row.commodityKey)) {
            continue;
        }

        edges.push({
            id: `edge:blocker:${row.kind}:${row.commodityKey}`,
            kind: 'blocker',
            sourceId: `branch:${row.commodityKey}`,
            targetId: `blocker:${row.kind}:${row.commodityKey}`,
        });
    }

    return edges.sort((left, right) => left.id.localeCompare(right.id, undefined, { sensitivity: 'base' }));
}

export function createFoxholeProductionViewModelBundle(
    plan: FoxholeProductionPlanResult,
    sceneCoverage?: FoxholeProductionSceneCoverage | null,
): FoxholeProductionViewModelBundle {
    const tables: FoxholeProductionViewTables = {
        targets: plan.targetSteps,
        buildCosts: plan.buildCostTableRows,
        machineRequirements: plan.machineRequirementRows,
        branchDecisions: plan.branchDecisionRows,
        executionMachines: sceneCoverage?.executionRows ?? [],
        blockers: plan.blockers,
    };

    const graphNodes = [
        ...createTargetNodes(tables.targets),
        ...createBuildCostNodes(tables.buildCosts),
        ...createMachineRequirementNodes(tables.machineRequirements),
        ...createBranchDecisionNodes(tables.branchDecisions),
        ...createExecutionNodes(tables.executionMachines),
        ...createBlockerNodes(tables.blockers),
    ].sort((left, right) => left.id.localeCompare(right.id, undefined, { sensitivity: 'base' }));

    return {
        summary: {
            status: plan.status,
            targetCount: tables.targets.length,
            buildCostRowCount: tables.buildCosts.length,
            machineRequirementCount: tables.machineRequirements.length,
            branchDecisionCount: tables.branchDecisions.length,
            executionMachineCount: tables.executionMachines.length,
            blockerCount: tables.blockers.length,
            coveredExecutionMachineCount: tables.executionMachines.filter(row => row.status === 'covered').length,
            upgradeableExecutionMachineCount: tables.executionMachines.filter(row => row.status === 'upgradeable').length,
            uncoveredExecutionMachineCount: tables.executionMachines.filter(row => row.status === 'uncovered').length,
        },
        tableSections: createTableSections(tables),
        tables,
        graph: {
            nodes: graphNodes,
            edges: createGraphEdges(tables),
        },
    };
}
