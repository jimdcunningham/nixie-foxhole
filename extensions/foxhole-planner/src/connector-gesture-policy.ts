import type { NixieExperimentalGeometryWheelControlV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { usesPipeCurveScale, DEFAULT_PIPE_CURVE_T_WHEEL_STEP } from './pipe-spline-constraints.ts';
import { resolveConnectorBehavior, resolveConnectorVisualPathStyle } from './connector-behavior.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';

/** Domain presentation of standard SDK endpoint/tangent handles. */
export function foxholeConnectorGeometryHandles(data: FoxholeSceneV2SplineConnectorData, asset?: FoxholeSceneV2AssetMetadata) {
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    const style = resolveConnectorVisualPathStyle(asset?.connector?.pathStyle, data.foxholeKey);
    const handles = [{ id: 'start', local: { x: data.startX, y: data.startY } }, { id: 'end', local: { x: data.endX, y: data.endY } }];
    const intervalTangents = /^sandbag(?:half|full)spline$/i.test(data.foxholeKey) || Number(data.maxArcAngleDeg ?? asset?.connector?.maxArcAngleDeg ?? 0) > 0;
    if (behavior.mineSpline || behavior.powerline || data.foxholeKey.includes('cranerail')
        || style === 'straight-telescoping' || style === 'endpoints-only' || (style === 'interval' && !intervalTangents)) return handles;
    for (const role of ['start', 'end'] as const) {
        const angle = data[role + 'Rotation' as 'startRotation' | 'endRotation'] + (role === 'end' && !(data.foxholeKey.includes('pipe') && !behavior.undergroundPipe) ? Math.PI : 0);
        handles.push({ id: role + '-rotation', local: { x: data[role + 'X' as 'startX' | 'endX'] + Math.cos(angle) * 36,
            y: data[role + 'Y' as 'startY' | 'endY'] + Math.sin(angle) * 36 } });
    }
    return handles;
}

/** The host applies input and writes; Planner declares which curves support this field. */
export function foxholeConnectorGeometryWheel(data: FoxholeSceneV2SplineConnectorData, asset?: FoxholeSceneV2AssetMetadata): NixieExperimentalGeometryWheelControlV1 | undefined {
    const style = resolveConnectorVisualPathStyle(asset?.connector?.pathStyle, data.foxholeKey);
    return usesPipeCurveScale(style, data.foxholeKey, asset?.connector)
        ? { componentId: 'spline-connector', propertyId: 'curveT', step: DEFAULT_PIPE_CURVE_T_WHEEL_STEP, minimum: 0, maximum: 1 }
        : undefined;
}
