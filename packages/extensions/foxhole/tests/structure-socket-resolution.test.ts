import assert from 'node:assert/strict';
import test from 'node:test';
import {
    deduplicateFoxholeBuildSockets,
    resolveFoxholeBuildSocketPosition,
    resolveFoxholeEffectiveBuildSockets,
} from '../app/plugins/foxhole/nixie/structure-socket-resolution.ts';
import type { FoxholeManifestBuildSocket } from '../app/plugins/foxhole/nixie/manifest.ts';

function createSocket(overrides: Partial<FoxholeManifestBuildSocket> & Pick<FoxholeManifestBuildSocket, 'name'>): FoxholeManifestBuildSocket {
    return {
        componentType: 'Class\'/Script/War.BuildSocketComponent\'',
        socketTags: [],
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        ...overrides,
    };
}

test('resolveFoxholeBuildSocketPosition treats omitted compact zero coordinates as origin', () => {
    assert.deepEqual(resolveFoxholeBuildSocketPosition({
        name: 'BackSocket',
    }), { x: 0, y: 0 });
});

test('deduplicateFoxholeBuildSockets prefers canonical names over _GEN_VARIABLE duplicates', () => {
    const sockets = deduplicateFoxholeBuildSockets([
        createSocket({ name: 'PipeInput0', x: 327.865, y: -187.375, pipeType: 'Input' }),
        createSocket({ name: 'PipeInput0_GEN_VARIABLE', x: 327.865295, y: -187.375183, pipeType: 'Input' }),
    ]);

    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]?.name, 'PipeInput0');
});

test('deduplicateFoxholeBuildSockets collapses duplicate front sockets at the same position', () => {
    const sockets = deduplicateFoxholeBuildSockets([
        createSocket({ name: 'FrontSocket', x: 173.849, y: 0 }),
        createSocket({ name: 'FrontSocket', x: 173.848999, y: -0.00003, pipeType: '' }),
    ]);

    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]?.name, 'FrontSocket');
});

test('deduplicateFoxholeBuildSockets collapses origin PowerSocket duplicates into positioned sockets', () => {
    const sockets = deduplicateFoxholeBuildSockets([
        createSocket({ name: 'PowerSocket', x: 0, y: 11.861, z: 0 }),
        createSocket({ name: 'PowerSocket', x: 0, y: 0, z: 0 }),
    ]);

    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]?.name, 'PowerSocket');
    assert.ok(Math.abs(Number(sockets[0]?.y ?? 0) - 11.861) < 1e-6);
});

test('deduplicateFoxholeBuildSockets removes spurious origin left/right sockets', () => {
    const sockets = deduplicateFoxholeBuildSockets([
        createSocket({ name: 'BackSocket', x: 0, y: -124, rotation: -90 }),
        createSocket({ name: 'FrontSocket', x: 0, y: 124, rotation: 90 }),
        createSocket({ name: 'LeftSocket', x: 0, y: 0 }),
        createSocket({ name: 'RightSocket', x: 0, y: 0 }),
    ]);

    assert.deepEqual(sockets.map(socket => socket.name), ['BackSocket', 'FrontSocket']);
});

test('deduplicateFoxholeBuildSockets collapses namespace aliases and preserves breach metadata', () => {
    const sockets = deduplicateFoxholeBuildSockets([
        createSocket({
            name: 'FortCommon:FrontFortSocket',
            x: 250,
            socketTags: [{ category: 4, mask: 4 }],
            breachFace: true,
        }),
        createSocket({
            name: 'FrontFortSocket',
            x: 250,
            socketTags: [{ category: 4, mask: 4 }],
        }),
    ]);

    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]?.name, 'FrontFortSocket');
    assert.equal(sockets[0]?.breachFace, true);
});

test('deduplicateFoxholeBuildSockets removes non-connectable landscape probes', () => {
    const sockets = deduplicateFoxholeBuildSockets([
        createSocket({ name: 'LandscapeCheck', x: 120, y: 0 }),
        createSocket({ name: 'LandscapeCheckSocket1', x: -120, y: 0 }),
        createSocket({ name: 'FrontSocket', x: 0, y: 120 }),
    ]);

    assert.deepEqual(sockets.map(socket => socket.name), ['FrontSocket']);
});

test('deduplicateFoxholeBuildSockets removes absurd connector side socket positions', () => {
    const sockets = deduplicateFoxholeBuildSockets([
        createSocket({ name: 'BackSocket', x: 0, y: 0 }),
        createSocket({ name: 'FrontSocket', x: 300, y: 0 }),
        createSocket({
            name: 'RightSocket',
            x: 500,
            y: -11892.46875,
            socketTags: [{ mask: 16779264, category: 2048 }],
        }),
    ]);

    assert.deepEqual(sockets.map(socket => socket.name), ['BackSocket', 'FrontSocket']);
});

test('resolveFoxholeEffectiveBuildSockets deduplicates overlay sockets from selected variants', () => {
    const sockets = resolveFoxholeEffectiveBuildSockets(
        [createSocket({ name: 'PipeOutput0', x: -2.766, y: -566.917, pipeType: 'Output' })],
        [{
            buildSockets: [
                createSocket({ name: 'PipeOutput0_GEN_VARIABLE', x: -2.765942, y: -566.917175, pipeType: 'Output' }),
            ],
        }],
    );

    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]?.name, 'PipeOutput0');
});
