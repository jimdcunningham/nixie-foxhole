import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateFoxholeEcsProduction, createFoxholeStatisticsRecipe } from '../src/production-statistics.ts';
import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalComponentJsonObjectV1 } from '@nixie/extension-sdk/experimental/scene-v2';

const ownerId = 'nixie.foxhole-planner';
const entity = (id: string, assetId: string, orders: NixieExperimentalComponentJsonObjectV1[], disabled = false, variants: string[] = []): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId: id, revision: 1,
    components: [{ ownerId, componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId } },
        { ownerId, componentId: 'production-order', version: 1, definitionAvailable: true, data: { orders, disabled } },
        { ownerId, componentId: 'modification', version: 1, definitionAvailable: true, data: { selections: variants.map(variantId => ({ slotId: 'slot', variantId })) } }] });

test('production totals preserve recipe ownership, cycle limits, channel netting and per-structure power', () => {
    const recipes = { make: createFoxholeStatisticsRecipe('make', 'factory', { d: 60, p: -4000, ii: { Input: { q: 2 } }, io: { Output: { q: 3 } } }),
        use: createFoxholeStatisticsRecipe('use', 'factory', { d: 60, p: -6000, ii: { Output: { q: 1 } }, co: { Output: { q: 2 } } }),
        upgrade: createFoxholeStatisticsRecipe('upgrade', 'factory', { d: 60, p: -8000, lo: { Water: { q: 1 } } }, 'selected') };
    const entities = [entity('one', 'factory', [{ recipeId: 'make', cycles: 2 }, { recipeId: 'use', cycles: 1 }, { recipeId: 'upgrade' }]),
        entity('disabled', 'factory', [{ recipeId: 'make' }], true)];
    const before = structuredClone(entities);
    const result = aggregateFoxholeEcsProduction(entities, { factory: { production: {} } }, recipes, 120);
    assert.equal(result.activeOrderCount, 2);
    assert.equal(result.powerMw, -6);
    assert.deepEqual(result.inputs, [{ channel: 'item', resourceId: 'Input', quantity: 4 }]);
    assert.deepEqual(result.outputs, [{ channel: 'crate', resourceId: 'Output', quantity: 2 }, { channel: 'item', resourceId: 'Output', quantity: 5 }]);
    assert.deepEqual(entities, before);
    const modified = aggregateFoxholeEcsProduction([entity('one', 'factory', [{ recipeId: 'upgrade' }], false, ['selected'])], { factory: {} }, recipes, 120);
    assert.equal(modified.outputs[0]!.quantity, 2);
    assert.equal(modified.powerMw, -8);
});

test('production totals honor parent recipes, structure order capacity, sub-cycle intervals and idle exceptions', () => {
    const recipes = { parent: createFoxholeStatisticsRecipe('parent', 'base', { duration: 60, itemOutput: { Item: { quantity: 1 } } }),
        own: createFoxholeStatisticsRecipe('own', 'child', { duration: 60, itemOutput: { Item: { quantity: 2 } } }) };
    const assets = { child: { production: { parentStructureId: 'base', maxOrders: 1 } }, fieldmodificationcenter: { production: { powerDelta: -3000 } } };
    const result = aggregateFoxholeEcsProduction([entity('child', 'child', [{ recipeId: 'parent', parent: true }, { recipeId: 'own' }]), entity('idle', 'fieldmodificationcenter', [])], assets, recipes, 120);
    assert.equal(result.activeOrderCount, 1);
    assert.equal(result.outputs[0]!.quantity, 2);
    assert.equal(result.powerMw, -3);
    assert.equal(aggregateFoxholeEcsProduction([entity('short', 'child', [{ recipeId: 'own' }])], assets, recipes, 59).activeOrderCount, 0);
});
