import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildFoxholeLineOfSightMaskPoints,
    isFoxholeLineOfSightStructureKey,
} from '../app/plugins/foxhole/nixie/line-of-sight.ts';

test('line of sight is limited to the audited pillbox opt-in list', () => {
    assert.equal(isFoxholeLineOfSightStructureKey('isgpillbox'), true);
    assert.equal(isFoxholeLineOfSightStructureKey('atpillbox'), true);
    assert.equal(isFoxholeLineOfSightStructureKey('mgpillbox'), true);
    assert.equal(isFoxholeLineOfSightStructureKey('riflepillbox'), true);
    assert.equal(isFoxholeLineOfSightStructureKey('howitzer'), false);
});

test('line of sight stops rays at the nearest occluding structure edge', () => {
    const points = buildFoxholeLineOfSightMaskPoints({
        origin: { x: 0, y: 0 },
        maxDistance: 100,
        occluders: [[
            { x: 20, y: -5 },
            { x: 30, y: -5 },
            { x: 30, y: 5 },
            { x: 20, y: 5 },
        ]],
    });
    const pointOnPositiveXAxis = points.reduce((closest, point) => {
        return Math.abs(point.y) < Math.abs(closest.y) ? point : closest;
    });

    assert.ok(Math.abs(pointOnPositiveXAxis.y) < 0.01);
    assert.ok(pointOnPositiveXAxis.x >= 19.9 && pointOnPositiveXAxis.x <= 20.1);
});

test('line of sight keeps corner rays in one continuous angular order', () => {
    const points = buildFoxholeLineOfSightMaskPoints({
        origin: { x: 0, y: 0 },
        maxDistance: 100,
        occluders: [[
            { x: -20, y: -5 },
            { x: -10, y: -5 },
            { x: -10, y: 5 },
            { x: -20, y: 5 },
        ]],
    });
    const angles = points.map(point => {
        const angle = Math.atan2(point.y, point.x);
        return angle < 0 ? angle + (Math.PI * 2) : angle;
    });

    for (let index = 1; index < angles.length; index += 1) {
        assert.ok(angles[index - 1]! <= angles[index]!);
    }
});

test('line of sight supports a lower-detail transient preview ring', () => {
    const points = buildFoxholeLineOfSightMaskPoints({
        origin: { x: 0, y: 0 },
        maxDistance: 100,
        occluders: [],
        baseRayCount: 24,
    });

    assert.equal(points.length, 24);
});
