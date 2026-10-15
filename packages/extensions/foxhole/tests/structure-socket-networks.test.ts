import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildFoxholeSocketNetworkIndex,
    isFoxholeBunkerUnionMember,
    resolveFoxholeSingleIntersectingSocketNetworkUnion,
} from '../app/plugins/foxhole/nixie/structure-socket-networks.ts';

type FoxholeSocketNetworkSceneNode = Parameters<typeof buildFoxholeSocketNetworkIndex>[0][number];

function fortSocket(name: string) {
    return {
        name,
        socketTags: [{ category: 4, mask: 4 }],
    };
}

function trenchSocket(name: string) {
    return {
        name,
        socketTags: [{ category: 2, mask: 2 }],
    };
}

function node(partial: Partial<FoxholeSocketNetworkSceneNode> & Pick<FoxholeSocketNetworkSceneNode, 'nodeId' | 'foxholeKey'>): FoxholeSocketNetworkSceneNode {
    return {
        buildSockets: [],
        socketAttachments: {},
        profileType: 'Fort',
        ...partial,
    };
}

test('isFoxholeBunkerUnionMember includes forts and excludes trenches', () => {
    assert.equal(isFoxholeBunkerUnionMember({
        foxholeKey: 'fortt1',
        profileType: 'Fort',
        structuralIntegrity: 0.97,
    }), true);
    assert.equal(isFoxholeBunkerUnionMember({
        foxholeKey: 'trencht1',
        profileType: 'Trench',
        structuralIntegrity: null,
        isBunker: true,
    }), false);
    assert.equal(isFoxholeBunkerUnionMember({
        foxholeKey: 'rifleait1',
        codeName: 'RifleAIT1',
        profileType: null,
    }), true);
});

test('bunker network merges fort↔fort and ignores trench bridges', () => {
    const nodes: FoxholeSocketNetworkSceneNode[] = [
        node({
            nodeId: 'a',
            foxholeKey: 'fortt1',
            buildSockets: [fortSocket('RightFortSocket')],
            socketAttachments: {
                RightFortSocket: { nodeId: 'b', socketName: 'LeftFortSocket' },
            },
        }),
        node({
            nodeId: 'b',
            foxholeKey: 'fortt1',
            buildSockets: [fortSocket('LeftFortSocket'), fortSocket('RightFortSocket')],
            socketAttachments: {
                LeftFortSocket: { nodeId: 'a', socketName: 'RightFortSocket' },
                RightFortSocket: { nodeId: 't', socketName: 'FrontTrenchSocket' },
            },
        }),
        node({
            nodeId: 't',
            foxholeKey: 'trencht1',
            profileType: 'Trench',
            structuralIntegrity: null,
            buildSockets: [trenchSocket('FrontTrenchSocket'), trenchSocket('BackTrenchSocket')],
            socketAttachments: {
                FrontTrenchSocket: { nodeId: 'b', socketName: 'RightFortSocket' },
                BackTrenchSocket: { nodeId: 'c', socketName: 'LeftFortSocket' },
            },
        }),
        node({
            nodeId: 'c',
            foxholeKey: 'fortt1',
            buildSockets: [fortSocket('LeftFortSocket')],
            socketAttachments: {
                LeftFortSocket: { nodeId: 't', socketName: 'BackTrenchSocket' },
            },
        }),
    ];

    const index = buildFoxholeSocketNetworkIndex(nodes, 'bunker');
    assert.equal(index.unions.length, 2);
    assert.deepEqual(
        index.unions.map(union => union.memberNodeIds).sort((left, right) => left[0]!.localeCompare(right[0]!)),
        [['a', 'b'], ['c']],
    );
});

test('bunker network resolves legacy attachment names against namespaced manifest sockets', () => {
    const index = buildFoxholeSocketNetworkIndex([
        node({
            nodeId: 'a',
            foxholeKey: 'fortt3',
            buildSockets: [fortSocket('FortCommon:RightFortSocket')],
            socketAttachments: {
                RightFortSocket: { nodeId: 'b', socketName: 'LeftFortSocket' },
            },
        }),
        node({
            nodeId: 'b',
            foxholeKey: 'fortt3',
            buildSockets: [fortSocket('FortCommon:LeftFortSocket')],
            socketAttachments: {
                LeftFortSocket: { nodeId: 'a', socketName: 'RightFortSocket' },
            },
        }),
    ], 'bunker');

    assert.equal(index.unions.length, 1);
    assert.deepEqual(index.unions[0]!.memberNodeIds, ['a', 'b']);
});

test('roof hover includes T3 trench roofs without merging bunker unions through trenches', () => {
    const nodes = [
        node({ nodeId: 'a', foxholeKey: 'fortt3', buildSockets: [fortSocket('RightFortSocket')],
            socketAttachments: { RightFortSocket: { nodeId: 'b', socketName: 'LeftFortSocket' } } }),
        node({ nodeId: 'b', foxholeKey: 'fortt3', buildSockets: [fortSocket('LeftFortSocket'), fortSocket('RightFortSocket')],
            socketAttachments: {
                LeftFortSocket: { nodeId: 'a', socketName: 'RightFortSocket' },
                RightFortSocket: { nodeId: 'trench', socketName: 'BackSocket' },
            } }),
        node({ nodeId: 'trench', foxholeKey: 'trencht3', profileType: 'Trench',
            buildSockets: [trenchSocket('BackSocket'), trenchSocket('FrontSocket')],
            socketAttachments: {
                BackSocket: { nodeId: 'b', socketName: 'RightFortSocket' },
                FrontSocket: { nodeId: 'intersection', socketName: 'BackSocket' },
            } }),
        node({ nodeId: 'intersection', foxholeKey: 'trenchintt3', profileType: 'Trench',
            buildSockets: [trenchSocket('BackSocket')],
            socketAttachments: { BackSocket: { nodeId: 'trench', socketName: 'FrontSocket' } } }),
        node({ nodeId: 'connector', foxholeKey: 'trenchconnectort3', profileType: 'Trench' }),
        node({ nodeId: 'ruin', foxholeKey: 'trencht3destroyed', profileType: 'Trench', isDestroyed: true }),
        node({ nodeId: 'site', foxholeKey: 'trenchbuildsite', profileType: 'Trench' }),
        node({ nodeId: 't2', foxholeKey: 'trencht2', profileType: 'Trench' }),
    ];
    const index = buildFoxholeSocketNetworkIndex(nodes, 'roof-hover');
    assert.deepEqual(index.unions.map(union => union.memberNodeIds), [['a', 'b'], ['connector'], ['intersection'], ['trench']]);
    assert.deepEqual(buildFoxholeSocketNetworkIndex(nodes, 'bunker').unions.map(union => union.memberNodeIds), [['a', 'b']]);
});

test('trench network includes forts connected through trenches', () => {
    const nodes: FoxholeSocketNetworkSceneNode[] = [
        node({
            nodeId: 'a',
            foxholeKey: 'fortt1',
            buildSockets: [fortSocket('RightFortSocket')],
            socketAttachments: {
                RightFortSocket: { nodeId: 't', socketName: 'FrontTrenchSocket' },
            },
        }),
        node({
            nodeId: 't',
            foxholeKey: 'trencht1',
            profileType: 'Trench',
            structuralIntegrity: null,
            buildSockets: [trenchSocket('FrontTrenchSocket'), trenchSocket('BackTrenchSocket')],
            socketAttachments: {
                FrontTrenchSocket: { nodeId: 'a', socketName: 'RightFortSocket' },
                BackTrenchSocket: { nodeId: 'c', socketName: 'LeftFortSocket' },
            },
        }),
        node({
            nodeId: 'c',
            foxholeKey: 'fortt1',
            buildSockets: [fortSocket('LeftFortSocket')],
            socketAttachments: {
                LeftFortSocket: { nodeId: 't', socketName: 'BackTrenchSocket' },
            },
        }),
    ];

    const index = buildFoxholeSocketNetworkIndex(nodes, 'trench');
    assert.equal(index.unions.length, 1);
    assert.deepEqual(index.unions[0]!.memberNodeIds, ['a', 'c', 't']);
});

test('resolveFoxholeSingleIntersectingSocketNetworkUnion requires exactly one union', () => {
    const index = buildFoxholeSocketNetworkIndex([
        node({ nodeId: 'a', foxholeKey: 'fortt1' }),
        node({ nodeId: 'b', foxholeKey: 'fortt1' }),
    ], 'bunker');

    assert.equal(resolveFoxholeSingleIntersectingSocketNetworkUnion(index, ['a']), index.unions.find(union => union.memberNodeIds.includes('a')) ?? null);
    assert.equal(resolveFoxholeSingleIntersectingSocketNetworkUnion(index, ['a', 'b']), null);
});
