import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
    FOXHOLE_ASSET_COMPONENT_ID,
    FOXHOLE_APPEARANCE_COMPONENT_ID,
    FOXHOLE_CARGO_COMPONENT_ID,
    FOXHOLE_COMPONENT_OWNER_ID,
    FOXHOLE_MODIFICATION_COMPONENT_ID,
    FOXHOLE_PRODUCTION_ORDER_COMPONENT_ID,
    FOXHOLE_SOCKET_ATTACHMENTS_COMPONENT_ID,
    createFoxholeFacilityProductionProductV1,
    getFoxholeFacilityProductV1,
} from '../src/production-components.ts';

const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, '../nixie.extension.json'), 'utf8')) as unknown;

test('uses the extension manifest as the canonical schema and product source', () => {
    const product = getFoxholeFacilityProductV1(manifest);
    assert.deepEqual(product.components.map(component => component.componentId), [
        FOXHOLE_ASSET_COMPONENT_ID,
        FOXHOLE_APPEARANCE_COMPONENT_ID,
        FOXHOLE_MODIFICATION_COMPONENT_ID,
        FOXHOLE_CARGO_COMPONENT_ID,
        FOXHOLE_SOCKET_ATTACHMENTS_COMPONENT_ID,
        FOXHOLE_PRODUCTION_ORDER_COMPONENT_ID,
    ]);
    assert.deepEqual(product.components.map(component => component.data), [{
        catalogId: 'foxhole.structures',
        assetId: 'facilityfactoryammo',
    }, {}, { selections: [] }, { items: [] }, { attachments: [] }, { orders: [] }]);
});

test('stores only catalog IDs and component-local selections and orders', () => {
    const product = createFoxholeFacilityProductionProductV1(manifest, {
        selections: [{ slotId: 'upgrade', variantId: 'flame-line' }],
        orders: [{
            id: 'order-1',
            recipeId: 'structure:facilityfactoryammo:recipe:0',
            parent: true,
            cycles: 2,
            label: 'Front stockpile',
        }],
    });
    const persistedEntity = {
        entityId: 'facility-1',
        revision: 1,
        components: product.components,
    };
    const serialized = JSON.stringify(persistedEntity);
    assert.ok(serialized.length < 1_024, `expected a small entity record, received ${serialized.length} bytes`);
    for (const forbidden of ['schema', 'productId', 'recipeBody', 'texture', 'sprite', 'conversionEntries']) {
        assert.equal(serialized.includes(forbidden), false);
    }
    assert.deepEqual(persistedEntity.components.find(component => (
        component.componentId === FOXHOLE_PRODUCTION_ORDER_COMPONENT_ID
    )), {
        ownerId: FOXHOLE_COMPONENT_OWNER_ID,
        componentId: FOXHOLE_PRODUCTION_ORDER_COMPONENT_ID,
        version: 1,
        data: {
            orders: [{
                id: 'order-1',
                recipeId: 'structure:facilityfactoryammo:recipe:0',
                parent: true,
                cycles: 2,
                label: 'Front stockpile',
            }],
        },
    });
});

test('treats omitted production cycles as an unlimited order', () => {
    const product = createFoxholeFacilityProductionProductV1(manifest, {
        orders: [{
            id: 'order-unlimited',
            recipeId: 'structure:facilityfactoryammo:recipe:0',
        }],
    });
    assert.deepEqual(product.components.find(component => (
        component.componentId === FOXHOLE_PRODUCTION_ORDER_COMPONENT_ID
    ))?.data, {
        orders: [{
            id: 'order-unlimited',
            recipeId: 'structure:facilityfactoryammo:recipe:0',
        }],
    });
});

test('validates authored state against the manifest-owned definitions', () => {
    assert.throws(() => createFoxholeFacilityProductionProductV1(manifest, {
        orders: [{
            id: 'order-1',
            recipeId: 'recipe.120mm',
            cycles: 0,
        }],
    }), /must be at least 1/);
});
