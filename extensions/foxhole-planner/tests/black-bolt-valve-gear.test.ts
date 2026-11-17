import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import { foxholeBlackBoltValveGear, foxholeRailLinkages, foxholeRailWheelRoll } from '../src/rail-vehicle-rigs.ts';

test('Black Bolt valve gear stays phased with the wheels and the crosshead', () => {
    const spatial = parseNixieSpatialPlanV1({ contractVersion: 1, supplementModel: true, nodes: [],
        modelDistanceRotations: foxholeRailWheelRoll.trainengine,
        modelDistanceLinkages: foxholeRailLinkages.trainengine,
        modelDistancePoseCycles: foxholeBlackBoltValveGear });
    const cycle = spatial.modelDistancePoseCycles![0]!;
    const wheelRate = spatial.modelDistanceRotations![0]!.radiansPerUnit;
    assert.ok(Math.abs(cycle.distancePerCycle * wheelRate + 2 * Math.PI) < 1e-10);
    assert.equal(cycle.tracks.length, 20);
    const samples = (name: string) => cycle.tracks.find(track => track.nodeName === `rail-link-${name}-r`)!.samples;
    for (const track of cycle.tracks) assert.deepEqual(track.samples[0], [0, 0, 0]);
    const crank = samples('return-crank'), union = samples('union'), valve = samples('valve-stem');
    const linkage = spatial.modelDistanceLinkages![0]!;
    for (let i = 0; i < crank.length; i++) {
        const phase = i * cycle.distancePerCycle / crank.length * wheelRate;
        const [x, y, angle] = crank[i]!;
        assert.ok(Math.abs(Math.sin(angle) - Math.sin(phase)) < 1e-6);
        const crossheadTravel = x + Math.sqrt(linkage.rodLength ** 2 - y ** 2) - linkage.rodLength;
        assert.ok(Math.abs(union[i]![0] - crossheadTravel) < 3e-6);
        assert.equal(valve[i]![1], 0, 'the valve stem stays on its guide');
    }
    assert.ok(valve.some(([x]) => x > .1));
});
