import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync} from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {buildAssetPublicationInventory, publicationPath, publicationMedia} from './asset-publication-inventory.mjs';
import {worldRuntimePublicationRoots} from '../../../packages/foxhole-world/publication-roots.mjs';
import {syncCatalogReferences} from '../../../packages/foxhole-world/catalog-references.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-inventory-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const index = {version: 1, format: 'compact-recipes-v1', regions: {}};
    async function write(file, bytes) {await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true}); await fs.writeFile(path.join(root, file), bytes);}
    async function content(bytes, extension = '.bin', compressed = false) {
        const data = compressed ? brotliCompressSync(bytes) : bytes;
        const ref = {path: `content/${compressed ? 'br' : 'raw'}/${hash(data)}/asset${extension}`, hash: hash(data), bytes: data.length, decodedHash: hash(bytes), ...(compressed ? {encoding: 'br'} : {})};
        await write(`world/${ref.path}`, data); return ref;
    }
    async function region(id, refs, {resources = {}, catalogResources = []} = {}) {
        const manifest = await content(json({version: 1, format: index.format, region: id, physicalResources: refs, resources, catalogResources}), '.json', true);
        index.regions[id] = {id, manifest, downloadBytes: refs.reduce((n, r) => n + r.bytes, manifest.bytes), catalogBytes: catalogResources.reduce((n, r) => n + r.bytes, 0)};
        await write('world/index.json', json(index)); return manifest;
    }
    await write('models/manifest.v1.json', json({assets: {}, resources: {}, sharedParts: {}}));
    return {root, content, region, write, index, inventory: options => buildAssetPublicationInventory({assetsRoot: root, runtimeRoots: [], ...options})};
}

test('regions share one object and preserve HTTP compression, decoded hashes, media metadata and deterministic output', async t => {
    const f = await fixture(t), webp = Buffer.alloc(30);
    webp.write('RIFF'); webp.writeUInt32LE(22, 4); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUInt32LE(10, 16); webp.writeUIntLE(63, 24, 3); webp.writeUIntLE(31, 27, 3);
    const shared = await f.content(webp, '.png'), a = await f.content(json({visible: true}), '.json', true), b = await f.content(Buffer.from('separate geometry'));
    await f.region('a', [shared, a]); await f.region('b', [shared, b]);
    const one = await f.inventory(), two = await f.inventory();
    assert.equal(one.valid, true); assert.deepEqual(one, two);
    const texture = one.objects.find(o => o.path === `world/${shared.path}`);
    assert.deepEqual(texture.groups, ['region:a', 'region:b']); assert.equal(texture.contentType, 'image/webp'); assert.equal(texture.width, 64); assert.equal(texture.height, 32);
    assert.equal(one.summary.world.sharedAcrossRegionsFiles, 1); assert.equal(one.summary.world.sharedAcrossRegionsBytes, webp.length); assert.equal(one.summary.world.avoidedRepeatedRegionBytes, webp.length);
    assert.equal(one.warnings.filter(w => w.code === 'media-suffix').length, 1);
    const packed = one.objects.find(o => o.path === `world/${a.path}`);
    assert.equal(packed.contentEncoding, 'br'); assert.equal(packed.decodedSha256, a.decodedHash); assert.equal(packed.contentType, 'application/json');
});

test('stale catalog receipts fail publication, refresh preserves map objects, and the repaired inventory passes', async t => {
    const f = await fixture(t), old = Buffer.from('old model'), current = Buffer.from('current model'), modelPath = 'types/structures/hospital/hospital.glb';
    const row = {path: modelPath, resourceId: 'foxhole.model.hospital', sha256: hash(current), bytes: current.length};
    await f.write(modelPath, current); await f.write('models/manifest.v1.json', json({assets: {hospital: row}, resources: {}, sharedParts: {}}));
    const map = await f.content(Buffer.from('shared map payload'));
    await f.region('a', [map], {catalogResources: [{assetId: 'hospital', path: modelPath, sha256: hash(old), bytes: old.length}]});
    const before = await f.inventory(); assert.equal(before.valid, false); assert.ok(before.issues.some(e => e.code === 'receipt-hash' && e.group === 'region:a'));
    assert.equal((await syncCatalogReferences({target: path.join(f.root, 'world')})).regions, 1);
    assert.equal((await f.inventory()).valid, true); assert.equal((await fs.readFile(path.join(f.root, 'world', map.path))).toString(), 'shared map payload');
    await fs.unlink(path.join(f.root, modelPath)); assert.ok((await f.inventory()).issues.some(e => e.code === 'missing-file' && e.path === modelPath));
});

test('runtime roots protect repair textures outside region manifests and leave old files untouched', async t => {
    const f = await fixture(t), repair = await f.content(Buffer.from('repair pixels'), '.webp'), obsolete = await f.content(Buffer.from('old map payload'));
    await f.region('a', []); await f.write('shared/flags/flag.webp', Buffer.from('flag pixels'));
    const runtimeRoots = [{...repair, path: `world/${repair.path}`, id: 'foliage'}, {path: 'shared/flags/flag.webp', sha256: hash(Buffer.from('flag pixels')), id: 'flag'}];
    const inventory = await f.inventory({runtimeRoots}); assert.equal(inventory.valid, true);
    assert.ok(inventory.groups['world-runtime'].includes(`world/${repair.path}`)); assert.deepEqual(inventory.unreferencedWorld.map(r => r.path), [`world/${obsolete.path}`]);
    assert.equal(inventory.summary.world.runtimeRoots, 2); assert.equal((await fs.readFile(path.join(f.root, 'world', obsolete.path))).toString(), 'old map payload');
});

test('all known world runtime descriptors are detached, hash-addressed publication roots', () => {
    const roots = worldRuntimePublicationRoots(); assert.equal(roots.length, 4);
    assert.ok(roots.some(r => r.id === 'smoke-cloud-mask')); assert.ok(roots.some(r => r.path.startsWith('world/content/raw/')));
    for (const root of roots) {assert.match(root.sha256 || root.hash, /^[a-f0-9]{64}$/); publicationPath(root.path);}
    roots[0].path = 'mutated'; assert.notEqual(worldRuntimePublicationRoots()[0].path, 'mutated');
});

test('world transport codecs remain explicit and a .glb suffix does not mislabel application-coded bytes', async t => {
    const f = await fixture(t), transport = await f.content(Buffer.from([103, 2, 140, 41, 72]), '.glb', true);
    await f.region('a', [transport], {resources: {'a/water-visible.glb': {codec: 'word-planar-brotli', delta: 3, decodedBytes: 128, decodedHash: 'f'.repeat(64), resource: transport}}});
    const inventory = await f.inventory(); assert.equal(inventory.valid, true);
    const object = inventory.objects.find(o => o.path === `world/${transport.path}`);
    assert.equal(object.contentType, 'application/octet-stream'); assert.equal(object.contentEncoding, 'br');
    assert.deepEqual(object.uses, [{id: 'a/water-visible.glb', codec: 'word-planar-brotli', delta: 3, applicationDecodedBytes: 128, applicationDecodedSha256: 'f'.repeat(64)}]);
});

test('HTTP-decoded corruption and decode budgets fail independently of stored object hashes', async t => {
    const f = await fixture(t), ref = await f.content(Buffer.from('payload data'), '.bin', true);
    await f.region('a', [{...ref, decodedHash: '0'.repeat(64)}]);
    assert.ok((await f.inventory()).issues.some(e => e.code === 'decoded-hash'));
    const limited = await f.inventory({maxDecodedBytes: 5}); assert.ok(limited.issues.some(e => e.code === 'asset-read' && /budget/.test(e.message)));
});

test('a glTF cannot silently use a dependency declared only by another region', async t => {
    const f = await fixture(t), texture = await f.content(Buffer.from('texture'), '.webp');
    const gltf = await f.content(json({asset: {version: '2.0'}, images: [{uri: '../../' + texture.path.slice('content/'.length)}]}), '.gltf', true);
    await f.region('a', [gltf]); await f.region('b', [texture]);
    const result = await f.inventory(); assert.ok(result.issues.some(e => e.code === 'region-dependency' && e.group === 'region:a'));
});

test('shared model dependencies are resolved once and missing dependencies reject the inventory', async t => {
    const f = await fixture(t), partPath = 'shared/models/part.glb', mainPath = 'types/structures/crane/crane.glb';
    const part = Buffer.from('part'), main = Buffer.from('main'), sharedId = 'foxhole.model.shared.part';
    await f.write(partPath, part); await f.write(mainPath, main);
    const catalog = {assets: {crane: {path: mainPath, sha256: hash(main), bytes: main.length, modelParts: {parts: [{resourceId: sharedId}, {resourceId: sharedId}]}}}, resources: {}, sharedParts: {part: {resourceId: sharedId, path: partPath, sha256: hash(part), bytes: part.length}}};
    await f.write('models/manifest.v1.json', json(catalog));
    let inventory = await f.inventory(); assert.equal(inventory.valid, true); assert.deepEqual(inventory.objects.find(o => o.path === mainPath).dependencies, [partPath]);
    delete catalog.sharedParts.part; await f.write('models/manifest.v1.json', json(catalog));
    inventory = await f.inventory(); assert.ok(inventory.issues.some(e => e.code === 'model-part'));
});

test('unsafe paths are rejected and high-resolution images carry a compatibility warning', async t => {
    for (const p of ['../secret', '/secret', 'a/../b', 'a\\b', 'https://host/file', 'a?query', 'a//b', 'C:/outside']) assert.throws(() => publicationPath(p));
    const f = await fixture(t), png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(10000, 16); png.writeUInt32BE(1000, 20);
    await f.write('types/structures/runway/texture.png', png); const result = await f.inventory(); assert.ok(result.warnings.some(w => w.code === 'texture-dimension'));
    await f.write('types/structures/runway/legacy.webp', png); assert.ok((await f.inventory()).warnings.some(w => w.code === 'media-suffix' && /image\/png/.test(w.message)));
    assert.equal(publicationMedia(Buffer.from('{binary'), 'asset.bin').contentType, 'application/octet-stream');
    await assert.rejects(() => f.inventory({runtimeRoots: [{path: '../escape', sha256: 'a'.repeat(64)}]}), /Invalid publication path/);
});

test('the CLI refuses to overwrite the served tree and rejects misspelled arguments', async t => {
    const f = await fixture(t), command = fileURLToPath(new URL('./asset-publication-inventory.mjs', import.meta.url)), run = promisify(execFile);
    const protectedFile = path.join(f.root, 'models/manifest.v1.json'), original = await fs.readFile(protectedFile);
    await assert.rejects(() => run(process.execPath, [command, '--assets', f.root, '--output', protectedFile]), /outside the served asset directory/);
    assert.deepEqual(await fs.readFile(protectedFile), original);
    await assert.rejects(() => run(process.execPath, [command, '--asssets', f.root]), /Unknown option/);
    assert.match((await run(process.execPath, [command, '--help'])).stdout, /--assets/);
});
