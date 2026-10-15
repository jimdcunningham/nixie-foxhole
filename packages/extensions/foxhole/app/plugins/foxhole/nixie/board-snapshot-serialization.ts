import {
    createSnapshotSerializationProfile,
    registerBoardSnapshotSerializationProfile,
} from '#nixie/plugins/nixie/board/snapshot-serialization.ts';
import {
    DEFAULT_FOXHOLE_STRUCTURE_STATE,
    normalizeFoxholeStructureState,
} from '#foxhole/plugins/foxhole/nixie/structure-state.ts';
import {
    DEFAULT_FOXHOLE_CONNECTOR_STATE,
    FOXHOLE_CONNECTOR_NODE_TYPE,
    normalizeFoxholeConnectorState,
} from '#foxhole/plugins/foxhole/nixie/connector.ts';
import {
    DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE,
    FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
    normalizeFoxholeSplineConnectorState,
} from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import {
    DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,
    FOXHOLE_BINOCULAR_LINE_NODE_TYPE,
    normalizeFoxholeBinocularLineState,
} from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';
import {
    DEFAULT_FOXHOLE_RANGE_STATE,
    FOXHOLE_RANGE_NODE_TYPE,
    normalizeFoxholeRangeState,
} from '#foxhole/plugins/foxhole/nixie/range.ts';
import {
    DEFAULT_FOXHOLE_TRIANGULATION_STATE,
    FOXHOLE_TRIANGULATION_NODE_TYPE,
    normalizeFoxholeTriangulationState,
} from '#foxhole/plugins/foxhole/nixie/triangulation.ts';
import {
    applyFoxholeTacticalLinePreset,
    DEFAULT_FOXHOLE_TACTICAL_LINE_STATE,
    FOXHOLE_TACTICAL_LINE_NODE_TYPE,
} from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import { FOXHOLE_ASSET_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/types.ts';
import type { FoxholeStructureState } from '#foxhole/plugins/foxhole/nixie/structure-state.ts';

const foxholeProfiles: Array<[string, ReturnType<typeof createSnapshotSerializationProfile>]> = [
    [FOXHOLE_ASSET_NODE_TYPE, createSnapshotSerializationProfile({
        defaults: DEFAULT_FOXHOLE_STRUCTURE_STATE,
        normalize: state => normalizeFoxholeStructureState({
            ...DEFAULT_FOXHOLE_STRUCTURE_STATE,
            ...(state ?? {}),
        } as FoxholeStructureState),
    })],
    [FOXHOLE_CONNECTOR_NODE_TYPE, createSnapshotSerializationProfile({
        defaults: DEFAULT_FOXHOLE_CONNECTOR_STATE,
        normalize: state => normalizeFoxholeConnectorState(state),
    })],
    [FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE, createSnapshotSerializationProfile({
        defaults: DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE,
        normalize: state => normalizeFoxholeSplineConnectorState(state),
    })],
    [FOXHOLE_BINOCULAR_LINE_NODE_TYPE, createSnapshotSerializationProfile({
        defaults: DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,
        normalize: state => normalizeFoxholeBinocularLineState(state),
    })],
    [FOXHOLE_RANGE_NODE_TYPE, createSnapshotSerializationProfile({
        defaults: DEFAULT_FOXHOLE_RANGE_STATE,
        normalize: state => normalizeFoxholeRangeState(state),
    })],
    [FOXHOLE_TRIANGULATION_NODE_TYPE, createSnapshotSerializationProfile({
        defaults: DEFAULT_FOXHOLE_TRIANGULATION_STATE,
        normalize: state => normalizeFoxholeTriangulationState(state),
    })],
    [FOXHOLE_TACTICAL_LINE_NODE_TYPE, createSnapshotSerializationProfile({
        defaults: DEFAULT_FOXHOLE_TACTICAL_LINE_STATE,
        normalize: state => applyFoxholeTacticalLinePreset(
            state ?? {},
            (state?.presetId as string | undefined) ?? 'frontline',
        ),
    })],
];

export function registerFoxholeBoardSnapshotSerializationProfiles(): void {
    for (const [type, profile] of foxholeProfiles) {
        registerBoardSnapshotSerializationProfile(type, profile);
    }
}

registerFoxholeBoardSnapshotSerializationProfiles();
