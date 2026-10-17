import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSpatialSharedParts, sharedModelPath, referencedSharedParts, mergeSharedPartPublications } from './spatial-shared-parts.mjs';
const fixture = () => ({ structure: { id: 'facilityrefinery1' }, render: { clipFloor: true, clipBounds: [1] },
    assets: { meshes: [{ id: 'connector', exportUrl: 'War/Content/Meshes/Structures/PowerLineAttachment.glb' }], materials: [] },
    scene: { roots: [{ id: 'parent', unrealLocationCentimeters: [1, 2, 3], children: [
        { id: 'source', meshId: 'connector', unrealRotationDegrees: [23, -47, 61], children: [] }] }] } });
const options = (meshHash = 'mesh', root = '/first') => ({ dependencies: { scene: async () => ({ mesh: [root + '/mesh.glb', meshHash], material: [root + '/material.json', 'material'] }) }, settings: { geometryProfile: 'lossless' } });
test('canonical identity includes content and settings while preserving source placement', async () => {
    const input = fixture(), result = await prepareSpatialSharedParts('facilityrefinery1', input, options());
    assert.equal(result.parts.length, 1);
    assert.deepEqual(result.document.scene.roots[0].unrealLocationCentimeters, [1, 2, 3]);
    assert.deepEqual(result.document.scene.roots[0].children[0].unrealRotationDegrees, [23, -47, 61]);
    assert.equal(input.scene.roots[0].children[0].spatialSharedPart, undefined);
    assert.deepEqual(result.parts[0].canonical.scene.roots[0].location, [0, 0, 0]);
    assert.equal(result.parts[0].canonical.render.clipFloor, false);
    assert.equal(result.parts[0].canonical.render.clipBounds, undefined);
    assert.equal(result.parts[0].id, (await prepareSpatialSharedParts('facilitycrane', input, options('mesh', '/other'))).parts[0].id);
    assert.notEqual(result.parts[0].id, (await prepareSpatialSharedParts('facilitycrane', input, options('changed'))).parts[0].id);
});
test('trial remains bounded and rejects unsupported pose instead of sharing it', async () => {
    const input = fixture();
    assert.equal((await prepareSpatialSharedParts('other', input, options())).document, input);
    input.scene.roots[0].children[0].pose = {};
    await assert.rejects(prepareSpatialSharedParts('facilityrefinery1', input, options()), /unposed static/);
});
test('canonical paths and manifest closure stay independent of asset ownership', () => {
    assert.equal(sharedModelPath('shared.' + 'a'.repeat(64)), 'shared/models/' + 'a'.repeat(64) + '.glb');
    assert.throws(() => sharedModelPath('../unsafe'));
    assert.deepEqual(referencedSharedParts({ assets: { one: { modelParts: { parts: [{ resourceId: 'part' }] } } },
        sharedParts: { used: { resourceId: 'part' }, unused: { resourceId: 'other' } } }), { used: { resourceId: 'part' } });
});

test('unrelated host materials do not split canonical identity', async () => {
    const first = fixture(), second = fixture();
    second.assets.materials.push({ id: 'unrelated', sourcePath: 'host-only.json' });
    second.assets.meshes[0].id = 'qualified-source-id';
    second.scene.roots[0].children[0].meshId = 'qualified-source-id';
    const left = await prepareSpatialSharedParts('facilityrefinery1', first, options());
    const right = await prepareSpatialSharedParts('facilitycrane', second, options());
    assert.equal(left.parts[0].id, right.parts[0].id);
    assert.deepEqual(right.parts[0].canonical.assets.materials, []);
});
test('incremental publication restores prepassed dependencies for later distinct hosts', () => {
    const publications = { a: { resourceId: 'first' }, b: { resourceId: 'second' } };
    const manifest = { assets: { one: { modelParts: { parts: [{ resourceId: 'first' }] } } }, sharedParts: {} };
    manifest.sharedParts = mergeSharedPartPublications(manifest, publications);
    assert.deepEqual(Object.keys(manifest.sharedParts), ['a']);
    manifest.assets.two = { modelParts: { parts: [{ resourceId: 'second' }] } };
    manifest.sharedParts = mergeSharedPartPublications(manifest, publications);
    assert.deepEqual(Object.keys(manifest.sharedParts), ['a', 'b']);
});
