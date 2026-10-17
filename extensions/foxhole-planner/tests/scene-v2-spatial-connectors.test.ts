import assert from 'node:assert/strict';
import test from 'node:test';
import { listFoxholeSceneV2Products } from '../src/scene-v2-products.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import assets from '../src/scene-v2-assets-node.ts';
import { resolveFoxholeSpatialSplineAttachments } from '../src/scene-v2-spatial-attachments.ts';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';
import { FOXHOLE_POWERLINE_INVALID_COLOR } from '../src/powerline-stroke.ts';

function product(id: string, x = 0, y = 0): Entity {
    const template = listFoxholeSceneV2Products({ contractVersion: 1, query: id, offset: 0, limit: 100 }).items.find(item => item.product.id === `asset.${id}`)!.product;
    return { entityId: id, revision: 1, components: [...template.components.map(component => ({ ...component, definitionAvailable: true,
        data: structuredClone(component.data) })), { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true,
        data: { x, y, rotation: 0, scaleX: 1, scaleY: 1 } }] };
}
test('power cable follows real pole and facility sockets, retains heights and regenerates after moving the facility', () => {
    const pole = product('powerpole'), facility = product('facilitypowerdiesel', 500, 160), cable = product('powerline');
    const spline = cable.components.find(component => component.componentId === 'spline-connector')!.data;
    Object.assign(spline, { startAttachmentNodeId: pole.entityId, startAttachmentSocketName: 'PowerSocket',
        endAttachmentNodeId: facility.entityId, endAttachmentSocketName: 'PowerSocket' });
    const entities = [pole, facility, cable], before = structuredClone(entities);
    const render = () => renderFoxholeSceneV2Entity(cable, { contractVersion: 1, entities }).experimentalSpatial!.nodes[0]!;
    const node = render(), start = assets.powerpole!.buildSockets.find(socket => socket.name.includes('PowerSocket'))!;
    const end = assets.facilitypowerdiesel!.buildSockets.find(socket => socket.name.includes('PowerSocket'))!;
    assert.equal(node.kind, 'tube');
    assert.equal(node.color, 0x191919, 'the two attached hosts do not invalidate their own cable');
    assert.equal(node.motion?.kind, 'spring-sway');
    assert.ok((node.motion?.amplitude ?? 0) >= 2 && (node.motion?.amplitude ?? 0) <= 12);
    assert.deepEqual(node.points.slice(0, 3), [start.x, start.y, start.z]);
    assert.deepEqual(node.points.slice(-3), [500 + end.x, 160 + end.y, end.z]);
    assert.deepEqual(node.endpointBindings, {
        start: { entityId: pole.entityId, point: [start.x, start.y, start.z] },
        end: { entityId: facility.entityId, point: [end.x, end.y, end.z] },
    });
    assert.ok(node.points[50]! < (start.z! + end.z!) / 2, 'the midpoint sags below the endpoint interpolation');
    assert.deepEqual(entities, before, 'the render plan never persists derived or physics state');
    facility.components.find(component => component.componentId === 'transform')!.data.x = 700;
    assert.equal(render().points.at(-3), 700 + end.x);
    facility.components.find(component => component.componentId === 'transform')!.data.x = 500;
    const obstacle = product('facilitypowerdiesel', (start.x + 500 + end.x) / 2, (start.y + 160 + end.y) / 2);
    obstacle.entityId = 'obstacle';
    entities.push(obstacle);
    const blocked = render();
    assert.equal(blocked.kind, 'tube');
    assert.equal(blocked.kind === 'tube' && blocked.color, FOXHOLE_POWERLINE_INVALID_COLOR,
        'an unrelated authored footprint invalidates the 3D cable');
    const planar = renderFoxholeSceneV2Entity(cable, { contractVersion: 1, entities }).root.children
        .find(candidate => candidate.kind === 'graphics');
    assert.ok(planar?.kind === 'graphics');
    assert.equal(planar.commands.find(command => command.op === 'stroke')?.color, FOXHOLE_POWERLINE_INVALID_COLOR);
});

test('spatial socket projection handles parent elevation, tilt, and connector scale without changing 2D state', () => {
    const pole = product('powerpole'), cable = product('powerline');
    const parent: Entity = { entityId: 'parent', revision: 1, components: [
        { ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1, definitionAvailable: true, data: { elevation: 100, rotationX: Math.PI / 2, scaleZ: 2 } },
    ] };
    pole.components.push({ ownerId: 'nixie.core', componentId: 'hierarchy', version: 1, definitionAvailable: true, data: { parentId: 'parent' } });
    cable.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1, definitionAvailable: true, data: { elevation: 20, scaleZ: 2 } });
    const spline = { ...cable.components.find(component => component.componentId === 'spline-connector')!.data,
        startAttachmentNodeId: pole.entityId, startAttachmentSocketName: 'PowerSocket' } as unknown as FoxholeSceneV2SplineConnectorData;
    const resolved = resolveFoxholeSpatialSplineAttachments(cable, spline, { contractVersion: 1, entities: [parent, pole, cable] }, assets);
    const socket = assets.powerpole!.buildSockets.find(socket => socket.name.includes('PowerSocket'))!;
    assert.ok(Math.abs(resolved.startY - socket.z! * 2) < 1e-8);
    assert.ok(Math.abs(resolved.startZ - (100 - socket.y - 20) / 2) < 1e-8);
});

for (const id of ['engineroomt2', 'engineroomt3']) {
    test(id + ' renders the cable endpoint at the selected wall connector height', () => {
        const engine = product(id, 300, -100), cable = product('powerline');
        engine.components.find(c => c.componentId === 'modification')!.data.selections = [
            { slotId: 'RightModSlot', variantId: 'powerconnection' }];
        const spline = cable.components.find(c => c.componentId === 'spline-connector')!.data;
        Object.assign(spline, { endAttachmentNodeId: engine.entityId, endAttachmentSocketName: 'PowerSocket' });
        const entities = [engine, cable], before = structuredClone(entities);
        const node = renderFoxholeSceneV2Entity(cable, { contractVersion: 1, entities }).experimentalSpatial!.nodes[0]!;
        assert.equal(node.kind, 'tube');
        if (node.kind !== 'tube') return;
        const expected = [-147.27136 * .32, 299.42903 * .32, 62.74524 * .32];
        node.points.slice(-3).forEach((value, i) => assert.ok(Math.abs(value - (expected[i]! + [300,-100,0][i]!)) < .002));
        assert.equal(node.endpointBindings?.end?.entityId, engine.entityId);
        assert.deepEqual(entities, before);
    });
}
