import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFoxholeTrenchSelectionBounds } from '../src/structure-selection-bounds.ts';

test('trench layers retain sprite end padding and trim the union of vertical crops', () => {
    assert.deepEqual(resolveFoxholeTrenchSelectionBounds({ minX: -100, minY: -200, maxX: 100, maxY: 200 }, [
        { width: 120, height: 100, offsetX: 0, offsetY: -10 },
        { width: 140, height: 80, offsetX: 5, offsetY: 15 },
    ]), { minX: -100, minY: -52, maxX: 106, maxY: 47 });
});

test('trench vertical selection follows layer crops independently of the sprite anchor', () => {
    const layers = [{ width: 120, height: 100, offsetX: 0, offsetY: -10 }];
    const first = resolveFoxholeTrenchSelectionBounds({ minX: -100, minY: -200, maxX: 100, maxY: 200 }, layers)!;
    const anchored = resolveFoxholeTrenchSelectionBounds({ minX: -40, minY: -280, maxX: 160, maxY: 120 }, layers)!;
    assert.deepEqual(anchored, { ...first, minX: -40, maxX: 166 });
});

test('empty or invalid layer metadata retains the caller sprite fallback', () => {
    const sprite = { minX: -100, minY: -200, maxX: 100, maxY: 200 };
    assert.equal(resolveFoxholeTrenchSelectionBounds(sprite, []), null);
    assert.equal(resolveFoxholeTrenchSelectionBounds(sprite, [{ width: 0, height: 100, offsetX: 0, offsetY: 0 },
        { width: 10, height: 100, offsetX: NaN, offsetY: 0 }]), null);
    assert.deepEqual(sprite, { minX: -100, minY: -200, maxX: 100, maxY: 200 });
});
