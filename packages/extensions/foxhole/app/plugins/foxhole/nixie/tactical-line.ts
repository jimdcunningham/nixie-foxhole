import type { BoardTransformState } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';

export const FOXHOLE_TACTICAL_LINE_NODE_TYPE = 'foxholeTacticalLine';

export type FoxholeTacticalLineCurveMode = 'polyline' | 'smooth';
export type FoxholeTacticalLineStrokeStyle = 'solid' | 'dashed';
export type FoxholeTacticalLineCap = 'none' | 'arrow' | 'flag' | 'circle';
export type FoxholeTacticalLineDecoratorMode = 'none' | 'semicircle' | 'triangle' | 'tick' | 'block' | 'cross' | 'arrow';
export type FoxholeTacticalLineDecoratorSide = 'left' | 'right' | 'both';
export type FoxholeTacticalLinePresetId = 'frontline' | 'advance' | 'fallback' | 'fortified' | 'cross';

export interface FoxholeTacticalLineState extends BoardTransformState {
    points: number[];
    scaleWithZoom: boolean;
    curveMode: FoxholeTacticalLineCurveMode;
    strokeColor: number;
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
    decoratorColor: number;
    decoratorAlpha: number;
    presetId: FoxholeTacticalLinePresetId;
}

export interface FoxholeTacticalLinePresetDefinition extends Pick<
    FoxholeTacticalLineState,
    | 'scaleWithZoom'
    | 'curveMode'
    | 'strokeColor'
    | 'strokeWidth'
    | 'strokeAlpha'
    | 'strokeStyle'
    | 'strokeDashLength'
    | 'strokeDashGap'
    | 'startCap'
    | 'endCap'
    | 'decoratorMode'
    | 'decoratorSide'
    | 'decoratorSize'
    | 'decoratorSpacing'
    | 'decoratorFill'
    | 'decoratorColor'
    | 'decoratorAlpha'
    | 'presetId'
> {
    id: FoxholeTacticalLinePresetId;
    label: string;
    description: string;
}

export const FOXHOLE_TACTICAL_LINE_PRESETS: readonly FoxholeTacticalLinePresetDefinition[] = [
    {
        id: 'frontline',
        label: 'Frontline',
        description: 'Primary contact line with filled defensive scallops.',
        presetId: 'frontline',
        scaleWithZoom: true,
        curveMode: 'smooth',
        strokeColor: 0xD75648,
        strokeWidth: 6,
        strokeAlpha: 1,
        strokeStyle: 'solid',
        strokeDashLength: 20,
        strokeDashGap: 12,
        startCap: 'none',
        endCap: 'none',
        decoratorMode: 'semicircle',
        decoratorSide: 'both',
        decoratorSize: 20,
        decoratorSpacing: 42,
        decoratorFill: true,
        decoratorColor: 0xEEC7B8,
        decoratorAlpha: 1,
    },
    {
        id: 'advance',
        label: 'Advance',
        description: 'Offensive push route with repeated breakthrough markers.',
        presetId: 'advance',
        scaleWithZoom: true,
        curveMode: 'smooth',
        strokeColor: 0x5BCB77,
        strokeWidth: 8,
        strokeAlpha: 1,
        strokeStyle: 'solid',
        strokeDashLength: 20,
        strokeDashGap: 12,
        startCap: 'none',
        endCap: 'arrow',
        decoratorMode: 'triangle',
        decoratorSide: 'left',
        decoratorSize: 14,
        decoratorSpacing: 26,
        decoratorFill: true,
        decoratorColor: 0xDDF7D5,
        decoratorAlpha: 1,
    },
    {
        id: 'fallback',
        label: 'Fallback',
        description: 'Withdrawal route with controlled dash spacing.',
        presetId: 'fallback',
        scaleWithZoom: true,
        curveMode: 'polyline',
        strokeColor: 0xE0C372,
        strokeWidth: 6,
        strokeAlpha: 1,
        strokeStyle: 'dashed',
        strokeDashLength: 22,
        strokeDashGap: 14,
        startCap: 'arrow',
        endCap: 'none',
        decoratorMode: 'none',
        decoratorSide: 'left',
        decoratorSize: 14,
        decoratorSpacing: 24,
        decoratorFill: false,
        decoratorColor: 0xFFF4CC,
        decoratorAlpha: 1,
    },
    {
        id: 'fortified',
        label: 'Fortified',
        description: 'Held defensive line with block markers and command flags.',
        presetId: 'fortified',
        scaleWithZoom: true,
        curveMode: 'polyline',
        strokeColor: 0x7A8FB5,
        strokeWidth: 8,
        strokeAlpha: 1,
        strokeStyle: 'solid',
        strokeDashLength: 20,
        strokeDashGap: 12,
        startCap: 'flag',
        endCap: 'flag',
        decoratorMode: 'block',
        decoratorSide: 'both',
        decoratorSize: 14,
        decoratorSpacing: 24,
        decoratorFill: true,
        decoratorColor: 0xE3ECF8,
        decoratorAlpha: 1,
    },
    {
        id: 'cross',
        label: 'Cross',
        description: 'Denial line with repeated crossed warning arrowheads.',
        presetId: 'cross',
        scaleWithZoom: true,
        curveMode: 'polyline',
        strokeColor: 0xF08A2B,
        strokeWidth: 10,
        strokeAlpha: 1,
        strokeStyle: 'solid',
        strokeDashLength: 20,
        strokeDashGap: 12,
        startCap: 'none',
        endCap: 'none',
        decoratorMode: 'cross',
        decoratorSide: 'both',
        decoratorSize: 16,
        decoratorSpacing: 28,
        decoratorFill: false,
        decoratorColor: 0xFFF1DB,
        decoratorAlpha: 1,
    },
] as const;

const presetMap = new Map(FOXHOLE_TACTICAL_LINE_PRESETS.map(preset => [preset.id, preset] as const));

export const DEFAULT_FOXHOLE_TACTICAL_LINE_STATE: FoxholeTacticalLineState = {
    x: 0,
    y: 0,
    rotation: 0,
    visible: true,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    locked: false,
    points: [0, 0, 120, 0],
    scaleWithZoom: true,
    ...getFoxholeTacticalLinePreset('frontline'),
};

export function getFoxholeTacticalLinePreset(
    presetId: FoxholeTacticalLinePresetId | string | null | undefined,
): FoxholeTacticalLinePresetDefinition {
    return presetMap.get((presetId ?? 'frontline') as FoxholeTacticalLinePresetId) ?? FOXHOLE_TACTICAL_LINE_PRESETS[0]!;
}

export function applyFoxholeTacticalLinePreset(
    state: Partial<FoxholeTacticalLineState>,
    presetId: FoxholeTacticalLinePresetId | string | null | undefined,
): FoxholeTacticalLineState {
    const preset = getFoxholeTacticalLinePreset(presetId);
    return {
        ...DEFAULT_FOXHOLE_TACTICAL_LINE_STATE,
        ...preset,
        ...state,
        presetId: preset.id,
        points: normalizeTacticalLinePoints(state.points ?? DEFAULT_FOXHOLE_TACTICAL_LINE_STATE.points),
    };
}

export function normalizeTacticalLinePoints(points: readonly number[]): number[] {
    const normalized = points.filter(value => typeof value === 'number' && Number.isFinite(value));
    if (normalized.length < 4) {
        return DEFAULT_FOXHOLE_TACTICAL_LINE_STATE.points.slice();
    }

    const evenLength = normalized.length - (normalized.length % 2);
    return normalized.slice(0, evenLength);
}

export function normalizeTacticalLinePointsToLocalOrigin(points: readonly number[]): {
    x: number;
    y: number;
    points: number[];
} {
    const normalized = normalizeTacticalLinePoints(points);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;

    for (let index = 0; index < normalized.length; index += 2) {
        minX = Math.min(minX, normalized[index]!);
        minY = Math.min(minY, normalized[index + 1]!);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        return {
            x: 0,
            y: 0,
            points: DEFAULT_FOXHOLE_TACTICAL_LINE_STATE.points.slice(),
        };
    }

    const localPoints: number[] = [];
    for (let index = 0; index < normalized.length; index += 2) {
        localPoints.push(
            normalized[index]! - minX,
            normalized[index + 1]! - minY,
        );
    }

    return {
        x: minX,
        y: minY,
        points: localPoints,
    };
}

export function createFoxholeTacticalLineNodeId(prefix = 'foxhole-tactical-line'): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
