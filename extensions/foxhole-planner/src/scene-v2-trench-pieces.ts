import type { NixieComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { trenchLayerQuad } from './trench-connector.ts';
import type { TrenchEndpoint } from './trench-connector.ts';
import { trenchWallPieces, clipPiece, intervalPieces, nativePiece, offsetEndpoint, pieceFrame, stripPieces, trenchRoofPolygon } from './trench-connector-pieces.ts';
import type { TrenchPiece, TrenchPieceFrame } from './trench-connector-pieces.ts';

export function sceneV2TrenchLayers(asset: FoxholeSceneV2AssetMetadata): TrenchPieceFrame[] {
    return Object.entries(asset.renderLayers).map(([id, layer]) => ({
        id, textureUrl: id, width: layer.width * 2, height: layer.height * 2,
        offsetX: layer.offsetX * 2, offsetY: layer.offsetY * 2, anchorX: layer.anchorX, anchorY: layer.anchorY,
    }));
}

export function trenchConnectedEnds(data: FoxholeSceneV2SplineConnectorData) {
    return {
        back: Boolean(data.startAttachmentNodeId || (data.startSocketName && data.socketAttachments?.[data.startSocketName])),
        front: Boolean(data.endAttachmentNodeId || (data.endSocketName && data.socketAttachments?.[data.endSocketName])),
    };
}

export function sceneV2TrenchPieces(entity: NixieComponentEntitySnapshotV1, data: FoxholeSceneV2SplineConnectorData,
    asset: FoxholeSceneV2AssetMetadata, layers: readonly TrenchPieceFrame[], start: TrenchEndpoint, end: TrenchEndpoint,
    settings: Readonly<Record<string, unknown>>): TrenchPiece[] {
    const { back, front } = trenchConnectedEnds(data);
    const pieces = trenchWallPieces(layers, start, end, back, front).filter(p => p.id.startsWith('floorcover') ? settings['foxhole.structure.hideFloors'] !== true
        : p.id.startsWith('dirt:') ? settings['foxhole.structure.hideDirt'] !== true : settings['foxhole.structure.hideWalls'] !== true);
    // T3 dirtcorner layers are concrete seam blocks that bridge connected ends.
    for (const frame of layers.filter(f => /^(?:wall|corner|dirt)/.test(f.id) && /back|front/.test(f.id))) {
        const connected = frame.id.includes('back') ? back : front;
        const concreteSeam = data.foxholeKey === 'trenchconnectort3' && frame.id.startsWith('dirtcorner');
        if (connected && !concreteSeam)
            continue;
        if (settings['foxhole.structure.hideDirt'] === true && frame.id.startsWith('dirt'))
            continue;
        if (settings['foxhole.structure.hideWalls'] === true && !frame.id.startsWith('dirt'))
            continue;
        pieces.push({ id: 'cap:' + frame.id, textureUrl: frame.textureUrl, positions: trenchLayerQuad(frame, start, end), uvs: [0, 0, 1, 0, 1, 1, 0, 1], alpha: 1 });
    }
    const selections = entity.components.find(row => row.ownerId === 'nixie.foxhole-planner' && row.componentId === 'modification' && row.definitionAvailable)?.data.selections;
    if (Array.isArray(selections))
        for (const row of selections) {
            if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.slotId !== 'string' || typeof row.variantId !== 'string')
                continue;
            const slot = asset.modifications[row.slotId], variant = slot?.variants[row.variantId];
            if (!slot || !variant || variant.isUpgrade)
                continue;
            const id = 'mod:' + row.slotId + ':' + row.variantId;
            if (row.variantId === 'trenchroof') {
                if (settings['foxhole.structure.hideRoofs'] !== true)
                    pieces.push(...roofPieces(layers, id, start, end, 1));
                continue;
            }
            if (!['sandbags', 'barbedwire'].includes(row.variantId))
                continue;
            const side = slot.y < 0 ? -1 : 1, a = offsetEndpoint(side < 0 ? start : end, side * 70.4, side < 0 ? 4.8 : -4.8), b = offsetEndpoint(side < 0 ? end : start, side * 70.4, side < 0 ? -4.8 : 4.8), heading = Math.atan2(b.y - a.y, b.x - a.x);
            if (row.variantId === 'sandbags') {
                const frames = Array.from({ length: 4 }, (_, i) => pieceFrame(layers, 'TrenchConnectorSandbagsAngledSpline0' + (i + 1))).filter((f): f is TrenchPieceFrame => !!f);
                pieces.push(...intervalPieces(frames, id, a, b, 25.6, { start: 25.6, end: 12.8, fromEnd: side > 0 }));
                const cap = pieceFrame(layers, 'TrenchConnectorSandbagsAngledSplineEnd');
                if (cap)
                    pieces.push(nativePiece(cap, id + ':start', { x: a.x + Math.cos(heading) * 8, y: a.y + Math.sin(heading) * 8 }, heading + Math.PI), nativePiece(cap, id + ':end', { x: b.x - Math.cos(heading) * 8, y: b.y - Math.sin(heading) * 8 }, heading));
            }
            else {
                const post = pieceFrame(layers, 'TrenchBarbedWirePillarT' + data.foxholeKey.at(-1)), wire = pieceFrame(layers, 'TrenchBarbedWireT' + data.foxholeKey.at(-1));
                if (wire)
                    pieces.push(...stripPieces(wire, id + ':wire', a, b, 1, undefined, side > 0));
                if (post)
                    pieces.push(nativePiece(post, id + ':start', a, heading), nativePiece(post, id + ':end', b, heading));
            }
        }
    return pieces;
}

function roofPieces(layers: readonly TrenchPieceFrame[], id: string, start: TrenchEndpoint, end: TrenchEndpoint, alpha: number): TrenchPiece[] {
    const panel = pieceFrame(layers, 'TrenchT3RoofSurface') ?? pieceFrame(layers, 'TrenchT3Roof01');
    if (!panel)
        return [];
    const polygon = trenchRoofPolygon(start, end);
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const angle = Math.atan2(end.y - start.y, end.x - start.x), c = Math.cos(angle), s = Math.sin(angle);
    // Tile the native roof section in the polygon's plane, then clip the actual
    // geometry. UVs remain affine across both triangles, with no skewed panels.
    const along = polygon.map(p => (p.x - center.x) * c + (p.y - center.y) * s);
    const min = Math.min(...along), max = Math.max(...along);
    const pieces = stripPieces(panel, `${id}:panel`, { x: center.x + c * min, y: center.y + s * min }, { x: center.x + c * max, y: center.y + s * max }, alpha, undefined, false, true)
        .map(p => clipPiece(p, polygon));
    for (const suffix of ['', 'Top']) {
        const frames = Array.from({ length: 3 }, (_, i) => pieceFrame(layers, `TrenchT3RoofTrim0${i + 1}${suffix}`)).filter((f): f is TrenchPieceFrame => !!f);
        pieces.push(...intervalPieces(frames, `${id}:trim${suffix}`, start, end, 79.36, { start: 39.68, end: 39.68, center: true, alpha }).map(p => clipPiece(p, polygon)));
    }
    const cap = pieceFrame(layers, 'TrenchT3RoofEnd');
    if (cap) {
        // The source mesh pivot is 500cm from its end; use the blueprint's
        // opposing +/-500cm offsets instead of centring the image on a socket.
        pieces.push(nativePiece(cap, `${id}:start`, offsetEndpoint(start, 0, 160), start.rotation + Math.PI, alpha), nativePiece(cap, `${id}:end`, offsetEndpoint(end, 0, -160), end.rotation, alpha));
    }
    return pieces.filter(p => p.positions.length >= 6);
}
