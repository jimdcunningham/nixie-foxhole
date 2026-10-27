import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateFoxholeBuildSockets } from '../src/bunker-statistics-sockets.ts';
import type { FoxholeBunkerStatisticsSocket } from '../src/bunker-statistics-sockets.ts';

function socket(name: string, x = 100, extra: Partial<FoxholeBunkerStatisticsSocket> = {}): FoxholeBunkerStatisticsSocket {
    return { name, x, y: 5, z: 0, socketTags: [], ...extra };
}

test('socket cleanup preserves canonical preference, merged flags and output order', () => {
    const inputs = [
        socket('Blueprint:Power_GEN_VARIABLE', 100, { integrityBonus: false, breachFace: true }),
        socket('Pipe', 400), socket('Power', 100.5), socket('power', 800),
    ];
    const before = structuredClone(inputs);
    const actual = deduplicateFoxholeBuildSockets(inputs);
    assert.deepEqual(actual.map(value => [value.name, value.x]), [['Power', 100.5], ['Pipe', 400], ['power', 800]]);
    assert.equal(actual[0]!.integrityBonus, false);
    assert.equal(actual[0]!.breachFace, true);
    assert.equal(actual[1], inputs[1]);
    assert.deepEqual(inputs, before);
});

test('socket cleanup preserves first representative matching rather than transitive clustering', () => {
    const actual = deduplicateFoxholeBuildSockets([
        socket('Power', 100), socket('Scope:POWER_GEN_VARIABLE', 100.6), socket('Power', 101.2),
    ]);
    assert.deepEqual(actual.map(value => value.x), [100, 101.2]);
    const distinct = deduplicateFoxholeBuildSockets([socket('Power', 100), socket('Power', 101)]);
    assert.equal(distinct.length, 2, 'The one-unit tolerance remains strict.');
});

test('origin leaks merge into the first matching name bucket without hiding real sockets', () => {
    const positioned = socket('Power', 100, { y: 0 });
    const far = socket('Power', 900, { y: 0 });
    const plainOrigin = socket('Power', 0, { y: 0, integrityBonus: false });
    const actual = deduplicateFoxholeBuildSockets([positioned, socket('Other'), far, plainOrigin]);
    assert.deepEqual(actual.map(value => [value.name, value.x]), [['Power', 100], ['Other', 100], ['Power', 900]]);
    assert.equal(actual[0]!.integrityBonus, false);
    assert.equal(actual[2]!.integrityBonus, undefined);
    assert.equal(deduplicateFoxholeBuildSockets([positioned, socket('Power', 0, { y: 0, pipeType: 'input' })]).length, 2);
    assert.deepEqual(deduplicateFoxholeBuildSockets([
        socket('LandscapeCheckSocket1'), socket('LeftSocket', 0, { y: 0 }), socket('RightSocket', 6000),
    ]), []);
});

test('unique socket names avoid repeatedly reading every accepted socket name', () => {
    let reads = 0;
    const inputs = Array.from({ length: 256 }, (_, index) => ({ ...socket(''), get name() {
        reads++;
        return `Socket${index}`;
    } }));
    const actual = deduplicateFoxholeBuildSockets(inputs);
    assert.equal(actual.length, inputs.length);
    actual.forEach((value, index) => assert.equal(value, inputs[index]));
    assert.ok(reads <= inputs.length * 8, `Expected bounded name reads for distinct sockets, observed ${reads}.`);
    assert.deepEqual(deduplicateFoxholeBuildSockets(null), []);
    assert.deepEqual(deduplicateFoxholeBuildSockets(undefined), []);
});
