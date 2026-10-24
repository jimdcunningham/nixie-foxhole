import assert from 'node:assert/strict';
import test from 'node:test';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { listFoxholeSceneV2Products } from '../src/scene-v2-products.ts';
import { resolveFoxholeSceneV2SplineAttachments } from '../src/scene-v2-attachments.ts';
import { resolveFoxholeSpatialSplineAttachments } from '../src/scene-v2-spatial-attachments.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

function product(key: string, id: string): Entity {
    const p = listFoxholeSceneV2Products({ contractVersion: 1, query: key, offset: 0, limit: 100 }).items
        .find(item => item.product.id === `asset.${key}`)!.product;
    return { entityId: id, revision: 1, components: [...p.components.map(c => ({ ...c, data: structuredClone(c.data), definitionAvailable: true })),
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true,
            data: { x: id === 'target' ? 30 : -20, y: 10, rotation: 0, scaleX: 1, scaleY: 1 } }] };
}
for (const key of ['powerline', 'facilitypipeunderground', 'facilitypipeoverhead', 'railtrackspline', 'railtracksplinebiarc',
    'smallrailtrackspline', 'smallrailtracksplinebiarc', 'cranerailtrackspline', 'facilityroad', 'wallsplinet2', 'sandbagfullspline', 'waterwallsplinet1']) {
    test(`${key} attachment resolves its edited endpoints in both scene presentations`, () => {
        const target = product(key, 'target'), moving = product('facilitypipe', 'moving');
        const geometry = target.components.find(c => c.componentId === 'spline-connector')!.data;
        Object.assign(geometry, { startX: 24, startY: -32, endX: 240, endY: -192 });
        for (const role of ['start', 'end'] as const) {
            const input = { ...moving.components.find(c => c.componentId === 'spline-connector')!.data,
                startAttachmentNodeId: target.entityId, startAttachmentSocketName: geometry[`${role}SocketName`] } as unknown as FoxholeSceneV2SplineConnectorData & Record<string, unknown>;
            const context = { contractVersion: 1 as const, entities: [target, moving] };
            const before = JSON.stringify(context);
            const planar = resolveFoxholeSceneV2SplineAttachments(moving, input, context, assets);
            const spatial = resolveFoxholeSpatialSplineAttachments(moving, input, context, assets);
            assert.deepEqual([planar.startX, planar.startY], [Number(geometry[`${role}X`]) + 50, geometry[`${role}Y`]], role);
            assert.deepEqual([spatial.startX, spatial.startY, spatial.startZ], [planar.startX, planar.startY, 0], role);
            assert.deepEqual(spatial.endpointBindings.start?.point, [geometry[`${role}X`], geometry[`${role}Y`], 0]);
            assert.equal(JSON.stringify(context), before);
        }
    });
}
test('legacy point connector targets resolve edited endpoints instead of the template', () => {
    const target = product('facilitypipe', 'target'), moving = product('facilitypipe', 'moving');
    const index = target.components.findIndex(c => c.componentId === 'spline-connector');
    target.components[index] = { ownerId: 'nixie.foxhole-planner', componentId: 'connector', version: 1, definitionAvailable: true,
        data: { foxholeKey: 'facilitypipe', points: [24, -32, 100, -50, 240, -192], startSocketName: 'BackSocket', endSocketName: 'FrontSocket' } };
    const input = { ...moving.components.find(c => c.componentId === 'spline-connector')!.data,
        startAttachmentNodeId: target.entityId, startAttachmentSocketName: 'FrontSocket' } as unknown as FoxholeSceneV2SplineConnectorData & Record<string, unknown>;
    const context = { contractVersion: 1 as const, entities: [target, moving] };
    const planar = resolveFoxholeSceneV2SplineAttachments(moving, input, context, assets);
    assert.deepEqual([planar.startX, planar.startY], [290, -192]);
});
