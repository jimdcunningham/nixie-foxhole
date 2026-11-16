import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSpatialReferenceScene, spatialReferencePackages } from './spatial-reference-models.mjs';

test('meshless physical references use game models without changing their extracted scene', () => {
    const input = { scene: { roots: [] }, assets: { meshes: [] } };
    for (const [id, name] of [['crate', 'ItemCrate'], ['flamebackpackammo', 'FlameAmmo'],
        ['shippable', 'ShippingContainerNormalExposed']]) {
        const result = prepareSpatialReferenceScene(id, input);
        assert.equal(result.scene.roots[0].name, name);
        assert.equal(result.scene.roots[0].meshId, result.assets.meshes[0].id);
        assert.ok(result.assets.meshes[0].sourcePath.endsWith(`/${name}.glb`));
        assert.equal(result.render.materialMode, 'sidecar');
        assert.equal(prepareSpatialReferenceScene(id, result), result);
    }
    assert.deepEqual(input, { scene: { roots: [] }, assets: { meshes: [] } });
    assert.equal(prepareSpatialReferenceScene('other', input), input);
});

test('spatial reference surfaces preserve the decal size and bind the game artwork', () => {
    const input = { scene: { roots: [] }, assets: { meshes: [] } };
    const references = { excavation: 'ShovelIcon', prototypekit: 'PrototypeKitIcon', reservepower: 'ReservePower', oilfield: 'Decal512' };
    for (const [id, name] of Object.entries(references)) {
        const result = prepareSpatialReferenceScene(id, input);
        const [root] = result.scene.roots;
        assert.equal(root.primitive.type, 'spatial_reference_surface');
        assert.ok(root.primitive.texture.endsWith(`/${name}.png`));
        assert.deepEqual(spatialReferencePackages([id]), {
            texturePackagePaths: [root.primitive.texture.slice(0, -4)], meshPackagePaths: [],
        });
        assert.equal(prepareSpatialReferenceScene(id, result), result);
        assert.deepEqual(root.primitive.width, id === 'oilfield' ? 16 : 1);
        assert.equal(root.primitive.plate ?? false, id !== 'oilfield');
    }
    assert.equal(input.scene.roots.length, 0);
    assert.deepEqual(spatialReferencePackages(['tankstopsplinet3']).meshPackagePaths.map(path => path.split('/').at(-1)),
        ['TankStopT3_3', 'TankStopT3_4']);
});
