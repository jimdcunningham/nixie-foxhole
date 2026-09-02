import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getDefaultPublishConcurrency, mapWithConcurrency } from './publish-concurrency.mjs';

test('publisher uses the benchmarked four-job global queue', () => {
    assert.equal(getDefaultPublishConcurrency(), 4);
});

test('global image queue preserves input order', async () => {
    const values = await mapWithConcurrency([3, 1, 2], 2, async value => {
        await new Promise(resolve => setTimeout(resolve, value));
        return value * 2;
    });
    assert.deepEqual(values, [6, 2, 4]);
});
