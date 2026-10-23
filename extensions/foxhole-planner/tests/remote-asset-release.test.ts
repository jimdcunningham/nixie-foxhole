import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { loadFoxholeAssetRelease, readPinnedAssetJson, type AssetReceipt } from '../src/asset-release.ts';
import { createPlannerRemoteResourceIndex } from '../build/remote-resource-bindings.ts';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
test('pinned metadata rejects changed bytes, wrong lengths and unsafe metadata URLs', async () => {
    const value = '{"version":1}', receipt = { url: 'https://assets.test/v1/index.json', sha256: sha(value), byteLength: value.length };
    const fetcher = (async () => new Response(value)) as typeof fetch;
    assert.deepEqual(await readPinnedAssetJson(receipt, fetcher), { version: 1 });
    await assert.rejects(readPinnedAssetJson({ ...receipt, sha256: 'a'.repeat(64) }, fetcher), /integrity/);
    await assert.rejects(readPinnedAssetJson({ ...receipt, byteLength: 1 }, fetcher), /exceeds/);
    await assert.rejects(readPinnedAssetJson({ ...receipt, url: 'https://other.test/a?latest=1' }, fetcher), /canonical/);
});
test('release mapping is complete and fails closed for unavailable paths and cross-origin indexes', async () => {
    const entry = { path: 'objects/ship.glb', sha256: 'a'.repeat(64), byteLength: 100, mediaType: 'model/gltf-binary' };
    const receipt = (name: string) => ({ url: 'https://assets.test/v1/' + name, sha256: 'b'.repeat(64), byteLength: 100 });
    const docs: Record<string, unknown> = {};
    const packs = Object.fromEntries(['catalog', 'support', 'world-runtime'].map(group => {
        const pack = { contractVersion: 1, id: group, manifest: receipt(group + '-pack.json') }, mapping = receipt(group + '-mapping.json');
        docs[pack.manifest.url] = { contractVersion: 1, assets: [entry] };
        docs[mapping.url] = { schemaVersion: 1, files: { 'types/ships/ship.glb': { path: entry.path } } };
        return [group, { pack, mapping }];
    }));
    const release = { schemaVersion: 1, format: 'foxwatch-asset-release-v1', worldBaseUrl: 'https://assets.test/v1/world/', packs,
        bootstrap: { 'world/index.json': { path: 'objects/world.json', sha256: 'c'.repeat(64), byteLength: 110_000_000, mediaType: 'application/json' } } };
    docs[receipt('release.json').url] = release;
    const read = async <T>(pin: AssetReceipt) => docs[pin.url] as T;
    const library = await loadFoxholeAssetRelease(receipt('release.json'), read);
    assert.equal(library.resolve('types/ships/ship.glb'), 'https://assets.test/v1/objects/ship.glb');
    assert.equal(library.worldIndex.byteLength, 110_000_000);
    assert.throws(() => library.resolve('missing.glb'), /absent/);
    packs.catalog.pack.manifest.url = 'https://other.test/index.json';
    await assert.rejects(loadFoxholeAssetRelease(receipt('release.json'), read), /escapes/);
});
test('runtime resource aliases retain shared dependencies and never copy a model payload', () => {
    const part = { path: 'objects/shared.glb', sha256: 'a'.repeat(64), byteLength: 20, mediaType: 'model/gltf-binary' };
    const root = { path: 'objects/ship.glb', sha256: 'b'.repeat(64), byteLength: 30, mediaType: 'model/gltf-binary', dependencies: [part.path] };
    const library = { entries: new Map([[part.path, part], [root.path, root]]), files: new Map([['types/ship.glb', { entry: root }]]) };
    const index = createPlannerRemoteResourceIndex([{ path: 'dist/ship.glb', source: 'types/ship.glb' }], library);
    assert.deepEqual(index.assets.find(row => row.path === 'dist/ship.glb'), { ...root, path: 'dist/ship.glb', sourcePath: root.path });
    assert.equal(index.assets.length, 3);
    assert.throws(() => createPlannerRemoteResourceIndex([{ path: 'dist/no.glb', source: 'missing' }], library), /does not contain/);
});
