import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {parseNixieExtensionManifestV1} from '@nixiejs/extension-sdk';
import {parseNixieExperimentalProductCatalogV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
import {createCatalogRuntimeManifest} from '../build/catalog-runtime-manifest.ts';
test('generated catalogs bind stable base, variant, and shared model IDs without changing authored bytes', async () => {
    const original = await readFile(new URL('../nixie.extension.json', import.meta.url), 'utf8');
    const authored = parseNixieExtensionManifestV1(JSON.parse(original)), before = JSON.stringify(authored);
    const receipt = {sha256: 'a'.repeat(64), byteLength: 123};
    const catalog = parseNixieExperimentalProductCatalogV1({catalogSchemaVersion: 1, assetRelease: 'v1', releaseRoot: 'planner/releases/v1/',
        resourceDefaults: {model: {pathTemplate: 'types/{assetGroup}/{id}/{id}.{variant}.glb', resourcePathTemplate: 'models/{id}.{variant}.glb', variant: 'base', mediaType: 'model/gltf-binary'}},
        products: [{id: 'powerpole', assetGroup: 'structures', resources: {model: [{...receipt, dependencies: ['shared.connector']}, {...receipt, variant: 'upgrade.coal'}]}}],
        sharedResources: [{id: 'shared.connector', path: 'shared/models/connector.glb', ...receipt, mediaType: 'model/gltf-binary'}]});
    const built = parseNixieExtensionManifestV1(createCatalogRuntimeManifest(authored, catalog, {baseUrl: 'https://assets.test/', catalog: receipt}));
    assert.deepEqual(built.contributes.experimentalResources?.map(row => [row.id, row.path]), [
        ['foxhole.model.powerpole', 'models/powerpole.base.glb'], ['foxhole.model.powerpole.upgrade.coal', 'models/powerpole.upgrade.coal.glb'],
        ['foxhole.model.shared.connector', 'shared/models/connector.glb'],
    ]);
    assert.equal(built.contributes.experimentalAssetPacks, undefined);
    assert.equal(built.contributes.experimentalProductCatalogs?.[0]?.document.path, 'dist/catalog.v1.json');
    assert.ok(built.contributes.experimentalResourceTemplates?.every(row => row.assetPack === 'foxhole.catalog'));
    assert.equal(JSON.stringify(authored), before);
    assert.equal(await readFile(new URL('../nixie.extension.json', import.meta.url), 'utf8'), original);
});
