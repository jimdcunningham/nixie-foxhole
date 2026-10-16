import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupFoxholeSdkCatalogReference, createFoxholeSdkCatalogSnapshot } from '../app/utils/sdk-catalog-compatibility.ts';
import { listFoxholeSceneV2Products } from '../../../../extensions/foxhole-planner/src/scene-v2-products.ts';
import metadata from '../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { convertFoxholeSceneV1NodeToV2 } from '../app/plugins/foxhole/nixie/scene-v2-conversion.ts';
import { convertNixieSceneV1ToV2 } from '../../../nixie/desktop-extensions/scene-v2-conversion.ts';
import { registerFoxholeSceneV2HostPolicy } from '../app/utils/scene-v2-host-policy.ts';
registerFoxholeSceneV2HostPolicy();
const owner = 'nixie.foxhole-planner';
async function resolve(reference: string) {
    const lookup = await lookupFoxholeSdkCatalogReference('foxhole.structures', reference);
    assert.ok(lookup, reference);
    const result = listFoxholeSceneV2Products({ contractVersion: 1, query: lookup.query, settings: lookup.settings, offset: 0, limit: 100 });
    const item = result.items.find(item => lookup.matches(item.product));
    assert.ok(item, reference);
    return { ...item, product: lookup.adapt?.(item.product) ?? item.product };
}

test('legacy and SDK catalog references resolve actual canonical products without Explorer filters', async () => {
    for (const reference of ['worldroad', 'asset.greatmarchroad', '#sdk.nixie.foxhole-planner__assets:asset.greatmarchroad',
        'registry-asset:foxhole.structures:worldroad', 'item:cloth']) {
        const item = await resolve(reference);
        assert.equal(item.product.components.find(c => c.ownerId === owner && c.componentId === 'asset')?.data.assetId,
            reference === 'item:cloth' ? 'cloth' : 'greatmarchroad');
    }
    assert.equal(await lookupFoxholeSdkCatalogReference('foxhole.structures', 'missing-asset'), null);
    const destroyed = await resolve('facilityfactoryammo:destroyed');
    assert.equal(destroyed.product.components.find(c => c.componentId === 'appearance')?.data.destroyed, true);
    for (const [id, asset] of Object.entries(metadata)) {
        for (const [slotId, slot] of Object.entries(asset.modifications)) {
            for (const [variantId, variant] of Object.entries(slot.variants)) {
                if (!variant.isUpgrade) continue;
                const legacy = await resolve(`upgrade:${id}:${slotId}:${variantId}`);
                assert.deepEqual((await resolve(legacy.product.id)).product, legacy.product);
                return;
            }
        }
    }
    assert.fail('catalog must include an upgrade');
});

test('every published canonical asset remains reachable through its historical code name and keys', async () => {
    for (const asset of getFoxholeManifest('/foxhole/assets/').assets) {
        const lookup = await lookupFoxholeSdkCatalogReference('foxhole.structures', asset.id);
        assert.ok(lookup, asset.id);
        const page = listFoxholeSceneV2Products({ contractVersion: 1, query: lookup.query, settings: lookup.settings, offset: 0, limit: 100 });
        assert.ok(page.items.some(item => lookup.matches(item.product)), asset.id);
        for (const alias of [asset.codeName, ...(asset.legacyKeys ?? [])].filter(Boolean)) {
            const historical = await lookupFoxholeSdkCatalogReference('foxhole.structures', alias!);
            // Ambiguous aliases intentionally remain unresolved; exact canonical identities win.
            if (historical) assert.ok(historical.query in metadata, alias!);
        }
    }
});

test('SDK products insert into V1 and convert back with canonical identity, models, appearance and upgrades', async () => {
    const upgrade = Object.entries(metadata).flatMap(([id, asset]) => Object.entries(asset.modifications).flatMap(([slotId, slot]) => Object.entries(slot.variants).filter(([, variant]) => variant.isUpgrade).map(([variantId]) => `upgrade:${id}:${slotId}:${variantId}`)))[0]!;
    for (const reference of ['truckc', 'factory', 'facilityfactoryammo:destroyed', 'item:cloth', 'facilitypipeoverhead',
        upgrade]) {
        const item = await resolve(reference);
        const snapshot = await createFoxholeSdkCatalogSnapshot(item.product, item.label, { x: 123, y: 456, z: 7 });
        assert.ok(snapshot, reference);
        assert.equal(snapshot.state.x, 123, reference);
        assert.equal(snapshot.state.y, 456, reference);
        const before = structuredClone(snapshot);
        const converted = convertNixieSceneV1ToV2([snapshot], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
        assert.equal(converted.report.preservedOnlyNodeCount, 0, JSON.stringify(converted.report));
        const components = converted.content.entities[0]!.components;
        assert.deepEqual(components.find(c => c.ownerId === owner && c.componentId === 'asset')?.data,
            item.product.components.find(c => c.ownerId === owner && c.componentId === 'asset')?.data, reference);
        for (const id of ['model', 'modification']) {
            const original = item.product.components.find(c => c.ownerId === owner && c.componentId === id);
            if (original && (id !== 'modification' || (original.data.selections as unknown[]).length)) assert.deepEqual(components.find(c => c.ownerId === owner && c.componentId === id)?.data, original.data, reference);
        }
        if (reference.endsWith(':destroyed')) assert.equal(components.find(c => c.componentId === 'appearance')?.data.destroyed, true);
        assert.deepEqual(snapshot, before);
    }
});
