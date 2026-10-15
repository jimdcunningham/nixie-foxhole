import {
    DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,

} from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';
import type { FoxholeBinocularLineEndCap, FoxholeBinocularLineState } from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';
import {
    pickProvidedOptionFields,
    readBooleanOption,
    readColorOption,
    readEnumOption,
    readNumberOption,
} from '#foxhole/plugins/foxhole/nixie/foxhole-tool-option-utils.ts';

export interface BinocularLineToolOptions {
    scaleWithZoom: boolean;
    strokeColor: number | string;
    strokeWidth: number;
    strokeAlpha: number;
    multiSegmentAlpha: number;
    showDistance: boolean;
    showAzimuth: boolean;
    showAzimuthArrows: boolean;
    labelColor: number | string;
    labelFontSize: number;
    labelBackgroundColor: number | string;
    labelBackgroundAlpha: number;
    labelPadding: number;
    labelStrokeWidth: number;
    endpointRadius: number;
    startCap: FoxholeBinocularLineEndCap;
    endCap: FoxholeBinocularLineEndCap;
    meterPixels: number;
    decimals: number;
}

const END_CAPS = ['none', 'arrow', 'circle'] as const;

export function createBinocularLineToolOptionsFromDefaults(): BinocularLineToolOptions {
    const defaults = DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE;
    return createBinocularLineToolOptionsFromState(defaults);
}

export function createBinocularLineToolOptionsFromState(
    state: Partial<FoxholeBinocularLineState>,
): BinocularLineToolOptions {
    const defaults = DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE;
    return {
        scaleWithZoom: readBooleanOption(state.scaleWithZoom, defaults.scaleWithZoom),
        strokeColor: readColorOption(state.strokeColor, defaults.strokeColor),
        strokeWidth: readNumberOption(state.strokeWidth, defaults.strokeWidth, 1),
        strokeAlpha: readNumberOption(state.strokeAlpha, defaults.strokeAlpha, 0, 1),
        multiSegmentAlpha: readNumberOption(state.multiSegmentAlpha, defaults.multiSegmentAlpha, 0, 1),
        showDistance: readBooleanOption(state.showDistance, defaults.showDistance),
        showAzimuth: readBooleanOption(state.showAzimuth, defaults.showAzimuth),
        showAzimuthArrows: readBooleanOption(state.showAzimuthArrows, defaults.showAzimuthArrows),
        labelColor: readColorOption(state.labelColor, defaults.labelColor),
        labelFontSize: readNumberOption(state.labelFontSize, defaults.labelFontSize, 6),
        labelBackgroundColor: readColorOption(state.labelBackgroundColor, defaults.labelBackgroundColor),
        labelBackgroundAlpha: readNumberOption(state.labelBackgroundAlpha, defaults.labelBackgroundAlpha, 0, 1),
        labelPadding: readNumberOption(state.labelPadding, defaults.labelPadding, 0),
        labelStrokeWidth: readNumberOption(state.labelStrokeWidth, defaults.labelStrokeWidth, 0),
        endpointRadius: readNumberOption(state.endpointRadius, defaults.endpointRadius, 0),
        startCap: readEnumOption(state.startCap, END_CAPS, defaults.startCap),
        endCap: readEnumOption(state.endCap, END_CAPS, defaults.endCap),
        meterPixels: readNumberOption(state.meterPixels, defaults.meterPixels, 1),
        decimals: Math.round(readNumberOption(state.decimals, defaults.decimals, 0, 4)),
    };
}

export function createBinocularLineStatePatchFromOptions(
    options: Partial<BinocularLineToolOptions>,
): Partial<FoxholeBinocularLineState> {
    const defaults = DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE;
    return pickProvidedOptionFields(options, {
        scaleWithZoom: readBooleanOption(options.scaleWithZoom, defaults.scaleWithZoom),
        strokeColor: readColorOption(options.strokeColor, defaults.strokeColor),
        strokeWidth: readNumberOption(options.strokeWidth, defaults.strokeWidth, 1),
        strokeAlpha: readNumberOption(options.strokeAlpha, defaults.strokeAlpha, 0, 1),
        multiSegmentAlpha: readNumberOption(options.multiSegmentAlpha, defaults.multiSegmentAlpha, 0, 1),
        showDistance: readBooleanOption(options.showDistance, defaults.showDistance),
        showAzimuth: readBooleanOption(options.showAzimuth, defaults.showAzimuth),
        showAzimuthArrows: readBooleanOption(options.showAzimuthArrows, defaults.showAzimuthArrows),
        labelColor: readColorOption(options.labelColor, defaults.labelColor),
        labelFontSize: readNumberOption(options.labelFontSize, defaults.labelFontSize, 6),
        labelBackgroundColor: readColorOption(options.labelBackgroundColor, defaults.labelBackgroundColor),
        labelBackgroundAlpha: readNumberOption(options.labelBackgroundAlpha, defaults.labelBackgroundAlpha, 0, 1),
        labelPadding: readNumberOption(options.labelPadding, defaults.labelPadding, 0),
        labelStrokeWidth: readNumberOption(options.labelStrokeWidth, defaults.labelStrokeWidth, 0),
        endpointRadius: readNumberOption(options.endpointRadius, defaults.endpointRadius, 0),
        startCap: readEnumOption(options.startCap, END_CAPS, defaults.startCap),
        endCap: readEnumOption(options.endCap, END_CAPS, defaults.endCap),
        meterPixels: readNumberOption(options.meterPixels, defaults.meterPixels, 1),
        decimals: Math.round(readNumberOption(options.decimals, defaults.decimals, 0, 4)),
    });
}
