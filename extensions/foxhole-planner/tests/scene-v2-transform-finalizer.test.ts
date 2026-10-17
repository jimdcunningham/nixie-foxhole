import assert from 'node:assert/strict';
import test from 'node:test';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { finalizeFoxholeSceneV2Transform } from '../src/scene-v2-transform-finalizer.ts';
import { isFoxholePowerSocketConnectionAvailable } from '../src/power-socket-capacity.ts';

test('power capacity counts endpoint records rather than distinct connector IDs and allows an endpoint to retain its slot', () => {
    const connections = ['line-a', 'line-b'].flatMap(connectorNodeId => ['BackSocket', 'FrontSocket'].map(connectorSocketName => ({
        connectorNodeId, connectorSocketName, attachment: { nodeId: 'switch', socketName: 'PowerSocket' },
    })));
    const options = { targetNodeId: 'switch', targetSocketName: 'PowerSocket', maxConnections: 4, connections,
        movingConnectorNodeId: 'new-line', movingConnectorSocketName: 'BackSocket' };
    assert.equal(isFoxholePowerSocketConnectionAvailable(options), false);
    assert.equal(isFoxholePowerSocketConnectionAvailable({ ...options, movingConnectorNodeId: 'line-a' }), true);
});

function pipe(id: string, startX: number): NixieExperimentalComponentEntitySnapshotV1 {
    const entity = structure(id, 0);
    entity.components.splice(1, 2, { ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1, definitionAvailable: true,
        data: { foxholeKey: 'facilitypipe', startX, startY: 0, startRotation: 0, endX: 300, endY: 0, endRotation: Math.PI,
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 48, maxLength: 1000, minRadius: 24, maxRadius: 24, maxBuffer: 0, curveT: 0, blueprint: false } });
    return entity;
}

test('connector geometry snapping uses typed endpoints and writes reciprocal socket occupancy', () => {
    const moving = pipe('pipe', 95);
    const target = structure('target', 100);
    target.components[1]!.data.assetId = 'facilitypipe';
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'pipe', transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, target] } });
    const geometry = result.transaction!.operations.find(operation => operation.entityId === 'pipe');
    assert.ok(geometry?.op === 'patch');
    assert.equal(geometry.set?.startX, 100);
    assert.equal(geometry.set?.startAttachmentNodeId, 'target');
    const reciprocal = result.transaction!.operations.find(operation => operation.entityId === 'target');
    assert.ok(reciprocal?.op === 'patch');
    assert.deepEqual(reciprocal.set?.attachments, [{ localSocketName: 'BackSocket', targetEntityId: 'pipe', targetSocketName: 'BackSocket' }]);
    assert.equal(moving.components[1]!.data.startX, 95);
});

test('saved defense splines without endpoint names still snap and record reciprocal occupancy', () => {
    for (const assetId of ['barbedwirespline', 'barbedwirewallspline', 'sandbaghalfspline', 'sandbagfullspline', 'waterwallsplinet1']) {
        const moving = pipe(`moving-${assetId}`, 0);
        const target = pipe(`target-${assetId}`, 0);
        const movingData = moving.components[1]!.data;
        const targetData = target.components[1]!.data;
        Object.assign(movingData, { foxholeKey: assetId, endX: 160, endRotation: 0 });
        Object.assign(targetData, { foxholeKey: assetId, endX: 160, endRotation: 0 });
        delete movingData.startSocketName;
        delete movingData.endSocketName;
        delete targetData.startSocketName;
        delete targetData.endSocketName;
        target.components[0]!.data.x = 160;

        const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
            transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
            context: { contractVersion: 1, entities: [moving, target] } });
        const geometry = result.transaction?.operations.find(operation => operation.entityId === moving.entityId);
        assert.ok(geometry?.op === 'patch', assetId);
        assert.equal(geometry.set?.endAttachmentNodeId, target.entityId, assetId);
        assert.equal(geometry.set?.endAttachmentSocketName, 'BackSocket', assetId);
        const reciprocal = result.transaction?.operations.find(operation => operation.entityId === target.entityId);
        assert.ok(reciprocal?.op === 'add', assetId);
        assert.deepEqual(reciprocal.data.attachments, [{ localSocketName: 'BackSocket',
            targetEntityId: moving.entityId, targetSocketName: 'FrontSocket' }], assetId);
    }
});

test('pipe-to-pipe side attachment survives finalization with reciprocal occupancy', () => {
    const target = pipe('target-pipe', 0);
    Object.assign(target.components[0]!.data, { x: 104.9168, y: 100.04 });
    Object.assign(target.components[1]!.data, { startX: 0, startY: 0, startRotation: -Math.PI / 2,
        endX: 0, endY: -200.08, endRotation: Math.PI / 2, minLength: 96, maxLength: 640, minRadius: 16, maxRadius: 96, maxBuffer: 96 });
    const moving = pipe('branch-pipe', 0);
    Object.assign(moving.components[0]!.data, { x: 95.4168 });
    Object.assign(moving.components[1]!.data, { startRotation: -Math.PI, endX: -159.9168, endRotation: 0,
        startAttachmentNodeId: target.entityId, startAttachmentSocketName: 'LeftSocket' });
    const original = structuredClone([moving, target]);
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        transform: { x: 95.4168, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, target] } });
    const geometry = result.transaction!.operations.find(operation => operation.entityId === moving.entityId);
    assert.ok(!geometry || geometry.op === 'patch');
    if (geometry?.op === 'patch') {
        assert.ok(!geometry.unset?.includes('startAttachmentNodeId'));
    }
    const reciprocal = result.transaction!.operations.find(operation => operation.entityId === target.entityId);
    assert.ok(reciprocal?.op === 'add');
    assert.deepEqual(reciprocal.data.attachments, [{ localSocketName: 'LeftSocket', targetEntityId: moving.entityId, targetSocketName: 'BackSocket' }]);
    assert.deepEqual([moving, target], original);
});

test('moving a pipeline carries its side-connected branch in authored geometry while preserving the free end', () => {
    const target = pipe('target-pipe', 0);
    Object.assign(target.components[0]!.data, { x: 6000, y: 0 });
    Object.assign(target.components[1]!.data, { startX: 0, startY: 0, startRotation: Math.PI / 2,
        endX: 0, endY: 225, endRotation: -Math.PI / 2, minLength: 96, maxLength: 640, minRadius: 16, maxRadius: 96, maxBuffer: 96 });
    target.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
        data: { attachments: [{ localSocketName: 'LeftSocket', targetEntityId: 'branch', targetSocketName: 'BackSocket' }] } });
    const branch = pipe('branch', 0);
    Object.assign(branch.components[0]!.data, { x: 6009.5, y: 112.5 });
    Object.assign(branch.components[1]!.data, { startX: 0, startY: 0, startRotation: 0, endX: 135, endY: 0,
        endRotation: Math.PI, startAttachmentNodeId: target.entityId, startAttachmentSocketName: 'LeftSocket' });
    const before = structuredClone([target, branch]);
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: target.entityId,
        transform: { x: 6064, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [target, branch] } });
    const patch = result.transaction?.operations.find(operation => operation.entityId === branch.entityId);
    assert.ok(patch?.op === 'patch');
    assert.ok(Math.abs(Number(patch.set?.startX) - 64) < 1e-8);
    assert.equal(patch.set?.startY, undefined, 'the unchanged local Y coordinate is preserved');
    assert.equal(patch.set?.endX, undefined);
    assert.equal(patch.set?.startAttachmentNodeId, undefined);
    assert.deepEqual([target, branch], before);
});

test('moving a connector carries both endpoints of a point connector without losing its interior points', () => {
    const target = pipe('target', 0);
    target.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
        data: { attachments: [{ localSocketName: 'FrontSocket', targetEntityId: 'points', targetSocketName: 'BackSocket' },
            { localSocketName: 'BackSocket', targetEntityId: 'points', targetSocketName: 'FrontSocket' }] } });
    const points = pipe('points', 0);
    points.components[1] = { ownerId: 'nixie.foxhole-planner', componentId: 'connector', version: 1, definitionAvailable: true,
        data: { foxholeKey: 'facilitypipe', points: [300, 0, 150, 40, 0, 0], startSocketName: 'BackSocket', endSocketName: 'FrontSocket',
            startAttachment: { nodeId: target.entityId, socketName: 'FrontSocket' }, endAttachment: { nodeId: target.entityId, socketName: 'BackSocket' } } };
    const before = structuredClone([target, points]);
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: target.entityId,
        transform: { x: 64, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [target, points] } });
    const patch = result.transaction?.operations.find(operation => operation.entityId === points.entityId);
    assert.ok(patch?.op === 'patch');
    assert.deepEqual(patch.set?.points, [364, 0, 150, 40, 64, 0]);
    assert.deepEqual([target, points], before);
});

test('stale reciprocal rows do not move a branch whose endpoint belongs to another host', () => {
    const target = pipe('target', 0);
    target.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
        data: { attachments: [{ localSocketName: 'FrontSocket', targetEntityId: 'branch', targetSocketName: 'BackSocket' }] } });
    const branch = pipe('branch', 300);
    Object.assign(branch.components[1]!.data, { startAttachmentNodeId: 'different-host', startAttachmentSocketName: 'FrontSocket' });
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: target.entityId,
        transform: { x: 1000, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [target, branch] } });
    assert.ok(!result.transaction?.operations.some(operation => operation.entityId === branch.entityId && operation.componentId === 'spline-connector'));
});

test('power socket capacity counts every endpoint and preserves reciprocal connections', () => {
    const target = structure('switch', 0);
    target.components[1]!.data.assetId = 'powerbox';
    const moving = pipe('new-line', 38.4);
    Object.assign(moving.components[1]!.data, { foxholeKey: 'powerline', startY: 0.0128, endX: 500, endY: 0 });
    const existing = Array.from({ length: 4 }, (_, index) => {
        const line = pipe(`existing-${index}`, -1000 - index * 100);
        Object.assign(line.components[1]!.data, { foxholeKey: 'powerline', endAttachmentNodeId: target.entityId, endAttachmentSocketName: 'PowerSocket' });
        return line;
    });
    target.components[2]!.data.attachments = [{ localSocketName: 'PowerSocket', targetEntityId: existing[0]!.entityId, targetSocketName: 'FrontSocket' }];
    const run = (lines: typeof existing) => finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, target, ...lines] } });
    const free = run(existing.slice(0, 1));
    const geometry = free.transaction!.operations.find(operation => operation.entityId === moving.entityId);
    assert.ok(geometry?.op === 'patch');
    assert.equal(geometry.set?.startAttachmentNodeId, target.entityId);
    const reciprocal = free.transaction!.operations.find(operation => operation.entityId === target.entityId);
    assert.ok(reciprocal?.op === 'patch');
    assert.deepEqual(reciprocal.set?.attachments, [
        { localSocketName: 'PowerSocket', targetEntityId: existing[0]!.entityId, targetSocketName: 'FrontSocket' },
        { localSocketName: 'PowerSocket', targetEntityId: moving.entityId, targetSocketName: 'BackSocket' },
    ]);
    const full = run(existing);
    assert.ok(!full.transaction?.operations.some(operation => operation.entityId === moving.entityId && operation.op === 'patch'
        && operation.set?.startAttachmentNodeId === target.entityId));
});

test('power endpoints already linked to a structure cannot be reused as a capacity bypass', () => {
    const target = structure('switch', 0);
    target.components[1]!.data.assetId = 'powerbox';
    const existing = pipe('existing-line', 38.4);
    Object.assign(existing.components[1]!.data, { foxholeKey: 'powerline', startY: 0.0128,
        startAttachmentNodeId: target.entityId, startAttachmentSocketName: 'PowerSocket' });
    target.components[2]!.data.attachments = [{ localSocketName: 'PowerSocket', targetEntityId: existing.entityId, targetSocketName: 'BackSocket' }];
    const moving = pipe('new-line', 38.4);
    Object.assign(moving.components[1]!.data, { foxholeKey: 'powerline', startY: 0.0128, endX: 600 });
    const run = (others: typeof existing[]) => finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, ...others, target] } });
    const free = run([existing]);
    const geometry = free.transaction!.operations.find(operation => operation.entityId === moving.entityId);
    assert.ok(geometry?.op === 'patch');
    assert.equal(geometry.set?.startAttachmentNodeId, target.entityId);
    const occupied = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(existing), entityId: `occupied-${index}` }));
    const full = run(occupied);
    assert.ok(!full.transaction?.operations.some(operation => operation.entityId === moving.entityId && operation.op === 'patch'
        && operation.set?.startAttachmentNodeId));
});

test('a moving structure cannot claim a connector endpoint whose typed link is already occupied', () => {
    const moving = structure('new-switch', 0);
    moving.components[1]!.data.assetId = 'powerbox';
    const linked = pipe('existing-line', 38.4);
    Object.assign(linked.components[1]!.data, { foxholeKey: 'powerline', startY: 0.0128,
        startAttachmentNodeId: 'occupied-switch', startAttachmentSocketName: 'PowerSocket', endX: 600 });
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, linked] } });
    assert.equal(result.transaction, undefined);
});

test('moving a structure preserves its attached connector and carries the endpoint to the socket', () => {
    const moving = structure('target', 100);
    moving.components[1]!.data.assetId = 'facilitypipe';
    moving.components[2]!.data.attachments = [{ localSocketName: 'BackSocket', targetEntityId: 'pipe', targetSocketName: 'BackSocket' }];
    const connected = pipe('pipe', 100);
    connected.components[1]!.data.startAttachmentNodeId = 'target';
    connected.components[1]!.data.startAttachmentSocketName = 'BackSocket';
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'target', transform: { x: 140, y: 20, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, connected] } });
    const geometry = result.transaction!.operations.find(operation => operation.entityId === 'pipe');
    assert.ok(geometry?.op === 'patch');
    assert.equal(geometry.set?.startX, 140);
    assert.equal(geometry.set?.startY, 20);
    assert.equal(result.transaction!.operations.some(operation => operation.entityId === 'target'), false);
});

function structure(entityId: string, x: number): NixieExperimentalComponentEntitySnapshotV1 {
    return {
        entityId,
        revision: 0,
        components: [{
            ownerId: 'nixie.core',
            componentId: 'transform',
            version: 1,
            definitionAvailable: true,
            data: { x, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'artilleryait1' },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'socket-attachments',
            version: 1,
            definitionAvailable: true,
            data: { attachments: [] },
        }],
    };
}

test('snaps compatible Foxhole sockets and writes reciprocal owner-local attachments', () => {
    const moving = structure('moving', 0);
    const target = structure('target', 160);
    const result = finalizeFoxholeSceneV2Transform({
        contractVersion: 1,
        entityId: moving.entityId,
        transform: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [moving, target] },
    });
    assert.deepEqual(result.transform, { x: 0, y: 0 });
    assert.equal(result.transaction?.operations.length, 2);
    assert.deepEqual(result.transaction?.operations.map(operation => operation.entityId).sort(), ['moving', 'target']);
    assert.ok(result.transaction?.operations.every(operation => operation.componentId === 'socket-attachments'));
});

test('rigid sockets at the same map position cannot connect across different elevations', () => {
    const moving = structure('moving', 0), target = structure('target', 160);
    target.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1,
        definitionAvailable: true, data: { elevation: 100 } });
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        transform: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, target] } });
    assert.deepEqual(result.transform, { x: 5, y: 0 });
    assert.equal(result.transaction, undefined);
});

test('concrete foundations align their authored edge sockets and record a connection', () => {
    for (const assetId of ['foundation012x2t1', 'foundation012x2t3']) {
        const moving = structure('moving-foundation', 0);
        const target = structure('target-foundation', 0);
        for (const entity of [moving, target]) {
            entity.components[1]!.data.assetId = assetId;
        }
        const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
            transform: { x: 326, y: 4, rotation: 0, scaleX: 1, scaleY: 1 },
            context: { contractVersion: 1, entities: [moving, target] } });
        assert.deepEqual(result.transform, { x: 320, y: 0 }, assetId);
        assert.equal(result.transaction?.operations.length, 2, assetId);
        assert.ok(result.transaction?.operations.every(operation => operation.componentId === 'socket-attachments'));
        for (const operation of result.transaction!.operations) {
            const attachments = operation.op === 'patch' ? operation.set?.attachments : operation.op === 'add' ? operation.data.attachments : undefined;
            assert.equal(Array.isArray(attachments) && attachments.length, 2, 'both aligned edge sockets must connect');
        }
    }
});

test('nearby rigid sockets align XYZ while distant vertical candidates stay detached', () => {
    const moving = structure('moving', 0), target = structure('target', 160);
    target.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1,
        definitionAvailable: true, data: { elevation: 12 } });
    const before = structuredClone([moving, target]);
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        transform: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, target] } });
    assert.deepEqual(result.transform, { x: 0, y: 0, elevation: 12 });
    assert.equal(result.transaction?.operations.length, 2);
    assert.deepEqual([moving, target], before, 'only Studio may commit the proposed elevation');
});

test('a foundation connects every aligned neighbor and clears every reciprocal link on detach', () => {
    const moving = structure('moving', 320), left = structure('left', 0), above = structure('above', 320);
    const entities = [moving, left, above];
    for (const entity of entities) entity.components[1]!.data.assetId = 'foundation012x2t3';
    moving.components[0]!.data.y = 320;
    left.components[0]!.data.y = 320;
    const transform = { x: 325, y: 324, rotation: 0, scaleX: 1, scaleY: 1 };
    const connected = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        transform, context: { contractVersion: 1, entities } });
    assert.deepEqual(connected.transform, { x: 320, y: 320 });
    for (const operation of connected.transaction!.operations) {
        if (operation.op !== 'patch' || operation.componentId !== 'socket-attachments') continue;
        const entity = entities.find(candidate => candidate.entityId === operation.entityId)!;
        entity.components[2]!.data.attachments = operation.set!.attachments!;
    }
    assert.equal((moving.components[2]!.data.attachments as unknown[]).length, 4);
    assert.equal((left.components[2]!.data.attachments as unknown[]).length, 2);
    assert.equal((above.components[2]!.data.attachments as unknown[]).length, 2);
    const detached = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        transform: { ...transform, x: 1000 }, context: { contractVersion: 1, entities } });
    assert.equal(detached.transaction!.operations.length, 3);
    for (const operation of detached.transaction!.operations) {
        assert.ok(operation.op === 'patch');
        assert.deepEqual(operation.set!.attachments, []);
    }
});

test('detaches reciprocal attachments when a structure is moved out of range', () => {
    const moving = structure('moving', 0);
    const target = structure('target', 160);
    moving.components[2]!.data.attachments = [{
        localSocketName: 'FortCommon:FrontFortSocket',
        targetEntityId: 'target',
        targetSocketName: 'FortCommon:BackFortSocket',
    }];
    target.components[2]!.data.attachments = [{
        localSocketName: 'FortCommon:BackFortSocket',
        targetEntityId: 'moving',
        targetSocketName: 'FortCommon:FrontFortSocket',
    }];
    const result = finalizeFoxholeSceneV2Transform({
        contractVersion: 1,
        entityId: moving.entityId,
        transform: { x: -100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [moving, target] },
    });
    assert.deepEqual(result.transform, { x: -100, y: 0 });
    assert.deepEqual(result.transaction?.operations.map(operation => (
        'set' in operation ? operation.set?.attachments : undefined
    )), [[], []]);
});


test('moving foundation pairs ignore internal sockets and connect both stationary neighbors', () => {
    for (const assetId of ['foundation012x2t1', 'foundation012x2t3']) {
        const a = structure('moving-a', 326), b = structure('moving-b', 326);
        const left = structure('target-a', 0), right = structure('target-b', 0);
        const entities = [a, b, left, right];
        entities.forEach(entity => { entity.components[1]!.data.assetId = assetId; });
        a.components[0]!.data.y = 4;
        b.components[0]!.data.y = 324;
        right.components[0]!.data.y = 320;
        const internal = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: a.entityId,
            transform: { x: 326, y: 4, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [a, b] } });
        for (const operation of internal.transaction!.operations) {
            if (operation.op === 'patch') entities.find(entity => entity.entityId === operation.entityId)!.components[2]!.data.attachments = operation.set!.attachments!;
        }
        for (const targets of [[left, right], [right]]) {
            const before = structuredClone(entities);
            const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: a.entityId,
                movingEntityIds: [a.entityId, b.entityId], transform: { x: 326, y: 4, rotation: 0, scaleX: 1, scaleY: 1 },
                context: { contractVersion: 1, entities: [a, b, ...targets] } });
            assert.deepEqual(result.transform, { x: 320, y: 0 }, assetId);
            const patches = result.transaction!.operations;
            for (const target of targets) assert.ok(patches.some(operation => operation.entityId === target.entityId));
            for (const member of [a, b]) {
                const patch = patches.find(operation => operation.entityId === member.entityId);
                if (patch?.op === 'patch') {
                    const attachments = patch.set!.attachments as Array<{ targetEntityId: string }>;
                    assert.ok(attachments.some(item => item.targetEntityId === (member === a ? b : a).entityId), 'internal links survive');
                }
            }
            assert.deepEqual(entities, before, 'finalization never mutates the supplied context');
        }
    }
});


test('a foundation group shares height correction and detaches external links without losing internal links', () => {
    const entities = [structure('a', 326), structure('b', 326), structure('left', 0), structure('right', 0)];
    entities.forEach(entity => { entity.components[1].data.assetId = 'foundation012x2t3'; });
    entities[0].components[0].data.y = 4;
    entities[1].components[0].data.y = 324;
    entities[3].components[0].data.y = 320;
    for (const target of entities.slice(2)) target.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1,
        definitionAvailable: true, data: { elevation: 12 } });
    const apply = (result: ReturnType<typeof finalizeFoxholeSceneV2Transform>) => {
        for (const operation of result.transaction?.operations ?? []) {
            if (operation.op === 'patch') entities.find(entity => entity.entityId === operation.entityId)!.components[2].data.attachments = operation.set!.attachments!;
        }
    };
    apply(finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'a', transform: { x: 326, y: 4, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: entities.slice(0, 2) } }));
    const snapped = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'a', movingEntityIds: ['a', 'b'],
        transform: { x: 326, y: 4, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities } });
    assert.deepEqual(snapped.transform, { x: 320, y: 0, elevation: 12 });
    apply(snapped);
    for (const [index, member] of entities.slice(0, 2).entries()) {
        Object.assign(member.components[0].data, { x: 1000, y: index * 320 });
        member.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1, definitionAvailable: true, data: { elevation: 12 } });
    }
    const detached = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'a', movingEntityIds: ['a', 'b'],
        transform: { x: 1000, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities } });
    apply(detached);
    for (const [index, member] of entities.slice(0, 2).entries()) {
        const attachments = member.components[2].data.attachments as Array<{ targetEntityId: string }>;
        assert.equal(attachments.length, 2);
        assert.ok(attachments.every(item => item.targetEntityId === entities[1 - index].entityId));
    }
    for (const target of entities.slice(2)) assert.deepEqual(target.components[2].data.attachments, []);
});
