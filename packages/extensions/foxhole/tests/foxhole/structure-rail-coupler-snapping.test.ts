import assert from 'node:assert/strict';
import test from 'node:test';
import { findBestFoxholeRailCouplerSnap } from '../../app/plugins/foxhole/nixie/structure-rail-coupler-snapping.ts';
import {
    areFoxholeRailCouplerNamesCompatible,
    foxholeRailCouplersToBuildSockets,
    resolveFoxholeEffectiveBuildSockets,
} from '../../app/plugins/foxhole/nixie/structure-socket-resolution.ts';
import {
    DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_DISTANCE,
    DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_ROTATION_DEGREES,
    findAlignedFoxholeSocketMatches,
} from '../../app/plugins/foxhole/nixie/structure-socket-snapping.ts';

test('maps rail couplers to effective build sockets', () => {
    const sockets = foxholeRailCouplersToBuildSockets([
        { name: 'FrontCoupler', x: 426, y: 0, z: -14, rotation: 0 },
        { name: 'RearCoupler', x: -426, y: 0, z: -14, rotation: 180 },
    ]);
    assert.deepEqual(sockets.map(socket => socket.name), ['FrontCoupler', 'RearCoupler']);
    assert.equal(sockets[0]?.componentType, 'RailCouplerUseComponent');
});

test('effective build sockets append rail couplers', () => {
    const sockets = resolveFoxholeEffectiveBuildSockets(
        [{ name: 'PipeOutput0', x: 1, y: 0, socketTags: [] }],
        undefined,
        [
            { name: 'FrontCoupler', x: 426, y: 0, z: -14, rotation: 0 },
            { name: 'RearCoupler', x: -426, y: 0, z: -14, rotation: 180 },
        ],
    );
    assert.deepEqual(
        sockets.map(socket => socket.name),
        ['PipeOutput0', 'FrontCoupler', 'RearCoupler'],
    );
});

test('only couples Front to Rear', () => {
    assert.equal(areFoxholeRailCouplerNamesCompatible('FrontCoupler', 'RearCoupler'), true);
    assert.equal(areFoxholeRailCouplerNamesCompatible('FrontCoupler', 'FrontCoupler'), false);
});

test('snaps a front coupler onto a rear coupler', () => {
    const match = findBestFoxholeRailCouplerSnap({
        movingSockets: [{
            nodeId: 'car-a',
            socketName: 'FrontCoupler',
            x: 0,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'car-b',
            socketName: 'RearCoupler',
            x: 10,
            y: 0,
            rotation: Math.PI,
            socketTags: [],
        }],
        moveX: 0,
        moveY: 0,
        maxDistance: 40,
        maxRotationDeltaRadians: Math.PI,
    });

    assert.deepEqual(match, {
        movingNodeId: 'car-a',
        movingSocketName: 'FrontCoupler',
        targetNodeId: 'car-b',
        targetSocketName: 'RearCoupler',
        moveX: 10,
        moveY: 0,
        rotationDelta: 0,
        distance: 10,
        tagOverlap: 1,
    });
});

test('aligned rail coupler rematch uses a wider connect threshold than pipes', () => {
    const gap = Math.min(28, DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_DISTANCE - 1);
    const matches = findAlignedFoxholeSocketMatches({
        movingSockets: [{
            nodeId: 'car-a',
            socketName: 'FrontCoupler',
            x: 0,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'car-b',
            socketName: 'RearCoupler',
            x: gap,
            y: 0,
            rotation: Math.PI,
            socketTags: [],
        }],
        maxDistance: 1,
        allowNewRailCouplerAttachments: true,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.distance, gap);
});

test('aligned rail coupler rematch skips new links when not allowed', () => {
    const matches = findAlignedFoxholeSocketMatches({
        movingSockets: [{
            nodeId: 'car-a',
            socketName: 'FrontCoupler',
            x: 0,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'car-b',
            socketName: 'RearCoupler',
            x: 10,
            y: 0,
            rotation: Math.PI,
            socketTags: [],
        }],
        allowNewRailCouplerAttachments: false,
    });

    assert.equal(matches.length, 0);
});

test('aligned rail coupler rematch keeps existing pairs with hysteresis', () => {
    const matches = findAlignedFoxholeSocketMatches({
        movingSockets: [{
            nodeId: 'car-a',
            socketName: 'FrontCoupler',
            x: 0,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'car-b',
            socketName: 'RearCoupler',
            x: 40,
            y: 0,
            rotation: Math.PI,
            socketTags: [],
        }],
        railCouplerMaxDistance: 32,
        railCouplerKeepDistance: 48,
        allowNewRailCouplerAttachments: false,
        isRailCouplerPairAttached: () => true,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.distance, 40);
});

test('aligned rail couplers allow articulation on curved track', () => {
    const withinLeeway = (DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_ROTATION_DEGREES - 1) * Math.PI / 180;
    const matches = findAlignedFoxholeSocketMatches({
        movingSockets: [{
            nodeId: 'car-a',
            socketName: 'FrontCoupler',
            x: 0,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'car-b',
            socketName: 'RearCoupler',
            x: 4,
            y: 0,
            rotation: Math.PI + withinLeeway,
            socketTags: [],
        }],
        allowNewRailCouplerAttachments: true,
    });

    assert.equal(matches.length, 1);
});
