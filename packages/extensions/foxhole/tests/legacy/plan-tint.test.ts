import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLegacyTintBrightness } from '../../app/plugins/foxhole/legacy/plan-tint.ts';

test('resolveLegacyTintBrightness parses hex tint and drops white/default brightness', () => {
    assert.deepEqual(resolveLegacyTintBrightness({ tint: '#D0021B' }), { tint: 0xD0021B });
    assert.deepEqual(resolveLegacyTintBrightness({ tint: '#FFFFFF', brightness: 1 }), {});
    assert.deepEqual(resolveLegacyTintBrightness({ tint: '#FFFFFF', brightness: 0.5 }), { brightness: 0.5 });
    assert.deepEqual(resolveLegacyTintBrightness({ tint: 0x4A90E2, brightness: 1.25 }), {
        tint: 0x4A90E2,
        brightness: 1.25,
    });
});
