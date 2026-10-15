import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isFoxholeSocketAvailableForAttachment,
    resolveFoxholeOccupiedSocketKeys,
} from '../app/plugins/foxhole/nixie/types.ts';

const FORT_SOCKET_TAGS = [{ category: BigInt(4), mask: BigInt(4) }];

test('socket availability recognizes legacy attachment aliases', () => {
    assert.equal(isFoxholeSocketAvailableForAttachment(
        {
            socketName: 'FortCommon:BackFortSocket',
            socketTags: FORT_SOCKET_TAGS,
        },
        {
            BackFortSocket: {
                nodeId: 'neighbor',
                socketName: 'FrontFortSocket',
            },
        },
    ), false);
});

test('socket occupancy resolves legacy aliases to current manifest socket names', () => {
    const occupied = resolveFoxholeOccupiedSocketKeys([
        {
            nodeId: 'left',
            sockets: [{
                nodeId: 'left',
                socketName: 'FortCommon:RightFortSocket',
                socketTags: FORT_SOCKET_TAGS,
                x: 0,
                y: 0,
                rotation: 0,
            }],
            attachments: {
                RightFortSocket: {
                    nodeId: 'right',
                    socketName: 'LeftFortSocket',
                },
            },
        },
        {
            nodeId: 'right',
            sockets: [{
                nodeId: 'right',
                socketName: 'FortCommon:LeftFortSocket',
                socketTags: FORT_SOCKET_TAGS,
                x: 0,
                y: 0,
                rotation: Math.PI,
            }],
            attachments: {
                LeftFortSocket: {
                    nodeId: 'left',
                    socketName: 'RightFortSocket',
                },
            },
        },
    ]);

    assert.deepEqual([...occupied].sort(), [
        'left:FortCommon:RightFortSocket',
        'right:FortCommon:LeftFortSocket',
    ]);
});
