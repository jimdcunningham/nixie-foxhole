import assert from 'node:assert/strict';
import test from 'node:test';
import {
    accumulateFoxholeFacilityPower,
    createEmptyFoxholeFacilityPowerBreakdown,
    resolveFoxholePowerDeltaMw,
} from '../app/plugins/foxhole/nixie/facility-power.ts';

test('resolveFoxholePowerDeltaMw converts milliwatt-scale deltas to MW', () => {
    assert.equal(resolveFoxholePowerDeltaMw(5000), 5);
    assert.equal(resolveFoxholePowerDeltaMw(-2000), -2);
    assert.equal(resolveFoxholePowerDeltaMw(0), 0);
    assert.equal(resolveFoxholePowerDeltaMw(null), 0);
});

test('accumulateFoxholeFacilityPower splits produced, consumed, and net', () => {
    const breakdown = createEmptyFoxholeFacilityPowerBreakdown();
    accumulateFoxholeFacilityPower(breakdown, 5);
    accumulateFoxholeFacilityPower(breakdown, 15);
    accumulateFoxholeFacilityPower(breakdown, -2);
    accumulateFoxholeFacilityPower(breakdown, -4);
    assert.deepEqual(breakdown, {
        producedMw: 20,
        consumedMw: 6,
        netMw: 14,
    });
});
