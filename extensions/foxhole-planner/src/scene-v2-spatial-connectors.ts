import { renderSpatialTrench } from './scene-v2-spatial-trench.ts';
import { createFoxholeSpatialProjection } from './scene-v2-spatial-transforms.ts';
import { renderFoxholeSpatialRepeats } from './scene-v2-spatial-repeats.ts';
import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalSpatialEndpointBindingsV1,
    NixieExperimentalSpatialPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { isFoxholePowerlineOverLength, resolveFoxholePowerlineStroke } from './powerline-stroke.ts';

/** Spatial geometry is derived from the same state and attachment-resolved path as the 2D view. */
export function renderFoxholeSpatialConnector(entity: NixieExperimentalComponentEntitySnapshotV1,
    data: FoxholeSceneV2SplineConnectorData & { startZ?: number; endZ?: number;
        endpointBindings?: NixieExperimentalSpatialEndpointBindingsV1; }, asset?: FoxholeSceneV2AssetMetadata, settings: Readonly<Record<string,unknown>> = {},
    entities: readonly NixieExperimentalComponentEntitySnapshotV1[] = [entity]): NixieExperimentalSpatialPlanV1 | undefined {
    if (/^trenchconnectort[123]$/.test(data.foxholeKey) && asset) return renderSpatialTrench(entity,data,asset,settings);
    if (data.foxholeKey === 'powerline') {
        const count = 32, startZ = data.startZ ?? 0, endZ = data.endZ ?? 0;
        const projection = createFoxholeSpatialProjection(entities);
        const start = projection.toWorld(entity, [data.startX, data.startY, startZ]);
        const end = projection.toWorld(entity, [data.endX, data.endY, endZ]);
        const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
        const invalid = data.powerlineObstructed === true || isFoxholePowerlineOverLength(
            { x: data.startX, y: data.startY },
            { x: data.endX, y: data.endY },
            data.maxLength,
        );
        // Sag follows world gravity and height, independently of the cable's rebased local origin.
        // Only the render plan changes; authored endpoints and attachment records remain exact.
        const sag = Math.max(0, Math.min(distance * 0.04, Math.min(start[2], end[2]) * 0.4));
        const phase = [...entity.entityId].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 6283, 0) / 1000;
        const points = Array.from({ length: count + 1 }, (_, i) => {
            if (i === 0) return [data.startX, data.startY, startZ];
            if (i === count) return [data.endX, data.endY, endZ];
            const t = i / count;
            return projection.toLocal(entity, [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t,
                start[2] + (end[2] - start[2]) * t - 4 * sag * t * (1 - t)]);
        }).flat();
        if (distance < 1e-8) return undefined;
        return { contractVersion: 1, nodes: [{ id: 'power-cable', kind: 'tube', points, radius: 0.8,
            color: invalid ? resolveFoxholePowerlineStroke(1, true).color : 0x191919, radialSegments: 12,
            motion: { kind: 'spring-sway', amplitude: Math.max(2, Math.min(12, distance * 0.025)), frequency: 0.42, phase },
            ...(data.endpointBindings && Object.keys(data.endpointBindings).length ? { endpointBindings: data.endpointBindings } : {}) }] };
    }
    if (data.foxholeKey === 'facilitypipeunderground' && asset?.model) {
        const model = asset.model;
        const origin = model.blueprintOrigin;
        const coincident = Math.hypot(data.endX - data.startX, data.endY - data.startY,
            (data.endZ ?? 0) - (data.startZ ?? 0)) < 1e-8;
        return { contractVersion: 1, nodes: (coincident ? ['start'] as const : ['start', 'end'] as const).map(endpoint => {
            const x = data[`${endpoint}X`], y = data[`${endpoint}Y`], z = data[`${endpoint}Z`] ?? 0;
            // The Blueprint reuses PipeIntersection at both ends, with FrontMesh yawed 180 degrees.
            // Horizontal local frames keep each terminal upright even when their elevations differ.
            const rotation = data[`${endpoint}Rotation`] + (endpoint === 'end' ? Math.PI : 0);
            const binding = data.endpointBindings?.[endpoint];
            return { id: `underground-pipe-${endpoint}`, kind: 'model-path' as const,
                resourceId: model.resourceId, unitsPerMetre: 32, meshIndex: 0,
                points: [x, y, z, x + Math.cos(rotation), y + Math.sin(rotation), z],
                sourceOrigin: [origin?.x ?? 0, origin?.y ?? 0, origin?.z ?? 0] as [number,number,number],
                instances: [{ distance: 0 }], ...(binding ? { endpointBindings: { start: binding } } : {}) };
        }) };
    }
    if (!['facilitypipe', 'facilitypipeoverhead'].includes(data.foxholeKey)) return renderFoxholeSpatialRepeats(data, asset);
    if (!asset?.model) return undefined;
    const path = sampleFoxholeSceneV2Connector(data, asset);
    if (path.totalLength < 1e-8) return undefined;
    const points = path.points.flatMap((point, i) => [point.x, point.y,
        (data.startZ ?? 0) + ((data.endZ ?? 0) - (data.startZ ?? 0)) * path.lengths[i]! / path.totalLength]);
    const selections = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner' && component.componentId === 'modification'
        && component.definitionAvailable)?.data.selections;
    const insulated = Array.isArray(selections) && selections.some(row => row && typeof row === 'object' && !Array.isArray(row) && row.variantId === 'insulation');
    if (data.foxholeKey === 'facilitypipeoverhead') {
        const profile = insulated ? asset.model.insulatedPathProfile : asset.model.pathProfile;
        if (!profile?.parts.span || !profile.parts.start || !profile.parts.end || !profile.endOrigin) return undefined;
        const config = asset.connector?.meshConfigs[0];
        return { contractVersion: 1, nodes: [{ id: 'overhead-pipeline', kind: 'model-path', points,
            resourceId: insulated ? 'foxhole.model.facilitypipeoverhead.upgrade.insulation' : asset.model.resourceId,
            unitsPerMetre: 32, meshIndex: profile.parts.span.meshIndex,
            startMeshIndex: profile.parts.start.meshIndex, endMeshIndex: profile.parts.end.meshIndex,
            startInset: config?.startOffset ?? 70.4, endInset: config?.endOffset ?? 70.4,
            startOrigin: [0,0,0], endOrigin: profile.endOrigin,
            ...(data.endpointBindings && Object.keys(data.endpointBindings).length ? { endpointBindings: data.endpointBindings } : {}) }] };
    }
    return { contractVersion: 1, nodes: [{ id: 'pipeline', kind: 'model-path', points,
        resourceId: insulated ? 'foxhole.model.facilitypipe.upgrade.insulation' : asset.model.resourceId,
        unitsPerMetre: 32, meshIndex: 0, startMeshIndex: 1, endMeshIndex: 2,
        ...(data.endpointBindings && Object.keys(data.endpointBindings).length ? { endpointBindings: data.endpointBindings } : {}) }] };
}
