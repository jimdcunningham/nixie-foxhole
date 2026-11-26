import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {createFoxholeAssetGenerationSelector, readFoxholeProductCatalog} from '../app/utils/asset-generation.ts';
const generation = (generationHash: string) => ({generationHash, readProductCatalog: async () => ({baseUrl: 'https://assets.example/', sha256: generationHash, text: '{}'})});
test('selected generation stages immutable data, reuses prepared versions, and clears on disable', async () => {
    const prepared: string[] = [], installed: (string | null)[] = [];
    const select = createFoxholeAssetGenerationSelector(async value => {prepared.push(value.generationHash); return value.generationHash;},
        value => {installed.push(value);});
    const a = await select(generation('a'));
    assert.deepEqual(installed, []); a();
    (await select(generation('a')))();
    (await select(generation('b')))();
    (await select(generation('c')))();
    (await select(generation('a')))();
    (await select(null))();
    assert.deepEqual(prepared, ['a', 'b', 'c']);
    assert.deepEqual(installed, ['a', 'b', 'c', 'a', null]);
});
test('a failed generation can retry without changing the installed version', async () => {
    let attempts = 0, installed: string | null = null;
    const select = createFoxholeAssetGenerationSelector(async value => {
        if (++attempts === 1) throw new Error('catalog integrity');
        return value.generationHash;
    }, value => {installed = value;});
    await assert.rejects(select(generation('broken')), /catalog integrity/);
    assert.equal(installed, null);
    (await select(generation('broken')))();
    assert.equal(installed, 'broken'); assert.equal(attempts, 2);
});

test('concurrent preparation shares one catalog read and can retry a rejected generation', async () => {
    const entries = new Map();
    let reads = 0;
    const selected = {generationHash: 'selected', readProductCatalog: async () => {
        if (++reads === 1) throw Error('Catalog unavailable');
        return {baseUrl: 'https://assets.example/', sha256: 'selected', text: '{"products":[]}', entries};
    }};
    const failing = readFoxholeProductCatalog(selected);
    assert.equal(readFoxholeProductCatalog({...selected}), failing);
    await assert.rejects(failing, /unavailable/);
    const [delivery, previews] = await Promise.all([readFoxholeProductCatalog({...selected}), readFoxholeProductCatalog(selected)]);
    assert.equal(delivery, previews);
    assert.equal(delivery.entries, entries);
    assert.deepEqual(previews.catalog.products, []);
    assert.equal(reads, 2);
});

test('Studio can discover installed regions without fetching world metadata until the map loads', async () => {
    const requests: string[] = [];
    const index = {version: 1, regions: {homeregionc: {}, deadlands: {}}};
    let failIndex = true;
    const receipt = (resource: string) => ({url: 'https://assets.example/' + resource, sha256: 'hash', byteLength: 10});
    const library = {
        files: new Map(['manifest.v1.json', 'maps/map-data.v1.json'].map(path => [path, {
            ...receipt(path), entry: {...receipt(path), mediaType: 'application/json'},
        }])),
        worldRegionIds: ['homeregionc', 'deadlands'],
        worldIndex: receipt('world-directory.json'),
        worldOfflineInventory: receipt('world-offline.json'),
        worldBaseUrl: 'https://assets.example/world/',
    };
    class Cache {
        async loadVerified(url: string) {
            requests.push(url);
            if (url === library.worldIndex.url && failIndex) throw Error('World temporarily unavailable');
            return new TextEncoder().encode(JSON.stringify(url === library.worldIndex.url ? index : {}));
        }
    }
    const source = readFileSync(new URL('../app/utils/asset-delivery.ts', import.meta.url), 'utf8')
        .replace(/^import .+$/gm, '').replace(/^export /gm, '').replace('import.meta.dev', 'false');
    const delivery = runInNewContext(stripTypeScriptTypes(source) + '\n({prepareFoxholeAssetGeneration, hasSelectedFoxholeSpatialRegion, foxholeWorldAssetDelivery})', {
        shallowRef: (value: unknown) => ({value}), NixiePersistentExtensionResourceCache: Cache,
        NixieExtensionResourceUsage: class {}, TextEncoder, TextDecoder, crypto,
        createFoxholeAssetGenerationSelector, readFoxholeProductCatalog, createFoxholeCatalogLibrary: () => library,
        configureWorldAssetLocations() {}, installFoxholeAssetLocations() {}, installFoxholeMapData() {}, installFoxholeManifest() {},
        foxholeManifestSchema: {parse() {}}, parseFoxholePublishedMapData: () => ({}),
    });
    (await delivery.prepareFoxholeAssetGeneration(generation('modern'), 'published'))();
    assert.equal(delivery.hasSelectedFoxholeSpatialRegion('HomeRegionC'), true);
    assert.deepEqual(requests, ['https://assets.example/manifest.v1.json', 'https://assets.example/maps/map-data.v1.json']);

    const {loadIndex} = delivery.foxholeWorldAssetDelivery();
    await assert.rejects(loadIndex(), /temporarily unavailable/);
    failIndex = false;
    const [first, second] = await Promise.all([loadIndex(), loadIndex()]);
    assert.equal(first, second);
    assert.deepEqual(Object.keys(first.regions), Object.keys(index.regions));
    assert.equal(requests.filter(url => url === library.worldIndex.url).length, 2, 'one failed attempt and one shared retry');
    assert.equal(requests.includes(library.worldOfflineInventory.url), false);
});
