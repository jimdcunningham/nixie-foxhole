import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { preparePublicationModels } from './prepare-publication-inputs.mjs';

async function fixture(t) {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-publication-models-'));
    t.after(() => fs.rm(output, { recursive: true, force: true }));
    const bytes = Buffer.from('model geometry');
    const model = { path: 'models/building.glb', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    await fs.mkdir(path.join(output, 'models'));
    const manifestPath = path.join(output, 'models/manifest.v1.json');
    await fs.writeFile(manifestPath, JSON.stringify({ assets: { building: model }, resources: {}, sharedParts: {} }));
    const library = { files: new Map([[model.path, { url: 'https://assets.test/model.glb', entry: { byteLength: model.bytes, sha256: model.sha256 } }]]) };
    return { output, bytes, model, library, manifestPath };
}

test('publication tests download only pinned model inputs and reuse verified bytes', async t => {
    const f = await fixture(t); let requests = 0;
    const options = { ...f, fetcher: async () => { requests++; return new Response(f.bytes); } };
    assert.deepEqual(await preparePublicationModels(options), { files: 1, downloadedBytes: f.bytes.length, reusedBytes: 0 });
    assert.deepEqual(await preparePublicationModels(options), { files: 1, downloadedBytes: 0, reusedBytes: f.bytes.length });
    assert.equal(requests, 1);
    await fs.writeFile(path.join(f.output, f.model.path), 'corrupt cached geometry');
    await assert.rejects(preparePublicationModels(options), /differs from pin/);
});

test('unpublished paths and corrupt or oversized R2 bytes cannot become verification inputs', async t => {
    const f = await fixture(t);
    await assert.rejects(preparePublicationModels({ ...f, fetcher: async () => new Response(Buffer.from('wrong')) }), /integrity mismatch/);
    await assert.rejects(preparePublicationModels({ ...f, fetcher: async () => new Response(Buffer.alloc(f.bytes.length + 1)) }), /exceeds receipt/);
    await fs.writeFile(f.manifestPath, JSON.stringify({ assets: { building: { ...f.model, path: '../escape.glb' } } }));
    await assert.rejects(preparePublicationModels(f), /Invalid publication model path/);
    await fs.writeFile(f.manifestPath, JSON.stringify({ assets: { building: { ...f.model, sha256: '0'.repeat(64) } } }));
    await assert.rejects(preparePublicationModels(f), /differs from the pinned R2 publication/);
});
