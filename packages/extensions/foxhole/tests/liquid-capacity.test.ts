import assert from 'node:assert/strict';
import test from 'node:test';
import {
    accumulateFoxholeLiquidCapacity,
    createEmptyFoxholeLiquidCapacityBreakdown,
    resolveFoxholeLiquidCapacityKind,
    resolveFoxholeStructureLiquidCapacity,
} from '../app/plugins/foxhole/nixie/liquid-capacity.ts';

test('resolveFoxholeStructureLiquidCapacity prefers published liquidCapacity', () => {
    assert.equal(resolveFoxholeStructureLiquidCapacity({
        foxholeKey: 'facilitypipe',
        liquidCapacity: 250,
    }), 250);
});

test('resolveFoxholeStructureLiquidCapacity falls back to known MaxLiquidAmount values', () => {
    assert.equal(resolveFoxholeStructureLiquidCapacity({
        foxholeKey: 'facilitysilooil',
    }), 5000);
    assert.equal(resolveFoxholeStructureLiquidCapacity({
        foxholeKey: 'unknown',
        legacyKey: 'pipeline_underground',
    }), 50);
});

test('liquid capacity kinds match legacy silo and pipeline buckets', () => {
    assert.equal(resolveFoxholeLiquidCapacityKind('facilitysilooil'), 'silo');
    assert.equal(resolveFoxholeLiquidCapacityKind('facilitypipe'), 'pipeline');
    assert.equal(resolveFoxholeLiquidCapacityKind('facilitypipevalve'), 'other');
});

test('accumulateFoxholeLiquidCapacity rolls total and category buckets', () => {
    const breakdown = createEmptyFoxholeLiquidCapacityBreakdown();
    accumulateFoxholeLiquidCapacity(breakdown, 5000, 'silo');
    accumulateFoxholeLiquidCapacity(breakdown, 100, 'pipeline');
    accumulateFoxholeLiquidCapacity(breakdown, 100, 'pipeline');
    assert.deepEqual(breakdown, {
        total: 5200,
        silo: 5000,
        pipeline: 200,
    });
});
