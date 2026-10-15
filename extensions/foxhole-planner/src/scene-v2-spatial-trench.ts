import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalSpatialNodeV1, NixieExperimentalSpatialPlanV1, NixieExperimentalSpatialEndpointBindingsV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { trenchLayerQuad } from './trench-connector.ts';
import type { TrenchEndpoint } from './trench-connector.ts';
import { trenchWallPieces, trenchFloorPolygon, clipPiece, intervalPieces, nativePiece, offsetEndpoint, pieceFrame, stripPieces, trenchRoofPolygon } from './trench-connector-pieces.ts';
import type { TrenchPiece, TrenchPieceFrame } from './trench-connector-pieces.ts';
/** Native V1 pieces and independently rotated handles, with the actual source mesh/materials. */
export function renderSpatialTrench(entity: NixieExperimentalComponentEntitySnapshotV1, data: FoxholeSceneV2SplineConnectorData & {
    startZ?: number;
    endZ?: number;
    endpointBindings?: NixieExperimentalSpatialEndpointBindingsV1;
}, asset: FoxholeSceneV2AssetMetadata, settings: Readonly<Record<string, unknown>> = {}): NixieExperimentalSpatialPlanV1 | undefined {
    const profile = asset.model?.pathProfile;
    if (!asset.model || !profile)
        return undefined;
    const start = { x: data.startX, y: data.startY, rotation: data.startRotation }, end = { x: data.endX, y: data.endY, rotation: data.endRotation };
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    if (length < 1e-6)
        return undefined;
    const angle = Math.atan2(dy, dx), c = Math.cos(angle), s = Math.sin(angle), height = (data.endZ ?? 0) - (data.startZ ?? 0), length3 = Math.hypot(length, height);
    const layers = Object.entries(asset.renderLayers).map(([id, v]) => ({ id, textureUrl: id, width: v.width * 2, height: v.height * 2, offsetX: v.offsetX * 2, offsetY: v.offsetY * 2, anchorX: v.anchorX, anchorY: v.anchorY }));
    const back = !!(data.startAttachmentNodeId || (data.startSocketName && data.socketAttachments?.[data.startSocketName]));
    const front = !!(data.endAttachmentNodeId || (data.endSocketName && data.socketAttachments?.[data.endSocketName]));
    const pieces = trenchWallPieces(layers, start, end, back, front).filter(p => p.id.startsWith('floorcover') ? settings['foxhole.structure.hideFloors'] !== true
        : p.id.startsWith('dirt:') ? settings['foxhole.structure.hideDirt'] !== true : settings['foxhole.structure.hideWalls'] !== true);
    // Match V1: only front/back walls, dirt and corner caps belong to an endpoint.
    for (const frame of layers.filter(f => /^(?:wall|corner|dirt)/.test(f.id) && /back|front/.test(f.id))) {
        const connected = frame.id.includes('back') ? back : front;
        if (connected && !frame.id.startsWith('dirtcorner'))
            continue;
        if (settings['foxhole.structure.hideDirt'] === true && frame.id.startsWith('dirt'))
            continue;
        if (settings['foxhole.structure.hideWalls'] === true && !frame.id.startsWith('dirt'))
            continue;
        pieces.push({ id: 'cap:' + frame.id, textureUrl: frame.id, positions: trenchLayerQuad(frame, start, end), uvs: [0, 0, 1, 0, 1, 1, 0, 1], alpha: 1 });
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
    const groups = new Map<string, {
        frame: TrenchPieceFrame;
        pieces: TrenchPiece[];
        instances: Array<{
            distance: number;
            rotation: number;
            offset: [
                number,
                number,
                number
            ];
        }>;
    }>();
    for (const piece of pieces) {
        if (piece.positions.length < 6)
            continue;
        const frame = layers.find(f => f.textureUrl === piece.textureUrl);
        if (!frame || !profile.parts[frame.id])
            throw Error('Missing exported trench piece: ' + piece.textureUrl);
        let next = 1;
        while (next < piece.uvs.length / 2 && Math.hypot(piece.uvs[next * 2]! - piece.uvs[0]!, piece.uvs[next * 2 + 1]! - piece.uvs[1]!) < 1e-8)
            next++;
        if (next === piece.uvs.length / 2)
            continue;
        const lx = (piece.uvs[next * 2]! - piece.uvs[0]!) * frame.width! / 2, ly = (piece.uvs[next * 2 + 1]! - piece.uvs[1]!) * frame.height! / 2;
        const heading = Math.atan2(piece.positions[next * 2 + 1]! - piece.positions[1]!, piece.positions[next * 2]! - piece.positions[0]!) - Math.atan2(ly, lx), cos = Math.cos(heading), sin = Math.sin(heading);
        const px = frame.offsetX! / 2 + (piece.uvs[0]! - frame.anchorX!) * frame.width! / 2, py = frame.offsetY! / 2 + (piece.uvs[1]! - frame.anchorY!) * frame.height! / 2;
        const x = piece.positions[0]! - cos * px + sin * py, y = piece.positions[1]! - sin * px - cos * py;
        const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / (length * length))), ox = x - start.x - dx * t, oy = y - start.y - dy * t;
        const family = piece.id.startsWith('wall:') || piece.id.startsWith('dirt:') ? piece.id.split(':').slice(0, 2).join(':') : piece.id.startsWith('mod:') ? piece.id.split(':').slice(0, 3).join(':') : '';
        const key = frame.id + family;
        let group = groups.get(key);
        if (!group) {
            group = { frame, pieces: [], instances: [] };
            groups.set(key, group);
        }
        group.pieces.push(piece);
        group.instances.push({ distance: t * length3, rotation: heading - angle, offset: [ox * c + oy * s, -ox * s + oy * c, 0] });
    }
    const common = { kind: 'model-path' as const, resourceId: asset.model.resourceId, unitsPerMetre: 32, points: [start.x, start.y, data.startZ ?? 0, end.x, end.y, data.endZ ?? 0], ...(data.endpointBindings ? { endpointBindings: data.endpointBindings } : {}) };
    const nodes: NixieExperimentalSpatialNodeV1[] = [];
    for (const group of groups.values())
        for (const meshIndex of profile.parts[group.frame.id]!.meshIndices ?? [profile.parts[group.frame.id]!.meshIndex]) {
            nodes.push({ ...common, id: 'trench-piece-' + nodes.length, meshIndex, sourceOrigin: [0, 0, 0], instances: group.instances,
                clipPolygons: group.pieces.map(p => p.positions) });
        }
    if (settings['foxhole.structure.hideFloors'] !== true) {
        const floor = profile.parts.floor;
        if (!floor)
            throw Error('Missing trench floor prototype');
        const buffer = 128, ratio = height / length;
        nodes.unshift({ ...common, id: 'trench-floor', meshIndex: floor.meshIndex,
            points: [start.x - c * buffer, start.y - s * buffer, (data.startZ ?? 0) - ratio * buffer, end.x + c * buffer, end.y + s * buffer, (data.endZ ?? 0) + ratio * buffer],
            deformationAnchors: [buffer * length3 / length, (buffer + length) * length3 / length], clipPolygons: [trenchFloorPolygon(start, end, layers, back, front).flatMap(p => [p.x, p.y])] });
    }
    return { contractVersion: 1, nodes };
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
