import assert from 'node:assert/strict';
import test from 'node:test';
import {
    advancePowerlineMotion,
    advancePowerlineMotionFrame,
    createPowerlineMotion,
    powerlinePathPoints,
    rebasePowerlineMotion,
    resetPowerlineMotion,
} from '../app/plugins/foxhole/nixie/powerline-motion.ts';

test('wind deforms the span at different positions while leaving endpoints fixed', () => {
    const motion = createPowerlineMotion();
    for (let index = 0; index < 90; index += 1) {
        advancePowerlineMotion(motion, { x: 0, y: 0 }, { x: 200, y: 0 }, { directionDeg: 90, strength: 1 }, 33, 1, 0);
    }
    const points = powerlinePathPoints({ x: 0, y: 0 }, { x: 200, y: 0 }, motion);
    assert.deepEqual(points[0], { x: 0, y: 0 });
    assert.deepEqual(points.at(-1), { x: 200, y: 0 });
    assert.ok(new Set(motion.particles.map(point => point.y.toFixed(2))).size > 2);
    assert.ok(points.some(point => point.y > 1));
});

test('crosswind bends a line while parallel wind does not', () => {
    const crosswind = createPowerlineMotion();
    const parallel = createPowerlineMotion();
    for (let index = 0; index < 90; index += 1) {
        advancePowerlineMotion(crosswind, { x: 0, y: 0 }, { x: 200, y: 0 }, { directionDeg: 90, strength: 1 }, 33, 1, 0);
        advancePowerlineMotion(parallel, { x: 0, y: 0 }, { x: 200, y: 0 }, { directionDeg: 0, strength: 1 }, 33, 1, 0);
    }
    assert.ok(Math.max(...crosswind.particles.map(point => point.y)) > 1);
    assert.ok(parallel.particles.every(point => point.y === 0));
});

test('moving an endpoint excites the cable even in calm wind', () => {
    const motion = createPowerlineMotion();
    const wind = { directionDeg: 0, strength: 0 };
    advancePowerlineMotion(motion, { x: 0, y: 0 }, { x: 200, y: 0 }, wind, 33, 1, 0);
    const before = powerlinePathPoints({ x: 0, y: 0 }, { x: 200, y: 0 }, motion);
    advancePowerlineMotion(motion, { x: 0, y: 20 }, { x: 200, y: 0 }, wind, 33, 1, 0);
    const after = powerlinePathPoints({ x: 0, y: 20 }, { x: 200, y: 0 }, motion);
    const farSample = Math.round((before.length - 1) * 5 / 6);
    assert.ok(Math.abs(after[farSample]!.y - before[farSample]!.y) < 1);
    assert.ok(motion.particles[1]!.y > 1);
    assert.deepEqual(after.at(-1), { x: 200, y: 0 });
    for (let index = 0; index < 180; index += 1) {
        advancePowerlineMotion(motion, { x: 0, y: 20 }, { x: 200, y: 0 }, wind, 33, 1, 0);
    }
    assert.ok(motion.particles.slice(1, -1).every((point, index) => (
        Math.abs(point.y - 20 * (1 - (index + 1) / (motion.particles.length - 1))) < 0.5
    )));
    resetPowerlineMotion(motion);
    assert.deepEqual(motion.particles, []);
    assert.deepEqual(motion.velocities, []);
});

test('dragging the end leaves the far side of the cable in place initially', () => {
    const motion = createPowerlineMotion();
    const wind = { directionDeg: 0, strength: 0 };
    advancePowerlineMotion(motion, { x: 0, y: 0 }, { x: 200, y: 0 }, wind, 33, 1, 0);
    const before = powerlinePathPoints({ x: 0, y: 0 }, { x: 200, y: 0 }, motion);
    advancePowerlineMotion(motion, { x: 0, y: 0 }, { x: 200, y: 20 }, wind, 33, 1, 0);
    const after = powerlinePathPoints({ x: 0, y: 0 }, { x: 200, y: 20 }, motion);
    assert.ok(Math.abs(after[1]!.y - before[1]!.y) < 1);
    assert.ok(motion.particles.at(-2)!.y > 1);
    assert.deepEqual(after[0], { x: 0, y: 0 });
    assert.deepEqual(after.at(-1), { x: 200, y: 20 });
});

test('moving the start pole does not carry the rope interior with the reanchored line origin', () => {
    const motion = createPowerlineMotion();
    const wind = { directionDeg: 0, strength: 0 };
    advancePowerlineMotion(motion, { x: 0, y: 0 }, { x: 200, y: 0 }, wind, 33, 1, 0);
    const priorOriginX = 100;
    const before = powerlinePathPoints({ x: 0, y: 0 }, { x: 200, y: 0 }, motion)
        .map(point => point.x + priorOriginX);

    const nextOriginX = 120;
    rebasePowerlineMotion(motion, { x: priorOriginX - nextOriginX, y: 0 });
    const after = powerlinePathPoints({ x: 0, y: 0 }, { x: 180, y: 0 }, motion)
        .map(point => point.x + nextOriginX);
    const farSample = Math.round((before.length - 1) * 5 / 6);
    assert.ok(Math.abs(after[farSample]! - before[farSample]!) < 1);
});

test('simulation time and cable shape are consistent across display refresh rates', () => {
    const run = (frames: number) => {
        const motion = createPowerlineMotion();
        for (let index = 0; index < frames; index += 1) {
            advancePowerlineMotionFrame(
                motion, { x: 0, y: 0 }, { x: 200, y: 0 },
                { directionDeg: 90, strength: 0.5 }, 1000 / frames, 1, 0,
            );
        }
        return motion;
    };
    const at30 = run(30);
    const at60 = run(60);
    const at144 = run(144);
    assert.ok(Math.abs(at60.elapsedSeconds - 1) < 0.001);
    for (const index of [1, 4, 7]) {
        assert.ok(Math.abs(at30.particles[index]!.y - at60.particles[index]!.y) < 0.01);
        assert.ok(Math.abs(at144.particles[index]!.y - at60.particles[index]!.y) < 0.01);
    }
});
