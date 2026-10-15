import { FOXHOLE_STRUCTURE_NODE_TYPE } from '../types.ts';
import type { FoxholeProductionStructureSnapshotLike } from './types.ts';

/**
 * Minimal board-node shape for production snapshot collection.
 * Avoids coupling the production module to BoardNodeBase.
 */
export type FoxholeProductionBoardNodeLike = {
    boardId?: unknown;
    boardChildren?: readonly FoxholeProductionBoardNodeLike[] | null | undefined;
    toBoardSnapshot?: () => {
        type?: unknown;
        state?: FoxholeProductionStructureSnapshotLike['state'];
    } | null | undefined;
};

export function resolveFoxholeProductionSnapshot(
    node: FoxholeProductionBoardNodeLike | null | undefined,
): FoxholeProductionStructureSnapshotLike | null {
    const snapshot = node?.toBoardSnapshot?.();
    if (!snapshot || snapshot.type !== FOXHOLE_STRUCTURE_NODE_TYPE) {
        return null;
    }

    return {
        nodeId: String(node?.boardId ?? ''),
        state: snapshot.state ?? {},
    };
}

export function collectFoxholeProductionSnapshots(
    nodes: readonly FoxholeProductionBoardNodeLike[],
): FoxholeProductionStructureSnapshotLike[] {
    const entries: FoxholeProductionStructureSnapshotLike[] = [];
    const visit = (node: FoxholeProductionBoardNodeLike | null | undefined): void => {
        if (!node) {
            return;
        }

        const entry = resolveFoxholeProductionSnapshot(node);
        if (entry) {
            entries.push(entry);
        }

        for (const child of node.boardChildren ?? []) {
            visit(child);
        }
    };

    for (const node of nodes) {
        visit(node);
    }

    return entries;
}
