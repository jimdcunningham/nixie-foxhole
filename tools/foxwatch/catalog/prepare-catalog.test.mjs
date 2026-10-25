import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {prepareProductCatalog} from './prepare-catalog.mjs';
import {readPublicationPlan} from '../scripts/asset-pack-publication.mjs';
import {publishAssetPublication, inspectAssetPublication} from '../scripts/asset-pack-publisher.mjs';
import {parseNixieExperimentalProductCatalogV1, resolveNixieExperimentalProductCatalogResourcesV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
const target = {endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'nixie-extension-assets', publicBaseUrl: 'https://assets.example.org/', prefix: 'foxhole-planner'};

test('FoxWatch produces one catalog and shared content objects that resumes without overwrites', async t => {
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
        buildInputContents: {'manifest.v1.json': JSON.stringify({previewUrl: '/foxhole/assets/types/structures/hospital/hospital.icon.rendered.webp'})},
        buildInputs: ['manifest.v1.json'], browserImageSources: ['icon.webp'], modifications: [], visuals: [],
        maps: {metadata: {}, resources: [{id: 'foxhole.map.world-light', sourcePath: 'map.webp'}]}};
    const prepared = await prepareProductCatalog({assetsRoot, output: path.join(root, 'snapshot'), assetRelease: '2026-10-24.1', target, existingInventory: {schemaVersion:1,target,objects:[],capturedAt:'fixture'}, sources, atlas: async () => Buffer.from('atlas')});
    const {plan} = await readPublicationPlan(prepared.planPath);
    assert.ok(plan.objects.every(row => /^foxhole-planner\/objects\/[a-f0-9]{64}\.(webp|glb|json)$/.test(row.key)));
    assert.equal(plan.objects.find(row => row.mediaType === 'model/gltf-binary' && row.decodedBytes > 1024).contentEncoding, 'br');
    const completionObject = plan.objects.find(row => row.phase === 'release');
    const completion = JSON.parse(await fs.readFile(path.join(prepared.directory, completionObject.file)));
    assert.match(completion.buildInputs['manifest.v1.json'].path, /^foxhole-planner\/objects\/[a-f0-9]{64}\.json$/);
    const frozenManifest = plan.objects.find(row => row.key === completion.buildInputs['manifest.v1.json'].path);
    assert.equal(JSON.parse(await fs.readFile(path.join(prepared.directory, frozenManifest.file))).previewUrl, '/foxhole/assets/types/structures/hospital/hospital.icon.rendered.webp');
    const catalogBytes = await fs.readFile(path.join(prepared.directory, 'catalog.v1.json'));
    assert.equal(createHash('sha256').update(catalogBytes).digest('hex'), prepared.pin.catalog.sha256);
    const catalog = parseNixieExperimentalProductCatalogV1(JSON.parse(catalogBytes));
    const resources = resolveNixieExperimentalProductCatalogResourcesV1(catalog);
    assert.equal(catalog.releaseRoot, undefined);
    assert.equal(catalog.assetRelease, undefined);
    assert.match(resources.assets.find(row => row.path === 'models/hospital.base.glb').sourcePath, /^foxhole-planner\/objects\/[a-f0-9]{64}\.glb$/);
    assert.equal(catalog.data.catalogLocalizations.en.hospital, 'Hospital');
    const stored = new Map(); let failCatalog = true;
    const transport = {head: async key => stored.get(key), put: async row => {
        if (failCatalog && row.phase === 'indexes') throw Error('Interrupted');
        assert.equal(stored.has(row.key), false); stored.set(row.key, {...row});
    }, putChannel: async row => {stored.set(row.key,{...row});}};
    await assert.rejects(publishAssetPublication({planPath: prepared.planPath, transport}), /Interrupted/);
    assert.equal(stored.has(plan.objects.find(row => row.phase === 'release').key), false);
    failCatalog = false;
    const resumed = await publishAssetPublication({planPath: prepared.planPath, transport});
    assert.ok(resumed.stats.reused > 0);
    const dry = await inspectAssetPublication({planPath: prepared.planPath, transport: {head: transport.head, put: () => {throw Error('Read-only inspection attempted a write');}}});
    assert.equal(dry.summary.reused, plan.objects.length);
    assert.equal(dry.summary.missing, 0);
    assert.equal(dry.summary.conflicting, 0);
    const repeated = await publishAssetPublication({planPath: prepared.planPath, transport});
    assert.equal(repeated.stats.uploaded, 0);
    // A catalog metadata/version change must not upload shared media again.
    const nextSources = structuredClone(sources);
    nextSources.metadata.hospital.name = 'Hospital, revised catalog';
    const next = await prepareProductCatalog({assetsRoot, output: path.join(root, 'next'), target, existingInventory: {schemaVersion:1,target,objects:[],capturedAt:'fixture'}, sources: nextSources, atlas: async () => Buffer.from('atlas')});
    const before = new Set(stored.keys());
    const nextReceipt = await publishAssetPublication({planPath: next.planPath, transport});
    assert.equal(nextReceipt.stats.uploaded, 2, 'only the changed catalog and its completion');
    assert.ok([...stored.keys()].filter(key => !before.has(key)).every(key => stored.get(key).mediaType === 'application/json'));
    await fs.writeFile(path.join(assetsRoot, 'bracket.glb'), 'changed geometry'.repeat(1024));
    const changed = await prepareProductCatalog({assetsRoot, output: path.join(root, 'changed'), target, existingInventory: {schemaVersion:1,target,objects:[],capturedAt:'fixture'}, sources: nextSources, atlas: async () => Buffer.from('atlas')});
    const changedReceipt = await publishAssetPublication({planPath: changed.planPath, transport});
    assert.equal(changedReceipt.stats.uploaded, 3, 'one changed model plus catalog and completion');
    const repeatedChanged = await publishAssetPublication({planPath: changed.planPath, transport});
    assert.equal(repeatedChanged.stats.uploaded, 0);
    const first = stored.values().next().value; first.decodedSha256 = '0'.repeat(64);
    assert.equal((await inspectAssetPublication({planPath: prepared.planPath, transport})).summary.conflicting, 1);
    await assert.rejects(publishAssetPublication({planPath: prepared.planPath, transport}), /different bytes or headers/);
    await assert.rejects(prepareProductCatalog({assetsRoot, output: path.join(root, 'snapshot'), assetRelease: '2026-10-24.1', target, sources}), /EEXIST/);
});


test('legacy release objects migrate to hashed paths and subsequent catalogs reuse the established paths', async t => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'foxwatch-canonical-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const assetsRoot = path.join(root, 'assets'); await fs.mkdir(assetsRoot);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const model = Buffer.from('model bytes'), image = Buffer.from('image bytes');
    await fs.writeFile(path.join(assetsRoot, 'hospital.glb'), model);
    await fs.writeFile(path.join(assetsRoot, 'icon.webp'), image);
    const legacy = {key: 'foxhole-planner/releases/old/hospital.model.base.glb', bytes: model.length,
        sha256: hash(model), decodedSha256: hash(model), decodedBytes: model.length,
        mediaType: 'model/gltf-binary', cacheControl: 'public, max-age=31536000, immutable'};
    const sources = {assets: [{id: 'hospital', assetGroup: 'structures', icon: 'icon.webp', texture: 'icon.webp'}],
        models: [{id: 'hospital', assetId: 'hospital', path: 'hospital.glb'}], metadata: {hospital: {}}, data: {},
        browserImageSources: [], modifications: [], visuals: [], maps: {resources: []}};
    const stored = new Map([[legacy.key, legacy]]);
    const prepare = output => prepareProductCatalog({assetsRoot, output: path.join(root, output), target, sources,
        existingInventory: {schemaVersion: 1, target, capturedAt: 'fixture', objects: [...stored.values()]}});
    const prepared = await prepare('first');
    const catalog = JSON.parse(await fs.readFile(path.join(prepared.directory, 'catalog.v1.json')));
    const resource = resolveNixieExperimentalProductCatalogResourcesV1(catalog).assets.find(row => row.path === 'models/hospital.base.glb');
    assert.equal(resource.sourcePath, 'foxhole-planner/objects/' + hash(model) + '.glb');
    assert.equal(JSON.stringify(catalog).includes('/releases/'), false);
    const transport = {head: async key => stored.get(key), put: async row => {assert.equal(stored.has(row.key), false); stored.set(row.key, row);}, putChannel: async row => {stored.set(row.key, row);}};
    await publishAssetPublication({planPath: prepared.planPath, transport});
    const next = await prepare('second');
    assert.equal(next.pin.catalog.sha256, prepared.pin.catalog.sha256);
    assert.equal((await publishAssetPublication({planPath: next.planPath, transport})).stats.uploaded, 0);
});
