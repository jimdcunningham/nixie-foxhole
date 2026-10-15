import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { SpatialDependencies, SpatialModelCache } from './spatial-model-cache.mjs';

async function fixture(t) {
    const root = await mkdtemp(resolve(tmpdir(), 'foxwatch-spatial-cache-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const put = async (name, value) => {
        const path = resolve(root, name); await mkdir(resolve(path, '..'), { recursive: true });
        await writeFile(path, typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value); return path;
    };
    return { root, put };
}

test('source, material, external buffers, texture and scene edits invalidate complete model groups', async t => {
    const { root, put } = await fixture(t);
    const scene = { assets: { meshes: [{ sourcePath: 'mesh.gltf', materialSidecarNameOverride: 'override' }] }, scene: { roots: [] } };
    await put('mesh.gltf', { materials: [{ name: 'paint' }], images: [{ uri: 'embedded.png' }], buffers: [{ uri: 'mesh.bin' }] });
    await put('embedded.png', 'image'); await put('mesh.bin', 'geometry');
    await put('paint.json', { Textures: { Albedo: 'War/paint.paint' } });
    await put('override.json', { Textures: {} }); await put('War/paint.png', 'texture');
    const source = await put('exporter.py', 'version1'); const output = await put('model.glb', 'model');
    const cache = await SpatialModelCache.create(resolve(root, 'cache'), [source], { blender: '5.1' });
    const identity = async () => cache.identity('asset', { scene, dependencies: await new SpatialDependencies(root).scene(scene) }, { profile: 'compact' }, [output]);
    const original = await identity(); await cache.record(original, { asset: { codeName: 'Asset' }, resources: {} });
    assert.ok(await cache.lookup(await identity()));
    for (const file of ['mesh.bin', 'embedded.png', 'War/paint.png', 'paint.json', 'override.json', 'mesh.gltf']) {
        const bytes = await readFile(resolve(root, file));
        await writeFile(resolve(root, file), file.endsWith('.json') || file.endsWith('.gltf') ? Buffer.concat([bytes, Buffer.from(' ')]) : 'changed');
        await utimes(resolve(root, file), new Date(0), new Date(0));
        assert.equal(await cache.lookup(await identity()), null, file);
        await writeFile(resolve(root, file), bytes);
    }
    scene.scene.roots.push({ visible: false }); assert.equal(await cache.lookup(await identity()), null);
    scene.scene.roots.pop();
    await writeFile(output, 'broken'); assert.equal(await cache.lookup(original), null);
    await writeFile(output, 'model'); assert.ok(await cache.lookup(original));
    await writeFile(original.metadataPath, '{}'); assert.equal(await cache.lookup(original), null);
    await cache.record(original, { asset: {} }); await rm(output); assert.equal(await cache.lookup(original), null);
    await writeFile(output, 'model'); await writeFile(source, 'version2');
    const updated = await SpatialModelCache.create(resolve(root, 'cache'), [source], { blender: '5.1' });
    assert.equal(await updated.lookup(updated.identity('asset', { scene, dependencies: await new SpatialDependencies(root).scene(scene) }, { profile: 'compact' }, [output])), null);
});

test('ambiguous material basenames and missing qualified sidecars never select a different material', async t => {
    const { root, put } = await fixture(t);
    await put('one/paint.json', '{}'); await put('two/paint.json', '{}');
    const dependencies = new SpatialDependencies(root);
    assert.equal(await dependencies.material('paint'), null);
    assert.equal(await dependencies.material('missing/paint'), null);
    assert.equal(await dependencies.material('one/paint.uasset'), resolve(root, 'one/paint.json'));
});

function glb(document, binary) {
    let json = Buffer.from(JSON.stringify(document)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
    const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + json.length + bin.length, 8); header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, json, binHeader, bin]);
}

test('publisher reuses verified outputs, restores metadata, bypasses cache and records failed runs', async t => {
    const { root, put } = await fixture(t);
    const id = 'facilitytransferresource';
    const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
        buffers: [{ byteLength: positions.length + png.length }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: png.length }],
        images: [{ bufferView: 1, mimeType: 'image/png' }], textures: [{ source: 0 }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }] };
    const raw = glb(document, Buffer.concat([positions, png]));
    await put('sources/mesh.glb', raw); await put(`raw/${id}.glb`, raw);
    await put(`raw/${id}.glb.json`, { boundsCenterMeters: [0, 0, 0], sceneDimensions: { width: 32, height: 32, depth: 32 }, triangles: 1 });
    await put(`scenes/${id}/scene.json`, { render: {}, scene: { roots: [{ meshId: 'mesh', children: [] }] }, assets: { meshes: [{ sourcePath: 'mesh.glb' }] } });
    await put('output/manifest.v1.json', { assets: [{ id, codeName: 'FacilityTransferResource', categoryId: 'facility' }] });
    // The real policy validates every authored ID, so supply the real catalog with the fixture entry.
    const catalog = JSON.parse(await readFile(new URL('../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
    await put('output/manifest.v1.json', catalog);
    const report = resolve(root, 'timing.json');
    const cli = fileURLToPath(new URL('./publish-spatial-models.mjs', import.meta.url));
    const args = [cli, '--only', id, '--repack-existing', '--geometry-profile=lossless', '--asset-root', resolve(root, 'sources'),
        '--scene-root', resolve(root, 'scenes'), '--temporary-root', resolve(root, 'raw'), '--cache-root', resolve(root, 'cache'),
        '--output-root', resolve(root, 'output'), '--timing-report', report];
    const run = extra => promisify(execFile)(process.execPath, [...args, ...extra ?? []], { windowsHide: true });
    const result = async () => JSON.parse(await readFile(report, 'utf8'));
    await run(); assert.equal((await result()).exported, 1);
    const packed = await readFile(resolve(root, `output/models/${id}.glb`));
    await put('output/models/manifest.v1.json', { schemaVersion: 1, assets: {}, resources: {} });
    await run(); assert.equal((await result()).reused, 1);
    assert.ok(JSON.parse(await readFile(resolve(root, 'output/models/manifest.v1.json'), 'utf8')).assets[id]);
    assert.deepEqual(await readFile(resolve(root, `output/models/${id}.glb`)), packed);
    await run(['--force-render']); assert.equal((await result()).exported, 1);
    await put(`output/models/${id}.glb`, 'corrupt'); await run(); assert.equal((await result()).exported, 1);
    await rm(resolve(root, `raw/${id}.glb`)); await assert.rejects(run()); assert.equal((await result()).failed, 1);
    assert.ok((await result()).assets[0].error);
    assert.ok((await result()).totalMs > 0);
    // A failure does not prevent later selected assets from being checked; repeated
    // --only flags match the runner's actual targeted-refresh argument shape.
    await put('scenes/powerline/scene.json', { scene: { roots: [] }, assets: { meshes: [] } });
    await assert.rejects(run(['--only', 'powerline']));
    assert.equal((await result()).failed, 1);
    assert.equal((await result()).skipped, 1);
    assert.equal((await result()).assets[1].id, 'powerline');
    await rm(resolve(root, `scenes/${id}/scene.json`));
    await run(); assert.equal((await result()).skipped, 1);
    assert.equal((await result()).assets[0].reason, 'No extracted scene');
});

test('suffix lookup hashes the exact source basename used by Blender', async t => {
    const { root, put } = await fixture(t);
    await put('a/barfoo.glb', 'unrelated');
    await put('b/foo.glb', 'actual mesh');
    assert.equal(await new SpatialDependencies(root).asset('foo.glb'), resolve(root, 'b/foo.glb'));
});
