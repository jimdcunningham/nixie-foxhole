import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { reviewPreparedPlannerCatalog } from './release-comparison.mjs';

const baseUrl = 'https://assets.example/';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => Buffer.from(JSON.stringify(value));
const receipt = body => ({ sha256: sha256(body), byteLength: body.length });

function resource(id, value) {
    const body = Buffer.from(value);
    return { id, path: 'shared/' + id + '.webp', mediaType: 'image/webp',
        sourcePath: 'foxhole-planner/objects/' + sha256(body) + '.webp', ...receipt(body) };
}

function catalog(...resources) {
    return bytes({ catalogSchemaVersion: 1, resourceDefaults: {}, products: [],
        sharedResources: resources, data: { privateFiles: Object.fromEntries(resources.map(row => ['types/example/' + row.id + '.webp', row.path])) } });
}

test('reviews a prepared catalog against the latest published checkpoint without reading payloads', async t => {
    const before = catalog(resource('changed', 'old'), resource('removed', 'removed'));
    const after = catalog(resource('changed', 'new'), resource('added', 'added'));
    const directory = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-catalog-review-'));
    const documentPath = path.join(directory, 'catalog.v1.json');
    const pinPath = path.join(directory, 'extension-pin.json');
    t.after(async () => {
        await Promise.all([unlink(documentPath), unlink(pinPath)]);
        await rmdir(directory);
    });
    const writeCheckpoint = body => Promise.all([
        writeFile(documentPath, body),
        writeFile(pinPath, bytes({ schemaVersion: 1, baseUrl,
            catalog: { url: baseUrl + 'foxhole-planner/objects/' + sha256(body) + '.json', ...receipt(body) } })),
    ]);
    await writeCheckpoint(after);

    const newest = { version: '0.6.2', packageSha256: '2'.repeat(64), publishedAt: '2026-11-20T00:00:00Z' };
    const older = { version: '0.6.1', packageSha256: '1'.repeat(64), publishedAt: '2026-11-19T00:00:00Z' };
    const registry = '/api/nixie/extensions/nixie.foxhole-planner';
    const release = registry + '/releases/' + newest.packageSha256;
    const fetcher = async url => {
        switch (new URL(url).pathname) {
            case registry + '/versions': return Response.json([older, newest]);
            case release: return Response.json({ manifest: { id: 'nixie.foxhole-planner', version: newest.version,
                contributes: { productCatalogs: [{ id: 'foxhole.catalog', baseUrl,
                    document: { path: 'dist/catalog.v1.json', ...receipt(before) } }] } } });
            case release + '/files/dist/catalog.v1.json': return new Response(before);
            default: assert.fail('Unexpected catalog review request: ' + url);
        }
    };

    const result = await reviewPreparedPlannerCatalog(directory, { fetcher });
    assert.equal(result.before.version, newest.version);
    assert.deepEqual(result.changes.map(row => [row.path, row.status]), [
        ['types/example/changed.webp', 'modified'], ['types/example/removed.webp', 'deleted'], ['types/example/added.webp', 'added'],
    ]);
    assert.notEqual(result.changes[0].before.url, result.changes[0].after.url);

    await writeCheckpoint(before);
    const same = await reviewPreparedPlannerCatalog(directory, { fetcher });
    assert.deepEqual(same.changes, []);

    await writeFile(documentPath, after);
    await assert.rejects(reviewPreparedPlannerCatalog(directory, { fetcher }), /Prepared Planner catalog integrity mismatch/);
});

test('moving a world receipt out of the catalog does not report the file as deleted', async t => {
    const index = {id: 'world-index', path: 'shared/world/index.json', sourcePath: 'foxhole-planner/world-index.json',
        mediaType: 'application/json', ...receipt(bytes({}))};
    const content = 'content/raw/' + sha256(Buffer.from('map')) + '/asset.bin';
    const world = {indexResourcePath: index.path, contentRoot: 'foxhole-planner/world/'};
    const download = bytes({version: 1, contentResources: {[content]: {a: sha256(Buffer.from('map')), b: 3, c: 'application/octet-stream'}}});
    const inventory = {id: 'world-inventory', path: 'shared/world/offline-inventory.json', mediaType: 'application/json',
        sourcePath: 'foxhole-planner/objects/' + sha256(download) + '.json', ...receipt(download)};
    const makeCatalog = (resources, data) => bytes({catalogSchemaVersion: 1, resourceDefaults: {}, products: [],
        sharedResources: resources, data: {privateFiles: {}, world: {...world, ...data}}});
    const before = makeCatalog([index], {contentResources: {[content]: {sha256: sha256(Buffer.from('map')), byteLength: 3, mediaType: 'application/octet-stream'}}});
    const after = makeCatalog([index, inventory], {offlineInventoryResourcePath: inventory.path});
    const directory = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-world-review-'));
    const payload = path.join(directory, 'payload');
    const payloadFile = path.join(payload, sha256(download) + '.json');
    const catalogFile = path.join(directory, 'catalog.v1.json'), pinFile = path.join(directory, 'extension-pin.json');
    await mkdir(payload);
    await Promise.all([writeFile(catalogFile, after), writeFile(payloadFile, download), writeFile(pinFile, bytes({
        schemaVersion: 1, baseUrl, catalog: {url: baseUrl + 'foxhole-planner/catalog.json', ...receipt(after)},
    }))]);
    t.after(async () => {
        await Promise.all([catalogFile, pinFile, payloadFile].map(file => unlink(file)));
        await rmdir(payload);
        await rmdir(directory);
    });
    const fetcher = async url => {
        const pathname = new URL(url).pathname;
        if (pathname.endsWith('/versions')) return Response.json([{version: '0.6.3', packageSha256: '2'.repeat(64)}]);
        if (pathname.endsWith('/files/dist/catalog.v1.json')) return new Response(before);
        return Response.json({manifest: {id: 'nixie.foxhole-planner', version: '0.6.3',
            contributes: {productCatalogs: [{id: 'foxhole.catalog', baseUrl, document: {path: 'dist/catalog.v1.json', ...receipt(before)}}]}}});
    };
    const review = await reviewPreparedPlannerCatalog(directory, {fetcher});
    assert.deepEqual(review.changes, []);
});
