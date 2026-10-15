import assert from 'node:assert/strict';
import test from 'node:test';
import {
    formatFoxholeMaintenanceIntervalLabel,
    normalizeFoxholeCustomIntervalSeconds,
    resolveFoxholeMaintenanceIntervalSeconds,
    resolveFoxholeMaintenanceSuppliesForInterval,
    resolveFoxholeMaintenanceSupplyDrain,
    resolveFoxholeStructureDecays,
} from '../app/plugins/foxhole/nixie/maintenance-supplies.ts';

test('resolveFoxholeStructureDecays treats drain as decaying when flag is absent', () => {
    assert.equal(resolveFoxholeStructureDecays({ decays: true }), true);
    assert.equal(resolveFoxholeStructureDecays({ decaySupplyDrain: 2 }), true);
    assert.equal(resolveFoxholeStructureDecays({}), false);
});

test('resolveFoxholeMaintenanceSupplyDrain defaults to 1 for decaying structures', () => {
    assert.equal(resolveFoxholeMaintenanceSupplyDrain({ decays: true }), 1);
    assert.equal(resolveFoxholeMaintenanceSupplyDrain({ decays: true, decaySupplyDrain: 4 }), 4);
    assert.equal(resolveFoxholeMaintenanceSupplyDrain({}), 0);
});

test('resolveFoxholeMaintenanceSuppliesForInterval scales with hours', () => {
    assert.equal(resolveFoxholeMaintenanceSuppliesForInterval(1, 3600), 1);
    assert.equal(resolveFoxholeMaintenanceSuppliesForInterval(2, 7200), 4);
    assert.equal(resolveFoxholeMaintenanceSuppliesForInterval(1, 1800), 0.5);
});

test('resolveFoxholeMaintenanceIntervalSeconds falls back to one hour', () => {
    assert.equal(resolveFoxholeMaintenanceIntervalSeconds('3d'), 259200);
    assert.equal(resolveFoxholeMaintenanceIntervalSeconds('nope'), 3600);
    assert.equal(resolveFoxholeMaintenanceIntervalSeconds('custom'), 3600);
});

test('custom statistics intervals resolve and label exact durations', () => {
    assert.equal(normalizeFoxholeCustomIntervalSeconds(5400), 5400);
    assert.equal(normalizeFoxholeCustomIntervalSeconds(0), null);
    assert.equal(normalizeFoxholeCustomIntervalSeconds(Number.NaN), null);
    assert.equal(normalizeFoxholeCustomIntervalSeconds(31 * 86400), 30 * 86400);
    assert.equal(resolveFoxholeMaintenanceIntervalSeconds('custom', 5400), 5400);
    assert.equal(formatFoxholeMaintenanceIntervalLabel('custom', 5400), 'Custom (1h 30m)');
    assert.equal(formatFoxholeMaintenanceIntervalLabel('1h', 5400), '1 Hour');
});
