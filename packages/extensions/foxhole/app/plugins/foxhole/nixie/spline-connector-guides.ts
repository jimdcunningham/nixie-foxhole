import type { Graphics } from 'pixi.js';
import { getFoxholeSplineConnectorConstraints, centimetersToFoxholeBoardPixels, FOXHOLE_SPLINE_CONNECTOR_ROTATION_SNAP_STEP_RAD,
    isUndergroundPipe, usesFacilityPipeGuidePath } from './spline-connector.ts';
import type { FoxholeSplineConnectorState, FoxholeSplineConnectorEndpoint } from './spline-connector.ts';
import { resolveConnectorPathConstraints, sampleConnectorPath, sampleHybridPipePath } from './pipe-connector-path.ts';
import { resolvePipeSplineConstraints, resolvePipeConstraintOptions, usesPipeCurveScale } from './pipe-spline-constraints.ts';
import { resolveEndGizmoStemRotation } from './spline-connector-handles.ts';

export function resolveFoxholeSplinePathConstraints(state: FoxholeSplineConnectorState, pathStyle?: string, fallbackBufferCm = 0) {
    const constraintState = state.maxBuffer > 0 ? state : { ...state, maxBuffer: Math.max(0, centimetersToFoxholeBoardPixels(fallbackBufferCm)) };
    return resolvePipeSplineConstraints(resolveConnectorPathConstraints(getFoxholeSplineConnectorConstraints(constraintState, pathStyle), pathStyle),
        resolvePipeConstraintOptions(constraintState, pathStyle, FOXHOLE_SPLINE_CONNECTOR_ROTATION_SNAP_STEP_RAD),
        { usePipeCurveScale: usesPipeCurveScale(pathStyle, state.foxholeKey) });
}

export function resolveFoxholeSplineGuidePath(state: FoxholeSplineConnectorState,
    constraints: ReturnType<typeof resolveFoxholeSplinePathConstraints>, pathStyle?: string) {
    return usesFacilityPipeGuidePath(state.foxholeKey)
        ? sampleHybridPipePath(state.start, state.end, isUndergroundPipe(state.foxholeKey)
            ? { ...constraints, maxBuffer: centimetersToFoxholeBoardPixels(300) }
            : constraints, { foxholeKey: state.foxholeKey })
        : sampleConnectorPath(state.start, state.end, constraints, pathStyle, { foxholeKey: state.foxholeKey });
}

export function drawFoxholeSplinePathGuide(graphics: Graphics, points: readonly { x: number; y: number; }[], alpha: number, color: number): void {
    graphics.clear();
    if (points.length < 2) {
        return;
    }
    graphics.moveTo(points[0]!.x, points[0]!.y);
    for (let index = 1; index < points.length; index += 1) {
        graphics.lineTo(points[index]!.x, points[index]!.y);
    }
    graphics.stroke({ color, width: 2, alpha: alpha * 0.9, cap: 'round', join: 'round' });
}

export function drawFoxholeSplineEndpointGizmo(graphics: Graphics, endpoint: FoxholeSplineConnectorEndpoint,
    role: 'start' | 'end', foxholeKey: string, rotationHandles: boolean, alpha: number, color: number): void {
    graphics.circle(endpoint.x, endpoint.y, 7).fill({ color, alpha });
    if (!rotationHandles) {
        return;
    }
    const rotation = resolveEndGizmoStemRotation(endpoint.rotation, role, foxholeKey);
    graphics.circle(endpoint.x + Math.cos(rotation) * 36, endpoint.y + Math.sin(rotation) * 36, 6).fill({ color, alpha });
}
