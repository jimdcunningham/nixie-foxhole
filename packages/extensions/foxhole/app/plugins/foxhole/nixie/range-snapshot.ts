import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import {
    FOXHOLE_RANGE_NODE_TYPE,
    createFoxholeRangeNodeId,
    normalizeFoxholeRangePointsToLocalOrigin,
    normalizeFoxholeRangeState,

} from './range.ts';
import type { FoxholeRangeState } from './range.ts';

export interface CreateFoxholeRangeSnapshotOptions {
    id?: string;
    key?: string;
    points: number[];
    state?: Partial<FoxholeRangeState>;
}

export function createFoxholeRangeSnapshot(
    options: CreateFoxholeRangeSnapshotOptions,
): BoardNodeSnapshot<FoxholeRangeState> {
    const anchored = normalizeFoxholeRangePointsToLocalOrigin(options.points);
    const state = normalizeFoxholeRangeState({
        ...options.state,
        x: anchored.x,
        y: anchored.y,
        points: anchored.points,
    });

    return {
        id: options.id ?? createFoxholeRangeNodeId(),
        type: FOXHOLE_RANGE_NODE_TYPE,
        key: options.key ?? 'Range Tool',
        state,
        children: [],
    };
}
