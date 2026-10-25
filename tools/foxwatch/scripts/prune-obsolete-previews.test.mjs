import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync, brotliDecompressSync} from 'node:zlib';
import {pruneObsoletePublishedPreviews, finalizeGeneratedAssetPublication} from './prune-obsolete-previews.mjs';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-cleanup-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const write = async file => {
        await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true});
        await fs.writeFile(path.join(root, file), 'fixture');
    };
    return {root, write, exists: file => fs.access(path.join(root, file)).then(() => true).catch(() => false)};
}

test('retire delivered previews and directional copies while preserving all other output and sources', async t => {
    const f = await fixture(t);
    const obsolete = ['types/structures/hospital/hospital.preview.webp', 'types/structures/hospital/hospital.destroyed.preview.sw.webp', 'shared/modifications/door/door.preview.webp'];
    const keep = ['types/structures/hospital/hospital.preview.png', 'types/structures/hospital/hospital.icon.rendered.webp', 'types/structures/hospital/hospital.texture.webp', 'types/structures/hospital/hospital.glb', 'shared/modifications/door/door.icon.default.webp', 'maps/map.preview.webp', 'render-cache/hospital.preview.png'];
    for (const file of [...obsolete, ...keep]) await f.write(file);
    const manifest = {assets: [{icons: {rendered: '/foxhole/assets/types/structures/hospital/hospital.icon.rendered.webp'}}]};
    assert.deepEqual(await pruneObsoletePublishedPreviews({assetsRoot: f.root, manifest}), {removed: 3, bytes: 21});
    for (const file of obsolete) assert.equal(await f.exists(file), false, file);
    for (const file of keep) assert.equal(await f.exists(file), true, file);
    assert.equal((await pruneObsoletePublishedPreviews({assetsRoot: f.root, manifest})).removed, 0);
});

test('a referenced preview aborts the entire cleanup before any deletion', async t => {
    const f = await fixture(t), unused = 'types/a/a.preview.webp', referenced = 'shared/b/b.preview.webp';
    await f.write(unused); await f.write(referenced);
    await assert.rejects(pruneObsoletePublishedPreviews({assetsRoot: f.root, manifest: {assets: [{previewUrl: '/foxhole/assets/' + referenced}]}}), /remains referenced/);
    assert.equal(await f.exists(unused), true); assert.equal(await f.exists(referenced), true);
});

test('metadata-only publication leaves assets and world receipts alone', async t => {
    const f = await fixture(t);
    await f.write('types/a/a.preview.webp'); await f.write('world/index.json');
    assert.deepEqual(await finalizeGeneratedAssetPublication({assetsRoot: f.root, manifest: {assets: []}, metadataOnly: true}), {regions: 0, removed: 0, bytes: 0});
    assert.equal(await f.exists('types/a/a.preview.webp'), true);
});

test('directory junctions cannot escape the generated tree or cause partial cleanup', async t => {
    const f = await fixture(t), outside = await fixture(t);
    await f.write('types/a/a.preview.webp'); await outside.write('b.preview.webp');
    await fs.symlink(outside.root, path.join(f.root, 'shared'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(pruneObsoletePublishedPreviews({assetsRoot: f.root, manifest: {assets: []}}), /symbolic links/);
    assert.equal(await f.exists('types/a/a.preview.webp'), true);
    assert.equal(await outside.exists('b.preview.webp'), true);
});

test('finalization repairs stale world receipts without re-rendering or changing map resources', async t => {
    const f = await fixture(t), hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const model = {path: 'types/structures/hospital/hospital.glb', sha256: 'b'.repeat(64), bytes: 200};
    const doc = {resources: {terrain: {untouched: true}}, catalogResources: [{assetId: 'hospital', ...model, sha256: 'a'.repeat(64), bytes: 100}]};
    const raw = Buffer.from(JSON.stringify(doc)), bytes = brotliCompressSync(raw), file = 'content/br/' + hash(bytes) + '/asset.json';
    await f.write('world/' + file); await fs.writeFile(path.join(f.root, 'world', file), bytes);
    await f.write('models/manifest.v1.json');
    await fs.writeFile(path.join(f.root, 'models/manifest.v1.json'), JSON.stringify({assets: {hospital: model}}));
    await fs.writeFile(path.join(f.root, 'world/index.json'), JSON.stringify({version: 1, format: 'compact-recipes-v1', regions: {test: {manifest: {path: file, bytes: bytes.length, hash: hash(bytes), decodedHash: hash(raw)}, downloadBytes: bytes.length}}}));
    await f.write('types/structures/hospital/hospital.preview.webp');
    const manifest = {assets: []}, options = {assetsRoot: f.root, manifest};
    assert.deepEqual(await finalizeGeneratedAssetPublication(options), {regions: 1, removed: 1, bytes: 7});
    const index = JSON.parse(await fs.readFile(path.join(f.root, 'world/index.json')));
    const updated = JSON.parse(brotliDecompressSync(await fs.readFile(path.join(f.root, 'world', index.regions.test.manifest.path))));
    assert.deepEqual(updated.resources, doc.resources);
    assert.deepEqual(updated.catalogResources, [{assetId: 'hospital', ...model}]);
    assert.deepEqual(await finalizeGeneratedAssetPublication(options), {regions: 0, removed: 0, bytes: 0});
});

test('failed receipt finalization does not delete previews', async t => {
    const f = await fixture(t);
    await f.write('world/index.json'); await f.write('types/a/a.preview.webp');
    await assert.rejects(finalizeGeneratedAssetPublication({assetsRoot: f.root, manifest: {assets: []}}));
    assert.equal(await f.exists('types/a/a.preview.webp'), true);
});
