import type {
    NixieExperimentalComponentEntitySnapshotV1,
    NixieExperimentalEntityRendererContextV1,
} from '@nixie/extension-sdk/experimental/scene-v2';
import {
    resolveFoxholeSceneV2WorldMatrices,
    transformFoxholeSceneV2Point,
} from './scene-v2-attachments.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { foxholeFootprintPolygons, foxholeLineTouchesPolygon } from './scene-v2-footprints.ts';

const DEFAULT_POWERLINE_CLEARANCE = 3.2;

function componentData(entity: NixieExperimentalComponentEntitySnapshotV1, ownerId: string, componentId: string) {
    return entity.components.find(component => component.ownerId === ownerId && component.componentId === componentId
        && component.definitionAvailable)?.data;
}

/** Find authored building footprints touched by the power line outside its two attached hosts. */
export function findFoxholePowerlineObstructions(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    data: FoxholeSceneV2SplineConnectorData,
    context: NixieExperimentalEntityRendererContextV1,
    metadata: Record<string, FoxholeSceneV2AssetMetadata>,
): string[] {
    if (data.foxholeKey !== 'powerline') {
        return [];
    }
    const matrices = resolveFoxholeSceneV2WorldMatrices(context);
    const connectorMatrix = matrices.get(entity.entityId);
    if (!connectorMatrix) {
        return [];
    }
    const start = transformFoxholeSceneV2Point(connectorMatrix, data.startX, data.startY);
    const end = transformFoxholeSceneV2Point(connectorMatrix, data.endX, data.endY);
    const connectorScale = Math.max(Math.hypot(connectorMatrix.a, connectorMatrix.b), Math.hypot(connectorMatrix.c, connectorMatrix.d));
    const clearance = (Number.isFinite(data.maxBuffer) && data.maxBuffer >= 0 ? data.maxBuffer : DEFAULT_POWERLINE_CLEARANCE) * connectorScale;
    const attachedHosts = new Set([data.startAttachmentNodeId, data.endAttachmentNodeId].filter((id): id is string => Boolean(id)));
    return context.entities.flatMap(candidate => {
        if (candidate.entityId === entity.entityId || attachedHosts.has(candidate.entityId)
            || componentData(candidate, 'nixie.foxhole-planner', 'spline-connector')
            || componentData(candidate, 'nixie.foxhole-planner', 'connector')) {
            return [];
        }
        const assetId = componentData(candidate, 'nixie.foxhole-planner', 'asset')?.assetId;
        const asset = typeof assetId === 'string' ? metadata[assetId] : undefined;
        const world = matrices.get(candidate.entityId);
        if (!asset || asset.isVehicle || asset.isItem || !world) {
            return [];
        }
        const obstructed = foxholeFootprintPolygons(asset, world)
            .some(polygon => foxholeLineTouchesPolygon(start, end, polygon, clearance));
        return obstructed ? [candidate.entityId] : [];
    });
}
