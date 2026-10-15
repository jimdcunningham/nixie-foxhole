import assert from 'node:assert/strict';
import test from 'node:test';
import {
    circumcircleFromThreePoints,
    fitCircleFromFlatPoints,
    fitCircleFromPoints,
} from '../app/plugins/foxhole/nixie/circle-from-points.ts';

test('circumcircleFromThreePoints fits points on a circle', () => {
    const fit = circumcircleFromThreePoints(
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: -100, y: 0 },
    );

    assert.ok(fit);
    assert.ok(Math.abs(fit.centerX) < 1e-9);
    assert.ok(Math.abs(fit.centerY) < 1e-9);
    assert.ok(Math.abs(fit.radius - 100) < 1e-9);
});

test('fitCircleFromPoints uses least squares for four or more points', () => {
    const fit = fitCircleFromPoints([
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: -100, y: 0 },
        { x: 0, y: -100 },
    ]);

    assert.ok(fit);
    assert.ok(Math.abs(fit.centerX) < 1);
    assert.ok(Math.abs(fit.centerY) < 1);
    assert.ok(Math.abs(fit.radius - 100) < 2);
});

test('fitCircleFromFlatPoints rejects collinear points', () => {
    const fit = fitCircleFromFlatPoints([
        0, 0,
        50, 0,
        100, 0,
    ]);

    assert.equal(fit, null);
});

test('fitCircleFromPoints requires at least three points', () => {
    const fit = fitCircleFromPoints([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ]);

    assert.equal(fit, null);
});

test('fitCircleFromPoints rejects near-collinear points with runaway radius', () => {
    const fit = fitCircleFromPoints([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0.0001 },
    ]);

    assert.equal(fit, null);
});
