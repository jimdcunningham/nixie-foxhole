import assert from 'node:assert/strict';
import test from 'node:test';
import { clampDraggedSplineEndpoint } from '../../../extension-sdk/src/spline-path.ts';
import { buildTrenchBuildSiteMesh, isTrenchConnectorViable, trenchConnectorCorners } from '../app/plugins/foxhole/nixie/trench-connector.ts';
import { allowsConnectorRotationHandles, resolveEffectiveConnectorPathStyle, usesSplineConnectorSocketSnapping } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { createFoxholeSplineConnectorSnapshot } from '../app/plugins/foxhole/nixie/spline-connector-snapshot.ts';
import { sampleConnectorPath } from '../app/plugins/foxhole/nixie/pipe-connector-path.ts';
import { updateTrenchBuildSiteMesh } from '../app/plugins/foxhole/nixie/trench-connector-mesh.ts';
import { resolveFoxholeSplinePlacementPreview } from '../app/plugins/foxhole/nixie/spline-connector-placement.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { resolveFoxholeConnectorEndpointSockets } from '../app/plugins/foxhole/nixie/connector.ts';
import { trenchLayerQuad } from '../app/plugins/foxhole/nixie/trench-connector.ts';
import { TrenchConnectorVisual } from '../app/plugins/foxhole/nixie/trench-connector-visual.ts';

const start = { x: 0, y: 0, rotation: 0 };
const end = { x: 160, y: 0, rotation: 0 };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('trench length limits stay viable while dragging along the clamped boundary', () => {
    for (const role of ['start', 'end'] as const) for (const distance of [20, 400]) {
        for (let step = -400; step <= 400; step++) {
            const angle = step / 1000;
            const anchor = { x: 13.25, y: -27.5, rotation: 0 };
            const moving = { x: anchor.x + Math.cos(angle) * distance, y: anchor.y + Math.sin(angle) * distance, rotation: 0 };
            const clamped = role === 'end'
                ? clampDraggedSplineEndpoint(role, anchor, moving, { minLength: 80, maxLength: 256 })
                : clampDraggedSplineEndpoint(role, { ...moving, rotation: Math.PI }, { ...anchor, rotation: Math.PI }, { minLength: 80, maxLength: 256 });
            assert.ok(isTrenchConnectorViable(clamped.start, clamped.end), `${role} distance=${distance} angle=${angle} length=${Math.hypot(clamped.end.x - clamped.start.x, clamped.end.y - clamped.start.y)}`);
        }
    }
    assert.equal(isTrenchConnectorViable(start, { ...end, x: 256.001 }), false);
    assert.equal(isTrenchConnectorViable(start, { ...end, x: 79.999 }), false);
});

test('occupied trench ends hide both corners along with their wall', () => {
    const layers = ['wallback', 'cornerbackleft', 'cornerbackright', 'wallfront', 'cornerfrontleft', 'cornerfrontright'].map(id => ({
        id, textureUrl: `/${id}`, width: 20, height: 20, offsetX: 0, offsetY: 0,
    }));
    const visual = new TrenchConnectorVisual(async () => null);
    const options = { start, end, layers, alpha: 1, tint: 0xffffff, contactShadows: false };
    visual.sync(options);
    const meshes = [...visual.children];
    visual.position.set(71, 29);
    visual.syncOccupancy(true, false);
    assert.equal(meshes.filter(mesh => mesh.visible).length, 3);
    visual.syncOccupancy(true, true);
    assert.ok(meshes.every(mesh => !mesh.visible));
    assert.equal(visual.x, 71);
    assert.equal(visual.y, 29);
    assert.deepEqual([...visual.children], meshes);
    visual.syncOccupancy(false, false);
    assert.ok(meshes.every(mesh => mesh.visible));
    visual.destroy();
});

for (const tier of [1, 2, 3]) test(`T${tier} keeps independently rotating ends and trench socket constraints`, () => {
    const key = `trenchconnectort${tier}`;
    assert.equal(resolveEffectiveConnectorPathStyle('interval', key), 'trench');
    assert.equal(allowsConnectorRotationHandles('trench', key), true);
    assert.equal(usesSplineConnectorSocketSnapping(key), true);
    const state = createFoxholeSplineConnectorSnapshot({ foxholeKey: key, start, end }).state;
    assert.equal(state.maxLength, 256);
    const preview = resolveFoxholeSplinePlacementPreview(state, { phase: 'pick-end' }, { x: 160, y: 60 }, { pathStyle: 'trench' });
    near(preview.end.rotation, Math.atan2(60, 160));
    const asset = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === key)!;
    const layers = new Set(asset.renderLayers?.map(layer => layer.id));
    for (const id of ['wallleft', 'wallright', 'wallback', 'wallfront', 'cornerbackleft', 'cornerfrontright', 'dirtsplineleft', 'dirtsplineright']) assert.ok(layers.has(id), `${key}: missing ${id}`);
    if (tier === 2) assert.ok(layers.has('floorsplineconnector'));
    const restored = createFoxholeSplineConnectorSnapshot({ foxholeKey: key, structure: asset, start, end });
    const sockets = resolveFoxholeConnectorEndpointSockets(asset, restored.state);
    assert.ok(sockets.start && sockets.end);
    assert.notEqual(sockets.start.name, sockets.end.name);
});

test('endpoint corners retain native dimensions while handles rotate independently', () => {
    const frame = { id: 'wallleft', width: 230.4, height: 24, anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: -96 };
    const a = { ...start, rotation: 0.4 };
    const b = { ...end, rotation: -0.3 };
    const corner = trenchLayerQuad({ ...frame, id: 'cornerbackleft', width: 20, height: 30 }, a, b);
    near(Math.hypot(corner[2]! - corner[0]!, corner[3]! - corner[1]!), 10);
    near(Math.hypot(corner[6]! - corner[0]!, corner[7]! - corner[1]!), 15);
});

test('tier visual reuses buffers and pending texture requests, hides attached caps, and releases geometry', async () => {
    let loads = 0;
    const visual = new TrenchConnectorVisual(async () => { loads++; return null; });
    const layer = { id: 'wallback', textureUrl: '/wall', width: 40, height: 190, anchorX: 0.5, anchorY: 0.5, offsetX: -128, offsetY: 0, componentName: null, componentTags: [] };
    const options = { start, end, layers: [layer], floor: { ...layer, id: 'floor', textureUrl: '/floor' }, alpha: 1, tint: 0xffffff };
    visual.sync(options);
    assert.equal(visual.containsLocalPoint({ x: -8, y: 0 }), true);
    assert.equal(visual.containsLocalPoint({ x: -80, y: 0 }), false);
    const meshes = [...visual.children];
    const buffers = meshes.map(mesh => (mesh as import('pixi.js').Mesh).geometry.getBuffer('aPosition'));
    for (let i = 0; i < 100; i++) visual.sync({ ...options, start: { ...start, rotation: i / 300 }, startConnected: true });
    assert.equal(loads, 2);
    assert.deepEqual(visual.children, meshes);
    assert.equal(meshes[1]!.visible, false);
    meshes.forEach((mesh, i) => assert.equal((mesh as import('pixi.js').Mesh).geometry.getBuffer('aPosition'), buffers[i]));
    visual.sync(options);
    assert.equal(meshes[1]!.visible, true);
    visual.destroy();
    assert.ok(meshes.every(mesh => mesh.destroyed));
});

test('build-site endpoints expose rotation handles and socket snapping without curving the span', () => {
    const key = 'trenchconnectorbuildsite';
    const style = resolveEffectiveConnectorPathStyle('straight-telescoping', key);
    assert.equal(style, 'trench');
    assert.equal(allowsConnectorRotationHandles(style, key), true);
    assert.equal(usesSplineConnectorSocketSnapping(key), true);
    const snapshot = createFoxholeSplineConnectorSnapshot({ foxholeKey: key, start, end });
    assert.equal(snapshot.state.minLength, 80);
    assert.equal(snapshot.state.maxLength, 256);
    const sample = sampleConnectorPath({ ...start, rotation: 0.4 }, { ...end, rotation: -0.4 }, snapshot.state, style, { foxholeKey: key });
    for (const point of sample.points) near(point.y, 0);
});

test('rotated post pairs keep their width and form a trapezoid', () => {
    const corners = trenchConnectorCorners({ ...start, rotation: -0.4 }, { ...end, rotation: 0.4 });
    near(Math.hypot(corners[0]!.x - corners[3]!.x, corners[0]!.y - corners[3]!.y), 104);
    near(Math.hypot(corners[1]!.x - corners[2]!.x, corners[1]!.y - corners[2]!.y), 104);
    assert.ok(corners[1]!.x - corners[0]!.x > corners[2]!.x - corners[3]!.x);
});

test('build-site mesh preserves rigid end strips and fixed bounded topology under deformation', () => {
    const a = buildTrenchBuildSiteMesh(start, end);
    const b = buildTrenchBuildSiteMesh({ ...start, rotation: 0.5 }, { x: 180, y: 60, rotation: -0.2 });
    assert.equal(a.positions.length, 32);
    assert.equal(a.indices.length, 48);
    assert.deepEqual(a.indices, b.indices);
    assert.deepEqual(a.uvs, b.uvs);
    for (const offset of [0, 16]) {
        for (let index = offset; index < offset + 16; index += 2) {
            near(Math.hypot(a.positions[index]! - a.positions[offset]!, a.positions[index + 1]! - a.positions[offset + 1]!),
                Math.hypot(b.positions[index]! - b.positions[offset]!, b.positions[index + 1]! - b.positions[offset + 1]!));
        }
    }
});

test('viability rejects overlength, crossed ends, and excessive skew', () => {
    assert.equal(isTrenchConnectorViable(start, end), true);
    assert.equal(isTrenchConnectorViable(start, { ...end, x: 256 }), true);
    assert.equal(isTrenchConnectorViable(start, { ...end, x: 257 }), false);
    assert.equal(isTrenchConnectorViable(start, { ...end, x: 79 }), false);
    assert.equal(isTrenchConnectorViable(start, { ...end, rotation: Math.PI }), false);
    assert.equal(isTrenchConnectorViable(start, { ...end, rotation: Math.PI / 4 }), true);
});

test('mesh updates retain the GPU geometry, UVs, indices, and texture', () => {
    const mesh = updateTrenchBuildSiteMesh(null, start, end);
    const geometry = mesh.geometry;
    const positions = geometry.getBuffer('aPosition');
    const indices = geometry.indexBuffer;
    const uvs = geometry.getBuffer('aUV');
    const texture = mesh.texture;
    for (let i = 0; i < 100; i++) {
        assert.equal(updateTrenchBuildSiteMesh(mesh, { ...start, rotation: i / 300 }, end), mesh);
    }
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.geometry.getBuffer('aPosition'), positions);
    assert.equal(mesh.geometry.indexBuffer, indices);
    assert.equal(mesh.geometry.getBuffer('aUV'), uvs);
    const bentStart = { ...start, rotation: -0.785 };
    updateTrenchBuildSiteMesh(mesh, bentStart, { ...end, x: 80 });
    assert.deepEqual([...geometry.indices], buildTrenchBuildSiteMesh(bentStart, { ...end, x: 80 }).indices);
    updateTrenchBuildSiteMesh(mesh, start, end);
    assert.deepEqual([...geometry.indices], buildTrenchBuildSiteMesh(start, end).indices);
    assert.equal(mesh.geometry.indexBuffer, indices);
    assert.equal(mesh.texture, texture);
    geometry.destroy();
    mesh.destroy();
});

test('free placement follows the chord while snapped and manually rotated ends retain their axes', () => {
    const state = createFoxholeSplineConnectorSnapshot({ foxholeKey: 'trenchconnectorbuildsite', start, end }).state;
    const cursor = { x: 160, y: 60 };
    const free = resolveFoxholeSplinePlacementPreview(state, { phase: 'pick-end' }, cursor, { pathStyle: 'trench' });
    near(free.start.rotation, Math.atan2(60, 160));
    near(free.end.rotation, Math.atan2(60, 160));
    const snapped = resolveFoxholeSplinePlacementPreview(state, { phase: 'pick-end' }, cursor,
        { pathStyle: 'trench', snapped: { local: cursor, rotation: 0.3 } });
    near(snapped.end.rotation, 0.3);
    const manual = resolveFoxholeSplinePlacementPreview({ ...state, end: { ...end, rotation: -0.2 } },
        { phase: 'pick-end', manualEndRotation: true }, cursor, { pathStyle: 'trench' });
    near(manual.end.rotation, -0.2);
});

test('published build site resolves two distinct trench sockets and survives serialization', () => {
    const structure = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === 'trenchconnectorbuildsite')!;
    assert.ok(structure);
    const snapshot = createFoxholeSplineConnectorSnapshot({ foxholeKey: structure.id, structure, start, end: { ...end, rotation: 0.3 } });
    const restored = JSON.parse(JSON.stringify(snapshot));
    const sockets = resolveFoxholeConnectorEndpointSockets(structure, restored.state);
    assert.equal(sockets.start?.name, 'BackSocket');
    assert.equal(sockets.end?.name, 'FrontSocket');
    assert.notEqual(sockets.start?.name, sockets.end?.name);
    assert.ok(sockets.start!.socketTags.length > 0);
    near(restored.state.end.rotation, 0.3);
});
