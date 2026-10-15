import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import {
    FOXHOLE_BINOCULAR_LINE_NODE_TYPE,
    createFoxholeBinocularLineNodeId,
    normalizeFoxholeBinocularLinePointsToLocalOrigin,
    normalizeFoxholeBinocularLineState,

} from './binocular-line.ts';
import type { FoxholeBinocularLineState } from './binocular-line.ts';

export interface CreateFoxholeBinocularLineSnapshotOptions {
    id?: string;
    key?: string;
    points: number[];
    state?: Partial<FoxholeBinocularLineState>;
}

export function createFoxholeBinocularLineSnapshot(
    options: CreateFoxholeBinocularLineSnapshotOptions,
): BoardNodeSnapshot<FoxholeBinocularLineState> {
    const normalizedPoints = normalizeFoxholeBinocularLinePointsToLocalOrigin(options.points);
    const state = normalizeFoxholeBinocularLineState({
        ...options.state,
        x: normalizedPoints.x,
        y: normalizedPoints.y,
        points: normalizedPoints.points,
    });

    return {
        id: options.id ?? createFoxholeBinocularLineNodeId(),
        type: FOXHOLE_BINOCULAR_LINE_NODE_TYPE,
        key: options.key ?? 'Binoculars Tool',
        state,
        children: [],
    };
}
