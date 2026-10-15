import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceToSplinePath } from '../../../../../packages/nixie/app/plugins/nixie/board/utils/spline-path.ts';
import {
    findBestFoxholeRailCouplerDockSnap,
    findBestFoxholeRailTrackSnap,
    resolveFoxholeRailCouplerDockZoneRotation,
} from '../../app/plugins/foxhole/nixie/structure-rail-track-snapping.ts';

test('rail coupler dock zones use the vehicle axis instead of authored socket rotation', () => {
    const rear = { localX: -60, localY: 8, rotationRadians: Math.PI / 2 };
    const front = { localX: 60, localY: 8, rotationRadians: Math.PI / 2 };

    assert.equal(resolveFoxholeRailCouplerDockZoneRotation(front, [rear, front]), 0);
    assert.equal(resolveFoxholeRailCouplerDockZoneRotation(rear, [rear, front]), Math.PI);
});

test('rail track snap aligns train origin and rotation to the path tangent', () => {
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'train',
        movingOrigin: { x: 10, y: 10 },
        movingRotation: Math.PI / 2,
        tracks: [
            {
                nodeId: 'far',
                points: [
                    { x: 200, y: 200 },
                    { x: 260, y: 200 },
                ],
            },
            {
                nodeId: 'near',
                points: [
                    { x: 0, y: 0 },
                    { x: 40, y: 0 },
                ],
            },
        ],
        moveX: 5,
        moveY: 0,
        maxDistance: 40,
    });

    assert.deepEqual(match, {
        movingNodeId: 'train',
        targetNodeId: 'near',
        moveX: 5,
        moveY: -10,
        // Track runs +X (tangent 0); from +Y facing, nearest align is -π/2.
        rotationDelta: -Math.PI / 2,
        distance: 10,
    });
});

test('rail track snap keeps the closer of tangent or opposite facing', () => {
    const movingRotation = Math.PI * 0.9;
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'train',
        movingOrigin: { x: 0, y: 0 },
        // Already nearly facing -X on a +X track → prefer opposite tangent (π).
        movingRotation,
        tracks: [{
            nodeId: 'track',
            points: [
                { x: 0, y: 0 },
                { x: 40, y: 0 },
            ],
        }],
        moveX: 10,
        moveY: 0,
        maxDistance: 40,
    });

    assert.ok(match);
    assert.ok(Math.abs(Math.abs(match.rotationDelta) - (Math.PI * 0.1)) < 1e-9);
    const finalRotation = normalizeNear(movingRotation + match.rotationDelta);
    assert.ok(
        Math.abs(Math.abs(finalRotation) - Math.PI) < 1e-9,
        `expected facing along -X, got ${finalRotation}`,
    );
});

test('rail track snap returns null when tracks are outside snap radius', () => {
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'train',
        movingOrigin: { x: 0, y: 0 },
        movingRotation: 0,
        tracks: [{
            nodeId: 'track',
            points: [
                { x: 100, y: 100 },
                { x: 140, y: 100 },
            ],
        }],
        moveX: 0,
        moveY: 0,
        maxDistance: 20,
    });

    assert.equal(match, null);
});

test('rail track snap treats hovering the track as explicit snap intent', () => {
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'train',
        movingOrigin: { x: 40, y: 80 },
        movingRotation: 0,
        tracks: [{
            nodeId: 'hovered-track',
            points: [
                { x: 0, y: 0 },
                { x: 120, y: 0 },
            ],
        }],
        moveX: 0,
        moveY: 0,
        maxDistance: 20,
        pointerWorld: { x: 40, y: 4 },
        pointerBiasRadius: 32,
    });

    assert.equal(match?.targetNodeId, 'hovered-track');
    assert.equal(match?.moveX, 0);
    assert.equal(match?.moveY, -80);
});

test('rail track snap prefers the rail under the pointer over a closer parallel rail', () => {
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'train',
        movingOrigin: { x: 40, y: 12 },
        movingRotation: 0,
        tracks: [
            {
                nodeId: 'closer-track',
                points: [
                    { x: 0, y: 0 },
                    { x: 120, y: 0 },
                ],
            },
            {
                nodeId: 'hovered-track',
                points: [
                    { x: 0, y: 60 },
                    { x: 120, y: 60 },
                ],
            },
        ],
        moveX: 0,
        moveY: 0,
        maxDistance: 20,
        pointerWorld: { x: 40, y: 60 },
        pointerBiasRadius: 24,
    });

    assert.equal(match?.targetNodeId, 'hovered-track');
    assert.equal(match?.moveY, 48);
});

test('rail track snap does not expand capture when the pointer misses the track', () => {
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'train',
        movingOrigin: { x: 40, y: 80 },
        movingRotation: 0,
        tracks: [{
            nodeId: 'track',
            points: [
                { x: 0, y: 0 },
                { x: 120, y: 0 },
            ],
        }],
        moveX: 0,
        moveY: 0,
        maxDistance: 20,
        pointerWorld: { x: 40, y: 40 },
        pointerBiasRadius: 24,
    });

    assert.equal(match, null);
});

test('rail track snap prefers the closer of two overlapping track candidates', () => {
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'train',
        movingOrigin: { x: 0, y: 8 },
        movingRotation: 0,
        tracks: [
            {
                nodeId: 'a',
                points: [
                    { x: 0, y: 0 },
                    { x: 40, y: 0 },
                ],
            },
            {
                nodeId: 'b',
                points: [
                    { x: 0, y: 2 },
                    { x: 40, y: 2 },
                ],
            },
        ],
        moveX: 10,
        moveY: 0,
        maxDistance: 40,
    });

    assert.equal(match?.targetNodeId, 'b');
    assert.equal(match?.moveX, 10);
    assert.equal(match?.moveY, -6);
    assert.equal(match?.rotationDelta, 0);
});

test('rail track snap places both wheelbase contacts on a curved path', () => {
    const radius = 80;
    const points = Array.from({ length: 25 }, (_, index) => {
        const angle = (-Math.PI / 3) + ((Math.PI * 2 / 3) * (index / 24));
        return {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
        };
    });
    const wheelBase = 48;
    const movingOrigin = { x: radius, y: 0 };
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'hospital',
        movingOrigin,
        movingRotation: Math.PI / 2,
        wheelBase,
        trackGauge: 'standard',
        tracks: [{ nodeId: 'curve', points, trackGauge: 'standard' }],
        moveX: 0,
        moveY: 0,
        maxDistance: 40,
    });

    assert.ok(match);
    const origin = {
        x: movingOrigin.x + match.moveX,
        y: movingOrigin.y + match.moveY,
    };
    const rotation = Math.PI / 2 + match.rotationDelta;
    const halfWheelBase = wheelBase / 2;
    const rear = {
        x: origin.x - (Math.cos(rotation) * halfWheelBase),
        y: origin.y - (Math.sin(rotation) * halfWheelBase),
    };
    const front = {
        x: origin.x + (Math.cos(rotation) * halfWheelBase),
        y: origin.y + (Math.sin(rotation) * halfWheelBase),
    };

    assert.ok(distanceToSplinePath(rear, points) < 1e-5);
    assert.ok(distanceToSplinePath(front, points) < 1e-5);
    assert.ok(
        distanceToSplinePath(origin, points) > 1,
        'rigid vehicle origin should sit inside the curve while both contacts remain on rail',
    );
});

test('rail track snap filters candidates by track gauge', () => {
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'small-engine',
        movingOrigin: { x: 0, y: 5 },
        movingRotation: 0,
        trackGauge: 'small',
        tracks: [
            {
                nodeId: 'standard-near',
                trackGauge: 'standard',
                points: [{ x: -40, y: 0 }, { x: 40, y: 0 }],
            },
            {
                nodeId: 'small-farther',
                trackGauge: 'small',
                points: [{ x: -40, y: 12 }, { x: 40, y: 12 }],
            },
        ],
        moveX: 0,
        moveY: 0,
        maxDistance: 20,
    });

    assert.equal(match?.targetNodeId, 'small-farther');
    assert.equal(match?.moveY, 7);
});

test('rail track snap follows wheelbase contacts across connected track nodes', () => {
    const radius = 80;
    const completePath = Array.from({ length: 25 }, (_, index) => {
        const angle = (-Math.PI / 3) + ((Math.PI * 2 / 3) * (index / 24));
        return {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
        };
    });
    const wheelBase = 80;
    const movingOrigin = { x: radius, y: 0 };
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'hospital',
        movingOrigin,
        movingRotation: Math.PI / 2,
        wheelBase,
        trackGauge: 'standard',
        tracks: [
            { nodeId: 'left', trackGauge: 'standard', points: completePath.slice(0, 9) },
            { nodeId: 'middle', trackGauge: 'standard', points: completePath.slice(8, 17) },
            { nodeId: 'right', trackGauge: 'standard', points: completePath.slice(16) },
        ],
        moveX: 0,
        moveY: 0,
        maxDistance: 40,
    });

    assert.ok(match);
    const origin = {
        x: movingOrigin.x + match.moveX,
        y: movingOrigin.y + match.moveY,
    };
    const rotation = Math.PI / 2 + match.rotationDelta;
    const rear = {
        x: origin.x - (Math.cos(rotation) * wheelBase / 2),
        y: origin.y - (Math.sin(rotation) * wheelBase / 2),
    };
    const front = {
        x: origin.x + (Math.cos(rotation) * wheelBase / 2),
        y: origin.y + (Math.sin(rotation) * wheelBase / 2),
    };

    assert.ok(distanceToSplinePath(rear, completePath) < 1e-5);
    assert.ok(distanceToSplinePath(front, completePath) < 1e-5);
    assert.ok(distanceToSplinePath(origin, completePath) > 1);
});

test('rail track snap falls back to center tangent when path is shorter than wheelbase', () => {
    const match = findBestFoxholeRailTrackSnap({
        movingNodeId: 'artillery',
        movingOrigin: { x: 5, y: 8 },
        movingRotation: 0,
        wheelBase: 100,
        tracks: [{
            nodeId: 'short-track',
            points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        }],
        moveX: 0,
        moveY: 0,
        maxDistance: 20,
    });

    assert.equal(match?.moveX, 0);
    assert.equal(match?.moveY, -8);
    assert.equal(match?.rotationDelta, 0);
});

test('rail coupler dock aligns an open compatible coupler while preserving wheelbase fit', () => {
    const match = findBestFoxholeRailCouplerDockSnap({
        movingNodeId: 'moving-car',
        movingOrigin: { x: 80, y: 0 },
        movingRotation: 0,
        wheelBase: 40,
        trackGauge: 'standard',
        tracks: [{
            nodeId: 'track',
            trackGauge: 'standard',
            points: [{ x: 0, y: 0 }, { x: 300, y: 0 }],
        }],
        movingSockets: [{
            nodeId: 'moving-car',
            socketName: 'FrontCoupler',
            x: 110,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'parked-car',
            socketName: 'RearCoupler',
            x: 150,
            y: 0,
            rotation: Math.PI,
            socketTags: [],
        }],
        moveX: 20,
        moveY: 0,
    });

    assert.ok(match);
    assert.equal(match.movingSocketName, 'FrontCoupler');
    assert.equal(match.targetSocketName, 'RearCoupler');
    assert.ok(Math.abs(match.moveX - 40) < 1e-6);
    assert.ok(Math.abs(match.moveY) < 1e-6);
    assert.ok(match.couplerDistance < 1e-6);
});

test('rail coupler dock captures a car across the expanded docking zone', () => {
    const match = findBestFoxholeRailCouplerDockSnap({
        movingNodeId: 'moving-car',
        movingOrigin: { x: 20, y: 0 },
        movingRotation: 0,
        wheelBase: 40,
        trackGauge: 'standard',
        tracks: [{
            nodeId: 'track',
            trackGauge: 'standard',
            points: [{ x: 0, y: 0 }, { x: 300, y: 0 }],
        }],
        movingSockets: [{
            nodeId: 'moving-car',
            socketName: 'FrontCoupler',
            x: 50,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'parked-car',
            socketName: 'RearCoupler',
            x: 150,
            y: 0,
            rotation: Math.PI,
            socketTags: [],
        }],
        moveX: 0,
        moveY: 0,
    });

    assert.ok(match);
    assert.ok(Math.abs(match.moveX - 100) < 1e-6);
    assert.ok(match.couplerDistance < 1e-6);
});

test('rail coupler dock follows a connected path across a track seam', () => {
    const match = findBestFoxholeRailCouplerDockSnap({
        movingNodeId: 'moving-car',
        movingOrigin: { x: 70, y: 0 },
        movingRotation: 0,
        wheelBase: 60,
        trackGauge: 'standard',
        tracks: [
            {
                nodeId: 'left-track',
                trackGauge: 'standard',
                points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
            },
            {
                nodeId: 'right-track',
                trackGauge: 'standard',
                points: [{ x: 100, y: 0 }, { x: 220, y: 0 }],
            },
        ],
        movingSockets: [{
            nodeId: 'moving-car',
            socketName: 'FrontCoupler',
            x: 100,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'parked-car',
            socketName: 'RearCoupler',
            x: 130,
            y: 0,
            rotation: Math.PI,
            socketTags: [],
        }],
        moveX: 10,
        moveY: 0,
    });

    assert.ok(match);
    assert.ok(Math.abs(match.moveX - 30) < 1e-6);
    assert.ok(match.couplerDistance < 1e-6);
});

test('rail coupler dock ignores occupied target couplers', () => {
    const match = findBestFoxholeRailCouplerDockSnap({
        movingNodeId: 'moving-car',
        movingOrigin: { x: 80, y: 0 },
        movingRotation: 0,
        wheelBase: 40,
        tracks: [{
            nodeId: 'track',
            points: [{ x: 0, y: 0 }, { x: 300, y: 0 }],
        }],
        movingSockets: [{
            nodeId: 'moving-car',
            socketName: 'FrontCoupler',
            x: 110,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'parked-car',
            socketName: 'RearCoupler',
            x: 150,
            y: 0,
            rotation: Math.PI,
            socketTags: [],
        }],
        moveX: 20,
        moveY: 0,
        isTargetSocketAvailable: () => false,
    });

    assert.equal(match, null);
});

test('rail coupler dock does not fall back when the wheelbase cannot fit', () => {
    const match = findBestFoxholeRailCouplerDockSnap({
        movingNodeId: 'moving-car',
        movingOrigin: { x: 20, y: 0 },
        movingRotation: 0,
        wheelBase: 80,
        tracks: [{
            nodeId: 'short-track',
            points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
        }],
        movingSockets: [{
            nodeId: 'moving-car',
            socketName: 'FrontCoupler',
            x: 50,
            y: 0,
            rotation: 0,
            socketTags: [],
        }],
        targetSockets: [{
            nodeId: 'parked-car',
            socketName: 'RearCoupler',
            x: 60,
            y: 0,
            rotation: Math.PI,
            socketTags: [],
        }],
        moveX: 0,
        moveY: 0,
    });

    assert.equal(match, null);
});

function normalizeNear(value: number): number {
    let angle = value;
    while (angle > Math.PI) {
        angle -= Math.PI * 2;
    }
    while (angle < -Math.PI) {
        angle += Math.PI * 2;
    }
    return angle;
}
