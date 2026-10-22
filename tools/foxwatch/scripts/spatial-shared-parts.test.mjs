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

test('four bounded bunker hosts repeat one canonical wall with distinct authored placements', async () => {
    const input = fixture();
    input.assets.meshes[0].exportUrl = 'War/Content/Meshes/Structures/FortTrenches/FortT2Wall01.glb';
    const wall = input.scene.roots[0].children[0];
    input.scene.roots[0].children.push({ ...structuredClone(wall), id: 'mirrored-wall', scale: [-1, 1, 1],
        unrealLocationCentimeters: [250, -250, -160], unrealRotationDegrees: [0, 90, 0] });
    const canonical = new Set();
    for (const host of ['fortt2', 'fortcornert2', 'mgait2', 'atgunait2']) {
        const result = await prepareSpatialSharedParts(host, input, options());
        assert.equal(result.parts.length, 2);
        assert.deepEqual(result.document.scene.roots[0].children[1].scale, [-1, 1, 1]);
        assert.deepEqual(result.parts.map(part => part.nodeName), ['shared-part-0000', 'shared-part-0001']);
        result.parts.forEach(part => canonical.add(part.id));
    }
    assert.equal(canonical.size, 1);
    assert.equal((await prepareSpatialSharedParts('fortt3', input, options())).parts.length, 0);
});
test('shared source subtrees fail explicitly instead of dropping authored children', async () => {
    const input = fixture();
    input.scene.roots[0].children[0].children.push({ id: 'attached-model', meshId: 'other', children: [] });
    await assert.rejects(prepareSpatialSharedParts('facilityrefinery1', input, options()), /static source leaf/);
});

test('posed stationary cranes share geometry across catalog hosts while retaining spawn transforms',async()=>{
 const input=fixture();input.assets.meshes[0].exportUrl='War/Content/Meshes/Structures/SK_StaticCrane.glb';
 const node=input.scene.roots[0].children[0];node.pose={type:'foxhole-bone-pose',bones:[{name:'arm',rotationQuaternion:[0,0,0,1]}]};
 node.children=[{id:'audio-helper',children:[]}];
 const a=await prepareSpatialSharedParts('refinery',input,options()),b=await prepareSpatialSharedParts('staticcrane',input,options());
 assert.equal(a.parts.length,1);assert.equal(a.parts[0].id,b.parts[0].id);
 assert.deepEqual(a.parts[0].canonical.scene.roots[0].pose,node.pose);
 assert.deepEqual(a.document.scene.roots[0].children[0].unrealRotationDegrees,node.unrealRotationDegrees);
 assert.equal(a.document.scene.roots[0].children[0].spatialSharedPart.posed,true);
 node.pose.bones[0].rotationQuaternion=[0,0,1,0];
 assert.notEqual((await prepareSpatialSharedParts('seaport',input,options())).parts[0].id,a.parts[0].id);
});
