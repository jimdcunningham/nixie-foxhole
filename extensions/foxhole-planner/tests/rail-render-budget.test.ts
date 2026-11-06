import assert from 'node:assert/strict';
import test from 'node:test';
import { NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_VERTICES, NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_INDICES,
    parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import { renderFoxholeSceneV2SplineConnector } from '../src/scene-v2-spline-connectors.ts';
import { buildSplineRibbonMeshData } from '../src/spline-ribbon-mesh.ts';

for (const foxholeKey of ['railtracksplinefoundation', 'smallrailtracksplinefoundation']) {
    for (const curved of [false, true]) {
        test(`${foxholeKey} keeps long ${curved ? 'curved' : 'straight'} ribbons within the render plan budget`, () => {
            const data = { foxholeKey, startX: 0, startY: 0, startRotation: 0,
                endX: 5000, endY: curved ? 1000 : 0, endRotation: curved ? Math.PI / 2 : 0,
                minLength: 48, maxLength: 100000, minRadius: 24, maxRadius: 24, maxBuffer: 0, curveT: 1, blueprint: false };
            const nodes = renderFoxholeSceneV2SplineConnector(data, assets[foxholeKey]);
            const plan = { schemaVersion: 1, root: { id: 'root', kind: 'group', children: nodes } };
            assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1(plan));
            const mesh = nodes.find(node => node.id === 'spline-connector-span');
            assert.ok(mesh?.kind === 'mesh', 'the textured track remains visible');
            assert.ok(mesh.positions.length / 2 <= NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_VERTICES);
            assert.ok(mesh.indices.length <= NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_INDICES);
            assert.ok(mesh.indices.every(index => index >= 0 && index < mesh.positions.length / 2));
            assert.ok([...mesh.positions, ...mesh.uvs].every(Number.isFinite));
            const midpoint = (index: number) => ({ x: (mesh.positions[index]! + mesh.positions[index + 2]!) / 2,
                y: (mesh.positions[index + 1]! + mesh.positions[index + 3]!) / 2 });
            const start = midpoint(0), end = midpoint(mesh.positions.length - 4);
            assert.ok(Math.hypot(start.x, start.y) < 0.001, 'start endpoint is preserved');
            assert.ok(Math.hypot(end.x - data.endX, end.y - data.endY) < 0.001, 'end endpoint is preserved');
            assert.equal(mesh.uvs[0], 0);
            assert.ok(mesh.uvs.at(-2)! > 1, 'the texture continues to repeat along the whole track');
        });
    }
}

for (const length of [1022.9999, 1023, 1023.0001, 10000]) {
    test(`bounded ribbon preserves its width, endpoints and material density at ${length}px`, () => {
        const data = buildSplineRibbonMeshData({ spanLayer: { width: 4, height: 16 }, maxSegments: 1023,
            pathSample: { points: [{ x: 0, y: 0 }, { x: length, y: 0 }], lengths: [0, length], totalLength: length } },
        { x: 0, y: 0, rotation: 0 }, { x: length, y: 0, rotation: 0 },
        { minLength: 0, maxLength: 100000, minRadius: 0, maxRadius: 0, maxBuffer: 0, curveT: 1 });
        assert.ok(data);
        assert.ok(data.positions.length / 2 <= NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_VERTICES);
        assert.ok(data.indices.length <= NIXIE_EXTENSION_RENDER_PLAN_MAX_MESH_INDICES);
        assert.equal(data.positions[0], 0);
        assert.ok(Math.abs(data.positions.at(-4)! - length) < 0.001);
        for (let i = 0; i < data.positions.length; i += 4) {
            assert.equal(data.positions[i + 1], 4);
            assert.equal(data.positions[i + 3], -4);
            assert.ok(Math.abs(data.uvs[i]! - data.positions[i]! / 8) < 0.0001);
        }
    });
}

test('the rail budget leaves an already small ribbon unchanged', () => {
    const options = { spanLayer: { width: 4, height: 16 } };
    const start = { x: 0, y: 0, rotation: 0 }, end = { x: 100, y: 20, rotation: 0.1 };
    const constraints = { minLength: 0, maxLength: 100000, minRadius: 0, maxRadius: 0, maxBuffer: 0, curveT: 1 };
    assert.deepEqual(buildSplineRibbonMeshData({ ...options, maxSegments: 1023 }, start, end, constraints),
        buildSplineRibbonMeshData(options, start, end, constraints));
});
