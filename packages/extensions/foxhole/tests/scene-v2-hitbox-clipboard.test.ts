import assert from 'node:assert/strict';
import test from 'node:test';
import { isFoxholeHitboxPasteContextCurrent, serializeFoxholeHitboxClipboard, parseFoxholeHitboxClipboard } from '../app/plugins/foxhole/nixie/scene-v2-hitbox-clipboard.ts';

test('Foxhole V1 clipboard shape scales to a different V2 host', () => {
    const source = { width: 200, height: 100, anchorX: 0.5, anchorY: 0.5 };
    const text = serializeFoxholeHitboxClipboard([{ name: 'solid', role: 'solid', pointsFlat: [-100, -50, 100, -50, 100, 50] }], source);
    assert.deepEqual(JSON.parse(text), { kind: 'foxhole-hitboxes', version: 1, polygons: [{ name: 'solid', role: 'solid', points: [0, 0, 1, 0, 1, 1] }] });
    assert.deepEqual(parseFoxholeHitboxClipboard(text, { width: 80, height: 40, anchorX: 0.5, anchorY: 0.5 })[0]!.points, [-40, -20, 40, -20, 40, 20]);
    assert.deepEqual(parseFoxholeHitboxClipboard('{"kind":"foxhole-hitboxes","version":1,"polygons":[{"points":[0,1,2]}]}', source), []);
});
test('clipboard read cannot paste after the host, view, canvas, revision or metrics change', () => {
    const canvas = {}, metrics = { width: 100, height: 50, anchorX: .5, anchorY: .5 };
    const before = { hostId: 'host', revision: 4, canvas, metrics };
    const after = { hostId: 'host', revision: 4, canvas, metrics, current: true };
    assert.equal(isFoxholeHitboxPasteContextCurrent(before, after), true);
    assert.equal(isFoxholeHitboxPasteContextCurrent(before, { ...after, current: false }), false);
    assert.equal(isFoxholeHitboxPasteContextCurrent(before, { ...after, hostId: 'other' }), false);
    assert.equal(isFoxholeHitboxPasteContextCurrent(before, { ...after, canvas: {} }), false);
    assert.equal(isFoxholeHitboxPasteContextCurrent(before, { ...after, revision: 5 }), false);
    assert.equal(isFoxholeHitboxPasteContextCurrent(before, { ...after, metrics: { ...metrics, width: 101 } }), false);
});
