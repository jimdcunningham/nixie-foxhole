import assert from 'node:assert/strict';
import test from 'node:test';
import { Container3D, Geometry3D, Material3D, Scene3DSource } from '@pixi/3d';
import type { Mesh3D } from '@pixi/3d';
import { describeFoxholeSpatialRailDeck, NixieFoxholeRailBed, resolveFoxholeRailBedProfile,
    resolveFoxholeRailBedSections, foxholeRailPresentation } from '../../app/utils/spatial-foxhole-rail-bed.ts';
import { createFoxholeRailJunctionCutout } from '../../app/utils/spatial-foxhole-rail-junction.ts';
import { sampleSpatialCameraElevation } from '#nixie-internal/app/plugins/nixie/scene-v2/spatial-camera-surface.ts';
import { registerNixieInternalSceneV2Adapter } from '#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts';
import { registerNixieSceneV2ModelAnchor } from '#nixie-internal/app/plugins/nixie/scene-v2/spatial-model-resource.ts';
import { destroyNixieSpatialPath } from '#nixie-internal/app/plugins/nixie/scene-v2/spatial-path-model.ts';

const small = resolveFoxholeRailBedProfile([
    'SmallGaugeTrack_Trackbed01.001', 'SmallGaugeTrack_Trackbed03.001',
    'SmallGaugeTrack_Trackbed02side.001', 'SmallGaugeTrack_Trackbed02.001',
], true)!;
const standard = resolveFoxholeRailBedProfile([
    'Railway_Trackbed_01.001', 'Railway_Trackbed_02.001', 'Railway_Trackbed_03.001',
], false)!;
const zero = [0, 0, 0];
const span = (meshIndex: number, start: number, end: number) => ({ meshIndex, start, end });

test('raised rail walls select native bed meshes only along unsupported portions', () => {
    const result = resolveFoxholeRailBedSections([0, 0, 0, 48, 0, 0, 96, 0, 0], small, zero, zero,
        ([x]) => x < 32 ? 0 : x < 64 ? 20 : 45);
    assert.deepEqual(result, { length: 96, sections: [
        span(small.flat, 0, 32),
        span(small.raised, 32, 64),
        span(small.tall, 64, 96),
    ] });
    assert.equal(resolveFoxholeRailBedProfile(['SmallGaugeTrack_Trackbed01'], true), undefined);
});

test('rail stations follow endpoint edits and check each shoulder on sloping ground', () => {
    const route = [0, 0, 0, 64, 0, 0];
    const supported = resolveFoxholeRailBedSections(route, standard, zero, zero, () => 0);
    assert.deepEqual(supported.sections, [span(standard.flat, 0, 64)]);
    const raised = resolveFoxholeRailBedSections(route, standard, zero, [0, 0, 64], ([, , z]) => z);
    assert.deepEqual(raised.sections, [
        span(standard.flat, 0, 16),
        span(standard.raised, 16, 64),
    ]);
    const hillside = resolveFoxholeRailBedSections(route, standard, zero, zero, ([, y]) => y > 0 ? 30 : 0);
    assert.deepEqual(hillside.sections, [span(standard.tall, 0, 64)]);
});

test('terrain-only supports ignore water and use the flat floor when no height is available', () => {
    const surface = { groundElevation: () => 30, waterElevation: () => 30, terrainElevation: () => -40 };
    assert.equal(sampleSpatialCameraElevation(0, 0, [surface]), 30);
    assert.equal(sampleSpatialCameraElevation(0, 0, [surface], { terrainOnly: true }), -40);
    const waterOnly = { ...surface, terrainElevation: () => null };
    assert.equal(sampleSpatialCameraElevation(0, 0, [waterOnly], { terrainOnly: true }) ?? 0, 0);
});

test('foundation rails supply their transformed deck footprint for junction clipping', () => {
    const pose = new Container3D();
    const node = { id: 'rail-span', kind: 'model-path' as const, resourceId: 'foxhole.model.smallrailtracksplinefoundation',
        meshIndex: 0, points: [0, 0, 30, 96, 0, 30], unitsPerMetre: 32 };
    const deck = describeFoxholeSpatialRailDeck(node, pose.getGlobalTransform())!;
    assert.equal(describeFoxholeSpatialRailDeck({ ...node, resourceId: 'example.unknown' }, pose.getGlobalTransform()), undefined);
    assert.deepEqual(deck, { points: [[0, 0, 30], [96, 0, 30]], halfWidth: 38 });
    pose.destroy();
});

test('the spatial bed swaps actual meshes after an elevation change and retains them while ground is stable', () => {
    const names = ['SmallGaugeTrack_Trackbed01', 'SmallGaugeTrack_Trackbed02', 'SmallGaugeTrack_Trackbed03', 'SmallGaugeTrack_Trackbed02side'];
    const source = new Scene3DSource({ nodes: names.map((label, index) => ({ label, children: [], geometry: index, materials: index === 1 ? [0, 1] : [0] })),
        scenes: [{ children: [0, 1, 2, 3] }], defaultScene: 0 });
    const geometry = () => new Geometry3D({
        positions: new Float32Array([0, 0, -1, 10, 0, -1, 10, 0, 1, 0, 0, 1,
            0, -6, -1, 10, -6, -1, 10, -6, 1, 0, -6, 1]),
        normals: new Float32Array(Array.from({ length: 8 }, () => [0, 1, 0]).flat()),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7]),
    });
    source.geometries.push(...names.map(() => [geometry()]));
    const trim = new Geometry3D({
        positions: new Float32Array([0, 2, -1, 10, 2, -1, 10, 2, 1, 0, 2, 1]),
        normals: new Float32Array(Array.from({ length: 4 }, () => [0, 1, 0]).flat()),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    source.geometries[1]!.push(trim);
    source.materials.push(new Material3D(), new Material3D());
    const json = Buffer.from(JSON.stringify({ materials: [{ name: 'TrainTrackBed' }, { name: 'BridgeTrims' }],
        meshes: names.map((name, index) => ({ name, primitives: (index === 1 ? [0, 1] : [0]).map(material => ({ material })) })) }));
    const header = Buffer.alloc(20);
    header.writeUInt32LE(json.length, 12);
    const stop = registerNixieInternalSceneV2Adapter({ ownerId: 'nixie.foxhole-planner',
        productCapabilities: () => [], rail: foxholeRailPresentation });
    try {
        registerNixieSceneV2ModelAnchor(source, Buffer.concat([header, json]), new Set(['nixie.foxhole-planner']));
    } finally {
        stop();
    }
    const node = { id: 'rail-bed', kind: 'model-path' as const, resourceId: 'foxhole.model.smallrailtrackspline',
        unitsPerMetre: 1, meshIndex: 0, points: [0, 0, 0, 96, 0, 0] };
    const bed = NixieFoxholeRailBed.create(node, source)!;
    const pose = new Container3D();
    const noTerrain = () => null;
    assert.equal(bed.root.children.length, 1);
    assert.equal(bed.sync(pose.getGlobalTransform(), 0, noTerrain, false, []), false);
    pose.position.z = 25;
    assert.equal(bed.sync(pose.getGlobalTransform(), 0, noTerrain, false, []), true);
    assert.equal(bed.root.children.length, 2, 'raised mesh and its repeated side supports');
    const raised = [...bed.root.children];
    assert.equal(bed.sync(pose.getGlobalTransform(), 0, noTerrain, false, []), false);
    assert.deepEqual(bed.root.children, raised);
    assert.equal(bed.sync(pose.getGlobalTransform(), 0, () => 25, true, []), true, 'streamed terrain restores the flat bed');
    assert.equal(bed.root.children.length, 1);
    const neighbors = [{ points: [[0, 40, 25], [96, 40, 25]] as const, halfWidth: 40 }];
    for (const terrain of [() => 25, noTerrain]) {
        assert.equal(bed.sync(pose.getGlobalTransform(), 0, terrain, true, neighbors), true);
        let foundExposedWall = false;
        for (const part of bed.root.children) {
            for (const mesh of part.children) {
                const positions = (mesh as Mesh3D).geometry.positions!;
                for (let i = 0; i < positions.length; i += 3) {
                    if (positions[i + 2]! >= -1e-6) continue;
                    assert.ok(positions[i + 1]! <= 1e-6, 'no wall fragment inside the neighboring foundation');
                    foundExposedWall ||= positions[i + 1]! < -1e-6;
                }
            }
        }
        assert.ok(foundExposedWall);
    }
    const cap = (bed.root.children[0]!.children[1] as Mesh3D).geometry.bounds3D;
    assert.ok(cap.max.y <= 1e-6 && cap.min.y < 0, 'horizontal metal trim is removed inside the join');
    const ballast = (bed.root.children[0]!.children[0] as Mesh3D).geometry.bounds3D;
    assert.ok(ballast.max.y > 0, 'the ballast stays continuous across the switch');
    const retained = bed.root.children[0]!;
    const ballastGeometry = (retained.children[0] as Mesh3D).geometry;
    const savedPositions = ballastGeometry.positions!.slice();
    bed.retarget({ ...node, points: [0, 0, 0, 48, -25, 0, 96, -30, 0] });
    assert.equal(bed.preview(), true);
    assert.equal(bed.root.children[0], retained);
    assert.ok(ballastGeometry.bounds3D.max.y > 25, 'retained geometry follows the curved drag without clipping again');
    assert.equal(bed.preview(), false);
    bed.retarget(node);
    bed.sync(pose.getGlobalTransform(), 0, noTerrain, false, neighbors);
    assert.equal(bed.root.children[0], retained, 'canceling reuses the original precise mesh');
    assert.deepEqual(ballastGeometry.positions, savedPositions);
    bed.retarget({ ...node, points: [0, 0, 0, 48, -25, 0, 96, -30, 0] });
    assert.equal(bed.preview(), true);
    assert.equal(bed.root.children[0], retained);
    assert.equal(bed.sync(pose.getGlobalTransform(), 0, noTerrain, false, neighbors), true);
    assert.notEqual(bed.root.children[0], retained, 'release replaces the approximation with a precise cut for the new route');
    destroyNixieSpatialPath(bed.root);
    pose.destroy();
});

test('an angled junction cuts the main wall at the physical intersection as the branch handle moves', () => {
    const pose = new Container3D();
    pose.position.z = 25;
    const vertices = () => [5, -5].flatMap(y => [[0, y, 0], [96, y, 0], [96, y, -6], [0, y, -6]])
        .map(([x, y, z]) => [x!, y!, z!, 0, 1, 0, 0, 0, 1, 0, 0, 1, x! / 96]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    for (const slope of [0.1, 0.12, 0.2, 0.21]) {
        const points = [0, 12, 24, 48, 96].map(x => [x, 8 + x * slope, 25] as const);
        const cutout = createFoxholeRailJunctionCutout([{ points, halfWidth: 6 }],
            pose.getGlobalTransform(), zero, zero, true)!;
        const result = cutout(vertices(), indices, weight => [weight * 96, 0, 0], 0);
        const inside = result.vertices.filter(v => v[1] === 5);
        const outside = result.vertices.filter(v => v[1] === -5);
        const pinch = (6 * Math.hypot(1, slope) - 3) / slope;
        const cutAt = Math.min(...inside.map(v => v[0]!));
        assert.ok(Math.abs(cutAt - pinch) < 1e-6, `slope ${slope}: cut at ${cutAt}, expected ${pinch}`);
        assert.equal(Math.min(...outside.map(v => v[0]!)), 0);
    }
    const overpass = createFoxholeRailJunctionCutout([{ points: [[0, 8, 60], [96, 18, 60]], halfWidth: 6 }],
        pose.getGlobalTransform(), zero, zero, true)!;
    assert.equal(overpass(vertices(), indices, weight => [weight * 96, 0, 0], 0).indices.length, indices.length);
    pose.destroy();
});
