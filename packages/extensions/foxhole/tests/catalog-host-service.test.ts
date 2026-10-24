import { readFileSync } from 'node:fs';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { listFoxholeSceneV2Products } from '../../../../extensions/foxhole-planner/src/scene-v2-products.ts';

import { resolveNixieSdkCatalogAsset } from '#nixie/utils/nixie-sdk-catalog-assets.ts';

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNixieExtensionProductCatalog, registerNixieExtensionProductCatalog } from '#nixie/utils/nixie-extension-product-catalog.ts';
import { replaceNixieSceneV2ExtensionCatalog, useNixieSceneV2ExtensionCatalog } from '#nixie-internal/desktop-extensions/scene-v2-extension-catalog.ts';
import type { NixieSceneV2ExtensionCatalogEntry } from '#nixie-internal/desktop-extensions/scene-v2-extension-catalog.ts';
import { getFoxholeStructureAsset, getFoxholeStructureCatalog, getFoxholeItemCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
const entry = (generationHash: string): NixieSceneV2ExtensionCatalogEntry => ({ ownerId: 'nixie.foxhole-planner',
    name: 'Foxhole', revision: generationHash, generationHash, contribution: { contractVersion: 1, components: [] },
    products: [], productProviders: [], renderers: [], transformFinalizers: [], resources: [], resourceTemplates: [] });
test('Inspector, upgrades, scene, and item callers share activation-owned catalog indexes', () => {
    const service = createNixieExtensionProductCatalog({ catalog: useNixieSceneV2ExtensionCatalog(), getPort: () => null,
        readSetting: (_id, fallback) => fallback, canCreateSnapshot: () => true, createSnapshot: async () => null });
    const unregister = registerNixieExtensionProductCatalog(service);
    try {
        replaceNixieSceneV2ExtensionCatalog([entry('first')]);
        const structures = getFoxholeStructureCatalog('/foxhole/assets/');
        const items = getFoxholeItemCatalog('/foxhole/assets/');
        assert.equal(structures, getFoxholeStructureCatalog('/foxhole/assets/'));
        assert.equal(items, getFoxholeItemCatalog('/foxhole/assets/'));
        const key = Object.keys(structures.assetByKey)[0]!;
        assert.equal(getFoxholeStructureAsset(key, '/foxhole/assets/'), structures.assetByKey[key]);
        assert.equal(service.domainData('nixie.foxhole-planner', 'structures:/foxhole/assets/', () => null), structures);
        replaceNixieSceneV2ExtensionCatalog([entry('replacement')]);
        assert.notEqual(getFoxholeStructureCatalog('/foxhole/assets/'), structures);
        assert.notEqual(getFoxholeItemCatalog('/foxhole/assets/'), items);
        const replacement = getFoxholeStructureCatalog('/foxhole/assets/');
        replaceNixieSceneV2ExtensionCatalog([]);
        replaceNixieSceneV2ExtensionCatalog([entry('replacement')]);
        assert.notEqual(getFoxholeStructureCatalog('/foxhole/assets/'), replacement);
    } finally { unregister(); service.destroy(); replaceNixieSceneV2ExtensionCatalog([]); }
});

test('the complete index includes hidden assets and upgrades without overriding presentation preferences', () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8')));
    const settings = { 'foxhole.locale': 'fr',
        'foxhole.assets.browser.iconSet': 'rendered', 'foxhole.assets.filter.upgrades': false,
        'foxhole.assets.filter.category.facilities': false, 'foxhole.assets.filter.faction': 'colonial', ...manifest.contributes.experimentalProductProviders![0]!.indexSettings };
    assert.equal(settings['foxhole.locale'], 'fr');
    assert.equal(settings['foxhole.assets.browser.iconSet'], 'rendered');
    assert.equal(settings['foxhole.assets.filter.upgrades'], true);
    assert.equal(settings['foxhole.assets.filter.category.facilities'], true);
    assert.equal(settings['foxhole.assets.filter.faction'], 'all');
});

test('the real Planner index retains hidden upgrades and resolves them without another provider request', async () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8')));
    const active = { ...entry('real-index'), contribution: manifest.contributes.experimentalComponents!,
        productProviders: manifest.contributes.experimentalProductProviders!, settings: manifest.contributes.settings,
        resources: manifest.contributes.experimentalResources ?? [], resourceTemplates: manifest.contributes.experimentalResourceTemplates ?? [] };
    replaceNixieSceneV2ExtensionCatalog([active]);
    let calls = 0;
    const service = createNixieExtensionProductCatalog({ catalog: useNixieSceneV2ExtensionCatalog(), eager: true,
        getPort: () => ({ listSceneV2Products: async (_owner, _generation, _system, query) => { calls++; return listFoxholeSceneV2Products(query); } }),
        readSetting: (id, fallback) => id === 'foxhole.assets.filter.upgrades' ? false : fallback,
        canCreateSnapshot: () => true, createSnapshot: async () => null });
    const unregister = registerNixieExtensionProductCatalog(service);

    try {
        await service.ensure();
        const visible = Object.values(service.pages.value).flatMap(page => page.items);
        assert.ok(visible.length > 0);
        assert.ok(!visible.some(item => item.product.id.startsWith('upgrade.')));
        assert.ok(service.records.value.size > visible.length);
        const upgrade = [...service.records.value.values()].find(record => record.item.product.id.startsWith('upgrade.'))!;
        assert.ok(upgrade);
        const before = calls;
        const resolved = await resolveNixieSdkCatalogAsset('sdk.nixie.foxhole-planner__assets', upgrade.item.product.id);
        assert.equal(resolved!.item.product.id, upgrade.item.product.id);
        assert.equal(calls, before);
    } finally { unregister(); service.destroy(); replaceNixieSceneV2ExtensionCatalog([]); }
});

test('SDK products request transforms without a registered bundled capability policy', async () => {
    const { resolveNixieSceneV2ProductCapabilities } = await import('#nixie-internal/desktop-extensions/scene-v2-capabilities.ts');
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8')));
    const definitions = new Map(manifest.contributes.experimentalComponents!.components.map(component => [manifest.id + '\0' + component.id, component]));
    for (const query of ['facilitypipe', 'tank', 'rifle']) {
        const page = listFoxholeSceneV2Products({ contractVersion: 1, query, offset: 0, limit: 100,
            settings: manifest.contributes.experimentalProductProviders![0]!.indexSettings });
        assert.ok(page.items.length > 0, query);
        for (const item of page.items) {
            assert.deepEqual(item.product.interactionProfile, { move: true, rotate: true }, item.product.id);
            const capabilities = resolveNixieSceneV2ProductCapabilities(item.product, manifest.id, definitions);
            assert.ok(capabilities.includes('move'), item.product.id);
            assert.ok(capabilities.includes('rotate'), item.product.id);
            assert.ok(!capabilities.includes('scale'), item.product.id);
            assert.ok(!capabilities.includes('mirror'), item.product.id);
        }
    }
    for (const product of manifest.contributes.experimentalProducts ?? []) {
        if (product.components.some(component => component.ownerId === manifest.id && component.componentId === 'asset')) {
            assert.deepEqual(product.interactionProfile, { move: true, rotate: true }, product.id);
        }
    }
});
