import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildFactionCasualtySummary,
    computeHourlyCasualties,
    getHourlyCasualtyRingCapacity,
    isHourlyCasualtyRingWarm,
} from './hourly-casualties.ts';

test('hourly casualty ring capacity matches one hour of report polls', () => {
    assert.equal(getHourlyCasualtyRingCapacity(), 24);
});

test('computeHourlyCasualties returns null until the ring is warm', () => {
    assert.equal(computeHourlyCasualties(500_000, [500_000]), null);
    assert.equal(computeHourlyCasualties(500_000, Array.from({ length: 23 }, () => 100)), null);
});

test('computeHourlyCasualties sums warm ring samples', () => {
    const warmRing = Array.from({ length: 24 }, () => 100);
    assert.equal(computeHourlyCasualties(50_000, warmRing), 2_400);
});

test('computeHourlyCasualties falls back to average when hourly sum equals war total', () => {
    const warmRing = Array.from({ length: 24 }, () => 50);
    assert.equal(computeHourlyCasualties(1_200, warmRing), 50);
});

test('buildFactionCasualtySummary preserves totals while withholding hourly', () => {
    assert.deepEqual(
        buildFactionCasualtySummary(123_456, [123_456]),
        {
            totalCasualties: 123_456,
            totalHourlyCasualties: null,
        },
    );
});

test('isHourlyCasualtyRingWarm respects custom sample thresholds', () => {
    assert.equal(isHourlyCasualtyRingWarm([1, 2], 2), true);
    assert.equal(isHourlyCasualtyRingWarm([1], 2), false);
});
