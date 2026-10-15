import assert from 'node:assert/strict';
import test from 'node:test';
import { centeredPolygonUvs, clipPiece, intervalPieces, nativePiece, polygonCentroid, stripPieces, trenchFloorEndCorners, trenchFloorPolygon, trenchWallPieces } from '../app/plugins/foxhole/nixie/trench-connector-pieces.ts';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { trenchLayerQuad } from '../app/plugins/foxhole/nixie/trench-connector.ts';
import { trenchConnectorCorners } from '../app/plugins/foxhole/nixie/trench-connector.ts';
import { TrenchConnectorVisual } from '../app/plugins/foxhole/nixie/trench-connector-visual.ts';

const frame = { id: 'piece', textureUrl: '/piece', width: 100, height: 40, offsetX: 0, offsetY: 0, anchorX: 0.5, anchorY: 0.5 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test('connecting either end preserves the floor texture origin for all trench tiers', () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    for (const tier of [1, 2, 3]) {
        const visual = new TrenchConnectorVisual(async () => null);
        const start = { x: 10, y: 20, rotation: -0.3 }, end = { x: 210, y: 60, rotation: 0.5 };
        const layers = catalog.assetByKey[`trenchconnectort${tier}`]!.renderLayers;
        const angle = Math.atan2(end.y - start.y, end.x - start.x), c = Math.cos(angle), s = Math.sin(angle);
        visual.sync({ start, end, layers, floor: { ...frame, id: 'floor', width: 640, height: 640 }, alpha: 1, tint: 0xffffff, contactShadows: false });
        let initial: number[] | undefined;
        for (const [back, front] of [[false, false], [true, false], [true, true], [false, true], [false, false]]) {
            visual.syncOccupancy(back!, front!);
            const geometry = visual.getSelectionMeshes()[0]!.geometry;
            const positions = geometry.getBuffer('aPosition').data, uvs = geometry.getBuffer('aUV').data;
            // Evaluate the affine mapping at local (0, 0), independent of clipping vertices.
            const origin = [Number(uvs[0]) - (Number(positions[0]) * c + Number(positions[1]) * s) / 320,
                Number(uvs[1]) - (-Number(positions[0]) * s + Number(positions[1]) * c) / 320];
            initial ??= origin;
            near(origin[0]!, initial[0]!); near(origin[1]!, initial[1]!);
        }
        visual.destroy();
    }
});

test('trench wall details use the shared corner lane and roofs stay above them', () => {
    const visual = new TrenchConnectorVisual(async () => null);
    const layers = getFoxholeStructureCatalog('/foxhole/assets/').assetByKey.trenchconnectort3!.renderLayers;
    visual.sync({ start: { x: 0, y: 0, rotation: 0 }, end: { x: 160, y: 0, rotation: 0 }, layers,
        startConnected: true, alpha: 1, tint: 0xffffff, contactShadows: false,
        modifications: [nativePiece(frame, 'mod:Roof:trenchroof:panel:0', { x: 80, y: 0 }, 0)] });
    const elevated = visual.getElevatedRenderPieces();
    const details = elevated.filter(piece => piece.id.startsWith('detail:'));
    assert.ok(details.length > 0);
    assert.ok(details.every(piece => piece.mesh.visible && piece.lane.laneOrder > 50));
    const seamBlocks = elevated.filter(piece => piece.id.startsWith('dirtcorner'));
    assert.equal(seamBlocks.length, 4);
    assert.ok(seamBlocks.every(piece => piece.mesh.visible && piece.lane.laneOrder > details[0]!.lane.laneOrder));
    assert.ok(!elevated.some(piece => piece.id.startsWith('wall:') || piece.id.startsWith('dirt:')));
    assert.ok(elevated.find(piece => piece.id.includes('trenchroof'))!.lane.laneOrder > details[0]!.lane.laneOrder);
    assert.ok(elevated.filter(piece => piece.id.startsWith('cornerback')).every(piece => !piece.mesh.visible));
    visual.destroy();
});

test('T2 and T3 floors overlap both end walls even with rotated handles', () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    for (const tier of [2, 3]) for (const rotation of [-0.6, 0, 0.6]) {
        const start = { x: 0, y: 0, rotation }, end = { x: 200, y: 0, rotation: -rotation };
        const layers = catalog.assetByKey[`trenchconnectort${tier}`]!.renderLayers;
        const floor = trenchFloorEndCorners(start, end, layers);
        const walls = trenchWallPieces(layers, start, end).filter(p => p.id.startsWith('wall:'));
        for (const wall of walls) {
            const clip = wall.shadowClips![0]!;
            // Both sides must include the extended floor endpoints in their
            // longitudinal shadow range, even though surface cuts stay put.
            const a = clip[0]!, b = clip[1]!;
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            const along = (p: { x: number; y: number }) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length;
            const side = wall.id.startsWith('wall:-1:') ? [0, 1] : [2, 3];
            for (const index of side) assert.ok(along(floor[index]!) >= -1e-6 && along(floor[index]!) <= length + 1e-6);
        }
        for (const back of [true, false]) {
            const endpoint = back ? start : end;
            const project = (x: number, y: number) => (x - endpoint.x) * Math.cos(endpoint.rotation) + (y - endpoint.y) * Math.sin(endpoint.rotation);
            const quad = trenchLayerQuad(layers.find(l => l.id === (back ? 'wallback' : 'wallfront'))!, start, end);
            const along = quad.filter((_, i) => i % 2 === 0).map((x, i) => project(x, quad[i * 2 + 1]!));
            const p = floor[back ? 0 : 1]!;
            const wallCenter = (Math.min(...along) + Math.max(...along)) / 2;
            assert.ok(back ? project(p.x, p.y) <= wallCenter - 0.99 : project(p.x, p.y) >= wallCenter + 0.99);
        }
        assert.deepEqual(trenchFloorPolygon(start, end, layers, true, true), trenchConnectorCorners(start, end));
    }
});

test('T2 and T3 floor extensions retain side coverage with independently rotated handles', () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    for (const tier of [2, 3]) for (const rotation of [-0.78, 0, 0.78]) for (const endRotation of [-0.78, 0, 0.78]) {
        for (const startConnected of [false, true]) for (const endConnected of [false, true]) {
            const start = { x: 10, y: 20, rotation }, end = { x: 210, y: 60, rotation: endRotation };
            const layers = catalog.assetByKey[`trenchconnectort${tier}`]!.renderLayers;
            const floor = trenchFloorPolygon(start, end, layers, startConnected, endConnected);
            const required = [...trenchConnectorCorners(start, end), ...trenchFloorEndCorners(start, end, layers, startConnected, endConnected)];
            for (const p of required) for (let i = 0; i < floor.length; i++) {
                const a = floor[i]!, b = floor[(i + 1) % floor.length]!;
                assert.ok((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-6,
                    `T${tier} floor lost coverage at ${rotation}, ${endRotation}`);
            }
        }
    }
    const layers = catalog.assetByKey.trenchconnectort1!.renderLayers;
    const start = { x: 0, y: 0, rotation: 0.6 }, end = { x: 200, y: 0, rotation: -0.4 };
    assert.deepEqual(trenchFloorPolygon(start, end, layers), trenchFloorEndCorners(start, end, layers));
});

test('native interval meshes keep their dimensions as the side length and angle change', () => {
    for (const length of [80, 160, 256]) for (const angle of [-0.7, 0, 0.7]) {
        const pieces = intervalPieces([frame], 'wall', { x: 0, y: 0 }, { x: Math.cos(angle) * length, y: Math.sin(angle) * length }, 25.6);
        assert.equal(pieces.length, Math.floor(length / 25.6) + 1);
        for (const { positions: p } of pieces) {
            near(Math.hypot(p[2]! - p[0]!, p[3]! - p[1]!), 50);
            near(Math.hypot(p[4]! - p[2]!, p[5]! - p[3]!), 20);
            near((p[2]! - p[0]!) * (p[4]! - p[2]!) + (p[3]! - p[1]!) * (p[5]! - p[3]!), 0);
        }
    }
});

test('continuous walls start with a full piece and crop only the far end', () => {
    const pieces = stripPieces(frame, 'wall', { x: 0, y: 0 }, { x: 125, y: 0 });
    assert.equal(pieces.length, 3);
    const last = pieces[2]!;
    near(Math.max(...last.positions.filter((_, i) => !(i % 2))), 125);
    near(Math.max(...last.uvs.filter((_, i) => !(i % 2))), 0.5);
    near(Math.min(...pieces[0]!.uvs.filter((_, i) => !(i % 2))), 0);
});

test('opposite-facing strips still anchor full pieces at the connector start', () => {
    for (const length of [80, 125, 256]) {
        const pieces = stripPieces(frame, 'wall', { x: length, y: 0 }, { x: 0, y: 0 }, 1, undefined, true);
        near(Math.min(...pieces[0]!.positions.filter((_, i) => !(i % 2))), 0);
        near(Math.max(...pieces[0]!.positions.filter((_, i) => !(i % 2))), 50);
        const instances = intervalPieces([frame], 'detail', { x: length, y: 0 }, { x: 0, y: 0 }, 30, { start: 10, fromEnd: true });
        near((instances[0]!.positions[0]! + instances[0]!.positions[2]!) / 2, 10);
    }
});

test('floor mapping is affine, at native scale, and centred on the area centroid of a trapezoid', () => {
    const polygon = trenchConnectorCorners({ x: 0, y: 0, rotation: -0.5 }, { x: 200, y: 0, rotation: 0.2 });
    const center = polygonCentroid(polygon);
    const uvs = centeredPolygonUvs(polygon, 320, 320, 0);
    polygon.forEach((p, i) => {
        near((uvs[i * 2]! - 0.5) * 320, p.x - center.x);
        near((uvs[i * 2 + 1]! - 0.5) * 320, p.y - center.y);
    });
    assert.ok(Math.abs(center.y) > 0.1, 'trapezoid centroid differs from the socket midpoint');
});

test('polygon clipping interpolates UVs and keeps every vertex inside the slanted boundary', () => {
    const piece = nativePiece(frame, 'roof', { x: 25, y: 10 }, 0);
    const clipped = clipPiece(piece, [{ x: 10, y: 0 }, { x: 40, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }]);
    for (let i = 0; i < clipped.positions.length; i += 2) {
        const x = clipped.positions[i]!, y = clipped.positions[i + 1]!;
        assert.ok(x + y / 2 >= 10 - 1e-6 && x + y / 2 <= 40 + 1e-6);
        near(clipped.uvs[i]!, x / 50);
        near(clipped.uvs[i + 1]!, y / 20);
    }
});

test('dragging across a repeat boundary reuses spare meshes and removing the family releases them', () => {
    let loads = 0;
    const visual = new TrenchConnectorVisual(async () => { loads++; return null; });
    const start = { x: 0, y: 0, rotation: 0 }, end = { x: 125, y: 0, rotation: 0 };
    const state = { start, end, layers: [], alpha: 1, tint: 0xffffff };
    visual.sync({ ...state, modifications: stripPieces(frame, 'mod:side:sandbags', start, end) });
    const meshes = [...visual.children];
    for (let i = 0; i < 50; i++) {
        visual.sync({ ...state, modifications: stripPieces(frame, 'mod:side:sandbags', start, { ...end, x: 80 }) });
        assert.equal(meshes[2]!.visible, false);
        assert.equal(visual.getSelectionMeshes().length, 2);
        visual.sync({ ...state, modifications: stripPieces(frame, 'mod:side:sandbags', start, end) });
        assert.deepEqual(visual.children, meshes);
        assert.ok(meshes.every(mesh => mesh.visible));
    }
    assert.equal(loads, 3);
    visual.sync(state);
    assert.ok(meshes.every(mesh => mesh.destroyed));
    visual.destroy();
});
