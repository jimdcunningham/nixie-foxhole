import type { NixieComponentEntitySnapshotV1, NixieSpatialNodeV1, NixieSpatialPlanV1, NixieSpatialEndpointBindingsV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { trenchFloorPolygon } from './trench-connector-pieces.ts';
import { sceneV2TrenchLayers, sceneV2TrenchPieces, trenchConnectedEnds } from './scene-v2-trench-pieces.ts';
import type { TrenchPiece, TrenchPieceFrame } from './trench-connector-pieces.ts';

/** The native dig-site GLB has two rigid end frames and two axial ropes. */
export function renderSpatialTrenchDigSite(data: FoxholeSceneV2SplineConnectorData & {
    startZ?: number;
    endZ?: number;
    endpointBindings?: NixieSpatialEndpointBindingsV1;
}, asset?: FoxholeSceneV2AssetMetadata): NixieSpatialPlanV1 | undefined {
    const model = asset?.model;
    if (!model) return undefined;
    const start = { x: data.startX, y: data.startY, z: data.startZ ?? 0, rotation: data.startRotation };
    const end = { x: data.endX, y: data.endY, z: data.endZ ?? 0, rotation: data.endRotation };
    const dx = end.x - start.x, dy = end.y - start.y;
    if (Math.hypot(dx, dy) < 1e-6) return undefined;
    const heading = Math.atan2(dy, dx), length = Math.hypot(dx, dy, end.z - start.z);
    const common = { kind: 'model-path' as const, resourceId: model.resourceId, unitsPerMetre: 32 };
    const bindings = data.endpointBindings?.start || data.endpointBindings?.end
        ? { endpointBindings: data.endpointBindings }
        : {};
    const parts = model.pathProfile?.parts;
    const points = [start.x, start.y, start.z, end.x, end.y, end.z];
    const nodes: NixieSpatialNodeV1[] = [
        { ...common, id: 'dig-site-start', meshIndex: parts?.start?.meshIndex ?? 1,
            points, ...bindings,
            sourceOrigin: parts?.start?.origin ?? [-38.4, 0, 0],
            instances: [{ distance: 0, rotation: relativeAngle(start.rotation, heading) }] },
        { ...common, id: 'dig-site-end', meshIndex: parts?.end?.meshIndex ?? 0,
            points, ...bindings,
            sourceOrigin: parts?.end?.origin ?? [38.4, 0, 0],
            instances: [{ distance: length, rotation: relativeAngle(end.rotation, heading) }] },
    ];
    // The authored posts are 200 cm to either side of the frame pivots.
    // The ropes meet the posts about 42.5 cm outward from those pivots.
    const corner = (endpoint: typeof start, beyond: number, side: number) => ({
        x: endpoint.x + Math.cos(endpoint.rotation) * beyond - Math.sin(endpoint.rotation) * side,
        y: endpoint.y + Math.sin(endpoint.rotation) * beyond + Math.cos(endpoint.rotation) * side,
    });
    for (const [index, role] of ['leftRope', 'rightRope'].entries()) {
        const part = parts?.[role];
        const side = part?.origin[1] ?? (index === 0 ? -64 : 64);
        const first = corner(start, -13.6, side), last = corner(end, 13.6, side);
        const ropeX = last.x - first.x, ropeY = last.y - first.y;
        const ropeLength = Math.hypot(ropeX, ropeY);
        if (ropeLength < 1e-6) continue;
        // The sweep is centered on the chord while the source rope carries
        // its native lateral offset. Move the chord so the mesh meets the posts.
        const offsetX = ropeY * side / ropeLength, offsetY = -ropeX * side / ropeLength;
        nodes.push({ ...common, id: `dig-site-rope-${index + 1}`, meshIndex: part?.meshIndex ?? index + 2,
            points: [first.x + offsetX, first.y + offsetY, start.z, last.x + offsetX, last.y + offsetY, end.z] });
    }
    return { contractVersion: 1, nodes };
}

function relativeAngle(angle: number, heading: number): number {
    return Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading));
}

/** Native V1 pieces and independently rotated handles, with the actual source mesh/materials. */
export function renderSpatialTrench(entity: NixieComponentEntitySnapshotV1, data: FoxholeSceneV2SplineConnectorData & {
    startZ?: number;
    endZ?: number;
    endpointBindings?: NixieSpatialEndpointBindingsV1;
}, asset: FoxholeSceneV2AssetMetadata, settings: Readonly<Record<string, unknown>> = {}): NixieSpatialPlanV1 | undefined {
    const profile = asset.model?.pathProfile;
    if (!asset.model || !profile)
        return undefined;
    const start = { x: data.startX, y: data.startY, rotation: data.startRotation }, end = { x: data.endX, y: data.endY, rotation: data.endRotation };
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    if (length < 1e-6)
        return undefined;
    const angle = Math.atan2(dy, dx), c = Math.cos(angle), s = Math.sin(angle), height = (data.endZ ?? 0) - (data.startZ ?? 0), length3 = Math.hypot(dx, dy, height);
    const layers = sceneV2TrenchLayers(asset);
    const framesById = new Map(layers.map(frame => [frame.id, frame]));
    const { back, front } = trenchConnectedEnds(data);
    const pieces = sceneV2TrenchPieces(entity, data, asset, layers, start, end, settings);
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
        const frame = framesById.get(piece.textureUrl);
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
    const common = { kind: 'model-path' as const, resourceId: asset.model.resourceId, unitsPerMetre: 32, points: [start.x, start.y, data.startZ ?? 0, end.x, end.y, data.endZ ?? 0], ...(data.endpointBindings?.start || data.endpointBindings?.end ? { endpointBindings: data.endpointBindings } : {}) };
    const nodes: NixieSpatialNodeV1[] = [];
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
    const deformationPathId = nodes.find(node => node.kind === 'model-path' && node.id !== 'trench-floor')?.id;
    return { contractVersion: 1, nodes, groundCutouts: [{
        polygon: trenchFloorPolygon(start, end, layers, back, front).flatMap(p => [p.x, p.y]),
        minZ: -64, maxZ: 0, ...(deformationPathId ? { deformationPathId } : {}),
    }] };
}
