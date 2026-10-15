import {
    getFoxholeTacticalLinePreset,

} from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import type { FoxholeTacticalLineCap, FoxholeTacticalLineCurveMode, FoxholeTacticalLineDecoratorMode, FoxholeTacticalLineDecoratorSide, FoxholeTacticalLinePresetId, FoxholeTacticalLineState, FoxholeTacticalLineStrokeStyle } from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import {
    pickProvidedOptionFields,
    readBooleanOption,
    readColorOption,
    readEnumOption,
    readNumberOption,
} from '#foxhole/plugins/foxhole/nixie/foxhole-tool-option-utils.ts';

export interface TacticalLineToolOptions {
    presetId: FoxholeTacticalLinePresetId;
    scaleWithZoom: boolean;
    curveMode: FoxholeTacticalLineCurveMode;
    strokeColor: number | string;
    strokeWidth: number;
    strokeAlpha: number;
    strokeStyle: FoxholeTacticalLineStrokeStyle;
    strokeDashLength: number;
    strokeDashGap: number;
    startCap: FoxholeTacticalLineCap;
    endCap: FoxholeTacticalLineCap;
    decoratorMode: FoxholeTacticalLineDecoratorMode;
    decoratorSide: FoxholeTacticalLineDecoratorSide;
    decoratorSize: number;
    decoratorSpacing: number;
    decoratorFill: boolean;
    decoratorColor: number | string;
    decoratorAlpha: number;
}

const CURVE_MODES = ['polyline', 'smooth'] as const;
const STROKE_STYLES = ['solid', 'dashed'] as const;
const CAP_STYLES = ['none', 'arrow', 'flag', 'circle'] as const;
const DECORATOR_MODES = ['none', 'semicircle', 'triangle', 'tick', 'block', 'cross', 'arrow'] as const;
const DECORATOR_SIDES = ['left', 'right', 'both'] as const;

export function createTacticalLineToolOptionsFromPreset(presetId: FoxholeTacticalLinePresetId): TacticalLineToolOptions {
    const preset = getFoxholeTacticalLinePreset(presetId);
    return {
        presetId: preset.id,
        scaleWithZoom: preset.scaleWithZoom,
        curveMode: preset.curveMode,
        strokeColor: preset.strokeColor,
        strokeWidth: preset.strokeWidth,
        strokeAlpha: preset.strokeAlpha,
        strokeStyle: preset.strokeStyle,
        strokeDashLength: preset.strokeDashLength,
        strokeDashGap: preset.strokeDashGap,
        startCap: preset.startCap,
        endCap: preset.endCap,
        decoratorMode: preset.decoratorMode,
        decoratorSide: preset.decoratorSide,
        decoratorSize: preset.decoratorSize,
        decoratorSpacing: preset.decoratorSpacing,
        decoratorFill: preset.decoratorFill,
        decoratorColor: preset.decoratorColor,
        decoratorAlpha: preset.decoratorAlpha,
    };
}

export function createTacticalLineToolOptionsFromState(
    state: Partial<FoxholeTacticalLineState>,
): TacticalLineToolOptions {
    const preset = getFoxholeTacticalLinePreset(state.presetId ?? 'frontline');
    return {
        presetId: state.presetId ?? preset.id,
        scaleWithZoom: readBooleanOption(state.scaleWithZoom, preset.scaleWithZoom),
        curveMode: readEnumOption(state.curveMode, CURVE_MODES, preset.curveMode),
        strokeColor: readColorOption(state.strokeColor, preset.strokeColor),
        strokeWidth: readNumberOption(state.strokeWidth, preset.strokeWidth, 1),
        strokeAlpha: readNumberOption(state.strokeAlpha, preset.strokeAlpha, 0, 1),
        strokeStyle: readEnumOption(state.strokeStyle, STROKE_STYLES, preset.strokeStyle),
        strokeDashLength: readNumberOption(state.strokeDashLength, preset.strokeDashLength, 2),
        strokeDashGap: readNumberOption(state.strokeDashGap, preset.strokeDashGap, 1),
        startCap: readEnumOption(state.startCap, CAP_STYLES, preset.startCap),
        endCap: readEnumOption(state.endCap, CAP_STYLES, preset.endCap),
        decoratorMode: readEnumOption(state.decoratorMode, DECORATOR_MODES, preset.decoratorMode),
        decoratorSide: readEnumOption(state.decoratorSide, DECORATOR_SIDES, preset.decoratorSide),
        decoratorSize: readNumberOption(state.decoratorSize, preset.decoratorSize, 1),
        decoratorSpacing: readNumberOption(state.decoratorSpacing, preset.decoratorSpacing, 4),
        decoratorFill: readBooleanOption(state.decoratorFill, preset.decoratorFill),
        decoratorColor: readColorOption(state.decoratorColor, preset.decoratorColor),
        decoratorAlpha: readNumberOption(state.decoratorAlpha, preset.decoratorAlpha, 0, 1),
    };
}

export function createTacticalLineStatePatchFromOptions(
    options: Partial<TacticalLineToolOptions>,
): Partial<FoxholeTacticalLineState> {
    const preset = getFoxholeTacticalLinePreset(options.presetId ?? 'frontline');
    return pickProvidedOptionFields(options, {
        presetId: readEnumOption(options.presetId, ['frontline', 'advance', 'fallback', 'fortified', 'cross'] as const, preset.id),
        scaleWithZoom: readBooleanOption(options.scaleWithZoom, preset.scaleWithZoom),
        curveMode: readEnumOption(options.curveMode, CURVE_MODES, preset.curveMode),
        strokeColor: readColorOption(options.strokeColor, preset.strokeColor),
        strokeWidth: readNumberOption(options.strokeWidth, preset.strokeWidth, 1),
        strokeAlpha: readNumberOption(options.strokeAlpha, preset.strokeAlpha, 0, 1),
        strokeStyle: readEnumOption(options.strokeStyle, STROKE_STYLES, preset.strokeStyle),
        strokeDashLength: readNumberOption(options.strokeDashLength, preset.strokeDashLength, 2),
        strokeDashGap: readNumberOption(options.strokeDashGap, preset.strokeDashGap, 1),
        startCap: readEnumOption(options.startCap, CAP_STYLES, preset.startCap),
        endCap: readEnumOption(options.endCap, CAP_STYLES, preset.endCap),
        decoratorMode: readEnumOption(options.decoratorMode, DECORATOR_MODES, preset.decoratorMode),
        decoratorSide: readEnumOption(options.decoratorSide, DECORATOR_SIDES, preset.decoratorSide),
        decoratorSize: readNumberOption(options.decoratorSize, preset.decoratorSize, 1),
        decoratorSpacing: readNumberOption(options.decoratorSpacing, preset.decoratorSpacing, 4),
        decoratorFill: readBooleanOption(options.decoratorFill, preset.decoratorFill),
        decoratorColor: readColorOption(options.decoratorColor, preset.decoratorColor),
        decoratorAlpha: readNumberOption(options.decoratorAlpha, preset.decoratorAlpha, 0, 1),
    });
}
