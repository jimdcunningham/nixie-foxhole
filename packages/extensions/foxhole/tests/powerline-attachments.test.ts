import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileFoxholeConnectorAttachments, resolveFoxholeSplinePowerlineGeometry, resolveFoxholeSplinePowerlineWorldEndpoint } from '../app/plugins/foxhole/nixie/connector.ts';
import { normalizeFoxholeSplineConnectorState, resolveConnectorSocketSnapStemRotation } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { retainFoxholePowerlineAttachments } from '../app/plugins/foxhole/nixie/powerline-attachments.ts';
import { isFoxholePowerlineOverLength, resolveFoxholePowerlineStroke } from '../app/plugins/foxhole/nixie/powerline-stroke.ts';

test('moving a building retains attached powerline ends beyond snap distance', () => {
    const moving = new Map([['building', {}]]);
    const stationary = new Map([['line', {}]]);
    retainFoxholePowerlineAttachments(new Set(['building']), [{
        nodeId: 'line',
        endpoints: [
            { socketName: 'StartSocket', attachment: { nodeId: 'building', socketName: 'PowerSocket' } },
            { socketName: 'EndSocket', attachment: { nodeId: 'other', socketName: 'PowerSocket' } },
        ],
    }], moving, stationary);

    assert.deepEqual(moving.get('building'), {
        PowerSocket: { nodeId: 'line', socketName: 'StartSocket' },
    });
    assert.deepEqual(stationary.get('line'), {
        StartSocket: { nodeId: 'building', socketName: 'PowerSocket' },
    });
});

test('several powerlines retain their own ends on a shared power socket', () => {
    const moving = new Map([['building', { PowerSocket: { nodeId: 'first', socketName: 'StartSocket' } }]]);
    const stationary = new Map([['first', {}], ['second', {}]]);
    retainFoxholePowerlineAttachments(new Set(['building']), ['first', 'second'].map(nodeId => ({
        nodeId,
        endpoints: [{ socketName: 'StartSocket', attachment: { nodeId: 'building', socketName: 'PowerSocket' } }],
    })), moving, stationary);

    assert.deepEqual(moving.get('building'), {
        PowerSocket: { nodeId: 'first', socketName: 'StartSocket' },
    });
    assert.deepEqual(stationary.get('first'), { StartSocket: { nodeId: 'building', socketName: 'PowerSocket' } });
    assert.deepEqual(stationary.get('second'), { StartSocket: { nodeId: 'building', socketName: 'PowerSocket' } });
});

test('only the overlength line changes color and it recovers when shortened', () => {
    const start = { x: 0, y: 0 };
    const maxLength = 100;
    assert.equal(isFoxholePowerlineOverLength(start, { x: 100, y: 0 }, maxLength), false);
    assert.equal(isFoxholePowerlineOverLength(start, { x: 101, y: 0 }, maxLength), true);
    assert.equal(resolveFoxholePowerlineStroke(1, true).color, 0xFF5A5A);
    assert.equal(resolveFoxholePowerlineStroke(1, false).color, 0x000000);
});

test('reloading an overlength line retains its endpoint and attachment', () => {
    const restored = normalizeFoxholeSplineConnectorState({
        foxholeKey: 'powerline',
        maxLength: 100,
        start: { x: 0, y: 0, rotation: 0, handleLength: 15 },
        end: { x: 200, y: 0, rotation: Math.PI },
        startAttachment: { nodeId: 'pole', socketName: 'PowerSocket' },
    });
    assert.equal(restored.end.x, 200);
    assert.equal(restored.start.handleLength, 15);
    assert.deepEqual(restored.startAttachment, { nodeId: 'pole', socketName: 'PowerSocket' });
});

test('moving only one building stretches the line toward its stationary far end', () => {
    const geometry = resolveFoxholeSplinePowerlineGeometry({
        currentStart: { x: 0, y: 0 },
        currentEnd: { x: 100, y: 0 },
        attachedStart: { x: 300, y: 0 },
        attachedEnd: { x: 100, y: 0 },
    });
    assert.deepEqual(geometry, {
        x: 300,
        y: 0,
        start: { x: 0, y: 0, rotation: Math.PI },
        end: { x: -200, y: 0, rotation: Math.PI },
    });
    assert.equal(isFoxholePowerlineOverLength(geometry!.start, geometry!.end, 150), true);
});

test('moving the start pole keeps both power socket facings reconcilable', () => {
    const geometry = resolveFoxholeSplinePowerlineGeometry({
        currentStart: { x: 0, y: 0, rotation: 0 },
        currentEnd: { x: 100, y: 0, rotation: Math.PI },
        attachedStart: { x: 0, y: 100, rotation: 0 },
        attachedEnd: { x: 100, y: 0, rotation: 0 },
        nodeRotation: 0,
    });
    assert.ok(geometry);
    const powerTags = [{ mask: BigInt(131072), category: BigInt(262144) }];
    const result = reconcileFoxholeConnectorAttachments({
        connectorNodeId: 'line', startSocketName: 'BackSocket', endSocketName: 'FrontSocket',
        movingSockets: [
            { nodeId: 'line', socketName: 'BackSocket', x: 0, y: 100,
                rotation: resolveConnectorSocketSnapStemRotation('start', geometry.start.rotation, 0, 'powerline'),
                socketTags: powerTags },
            { nodeId: 'line', socketName: 'FrontSocket', x: 100, y: 0,
                rotation: resolveConnectorSocketSnapStemRotation('end', geometry.end.rotation, 0, 'powerline'),
                socketTags: powerTags },
        ],
        targets: [
            { nodeId: 'start-pole', sockets: [{ nodeId: 'start-pole', socketName: 'PowerSocket', x: 0, y: 100,
                rotation: 0, socketTags: powerTags }], attachments: {} },
            { nodeId: 'end-pole', sockets: [{ nodeId: 'end-pole', socketName: 'PowerSocket', x: 100, y: 0,
                rotation: 0, socketTags: powerTags }], attachments: {} },
        ],
    });
    assert.deepEqual(result.startAttachment, { nodeId: 'start-pole', socketName: 'PowerSocket' });
    assert.deepEqual(result.endAttachment, { nodeId: 'end-pole', socketName: 'PowerSocket' });
});

test('rotating an attached pole updates its facing without changing a free endpoint', () => {
    const freeEndRotation = 0.8;
    const geometry = resolveFoxholeSplinePowerlineGeometry({
        currentStart: { x: 0, y: 0, rotation: 0 },
        currentEnd: { x: 100, y: 0, rotation: freeEndRotation },
        attachedStart: { x: 20, y: 10, rotation: Math.PI / 2 },
        nodeRotation: Math.PI / 4,
    });
    assert.ok(geometry);
    assert.ok(Math.abs(geometry.start.rotation - Math.PI / 4) < 0.0001);
    assert.equal(geometry.end.rotation, freeEndRotation);
});

test('moving a pole preserves a rotated and scaled line’s free endpoint in world space', () => {
    const origin = { x: 40, y: 50 };
    const nodeRotation = Math.PI / 2;
    const nodeScaleX = 1.5;
    const nodeScaleY = 0.75;
    const originalStart = { x: 0, y: 0, rotation: 0 };
    const originalEnd = { x: 100, y: 20, rotation: Math.PI };
    const freeEndWorld = resolveFoxholeSplinePowerlineWorldEndpoint(
        origin, originalEnd, nodeRotation, nodeScaleX, nodeScaleY,
    );
    assert.ok(Math.abs(freeEndWorld.x - 25) < 0.0001);
    assert.ok(Math.abs(freeEndWorld.y - 200) < 0.0001);
    const geometry = resolveFoxholeSplinePowerlineGeometry({
        currentStart: resolveFoxholeSplinePowerlineWorldEndpoint(
            origin, originalStart, nodeRotation, nodeScaleX, nodeScaleY,
        ),
        currentEnd: freeEndWorld,
        attachedStart: { x: 80, y: 90, rotation: 0 },
        nodeRotation,
        nodeScaleX,
        nodeScaleY,
    });
    assert.ok(geometry);
    assert.equal(geometry.x, 80);
    assert.equal(geometry.y, 90);
    assert.ok(Math.abs(geometry.end.x - (110 / 1.5)) < 0.0001);
    assert.ok(Math.abs(geometry.end.y - (55 / 0.75)) < 0.0001);
    const restoredEndWorld = resolveFoxholeSplinePowerlineWorldEndpoint(
        { x: geometry.x, y: geometry.y }, geometry.end, nodeRotation, nodeScaleX, nodeScaleY,
    );
    assert.ok(Math.abs(restoredEndWorld.x - freeEndWorld.x) < 0.0001);
    assert.ok(Math.abs(restoredEndWorld.y - freeEndWorld.y) < 0.0001);
    assert.equal(geometry.end.rotation, originalEnd.rotation);
});
