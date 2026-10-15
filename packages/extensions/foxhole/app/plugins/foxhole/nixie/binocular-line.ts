import type { BoardTransformState } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import { normalizeFlatPoints, normalizeFlatPointsToLocalOrigin } from '#nixie/plugins/nixie/board/utils/polyline-points.ts';

export const FOXHOLE_BINOCULAR_LINE_NODE_TYPE = 'foxholeBinocularLine';

export type FoxholeBinocularLineEndCap = 'none' | 'arrow' | 'circle';

export interface FoxholeBinocularLineState extends BoardTransformState {
    points: number[];
    scaleWithZoom: boolean;
    strokeColor: number;
    strokeWidth: number;
    strokeAlpha: number;
    multiSegmentAlpha: number;
    showDistance: boolean;
    showAzimuth: boolean;
    showAzimuthArrows: boolean;
    labelColor: number;
    labelFontSize: number;
    labelBackgroundColor: number;
    labelBackgroundAlpha: number;
    labelPadding: number;
    labelStrokeWidth: number;
    endpointRadius: number;
    startCap: FoxholeBinocularLineEndCap;
    endCap: FoxholeBinocularLineEndCap;
    meterPixels: number;
    decimals: number;
}

export const LEGACY_BINOCULAR_LINE_COLOR = 0x77E5C3;

export const DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE: FoxholeBinocularLineState = {
    x: 0,
    y: 0,
    rotation: 0,
    visible: true,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    locked: false,
    points: [0, 0, 160, 0],
    scaleWithZoom: true,
    strokeColor: LEGACY_BINOCULAR_LINE_COLOR,
    strokeWidth: 2,
    strokeAlpha: 1,
    multiSegmentAlpha: 0.5,
    showDistance: true,
    showAzimuth: true,
    showAzimuthArrows: true,
    labelColor: 0xFFFFFF,
    labelFontSize: 22,
    labelBackgroundColor: 0x529E87, // getDarkColor(#77E5C3)
    labelBackgroundAlpha: 0.85,
    labelPadding: 6,
    labelStrokeWidth: 2,
    endpointRadius: 0,
    // Legacy binoline (lineMode multi): circle on non-arrow ends, arrow on back.
    startCap: 'circle',
    endCap: 'arrow',
    meterPixels: 32,
    decimals: 1,
};

function readNumber(value: unknown, fallback: number, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY): number {
    const parsed = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function readColor(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(0xFFFFFF, Math.round(value)));
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value.trim().replace(/^#/, ''), 16);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.min(0xFFFFFF, parsed));
        }
    }
    return fallback;
}

function readEndCap(value: unknown, fallback: FoxholeBinocularLineEndCap): FoxholeBinocularLineEndCap {
    return value === 'none' || value === 'arrow' || value === 'circle' ? value : fallback;
}

export function normalizeFoxholeBinocularLinePoints(points: readonly number[]): number[] {
    return normalizeFlatPoints(points, DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE.points, 4);
}

export function normalizeFoxholeBinocularLinePointsToLocalOrigin(points: readonly number[]): {
    x: number;
    y: number;
    points: number[];
} {
    return normalizeFlatPointsToLocalOrigin(points, DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE.points, 4);
}

export function normalizeFoxholeBinocularLineState(
    state: Partial<FoxholeBinocularLineState>,
): FoxholeBinocularLineState {
    const fallback = DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE;
    return {
        ...fallback,
        ...state,
        x: readNumber(state.x, fallback.x),
        y: readNumber(state.y, fallback.y),
        rotation: readNumber(state.rotation, fallback.rotation),
        visible: readBoolean(state.visible, fallback.visible),
        alpha: readNumber(state.alpha, fallback.alpha, 0, 1),
        scaleX: readNumber(state.scaleX, fallback.scaleX),
        scaleY: readNumber(state.scaleY, fallback.scaleY),
        locked: readBoolean(state.locked, fallback.locked ?? false),
        points: normalizeFoxholeBinocularLinePoints(state.points ?? fallback.points),
        scaleWithZoom: readBoolean(state.scaleWithZoom, fallback.scaleWithZoom),
        strokeColor: readColor(state.strokeColor, fallback.strokeColor),
        strokeWidth: readNumber(state.strokeWidth, fallback.strokeWidth, 1),
        strokeAlpha: readNumber(state.strokeAlpha, fallback.strokeAlpha, 0, 1),
        multiSegmentAlpha: readNumber(state.multiSegmentAlpha, fallback.multiSegmentAlpha, 0, 1),
        showDistance: readBoolean(state.showDistance, fallback.showDistance),
        showAzimuth: readBoolean(state.showAzimuth, fallback.showAzimuth),
        showAzimuthArrows: readBoolean(state.showAzimuthArrows, fallback.showAzimuthArrows),
        labelColor: readColor(state.labelColor, fallback.labelColor),
        labelFontSize: readNumber(state.labelFontSize, fallback.labelFontSize, 6),
        labelBackgroundColor: readColor(state.labelBackgroundColor, fallback.labelBackgroundColor),
        labelBackgroundAlpha: readNumber(state.labelBackgroundAlpha, fallback.labelBackgroundAlpha, 0, 1),
        labelPadding: readNumber(state.labelPadding, fallback.labelPadding, 0),
        labelStrokeWidth: readNumber(state.labelStrokeWidth, fallback.labelStrokeWidth, 0),
        endpointRadius: readNumber(state.endpointRadius, fallback.endpointRadius, 0),
        startCap: readEndCap(state.startCap, fallback.startCap),
        endCap: readEndCap(state.endCap, fallback.endCap),
        meterPixels: readNumber(state.meterPixels, fallback.meterPixels, 1),
        decimals: Math.round(readNumber(state.decimals, fallback.decimals, 0, 4)),
    };
}

export function createFoxholeBinocularLineNodeId(prefix = 'foxhole-binocular-line'): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
