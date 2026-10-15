import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import { normalizeFlatPointsToLocalOrigin } from '#nixie/plugins/nixie/board/utils/polyline-points.ts';
import {
    createFoxholeTriangulationNodeId,
    DEFAULT_FOXHOLE_TRIANGULATION_STATE,
    normalizeFoxholeTriangulationState,
    resolveFoxholeTriangulationFit,
    FOXHOLE_TRIANGULATION_NODE_TYPE,
} from '#foxhole/plugins/foxhole/nixie/triangulation.ts';
import type { FoxholeTriangulationState } from '#foxhole/plugins/foxhole/nixie/triangulation.ts';

export interface CreateFoxholeTriangulationSnapshotOptions {
    id?: string;
    key?: string;
    points: number[];
    state?: Partial<FoxholeTriangulationState>;
}

export function createFoxholeTriangulationSnapshot(
    options: CreateFoxholeTriangulationSnapshotOptions,
): BoardNodeSnapshot<FoxholeTriangulationState> {
    const anchored = normalizeFlatPointsToLocalOrigin(
        options.points,
        DEFAULT_FOXHOLE_TRIANGULATION_STATE.edgePoints,
        6,
    );
    const candidateState = normalizeFoxholeTriangulationState({
        ...options.state,
        x: anchored.x,
        y: anchored.y,
        edgePoints: anchored.points,
    });
    if (!resolveFoxholeTriangulationFit(candidateState)) {
        throw new Error('Triangulation requires at least three non-collinear edge points.');
    }

    return {
        id: options.id ?? createFoxholeTriangulationNodeId(),
        type: FOXHOLE_TRIANGULATION_NODE_TYPE,
        key: options.key ?? 'Triangulation',
        state: candidateState,
        children: [],
    };
}
