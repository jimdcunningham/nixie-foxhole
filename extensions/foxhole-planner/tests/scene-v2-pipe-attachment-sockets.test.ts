import assert from 'node:assert/strict';
import test from 'node:test';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { listFoxholeSceneV2Products } from '../src/scene-v2-products.ts';
import assets from '../src/scene-v2-assets-node.ts';
import { createFoxholeSpatialProjection } from '../src/scene-v2-spatial-transforms.ts';
import { resolveFoxholeSceneV2SplineAttachments } from '../src/scene-v2-attachments.ts';
import { resolveFoxholeSpatialSplineAttachments } from '../src/scene-v2-spatial-attachments.ts';
import { resolveFoxholeConnectorDisplaySockets } from '../src/scene-v2-connector-socket-overlays.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

function pipe(id: string, x: number, y: number): Entity {
    const template = listFoxholeSceneV2Products({ contractVersion: 1, query: 'facilitypipe', offset: 0, limit: 100 })
        .items.find(item => item.product.id === 'asset.facilitypipe')!.product;
    return { entityId: id, revision: 1, components: [...template.components.map(component => ({ ...component,
        definitionAvailable: true, data: structuredClone(component.data) })), { ownerId: 'nixie.core',
        componentId: 'transform', version: 1, definitionAvailable: true, data: { x, y, rotation: 0, scaleX: 1, scaleY: 1 } }] };
}
const spline = (entity: Entity) => entity.components.find(component => component.componentId === 'spline-connector')!.data;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

for (const name of ['BackSocket', 'FrontSocket', 'LeftSocket', 'RightSocket']) {
    test(`attached pipe follows the reshaped target's ${name} in 2D and spatial views`, () => {
        const target = pipe('target', -96, -16), moving = pipe('moving', 200, -88);
        Object.assign(spline(target), { startX: 0, startY: 0, startRotation: 0,
            endX: 240, endY: -192, endRotation: Math.PI, curveT: 0 });
        if (name === 'BackSocket') Object.assign(spline(target), { startX: 24, startY: -32, startRotation: 0.25 });
        const displayed = resolveFoxholeConnectorDisplaySockets(spline(target) as unknown as FoxholeSceneV2SplineConnectorData, assets.facilitypipe!)
            .find(socket => socket.socket.name === name)!;
        assert.ok(displayed);
        Object.assign(spline(moving), { startX: displayed.x - 296, startY: displayed.y + 72,
            startAttachmentNodeId: target.entityId, startAttachmentSocketName: name });
        moving.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1,
            definitionAvailable: true, data: { elevation: 49.18272018432617 } });
        const context = { contractVersion: 1 as const, entities: [target, moving] };
        const saved = JSON.stringify(context);
        const data = spline(moving) as unknown as FoxholeSceneV2SplineConnectorData & Record<string, unknown>;
        const planar = resolveFoxholeSceneV2SplineAttachments(moving, data, context, assets);
        close(planar.startX, data.startX); close(planar.startY, data.startY);
        close(Math.sin(planar.startRotation - displayed.rotation), 0);
        const spatial = resolveFoxholeSpatialSplineAttachments(moving, data, context, assets);
        close(spatial.startX, data.startX); close(spatial.startY, data.startY);
        close(spatial.startZ, -49.18272018432617);
        assert.deepEqual(spatial.endpointBindings.start, { entityId: target.entityId, point: [displayed.x, displayed.y, 0] });
        assert.equal(JSON.stringify(context), saved, 'rendering never rewrites saved connector state');
    });
}

test('editing a connected target path refreshes the attachment without moving the source entity', () => {
    const target = pipe('target', 40, 60), moving = pipe('moving', 100, 200);
    Object.assign(spline(target), { endX: 240, endY: -192 });
    const data = spline(moving) as unknown as FoxholeSceneV2SplineConnectorData & Record<string, unknown>;
    Object.assign(data, { endAttachmentNodeId: target.entityId, endAttachmentSocketName: 'FrontSocket' });
    const context = { contractVersion: 1 as const, entities: [target, moving] };
    const before = resolveFoxholeSpatialSplineAttachments(moving, data, context, assets);
    close(before.endX, 180); close(before.endY, -332);
    Object.assign(spline(target), { endX: 300, endY: -100 });
    const after = resolveFoxholeSpatialSplineAttachments(moving, data, context, assets);
    close(after.endX, 240); close(after.endY, -240);
    assert.deepEqual(moving.components.find(component => component.componentId === 'transform')!.data,
        { x: 100, y: 200, rotation: 0, scaleX: 1, scaleY: 1 });
});

test('deformed endpoint bindings retain XYZ through rotated, scaled and tilted entity transforms', () => {
    const target = pipe('target', -96, -16), moving = pipe('moving', 200, -88);
    Object.assign(spline(target), { endX: 240, endY: -192 });
    Object.assign(target.components.find(component => component.componentId === 'transform')!.data,
        { rotation: 0.6, scaleX: 1.5, scaleY: 0.75 });
    Object.assign(moving.components.find(component => component.componentId === 'transform')!.data,
        { rotation: -0.3, scaleX: 0.8, scaleY: 2 });
    target.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1,
        definitionAvailable: true, data: { elevation: 100, rotationX: 0.2, rotationY: -0.15, scaleZ: 1.3 } });
    moving.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1,
        definitionAvailable: true, data: { elevation: 49, scaleZ: 2 } });
    const data = spline(moving) as unknown as FoxholeSceneV2SplineConnectorData;
    Object.assign(data, { startAttachmentNodeId: target.entityId, startAttachmentSocketName: 'FrontSocket_GEN_VARIABLE' });
    const context = { contractVersion: 1 as const, entities: [target, moving] };
    const projection = createFoxholeSpatialProjection(context.entities);
    const expected = projection.toLocal(moving, projection.toWorld(target, [240, -192, 0]));
    const actual = resolveFoxholeSpatialSplineAttachments(moving, data, context, assets);
    [actual.startX, actual.startY, actual.startZ].forEach((value, axis) => close(value, expected[axis]!));
    assert.deepEqual(actual.endpointBindings.start?.point, [240, -192, 0]);
});
