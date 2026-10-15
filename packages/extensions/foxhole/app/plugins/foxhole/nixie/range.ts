import type { BoardTransformState } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';

export const FOXHOLE_RANGE_NODE_TYPE = 'foxholeRange';

export type FoxholeRangeStrokeStyle = 'solid' | 'dashed';

export interface FoxholeRangeState extends BoardTransformState {
    points: number[];
    sweepAngle: number;
    scaleWithZoom: boolean;
    strokeColor: number;
    strokeWidth: number;
    strokeAlpha: number;
    strokeStyle: FoxholeRangeStrokeStyle;
    strokeDashLength: number;
    strokeDashGap: number;
    fillColor: number;
    fillAlpha: number;
    showCenterAxis: boolean;
    showRadius: boolean;
    showAngle: boolean;
    labelColor: number;
    labelFontSize: number;
    labelBackgroundColor: number;
    labelBackgroundAlpha: number;
    labelPadding: number;
    labelStrokeWidth: number;
    centerMarkerRadius: number;
    meterPixels: number;
    decimals: number;
}

export interface FoxholeRangeMetrics {
    centerX: number;
    centerY: number;
    endX: number;
    endY: number;
    radius: number;
    baseAngle: number;
}

export const DEFAULT_FOXHOLE_RANGE_STROKE_COLOR = 0xC084FC;

export const DEFAULT_FOXHOLE_RANGE_STATE: FoxholeRangeState = {
    x: 0,
    y: 0,
    rotation: 0,
    visible: true,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    locked: false,
    points: [0, 0, 160, 0],
    sweepAngle: 360,
    scaleWithZoom: true,
    strokeColor: DEFAULT_FOXHOLE_RANGE_STROKE_COLOR,
    strokeWidth: 2,
    strokeAlpha: 1,
    strokeStyle: 'dashed',
    strokeDashLength: 12,
    strokeDashGap: 8,
    fillColor: 0x7E22CE,
    fillAlpha: 0.16,
    showCenterAxis: false,
    showRadius: true,
    showAngle: true,
    labelColor: 0xFFFFFF,
    labelFontSize: 22,
    labelBackgroundColor: 0x6B21A8,
    labelBackgroundAlpha: 0.85,
    labelPadding: 6,
    labelStrokeWidth: 2,
    centerMarkerRadius: 5,
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

function readStrokeStyle(value: unknown, fallback: FoxholeRangeStrokeStyle): FoxholeRangeStrokeStyle {
    return value === 'solid' || value === 'dashed' ? value : fallback;
}

export function normalizeFoxholeRangePoints(points: readonly number[] | undefined): number[] {
    const fallback = DEFAULT_FOXHOLE_RANGE_STATE.points;
    if (!Array.isArray(points) || points.length < 4) {
        return fallback.slice();
    }

    return points.slice(0, 4).map(value => readNumber(value, 0));
}

export function normalizeFoxholeRangePointsToLocalOrigin(points: readonly number[]): {
    x: number;
    y: number;
    points: number[];
} {
    const normalized = normalizeFoxholeRangePoints(points);
    const anchorX = normalized[0]!;
    const anchorY = normalized[1]!;

    return {
        x: anchorX,
        y: anchorY,
        points: [
            0,
            0,
            normalized[2]! - anchorX,
            normalized[3]! - anchorY,
        ],
    };
}

export function getFoxholeRangeMetrics(state: Pick<FoxholeRangeState, 'points'>): FoxholeRangeMetrics {
    const points = normalizeFoxholeRangePoints(state.points);
    const centerX = points[0]!;
    const centerY = points[1]!;
    const endX = points[2]!;
    const endY = points[3]!;
    const deltaX = endX - centerX;
    const deltaY = endY - centerY;

    return {
        centerX,
        centerY,
        endX,
        endY,
        radius: Math.max(1, Math.hypot(deltaX, deltaY)),
        baseAngle: Math.atan2(deltaY, deltaX),
    };
}

export function createFoxholeRangePointsFromWorldEndpoints(
    start: { x: number; y: number; },
    end: { x: number; y: number; },
): number[] {
    return normalizeFoxholeRangePointsToLocalOrigin([
        start.x,
        start.y,
        end.x,
        end.y,
    ]).points;
}

export function patchFoxholeRangeRadius(
    state: Pick<FoxholeRangeState, 'points'>,
    nextRadius: number,
): number[] {
    const points = normalizeFoxholeRangePoints(state.points);
    const metrics = getFoxholeRangeMetrics({ points });
    const radius = Math.max(1, nextRadius);
    return [
        points[0]!,
        points[1]!,
        points[0]! + (Math.cos(metrics.baseAngle) * radius),
        points[1]! + (Math.sin(metrics.baseAngle) * radius),
    ];
}

export function getFoxholeRangeRadiusMeters(state: Partial<FoxholeRangeState>): number {
    const resolved = resolveFoxholeRangeState(state);
    const meterPixels = Math.max(1, resolved.meterPixels);
    const radiusPixels = getFoxholeRangeMetrics(resolved).radius;
    const decimals = Math.max(0, Math.min(4, Math.round(resolved.decimals)));
    return Number((radiusPixels / meterPixels).toFixed(decimals));
}

export function buildFoxholeRangeRadiusPatch(
    state: Partial<FoxholeRangeState>,
    nextMeters: number,
): Pick<FoxholeRangeState, 'x' | 'y' | 'points'> {
    const resolved = resolveFoxholeRangeState(state);
    const meterPixels = Math.max(1, resolved.meterPixels);
    const nextRadiusPixels = Math.max(1, nextMeters * meterPixels);
    const nextPoints = patchFoxholeRangeRadius(resolved, nextRadiusPixels);
    const normalized = normalizeFoxholeRangeState({
        ...resolved,
        points: nextPoints,
    });

    return {
        x: normalized.x,
        y: normalized.y,
        points: normalized.points,
    };
}

export function isFullRangeSweep(sweepAngle: number): boolean {
    return sweepAngle >= 359.9;
}

export function getRangeArcRadians(sweepAngleDegrees: number): { start: number; end: number; } {
    const halfSweep = (readNumber(sweepAngleDegrees, 360, 1, 360) * Math.PI) / 360;
    return {
        start: -halfSweep,
        end: halfSweep,
    };
}

function buildFoxholeRangeState(
    state: Partial<FoxholeRangeState>,
    x: number,
    y: number,
    points: number[],
): FoxholeRangeState {
    const fallback = DEFAULT_FOXHOLE_RANGE_STATE;

    return {
        ...fallback,
        ...state,
        x,
        y,
        rotation: readNumber(state.rotation, fallback.rotation),
        visible: readBoolean(state.visible, fallback.visible),
        alpha: readNumber(state.alpha, fallback.alpha, 0, 1),
        scaleX: readNumber(state.scaleX, fallback.scaleX),
        scaleY: readNumber(state.scaleY, fallback.scaleY),
        locked: readBoolean(state.locked, fallback.locked ?? false),
        points: normalizeFoxholeRangePoints(points),
        sweepAngle: readNumber(state.sweepAngle, fallback.sweepAngle, 1, 360),
        scaleWithZoom: readBoolean(state.scaleWithZoom, fallback.scaleWithZoom),
        strokeColor: readColor(state.strokeColor, fallback.strokeColor),
        strokeWidth: readNumber(state.strokeWidth, fallback.strokeWidth, 1),
        strokeAlpha: readNumber(state.strokeAlpha, fallback.strokeAlpha, 0, 1),
        strokeStyle: readStrokeStyle(state.strokeStyle, fallback.strokeStyle),
        strokeDashLength: readNumber(state.strokeDashLength, fallback.strokeDashLength, 1),
        strokeDashGap: readNumber(state.strokeDashGap, fallback.strokeDashGap, 1),
        fillColor: readColor(state.fillColor, fallback.fillColor),
        fillAlpha: readNumber(state.fillAlpha, fallback.fillAlpha, 0, 1),
        showCenterAxis: readBoolean(state.showCenterAxis, fallback.showCenterAxis),
        showRadius: readBoolean(state.showRadius, fallback.showRadius),
        showAngle: readBoolean(state.showAngle, fallback.showAngle),
        labelColor: readColor(state.labelColor, fallback.labelColor),
        labelFontSize: readNumber(state.labelFontSize, fallback.labelFontSize, 6),
        labelBackgroundColor: readColor(state.labelBackgroundColor, fallback.labelBackgroundColor),
        labelBackgroundAlpha: readNumber(state.labelBackgroundAlpha, fallback.labelBackgroundAlpha, 0, 1),
        labelPadding: readNumber(state.labelPadding, fallback.labelPadding, 0),
        labelStrokeWidth: readNumber(state.labelStrokeWidth, fallback.labelStrokeWidth, 0),
        centerMarkerRadius: readNumber(state.centerMarkerRadius, fallback.centerMarkerRadius, 1),
        meterPixels: readNumber(state.meterPixels, fallback.meterPixels, 1),
        decimals: Math.round(readNumber(state.decimals, fallback.decimals, 0, 4)),
    };
}

export function resolveFoxholeRangeState(state: Partial<FoxholeRangeState>): FoxholeRangeState {
    const fallback = DEFAULT_FOXHOLE_RANGE_STATE;
    const points = normalizeFoxholeRangePoints(state.points);

    return buildFoxholeRangeState(
        state,
        readNumber(state.x, fallback.x),
        readNumber(state.y, fallback.y),
        points,
    );
}

export function normalizeFoxholeRangeState(state: Partial<FoxholeRangeState>): FoxholeRangeState {
    const fallback = DEFAULT_FOXHOLE_RANGE_STATE;
    const points = normalizeFoxholeRangePoints(state.points);
    const anchored = normalizeFoxholeRangePointsToLocalOrigin([
        readNumber(state.x, fallback.x) + points[0]!,
        readNumber(state.y, fallback.y) + points[1]!,
        readNumber(state.x, fallback.x) + points[2]!,
        readNumber(state.y, fallback.y) + points[3]!,
    ]);

    return buildFoxholeRangeState(state, anchored.x, anchored.y, anchored.points);
}

export function createFoxholeRangeNodeId(prefix = 'foxhole-range'): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
