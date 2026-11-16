import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import { listFoxholeSceneV2Products } from '../src/scene-v2-products.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { finalizeFoxholeSceneV2Transform } from '../src/scene-v2-transform-finalizer.ts';

const products = listFoxholeSceneV2Products({ contractVersion: 1, query: 'trench connector', offset: 0, limit: 100 }).items;

function placedTrench(key: string) {
    const product = products.find(entry => entry.product.id === `asset.${key}`)!.product;
    const entity = { entityId: key, revision: 1, components: product.components.map(component => ({ ...structuredClone(component), definitionAvailable: true })) };
    const connector = entity.components.find(component => component.componentId === 'spline-connector');
    assert.ok(connector, key);
    return { entity, connector };
}

for (const key of ['trenchconnectort1', 'trenchconnectort2', 'trenchconnectort3', 'trenchconnectorbuildsite']) {
    test(`Scene V2 catalog places ${key} with independent end rotations`, () => {
        const { entity, connector } = placedTrench(key);
        assert.equal(connector.data.minLength, 80);
        assert.equal(connector.data.maxLength, 256);
        Object.assign(connector.data, { endX: 180, endY: 30, startRotation: -.3, endRotation: .45 });
        const render = () => parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity));
        const before = render();
        assert.deepEqual(before.selectionGeometry?.geometryHandles?.map(handle => handle.id),
            ['start', 'end', 'start-rotation', 'end-rotation']);
        if (key === 'trenchconnectorbuildsite') {
            assert.deepEqual(before.spatial?.nodes.map(node => node.id), [
                'dig-site-start', 'dig-site-end', 'dig-site-rope-1', 'dig-site-rope-2',
            ]);
            const mesh = before.root.children.find(node => node.id === 'trench-dig-site');
            assert.equal(mesh?.kind, 'mesh');
            connector.data.endRotation = -.2;
            const after = render();
            const rotated = after.root.children.find(node => node.id === 'trench-dig-site');
            assert.ok(mesh?.kind === 'mesh' && rotated?.kind === 'mesh');
            assert.deepEqual(mesh.positions.slice(0, 16), rotated.positions.slice(0, 16));
            assert.notDeepEqual(mesh.positions.slice(16), rotated.positions.slice(16));
            assert.deepEqual(before.spatial?.nodes[0], after.spatial?.nodes[0]);
            assert.notDeepEqual(before.spatial?.nodes[1], after.spatial?.nodes[1]);
            assert.notDeepEqual(before.spatial?.nodes[2], after.spatial?.nodes[2]);
            assert.notDeepEqual(before.spatial?.nodes[3], after.spatial?.nodes[3]);
            return;
        }
        const mesh = (plan: typeof before, id: string) => {
            const node = plan.root.children.find(child => child.id === id);
            assert.ok(node?.kind === 'mesh', id);
            return node.positions;
        };
        assert.ok(before.spatial?.nodes.some(node => node.id === 'trench-floor'));
        connector.data.endRotation = -.2;
        const rotated = render();
        assert.deepEqual(mesh(before, 'trench-cap:wallback'), mesh(rotated, 'trench-cap:wallback'));
        assert.notDeepEqual(mesh(before, 'trench-cap:wallfront'), mesh(rotated, 'trench-cap:wallfront'));
        assert.notDeepEqual(mesh(before, 'trench-wall:1:0'), mesh(rotated, 'trench-wall:1:0'));
        assert.notDeepEqual(mesh(before, 'trench-floor'), mesh(rotated, 'trench-floor'));

        connector.data.endAttachmentNodeId = 'neighbor';
        const attached = render();
        assert.ok(attached.root.children.some(node => node.id === 'trench-cap:wallback'));
        assert.ok(!attached.root.children.some(node => node.id === 'trench-cap:wallfront'));
    });
}

test('diagonal Scene V2 trench placement aligns both free ends with the initial span', () => {
    const { entity } = placedTrench('trenchconnectort1');
    const result = finalizeFoxholeSceneV2Transform({
        contractVersion: 1, entityId: entity.entityId, interaction: 'placement',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [entity] },
        geometryGesture: { phase: 'commit', handleId: 'end', worldPoint: { x: 100, y: 100 }, snappingEnabled: false, hoveredEntityIds: [] },
    });
    const patch = result.transaction?.operations.find(operation => operation.op === 'patch' && operation.componentId === 'spline-connector');
    assert.ok(patch?.op === 'patch');
    assert.equal(patch.set?.startRotation, Math.PI / 4);
    assert.equal(patch.set?.endRotation, Math.PI / 4);
});

test('trench end rotation locks to structures and rotates both sides of a connector join', () => {
    const { entity, connector } = placedTrench('trenchconnectort1');
    const neighbor = placedTrench('trenchconnectort2');
    const structure = { entityId: 'structure', revision: 1, components: [{
        ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
        data: { catalogId: 'foxhole.structures', assetId: 'trencht1' },
    }] };
    const check = (target: typeof structure | typeof neighbor.entity) => {
        const context = { contractVersion: 1 as const, entities: [entity, target] };
        const handles = renderFoxholeSceneV2Entity(entity, context).selectionGeometry?.geometryHandles?.map(handle => handle.id);
        const rotate = () => finalizeFoxholeSceneV2Transform({
            contractVersion: 1, entityId: entity.entityId,
            transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context,
            geometryGesture: { phase: 'commit', handleId: 'end-rotation', worldPoint: { x: -20, y: -20 },
                snappingEnabled: true, hoveredEntityIds: [] },
        });
        return { handles, rotate };
    };
    Object.assign(connector.data, { endAttachmentNodeId: structure.entityId, endAttachmentSocketName: 'BackSocket' });
    const fixed = check(structure);
    assert.deepEqual(fixed.handles, ['start', 'end', 'start-rotation']);
    assert.throws(fixed.rotate, /locked to the attached structure/);

    const occupancy = entity.components.find(component => component.componentId === 'socket-attachments')!;
    delete connector.data.endAttachmentNodeId;
    delete connector.data.endAttachmentSocketName;
    occupancy.data.attachments = [{ localSocketName: 'FrontSocket', targetEntityId: structure.entityId, targetSocketName: 'BackSocket' }];
    assert.deepEqual(check(structure).handles, fixed.handles);
    assert.throws(check(structure).rotate, /locked to the attached structure/);

    occupancy.data.attachments = [];
    Object.assign(connector.data, { endAttachmentNodeId: neighbor.entity.entityId, endAttachmentSocketName: 'BackSocket' });
    const joined = check(neighbor.entity);
    assert.deepEqual(joined.handles, ['start', 'end', 'start-rotation', 'end-rotation']);
    const [own, peer] = joined.rotate().transaction?.operations ?? [];
    assert.ok(own?.op === 'patch' && peer?.op === 'patch');
    assert.equal(peer.entityId, neighbor.entity.entityId);
    assert.ok(Math.abs(Number(own.set?.endRotation) - Math.PI / 4) < 1e-9);
    assert.equal(peer.set?.startRotation, own.set?.endRotation);
});
