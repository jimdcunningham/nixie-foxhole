import assert from 'node:assert/strict';
import test from 'node:test';
import {
    findBestFoxholeEmplacementSnap,
    foxholeEmplacementLocalToBoardOffset,
} from '../../app/plugins/foxhole/nixie/structure-emplacement-snapping.ts';

test('converts cm local pad offsets to board pixels', () => {
    assert.deepEqual(foxholeEmplacementLocalToBoardOffset({ x: 0, y: 0 }), { x: 0, y: 0 });
    assert.deepEqual(foxholeEmplacementLocalToBoardOffset({ x: 100, y: -50 }), { x: 32, y: -16 });
});

test('snaps weapon origin to nearest pad without rotation', () => {
    const match = findBestFoxholeEmplacementSnap({
        movingNodeId: 'weapon',
        movingOrigin: { x: 10, y: 10 },
        pads: [
            { nodeId: 'far', x: 200, y: 200 },
            { nodeId: 'near', x: 20, y: 12 },
        ],
        moveX: 5,
        moveY: 0,
        maxDistance: 40,
    });

    assert.ok(match);
    assert.deepEqual({
        movingNodeId: match.movingNodeId,
        targetNodeId: match.targetNodeId,
        moveX: match.moveX,
        moveY: match.moveY,
    }, {
        movingNodeId: 'weapon',
        targetNodeId: 'near',
        moveX: 10,
        moveY: 2,
    });
    assert.ok(Math.abs(match.distance - Math.hypot(15 - 20, 10 - 12)) < 1e-5);
});

test('returns null when pads are outside snap radius', () => {
    const match = findBestFoxholeEmplacementSnap({
        movingNodeId: 'weapon',
        movingOrigin: { x: 0, y: 0 },
        pads: [{ nodeId: 'pad', x: 100, y: 100 }],
        moveX: 0,
        moveY: 0,
        maxDistance: 20,
    });
    assert.equal(match, null);
});
