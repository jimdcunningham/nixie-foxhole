import { buildArcLengthTable } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { SplinePathConstraints, SplinePathEndpoint } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { resolveConnectorBehavior } from './connector-behavior.ts';
import { isBarbedWireFence, sampleBarbedWireFencePath } from './barbed-wire-fence.ts';
import { blendConnectorPathSamples, sampleExtensionPipePath } from './pipe-extension-path.ts';
import { sampleConnectorSplinePath } from './spline-ribbon-mesh.ts';
import type { ConnectorSplinePathSample } from './spline-ribbon-mesh.ts';
import type { FoxholeSceneV2AssetMetadata, FoxholeSceneV2VisualMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';

export function foxholeSceneV2ConnectorConstraints(data: FoxholeSceneV2SplineConnectorData, asset?: FoxholeSceneV2AssetMetadata): SplinePathConstraints {
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    const adjustable = behavior.pipeCurveScale && (asset?.connector?.pathStyle === 'spline' || behavior.undergroundPipe);
    const maxBuffer = adjustable && data.maxBuffer > 0 ? data.maxBuffer : undefined;
    const straight = ['straight-telescoping', 'endpoints-only'].includes(asset?.connector?.pathStyle ?? '');
    return { minLength: data.minLength, maxLength: data.maxLength, minRadius: straight ? undefined : data.minRadius,
        maxRadius: !straight && data.maxRadius > data.minRadius ? data.maxRadius : undefined, maxBuffer,
        defaultHandleLength: adjustable ? Math.max(maxBuffer ?? 0, data.minLength * 0.5, data.minRadius)
            : Math.hypot(data.endX - data.startX, data.endY - data.startY) * 0.4,
        curveT: adjustable ? data.curveT : 1,
        maxTargetAngleDeg: data.maxTargetAngleDeg,
        maxArcAngleDeg: data.maxArcAngleDeg };
}

export function foxholeSceneV2ConnectorEndpoints(data: FoxholeSceneV2SplineConnectorData): { start: SplinePathEndpoint; end: SplinePathEndpoint; } {
    return { start: { x: data.startX, y: data.startY, rotation: data.startRotation, handleLength: data.startHandleLength },
        end: { x: data.endX, y: data.endY, rotation: data.endRotation, handleLength: data.endHandleLength } };
}

export function sampleFoxholeSceneV2Connector(data: FoxholeSceneV2SplineConnectorData, asset?: FoxholeSceneV2AssetMetadata): ConnectorSplinePathSample {
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    const style = behavior.undergroundPipe ? 'spline' : asset?.connector?.pathStyle;
    const { start, end } = foxholeSceneV2ConnectorEndpoints(data);
    if (isBarbedWireFence(data.foxholeKey)) {
        return sampleBarbedWireFencePath(start, end, foxholeSceneV2ConnectorConstraints(data, asset));
    }
    if (style === 'straight-telescoping' || style === 'endpoints-only' || behavior.mineSpline || data.foxholeKey.toLowerCase().includes('cranerail')) {
        const points = [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];
        const lengths = buildArcLengthTable(points);
        return { points, lengths, totalLength: lengths.at(-1) ?? 0 };
    }
    const constraints = foxholeSceneV2ConnectorConstraints(data, asset);
    if (style === 'spline' && behavior.pipeExtension) {
        const routingEnd = behavior.undergroundPipe ? { ...end, rotation: end.rotation + Math.PI } : end;
        const rigid = sampleExtensionPipePath(start, routingEnd, constraints);
        if (constraints.curveT === 0) return rigid;
        const bezierEnd = data.foxholeKey.toLowerCase().includes('pipe') && !behavior.undergroundPipe
            ? { ...routingEnd, rotation: routingEnd.rotation + Math.PI } : routingEnd;
        const curved = sampleConnectorSplinePath(start, bezierEnd, { ...constraints, curveT: 1 });
        return constraints.curveT === 1 ? curved : blendConnectorPathSamples(rigid, curved, constraints.curveT ?? 0);
    }
    return sampleConnectorSplinePath(start, end, constraints);
}

/** Published dimensions already contain the board scale; the shared V1 geometry expects source pixels. */
export function foxholeSceneV2GeometryLayer(visual: FoxholeSceneV2VisualMetadata) {
    return { width: visual.width * 2, height: visual.height * 2, anchorX: visual.anchorX, anchorY: visual.anchorY,
        offsetY: visual.offsetY * 2, ...(visual.nativeSurface ? { nativeSurface: visual.nativeSurface } : {}) };
}
