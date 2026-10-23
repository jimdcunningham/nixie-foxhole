import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {brotliCompressSync, brotliDecompressSync} from 'node:zlib';
import {buildAssetPublicationInventory} from './asset-publication-inventory.mjs';
import {prepareAssetPublication, readPublicationPlan, hash} from './asset-pack-publication.mjs';
import {publishAssetPublication} from './asset-pack-publisher.mjs';
import {createAssetPublicationS3} from './asset-pack-s3.mjs';

const target = {endpoint: 'https://example.r2.cloudflarestorage.com', publicBaseUrl: 'https://assets.example.org/', bucket: 'test-assets', prefix: 'foxwatch-test'};
async function fixture(t) {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-publish-')), root = path.join(parent, 'assets');
    t.after(() => fs.rm(parent, {recursive: true, force: true})); await fs.mkdir(root);
    const write = async (file, data) => {await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true}); await fs.writeFile(path.join(root, file), data);};
    const content = async (data, extension) => {const encoded = brotliCompressSync(data), sha256 = hash(encoded);
        const ref = {path: `content/br/${sha256}/asset${extension}`, hash: sha256, bytes: encoded.length, decodedHash: hash(data), encoding: 'br'};
        await write('world/' + ref.path, encoded); return ref;};
    const model = Buffer.from('glTF' + 'model data '.repeat(200)), modelPath = 'types/structures/factory/factory.glb';
    await write(modelPath, model); await write('models/manifest.v1.json', JSON.stringify({assets: {factory: {path: modelPath, sha256: hash(model), bytes: model.length}}, resources: {}, sharedParts: {}}));
    const texture = Buffer.alloc(30); texture.write('RIFF'); texture.write('WEBP', 8); texture.write('VP8X', 12); texture.writeUIntLE(31, 24, 3); texture.writeUIntLE(31, 27, 3);
    const shared = await content(texture, '.png');
    const index = {version: 1, format: 'compact-recipes-v1', regions: {}};
    for (const id of ['a', 'b']) {
        const manifest = await content(Buffer.from(JSON.stringify({version: 1, format: index.format, region: id, physicalResources: [shared], resources: {}, catalogResources: []})), '.json');
        index.regions[id] = {id, manifest};
    }
    await write('world/index.json', JSON.stringify(index));
    const inventory = await buildAssetPublicationInventory({assetsRoot: root, runtimeRoots: []}); assert.equal(inventory.valid, true);
    const prepare = output => prepareAssetPublication({assetsRoot: root, output: path.join(parent, output), target, inventory});
    const decode = async (prepared, row) => brotliDecompressSync(await fs.readFile(path.join(prepared.directory, row.file)));
    return {parent, root, inventory, write, prepare, decode, shared, modelPath};
}
function fakeTransport(failKey) {
    const remote = new Map(), puts = [], channels = [];
    return {remote, puts, channels, async putChannel(row) { channels.push({key: row.key, document: JSON.parse(await fs.readFile(row.sourceFile))}); remote.set(row.key, {...row}); }, async head(key) {return remote.get(key) ?? null;}, async put(row) {
        puts.push(row.key); if (failKey?.(row)) throw new Error('Disconnected');
        remote.set(row.key, {...row});
    }};
}

test('prepares deterministic pinned catalog and region packs while preserving shared world paths and MIME', async t => {
    const f = await fixture(t), first = await f.prepare('first'), second = await f.prepare('second');
    assert.deepEqual(first.plan, second.plan);
    const texture = first.plan.objects.find(row => row.relativeKey === 'world/' + f.shared.path);
    assert.equal(texture.mediaType, 'image/webp'); assert.equal(texture.sha256, f.shared.hash); assert.equal(texture.contentEncoding, 'br');
    const release = JSON.parse(await f.decode(first, first.plan.objects.find(row => row.phase === 'release')));
    assert.ok(release.packs.catalog); assert.ok(release.packs['region:a']); assert.ok(release.bootstrap['world/index.json']);
    const manifests = await Promise.all(Object.values(release.packs).map(async entry => {
        const row = first.plan.objects.find(row => new URL(row.key, target.publicBaseUrl).href === entry.pack.manifest.url);
        const data = await f.decode(first, row); assert.equal(hash(data), entry.pack.manifest.sha256); assert.equal(data.length, entry.pack.manifest.byteLength);
        return JSON.parse(data);
    }));
    assert.equal(manifests.filter(index => index.assets.some(entry => entry.path === texture.relativeKey)).length, 2);
    assert.equal(first.plan.objects.filter(row => row.key === texture.key).length, 1);
    assert.ok(first.plan.objects.some(row => row.mediaType === 'model/gltf-binary' && row.contentEncoding === 'br'));
    assert.equal((await readPublicationPlan(path.join(first.directory, 'plan.json'))).plan.planSha256, first.plan.planSha256);
    await assert.rejects(f.prepare('first'), /exist/i);
});

test('rejects invalid inventories, unsafe output, changed input and corrupted prepared payloads', async t => {
    const f = await fixture(t);
    await assert.rejects(prepareAssetPublication({assetsRoot: f.root, output: path.join(f.root, 'publish'), target, inventory: f.inventory}), /separate/);
    const invalid = structuredClone(f.inventory); invalid.valid = false;
    await assert.rejects(prepareAssetPublication({assetsRoot: f.root, output: path.join(f.parent, 'invalid'), target, inventory: invalid}), /valid/);
    await f.write(f.modelPath, 'changed'); await assert.rejects(f.prepare('changed'), /changed after inventory/);
    await f.write(f.modelPath, Buffer.from('glTF' + 'model data '.repeat(200)));
    const result = await f.prepare('good'); await fs.writeFile(path.join(result.directory, result.plan.objects[0].file), 'corrupt');
    const transport = fakeTransport(); await assert.rejects(publishAssetPublication({planPath: path.join(result.directory, 'plan.json'), transport}), /changed/);
    assert.equal(transport.puts.length, 0);
});

test('uploads objects before indexes and release, reuses matching remote bytes, and retains old release pins', async t => {
    const f = await fixture(t), prepared = await f.prepare('publish'), planPath = path.join(prepared.directory, 'plan.json'), transport = fakeTransport();
    const first = await publishAssetPublication({planPath, transport, concurrency: 2}); assert.equal(first.stats.uploaded, prepared.plan.objects.length);
    assert.equal(transport.puts.at(-1), prepared.plan.objects.find(row => row.phase === 'release').key);
    const phases = transport.puts.map(key => prepared.plan.objects.find(row => row.key === key).phase);
    assert.ok(phases.lastIndexOf('assets') < phases.indexOf('indexes'));
    const second = await publishAssetPublication({planPath, transport}); assert.equal(second.stats.uploaded, 0); assert.equal(second.stats.reused, first.stats.total);
    assert.equal(transport.remote.size, first.stats.total + 1);
    assert.deepEqual(transport.channels.at(-1).document.release, prepared.plan.release);
    assert.equal(transport.remote.get(target.prefix + '/channels/stable.json').cacheControl, 'no-cache, max-age=0, must-revalidate');
    assert.equal(JSON.parse(await fs.readFile(path.join(prepared.directory, 'publication-receipt.json'))).status, 'complete');
    const updated = Buffer.from('glTF' + 'updated model data '.repeat(200));
    await f.write(f.modelPath, updated);
    await f.write('models/manifest.v1.json', JSON.stringify({assets: {factory: {path: f.modelPath, sha256: hash(updated), bytes: updated.length}}, resources: {}, sharedParts: {}}));
    const inventory = await buildAssetPublicationInventory({assetsRoot: f.root, runtimeRoots: []});
    const next = await prepareAssetPublication({assetsRoot: f.root, output: path.join(f.parent, 'updated'), target, inventory});
    assert.notEqual(next.plan.release.url, prepared.plan.release.url);
    const update = await publishAssetPublication({planPath: path.join(next.directory, 'plan.json'), transport});
    assert.ok(update.stats.reused > 0, 'unchanged objects survive an asset update');
    assert.ok(transport.remote.has(prepared.plan.objects.find(row => row.phase === 'release').key));
    const rollback = await publishAssetPublication({planPath, transport});
    assert.equal(rollback.stats.uploaded, 0, 'the previous pinned snapshot remains independently usable');
});

test('failed uploads never publish indexes or release and can resume the same plan', async t => {
    const f = await fixture(t), prepared = await f.prepare('resume'), planPath = path.join(prepared.directory, 'plan.json'); let fail = true;
    let attempts = 0;
    const transport = fakeTransport(row => row.phase === 'assets' && fail && ++attempts === 2);
    await assert.rejects(publishAssetPublication({planPath, transport, concurrency: 1}), /Disconnected/);
    assert.ok(transport.puts.every(key => prepared.plan.objects.find(row => row.key === key).phase === 'assets'));
    assert.equal(transport.remote.size, 1);
    fail = false; const receipt = await publishAssetPublication({planPath, transport}); assert.equal(receipt.status, 'complete'); assert.equal(receipt.stats.reused, 1);
    const row = prepared.plan.objects[0]; transport.remote.set(row.key, {...row, mediaType: 'text/plain'});
    await assert.rejects(publishAssetPublication({planPath, transport}), /Immutable object/);
});

test('actual S3 wire requests are signed, conditional and preserve encoding and receipt metadata', async t => {
    const f = await fixture(t), prepared = await f.prepare('wire'), objects = new Map(); let signed = 0;
    const server = http.createServer(async (request, response) => {
        try {
            assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 /); signed++;
            const key = new URL(request.url, 'http://localhost').pathname, current = objects.get(key);
            if (request.method === 'HEAD') {response.writeHead(current ? 200 : 404, current?.headers); response.end(); return;}
            assert.equal(request.method, 'PUT'); const channel = key.endsWith('/channels/stable.json'); assert.equal(request.headers['if-none-match'], channel ? undefined : '*');
            const chunks = []; for await (const chunk of request) chunks.push(chunk); const bytes = Buffer.concat(chunks);
            assert.equal(hash(bytes), request.headers['x-amz-meta-foxwatch-sha256']);
            assert.equal(createHash('md5').update(bytes).digest('base64'), request.headers['content-md5']);
            if (current && !channel) {response.writeHead(412); response.end(); return;}
            const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => key.startsWith('x-amz-meta-') || ['content-type', 'content-encoding', 'cache-control', 'content-length'].includes(key)));
            objects.set(key, {bytes, headers}); response.writeHead(200, {etag: '"fixture"'}); response.end();
        } catch (error) {response.writeHead(500); response.end(String(error));}
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
    const transport = createAssetPublicationS3(target, {FOXWATCH_ASSETS_ACCESS_KEY_ID: 'test', FOXWATCH_ASSETS_SECRET_ACCESS_KEY: 'test-secret'}, {endpoint: `http://127.0.0.1:${server.address().port}`});
    t.after(() => transport.close());
    const receipt = await publishAssetPublication({planPath: path.join(prepared.directory, 'plan.json'), transport, concurrency: 2});
    assert.equal(receipt.status, 'complete'); assert.equal(objects.size, prepared.plan.objects.length + 1); assert.ok(signed >= prepared.plan.objects.length * 3 + 2);
});

test('channel failure preserves the previous pointer and can resume after immutable uploads', async t => {
    const f = await fixture(t), prepared = await f.prepare('channel-failure'), planPath = path.join(prepared.directory, 'plan.json'), transport = fakeTransport();
    const original = transport.putChannel;
    transport.putChannel = async () => {throw new Error('Channel unavailable');};
    await assert.rejects(publishAssetPublication({planPath, transport}), /Channel unavailable/);
    assert.equal(transport.remote.has(target.prefix + '/channels/stable.json'), false);
    await assert.rejects(fs.stat(path.join(prepared.directory, 'publication-receipt.json')), {code: 'ENOENT'});
    transport.putChannel = original;
    const resumed = await publishAssetPublication({planPath, transport});
    assert.equal(resumed.stats.uploaded, 0);
    assert.equal(resumed.stats.reused, prepared.plan.objects.length);
    assert.deepEqual(transport.channels.at(-1).document.release, prepared.plan.release);
});
