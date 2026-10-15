import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Texture } from 'pixi.js';
import { Model3D } from '@pixi/3d';
import type { Mesh3D } from '@pixi/3d';
import { MeshoptDecoder } from 'meshoptimizer';
import { glbToGltf } from '../../../../../node_modules/@pixi/3d/dist/assets/loaders/gltf/utils/glbToGltf.mjs';
import { normalizeMeshopt } from '../../../../../node_modules/@pixi/3d/dist/assets/loaders/gltf/meshopt/normalizeMeshopt.mjs';
import { parseGltf } from '../../../../../node_modules/@pixi/3d/dist/assets/loaders/gltf/parseGltf.mjs';
import { advanceNixieSpatialPathMotion, buildNixieSpatialPath, deformNixieSpatialPath, destroyNixieSpatialPath } from '../../../../nixie/app/plugins/nixie/scene-v2/spatial-path-model.ts';
import { prepareNixieSceneV2ModelGlb, registerNixieSceneV2ModelAnchor } from '../../../../nixie/app/plugins/nixie/scene-v2/spatial-model-resource.ts';
import { renderFoxholeSceneV2Entity } from '../../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';
import { listFoxholeSceneV2Products } from '../../../../../extensions/foxhole-planner/src/scene-v2-products.ts';

const assertClose = (actual: readonly number[], expected: readonly number[], tolerance = 1e-5) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < tolerance, `${value} ~= ${expected[index]}`));
};

test('the real pipeline renderer bends a packaged profile and keeps both exported fittings rigid', async () => {
    const product = listFoxholeSceneV2Products({ contractVersion: 1, query: 'facilitypipe', offset: 0, limit: 100 }).items.find(item => item.product.id === 'asset.facilitypipe')!.product;
    const components = product.components.map(component => ({ ...component, definitionAvailable: true, data: structuredClone(component.data) }));
    const state = components.find(component => component.componentId === 'spline-connector')!.data;
    Object.assign(state, { endX: 320, endY: 96, endRotation: Math.PI, curveT: 1 });
    const entity = { entityId: 'pipeline-proof', revision: 0, components };
    const plan = renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity] });
    const node = plan.experimentalSpatial!.nodes[0]!;
    const bytes = prepareNixieSceneV2ModelGlb(await readFile(new URL('../../public/foxhole/assets/models/facilitypipe.glb', import.meta.url)));
    const { json, buffers } = glbToGltf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    while (buffers.length < json.buffers.length) buffers.push(new ArrayBuffer(0));
    await MeshoptDecoder.ready; MeshoptDecoder.useWorkers = () => {};
    await normalizeMeshopt(json, buffers);
    const source = await parseGltf(json, buffers, json.images.map(() => Texture.EMPTY));
    registerNixieSceneV2ModelAnchor(source, bytes);
    const inputBytes = source.geometries.flat().map(geometry => Array.from(geometry.positions));
    const inputFittings = [source.geometries[1]![0]!, source.geometries[2]![0]!].map(geometry => geometry.bounds3D.getSize());
    const generated = buildNixieSpatialPath(node, source);
    const meshes = generated.children as Mesh3D[];
    assert.equal(meshes.length, 3);
    assert.ok(meshes.every(mesh => mesh.geometry.dynamic), 'deformable path meshes remain outside static shared GPU buffers');
    assert.ok(meshes.every(mesh => mesh.geometry.vertexCount < mesh.geometry.indexBuffer.data.length),
        'generated path meshes retain indexed vertices instead of duplicating every triangle');
    assert.ok(meshes[0]!.geometry.bounds3D.max.x > 300 && meshes[0]!.geometry.bounds3D.min.y < -80);
    assert.ok(meshes[0]!.geometry.vertexCount > source.geometries[0]![0]!.vertexCount, 'longitudinal subdivision follows bends');
    assert.deepEqual(source.geometries.flat().map(geometry => Array.from(geometry.positions)), inputBytes);
    for (const [i, expected] of inputFittings.entries()) {
        const actual = meshes[i + 1]!.geometry.bounds3D.getSize();
        assert.ok(Math.abs(actual.z - expected.y * 32) < 0.02, 'upright fitting height is retained');
        assert.equal(meshes[i + 1]!.material, source.materials[1]);
    }
    assert.equal(meshes[0]!.material, source.materials[0]);
    const fittingStarts = [meshes[1]!, meshes[2]!].map(mesh => Array.from(mesh.geometry.positions.slice(0, 3)));
    deformNixieSpatialPath(generated, [10, 20, 30], [40, 50, 60]);
    assertClose(Array.from(meshes[1]!.geometry.positions.slice(0, 3)), fittingStarts[0]!.map((value, axis) => value + [10, 20, 30][axis]!));
    assertClose(Array.from(meshes[2]!.geometry.positions.slice(0, 3)), fittingStarts[1]!.map((value, axis) => value + [40, 50, 60][axis]!));
    deformNixieSpatialPath(generated, [0, 0, 0], [0, 0, 0]);
    assert.deepEqual(Array.from(meshes[1]!.geometry.positions.slice(0, 3)), fittingStarts[0]);
    assert.deepEqual(Array.from(meshes[2]!.geometry.positions.slice(0, 3)), fittingStarts[1]);
    const edited = buildNixieSpatialPath({ ...node, points: [0, 0, 0, 160, 0, 0] }, source);
    assert.ok(edited.getLocalBounds().max.x < 180);
    const repeatedPoint = buildNixieSpatialPath({ ...node, points: [0, 0, 0, 0, 0, 0, 80, 10, 0, 80, 10, 0, 160, 0, 0] }, source);
    assert.ok(repeatedPoint.children.every(mesh => Array.from((mesh as Mesh3D).geometry.positions).every(Number.isFinite)), 'duplicate samples retain aligned transport frames');
    destroyNixieSpatialPath(repeatedPoint);
    destroyNixieSpatialPath(edited); destroyNixieSpatialPath(generated);
    assert.equal(source.materials[0]!.destroyed, false, 'shared resource materials survive path replacement');
    const original = new Model3D({ source, autoUpdate: false }); original.destroy({ children: true });
    source.textures.length = 0; source.destroy();
});

test('tube endpoint previews deform existing geometry without rebuilding its topology', () => {
    const path = buildNixieSpatialPath({ id: 'cable', kind: 'tube', points: [0, 0, 4, 50, 20, 6], radius: 2, color: 0x52c7e8, radialSegments: 8 });
    const mesh = path.children[0] as Mesh3D;
    const geometry = mesh.geometry;
    assert.equal(geometry.dynamic, true);
    const indices = geometry.indexBuffer.data;
    const before = Array.from(geometry.positions);
    deformNixieSpatialPath(path, [5, 10, 15], [20, 25, 30]);
    assert.equal(mesh.geometry, geometry);
    assert.equal(geometry.indexBuffer.data, indices);
    assertClose(Array.from(geometry.positions.slice(0, 3)), before.slice(0, 3).map((value, axis) => value + [5, 10, 15][axis]!));
    const last = geometry.positions.length - 3;
    assertClose(Array.from(geometry.positions.slice(last)), before.slice(last).map((value, axis) => value + [20, 25, 30][axis]!));
    deformNixieSpatialPath(path, [0, 0, 0], [0, 0, 0]);
    assertClose(Array.from(geometry.positions), before);
    destroyNixieSpatialPath(path);
});

test('spring sway animates retained interior vertices while pinning both endpoints', () => {
    const path = buildNixieSpatialPath({ id: 'cable', kind: 'tube', points: [0, 0, 4, 50, 0, 2, 100, 0, 4],
        radius: 2, color: 0x191919, radialSegments: 8,
        motion: { kind: 'spring-sway', amplitude: 8, frequency: 0.5, phase: 0.8 } });
    const mesh = path.children[0] as Mesh3D;
    const before = Array.from(mesh.geometry.positions);
    const indices = mesh.geometry.indexBuffer.data;
    for (let frame = 0; frame < 90; frame++) {
        assert.equal(advanceNixieSpatialPathMotion(path, 1000 / 60), true);
    }
    assert.equal(mesh.geometry.indexBuffer.data, indices);
    assertClose(Array.from(mesh.geometry.positions.slice(0, 3)), before.slice(0, 3));
    const midpointOffset = (8 + 1) * 3;
    assert.ok(Math.hypot(...Array.from(mesh.geometry.positions.slice(midpointOffset, midpointOffset + 3))
        .map((value, axis) => value - before[midpointOffset + axis]!)) > 0.5);
    const lastRingOffset = (3 - 1) * (8 + 1) * 3;
    assertClose(Array.from(mesh.geometry.positions.slice(lastRingOffset, lastRingOffset + 3)),
        before.slice(lastRingOffset, lastRingOffset + 3));
    destroyNixieSpatialPath(path);
});

test('moving an endpoint propagates spring motion through the cable interior', () => {
    const points = Array.from({ length: 9 }, (_, index) => [index * 12.5, 0, 4]).flat();
    const path = buildNixieSpatialPath({ id: 'cable', kind: 'tube', points,
        radius: 2, color: 0x191919, radialSegments: 8,
        motion: { kind: 'spring-sway', amplitude: 0, frequency: 0.5 } });
    const mesh = path.children[0] as Mesh3D;
    const before = Array.from(mesh.geometry.positions);
    deformNixieSpatialPath(path, [0, 0, 0], [0, 0, 0]);
    deformNixieSpatialPath(path, [0, 0, 0], [0, 24, 0]);

    const midpointOffset = 4 * (8 + 1) * 3;
    assertClose(Array.from(mesh.geometry.positions.slice(midpointOffset, midpointOffset + 3)),
        before.slice(midpointOffset, midpointOffset + 3));
    const endOffset = 8 * (8 + 1) * 3;
    assertClose(Array.from(mesh.geometry.positions.slice(endOffset, endOffset + 3)),
        before.slice(endOffset, endOffset + 3).map((value, axis) => value + [0, 24, 0][axis]!));

    for (let frame = 0; frame < 20; frame++) {
        advanceNixieSpatialPathMotion(path, 1000 / 60);
    }
    const movingMidpoint = Array.from(mesh.geometry.positions.slice(midpointOffset, midpointOffset + 3));
    assert.ok(movingMidpoint[1]! > before[midpointOffset + 1]!, 'endpoint movement reaches the cable interior');

    for (let frame = 0; frame < 360; frame++) {
        advanceNixieSpatialPathMotion(path, 1000 / 60);
    }
    assertClose(Array.from(mesh.geometry.positions.slice(midpointOffset, midpointOffset + 3)),
        before.slice(midpointOffset, midpointOffset + 3).map((value, axis) => value + [0, 12, 0][axis]!), 0.5);
    destroyNixieSpatialPath(path);
});
