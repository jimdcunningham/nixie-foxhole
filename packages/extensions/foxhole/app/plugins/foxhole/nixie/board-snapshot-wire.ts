import {
    registerBoardSnapshotLegacyTypeAlias,
    registerBoardSnapshotWireProfile,
} from '#nixie/plugins/nixie/board/board-snapshot-wire-registry.ts';
import { SHARED_TRANSFORM_WIRE_KEYS } from '#nixie/plugins/nixie/board/built-in-snapshot-wire.ts';
import {
    FOXHOLE_ASSET_NODE_TYPE,
    LEGACY_FOXHOLE_STRUCTURE_NODE_TYPE,
} from '#foxhole/plugins/foxhole/nixie/types.ts';
import {
    FOXHOLE_BINOCULAR_LINE_NODE_TYPE,
} from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';
import {
    FOXHOLE_CONNECTOR_NODE_TYPE,
} from '#foxhole/plugins/foxhole/nixie/connector.ts';
import {
    FOXHOLE_RANGE_NODE_TYPE,
} from '#foxhole/plugins/foxhole/nixie/range.ts';
import {
    FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
} from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import {
    FOXHOLE_TACTICAL_LINE_NODE_TYPE,
} from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';

const FOXHOLE_ASSET_WIRE_KEYS = {
    ...SHARED_TRANSFORM_WIRE_KEYS,
    foxholeKey: 'k',
    faction: 'fa',
    colorHex: 'ch',
    destroyed: 'd',
    packaged: 'p',
    blueprint: 'bp',
    tint: 'ti',
    brightness: 'br',
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

const FOXHOLE_RANGE_WIRE_KEYS = {
    ...SHARED_TRANSFORM_WIRE_KEYS,
    points: 'pt',
    sweepAngle: 'sw',
    scaleWithZoom: 'sz',
    strokeColor: 'sc',
    strokeWidth: 'sw',
    strokeAlpha: 'sa',
    strokeStyle: 'sst',
    strokeDashLength: 'sdl',
    strokeDashGap: 'sdg',
    fillColor: 'fc',
    fillAlpha: 'fa',
    showCenterAxis: 'sca',
    showRadius: 'sr',
    showAngle: 'san',
    labelColor: 'lc',
    labelFontSize: 'lfs',
    labelBackgroundColor: 'lbc',
    labelBackgroundAlpha: 'lba',
    labelPadding: 'lpd',
    labelStrokeWidth: 'lsw',
    centerMarkerRadius: 'cmr',
    meterPixels: 'mp',
    decimals: 'dc',
} as const;

const FOXHOLE_TACTICAL_LINE_WIRE_KEYS = {
    ...SHARED_TRANSFORM_WIRE_KEYS,
    points: 'pt',
    scaleWithZoom: 'sz',
    id: 'id',
    label: 'lb',
    description: 'ds',
    presetId: 'pi',
    curveMode: 'cm',
    strokeColor: 'sc',
    strokeWidth: 'sw',
    strokeAlpha: 'sa',
    strokeStyle: 'sst',
    strokeDashLength: 'sdl',
    strokeDashGap: 'sdg',
    startCap: 'sca',
    endCap: 'eca',
    decoratorMode: 'dm',
    decoratorSide: 'dsi',
    decoratorSize: 'dsz',
    decoratorSpacing: 'dsp',
    decoratorFill: 'df',
    decoratorColor: 'dc',
    decoratorAlpha: 'da',
} as const;

const foxholeWireProfiles: Array<[string, Parameters<typeof registerBoardSnapshotWireProfile>[1]]> = [
    [FOXHOLE_ASSET_NODE_TYPE, {
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
    }],
    [FOXHOLE_CONNECTOR_NODE_TYPE, { wireTypeCode: 'fc', stateKeyMap: SHARED_TRANSFORM_WIRE_KEYS }],
    [FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE, {
        wireTypeCode: 'sc',
        stateKeyMap: {
            ...SHARED_TRANSFORM_WIRE_KEYS,
            modificationVariantIds: 'm',
            tint: 'ti',
            brightness: 'br',
            blueprint: 'bp',
        },
    }],
    [FOXHOLE_BINOCULAR_LINE_NODE_TYPE, { wireTypeCode: 'bl', stateKeyMap: FOXHOLE_BINOCULAR_LINE_WIRE_KEYS }],
    [FOXHOLE_RANGE_NODE_TYPE, { wireTypeCode: 'rg', stateKeyMap: FOXHOLE_RANGE_WIRE_KEYS }],
    [FOXHOLE_TACTICAL_LINE_NODE_TYPE, { wireTypeCode: 'tl', stateKeyMap: FOXHOLE_TACTICAL_LINE_WIRE_KEYS }],
];

export function registerFoxholeBoardSnapshotWireProfiles(): void {
    registerBoardSnapshotLegacyTypeAlias(LEGACY_FOXHOLE_STRUCTURE_NODE_TYPE, FOXHOLE_ASSET_NODE_TYPE);

    for (const [type, profile] of foxholeWireProfiles) {
        registerBoardSnapshotWireProfile(type, profile);
    }
}

registerFoxholeBoardSnapshotWireProfiles();
