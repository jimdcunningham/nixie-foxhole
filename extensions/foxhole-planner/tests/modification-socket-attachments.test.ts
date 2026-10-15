import assert from 'node:assert/strict';
import test from 'node:test';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { finalizeFoxholeSceneV2Transform } from '../src/scene-v2-transform-finalizer.ts';
import { resolveFoxholeSceneV2SplineAttachments, resolveFoxholeSceneV2ConnectorAttachments } from '../src/scene-v2-attachments.ts';
import { resolveFoxholeEntityStructureSockets } from '../src/effective-structure-sockets.ts';

const port = assets.facilityrefinery1!.modifications.UpgradeSlotComponent!.variants.forge!.overlaySockets!.find(socket => socket.name === 'PipeInput0')!;
const portX = Number(port.x) / 100 * 32;
const portY = Number(port.y) / 100 * 32;
function factory(): NixieExperimentalComponentEntitySnapshotV1 {
    return { entityId: 'factory', revision: 1, components: [
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true, data: { x: 1000, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: 'facilityrefinery1' } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true,
            data: { selections: [{ slotId: 'UpgradeSlotComponent', variantId: 'forge' }] } },
    ] };
}
function pipe(): NixieExperimentalComponentEntitySnapshotV1 {
    return { entityId: 'pipe', revision: 1, components: [
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true, data: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1, definitionAvailable: true, data: {
            foxholeKey: 'facilitypipe', startX: 1000 + portX + 5, startY: portY, startRotation: 0, endX: 700, endY: portY, endRotation: Math.PI,
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 48, maxLength: 1000, minRadius: 24, maxRadius: 24, maxBuffer: 0, curveT: 0, blueprint: false,
        } },
    ] };
}

test('a connector snaps to a selected upgrade-only port with reciprocal owner-local attachments', () => {
    const target = factory(), moving = pipe();
    const before = structuredClone([target, moving]);
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'pipe', transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [target, moving] } });
    const patch = result.transaction?.operations.find(operation => operation.entityId === 'pipe');
    assert.ok(patch?.op === 'patch');
    assert.equal(patch.set?.startX, 1000 + portX);
    assert.equal(patch.set?.startAttachmentNodeId, 'factory');
    assert.equal(patch.set?.startAttachmentSocketName, 'PipeInput0');
    const reciprocal = result.transaction?.operations.find(operation => operation.entityId === 'factory');
    assert.ok(reciprocal?.op === 'add');
    assert.deepEqual(reciprocal.data.attachments, [{ localSocketName: 'PipeInput0', targetEntityId: 'pipe', targetSocketName: 'BackSocket' }]);
    assert.deepEqual([target, moving], before);
});

test('rendered attachment endpoints follow the selected modification port without mutating authored fallback geometry', () => {
    const target = factory(), connected = pipe();
    const data = connected.components[1]!.data;
    Object.assign(data, { startAttachmentNodeId: 'factory', startAttachmentSocketName: 'PipeInput0' });
    const before = structuredClone(data);
    const resolved = resolveFoxholeSceneV2SplineAttachments(connected, data as never, { contractVersion: 1, entities: [target, connected] }, assets);
    assert.equal(resolved.startX, 1000 + portX);
    assert.equal(resolved.startY, portY);
    assert.equal(resolved.endX, data.endX);
    assert.deepEqual(data, before);
});

test('moving the upgraded structure carries its connected endpoint to the modification port', () => {
    const target = factory(), connected = pipe();
    Object.assign(connected.components[1]!.data, { startAttachmentNodeId: 'factory', startAttachmentSocketName: 'PipeInput0' });
    target.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
        data: { attachments: [{ localSocketName: 'PipeInput0', targetEntityId: 'pipe', targetSocketName: 'BackSocket' }] } });
    const before = structuredClone([target, connected]);
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'factory', transform: { x: 1040, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [target, connected] } });
    const patch = result.transaction?.operations.find(operation => operation.entityId === 'pipe');
    assert.ok(patch?.op === 'patch');
    assert.equal(patch.set?.startX, 1040 + portX);
    assert.equal(patch.set?.startY, 20 + portY);
    assert.equal(patch.set?.endX, undefined);
    assert.deepEqual([target, connected], before);
});

test('removed, missing and unresolved modification definitions do not invent an attachment port or erase fallback data', () => {
    for (const kind of ['removed', 'missing', 'unresolved']) {
        const target = factory();
        const modification = target.components[2]!;
        if (kind === 'removed') {
            modification.data.selections = [];
        }
        if (kind === 'missing') {
            modification.data.selections = [{ slotId: 'UpgradeSlotComponent', variantId: 'future-variant' }];
        }
        if (kind === 'unresolved') {
            modification.definitionAvailable = false;
        }
        const connected = pipe();
        const data = connected.components[1]!.data;
        Object.assign(data, { startAttachmentNodeId: 'factory', startAttachmentSocketName: 'PipeInput0' });
        const before = structuredClone([target, connected]);
        assert.equal(resolveFoxholeEntityStructureSockets(target, assets.facilityrefinery1).some(socket => socket.name === 'PipeInput0'), false);
        const resolved = resolveFoxholeSceneV2SplineAttachments(connected, data as never, { contractVersion: 1, entities: [target, connected] }, assets);
        assert.equal(resolved.startX, data.startX);
        assert.deepEqual([target, connected], before);
    }
});

test('point connectors and parented rotated/scaled structure transforms resolve the same selected port', () => {
    const target = factory();
    Object.assign(target.components[0]!.data, { x: 10, y: 20, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 });
    target.components.push({ ownerId: 'nixie.core', componentId: 'hierarchy', version: 1, definitionAvailable: true, data: { parentId: 'parent' } });
    const parent = { entityId: 'parent', revision: 1, components: [{ ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true,
        data: { x: 500, y: 200, rotation: 0, scaleX: 1, scaleY: 1 } }] };
    const connected = pipe();
    connected.components[1] = { ownerId: 'nixie.foxhole-planner', componentId: 'connector', version: 1, definitionAvailable: true,
        data: { foxholeKey: 'facilitypipe', points: [0, 0, 30, 20, 100, 0], startAttachment: { nodeId: 'factory', socketName: 'PipeInput0' } } };
    const data = connected.components[1]!.data;
    const before = structuredClone([target, parent, connected]);
    const resolved = resolveFoxholeSceneV2ConnectorAttachments(connected, data as never, { contractVersion: 1, entities: [target, parent, connected] }, assets);
    assert.ok(Math.abs(resolved.points[0]! - (510 - portY * 2)) < 1e-7);
    assert.ok(Math.abs(resolved.points[1]! - (220 + portX * 2)) < 1e-7);
    assert.deepEqual(resolved.points.slice(2), [30, 20, 100, 0]);
    assert.deepEqual([target, parent, connected], before);
});
