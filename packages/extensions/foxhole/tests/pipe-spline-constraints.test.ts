import assert from 'node:assert/strict';
import test from 'node:test';
import {
    adjustPipeCurveT,
    clampPipeEndpointRotation,
    resolvePipeRotationSnapStepRad,
    resolvePipeSplineConstraints,
    snapPipeRotationRadians,
} from '../app/plugins/foxhole/nixie/pipe-spline-constraints.ts';

test('facilitypipe uses 45-degree rotation snap', () => {
    assert.equal(
        resolvePipeRotationSnapStepRad('facilitypipe', 'spline'),
        Math.PI / 4,
    );
    assert.equal(
        resolvePipeRotationSnapStepRad('facilitypipeunderground', 'spline'),
        Math.PI / 4,
    );
});

test('snapPipeRotationRadians quantizes to the requested step', () => {
    const snapped = snapPipeRotationRadians(0.9, Math.PI / 4);
    assert.ok(Math.abs(snapped - (Math.PI / 4)) < 0.001);
});

test('adjustPipeCurveT scrolls up toward full curvature', () => {
    assert.equal(adjustPipeCurveT(0, -120), 0.05);
    assert.equal(adjustPipeCurveT(1, 120), 0.95);
});

test('resolvePipeSplineConstraints preserves full curveT for non-pipe connectors', () => {
    const resolved = resolvePipeSplineConstraints(
        { curveT: 1, minRadius: 20, maxBuffer: 120 },
        { curveT: 0 },
        { usePipeCurveScale: false },
    );

    assert.equal(resolved.curveT, 1);
});

test('resolvePipeSplineConstraints applies pipe curveT when pipe curve scale is enabled', () => {
    const resolved = resolvePipeSplineConstraints(
        { curveT: 1, minRadius: 20, maxBuffer: 120 },
        { curveT: 0 },
        { usePipeCurveScale: true },
    );

    assert.equal(resolved.curveT, 0);
});

test('clampPipeEndpointRotation honors maxTargetAngle caps', () => {
    const start = { x: 0, y: 0, rotation: 0 };
    const end = { x: 100, y: 0, rotation: 0 };
    const rotation = clampPipeEndpointRotation('start', Math.PI / 2, start, end, {
        maxTargetAngleDeg: 1,
        rotationSnapStepRad: Math.PI / 4,
    });

    assert.ok(Math.abs(rotation) <= ((1 * Math.PI) / 180) + 0.001);
});
