import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateFoxholeProduction } from '../../app/plugins/foxhole/nixie/production/aggregation.ts';
import { clampFoxholeStructureProductionOrders, normalizeFoxholeStructureProductionOrders, resolveFoxholeStructureMaxOrders } from '../../app/plugins/foxhole/nixie/production/orders.ts';
import type { FoxholeProductionIndex, FoxholeProductionRecipe } from '../../app/plugins/foxhole/nixie/production/types.ts';
import type { FoxholeManifestStructure } from '../../app/plugins/foxhole/nixie/manifest.ts';
import { getFoxholeStructureCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeProductionIndex } from '../../app/plugins/foxhole/nixie/production/index.ts';

function recipe(partial: Partial<FoxholeProductionRecipe> & Pick<FoxholeProductionRecipe, 'id' | 'sourceStructureId'>): FoxholeProductionRecipe {
    return {
        sourceType: 'structure',
        sourceStructureKey: partial.sourceStructureId,
        sourceStructureName: partial.sourceStructureId,
        sourceSlotId: null,
        sourceSlotName: null,
        sourceVariantId: null,
        sourceVariantName: null,
        sourceModificationId: null,
        isUpgrade: false,
        durationSeconds: 10,
        powerDelta: -2,
        consumesResourceNodes: false,
        itemInput: {}, crateInput: {}, liquidInput: {}, itemOutput: {}, crateOutput: {}, liquidOutput: {}, buildOutput: {},
        ...partial,
    };
}

const currentRecipe = recipe({
    id: 'structure:factory:recipe:1',
    sourceStructureId: 'factory',
    itemInput: { metal: { quantity: 2, limit: null } },
    itemOutput: { bmats: { quantity: 1, limit: null } },
});
const parentRecipe = recipe({
    id: 'structure:basefactory:recipe:2',
    sourceStructureId: 'basefactory',
    durationSeconds: 5,
    powerDelta: -4,
    itemInput: { bmats: { quantity: 1, limit: null } },
    itemOutput: { shirts: { quantity: 3, limit: null } },
});
const index: FoxholeProductionIndex = {
    recipeById: { [currentRecipe.id]: currentRecipe, [parentRecipe.id]: parentRecipe },
    recipeIdsByOutput: {},
    structureRecipeIdsByStructureId: {},
    modificationRecipeIdsBySlotVariantKey: {},
    parentBuildTargetIdByTargetId: {},
};

test('normalizes and clamps persisted production orders', () => {
    assert.deepEqual(normalizeFoxholeStructureProductionOrders([
        { recipeId: 'a', parent: true, cycles: 3, label: ' Alpha ' },
        { recipeId: '', cycles: 4 },
        { recipeId: 'b', cycles: false, label: ' ' },
    ]), [
        { recipeId: 'a', parent: true, cycles: 3, label: 'Alpha' },
        { recipeId: 'b', parent: false, cycles: null, label: null },
    ]);
    assert.equal(clampFoxholeStructureProductionOrders([{ recipeId: 'a' }, { recipeId: 'b' }], 1).length, 1);
});

test('defaults standard facilities to five orders and large production to one', () => {
    assert.equal(resolveFoxholeStructureMaxOrders({ id: 'materialsFactory' }), 5);
    assert.equal(resolveFoxholeStructureMaxOrders({ id: 'facilityvehiclefactory2' }), 1);
    assert.equal(resolveFoxholeStructureMaxOrders({ id: 'factory', maxOrders: 6 }), 6);
});

test('aggregates finite parent and local orders with legacy netting and power', () => {
    const aggregate = aggregateFoxholeProduction({
        baseAssetsUrl: '/test/',
        intervalSeconds: 30,
        productionIndex: index,
        structureByKey: {
            factory: { id: 'factory', parentStructureId: 'basefactory', maxOrders: 2 } as unknown as FoxholeManifestStructure,
        },
        nodes: [{
            nodeId: 'node-1',
            state: {
                foxholeKey: 'factory',
                productionOrders: [
                    { recipeId: currentRecipe.id, parent: false, cycles: 2, label: null },
                    { recipeId: parentRecipe.id, parent: true, cycles: null, label: null },
                ],
            },
        }],
    });

    assert.equal(aggregate.activeOrderCount, 2);
    assert.equal(aggregate.powerMw, -0.004);
    assert.deepEqual(aggregate.inputs, [
        { channel: 'item', resourceId: 'bmats', quantity: 4 },
        { channel: 'item', resourceId: 'metal', quantity: 4 },
    ]);
    assert.deepEqual(aggregate.outputs, [{ channel: 'item', resourceId: 'shirts', quantity: 18 }]);
});

test('disabled production produces no statistics', () => {
    const aggregate = aggregateFoxholeProduction({
        baseAssetsUrl: '/test/', intervalSeconds: 60, productionIndex: index,
        structureByKey: { factory: { id: 'factory', maxOrders: 1 } as unknown as FoxholeManifestStructure },
        nodes: [{ nodeId: 'node-1', state: { foxholeKey: 'factory', disableProduction: true, productionOrders: [{ recipeId: currentRecipe.id }] } }],
    });
    assert.equal(aggregate.activeOrderCount, 0);
    assert.deepEqual(aggregate.inputs, []);
});

test('Petrol power plant exposes its selected 12 MW operating power for facility totals', () => {
    const baseAssetsUrl = '/foxhole/assets/';
    const catalog = getFoxholeStructureCatalog(baseAssetsUrl);
    const productionIndex = getFoxholeProductionIndex(baseAssetsUrl);
    const petrol = Object.values(productionIndex.recipeById).find(candidate => (
        candidate.sourceStructureId === 'facilitypowerdiesel' && candidate.powerDelta === 12000
    ));
    assert.ok(petrol?.sourceSlotId && petrol.sourceVariantId);
    assert.equal(catalog.structureByKey.facilitypowerdiesel?.powerGridInfo?.powerDelta, 5000);
    const aggregate = aggregateFoxholeProduction({
        baseAssetsUrl, productionIndex, structureByKey: catalog.structureByKey, intervalSeconds: 86400,
        nodes: [{
            nodeId: 'plant',
            state: {
                foxholeKey: 'facilitypowerdiesel',
                modificationVariantIds: { [petrol.sourceSlotId]: petrol.sourceVariantId },
                productionOrders: [{ recipeId: petrol.id }],
            },
        }],
    });
    assert.equal(aggregate.powerMw, 12);
    assert.deepEqual(aggregate.inputs, [{ channel: 'liquid', resourceId: 'Petrol', quantity: 48000 }]);
    assert.equal(aggregate.powerMwByNodeId.plant, 12);
});
