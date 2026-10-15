import {
    DEFAULT_FOXHOLE_RANGE_STATE,
    getFoxholeRangeRadiusMeters,

} from '#foxhole/plugins/foxhole/nixie/range.ts';
import type { FoxholeRangeState, FoxholeRangeStrokeStyle } from '#foxhole/plugins/foxhole/nixie/range.ts';
import {
    pickProvidedOptionFields,
    readBooleanOption,
    readColorOption,
    readEnumOption,
    readNumberOption,
} from '#foxhole/plugins/foxhole/nixie/foxhole-tool-option-utils.ts';

export interface RangeToolOptions {
    sweepAngle: number;
    scaleWithZoom: boolean;
    strokeColor: number | string;
    strokeWidth: number;
    strokeAlpha: number;
    strokeStyle: FoxholeRangeStrokeStyle;
    strokeDashLength: number;
    strokeDashGap: number;
    fillColor: number | string;
    fillAlpha: number;
    showCenterAxis: boolean;
    showRadius: boolean;
    showAngle: boolean;
    labelColor: number | string;
    labelFontSize: number;
    labelBackgroundColor: number | string;
    labelBackgroundAlpha: number;
    labelPadding: number;
    labelStrokeWidth: number;
    centerMarkerRadius: number;
    meterPixels: number;
    decimals: number;
    radiusMeters: number;
    dragThresholdPx?: number;
}

const STROKE_STYLES = ['solid', 'dashed'] as const;

export function createRangeToolOptionsFromDefaults(): RangeToolOptions {
    return {
        ...createRangeToolOptionsFromState(DEFAULT_FOXHOLE_RANGE_STATE),
        dragThresholdPx: 4,
    };
}

export function createRangeToolOptionsFromState(
    state: Partial<FoxholeRangeState>,
): RangeToolOptions {
    const defaults = DEFAULT_FOXHOLE_RANGE_STATE;
    return {
        sweepAngle: readNumberOption(state.sweepAngle, defaults.sweepAngle, 1, 360),
        scaleWithZoom: readBooleanOption(state.scaleWithZoom, defaults.scaleWithZoom),
        strokeColor: readColorOption(state.strokeColor, defaults.strokeColor),
        strokeWidth: readNumberOption(state.strokeWidth, defaults.strokeWidth, 1),
        strokeAlpha: readNumberOption(state.strokeAlpha, defaults.strokeAlpha, 0, 1),
        strokeStyle: readEnumOption(state.strokeStyle, STROKE_STYLES, defaults.strokeStyle),
        strokeDashLength: readNumberOption(state.strokeDashLength, defaults.strokeDashLength, 1),
        strokeDashGap: readNumberOption(state.strokeDashGap, defaults.strokeDashGap, 1),
        fillColor: readColorOption(state.fillColor, defaults.fillColor),
        fillAlpha: readNumberOption(state.fillAlpha, defaults.fillAlpha, 0, 1),
        showCenterAxis: readBooleanOption(state.showCenterAxis, defaults.showCenterAxis),
        showRadius: readBooleanOption(state.showRadius, defaults.showRadius),
        showAngle: readBooleanOption(state.showAngle, defaults.showAngle),
        labelColor: readColorOption(state.labelColor, defaults.labelColor),
        labelFontSize: readNumberOption(state.labelFontSize, defaults.labelFontSize, 6),
        labelBackgroundColor: readColorOption(state.labelBackgroundColor, defaults.labelBackgroundColor),
        labelBackgroundAlpha: readNumberOption(state.labelBackgroundAlpha, defaults.labelBackgroundAlpha, 0, 1),
        labelPadding: readNumberOption(state.labelPadding, defaults.labelPadding, 0),
        labelStrokeWidth: readNumberOption(state.labelStrokeWidth, defaults.labelStrokeWidth, 0),
        centerMarkerRadius: readNumberOption(state.centerMarkerRadius, defaults.centerMarkerRadius, 1),
        meterPixels: readNumberOption(state.meterPixels, defaults.meterPixels, 1),
        decimals: Math.round(readNumberOption(state.decimals, defaults.decimals, 0, 4)),
        radiusMeters: getFoxholeRangeRadiusMeters(state),
    };
}

export function createRangeStatePatchFromOptions(
    options: Partial<RangeToolOptions>,
): Partial<FoxholeRangeState> {
    const defaults = DEFAULT_FOXHOLE_RANGE_STATE;
    return pickProvidedOptionFields(options, {
        sweepAngle: readNumberOption(options.sweepAngle, defaults.sweepAngle, 1, 360),
        scaleWithZoom: readBooleanOption(options.scaleWithZoom, defaults.scaleWithZoom),
        strokeColor: readColorOption(options.strokeColor, defaults.strokeColor),
        strokeWidth: readNumberOption(options.strokeWidth, defaults.strokeWidth, 1),
        strokeAlpha: readNumberOption(options.strokeAlpha, defaults.strokeAlpha, 0, 1),
        strokeStyle: readEnumOption(options.strokeStyle, STROKE_STYLES, defaults.strokeStyle),
        strokeDashLength: readNumberOption(options.strokeDashLength, defaults.strokeDashLength, 1),
        strokeDashGap: readNumberOption(options.strokeDashGap, defaults.strokeDashGap, 1),
        fillColor: readColorOption(options.fillColor, defaults.fillColor),
        fillAlpha: readNumberOption(options.fillAlpha, defaults.fillAlpha, 0, 1),
        showCenterAxis: readBooleanOption(options.showCenterAxis, defaults.showCenterAxis),
        showRadius: readBooleanOption(options.showRadius, defaults.showRadius),
        showAngle: readBooleanOption(options.showAngle, defaults.showAngle),
        labelColor: readColorOption(options.labelColor, defaults.labelColor),
        labelFontSize: readNumberOption(options.labelFontSize, defaults.labelFontSize, 6),
        labelBackgroundColor: readColorOption(options.labelBackgroundColor, defaults.labelBackgroundColor),
        labelBackgroundAlpha: readNumberOption(options.labelBackgroundAlpha, defaults.labelBackgroundAlpha, 0, 1),
        labelPadding: readNumberOption(options.labelPadding, defaults.labelPadding, 0),
        labelStrokeWidth: readNumberOption(options.labelStrokeWidth, defaults.labelStrokeWidth, 0),
        centerMarkerRadius: readNumberOption(options.centerMarkerRadius, defaults.centerMarkerRadius, 1),
        meterPixels: readNumberOption(options.meterPixels, defaults.meterPixels, 1),
        decimals: Math.round(readNumberOption(options.decimals, defaults.decimals, 0, 4)),
    });
}
