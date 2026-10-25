import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { writeJsonAtomic } from './pipeline-core.mjs';
import { runSpatialManifestPublication } from './spatial-manifest-publication.mjs';

async function fixture(t) {
    const outputRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-manifest-publication-'));
    t.after(() => rm(outputRoot, { recursive: true, force: true }));
    const manifestPath = resolve(outputRoot, 'models/manifest.v1.json');
    const manifest = { schemaVersion: 1, assets: { hospital: { path: 'models/hospital.glb' } }, resources: {}, sharedParts: {} };
    await mkdir(resolve(outputRoot, 'models'));
    await writeFile(resolve(outputRoot, 'models/hospital.glb'), 'old model');
    await writeJsonAtomic(manifestPath, manifest);
    const before = await readFile(manifestPath, 'utf8');
    let writes = 0;
    const options = { outputRoot, manifestPath, manifest: structuredClone(manifest), sharedParts: {},
        writeManifest: async (...args) => { writes++; await writeJsonAtomic(...args); } };
    return { ...options, options, before, writes: () => writes,
        unchanged: async () => {
            assert.equal(await readFile(manifestPath, 'utf8'), before);
            assert.equal(await readFile(resolve(outputRoot, 'models/hospital.glb'), 'utf8'), 'old model');
        } };
}
const result = (id, status = 'exported') => ({ timing: { id, status }, asset: { path: `types/structures/${id}/${id}.glb` }, resources: {} });

test('multiple results leave the live manifest untouched until success and clean old models afterward', async t => {
    const f = await fixture(t);
    await runSpatialManifestPublication({ ...f.options, generate: async record => {
        record(result('hospital')); await f.unchanged();
        record(result('refinery')); await f.unchanged();
    } });
    assert.equal(f.writes(), 1);
    const published = JSON.parse(await readFile(f.manifestPath, 'utf8'));
    assert.equal(published.assets.hospital.path, 'types/structures/hospital/hospital.glb');
    assert.ok(published.assets.refinery);
    await assert.rejects(stat(resolve(f.outputRoot, 'models/hospital.glb')), { code: 'ENOENT' });
});

test('worker exception preserves live metadata and old models', async t => {
    const f = await fixture(t);
    await assert.rejects(runSpatialManifestPublication({ ...f.options, generate: async record => {
        record(result('hospital')); throw Error('worker crashed');
    } }), /worker crashed/);
    await f.unchanged(); assert.equal(f.writes(), 0);
});

test('a failed asset prevents publication even when other results succeeded', async t => {
    const f = await fixture(t);
    assert.equal(await runSpatialManifestPublication({ ...f.options, generate: async record => {
        record(result('hospital')); record(result('refinery', 'failed'));
    } }), false);
    await f.unchanged(); assert.equal(f.writes(), 0);
});

test('cancellation before completion never publishes', async t => {
    const f = await fixture(t), abort = new AbortController();
    await assert.rejects(runSpatialManifestPublication({ ...f.options, signal: abort.signal, generate: async record => {
        record(result('hospital')); abort.abort(Error('cancelled'));
    } }), /cancelled/);
    await f.unchanged(); assert.equal(f.writes(), 0);
});

test('failed final rename preserves the old model files', async t => {
    const f = await fixture(t);
    await assert.rejects(runSpatialManifestPublication({ ...f.options,
        writeManifest: async () => { throw Object.assign(Error('locked'), { code: 'EPERM' }); },
        generate: async record => { record(result('hospital')); } }), { code: 'EPERM' });
    await f.unchanged();
});

test('unchanged cached results cause no live manifest writes', async t => {
    const f = await fixture(t);
    await runSpatialManifestPublication({ ...f.options, generate: async record => {
        record({ timing: { id: 'hospital', status: 'reused' }, asset: f.manifest.assets.hospital, resources: {} });
    } });
    await f.unchanged(); assert.equal(f.writes(), 0);
});

test('shared parts publish with the complete successful model closure', async t => {
    const f = await fixture(t);
    const shared = { resourceId: 'foxhole.model.shared.test', path: 'shared/models/test.glb' };
    await runSpatialManifestPublication({ ...f.options, sharedParts: { test: shared }, generate: async record => {
        const model = result('hospital');
        model.asset.modelParts = { parts: [{ resourceId: shared.resourceId }] };
        record(model); await f.unchanged();
    } });
    assert.deepEqual(JSON.parse(await readFile(f.manifestPath, 'utf8')).sharedParts, { test: shared });
});
