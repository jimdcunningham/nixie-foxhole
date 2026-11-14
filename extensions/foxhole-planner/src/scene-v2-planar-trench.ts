import type { NixieComponentEntitySnapshotV1, NixieExtensionRenderMeshV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { foxholeSceneV2ConnectorEndpoints } from './scene-v2-connector-path.ts';
import { buildTrenchBuildSiteMesh, isTrenchConnectorBuildSite, isTrenchConnectorViable, trenchConnectorCorners } from './trench-connector.ts';
import { centeredPolygonUvs, polygonCentroid, trenchFloorPolygon } from './trench-connector-pieces.ts';
import { sceneV2TrenchLayers, sceneV2TrenchPieces, trenchConnectedEnds } from './scene-v2-trench-pieces.ts';
import { FOXHOLE_HEIGHT_RENDER_LANES, FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane } from './render-lanes.ts';

export function renderPlanarTrench(
    entity: NixieComponentEntitySnapshotV1,
    data: FoxholeSceneV2SplineConnectorData,
    asset: FoxholeSceneV2AssetMetadata,
    floor: FoxholeSceneV2AssetMetadata['renderLayers'][string] | undefined,
    settings: Readonly<Record<string, unknown>>,
): NixieExtensionRenderMeshV1[] {
    const { start, end } = foxholeSceneV2ConnectorEndpoints(data);
    const invalid = !isTrenchConnectorViable(start, end);
    const tint = invalid ? 0xff4444 : data.blueprint ? 0x335cff : data.tint;
    const brightness = data.blueprint ? 2.15 : data.brightness;

    if (isTrenchConnectorBuildSite(data.foxholeKey)) {
        return [{ id: 'trench-dig-site', kind: 'mesh',
            resourceId: `foxhole.asset.${data.foxholeKey}`,
            ...foxholeRenderLane(FOXHOLE_HEIGHT_RENDER_LANES.trench),
            ...buildTrenchBuildSiteMesh(start, end), tint, brightness }];
    }

    const layers = sceneV2TrenchLayers(asset);
    const { back, front } = trenchConnectedEnds(data);
    const pieces = sceneV2TrenchPieces(entity, data, asset, layers, start, end, settings);
    if (floor && settings['foxhole.structure.hideFloors'] !== true) {
        const polygon = trenchFloorPolygon(start, end, layers, back, front);
        const concrete = data.foxholeKey === 'trenchconnectort3';
        const heading = Math.atan2(end.y - start.y, end.x - start.x);
        pieces.unshift({
            id: 'floor', textureUrl: 'floor', alpha: 1,
            positions: polygon.flatMap(point => [point.x, point.y]),
            uvs: centeredPolygonUvs(polygon, floor.width - (concrete ? 16 : 0),
                floor.height - (concrete ? 8 : 0), heading, polygonCentroid(trenchConnectorCorners(start, end))),
        });
    }
    return pieces.filter(piece => piece.positions.length >= 6).map(piece => {
        const lane = piece.id === 'floor' ? FOXHOLE_STRUCTURE_RENDER_LANES.floor
            : piece.id.startsWith('floorcover') ? FOXHOLE_STRUCTURE_RENDER_LANES.floorDetail
            : piece.id.startsWith('dirt:') || piece.id.startsWith('cap:dirt') ? FOXHOLE_STRUCTURE_RENDER_LANES.bunkerDirt
            : piece.id.startsWith('mod:') ? FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense
            : FOXHOLE_STRUCTURE_RENDER_LANES.base;
        return {
            id: `trench-${piece.id}`, kind: 'mesh', resourceId: (piece.id === 'floor' ? floor! : asset.renderLayers[piece.textureUrl]!).resourceId,
            ...foxholeRenderLane(lane),
            positions: piece.positions, uvs: piece.uvs, alpha: piece.alpha, tint, brightness,
            indices: Array.from({ length: piece.positions.length / 2 - 2 }, (_, index) => [0, index + 1, index + 2]).flat(),
        };
    });
}
