import assert from 'node:assert/strict';
import test from 'node:test';
import { smallGaugeValveGear } from '../src/small-gauge-valve-gear.ts';

type Point = [number, number];
function rotate([x, y]: Point, [cx, cy]: Point, angle: number): Point {
    return [cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
        cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)];
}
function near(a: Point, b: Point) {
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 2e-6, `${a} and ${b}`);
}

test('the Minesweeper rod stays on the crank head and drives both halves of the lifting link', () => {
    const axle: Point = [-.30345, -.90802];
    const rearEye: Point = [-.25769, -.90893];
    const wrist: Point = [.52465, -.72838];
    const lowerPin: Point = [.39574, -.74884];
    const upperPin: Point = [.39574, -.49240];
    const crankPivot: Point = [.21443, -.49239];
    for (const direction of [-1, 1]) {
        const tracks = smallGaugeValveGear(direction)[0]!.tracks;
        const samples = (name: string) => tracks.find(track => track.nodeName === `rail-link-small-${name}-l`)!.samples;
        const rod = samples('rod');
        for (const [index, [x, y, yaw]] of rod.entries()) {
            const shifted = (point: Point): Point => {
                const [px, py] = rotate(point, wrist, yaw);
                return [px + x, py + y];
            };
            near(shifted(rearEye), rotate(rearEye, axle, direction * 2 * Math.PI * index / rod.length));
            const [lowerX, lowerY, lowerYaw] = samples('lifting-link')[index]!;
            near(shifted(lowerPin), [lowerPin[0] + lowerX, lowerPin[1] + lowerY]);
            const [upperX, upperY, upperYaw] = samples('upper-link')[index]!;
            near(rotate(upperPin, crankPivot, samples('bell-crank')[index]![2]),
                [upperPin[0] + upperX, upperPin[1] + upperY]);
            assert.equal(upperYaw, lowerYaw);
            const dx = lowerPin[0] + lowerX - upperPin[0] - upperX;
            const dy = lowerPin[1] + lowerY - upperPin[1] - upperY;
            assert.ok(Math.abs(Math.atan2(dx, -dy) - upperYaw) < 1e-5);
        }
    }
});
