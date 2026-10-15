import assert from 'node:assert/strict';
import test from 'node:test';
import { hasSplineContactShadow, resolveSplineContactShadowPath } from '../app/plugins/foxhole/nixie/spline-contact-shadow.ts';

test('spline shadows apply to raised ribbons, not flat or underground paths', () => {
    assert.equal(hasSplineContactShadow('railtracksplinefoundation'), true);
    assert.equal(hasSplineContactShadow('wallsplinet2'), true);
    assert.equal(hasSplineContactShadow('facilitypipeoverhead'), true);
    assert.equal(hasSplineContactShadow('fieldbridge'), true);
    assert.equal(hasSplineContactShadow('dirtroad'), false);
    assert.equal(hasSplineContactShadow('facilitypipeunderground'), false);
    assert.equal(hasSplineContactShadow('powerline'), false);
    assert.equal(hasSplineContactShadow('minespline'), false);
});

test('spline contact shadow follows the trimmed ribbon centerline', () => {
    const shadow = resolveSplineContactShadowPath({
        points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }],
        lengths: [0, 12, 24],
        totalLength: 24,
    }, 100, 0.5, 6, 6);

    assert.ok(shadow);
    assert.equal(shadow.width, 50);
    assert.equal(shadow.offset, 3);
    assert.deepEqual(shadow.points, [
        { x: 5, y: 2.5 },
        { x: 10, y: 5 },
        { x: 15, y: 2.5 },
    ]);
});

test('spline contact shadow skips empty and fully trimmed paths', () => {
    const path = {
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        lengths: [0, 10],
        totalLength: 10,
    };
    assert.equal(resolveSplineContactShadowPath(path, 100, 0.5, 6, 6), null);
    assert.equal(resolveSplineContactShadowPath(path, 0, 0.5), null);
});
