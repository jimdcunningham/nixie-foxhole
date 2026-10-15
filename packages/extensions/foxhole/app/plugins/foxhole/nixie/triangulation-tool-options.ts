import {
    DEFAULT_FOXHOLE_TRIANGULATION_STATE,

} from '#foxhole/plugins/foxhole/nixie/triangulation.ts';
import type { FoxholeTriangulationState, FoxholeTriangulationStrokeStyle } from '#foxhole/plugins/foxhole/nixie/triangulation.ts';
import {
    readBooleanOption,
    readColorOption,
    readEnumOption,
    readNumberOption,
} from '#foxhole/plugins/foxhole/nixie/foxhole-tool-option-utils.ts';

export interface TriangulationToolOptions {
    scaleWithZoom: boolean;
    strokeColor: number | string;
    strokeWidth: number;
    strokeAlpha: number;
    strokeStyle: FoxholeTriangulationStrokeStyle;
    strokeDashLength: number;
    strokeDashGap: number;
    fillColor: number | string;
    fillAlpha: number;
    spokeAlpha: number;
    edgeLineAlpha: number;
    showSpokes: boolean;
    showRadius: boolean;
    showEdgeMarkers: boolean;
    labelColor: number | string;
    labelFontSize: number;
    labelBackgroundColor: number | string;
    labelBackgroundAlpha: number;
    labelPadding: number;
    labelStrokeWidth: number;
    centerMarkerRadius: number;
    edgeMarkerRadius: number;
    meterPixels: number;
    decimals: number;
}

const STROKE_STYLES = ['solid', 'dashed'] as const;

export function createTriangulationToolOptionsFromDefaults(): TriangulationToolOptions {
    return createTriangulationToolOptionsFromState(DEFAULT_FOXHOLE_TRIANGULATION_STATE);
}

export function createTriangulationToolOptionsFromState(
    state: Partial<FoxholeTriangulationState>,
): TriangulationToolOptions {
    const defaults = DEFAULT_FOXHOLE_TRIANGULATION_STATE;
    return {
        scaleWithZoom: readBooleanOption(state.scaleWithZoom, defaults.scaleWithZoom),
        strokeColor: readColorOption(state.strokeColor, defaults.strokeColor),
        strokeWidth: readNumberOption(state.strokeWidth, defaults.strokeWidth, 1),
        strokeAlpha: readNumberOption(state.strokeAlpha, defaults.strokeAlpha, 0, 1),
        strokeStyle: readEnumOption(state.strokeStyle, STROKE_STYLES, defaults.strokeStyle),
        strokeDashLength: readNumberOption(state.strokeDashLength, defaults.strokeDashLength, 1),
        strokeDashGap: readNumberOption(state.strokeDashGap, defaults.strokeDashGap, 1),
        fillColor: readColorOption(state.fillColor, defaults.fillColor),
        fillAlpha: readNumberOption(state.fillAlpha, defaults.fillAlpha, 0, 1),
        spokeAlpha: readNumberOption(state.spokeAlpha, defaults.spokeAlpha, 0, 1),
        edgeLineAlpha: readNumberOption(state.edgeLineAlpha, defaults.edgeLineAlpha, 0, 1),
        showSpokes: readBooleanOption(state.showSpokes, defaults.showSpokes),
        showRadius: readBooleanOption(state.showRadius, defaults.showRadius),
        showEdgeMarkers: readBooleanOption(state.showEdgeMarkers, defaults.showEdgeMarkers),
        labelColor: readColorOption(state.labelColor, defaults.labelColor),
        labelFontSize: readNumberOption(state.labelFontSize, defaults.labelFontSize, 6),
        labelBackgroundColor: readColorOption(state.labelBackgroundColor, defaults.labelBackgroundColor),
        labelBackgroundAlpha: readNumberOption(state.labelBackgroundAlpha, defaults.labelBackgroundAlpha, 0, 1),
        labelPadding: readNumberOption(state.labelPadding, defaults.labelPadding, 0),
        labelStrokeWidth: readNumberOption(state.labelStrokeWidth, defaults.labelStrokeWidth, 0),
        centerMarkerRadius: readNumberOption(state.centerMarkerRadius, defaults.centerMarkerRadius, 1),
        edgeMarkerRadius: readNumberOption(state.edgeMarkerRadius, defaults.edgeMarkerRadius, 1),
        meterPixels: readNumberOption(state.meterPixels, defaults.meterPixels, 1),
        decimals: Math.round(readNumberOption(state.decimals, defaults.decimals, 0, 4)),
    };
}

export function createTriangulationStatePatchFromOptions(
    options: Partial<TriangulationToolOptions>,
): Partial<FoxholeTriangulationState> {
    const defaults = DEFAULT_FOXHOLE_TRIANGULATION_STATE;
    const patch: Partial<FoxholeTriangulationState> = {};

    if (Object.prototype.hasOwnProperty.call(options, 'scaleWithZoom')) {
        patch.scaleWithZoom = readBooleanOption(options.scaleWithZoom, defaults.scaleWithZoom);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'strokeColor')) {
        patch.strokeColor = readColorOption(options.strokeColor, defaults.strokeColor);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'strokeWidth')) {
        patch.strokeWidth = readNumberOption(options.strokeWidth, defaults.strokeWidth, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'strokeAlpha')) {
        patch.strokeAlpha = readNumberOption(options.strokeAlpha, defaults.strokeAlpha, 0, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'strokeStyle')) {
        patch.strokeStyle = readEnumOption(options.strokeStyle, STROKE_STYLES, defaults.strokeStyle);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'strokeDashLength')) {
        patch.strokeDashLength = readNumberOption(options.strokeDashLength, defaults.strokeDashLength, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'strokeDashGap')) {
        patch.strokeDashGap = readNumberOption(options.strokeDashGap, defaults.strokeDashGap, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'fillColor')) {
        patch.fillColor = readColorOption(options.fillColor, defaults.fillColor);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'fillAlpha')) {
        patch.fillAlpha = readNumberOption(options.fillAlpha, defaults.fillAlpha, 0, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'spokeAlpha')) {
        patch.spokeAlpha = readNumberOption(options.spokeAlpha, defaults.spokeAlpha, 0, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'edgeLineAlpha')) {
        patch.edgeLineAlpha = readNumberOption(options.edgeLineAlpha, defaults.edgeLineAlpha, 0, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'showSpokes')) {
        patch.showSpokes = readBooleanOption(options.showSpokes, defaults.showSpokes);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'showRadius')) {
        patch.showRadius = readBooleanOption(options.showRadius, defaults.showRadius);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'showEdgeMarkers')) {
        patch.showEdgeMarkers = readBooleanOption(options.showEdgeMarkers, defaults.showEdgeMarkers);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'labelColor')) {
        patch.labelColor = readColorOption(options.labelColor, defaults.labelColor);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'labelFontSize')) {
        patch.labelFontSize = readNumberOption(options.labelFontSize, defaults.labelFontSize, 6);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'labelBackgroundColor')) {
        patch.labelBackgroundColor = readColorOption(options.labelBackgroundColor, defaults.labelBackgroundColor);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'labelBackgroundAlpha')) {
        patch.labelBackgroundAlpha = readNumberOption(options.labelBackgroundAlpha, defaults.labelBackgroundAlpha, 0, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'labelPadding')) {
        patch.labelPadding = readNumberOption(options.labelPadding, defaults.labelPadding, 0);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'labelStrokeWidth')) {
        patch.labelStrokeWidth = readNumberOption(options.labelStrokeWidth, defaults.labelStrokeWidth, 0);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'centerMarkerRadius')) {
        patch.centerMarkerRadius = readNumberOption(options.centerMarkerRadius, defaults.centerMarkerRadius, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'edgeMarkerRadius')) {
        patch.edgeMarkerRadius = readNumberOption(options.edgeMarkerRadius, defaults.edgeMarkerRadius, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'meterPixels')) {
        patch.meterPixels = readNumberOption(options.meterPixels, defaults.meterPixels, 1);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'decimals')) {
        patch.decimals = Math.round(readNumberOption(options.decimals, defaults.decimals, 0, 4));
    }

    return patch;
}
