import test from 'node:test';
import assert from 'node:assert/strict';
import native from '../authoring/native-howitzer-surfaces.json' with { type: 'json' };
import { restoreNativeHowitzerSurfaces } from '../runtime/native-howitzer-surfaces.mjs';

test('howitzer surface maps preserve authored color, UVs and existing material bindings', () => {
    const [{ material: source, albedo, packed, resource }] = native.materials;
    const material = {
        pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 }, metallicFactor: 0, roughnessFactor: .94 },
        extras: { foxholeMaterialSource: source, foxholeAlbedoSource: albedo },
    };
    const unrelated = structuredClone(material);
    unrelated.extras.foxholeMaterialSource = 'Other/Howitzer01.uasset';
    const doc = { materials: [material, unrelated], images: [{ uri: 'color.webp' }], textures: [{ source: 0, sampler: 2 }] };
    const base = 'https://fixture.test/world/';
    assert.deepEqual(restoreNativeHowitzerSurfaces(doc, base), [resource]);
    assert.deepEqual(doc.images, [{ uri: 'color.webp' }, { uri: base + resource.path }]);
    assert.deepEqual(doc.textures[1], { source: 1, sampler: 2 });
    assert.deepEqual(material.pbrMetallicRoughness, {
        baseColorTexture: { index: 0, texCoord: 1 }, metallicRoughnessTexture: { index: 1, texCoord: 1 },
        metallicFactor: 1, roughnessFactor: 1,
    });
    assert.equal(material.extras.foxholePackedSurfaceSource, packed);
    assert.equal(unrelated.pbrMetallicRoughness.metallicFactor, 0);
    assert.deepEqual(restoreNativeHowitzerSurfaces(doc, base), []);
});
