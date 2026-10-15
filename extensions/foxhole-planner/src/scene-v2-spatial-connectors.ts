import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalSpatialEndpointBindingsV1,
    NixieExperimentalSpatialPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { isFoxholePowerlineOverLength, resolveFoxholePowerlineStroke } from './powerline-stroke.ts';

/** Spatial geometry is derived from the same state and attachment-resolved path as the 2D view. */
export function renderFoxholeSpatialConnector(entity: NixieExperimentalComponentEntitySnapshotV1,
    data: FoxholeSceneV2SplineConnectorData & { startZ?: number; endZ?: number;
        endpointBindings?: NixieExperimentalSpatialEndpointBindingsV1; }, asset?: FoxholeSceneV2AssetMetadata): NixieExperimentalSpatialPlanV1 | undefined {
    if (data.foxholeKey === 'powerline') {
        const count = 32, startZ = data.startZ ?? 0, endZ = data.endZ ?? 0;
        const distance = Math.hypot(data.endX - data.startX, data.endY - data.startY);
        const invalid = data.powerlineObstructed === true || isFoxholePowerlineOverLength(
            { x: data.startX, y: data.startY },
            { x: data.endX, y: data.endY },
            data.maxLength,
        );
        // Gravity-shaped sag is visual only; endpoints remain exact. No physics state is persisted.
        const sag = Math.max(0, Math.min(distance * 0.04, Math.min(startZ, endZ) * 0.4));
        const phase = [...entity.entityId].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 6283, 0) / 1000;
        const points = Array.from({ length: count + 1 }, (_, i) => { const t = i / count; return [
            data.startX + (data.endX - data.startX) * t, data.startY + (data.endY - data.startY) * t,
            startZ + (endZ - startZ) * t - 4 * sag * t * (1 - t),
        ]; }).flat();
        if (distance < 1e-8) return undefined;
        return { contractVersion: 1, nodes: [{ id: 'power-cable', kind: 'tube', points, radius: 0.8,
            color: invalid ? resolveFoxholePowerlineStroke(1, true).color : 0x191919, radialSegments: 12,
            motion: { kind: 'spring-sway', amplitude: Math.max(2, Math.min(12, distance * 0.025)), frequency: 0.42, phase },
            ...(data.endpointBindings && Object.keys(data.endpointBindings).length ? { endpointBindings: data.endpointBindings } : {}) }] };
    }
    if (data.foxholeKey !== 'facilitypipe' || !asset?.model) return undefined;
    const path = sampleFoxholeSceneV2Connector(data, asset);
    if (path.totalLength < 1e-8) return undefined;
    const points = path.points.flatMap((point, i) => [point.x, point.y,
        (data.startZ ?? 0) + ((data.endZ ?? 0) - (data.startZ ?? 0)) * path.lengths[i]! / path.totalLength]);
    const selections = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner' && component.componentId === 'modification'
        && component.definitionAvailable)?.data.selections;
    const insulated = Array.isArray(selections) && selections.some(row => row && typeof row === 'object' && !Array.isArray(row) && row.variantId === 'insulation');
    return { contractVersion: 1, nodes: [{ id: 'pipeline', kind: 'model-path', points,
        resourceId: insulated ? 'foxhole.model.facilitypipe.upgrade.insulation' : asset.model.resourceId,
        unitsPerMetre: 32, meshIndex: 0, startMeshIndex: 1, endMeshIndex: 2,
        ...(data.endpointBindings && Object.keys(data.endpointBindings).length ? { endpointBindings: data.endpointBindings } : {}) }] };
}
