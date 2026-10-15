import type { SplinePathConstraints, SplinePathEndpoint } from '@nixie/extension-sdk/experimental/scene-v2';
import { resolveConnectorBehavior } from './connector-behavior.ts';
import type { FoxholeConnectorBehaviorSource } from './connector-behavior.ts';

export const FOXHOLE_PIPE_ROTATION_SNAP_STEP_RAD = Math.PI / 4;
export const DEFAULT_PIPE_CURVE_T = 0;
export const DEFAULT_PIPE_CURVE_T_WHEEL_STEP = 0.05;

export interface FoxholePipeSplineConstraintOptions {
    curveT?: number;
    maxTargetAngleDeg?: number;
    maxArcAngleDeg?: number;
    rotationSnapStepRad?: number;
}

function normalizeRotationRadians(value: number): number {
    let angle = value;
    while (angle > Math.PI) {
        angle -= Math.PI * 2;
    }
    while (angle < -Math.PI) {
        angle += Math.PI * 2;
    }
    return angle;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function normalizePipeCurveT(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_PIPE_CURVE_T;
    }
    return clamp(Number(value), 0, 1);
}

export function adjustPipeCurveT(current: number | undefined, wheelDeltaY: number, step = DEFAULT_PIPE_CURVE_T_WHEEL_STEP): number {
    const direction = wheelDeltaY < 0 ? 1 : -1;
    return normalizePipeCurveT(normalizePipeCurveT(current) + (direction * step));
}

export function resolvePipeRotationSnapStepRad(
    foxholeKey: string,
    pathStyle?: string,
    fallbackStepRad = Math.PI / 12,
): number {
    if (pathStyle === 'spline' && resolveConnectorBehavior(foxholeKey).pipeCurveScale) {
        return FOXHOLE_PIPE_ROTATION_SNAP_STEP_RAD;
    }

    return fallbackStepRad;
}

export function snapPipeRotationRadians(rotation: number, stepRad: number): number {
    if (!Number.isFinite(stepRad) || stepRad <= 0) {
        return normalizeRotationRadians(rotation);
    }

    return normalizeRotationRadians(
        Math.round(rotation / stepRad) * stepRad,
    );
}

export function resolveChordRotation(start: SplinePathEndpoint, end: SplinePathEndpoint): number {
    return Math.atan2(end.y - start.y, end.x - start.x);
}

function resolveMaxTargetAngleRadians(maxTargetAngleDeg?: number): number | undefined {
    if (maxTargetAngleDeg == null || !Number.isFinite(maxTargetAngleDeg)) {
        return undefined;
    }

    const value = Number(maxTargetAngleDeg);
    if (value <= 0) {
        return undefined;
    }

    // Underground pipes publish `1`, which behaves like a 1° deviation cap in-game.
    const degrees = value <= 2 ? value : value;
    return (degrees * Math.PI) / 180;
}

export function clampPipeEndpointRotation(
    endpoint: 'start' | 'end',
    rotation: number,
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    options: FoxholePipeSplineConstraintOptions = {},
): number {
    const snapped = snapPipeRotationRadians(
        rotation,
        options.rotationSnapStepRad ?? FOXHOLE_PIPE_ROTATION_SNAP_STEP_RAD,
    );
    const maxTargetAngle = resolveMaxTargetAngleRadians(options.maxTargetAngleDeg);
    if (maxTargetAngle == null) {
        return snapped;
    }

    const chordRotation = resolveChordRotation(start, end);
    const referenceRotation = endpoint === 'end'
        ? normalizeRotationRadians(chordRotation + Math.PI)
        : chordRotation;
    let delta = normalizeRotationRadians(snapped - referenceRotation);
    delta = clamp(delta, -maxTargetAngle, maxTargetAngle);
    return normalizeRotationRadians(referenceRotation + delta);
}

export function applyPipeEndpointRotationConstraints(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    options: FoxholePipeSplineConstraintOptions = {},
): { start: SplinePathEndpoint; end: SplinePathEndpoint; } {
    const nextStart = {
        ...start,
        rotation: clampPipeEndpointRotation('start', start.rotation, start, end, options),
    };
    const nextEnd = {
        ...end,
        rotation: clampPipeEndpointRotation('end', end.rotation, nextStart, end, options),
    };

    return {
        start: nextStart,
        end: nextEnd,
    };
}

export interface ResolvePipeSplineConstraintsOptions {
    usePipeCurveScale?: boolean;
}

export function resolvePipeSplineConstraints(
    constraints: SplinePathConstraints,
    options: FoxholePipeSplineConstraintOptions = {},
    settings: ResolvePipeSplineConstraintsOptions = {},
): SplinePathConstraints {
    const usePipeCurveScale = settings.usePipeCurveScale === true;
    return {
        ...constraints,
        curveT: usePipeCurveScale
            ? normalizePipeCurveT(options.curveT ?? constraints.curveT)
            : (constraints.curveT ?? 1),
        maxTargetAngleDeg: options.maxTargetAngleDeg ?? constraints.maxTargetAngleDeg,
        maxArcAngleDeg: options.maxArcAngleDeg ?? constraints.maxArcAngleDeg,
    };
}

export function usesPipeCurveScale(
    pathStyle?: string,
    foxholeKey?: string,
    connector?: FoxholeConnectorBehaviorSource | null,
): boolean {
    return pathStyle === 'spline' && resolveConnectorBehavior(foxholeKey, connector).pipeCurveScale;
}

export function resolvePipeConstraintOptions(
    state: {
        foxholeKey: string;
        curveT?: number;
        maxTargetAngleDeg?: number;
        maxArcAngleDeg?: number;
    },
    pathStyle?: string,
    fallbackStepRad = Math.PI / 12,
): FoxholePipeSplineConstraintOptions {
    return {
        curveT: normalizePipeCurveT(state.curveT),
        maxTargetAngleDeg: state.maxTargetAngleDeg,
        rotationSnapStepRad: resolvePipeRotationSnapStepRad(state.foxholeKey, pathStyle, fallbackStepRad),
    };
}
