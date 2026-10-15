import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseNixieExtensionManifestV1 } from '@nixie/extension-sdk';
import { parseNixieExperimentalProductResultV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { NixieSceneV2ComponentHost } from '../../../../nixie/desktop-extensions/scene-v2-component-host.ts';
import { NIXIE_SCENE_V2_CORE_COMPONENTS, NIXIE_SCENE_V2_CORE_OWNER_ID } from '../../../../nixie/desktop-extensions/scene-v2-core-components.ts';
import { listFoxholeSceneV2Products, matchesFoxholeSceneV2ProductFilters } from '../../../../../extensions/foxhole-planner/src/scene-v2-products.ts';
import foxholeAssets from '../../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { matchesFoxholeFactionFilter, matchesFoxholeTierFilter, matchesFoxholeUpgradeFilter, matchesFoxholeDestroyedFilter,
    matchesFoxholeBreachedFilter, matchesFoxholeCategoryFilter, matchesFoxholeVehicleFilter } from '../../app/plugins/foxhole/nixie/assets-browser.ts';
import type { NixieResolvedAssetEntry, NixieAssetBrowserContext } from '../../../../nixie/app/plugins/nixie/registry/types.ts';
import { listDiagramProducts } from '../../../../../extensions/scene-v2-diagram/src/scene-v2.ts';

for (const { name, listProducts } of [
    { name: 'foxhole-planner', listProducts: listFoxholeSceneV2Products },
    { name: 'scene-v2-diagram', listProducts: listDiagramProducts },
]) {
    test(`${name} provider products satisfy the actual Nixie core and extension schemas`, () => {
        const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(
            hostSourceUrl(`../../../../../extensions/${name}/nixie.extension.json`, import.meta.url), 'utf8',
        )));
        let total = 1;
        let checked = 0;
        for (let offset = 0; offset < total; offset += 50) {
            const page = listProducts({ contractVersion: 1, query: '', offset, limit: 50 });
            total = page.total;
            for (const item of page.items) {
                const host = new NixieSceneV2ComponentHost();
                host.registerExtension(NIXIE_SCENE_V2_CORE_OWNER_ID, NIXIE_SCENE_V2_CORE_COMPONENTS);
                host.registerExtension(manifest.id, manifest.contributes.experimentalComponents);
                assert.doesNotThrow(() => host.instantiateProduct(`product-${checked}`, item.product), item.product.id);
                checked += 1;
            }
        }
        assert.ok(checked > 0);
        assert.equal(checked, total);
    });
}

test('SDK filter decisions preserve the Native predicates across the full catalog and representative preference combinations', () => {
    for (const overrides of [{}, { tier: '1' }, { tier: '2', showPreviousTiers: true }, { faction: 'c' }, { faction: 'w' },
        { upgrades: true, destroyed: true }, { 'breached': true, 'category.world': false, 'category.bunkers': false },
        { 'category.items': false, 'category.facilities': false }, { 'category.vehicles': false, 'destroyed': true }]) {
        const settings: Record<string, boolean | string> = Object.fromEntries(Object.entries({ 'faction': 'all', 'tier': '3',
            'showPreviousTiers': false, 'upgrades': false, 'destroyed': false, 'breached': false,
            'category.bunkers': true, 'category.facilities': true, 'category.vehicles': true, 'category.world': true, 'category.items': true,
            ...overrides }).map(([key, value]) => [`foxhole.assets.filter.${key}`, value]));
        const context = { getSetting: (id: string) => settings[id] } as NixieAssetBrowserContext;
        for (const [id, metadata] of Object.entries(foxholeAssets)) {
            const entry = { sourceId: 'foxhole.structures', asset: { metadata: { ...metadata,
                upgradeStructureCodeName: metadata.implicitUpgradeTier == null ? undefined : `TargetT${metadata.implicitUpgradeTier}` } } } as unknown as NixieResolvedAssetEntry;
            const native = matchesFoxholeFactionFilter(entry, settings['foxhole.assets.filter.faction'])
                && matchesFoxholeTierFilter(entry, settings['foxhole.assets.filter.tier'], context)
                && matchesFoxholeUpgradeFilter(entry, settings['foxhole.assets.filter.upgrades'])
                && matchesFoxholeDestroyedFilter(entry, settings['foxhole.assets.filter.destroyed'], context)
                && matchesFoxholeBreachedFilter(entry, settings['foxhole.assets.filter.breached'], context)
                && matchesFoxholeVehicleFilter(entry, settings['foxhole.assets.filter.category.vehicles'], context)
                && ['bunkers', 'facilities', 'world', 'items'].every(category => matchesFoxholeCategoryFilter(entry,
                    settings[`foxhole.assets.filter.category.${category}`], category, context));
            assert.equal(matchesFoxholeSceneV2ProductFilters(metadata, settings), native, `${id} ${JSON.stringify(overrides)}`);
        }
    }
});

test('all filtered upgrade products satisfy the real core/owner schemas and keep product IDs unique across pages', () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(
        hostSourceUrl('../../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8',
    )));
    const settings = { 'foxhole.assets.filter.upgrades': true, 'foxhole.assets.filter.showPreviousTiers': true,
        'foxhole.assets.filter.destroyed': true, 'foxhole.assets.filter.breached': true };
    const ids = new Set<string>();
    let total = 1;
    let upgrades = 0;
    for (let offset = 0; offset < total; offset += 50) {
        const page = parseNixieExperimentalProductResultV1(listFoxholeSceneV2Products({ contractVersion: 1, query: '', offset, limit: 50, settings }));
        total = page.total;
        for (const item of page.items) {
            assert.equal(ids.has(item.product.id), false, item.product.id);
            ids.add(item.product.id);
            if (item.product.id.startsWith('upgrade.')) {
                upgrades += 1;
            }
            const host = new NixieSceneV2ComponentHost();
            host.registerExtension(NIXIE_SCENE_V2_CORE_OWNER_ID, NIXIE_SCENE_V2_CORE_COMPONENTS);
            host.registerExtension(manifest.id, manifest.contributes.experimentalComponents);
            assert.doesNotThrow(() => host.instantiateProduct(`filtered-${ids.size}`, item.product), item.product.id);
        }
    }
    assert.ok(upgrades > 0);
    assert.equal(ids.size, total);
});
