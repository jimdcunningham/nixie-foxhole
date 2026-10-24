import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {prepareProductCatalog} from './prepare-catalog.mjs';
import {readPublicationPlan} from '../scripts/asset-pack-publication.mjs';
import {publishAssetPublication} from '../scripts/asset-pack-publisher.mjs';
import {parseNixieExperimentalProductCatalogV1, resolveNixieExperimentalProductCatalogResourcesV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
const target = {endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'nixie-extension-assets', publicBaseUrl: 'https://assets.example.org/', prefix: 'planner'};

test('FoxWatch produces one catalog and a readable frozen publication that resumes without overwrites', async t => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'foxwatch-catalog-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const assetsRoot = path.join(root, 'assets'); await fs.mkdir(assetsRoot);
    for (const name of ['icon.webp','texture.webp','bracket.glb','part.glb','map.webp']) await fs.writeFile(path.join(assetsRoot, name), name);
    await fs.writeFile(path.join(assetsRoot, 'bracket.glb'), 'geometry'.repeat(1024));
    await fs.writeFile(path.join(assetsRoot, 'manifest.v1.json'), '{}');
    const sources = {assets: [{id: 'hospital', assetGroup: 'structures', icon: 'icon.webp', texture: 'texture.webp'}],
        models: [{id: 'hospital', assetId: 'hospital', path: 'bracket.glb', dependencyIds: ['shared.part']},
            {id: 'shared.part', assetId: 'shared', sharedPart: true, path: 'part.glb'}],
        metadata: {hospital: {name: 'Hospital', model: {resourceId: 'foxhole.model.hospital'}}}, data: {catalogLocalizations: {en: {hospital: 'Hospital'}}},
        buildInputs: ['manifest.v1.json'], browserImageSources: ['icon.webp'], modifications: [], visuals: [],
        maps: {metadata: {}, resources: [{id: 'foxhole.map.world-light', sourcePath: 'map.webp'}]}};
    const prepared = await prepareProductCatalog({assetsRoot, output: path.join(root, 'snapshot'), assetRelease: '2026-10-24.1', target, sources, atlas: async () => Buffer.from('atlas')});
    const {plan} = await readPublicationPlan(prepared.planPath);
    assert.ok(plan.objects.every(row => row.key.startsWith('planner/releases/2026-10-24.1/')));
    assert.ok(plan.objects.some(row => row.key.endsWith('/types/structures/hospital/hospital.icon.default.webp')));
    assert.ok(plan.objects.every(row => !row.key.includes('/objects/') && !/[a-f0-9]{64}/.test(row.key)));
    assert.equal(plan.objects.find(row => row.key.endsWith('/hospital.model.base.glb')).contentEncoding, 'br');
    const completionObject = plan.objects.find(row => row.phase === 'release');
    const completion = JSON.parse(await fs.readFile(path.join(prepared.directory, completionObject.file)));
    assert.equal(completion.buildInputs['manifest.v1.json'].path, 'source/manifest.v1.json');
    const catalogBytes = await fs.readFile(path.join(prepared.directory, 'catalog.v1.json'));
    assert.equal(createHash('sha256').update(catalogBytes).digest('hex'), prepared.pin.catalog.sha256);
    const catalog = parseNixieExperimentalProductCatalogV1(JSON.parse(catalogBytes));
    const resources = resolveNixieExperimentalProductCatalogResourcesV1(catalog);
    assert.equal(resources.assets.find(row => row.path === 'models/hospital.base.glb').sourcePath, 'types/structures/hospital/hospital.model.base.glb');
    assert.equal(catalog.data.catalogLocalizations.en.hospital, 'Hospital');
    const stored = new Map(); let failCatalog = true;
    const transport = {head: async key => stored.get(key), put: async row => {
        if (failCatalog && row.phase === 'indexes') throw Error('Interrupted');
        assert.equal(stored.has(row.key), false); stored.set(row.key, {...row});
    }};
    await assert.rejects(publishAssetPublication({planPath: prepared.planPath, transport}), /Interrupted/);
    assert.equal(stored.has(plan.objects.find(row => row.phase === 'release').key), false);
    failCatalog = false;
    const resumed = await publishAssetPublication({planPath: prepared.planPath, transport});
    assert.ok(resumed.stats.reused > 0);
    const repeated = await publishAssetPublication({planPath: prepared.planPath, transport});
    assert.equal(repeated.stats.uploaded, 0);
    const first = stored.values().next().value; first.decodedSha256 = '0'.repeat(64);
    await assert.rejects(publishAssetPublication({planPath: prepared.planPath, transport}), /different bytes or headers/);
    await assert.rejects(prepareProductCatalog({assetsRoot, output: path.join(root, 'snapshot'), assetRelease: '2026-10-24.1', target, sources}), /EEXIST/);
});
