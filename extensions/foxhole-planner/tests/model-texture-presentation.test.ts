import assert from 'node:assert/strict';
import test from 'node:test';
import {MeshoptEncoder} from 'meshoptimizer/encoder';
import {createFoxholeFlagAtlasCatalog} from '../build/model-flag-metadata.ts';
import {buildFoxholeModelTextureTransforms} from '../src/model-texture-presentation.ts';

async function flagGlb(row: 0 | 1, compressed = false, rotation = 0, fullAtlas = false) {
    await MeshoptEncoder.ready;
    const uvs = new Float32Array([0, row * 0.5, 1, fullAtlas ? 1 : (row + 1) * 0.5]);
    const raw = new Uint8Array(uvs.buffer), data = compressed ? MeshoptEncoder.encodeGltfBuffer(raw, 2, 8, 'ATTRIBUTES') : raw;
    const document = {asset: {version: '2.0'}, materials: [{name: 'FlagWindA', pbrMetallicRoughness: {baseColorTexture: {
        index: 0, extensions: {KHR_texture_transform: {rotation, scale: [1, 2]}}}}}],
        meshes: [{primitives: [{material: 0, attributes: {TEXCOORD_0: 0}}]}],
        accessors: [{bufferView: 0, componentType: 5126, type: 'VEC2', count: 2}],
        buffers: [{byteLength: data.length}], bufferViews: [{buffer: 0, byteLength: raw.length,
            ...(compressed ? {extensions: {EXT_meshopt_compression: {buffer: 0, byteOffset: 0, byteLength: data.length, byteStride: 8, count: 2, mode: 'ATTRIBUTES'}}} : {})}]};
    const json = new TextEncoder().encode(JSON.stringify(document)), jsonLength = Math.ceil(json.length / 4) * 4, binaryLength = Math.ceil(data.length / 4) * 4;
    const bytes = new Uint8Array(28 + jsonLength + binaryLength), view = new DataView(bytes.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
    view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20);
    view.setUint32(20 + jsonLength, binaryLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(data, 28 + jsonLength);
    return bytes;
}

test('FoxWatch translates either authored flag row, meshopt UVs and authored rotation into portable offsets', async () => {
    for (const row of [0, 1] as const) for (const compressed of [false, true]) {
        const bytes = await flagGlb(row, compressed, Math.PI / 2), before = bytes.slice();
        const catalog = await createFoxholeFlagAtlasCatalog([{id: 'flag', assetId: 'flag', path: 'flag.glb'}], async () => bytes);
        const metadata = catalog['foxhole.model.flag']![0]!;
        assert.equal(metadata.authoredRow, row);
        assert.deepEqual(metadata, {materialName: 'FlagWindA', authoredRow: row});
        for (const [faction, target] of [['colonial', 0], ['warden', 1]] as const) {
            const policy = buildFoxholeModelTextureTransforms('foxhole.model.flag', catalog, faction)[0]!;
            assert.equal(policy.materialName, 'FlagWindA');
            assert.deepEqual(policy.offset, [0, (target - row) * 0.5], 'the SDK applies source-space offsets before any authored texture transform');
        }
        assert.deepEqual(buildFoxholeModelTextureTransforms('foxhole.model.flag', catalog, 'asset-default'), []);
        assert.deepEqual(buildFoxholeModelTextureTransforms('foxhole.model.flag', undefined, 'warden'), []);
        assert.deepEqual(buildFoxholeModelTextureTransforms('missing', catalog, 'warden'), []);
        assert.deepEqual(buildFoxholeModelTextureTransforms('foxhole.model.flag', catalog, true), []);
        assert.deepEqual(bytes, before);
    }
});

test('flag catalogs include canonical dependencies and reject malformed or conflicting source metadata', async () => {
    const models = [{id: 'base', assetId: 'base', path: 'base.glb', dependencyIds: ['part']}, {id: 'part', assetId: 'part', path: 'part.glb'}];
    const bytes = await flagGlb(0), alternate = await flagGlb(1);
    assert.deepEqual(Object.keys(await createFoxholeFlagAtlasCatalog(models, async () => bytes)), ['foxhole.model.base', 'foxhole.model.part']);
    await assert.rejects(createFoxholeFlagAtlasCatalog(models, async path => path === 'base.glb' ? bytes : alternate), /Conflicting/);
    await assert.rejects(createFoxholeFlagAtlasCatalog(models.slice(0, 1), async () => bytes), /dependency/);
    await assert.rejects(createFoxholeFlagAtlasCatalog(models, async () => new Uint8Array()), /Invalid/);
    assert.deepEqual(await createFoxholeFlagAtlasCatalog([models[1]!], async () => flagGlb(0, false, 0, true)), {}, 'unsupported layouts keep their authored appearance');
    assert.throws(() => buildFoxholeModelTextureTransforms('model', {model: [{materialName: 'flag', authoredRow: 2 as never}]}, 'warden'), /Invalid/);
    assert.throws(() => buildFoxholeModelTextureTransforms('model', {model: [{materialName: '', authoredRow: 0}]}, 'warden'));
});
