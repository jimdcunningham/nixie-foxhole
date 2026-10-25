import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {brotliCompressSync} from 'node:zlib';
import {prepareProductCatalog} from './prepare-catalog.mjs';
import {loadFoxholeCatalogLibrary, readPinnedCatalogJson} from '../../../extensions/foxhole-planner/src/catalog-library.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const target = {endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'nixie-extension-assets', publicBaseUrl: 'https://assets.example.org/', prefix: 'foxhole-planner'};

test('one canonical catalog includes standalone private files and the existing encoded world graph', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'world-catalog-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const assetsRoot = path.join(root, 'assets'); await fs.mkdir(assetsRoot);
    const decoded = Buffer.from(JSON.stringify({geometry: 'unchanged geometry'.repeat(100)})), encoded = brotliCompressSync(decoded);
    const worldPath = 'world/content/br/' + hash(encoded) + '/asset.json';
    const write = async (name, bytes) => {await fs.mkdir(path.dirname(path.join(assetsRoot,name)), {recursive:true}); await fs.writeFile(path.join(assetsRoot,name),bytes);};
    const emptyEncoded = brotliCompressSync(Buffer.alloc(0)), emptyPath = 'world/content/br/' + hash(emptyEncoded) + '/asset.bin';
    await write(emptyPath, emptyEncoded); await write(worldPath, encoded); await write('world/index.json', '{}'); await write('rendered.webp', 'rendered pixels'); await write('manifest.v1.json', '{}');
    const sources = {assets: [], models: [], browserImageSources: [], modifications: [], visuals: [], maps: {resources: []}, metadata: {}, data: {},
        privateSources: ['rendered.webp'], buildInputs: ['manifest.v1.json'],
        world: {valid: true, issues: [], objects: [
            {path: worldPath, sha256: hash(encoded), bytes: encoded.length, decodedSha256: hash(decoded), decodedBytes: decoded.length, contentEncoding: 'br', contentType: 'application/json'},
            {path: 'world/index.json', contentType: 'application/json'},
            {path:emptyPath,sha256:hash(emptyEncoded),bytes:emptyEncoded.length,decodedSha256:hash(Buffer.alloc(0)),decodedBytes:0,contentEncoding:'br',contentType:'application/octet-stream'},
        ]}};
    const prepared = await prepareProductCatalog({assetsRoot, output:path.join(root,'prepared'), target, sources});
    const plan = JSON.parse(await fs.readFile(prepared.planPath)), bytesByUrl = new Map();
    for (const row of plan.objects) bytesByUrl.set(new URL(row.key,target.publicBaseUrl).href, row.contentEncoding ? decoded : await fs.readFile(path.join(prepared.directory,row.file)));
    const fetcher = async url => new Response(bytesByUrl.get(String(url)));
    const library = await loadFoxholeCatalogLibrary(prepared.pin, ref => readPinnedCatalogJson(ref, fetcher));
    const world = library.files.get(worldPath);
    assert.equal(world.url, new URL('foxhole-planner/' + worldPath,target.publicBaseUrl).href);
    assert.equal(library.files.get(emptyPath).entry.byteLength,0,'legitimate empty binary resources remain readable');
    assert.equal(world.entry.sha256,hash(decoded)); assert.equal(world.entry.byteLength,decoded.length);
    assert.equal(library.worldBaseUrl,'https://assets.example.org/foxhole-planner/world/');
    assert.deepEqual(await readPinnedCatalogJson(library.worldIndex,fetcher), {});
    assert.match(library.resolve('rendered.webp'), /foxhole-planner\/objects\/[a-f0-9]{64}\.webp$/);
    assert.match(library.resolve('manifest.v1.json'), /foxhole-planner\/objects\/[a-f0-9]{64}\.json$/);
    const object = plan.objects.find(row => row.key.endsWith(worldPath));
    assert.deepEqual(await fs.readFile(path.join(prepared.directory,object.file)),encoded,'world encoding is preserved byte for byte');
    assert.equal(plan.objects.filter(row=>row.decodedSha256===hash(decoded)).length,1);
    assert.throws(()=>library.resolve('unknown.webp'),/absent/);
    const catalog = JSON.parse(await fs.readFile(path.join(prepared.directory,'catalog.v1.json')));
    const load = value => loadFoxholeCatalogLibrary(prepared.pin, async () => value);
    const escaping = structuredClone(catalog); escaping.sharedResources[0].sourcePath='other/asset.json';
    await assert.rejects(load(escaping),/escapes/);
    const missing = structuredClone(catalog); missing.data.privateFiles['missing.webp']='missing';
    await assert.rejects(load(missing),/association/);
    const corrupted = structuredClone(catalog); corrupted.data.world.contentResources[worldPath.slice(6)].sha256='bad';
    await assert.rejects(load(corrupted),/receipt/);
    const oversized = {...prepared.pin.catalog,byteLength:17*1024**2};
    await assert.rejects(readPinnedCatalogJson(oversized,fetcher),/receipt/);
    await assert.rejects(readPinnedCatalogJson({...prepared.pin.catalog,sha256:'0'.repeat(64)},fetcher),/integrity/);
    await assert.rejects(readPinnedCatalogJson({...prepared.pin.catalog,byteLength:1},fetcher),/exceeds/);
    const stale = structuredClone(sources); stale.world.objects[0].sha256='0'.repeat(64);
    await assert.rejects(prepareProductCatalog({assetsRoot,output:path.join(root,'stale'),target,sources:stale}),/changed after inventory/);
});
