import type { NixieExtensionGraphicsCommandV1, NixieExtensionRenderNodeV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import { resolveConnectorBehavior } from './connector-behavior.ts';
import { FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE, foxholeRenderLane } from './render-lanes.ts';

export function allowsFoxholeConnectorGuideRotation(data: FoxholeSceneV2SplineConnectorData, asset?: FoxholeSceneV2AssetMetadata): boolean {
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    const style = behavior.undergroundPipe ? 'spline' : asset?.connector?.pathStyle;
    if (behavior.mineSpline || behavior.powerline || data.foxholeKey.toLowerCase().includes('cranerail')) {
        return false;
    }
    if (style === 'interval') {
        return Number(data.maxArcAngleDeg ?? 0) > 0;
    }
    return style !== 'straight-telescoping' && style !== 'endpoints-only';
}

export function sampleFoxholeConnectorGuide(data: FoxholeSceneV2SplineConnectorData, asset?: FoxholeSceneV2AssetMetadata) {
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    const fallback = Number(asset?.connector?.maxBufferCm ?? asset?.connector?.minLengthCm ?? 0) * 0.32;
    return sampleFoxholeSceneV2Connector({ ...data, maxBuffer: behavior.undergroundPipe ? 96 : data.maxBuffer > 0 ? data.maxBuffer : fallback }, asset);
}

export function renderFoxholeConnectorGuides(data: FoxholeSceneV2SplineConnectorData, asset?: FoxholeSceneV2AssetMetadata): NixieExtensionRenderNodeV1[] {
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    const path = sampleFoxholeConnectorGuide(data, asset);
    const stem: NixieExtensionGraphicsCommandV1[] = behavior.powerline || path.points.length < 2
        ? []
        : [
            { op: 'move-to', x: path.points[0]!.x, y: path.points[0]!.y },
            ...path.points.slice(1).map(point => ({ op: 'line-to' as const, x: point.x, y: point.y })),
            { op: 'stroke', color: 0x8BE9FF, width: 2, alpha: 0.9, cap: 'round', join: 'round' },
        ];
    const handles: NixieExtensionGraphicsCommandV1[] = [];
    const rotations = allowsFoxholeConnectorGuideRotation(data, asset);
    for (const role of ['start', 'end'] as const) {
        const x = role === 'start' ? data.startX : data.endX;
        const y = role === 'start' ? data.startY : data.endY;
        const rotation = role === 'start'
            ? data.startRotation
            : data.endRotation
                + (data.foxholeKey.toLowerCase().includes('pipe') && !behavior.undergroundPipe ? 0 : Math.PI);
        handles.push({ op: 'circle', x, y, radius: 7 }, { op: 'fill', color: 0xD8F7FF, alpha: 1 });
        if (rotations) {
            handles.push({ op: 'circle', x: x + Math.cos(rotation) * 36, y: y + Math.sin(rotation) * 36, radius: 6 },
                { op: 'fill', color: 0xD8F7FF, alpha: 1 });
        }
    }
    return [{ id: 'spline-connector-guides', kind: 'group', ...foxholeRenderLane(FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE),
        experimentalPresentation: { contractVersion: 1, selectionOnly: true, excludeFromBounds: true }, children: [{
            id: 'spline-guide-path', kind: 'graphics', experimentalPresentation: { contractVersion: 1, toolAccent: 'stem' }, commands: stem,
        }, { id: 'spline-guide-handles', kind: 'graphics', experimentalPresentation: { contractVersion: 1, toolAccent: 'handle' }, commands: handles }] }];
}
