import assert from 'node:assert/strict';
import test from 'node:test';
import {
    foxholeHoldProfileRetainsCargoWhenPackaged,
    resolveFoxholeHoldProfileMarkedItemLimit,
    resolveSupportedMarkedItemCodenames,
    reconcileFoxholeAssetCargoPatch,
} from '../app/plugins/foxhole/nixie/hold-profile.ts';

test('cargo compatibility drops unsupported items before applying destination capacity', () => {
    assert.deepEqual(resolveSupportedMarkedItemCodenames({ mode: 'fuel-tank', allowedItems: ['Diesel', 'Petrol'] }, ['Concrete', 'Diesel', 'Petrol']), ['Diesel']);
    assert.deepEqual(resolveSupportedMarkedItemCodenames(null, ['Diesel']), []);
    assert.deepEqual(resolveSupportedMarkedItemCodenames({ mode: 'inventory', allowsAnyItem: true, capacity: 2 }, ['A', 'B', 'C']), ['A', 'B']);
    assert.deepEqual(reconcileFoxholeAssetCargoPatch({ structureByKey: {} }, { foxholeKey: 'source', markedItemCodenames: ['Diesel'] }, { foxholeKey: 'no-hold' }), { foxholeKey: 'no-hold', markedItemCodenames: [] });
});

test('foxholeHoldProfileRetainsCargoWhenPackaged covers stockpile-backed holds only', () => {
    assert.equal(foxholeHoldProfileRetainsCargoWhenPackaged(null), false);
    assert.equal(foxholeHoldProfileRetainsCargoWhenPackaged(undefined), false);
    assert.equal(foxholeHoldProfileRetainsCargoWhenPackaged({ mode: 'inventory', capacity: 15 }), false);
    assert.equal(foxholeHoldProfileRetainsCargoWhenPackaged({ mode: 'stockpile', capacity: 120 }), true);
    assert.equal(foxholeHoldProfileRetainsCargoWhenPackaged({ mode: 'crate-stockpile', capacity: 60, allowsAnyItem: true }), true);
    assert.equal(foxholeHoldProfileRetainsCargoWhenPackaged({ mode: 'fuel-tank' }), true);
});

test('resolveFoxholeHoldProfileMarkedItemLimit still treats inventory and crate stockpiles as capped', () => {
    assert.equal(resolveFoxholeHoldProfileMarkedItemLimit({ mode: 'inventory', capacity: 5 }), 5);
    assert.equal(resolveFoxholeHoldProfileMarkedItemLimit({ mode: 'crate-stockpile', capacity: 60 }), 60);
    assert.equal(resolveFoxholeHoldProfileMarkedItemLimit({ mode: 'fuel-tank' }), 1);
    assert.equal(resolveFoxholeHoldProfileMarkedItemLimit({ mode: 'stockpile', capacity: 120 }), null);
});
