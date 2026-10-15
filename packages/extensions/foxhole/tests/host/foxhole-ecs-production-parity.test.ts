import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateFoxholeEcsProduction } from '../../../../../extensions/foxhole-planner/src/production-statistics.ts';
import assets, { productionRecipesById } from '../../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { getFoxholeManifest } from '../../app/plugins/foxhole/nixie/manifest.ts';
import { getFoxholeProductionIndex } from '../../app/plugins/foxhole/nixie/production/index.ts';
import { aggregateFoxholeProduction } from '../../app/plugins/foxhole/nixie/production/aggregation.ts';
import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalComponentJsonObjectV1 } from '@nixie/extension-sdk';

const manifest = getFoxholeManifest('/foxhole/assets/');
const index = getFoxholeProductionIndex('/foxhole/assets/');
const structures = Object.fromEntries(manifest.assets.map(asset => [asset.id, asset]));
const quantities = (source: Record<string, { quantity: number; }>) => Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value.quantity]));

test('SDK production catalog matches every bundled structure/modification conversion recipe', () => {
    const native = Object.values(index.recipeById).filter(recipe => !recipe.id.startsWith('build:'));
    assert.deepEqual(Object.keys(productionRecipesById).sort(), native.map(recipe => recipe.id).sort());
    for (const recipe of native) {
        assert.deepEqual(productionRecipesById[recipe.id], { id: recipe.id, sourceType: recipe.sourceType,
            sourceStructureId: recipe.sourceStructureId, sourceVariantId: recipe.sourceVariantId, durationSeconds: recipe.durationSeconds,
            powerDelta: recipe.powerDelta, itemInput: quantities(recipe.itemInput), crateInput: quantities(recipe.crateInput), liquidInput: quantities(recipe.liquidInput),
            itemOutput: quantities(recipe.itemOutput), crateOutput: quantities(recipe.crateOutput), liquidOutput: quantities(recipe.liquidOutput) }, recipe.id);
    }
});

test('ECS production totals match bundled calculations across the complete catalog and intervals', () => {
    const nativeNodes = manifest.assets.map(asset => ({ nodeId: asset.id, state: { foxholeKey: asset.id,
        productionOrders: Object.values(index.recipeById).filter(recipe => recipe.sourceStructureId === asset.id && !recipe.id.startsWith('build:'))
            .map((recipe, position) => ({ recipeId: recipe.id, cycles: position % 2 === 0 ? 3 : null, parent: false })),
        modificationVariantIds: Object.fromEntries(Object.values(asset.modifications).flatMap(slot => Object.keys(slot.variants).map((variantId, position) => [`${slot.name}:${position}`, variantId]))) } }));
    const entities: NixieExperimentalComponentEntitySnapshotV1[] = nativeNodes.map(node => ({ entityId: node.nodeId, revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId: node.state.foxholeKey } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'production-order', version: 1, definitionAvailable: true,
            data: { orders: node.state.productionOrders.map((order, position) => ({ id: String(position), recipeId: order.recipeId, parent: order.parent,
                ...(order.cycles === null ? {} : { cycles: order.cycles }) })) } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true,
            data: { selections: Object.entries(node.state.modificationVariantIds).map(([slotId, variantId]) => ({ slotId, variantId })) } as NixieExperimentalComponentJsonObjectV1 },
    ] }));
    const before = structuredClone(entities);
    for (const intervalSeconds of [30, 900, 3600, 259200]) {
        const expected = aggregateFoxholeProduction({ nodes: nativeNodes, structureByKey: structures, baseAssetsUrl: '/foxhole/assets/', intervalSeconds, productionIndex: index });
        const actual = aggregateFoxholeEcsProduction(entities, assets, productionRecipesById, intervalSeconds);
        assert.deepEqual({ inputs: actual.inputs, outputs: actual.outputs, activeOrderCount: actual.activeOrderCount, powerMw: actual.powerMw },
            { inputs: expected.inputs, outputs: expected.outputs, activeOrderCount: expected.activeOrderCount, powerMw: expected.powerMw }, `interval ${intervalSeconds}`);
        assert.deepEqual(actual.orders, expected.orders.map(order => ({ entityId: order.nodeId, recipeId: order.recipeId, completedCycles: order.completedCycles })));
    }
    assert.deepEqual(entities, before);
});
