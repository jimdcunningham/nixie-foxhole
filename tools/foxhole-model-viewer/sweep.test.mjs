import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Geometry3D, Mesh3D, Material3D, Ray, Vector3 } from '@pixi/3d';
import { intersectRayGeometry } from '@pixi/3d/dist/events/intersectRayGeometry.mjs';
import { createHitResult3D } from '@pixi/3d/dist/events/HitResult3D.mjs';
import { buildNixieSpatialSweepGeometry } from '#nixie-host/app/plugins/nixie/scene-v2/spatial-sweep-geometry.ts';
import { sampleFoxholeSceneV2Connector } from '../../extensions/foxhole-planner/src/scene-v2-connector-path.ts';
import { createFoxholeSceneV2SplineProductData } from '../../extensions/foxhole-planner/src/scene-v2-connector-products.ts';

const fixture = JSON.parse(await readFile(new URL('./spline-fixture.json', import.meta.url)));
const point = (x, y, z = 0) => ({ x, y, z });
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const sub = (a, b) => a.map((value, index) => value - b[index]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const slice3 = (array, vertex) => Array.from(array.subarray(vertex * 3, vertex * 3 + 3));

test('sweeps preserve diameter, outward winding, finite normals/tangents and UV repeat distance', () => {
    const paths = [[point(0, 0), point(10, 0)], [point(0, 0), point(0, 0, 5), point(0, 2, 8)],
        Array.from({ length: 65 }, (_, i) => point(i / 4, Math.sin(i / 8) * 2, i / 32))];
    for (const points of paths) {
        const data = buildNixieSpatialSweepGeometry(points, { radius: 0.12, radialSegments: 24, textureRepeatLength: 2 });
        for (const array of [data.positions, data.normals, data.tangents, data.uvs]) assert.ok(array.every(Number.isFinite));
        assert.ok(data.indices.every(index => index < data.positions.length / 3));
        for (let ring = 0; ring < points.length; ring++) for (let side = 0; side <= 24; side++) {
            const vertex = ring * 25 + side, position = slice3(data.positions, vertex), normal = slice3(data.normals, vertex);
            const tangent = Array.from(data.tangents.subarray(vertex * 4, vertex * 4 + 3));
            assert.ok(Math.abs(Math.hypot(...sub(position, Object.values(points[ring]))) - 0.12) < 2e-6);
            assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6);
            assert.ok(Math.abs(dot(normal, tangent)) < 1e-6);
        }
        assert.ok(Math.abs(data.uvs[(points.length - 1) * 25 * 2] - data.pathLength / 2) < 1e-6);
        for (let i = 0; i < data.indices.length; i += 3) {
            const [a, b, c] = Array.from(data.indices.subarray(i, i + 3));
            const face = cross(sub(slice3(data.positions, b), slice3(data.positions, a)), sub(slice3(data.positions, c), slice3(data.positions, a)));
            assert.ok(dot(face, slice3(data.normals, a)) > 0, `triangle ${i / 3} faces outward`);
        }
    }
});

test('the installed beta instantiates and picks curved 3D geometry away from the original chord', () => {
    const path = Array.from({ length: 65 }, (_, i) => point(i / 8, Math.sin(i / 64 * Math.PI) * 3, 0.3));
    const data = buildNixieSpatialSweepGeometry(path, { radius: 0.12 });
    const geometry = new Geometry3D({ ...data, quantizeNormals: false, quantizeTangents: false });
    const mesh = new Mesh3D({ geometry, material: new Material3D(), hitVolume: geometry, eventMode: 'static' });
    assert.ok(mesh.getLocalBounds().max.y > 3);
    const ray = new Ray(new Vector3(4, 3, 10), new Vector3(0, 0, -1));
    const hit = createHitResult3D();
    assert.ok(intersectRayGeometry(ray, geometry, hit) > 0);
    assert.ok(Math.abs(hit.point.z - 0.42) < 1e-5);
    ray.origin.set(4, 0, 10);
    assert.equal(intersectRayGeometry(ray, geometry, hit), -1, 'empty space on the undeformed chord does not pick');
    mesh.destroy({ geometry: true, material: true });
});

test('real planner samples generate matching endpoints and replacement bounds after edits', () => {
    for (const curveT of [0, 0.5, 1]) for (const [endX, endY, endRotation] of [[320, 0, Math.PI], [320, 96, Math.PI], [256, -128, Math.PI / 2]]) {
        const state = { ...createFoxholeSceneV2SplineProductData('facilitypipe', fixture.connector), endX, endY, endRotation, curveT };
        const sample = sampleFoxholeSceneV2Connector(state, fixture);
        const points = sample.points.map((p, i) => point(p.x / 32, -p.y / 32, 0.3 + sample.lengths[i] / sample.totalLength * 2));
        const data = buildNixieSpatialSweepGeometry(points, { radius: 0.12 });
        assert.ok(Math.hypot(points[0].x, points[0].y, points[0].z - 0.3) < 1e-6);
        assert.ok(Math.hypot(points.at(-1).x - endX / 32, points.at(-1).y + endY / 32, points.at(-1).z - 2.3) < 1e-6);
        const geometry = new Geometry3D(data), mesh = new Mesh3D({ geometry, material: new Material3D() });
        assert.ok(mesh.getLocalBounds().max.z >= 2.3);
        assert.ok(data.pathLength >= Math.hypot(endX / 32, endY / 32, 2) - 1e-6);
        mesh.destroy({ geometry: true, material: true });
    }
});

test('collapsed points are removed and unsafe/cusp inputs are rejected', () => {
    assert.equal(buildNixieSpatialSweepGeometry([point(0, 0), point(0, 0), point(1, 0)], { radius: 0.1 }).ringCount, 2);
    for (const path of [[point(0, 0), point(0, 0)], [point(0, 0), point(NaN, 0)], [point(0, 0), point(1, 0), point(0, 0)],
        Array.from({ length: 2049 }, (_, i) => point(i, 0))]) assert.throws(() => buildNixieSpatialSweepGeometry(path, { radius: 0.1 }));
    assert.throws(() => buildNixieSpatialSweepGeometry([point(0, 0), point(1, 0)], { radius: -1 }));
});
