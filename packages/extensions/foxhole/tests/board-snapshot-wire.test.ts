import assert from 'node:assert/strict';
import test from 'node:test';
import {
    compactBoardNodeSnapshot,
    createSnapshotSerializationProfile,
    expandBoardNodeSnapshot,
    registerBoardSnapshotSerializationProfile,
} from '../../../nixie/app/plugins/nixie/board/snapshot-serialization.ts';
import {
    compactWireBoardNodeSnapshots,
    expandWireBoardNodeSnapshots,
    fromWireBoardNodeSnapshot,
    toWireBoardNodeSnapshot,
} from '../../../nixie/app/plugins/nixie/board/board-snapshot-wire.ts';
import {
    registerBoardSnapshotLegacyTypeAlias,
    registerBoardSnapshotWireProfile,
} from '../../../nixie/app/plugins/nixie/board/board-snapshot-wire-registry.ts';
import { SHARED_TRANSFORM_WIRE_KEYS } from '../../../nixie/app/plugins/nixie/board/built-in-snapshot-wire.ts';
import {
    DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,
    FOXHOLE_BINOCULAR_LINE_NODE_TYPE,
    normalizeFoxholeBinocularLineState,
} from '../app/plugins/foxhole/nixie/binocular-line.ts';
import {
    DEFAULT_FOXHOLE_STRUCTURE_STATE,
    normalizeFoxholeStructureState,
} from '../app/plugins/foxhole/nixie/structure-state.ts';
import {
    FOXHOLE_ASSET_NODE_TYPE,
    LEGACY_FOXHOLE_STRUCTURE_NODE_TYPE,
} from '../app/plugins/foxhole/nixie/types.ts';
import type { FoxholeStructureState } from '../app/plugins/foxhole/nixie/types.ts';
import type { BoardNodeSnapshot } from '../../../nixie/app/plugins/nixie/board/types/node.ts';

const FOXHOLE_ASSET_WIRE_KEYS = {
    ...SHARED_TRANSFORM_WIRE_KEYS,
    foxholeKey: 'k',
    faction: 'fa',
    colorHex: 'ch',
    destroyed: 'd',
    packaged: 'p',
    blueprint: 'bp',
    tint: 'ti',
    anchorX: 'ax',
    anchorY: 'ay',
    modificationVariantIds: 'm',
    socketAttachments: 'sa',
} as const;

const FOXHOLE_BINOCULAR_LINE_WIRE_KEYS = {
    ...SHARED_TRANSFORM_WIRE_KEYS,
    points: 'pt',
    scaleWithZoom: 'sz',
    strokeColor: 'sc',
    strokeWidth: 'sw',
    strokeAlpha: 'sa',
    multiSegmentAlpha: 'msa',
    showDistance: 'sd',
    showAzimuth: 'saz',
    showAzimuthArrows: 'saa',
    labelColor: 'lc',
    labelFontSize: 'lfs',
    labelBackgroundColor: 'lbc',
    labelBackgroundAlpha: 'lba',
    labelPadding: 'lpd',
    labelStrokeWidth: 'lsw',
    endpointRadius: 'er',
    startCap: 'stc',
    endCap: 'ec',
    meterPixels: 'mp',
    decimals: 'dc',
} as const;

registerBoardSnapshotLegacyTypeAlias(LEGACY_FOXHOLE_STRUCTURE_NODE_TYPE, FOXHOLE_ASSET_NODE_TYPE);
registerBoardSnapshotWireProfile(FOXHOLE_ASSET_NODE_TYPE, {
    wireTypeCode: 'fx',
    stateKeyMap: FOXHOLE_ASSET_WIRE_KEYS,
    shouldOmitSnapshotKey: state => Boolean(String(state.foxholeKey ?? '').trim()),
    prepareEncodeState: state => {
        const nextState = { ...state };
        if (nextState.z === 0) {
            delete nextState.z;
        }
        return nextState;
    },
});
registerBoardSnapshotWireProfile(FOXHOLE_BINOCULAR_LINE_NODE_TYPE, {
    wireTypeCode: 'bl',
    stateKeyMap: FOXHOLE_BINOCULAR_LINE_WIRE_KEYS,
});

registerBoardSnapshotSerializationProfile(FOXHOLE_ASSET_NODE_TYPE, createSnapshotSerializationProfile({
    defaults: DEFAULT_FOXHOLE_STRUCTURE_STATE,
    normalize: state => normalizeFoxholeStructureState({
        ...DEFAULT_FOXHOLE_STRUCTURE_STATE,
        ...(state ?? {}),
    } as FoxholeStructureState),
}));
registerBoardSnapshotSerializationProfile(FOXHOLE_BINOCULAR_LINE_NODE_TYPE, createSnapshotSerializationProfile({
    defaults: DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,
    normalize: state => normalizeFoxholeBinocularLineState(state),
}));

function roundtripState(type: string, state: Record<string, unknown>) {
    const snapshot: BoardNodeSnapshot = {
        id: 'node-1',
        type,
        state,
        children: [],
    };
    const compact = compactBoardNodeSnapshot(snapshot);
    const expanded = expandBoardNodeSnapshot(compact);
    return {
        compact: compact.state,
        expanded: expanded.state,
        type: expanded.type,
    };
}

test('foxhole asset compacts to changed fields only and normalizes legacy type', () => {
    const full = normalizeFoxholeStructureState({
        ...DEFAULT_FOXHOLE_STRUCTURE_STATE,
        foxholeKey: 'shippart2',
        x: 384,
        y: -128,
        z: 0,
        packaged: true,
    });

    const { compact, expanded, type } = roundtripState('foxholeStructure', full as Record<string, unknown>);

    assert.equal(type, FOXHOLE_ASSET_NODE_TYPE);
    assert.deepEqual(compact, {
        foxholeKey: 'shippart2',
        x: 384,
        y: -128,
        packaged: true,
    });
    assert.deepEqual(expanded, full);
});

test('foxhole asset wire format uses short keys and omits empty children', () => {
    const full = normalizeFoxholeStructureState({
        ...DEFAULT_FOXHOLE_STRUCTURE_STATE,
        foxholeKey: 'foundation012x2t1',
        x: 128.046,
        y: -384,
        z: 0,
    });

    const snapshot: BoardNodeSnapshot = {
        id: 'node-1',
        type: FOXHOLE_ASSET_NODE_TYPE,
        key: 'Foundation (2x2)',
        state: full as Record<string, unknown>,
        children: [],
    };
    const wire = toWireBoardNodeSnapshot(compactBoardNodeSnapshot(snapshot));
    const expanded = expandBoardNodeSnapshot(fromWireBoardNodeSnapshot(wire));

    assert.equal(wire.t, 'fx');
    assert.equal(wire.k, undefined);
    assert.deepEqual(wire.s, { k: 'foundation012x2t1', x: 128.046, y: -384 });
    assert.equal(wire.c, undefined);
    assert.deepEqual(expanded.state, full);
    assert.equal(expanded.type, FOXHOLE_ASSET_NODE_TYPE);
});

test('foxhole binocular line compacts to geometry and position', () => {
    const full = normalizeFoxholeBinocularLineState({
        ...DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,
        x: 290.665,
        y: 898.369,
        points: [0, 0, 1201.298, 88.421],
    });

    const { compact, expanded } = roundtripState(FOXHOLE_BINOCULAR_LINE_NODE_TYPE, full as Record<string, unknown>);

    assert.deepEqual(compact, {
        x: 290.665,
        y: 898.369,
        points: [0, 0, 1201.298, 88.421],
    });
    assert.deepEqual(expanded, full);
});

test('wire project roots roundtrip through compact and expand helpers', () => {
    const roots: BoardNodeSnapshot[] = [{
        id: 'foxhole-asset-1',
        type: FOXHOLE_ASSET_NODE_TYPE,
        state: normalizeFoxholeStructureState({
            ...DEFAULT_FOXHOLE_STRUCTURE_STATE,
            foxholeKey: 'shippart2',
            x: 384,
            y: -128,
            packaged: true,
        }) as Record<string, unknown>,
        children: [],
    }];

    const wireRoots = compactWireBoardNodeSnapshots(roots);
    const expandedRoots = expandWireBoardNodeSnapshots(wireRoots);

    assert.equal(wireRoots[0]?.t, 'fx');
    assert.deepEqual(wireRoots[0]?.s, { k: 'shippart2', x: 384, y: -128, p: true });
    assert.equal(expandedRoots[0]?.type, FOXHOLE_ASSET_NODE_TYPE);
    assert.equal(expandedRoots[0]?.state.foxholeKey, 'shippart2');
    assert.equal(expandedRoots[0]?.state.packaged, true);
});
