import assert from 'node:assert/strict';
import test from 'node:test';
import { spatialConnectorProfile, prepareSpatialConnectorScene } from './spatial-connector-profiles.mjs';

test('overhead roles follow exported geometry identities even when Blender reorders them', () => {
    const document = { meshes: [{ name: 'Pipelineoverhead.001' }, { name: 'Pipelineoverhead.002' }, { name: 'PipelineoverheadConnect.001' }],
        nodes: [{ name: 'back', mesh: 0 }, { name: 'front', mesh: 1 }, { name: 'span', mesh: 2 }] };
    const exported = { meshParts: [{ name: 'back', origin: [70.4,0,0] }, { name: 'front', origin: [185.6,0,0] }, { name: 'span', origin: [70.4,0,0] }] };
    const scene = { scene: { roots: [{ name: 'FrontSocket', unrealLocationCentimeters: [800,0,0] }] } };
    const profile = spatialConnectorProfile('facilitypipeoverhead', document, exported, scene);
    assert.equal(profile.parts.span.meshIndex, 2); assert.equal(profile.parts.start.meshIndex, 0);
    assert.deepEqual(profile.endOrigin, [256,-0,0]);
    assert.throws(() => spatialConnectorProfile('facilitypipeoverhead', { ...document, meshes: [] }, exported, scene), /Missing spatial/);
});

test('profiles recover native span length and include a missing minimum-length fence prototype without editing input', () => {
    const input = { scene: { roots: [{ id: 'overhead:spline-mesh-0', name: 'PipelineoverheadConnect', scale: [1.3,1,1], children: [] }] }, assets: { meshes: [] } };
    const copy = structuredClone(input);
    const prepared = prepareSpatialConnectorScene('barbedwirewallspline', input);
    assert.equal(prepared.scene.roots[0].scale[0], 1);
    assert.equal(prepared.assets.meshes[0].id, 'spatial-fence-middle');
    assert.deepEqual(input, copy);
});

test('road cap roles follow their exported positions when mesh order changes', () => {
    const document = {
        meshes: ['FacilityRoadEnd.002', 'FacilityRoad_Test.001', 'FacilityRoadEnd.001']
            .map((name, index) => ({ name, primitives: [{ attributes: { POSITION: index } }] })),
        nodes: [{ name: 'front', mesh: 0 }, { name: 'body', mesh: 1 }, { name: 'back', mesh: 2 }],
        accessors: [{ min: [2.25] }, { min: [-2.25] }, { min: [-6.75] }],
    };
    const exported = { meshParts: [{ name: 'front', origin: [288, 0, 1.6] },
        { name: 'body', origin: [144, 0, 1.6] }, { name: 'back', origin: [144, 0, 1.6] }] };
    assert.deepEqual(spatialConnectorProfile('facilityroad', document, exported).parts, {
        start: { meshIndex: 2, origin: [144, 0, 1.6] },
        end: { meshIndex: 0, origin: [288, 0, 1.6] },
        span: { meshIndex: 1, origin: [144, 0, 1.6] },
    });
});

test('Dragon’s Teeth export fills in marker prototypes missing from the sample scene', () => {
    const input = { scene: { roots: [] }, assets: { meshes: [] } };
    const prepared = prepareSpatialConnectorScene('tankstopsplinet3', input);
    const names = ['TankStopT3_1', 'TankStopT3_2', 'TankStopT3_3', 'TankStopT3_4'];
    assert.deepEqual(prepared.scene.roots.map(node => node.name), names);
    assert.deepEqual(prepared.assets.meshes.map(mesh => mesh.sourcePath), names.map(name => `War/Content/Meshes/Pickups/${name}.glb`));
    assert.deepEqual(input.scene.roots, []);
    const document = { meshes: names.toReversed().map(name => ({ name: name + '.001' })),
        nodes: names.toReversed().map((name, mesh) => ({ name, mesh })) };
    const exported = { meshParts: names.map(name => ({ name, origin: [0, 0, 0] })) };
    assert.deepEqual(Object.values(spatialConnectorProfile('tankstopsplinet3', document, exported).parts)
        .map(part => part.meshIndex), [3, 2, 1, 0]);
});
