import assert from 'node:assert/strict';
import test from 'node:test';
import { readFoxholeModelLightHints } from '../src/model-light-hints.ts';

test('exported lamp policy retains powered candela and shadow eligibility without changing source metadata', () => {
    const document = { nodes: [{ name: 'lamp', extras: { nixieBlueprintLight: {
        sourceName: 'FortSpotLight:Light', candela: 1473.84, source: { enabled: false, castShadows: true },
    } } }, { name: 'other', extras: { nixieBlueprintLight: { sourceName: 'OtherLight', candela: 50, source: { enabled: false } } } }] };
    const original = structuredClone(document);
    assert.deepEqual([...readFoxholeModelLightHints(document)], [['lamp', { shadows: true, poweredIntensity: 1473.84 }], ['other', { shadows: false }]]);
    assert.deepEqual(document, original);
});

test('unrelated models and invalid powered intensities never acquire an active lamp', () => {
    for (const document of [null, {}, { nodes: null }, { nodes: [null, {}, { name: 'ordinary' }] }]) {
        assert.equal(readFoxholeModelLightHints(document).size, 0);
    }
    for (const candela of [-1, 0, Infinity, NaN, 1e12 + 1, '12']) {
        const hints = readFoxholeModelLightHints({ nodes: [{ name: 'lamp', extras: { nixieBlueprintLight: { sourceName: 'FortSpotLight:Light', candela } } }] });
        assert.equal(hints.get('lamp')?.poweredIntensity, undefined);
    }
});
