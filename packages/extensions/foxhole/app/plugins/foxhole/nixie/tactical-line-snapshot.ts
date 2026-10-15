import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import {
    FOXHOLE_TACTICAL_LINE_NODE_TYPE,
    applyFoxholeTacticalLinePreset,
    createFoxholeTacticalLineNodeId,
    normalizeTacticalLinePointsToLocalOrigin,

} from './tactical-line.ts';
import type { FoxholeTacticalLinePresetId, FoxholeTacticalLineState } from './tactical-line.ts';

export interface CreateFoxholeTacticalLineSnapshotOptions {
    id?: string;
    key?: string;
    points: number[];
    presetId?: FoxholeTacticalLinePresetId;
    state?: Partial<FoxholeTacticalLineState>;
}

export function createFoxholeTacticalLineSnapshot(
    options: CreateFoxholeTacticalLineSnapshotOptions,
): BoardNodeSnapshot<FoxholeTacticalLineState> {
    const normalizedPoints = normalizeTacticalLinePointsToLocalOrigin(options.points);
    const state = applyFoxholeTacticalLinePreset({
        ...options.state,
        x: normalizedPoints.x,
        y: normalizedPoints.y,
        points: normalizedPoints.points,
    }, options.state?.presetId ?? options.presetId ?? 'frontline');

    return {
        id: options.id ?? createFoxholeTacticalLineNodeId(),
        type: FOXHOLE_TACTICAL_LINE_NODE_TYPE,
        key: options.key ?? 'Tactical Line',
        state,
        children: [],
    };
}
