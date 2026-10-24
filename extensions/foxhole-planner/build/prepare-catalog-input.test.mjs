import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {prepareCatalogInput, readCatalogReceipt} from './prepare-catalog-input.mjs';
test('ordinary builds retrieve just the pinned catalog and fail closed on stale local metadata', async t => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'planner-catalog-input-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
    const bytes = Buffer.from(JSON.stringify({catalogSchemaVersion: 1, assetRelease: 'v1', releaseRoot: 'planner/releases/v1/', products: [], resourceDefaults: {},
        sharedResources: [{id: 'icon', path: 'icon.webp', sha256: 'b'.repeat(64), byteLength: 10, mediaType: 'image/webp'}]}));
    const pin = {baseUrl: 'https://assets.test/', catalog: {url: 'https://assets.test/planner/releases/v1/catalog.v1.json', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length}};
    const output = path.join(root, 'catalog.v1.json'); let requests = 0;
    const fetcher = async (url, options) => {requests++; assert.equal(url, pin.catalog.url); assert.equal(options.redirect, 'error'); return new Response(bytes);};
    assert.equal((await prepareCatalogInput({pin, output, fetcher})).reused, false);
    assert.equal((await prepareCatalogInput({pin, output, fetcher})).reused, true); assert.equal(requests, 1);
    await fs.writeFile(output, Buffer.concat([bytes, Buffer.from(' ')]));
    await assert.rejects(prepareCatalogInput({pin, output, fetcher}), /integrity/); assert.equal(requests, 1);
    await assert.rejects(readCatalogReceipt({...pin.catalog, url: 'http://assets.test/catalog.json'}, fetcher), /Invalid/);
    await assert.rejects(readCatalogReceipt(pin.catalog, async () => new Response(Buffer.concat([bytes, Buffer.from('extra')]))), /exceeds/);
    await assert.rejects(readCatalogReceipt({...pin.catalog, sha256: 'f'.repeat(64)}, fetcher), /integrity/);
});
