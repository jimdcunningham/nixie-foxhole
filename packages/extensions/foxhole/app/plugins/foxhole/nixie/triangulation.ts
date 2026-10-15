import type { BoardTransformState } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import { fitCircleFromPoints } from '#foxhole/plugins/foxhole/nixie/circle-from-points.ts';
import type { CircleFitResult } from '#foxhole/plugins/foxhole/nixie/circle-from-points.ts';

export const FOXHOLE_TRIANGULATION_NODE_TYPE = 'foxholeTriangulation';

export type FoxholeTriangulationStrokeStyle = 'solid' | 'dashed';

export interface FoxholeTriangulationState extends BoardTransformState {
    edgePoints: number[];
    scaleWithZoom: boolean;
    strokeColor: number;
    strokeWidth: number;
    strokeAlpha: number;
    strokeStyle: FoxholeTriangulationStrokeStyle;
    strokeDashLength: number;
    strokeDashGap: number;
    fillColor: number;
    fillAlpha: number;
    spokeAlpha: number;
    edgeLineAlpha: number;
    showSpokes: boolean;
    showRadius: boolean;
    showEdgeMarkers: boolean;
    labelColor: number;
    labelFontSize: number;
    labelBackgroundColor: number;
    labelBackgroundAlpha: number;
    labelPadding: number;
    labelStrokeWidth: number;
    centerMarkerRadius: number;
    edgeMarkerRadius: number;
    meterPixels: number;
    decimals: number;
}

export const DEFAULT_FOXHOLE_TRIANGULATION_STROKE_COLOR = 0xFE2AA6;
export const DEFAULT_FOXHOLE_TRIANGULATION_FILL_COLOR = 0xE5158E;
export const DEFAULT_FOXHOLE_TRIANGULATION_LABEL_BACKGROUND_COLOR = 0x8E0655;

export const DEFAULT_FOXHOLE_TRIANGULATION_STATE: FoxholeTriangulationState = {
    x: 0,
    y: 0,
    rotation: 0,
    visible: true,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    locked: false,
    edgePoints: [120, 0, -60, 104, -60, -104],
    scaleWithZoom: true,
    strokeColor: DEFAULT_FOXHOLE_TRIANGULATION_STROKE_COLOR,
    strokeWidth: 2,
    strokeAlpha: 1,
    strokeStyle: 'dashed',
    strokeDashLength: 12,
    strokeDashGap: 8,
    fillColor: DEFAULT_FOXHOLE_TRIANGULATION_FILL_COLOR,
    fillAlpha: 0.14,
    spokeAlpha: 0.65,
    edgeLineAlpha: 0.35,
    showSpokes: true,
    showRadius: true,
    showEdgeMarkers: true,
    labelColor: 0xFFFFFF,
    labelFontSize: 22,
    labelBackgroundColor: DEFAULT_FOXHOLE_TRIANGULATION_LABEL_BACKGROUND_COLOR,
    labelBackgroundAlpha: 0.85,
    labelPadding: 6,
    labelStrokeWidth: 2,
    centerMarkerRadius: 5,
    edgeMarkerRadius: 5,
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

function readStrokeStyle(value: unknown, fallback: FoxholeTriangulationStrokeStyle): FoxholeTriangulationStrokeStyle {
    return value === 'solid' || value === 'dashed' ? value : fallback;
}

export function countFoxholeTriangulationEdgePoints(state: Pick<FoxholeTriangulationState, 'edgePoints'>): number {
    return Math.floor((state.edgePoints?.length ?? 0) / 2);
}

export function getFoxholeTriangulationWorldEdgePoints(
    state: Pick<FoxholeTriangulationState, 'x' | 'y' | 'edgePoints'>,
): number[] {
    const worldPoints: number[] = [];
    for (let index = 0; index + 1 < state.edgePoints.length; index += 2) {
        worldPoints.push(
            state.x + state.edgePoints[index]!,
            state.y + state.edgePoints[index + 1]!,
        );
    }
    return worldPoints;
}

export function normalizeFoxholeTriangulationEdgePoints(points: readonly number[] | undefined): number[] {
    if (!Array.isArray(points) || points.length < 6) {
        return DEFAULT_FOXHOLE_TRIANGULATION_STATE.edgePoints.slice();
    }

    const evenLength = points.length - (points.length % 2);
    return points.slice(0, evenLength).map(value => readNumber(value, 0));
}

export function resolveFoxholeTriangulationFit(
    state: Pick<FoxholeTriangulationState, 'x' | 'y' | 'edgePoints'>,
): CircleFitResult | null {
    const edgeCount = countFoxholeTriangulationEdgePoints(state);
    const worldEdges = getFoxholeTriangulationWorldEdgePoints(state);
    if (edgeCount < 3) {
        return null;
    }

    const planar = [];
    for (let index = 0; index + 1 < worldEdges.length; index += 2) {
        planar.push({ x: worldEdges[index]!, y: worldEdges[index + 1]! });
    }
    return fitCircleFromPoints(planar);
}

export function getFoxholeTriangulationCircleCenterLocal(
    state: Pick<FoxholeTriangulationState, 'x' | 'y' | 'edgePoints'>,
): { x: number; y: number; } | null {
    const fit = resolveFoxholeTriangulationFit(state);
    if (!fit) {
        return null;
    }

    return {
        x: fit.centerX - state.x,
        y: fit.centerY - state.y,
    };
}

export function getFoxholeTriangulationFit(
    state: Pick<FoxholeTriangulationState, 'x' | 'y' | 'edgePoints'>,
): CircleFitResult | null {
    return resolveFoxholeTriangulationFit(state);
}

export function normalizeFoxholeTriangulationState(
    state: Partial<FoxholeTriangulationState>,
): FoxholeTriangulationState {
    const fallback = DEFAULT_FOXHOLE_TRIANGULATION_STATE;
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
        edgePoints: normalizeFoxholeTriangulationEdgePoints(state.edgePoints),
        scaleWithZoom: readBoolean(state.scaleWithZoom, fallback.scaleWithZoom),
        strokeColor: readColor(state.strokeColor, fallback.strokeColor),
        strokeWidth: readNumber(state.strokeWidth, fallback.strokeWidth, 1),
        strokeAlpha: readNumber(state.strokeAlpha, fallback.strokeAlpha, 0, 1),
        strokeStyle: readStrokeStyle(state.strokeStyle, fallback.strokeStyle),
        strokeDashLength: readNumber(state.strokeDashLength, fallback.strokeDashLength, 1),
        strokeDashGap: readNumber(state.strokeDashGap, fallback.strokeDashGap, 1),
        fillColor: readColor(state.fillColor, fallback.fillColor),
        fillAlpha: readNumber(state.fillAlpha, fallback.fillAlpha, 0, 1),
        spokeAlpha: readNumber(state.spokeAlpha, fallback.spokeAlpha, 0, 1),
        edgeLineAlpha: readNumber(state.edgeLineAlpha, fallback.edgeLineAlpha, 0, 1),
        showSpokes: readBoolean(state.showSpokes, fallback.showSpokes),
        showRadius: readBoolean(state.showRadius, fallback.showRadius),
        showEdgeMarkers: readBoolean(state.showEdgeMarkers, fallback.showEdgeMarkers),
        labelColor: readColor(state.labelColor, fallback.labelColor),
        labelFontSize: readNumber(state.labelFontSize, fallback.labelFontSize, 6),
        labelBackgroundColor: readColor(state.labelBackgroundColor, fallback.labelBackgroundColor),
        labelBackgroundAlpha: readNumber(state.labelBackgroundAlpha, fallback.labelBackgroundAlpha, 0, 1),
        labelPadding: readNumber(state.labelPadding, fallback.labelPadding, 0),
        labelStrokeWidth: readNumber(state.labelStrokeWidth, fallback.labelStrokeWidth, 0),
        centerMarkerRadius: readNumber(state.centerMarkerRadius, fallback.centerMarkerRadius, 1),
        edgeMarkerRadius: readNumber(state.edgeMarkerRadius, fallback.edgeMarkerRadius, 1),
        meterPixels: readNumber(state.meterPixels, fallback.meterPixels, 1),
        decimals: Math.round(readNumber(state.decimals, fallback.decimals, 0, 4)),
    };
}

export function resolveFoxholeTriangulationState(
    state: Partial<FoxholeTriangulationState>,
): FoxholeTriangulationState {
    return normalizeFoxholeTriangulationState(state);
}

export function createFoxholeTriangulationNodeId(prefix = 'foxhole-triangulation'): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getFoxholeTriangulationRadiusMeters(state: Partial<FoxholeTriangulationState>): number {
    const resolved = resolveFoxholeTriangulationState(state);
    const fit = getFoxholeTriangulationFit(resolved);
    if (!fit) {
        return 0;
    }

    const meterPixels = Math.max(1, resolved.meterPixels);
    const decimals = Math.max(0, Math.min(4, Math.round(resolved.decimals)));
    return Number((fit.radius / meterPixels).toFixed(decimals));
}
