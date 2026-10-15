import assert from 'node:assert/strict';
import test from 'node:test';
import { mapSpanTextureUAlong } from '../app/plugins/foxhole/nixie/span-texture-mapping.ts';

test('mapSpanTextureUAlong repeats the complete source texture linearly', () => {
    const mapping = {
        repeatLength: 166,
    };

    assert.ok(Math.abs(mapSpanTextureUAlong(83, mapping) - 0.5) < 0.001);
    assert.ok(Math.abs(mapSpanTextureUAlong(166, mapping) - 1) < 0.001);
    assert.ok(Math.abs(mapSpanTextureUAlong(249, mapping) - 1.5) < 0.001);
});
