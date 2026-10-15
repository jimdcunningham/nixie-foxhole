import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIntervalMarkerVariantIds } from '../src/interval-marker-variants.ts';

test('tank stop variants follow native indices while unrelated layers are excluded', () => {
    assert.deepEqual(resolveIntervalMarkerVariantIds(
        ['preview', 'spanalt3', 'spanalt', 'spanalt2', 'span', 'spanalt0', 'spanaltNaN'], true,
    ), ['span', 'spanalt', 'spanalt2', 'spanalt3']);
    assert.deepEqual(resolveIntervalMarkerVariantIds(['span', 'spanalt'], true), ['span', 'spanalt']);
});

test('mine and other interval markers retain their existing two-layer semantics', () => {
    assert.deepEqual(resolveIntervalMarkerVariantIds(['spanalt2', 'spanalt', 'span'], false), ['span', 'spanalt']);
    assert.deepEqual(resolveIntervalMarkerVariantIds([], true), []);
});
