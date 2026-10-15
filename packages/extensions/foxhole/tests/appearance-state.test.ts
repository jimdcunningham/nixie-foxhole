import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeFoxholeAppearancePatchDefaults } from '../app/plugins/foxhole/nixie/appearance-state.ts';

test('materializes omitted Foxhole appearance defaults for live scene patches', () => {
    assert.deepEqual(
        materializeFoxholeAppearancePatchDefaults({ tint: undefined, brightness: undefined }),
        { tint: 0xFFFFFF, brightness: 1 },
    );
});

test('preserves explicit Foxhole tint and brightness values', () => {
    assert.deepEqual(
        materializeFoxholeAppearancePatchDefaults({ tint: 0xFF0000, brightness: 0.5 }),
        { tint: 0xFF0000, brightness: 0.5 },
    );
});
