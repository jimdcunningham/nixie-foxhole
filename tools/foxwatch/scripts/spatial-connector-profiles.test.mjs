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
