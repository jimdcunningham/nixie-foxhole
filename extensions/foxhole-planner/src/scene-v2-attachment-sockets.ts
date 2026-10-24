import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata, FoxholeSceneV2BuildSocketMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { normalizeFoxholeBuildSocketName } from './bunker-statistics-sockets.ts';
import { resolveFoxholeEntityStructureSockets } from './effective-structure-sockets.ts';
import { resolveFoxholeConnectorDisplaySockets } from './scene-v2-connector-socket-overlays.ts';

/** Attached connectors target the same deformed sockets as their visible endpoint/side markers. */
export function resolveFoxholeEntityAttachmentSockets(entity: NixieExperimentalComponentEntitySnapshotV1,
    asset: FoxholeSceneV2AssetMetadata | null | undefined): FoxholeSceneV2BuildSocketMetadata[] {
    const templates = resolveFoxholeEntityStructureSockets(entity, asset);
    const spline = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'spline-connector' && component.definitionAvailable);
    const connector = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'connector' && component.definitionAvailable);
    if (!spline && connector && Array.isArray(connector.data.points)) {
        const points = connector.data.points;
        if (points.length < 4 || !points.every(value => typeof value === 'number' && Number.isFinite(value))) return [];
        return (['start', 'end'] as const).flatMap(role => {
            const name = connector.data[`${role}SocketName`]
                ?? (role === 'start' ? asset?.connector?.backSocketName : asset?.connector?.frontSocketName);
            const template = templates.find(socket => normalizeFoxholeBuildSocketName(socket.name) === normalizeFoxholeBuildSocketName(name));
            if (!template) return [];
            const index = role === 'start' ? 0 : points.length - 2;
            const neighbor = role === 'start' ? 2 : index - 2;
            const x = points[index] as number, y = points[index + 1] as number;
            return [{ ...template, x, y, z: 0,
                rotation: Math.atan2(y - (points[neighbor + 1] as number), x - (points[neighbor] as number)) }];
        });
    }
    if (!spline || !asset) return templates;
    const points = resolveFoxholeConnectorDisplaySockets(spline.data as unknown as FoxholeSceneV2SplineConnectorData, asset);
    return points.map(point => ({
        ...templates.find(template => normalizeFoxholeBuildSocketName(template.name) === normalizeFoxholeBuildSocketName(point.socket.name)),
        name: point.socket.name, x: point.x, y: point.y, z: 0, rotation: point.rotation,
        socketTags: point.socket.socketTags,
    }));
}
