import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeStructureAsset } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeHoverCostPresentation } from '../app/plugins/foxhole/nixie/asset-hover-cost.ts';

function variant(key: string, id: string) {
    const asset = getFoxholeStructureAsset(key, '/foxhole/assets/');
    assert.ok(asset);
    const source = asset.modificationSlots.flatMap(slot => slot.variants).find(entry => entry.id === id);
    assert.ok(source, `${key}/${id}`);
    return source;
}

test('Sandbags hover shows one sandbag separately from storage-room construction', () => {
    const card = resolveFoxholeHoverCostPresentation(variant('ammoroomt2', 'sandbags'), true);
    assert.deepEqual(Object.values(card.primaryCost).map(resource => resource.quantity), [1]);
    assert.equal(Object.values(card.totalCost!).reduce((total, resource) => total + resource.quantity, 0), 36);
    assert.equal(card.heading, 'Modification Cost');
    assert.equal(card.showHostAttributes, false);
});

test('trench roof hover separates 200 materials from the full build total', () => {
    for (const key of ['trencht3', 'trenchintt3']) {
        const card = resolveFoxholeHoverCostPresentation(variant(key, 'trenchroof'), true);
        assert.deepEqual(Object.entries(card.primaryCost).map(([resourceKey, value]) => [resourceKey, value.quantity]), [['Cloth', 200]]);
        assert.deepEqual(Object.values(card.totalCost!).map(resource => resource.quantity).sort((a, b) => a - b), [10, 75, 250]);
    }
});

test('standalone structure cards retain construction totals and host attributes', () => {
    const asset = getFoxholeStructureAsset('trencht3', '/foxhole/assets/')!;
    const card = resolveFoxholeHoverCostPresentation(asset, false);
    assert.deepEqual(card.primaryCost, asset.totalCost);
    assert.equal(card.totalCost, null);
    assert.equal(card.heading, null);
    assert.equal(card.showHostAttributes, true);
});

test('upgrade and free modification prices do not fall back to host cost', () => {
    const cost = { Cloth: { quantity: 50 } };
    const totalCost = { Cloth: { quantity: 200 } };
    assert.deepEqual(resolveFoxholeHoverCostPresentation({ cost, totalCost, isUpgrade: true }, true),
        { primaryCost: cost, totalCost, heading: 'Upgrade Cost', showHostAttributes: false });
    assert.deepEqual(resolveFoxholeHoverCostPresentation({ cost: {}, totalCost }, true).primaryCost, {});
    assert.equal(resolveFoxholeHoverCostPresentation(null, false).totalCost, null);
});

test('concrete foundation separates its upgrade price from the wooden foundation build total', () => {
    const asset = getFoxholeStructureAsset('foundation012x2t3', '/foxhole/assets/')!;
    assert.equal(asset.downgradeStructureId, 'foundation012x2t1');
    const card = resolveFoxholeHoverCostPresentation(asset, false, Boolean(asset.downgradeStructureId));
    assert.deepEqual(Object.entries(card.primaryCost).map(([key, resource]) => [key, resource.quantity]), [['Concrete', 15]]);
    assert.deepEqual(Object.entries(card.totalCost!).map(([key, resource]) => [key, resource.quantity]), [['GroundMaterials', 150], ['Concrete', 15]]);
    assert.equal(card.heading, 'Upgrade Cost');
    assert.equal(card.showHostAttributes, true);
    const wooden = getFoxholeStructureAsset('foundation012x2t1', '/foxhole/assets/')!;
    const baseCard = resolveFoxholeHoverCostPresentation(wooden, false, Boolean(wooden.downgradeStructureId));
    assert.equal(baseCard.heading, null);
    assert.equal(baseCard.totalCost, null);
    assert.deepEqual(baseCard.primaryCost, wooden.cost);
});
