import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import { finalizeFoxholeSceneV2Transform } from '../src/scene-v2-transform-finalizer.ts';
import { isFoxholePowerSocketConnectionAvailable } from '../src/power-socket-capacity.ts';
import { withFoxholeSceneV2TransformProposal } from '../src/scene-v2-core-transforms.ts';
import { createFoxholeSpatialProjection } from '../src/scene-v2-spatial-transforms.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { resolveFoxholeSceneV2SplineAttachments } from '../src/scene-v2-attachments.ts';
import { resolveFoxholeSpatialSplineAttachments } from '../src/scene-v2-spatial-attachments.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';
import { FOXHOLE_HEIGHT_RENDER_LANES, FOXHOLE_RAIL_SWITCH_RENDER_LANE } from '../src/render-lanes.ts';

test('power capacity counts endpoint records rather than distinct connector IDs and allows an endpoint to retain its slot', () => {
    const connections = ['line-a', 'line-b'].flatMap(connectorNodeId => ['BackSocket', 'FrontSocket'].map(connectorSocketName => ({
        connectorNodeId, connectorSocketName, attachment: { nodeId: 'switch', socketName: 'PowerSocket' },
    })));
    const options = { targetNodeId: 'switch', targetSocketName: 'PowerSocket', maxConnections: 4, connections,
        movingConnectorNodeId: 'new-line', movingConnectorSocketName: 'BackSocket' };
    assert.equal(isFoxholePowerSocketConnectionAvailable(options), false);
    assert.equal(isFoxholePowerSocketConnectionAvailable({ ...options, movingConnectorNodeId: 'line-a' }), true);
});

function pipe(id: string, startX: number): NixieComponentEntitySnapshotV1 {
    const entity = structure(id, 0);
    entity.components.splice(1, 2, { ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1, definitionAvailable: true,
        data: { foxholeKey: 'facilitypipe', startX, startY: 0, startRotation: 0, endX: 300, endY: 0, endRotation: Math.PI,
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 48, maxLength: 1000, minRadius: 24, maxRadius: 24, maxBuffer: 0, curveT: 0, blueprint: false } });
    return entity;
}

test('a connector cannot create a new snap to another member of the moving group', () => {
    const moving = pipe('pipe', 95);
    const target = structure('target', 100);
    target.components[1]!.data.assetId = 'facilitypipe';
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        movingEntityIds: ['pipe', 'target'], interaction: 'placement',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, target] } });
    assert.equal(result.transaction?.operations.some(operation => operation.entityId === target.entityId) ?? false, false);
    assert.equal(result.transaction?.operations.some(operation => operation.op === 'patch' && operation.entityId === moving.entityId
        && operation.set?.startAttachmentNodeId === target.entityId) ?? false, false);
});

test('joining curved rail ends keeps the snapped headings in either drawing direction', () => {
    for (const reverse of [false, true]) {
        const lower = pipe('lower', 250), upper = pipe('upper', 750), join = pipe('join', 0);
        const foxholeKey = 'railtrackspline';
        Object.assign(lower.components[1]!.data, { foxholeKey, startY: 500, startRotation: -2.5,
            endX: 0, endY: 0, endRotation: -Math.PI / 2 });
        Object.assign(upper.components[1]!.data, { foxholeKey, startY: -600, endX: 1230, endY: -300, endRotation: Math.PI / 4 });
        const points = [{ x: 0, y: 0 }, { x: 750, y: -600 }];
        const [start, end] = reverse ? [points[1]!, points[0]!] : [points[0]!, points[1]!];
        const [startRail, endRail] = reverse ? [upper, lower] : [lower, upper];
        const joinData = join.components[1]!.data;
        Object.assign(joinData, { foxholeKey, startX: start.x, startY: start.y, endX: end.x, endY: end.y,
            endRotation: 0, curveT: 1, maxLength: 2048 });
        const context = { contractVersion: 1 as const, entities: [join, lower, upper] };
        const connect = (role: 'start' | 'end', point: typeof start, target: typeof join) => {
            const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: join.entityId, interaction: 'placement',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context,
                geometryGesture: { phase: 'commit', handleId: role, snappingEnabled: true, worldPoint: point, hoveredEntityIds: [target.entityId] } });
            const patch = result.transaction?.operations.find(operation => operation.entityId === join.entityId && operation.componentId === 'spline-connector');
            assert.ok(patch?.op === 'patch');
            Object.assign(joinData, patch.set);
            assert.equal(joinData[`${role}AttachmentNodeId`], target.entityId);
            const reciprocal = result.transaction?.operations.find(operation => operation.entityId === target.entityId && operation.componentId === 'socket-attachments');
            assert.ok(reciprocal?.op === 'add');
            target.components.push({ ownerId: 'nixie.foxhole-planner', componentId: reciprocal.componentId, version: 1,
                definitionAvailable: true, data: reciprocal.data });
        };
        connect('start', start, startRail);
        Object.assign(joinData, { endX: end.x, endY: end.y });
        connect('end', end, endRail);
        const spline = joinData as unknown as FoxholeSceneV2SplineConnectorData;
        const expectedEnd = reverse ? Math.PI / 2 : 0;
        for (const resolved of [resolveFoxholeSceneV2SplineAttachments(join, spline, context, assets),
            resolveFoxholeSpatialSplineAttachments(join, spline, context, assets)]) {
            assert.ok(Math.cos(resolved.endRotation - expectedEnd) > 0.999999);
        }
        for (const entity of context.entities) {
            assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity, context)));
        }
    }
});

test('a small rail endpoint joins the interior of a compatible rail in preview and commit', () => {
    const host = pipe('main-track', 0);
    const branch = pipe('branch', 200);
    const key = 'smallrailtracksplinefoundation';
    Object.assign(host.components[1]!.data, { foxholeKey: key, endX: 400, endRotation: 0 });
    Object.assign(branch.components[1]!.data, { foxholeKey: key, startY: 8, endX: 360, endY: 130 });
    const request = {
        contractVersion: 1 as const, entityId: branch.entityId, interaction: 'placement' as const,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1 as const, entities: [branch, host] },
    };
    const socketName = 'RailPath-5000-f';
    for (const phase of ['preview', 'commit'] as const) {
        const result = finalizeFoxholeSceneV2Transform({ ...request, geometryGesture: {
            phase, handleId: 'start', snappingEnabled: true, worldPoint: { x: 200, y: 8, z: 0 }, hoveredEntityIds: [host.entityId],
        } });
        const endpoint = result.transaction?.operations.find(operation => operation.entityId === branch.entityId);
        assert.ok(endpoint?.op === 'patch');
        assert.equal(endpoint.set?.startAttachmentNodeId, host.entityId);
        assert.equal(endpoint.set?.startAttachmentSocketName, socketName);
        const reciprocal = result.transaction?.operations.find(operation => operation.entityId === host.entityId);
        assert.ok(reciprocal?.op === 'patch' || reciprocal?.op === 'add');
        const occupancy = reciprocal.op === 'patch' ? reciprocal.set?.attachments : reciprocal.data.attachments;
        assert.deepEqual(occupancy, [{ localSocketName: socketName, targetEntityId: branch.entityId,
            targetSocketName: 'BackSocket' }]);
        if (phase === 'commit') {
            Object.assign(branch.components[1]!.data, endpoint.set);
            host.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1,
                definitionAvailable: true, data: { attachments: occupancy } });
        }
    }
    const plan = renderFoxholeSceneV2Entity(host, request.context);
    const sprite = plan.root.children.find(node => node.id === socketName);
    assert.ok(sprite?.kind === 'sprite');
    assert.equal(sprite.x, 200);
    assert.equal(sprite.y, 0);
    assert.equal(sprite.laneId, FOXHOLE_RAIL_SWITCH_RENDER_LANE.laneId);
    assert.ok(sprite.laneOrder! < FOXHOLE_HEIGHT_RENDER_LANES.rail.laneOrder);
    const branchPlan = renderFoxholeSceneV2Entity(branch, request.context);
    for (const trackPlan of [plan, branchPlan]) {
        const track = trackPlan.root.children.find(node => node.id === 'spline-connector-span');
        assert.ok(track?.laneOrder !== undefined && track.laneOrder > sprite.laneOrder!);
    }
    const switches = plan.spatial?.nodes.find(node => node.id === 'rail-switches');
    assert.ok(switches?.kind === 'model-path');
    assert.equal(switches.meshIndex, 0);
    assert.deepEqual(switches.instances, [{ distance: 200 }]);
    const detached = renderFoxholeSceneV2Entity(host);
    assert.ok(!detached.root.children.some(node => node.id === socketName));
    assert.ok(!detached.spatial?.nodes.some(node => node.id === 'rail-switches'));

    const occupancy = host.components.at(-1)!.data;
    occupancy.attachments = [];
    delete branch.components[1]!.data.startAttachmentNodeId;
    delete branch.components[1]!.data.startAttachmentSocketName;
    const otherBranch = pipe('other-branch', 192);
    Object.assign(otherBranch.components[1]!.data, { foxholeKey: key, endAttachmentNodeId: host.entityId,
        endAttachmentSocketName: 'RailPath-4800-b' });
    request.context.entities.push(otherBranch);
    const blocked = () => finalizeFoxholeSceneV2Transform({ ...request, geometryGesture: {
        phase: 'commit', handleId: 'start', snappingEnabled: true, worldPoint: { x: 200, y: 8, z: 0 }, hoveredEntityIds: [host.entityId],
    } }).transaction?.operations.find(operation => operation.entityId === host.entityId);
    host.components[1]!.data.foxholeKey = 'railtracksplinefoundation';
    assert.equal(blocked(), undefined, 'different gauge');
    host.components[1]!.data.foxholeKey = key;
    occupancy.attachments = [{ localSocketName: 'RailPath-4800-b', targetEntityId: otherBranch.entityId,
        targetSocketName: 'FrontSocket' }];
    assert.equal(blocked(), undefined, 'near an existing switch');
});

test('a rail branch tests height at the junction and binds its end facing into the host tangent', () => {
    const host = pipe('elevated-rail', 0);
    const branch = pipe('branch', 350);
    const key = 'railtracksplinefoundation';
    Object.assign(host.components[1]!.data, { foxholeKey: key, endX: 500, endRotation: 0 });
    Object.assign(branch.components[1]!.data, { foxholeKey: key, startY: 180, endX: 250, endY: 5, endRotation: 0 });
    host.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1,
        definitionAvailable: true, data: { elevation: 64 } });
    const finalize = (z: number) => finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: branch.entityId,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [host, branch] },
        geometryGesture: { phase: 'commit', handleId: 'end', snappingEnabled: true, worldPoint: { x: 250, y: 5, z },
            hoveredEntityIds: [host.entityId] },
    }).transaction?.operations;
    assert.ok(!finalize(46)?.some(operation => operation.entityId === host.entityId));
    const operations = finalize(64);
    const endpoint = operations?.find(operation => operation.entityId === branch.entityId);
    const reciprocal = operations?.find(operation => operation.entityId === host.entityId);
    assert.ok(endpoint?.op === 'patch' && reciprocal?.op === 'add');
    assert.equal(endpoint.set?.endAttachmentSocketName, 'RailPath-5000-f');
    assert.equal(Math.abs(Number(endpoint.set?.endRotation)), Math.PI);
    Object.assign(branch.components[1]!.data, endpoint.set);
    host.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1,
        definitionAvailable: true, data: reciprocal.data });
    const plan = renderFoxholeSceneV2Entity(branch, { contractVersion: 1, entities: [host, branch] });
    assert.ok(!plan.selectionGeometry?.geometryHandles?.some(handle => handle.id === 'end-rotation'));
    const span = plan.spatial?.nodes.find(node => node.id === 'rail-span');
    assert.ok(span?.kind === 'model-path');
    assert.deepEqual(span.points.slice(-3), [250, 0, 64]);
    assert.deepEqual(span.endpointBindings?.end, { entityId: host.entityId, point: [250, 0, 0] });
});

test('a rigid group preserves a connector endpoint and reciprocal attachment', () => {
    const moving = pipe('pipe', 100);
    const target = structure('target', 100);
    target.components[1]!.data.assetId = 'facilitypipe';
    Object.assign(moving.components[1]!.data, { startAttachmentNodeId: target.entityId, startAttachmentSocketName: 'BackSocket' });
    target.components[2]!.data.attachments = [{ localSocketName: 'BackSocket', targetEntityId: moving.entityId, targetSocketName: 'BackSocket' }];
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        movingEntityIds: ['pipe', 'target'], interaction: 'placement',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, target] } });
    assert.equal(result.transaction?.operations.some(operation => operation.entityId === target.entityId) ?? false, false);
    assert.equal(result.transaction?.operations.some(operation => operation.op === 'patch' && operation.entityId === moving.entityId
        && operation.unset?.includes('startAttachmentNodeId')) ?? false, false);
});

test('connector-primary group snaps by translating the group without reshaping the pipe', () => {
    const moving = pipe('pipe', 95), internal = structure('internal', 300), target = structure('target', 100);
    internal.components[1]!.data.assetId = target.components[1]!.data.assetId = 'facilitypipe';
    Object.assign(moving.components[1]!.data, { endAttachmentNodeId: 'internal', endAttachmentSocketName: 'BackSocket' });
    internal.components[2]!.data.attachments = [{ localSocketName: 'BackSocket', targetEntityId: 'pipe', targetSocketName: 'FrontSocket' }];
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'pipe', movingEntityIds: ['pipe', 'internal'],
        interaction: 'placement', transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [moving, internal, target] } });
    assert.deepEqual(result.transform, { x: 5, y: 0 });
    const pipePatch = result.transaction!.operations.find(operation => operation.entityId === 'pipe');
    assert.ok(pipePatch?.op === 'patch');
    assert.equal(pipePatch.set?.startAttachmentNodeId, 'target');
    assert.equal(pipePatch.set?.startX, undefined);
    assert.equal(pipePatch.set?.endX, undefined);
    assert.equal(pipePatch.unset?.includes('endAttachmentNodeId') ?? false, false);
    assert.equal(result.transaction!.operations.some(operation => operation.entityId === 'internal'), false);
    const reciprocal = result.transaction!.operations.find(operation => operation.entityId === 'target');
    assert.ok(reciprocal?.op === 'patch');
    assert.deepEqual(reciprocal.set?.attachments, [{ localSocketName: 'BackSocket', targetEntityId: 'pipe', targetSocketName: 'BackSocket' }]);
});

test('an internally occupied structure socket cannot attract the group to a stationary socket', () => {
    const moving = structure('moving', 0), linked = structure('linked', 160), stationary = structure('stationary', 165);
    moving.components[2]!.data.attachments = [{ localSocketName: 'FortCommon:FrontFortSocket',
        targetEntityId: linked.entityId, targetSocketName: 'FortCommon:BackFortSocket' }];
    linked.components[2]!.data.attachments = [{ localSocketName: 'FortCommon:BackFortSocket',
        targetEntityId: moving.entityId, targetSocketName: 'FortCommon:FrontFortSocket' }];
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moving.entityId,
        movingEntityIds: [moving.entityId, linked.entityId], interaction: 'placement',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [moving, linked, stationary] } });
    assert.deepEqual(result.transform, { x: 0, y: 0 });
    assert.equal(result.transaction?.operations.some(operation => operation.entityId === stationary.entityId) ?? false, false);
});

test('moving a curved pipe rotates the asset and writes occupancy without editing its handles', () => {
    const moving = pipe('pipe', 95);
    const target = structure('target', 100);
    target.components[1]!.data.assetId = 'facilitypipe';
    Object.assign(moving.components[1]!.data, { startRotation: Math.PI / 4, endY: 60, endRotation: 2.4 });
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'pipe', transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [moving, target] } });
    const geometry = result.transaction!.operations.find(operation => operation.entityId === 'pipe');
    assert.ok(geometry?.op === 'patch');
    assert.ok(Math.abs(result.transform.rotation! + Math.PI / 4) < 1e-8);
    assert.ok(Math.abs(result.transform.x + 95 * Math.cos(result.transform.rotation!) - 100) < 1e-8);
    assert.ok(Math.abs(result.transform.y + 95 * Math.sin(result.transform.rotation!)) < 1e-8);
    assert.deepEqual(geometry.set, { startAttachmentNodeId: 'target', startAttachmentSocketName: 'BackSocket' });
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

function structure(entityId: string, x: number): NixieComponentEntitySnapshotV1 {
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

test('moving an attached structure clears the original sockets before it can snap back', () => {
    const moving = structure('moving', 0);
    const target = structure('target', 160);
    const transform = { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
    const request = { contractVersion: 1 as const, interaction: 'planar-translation' as const,
        entityId: 'moving', transform, context: { contractVersion: 1 as const, entities: [moving, target],
            viewport: { renderScale: 1 }, settings: { 'nixie.scene.snapFeedback': true } } };
    const initial = finalizeFoxholeSceneV2Transform(request);
    for (const operation of initial.transaction!.operations) {
        assert.equal(operation.op, 'patch');
        const entity = operation.entityId === moving.entityId ? moving : target;
        entity.components[2]!.data.attachments = operation.set!.attachments;
    }
    const drag = (travel: number) => finalizeFoxholeSceneV2Transform({ ...request, context: { ...request.context,
        settings: { ...request.context.settings,
            'nixie.scene.socketBreakawayTravel': String(travel), 'nixie.scene.socketBreakawayRenderScale': '3' } } });

    const pullingAway = drag(5);
    assert.deepEqual(pullingAway.transform, { x: 5, y: 0 });
    assert.equal(pullingAway.snap, undefined);
    assert.equal(pullingAway.transaction?.operations.length, 2);
    for (const operation of pullingAway.transaction!.operations) {
        assert.equal(operation.op, 'patch');
        assert.deepEqual(operation.set?.attachments, []);
    }
    assert.equal(drag(53).snap, undefined);
    const returning = drag(55);
    assert.deepEqual(returning.transform, { x: 0, y: 0 });
    assert.ok(returning.snap);

    const other = structure('other', -160);
    request.context.entities.push(other);
    assert.equal(drag(5).snap, undefined, 'a different socket must not restore the original seam');

    other.components[0]!.data.x = -155;
    const newConnection = drag(5);
    assert.deepEqual(newConnection.transform, { x: 5, y: 0 });
    assert.ok(newConnection.snap);
    const movingUpdate = newConnection.transaction?.operations.find(operation => operation.entityId === moving.entityId);
    assert.equal(movingUpdate?.op, 'patch');
    assert.deepEqual((movingUpdate.set?.attachments as Array<{ targetEntityId: string }>).map(link => link.targetEntityId), ['other']);
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

test('foundation placement holds the acquired edge beyond the capture radius and reports both joined sockets', () => {
    const moving = structure('moving', 0), target = structure('target', 0);
    for (const entity of [moving, target]) entity.components[1]!.data.assetId = 'foundation012x2t3';
    const context = { contractVersion: 1 as const, entities: [moving, target], settings: { 'nixie.scene.snapFeedback': true } };
    const place = (x: number, previousSnapId?: string, snappingEnabled = true) => finalizeFoxholeSceneV2Transform({
        contractVersion: 1, entityId: moving.entityId, interaction: 'placement',
        transform: { x, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context, previousSnapId, snappingEnabled,
    }) as ReturnType<typeof finalizeFoxholeSceneV2Transform> & { snap?: { id: string; points: { x: number; y: number; z: number; }[]; }; };
    const acquired = place(336);
    assert.equal(acquired.transform.x, 320);
    assert.equal(acquired.snap?.points.length, 2);
    assert.ok(acquired.snap);
    assert.equal(place(345).transform.x, 345, 'the original capture radius still applies');
    assert.deepEqual(place(345, acquired.snap.id).snap, acquired.snap);
    assert.equal(place(345, acquired.snap.id).transform.x, 320);
    assert.equal(place(351, acquired.snap.id).snap, undefined);
    assert.equal(place(336, acquired.snap.id, false).snap, undefined);
    context.entities = [moving];
    assert.equal(place(336, acquired.snap.id).snap, undefined, 'a removed neighbor cannot be retained');
});

test('structure capture uses 12 screen pixels and caps world reach in placement and drag', () => {
    const moving = structure('moving', 0), target = structure('target', 0);
    for (const entity of [moving, target]) entity.components[1]!.data.assetId = 'foundation012x2t3';
    for (const interaction of ['placement', 'planar-translation'] as const) {
        const resolve = (offset: number, renderScale: number) => finalizeFoxholeSceneV2Transform({
            contractVersion: 1, entityId: moving.entityId, interaction,
            transform: { x: 320 + offset, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
            context: { contractVersion: 1, entities: [moving, target], viewport: { renderScale },
                settings: { 'nixie.scene.snapFeedback': true } },
        }).transform.x;
        assert.equal(resolve(11, 1), 320);
        assert.equal(resolve(13, 1), 333);
        assert.equal(resolve(30, 1 / 0.38), 320);
        assert.equal(resolve(33, 1 / 0.38), 353);
        assert.equal(resolve(59, 10), 320);
        assert.equal(resolve(61, 10), 381);
    }
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


test('a distant group member can meet a second socket after the winning snap rotates the selection', () => {
    const angle = .08, span = 1120;
    const anchor = structure('anchor', 163), distant = structure('distant', 163 - span * Math.sin(angle));
    const near = structure('near', 0), far = structure('far', 0);
    const entities = [anchor, distant, near, far];
    for (const entity of entities) entity.components[1]!.data.assetId = 'foundation01t1';
    Object.assign(anchor.components[0]!.data, { rotation: angle });
    Object.assign(distant.components[0]!.data, { rotation: angle, y: span * Math.cos(angle) });
    Object.assign(far.components[0]!.data, { y: span });
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: anchor.entityId,
        interaction: 'transform', movingEntityIds: [anchor.entityId, distant.entityId],
        transform: { x: 163, y: 0, rotation: angle, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities } });
    assert.ok(Math.abs(result.transform.x - 160) < 1e-6);
    assert.ok(Math.abs(result.transform.rotation!) < 1e-6);
    for (const [member, peer] of [[anchor, near], [distant, far]] as const) {
        const patch = result.transaction?.operations.find(operation => operation.entityId === member.entityId);
        assert.ok(patch?.op === 'patch');
        assert.deepEqual(patch.set?.attachments, [{ localSocketName: 'BackSocket', targetEntityId: peer.entityId, targetSocketName: 'FrontSocket' }]);
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


test('live power endpoint hover selects the building terminal away from the pointer', () => {
    const line = pipe('line', 0), building = structure('building', 500);
    Object.assign(line.components[1]!.data, { foxholeKey: 'powerline', endX: 500, endY: 100 });
    building.components[1]!.data.assetId = 'facilityrefinery1';
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: line.entityId,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        geometryGesture: { phase: 'preview', handleId: 'end', snappingEnabled: true, worldPoint: { x: 500, y: 100, z: 0 }, hoveredEntityIds: [building.entityId] },
        context: { contractVersion: 1, entities: [line, building] } });
    const patch = result.transaction?.operations.find(op => op.entityId === line.entityId);
    assert.ok(patch?.op === 'patch');
    assert.equal(patch.set?.endAttachmentNodeId, building.entityId);
    assert.equal(patch.set?.endAttachmentSocketName, 'PowerSocket');
    assert.ok(Math.abs(Number(patch.set?.endX) - 490.73504) < 1e-6);
    assert.ok(Math.abs(Number(patch.set?.endY) - 156.71904) < 1e-6);
    assert.equal(line.components[1]!.data.endAttachmentNodeId, undefined, 'preview input stays immutable');
});

test('live connector edit only changes the dragged endpoint and disabled snapping detaches it reciprocally', () => {
    const line = pipe('line', 0), old = structure('old', 300), tempting = structure('tempting', 0);
    old.components[1]!.data.assetId = tempting.components[1]!.data.assetId = 'facilitypipe';
    Object.assign(line.components[1]!.data, { endAttachmentNodeId: 'old', endAttachmentSocketName: 'BackSocket' });
    old.components[2]!.data.attachments = [{ localSocketName: 'BackSocket', targetEntityId: 'line', targetSocketName: 'FrontSocket' }];
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: line.entityId,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        geometryGesture: { phase: 'commit', handleId: 'end', snappingEnabled: false, worldPoint: { x: 300, y: 0 }, hoveredEntityIds: ['old'] },
        context: { contractVersion: 1, entities: [line, old, tempting] } });
    const patch = result.transaction?.operations.find(op => op.entityId === line.entityId);
    assert.ok(patch?.op === 'patch');
    assert.ok(patch.unset?.includes('endAttachmentNodeId'));
    assert.equal(patch.set?.startAttachmentNodeId, undefined, 'the untouched start must not snap to a nearby unrelated port');
    const reciprocal = result.transaction?.operations.find(op => op.entityId === old.entityId);
    assert.ok(reciprocal?.op === 'patch');
    assert.deepEqual(reciprocal.set?.attachments, []);
});

test('connector proximity snapping respects socket world elevation', () => {
    const line = pipe('line', 95), target = structure('target', 100);
    target.components[1]!.data.assetId = 'facilitypipe';
    target.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1, definitionAvailable: true, data: { elevation: 300 } });
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: line.entityId,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        geometryGesture: { phase: 'preview', handleId: 'start', snappingEnabled: true, worldPoint: { x: 95, y: 0, z: 0 }, hoveredEntityIds: [] },
        context: { contractVersion: 1, entities: [line, target] } });
    assert.ok(!result.transaction?.operations.some(op => op.op === 'patch' && op.set?.startAttachmentNodeId));
});


test('editing the receiving endpoint clears an inbound peer link without erasing side branches', () => {
    const moved = pipe('moved', 0), peer = pipe('peer', 0), branch = pipe('branch', 0);
    Object.assign(peer.components[1]!.data, { endAttachmentNodeId: moved.entityId, endAttachmentSocketName: 'BackSocket' });
    moved.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
        data: { attachments: [{ localSocketName: 'BackSocket', targetEntityId: peer.entityId, targetSocketName: 'FrontSocket' },
            { localSocketName: 'LeftSocket', targetEntityId: branch.entityId, targetSocketName: 'FrontSocket' }] } });
    Object.assign(branch.components[1]!.data, { endAttachmentNodeId: moved.entityId, endAttachmentSocketName: 'LeftSocket' });
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: moved.entityId,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        geometryGesture: { phase: 'commit', handleId: 'start', snappingEnabled: false, worldPoint: { x: -100, y: -100 }, hoveredEntityIds: [] },
        context: { contractVersion: 1, entities: [moved, peer, branch] } });
    const peerPatch = result.transaction?.operations.find(op => op.entityId === peer.entityId && op.componentId === 'spline-connector');
    assert.ok(peerPatch?.op === 'patch');
    assert.ok(peerPatch.unset?.includes('endAttachmentNodeId'));
    assert.ok(!result.transaction?.operations.some(op => op.entityId === peer.entityId && op.op === 'patch' && (op.set?.startX !== undefined || op.set?.endX !== undefined)), 'detachment must leave the peer geometry in place');
    const occupancy = result.transaction?.operations.find(op => op.entityId === moved.entityId && op.componentId === 'socket-attachments');
    assert.ok(occupancy?.op === 'patch');
    assert.deepEqual(occupancy.set?.attachments, [{ localSocketName: 'LeftSocket', targetEntityId: branch.entityId, targetSocketName: 'FrontSocket' }]);
});


test('pipe, underground pipe, and rail endpoint previews use the same portable gesture path', () => {
    for (const foxholeKey of ['facilitypipe', 'facilitypipeunderground', 'railtrackspline', 'smallrailtrackspline']) {
        const moving = pipe('moving', -300), target = pipe('target', 0);
        Object.assign(moving.components[1]!.data, { foxholeKey, endX: 298 });
        target.components[1]!.data.foxholeKey = foxholeKey;
        target.components[0]!.data.x = 300;
        const request = { contractVersion: 1 as const, entityId: moving.entityId,
            transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
            geometryGesture: { phase: 'preview' as const, handleId: 'end', snappingEnabled: true, worldPoint: { x: 299, y: 0 }, hoveredEntityIds: [] },
            context: { contractVersion: 1 as const, entities: [moving, target] } };
        const result = finalizeFoxholeSceneV2Transform(request);
        const patch = result.transaction?.operations.find(op => op.entityId === moving.entityId && op.componentId === 'spline-connector');
        assert.ok(patch?.op === 'patch', foxholeKey);
        assert.equal(patch.set?.endAttachmentNodeId, target.entityId, foxholeKey);
        assert.equal(patch.set?.endX, 300, foxholeKey);
        assert.equal(patch.set?.startX, undefined, foxholeKey);
        assert.deepEqual(result.transform, { x: 0, y: 0 }, foxholeKey);
        const committed = finalizeFoxholeSceneV2Transform({ ...request, geometryGesture: { ...request.geometryGesture, phase: 'commit' } });
        assert.deepEqual(committed.transaction?.operations, result.transaction?.operations, foxholeKey);
    }
});


test('SDK exchange detaches retired sockets without moving either authored endpoint', () => {
    const target = structure('target', 0);
    target.components[1]!.data.assetId = 'trencht1';
    target.components[2]!.data.attachments = [{ localSocketName: 'PowerSocket', targetEntityId: 'line', targetSocketName: 'BackSocket' }];
    const line = pipe('line', 38.4);
    Object.assign(line.components[1]!.data, { foxholeKey: 'powerline', startAttachmentNodeId: 'target', startAttachmentSocketName: 'PowerSocket' });
    const before = structuredClone([target, line]);
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'target', interaction: 'exchange',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [target, line] } });
    assert.deepEqual(result.transform, { x: 0, y: 0 });
    const detached = result.transaction!.operations.find(operation => operation.entityId === 'line');
    assert.ok(detached?.op === 'patch');
    assert.deepEqual(detached.unset, ['startAttachmentNodeId', 'startAttachmentSocketName']);
    assert.equal(detached.set, undefined);
    const reciprocal = result.transaction!.operations.find(operation => operation.entityId === 'target');
    assert.ok(reciprocal?.op === 'patch');
    assert.deepEqual(reciprocal.set, { attachments: [] });
    assert.deepEqual([target, line], before);
});


test('SDK exchange retains unresolved peer relationships until its socket metadata is available', () => {
    const target = structure('target', 0);
    target.components[1]!.data.assetId = 'powerbox';
    target.components[2]!.data.attachments = [{ localSocketName: 'PowerSocket', targetEntityId: 'line', targetSocketName: 'BackSocket' }];
    const line = pipe('line', 38.4);
    Object.assign(line.components[1]!.data, { foxholeKey: 'unavailable-line', startAttachmentNodeId: 'target', startAttachmentSocketName: 'PowerSocket' });
    const before = structuredClone([target, line]);
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: 'target', interaction: 'exchange',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [target, line] } });
    assert.equal(result.transaction?.operations.some(operation => operation.op === 'patch' && operation.entityId === 'target'
        && Array.isArray(operation.set?.attachments) && operation.set.attachments.length === 0) ?? false, false);
    assert.deepEqual([target, line], before);
});

test('straight connector endpoint previews and commits lock to a real socket axis', () => {
    for (const key of ['facilitycatwalkbridge', 'fieldbridge', 'fieldpier', 'facilitypipeoverhead']) {
        const line = pipe('line', 0);
        const anchor = key === 'facilitycatwalkbridge' ? structure('anchor', -36.8) : pipe('anchor', -300);
        const anchorSocket = 'FrontSocket';
        if (key === 'facilitycatwalkbridge') {
            anchor.components[1]!.data.assetId = 'facilitycatwalkplatform';
        } else {
            Object.assign(anchor.components[1]!.data, { foxholeKey: key, endX: 0, startRotation: 0, endRotation: 0 });
        }
        Object.assign(line.components[1]!.data, { foxholeKey: key, startAttachmentNodeId: 'anchor', startAttachmentSocketName: anchorSocket });
        const run = (phase: 'preview' | 'commit', x: number, y: number, extra: NixieComponentEntitySnapshotV1[] = []) => {
            const result = finalizeFoxholeSceneV2Transform({
                contractVersion: 1, entityId: line.entityId,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                context: { contractVersion: 1, entities: [line, anchor, ...extra] },
                geometryGesture: { phase, handleId: 'end', snappingEnabled: true, worldPoint: { x, y }, hoveredEntityIds: [] },
            });
            const patch = result.transaction?.operations.find(op => op.entityId === line.entityId && op.op === 'patch' && op.componentId === 'spline-connector');
            return patch?.op === 'patch' ? patch.set : undefined;
        };
        for (const phase of ['preview', 'commit'] as const) {
            assert.equal(run(phase, 420, 100)?.endX, 420, key);
            assert.equal(run(phase, 420, 100)?.endY ?? 0, 0, key);
            assert.equal(run(phase, -10, 40)?.endX, 48, key);
        }
        if (key === 'facilitycatwalkbridge') {
            const target = structure('target', 456.8);
            target.components[1]!.data.assetId = 'facilitycatwalkplatform';
            assert.equal(run('preview', 417, 3, [target])?.endAttachmentNodeId, 'target');
            assert.ok(Math.abs(Number(run('commit', 417, 3, [target])?.endX) - 420) < 1e-6);
            target.components[0]!.data.y = 40;
            assert.equal(run('commit', 420, 40, [target])?.endAttachmentNodeId, undefined);
        }
    }
});

test('moving a straight catwalk snaps the whole span without skewing its ends', () => {
    const line = pipe('line', 0);
    const target = structure('platform', -36.8);
    target.components[1]!.data.assetId = 'facilitycatwalkplatform';
    Object.assign(line.components[1]!.data, { foxholeKey: 'facilitycatwalkbridge' });
    const result = finalizeFoxholeSceneV2Transform({
        contractVersion: 1, entityId: line.entityId,
        transform: { x: 4, y: 7, rotation: 0, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [line, target] },
    });
    assert.ok(Math.abs(result.transform.x) < 1e-6);
    assert.equal(result.transform.y, 0);
    const patch = result.transaction?.operations.find(op => op.entityId === line.entityId && op.op === 'patch');
    assert.ok(patch?.op === 'patch');
    assert.equal(patch.set?.startAttachmentNodeId, 'platform');
    assert.equal(patch.set?.startY, undefined);
    assert.equal(patch.set?.endY, undefined);
});


test('placing the first pipe endpoint points the draft straight out of the snapped socket', () => {
    const moving = pipe('pipe', 0);
    const target = structure('target', 100);
    target.components[1]!.data.assetId = 'facilitypipe';
    target.components[0]!.data.rotation = Math.PI / 2;
    const result = finalizeFoxholeSceneV2Transform({
        contractVersion: 1, entityId: moving.entityId, interaction: 'placement',
        transform: { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        geometryGesture: { phase: 'preview', handleId: 'start', snappingEnabled: true, worldPoint: { x: 100, y: 0 }, hoveredEntityIds: [] },
        context: { contractVersion: 1, entities: [moving, target] },
    });
    const patch = result.transaction?.operations.find(op => op.entityId === moving.entityId && op.op === 'patch');
    assert.ok(patch?.op === 'patch');
    const geometry = { ...moving.components[1]!.data, ...patch.set };
    assert.equal(geometry.startAttachmentNodeId, 'target');
    assert.ok(Math.abs(Number(geometry.startRotation) - Math.PI / 2) < 1e-8);
    assert.ok(Math.abs(Number(geometry.endX) - Number(geometry.startX)) < 1e-8);
    assert.ok(Math.abs(Number(geometry.endY) - Number(geometry.startY) - 48) < 1e-8);
});

test('first power-line snap points the 3-metre preview out of the selected socket', () => {
    const line = pipe('line', 0), building = structure('building', 500);
    Object.assign(line.components[1]!.data, { foxholeKey: 'powerline', minLength: 3.2, endX: 32, endY: 0 });
    building.components[1]!.data.assetId = 'facilityrefinery1';
    const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: line.entityId,
        interaction: 'placement', transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        geometryGesture: { phase: 'preview', handleId: 'start', snappingEnabled: true,
            worldPoint: { x: 500, y: 100 }, hoveredEntityIds: [building.entityId],
            connectionTarget: { entityId: building.entityId, portId: 'powersocket' } },
        context: { contractVersion: 1, entities: [line, building] } });
    const patch = result.transaction?.operations.find(op => op.entityId === line.entityId);
    assert.ok(patch?.op === 'patch');
    const { startX, startY, startRotation, endX, endY } = { ...line.components[1]!.data, ...patch.set };
    assert.equal(patch.set?.startAttachmentSocketName, 'PowerSocket');
    assert.ok(Math.abs(Number(endX) - Number(startX) - 96 * Math.cos(Number(startRotation))) < 1e-6);
    assert.ok(Math.abs(Number(endY) - Number(startY) - 96 * Math.sin(Number(startRotation))) < 1e-6);
    assert.equal(patch.set?.minLength, undefined);
});

test('moving the pointer over the same power socket host preserves both spatial preview endpoints', () => {
    const line = pipe('line', 0), building = structure('building', 500);
    Object.assign(line.components[1]!.data, { foxholeKey: 'powerline', minLength: 3.2, endX: 32 });
    building.components[1]!.data.assetId = 'facilityrefinery1';
    function preview(x: number, y: number, z?: number) {
        const transform = { x, y, rotation: 0, scaleX: 1, scaleY: 1 };
        const draft = withFoxholeSceneV2TransformProposal(line, transform, z);
        const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: line.entityId,
            interaction: 'placement', transform,
            geometryGesture: { phase: 'preview', handleId: 'start', snappingEnabled: true, worldPoint: { x, y, z },
                hoveredEntityIds: [building.entityId] },
            context: { contractVersion: 1, entities: [draft, building] } });
        const patch = result.transaction?.operations.find(op => op.entityId === line.entityId && op.op === 'patch');
        assert.ok(patch?.op === 'patch');
        assert.equal(patch.set?.startAttachmentSocketName, 'PowerSocket');
        const placed = withFoxholeSceneV2TransformProposal(draft, result.transform, result.transform.elevation);
        const geometry = { ...draft.components[1]!.data, ...patch.set };
        const projection = createFoxholeSpatialProjection([placed, building]);
        return projection.toWorld(placed, [Number(geometry.endX), Number(geometry.endY), 0]);
    }
    const first = preview(500, 100, 20);
    const second = preview(515, 120, 70);
    assert.ok(first.every((value, axis) => Math.abs(value - second[axis]!) < 1e-6), `${first} moved to ${second}`);
    const withoutSurfaceHeight = preview(515, 120);
    assert.ok(first.every((value, axis) => Math.abs(value - withoutSurfaceHeight[axis]!) < 1e-6),
        `missing surface height moved the free end from ${first} to ${withoutSurfaceHeight}`);
});
