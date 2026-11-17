import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionManifestV1, parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk';
import type { NixieComponentEntitySnapshotV1, NixieTransformFinalizeRequestV1 } from '@nixiejs/extension-sdk/scene-v2';
import { nearestPointOnSegment, matchesNixieTransformFinalizerV1, parseNixieSimulationPathV1, parseNixieTransformFinalizerV1 } from '@nixiejs/extension-sdk/scene-v2';
import manifest from '../nixie.extension.json' with { type: 'json' };
import { finalizeFoxholeRailVehicleSnap, railCouplers } from '../src/rail-vehicle-snapping.ts';
import { foxholeRailVehicleBogies } from '../src/rail-vehicle-rigs.ts';
import { sampleFoxholeSceneV2Connector } from '../src/scene-v2-connector-path.ts';
import { createFoxholeSpatialProjection } from '../src/scene-v2-spatial-transforms.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';
import { fitFoxholeRailWheelbase } from '../src/rail-wheelbase.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import assets from '../src/scene-v2-assets-node.ts';

const ownerId = 'nixie.foxhole-planner';
const component = (componentId: string, data: NixieComponentEntitySnapshotV1['components'][number]['data'], owner = ownerId) =>
    ({ ownerId: owner, componentId, version: 1, definitionAvailable: true, data });

function track(foxholeKey: string, entityId = 'track', y = 0): NixieComponentEntitySnapshotV1 {
    return { entityId, revision: 1, components: [
        component('transform', { x: 0, y, rotation: 0 }, 'nixie.core'),
        component('spatial-transform', { elevation: 32 }, 'nixie.core'),
        component('spline-connector', {
            foxholeKey, startX: 0, startY: 0, startRotation: 0, endX: 400, endY: 0, endRotation: 0,
            minLength: 160, maxLength: 1600, minRadius: 160, maxRadius: 1200, maxBuffer: 0, curveT: 1, blueprint: false,
        }),
    ] };
}

function request(assetId: string, tracks: NixieComponentEntitySnapshotV1[]): NixieTransformFinalizeRequestV1 {
    return { contractVersion: 1, entityId: 'vehicle', interaction: 'placement',
        transform: { x: 173, y: 10, rotation: 3, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [
            { entityId: 'vehicle', revision: 1, components: [
                component('asset', { catalogId: 'foxhole.structures', assetId }),
                component('transform', { x: 400, y: 400, rotation: 0 }, 'nixie.core'),
            ] },
            ...tracks,
        ] },
    };
}

test('the live socket setting gates a track-spline finalizer for each rail vehicle', () => {
    parseNixieExtensionManifestV1(manifest);
    const railVehicles = Object.entries(assets).filter(([, asset]) => asset.category === 'trains');
    for (const id of [...railVehicles.map(([id]) => id), 'largecrane']) {
        const finalizer = manifest.contributes.transformFinalizers.map(parseNixieTransformFinalizerV1)
            .find(item => item.match.data?.assetId === id);
        assert.ok(finalizer, id);
        assert.equal(finalizer.enabledSettingId, 'foxhole.viewport.socketSnapping');
        assert.equal(finalizer.candidateQuery.match.componentId, 'spline-connector');
        assert.ok(matchesNixieTransformFinalizerV1(request(id, []).context.entities[0]!, finalizer));
    }
});

test('every Locomotives asset snaps only to its own gauge', () => {
    for (const [id, asset] of Object.entries(assets)) {
        if (asset.category !== 'trains') continue;
        const small = id.startsWith('smalltrain');
        const own = track(small ? 'smallrailtrackspline' : 'railtrackspline');
        const wrong = track(small ? 'railtrackspline' : 'smallrailtrackspline');
        assert.equal(finalizeFoxholeRailVehicleSnap(request(id, [own])).transform.elevation, 32 + (small ? 20 : 36) * 0.32, id);
        assert.equal(finalizeFoxholeRailVehicleSnap(request(id, [wrong])).transform.elevation, undefined, id);
    }
});

test('the large locomotive supplies a forward simulation path over a straight-to-curved rail joint', () => {
    const approach = track('railtrackspline', 'approach');
    const bend = track('railtrackspline', 'bend');
    Object.assign(approach.components[0]!.data, { x: -400 });
    Object.assign(bend.components.at(-1)!.data, { endX: 650, endY: 240, endRotation: 0.6,
        startAttachmentNodeId: 'approach', startAttachmentSocketName: 'FrontSocket' });
    const proposal = request('trainengine', [approach, bend]);
    Object.assign(proposal.transform, { x: -220, y: 0, rotation: 0 });
    const result = finalizeFoxholeRailVehicleSnap(proposal);
    const operation = result.transaction?.operations[0];
    if (operation?.op !== 'add') assert.fail('Expected a snapped rail attachment');
    const path = parseNixieSimulationPathV1(operation.data.simulationPath);
    assert.deepEqual(path.sources, ['approach', 'bend']);
    assert.ok(path.frames[0]!.position[0] < -200);
    assert.ok(path.frames.at(-1)!.position[1] > 50);
    const straddling = path.frames.find(frame => frame.position[0] > 20 && frame.position[0] < 80);
    assert.ok(straddling, 'the chassis crosses the joint while its rear wheel contact remains on the approach');
    const rear = straddling.modelNodeTransforms.find(node => node.nodeName === 'rail-bogie-rear')!;
    const [x, y] = straddling.position;
    const along = (-1.92332 + rear.translation[0] - 1.3397 * Math.cos(rear.rotation[1])) * 32;
    const lateral = (rear.translation[2] + 1.3397 * Math.sin(rear.rotation[1])) * 32;
    const contactX = x + Math.cos(straddling.heading) * along - Math.sin(straddling.heading) * lateral;
    const contactY = y + Math.sin(straddling.heading) * along + Math.cos(straddling.heading) * lateral;
    assert.ok(contactX < 0 && Math.abs(contactY) < 0.7, JSON.stringify({ contactX, contactY }));
    assert.ok(path.frames.some(frame => Math.abs(frame.modelNodeTransforms[0]!.rotation[1]) > 0.04));
});

test('Tempest playback keeps both bogies on separate rails while crossing the joint', () => {
    const approach = track('railtrackspline', 'approach');
    const bend = track('railtrackspline', 'bend');
    Object.assign(approach.components[0]!.data, { x: -900 });
    Object.assign(approach.components.at(-1)!.data, { endX: 900 });
    Object.assign(bend.components.at(-1)!.data, { endX: 980, endY: 260, endRotation: 0.58,
        startAttachmentNodeId: 'approach', startAttachmentSocketName: 'FrontSocket' });
    const proposal = request('trainlrartillery', [approach, bend]);
    Object.assign(proposal.transform, { x: -520, y: 0, rotation: 0 });
    const operation = finalizeFoxholeRailVehicleSnap(proposal).transaction?.operations[0];
    if (operation?.op !== 'add') assert.fail('Expected a snapped rail attachment');
    const path = parseNixieSimulationPathV1(operation.data.simulationPath);
    assert.deepEqual(path.sources, ['approach', 'bend']);
    const frame = path.frames.find(frame => frame.position[0] > 20 && frame.position[0] < 80);
    assert.ok(frame);
    const centerlines = [
        [{ x: -900, y: 0 }, { x: 0, y: 0 }],
        sampleFoxholeSceneV2Connector(bend.components.at(-1)!.data as unknown as FoxholeSceneV2SplineConnectorData,
            assets.railtrackspline).points,
    ];
    const railsUnderWheels = new Set<number>();
    for (const bogie of foxholeRailVehicleBogies.trainlrartillery!) {
        const pose = frame.modelNodeTransforms.find(node => node.nodeName === bogie.nodeName);
        assert.ok(pose);
        assert.ok(Math.abs(pose.rotation[1]) > 0.02);
        for (const axle of bogie.wheelOffsets) {
            const [x, y] = frame.position;
            const along = 32 * (bogie.pivot + pose.translation[0] + Math.cos(pose.rotation[1]) * axle);
            const lateral = 32 * (pose.translation[2] - Math.sin(pose.rotation[1]) * axle);
            const contact = { x: x + Math.cos(frame.heading) * along - Math.sin(frame.heading) * lateral,
                y: y + Math.sin(frame.heading) * along + Math.cos(frame.heading) * lateral };
            const distances = centerlines.map(points => Math.min(...points.slice(1)
                .map((end, i) => nearestPointOnSegment(contact, points[i]!, end).distance)));
            const closest = Math.min(...distances);
            assert.ok(closest < 0.7, `${bogie.nodeName} axle was ${closest} units off the rail`);
            railsUnderWheels.add(distances.indexOf(closest));
        }
    }
    assert.equal(railsUnderWheels.size, 2);
});

test('a Black Bolt added at the Tempest front coupler drives both vehicles through a curve', () => {
    const approach = track('railtrackspline', 'approach');
    const bend = track('railtrackspline', 'bend');
    Object.assign(approach.components[0]!.data, { x: -1300 });
    Object.assign(approach.components.at(-1)!.data, { endX: 1300 });
    Object.assign(bend.components.at(-1)!.data, { endX: 980, endY: 290, endRotation: .55,
        startAttachmentNodeId: 'approach', startAttachmentSocketName: 'FrontSocket' });
    const proposal = request('trainengine', [approach, bend]);
    const cannon = { entityId: 'cannon', revision: 1, components: [
        component('asset', { catalogId: 'foxhole.structures', assetId: 'trainlrartillery' }),
        component('transform', { x: -740, y: 0, rotation: 0 }, 'nixie.core'),
        component('rail-attachment', { rail: 'approach', station: 560, reversed: false }),
    ] };
    proposal.context.entities.push(cannon);
    Object.assign(proposal.transform, { x: -188, y: 0, rotation: 0 });
    proposal.geometryGesture = { handleId: 'product-placement-port', phase: 'preview', snappingEnabled: true,
        worldPoint: { x: -377, y: 0, z: 77.44 }, hoveredEntityIds: ['cannon'] };
    const result = finalizeFoxholeRailVehicleSnap(proposal);
    const [engine, trailer] = result.transaction?.operations ?? [];
    if (engine?.op !== 'add' || trailer?.op !== 'patch') assert.fail('Expected both coupled attachments');
    const enginePath = parseNixieSimulationPathV1(engine.data.simulationPath);
    const cannonPath = parseNixieSimulationPathV1(trailer.set?.simulationPath);
    assert.deepEqual(enginePath.drive, cannonPath.drive);
    assert.equal(enginePath.drive?.leader, 'vehicle');
    assert.ok(enginePath.drive?.manual && enginePath.drive.manual.startDistance > 0);
    assert.equal(enginePath.drive.manual.loop, false);
    assert.equal(enginePath.frames.length, cannonPath.frames.length);
    assert.ok(enginePath.frames.at(-1)!.position[1] > 40);
    const engineRear = railCouplers(assets.trainengine!, 'standard').find(port => port.name === 'RearCoupler')!.point;
    const cannonFront = railCouplers(assets.trainlrartillery!, 'standard').find(port => port.name === 'FrontCoupler')!.point;
    for (const [index, lead] of enginePath.frames.entries()) {
        const trailing = cannonPath.frames[index]!;
        assert.equal(lead.distance, trailing.distance);
        const dx = lead.position[0] + engineRear.x * Math.cos(lead.heading)
            - trailing.position[0] - cannonFront.x * Math.cos(trailing.heading);
        const dy = lead.position[1] + engineRear.x * Math.sin(lead.heading)
            - trailing.position[1] - cannonFront.x * Math.sin(trailing.heading);
        const gap = Math.hypot(dx, dy);
        const slack = lead.distance === enginePath.drive.manual.startDistance ? .11 : .3 * 32 + .02;
        assert.ok(Math.abs(gap - 16) < slack, `coupler gap at station ${lead.distance}: ${gap}`);
        assert.equal(trailing.modelOffsets?.length, cannonPath.modelNodes!.length * 6);
    }
});

test('coupler placement advances from the existing car along a curved rail', () => {
    const curved = track('railtrackspline');
    Object.assign(curved.components.at(-1)!.data, { endX: 450, endY: 300, endRotation: Math.PI / 2 });
    const proposal = request('trainflatbed', [curved, track('smallrailtrackspline', 'wrong')]);
    const height = 32 + 36 * 0.32;
    proposal.transform = { ...proposal.transform, x: 260, y: 0, rotation: 0 };
    proposal.geometryGesture = { phase: 'preview', handleId: 'product-placement-port', snappingEnabled: true,
        worldPoint: { x: 0, y: 0, z: height }, hoveredEntityIds: [] };
    const result = finalizeFoxholeRailVehicleSnap(proposal).transform;
    assert.equal(result.elevation, height);
    assert.ok(result.y > 10 && result.x < 260, JSON.stringify(result));
    assert.ok(result.rotation! > 0.1);
    proposal.transform.x = 2000;
    assert.equal(finalizeFoxholeRailVehicleSnap(proposal).transform.elevation, undefined);
});

test('the axle chord keeps both axle centers on a curve at the authored spacing', () => {
    const radius = 180, wheelbase = 163.2;
    const sample = (distance: number): [number, number, number] => [
        radius * Math.sin(distance / radius), radius * (1 - Math.cos(distance / radius)), 42,
    ];
    const pose = fitFoxholeRailWheelbase(wheelbase, sample);
    assert.ok(pose);
    assert.ok(pose.point[1] > 15, 'a tangent centered on the spline leaves both axles outside the curve');
    for (const direction of [-1, 1]) {
        const axleX = pose.point[0] + direction * wheelbase / 2 * Math.cos(pose.heading);
        const axleY = pose.point[1] + direction * wheelbase / 2 * Math.sin(pose.heading);
        assert.ok(Math.abs(Math.hypot(axleX, axleY - radius) - radius) < 0.1);
    }
});

test('large cranes snap to crane rails and locomotives ignore them', () => {
    const craneTrack = track('cranerailtrackspline');
    const pose = finalizeFoxholeRailVehicleSnap(request('largecrane', [track('railtrackspline', 'wrong', 10), craneTrack])).transform;
    assert.equal(pose.x, 173);
    assert.equal(pose.y, 0);
    // The crane's model is grounded at its wheels. The track mesh puts the
    // running surface 26.506 cm above the spline origin.
    const railHeight = 26.506 * 0.32;
    assert.ok(Math.abs(pose.elevation! - (32 + railHeight)) < 0.001);
    for (const id of ['trainengine', 'smalltrainengine']) {
        assert.deepEqual(finalizeFoxholeRailVehicleSnap(request(id, [craneTrack])).transform, { x: 173, y: 10 });
    }
    assert.deepEqual(finalizeFoxholeRailVehicleSnap(request('largecrane', [track('smallrailtrackspline')])).transform, { x: 173, y: 10 });
});

test('an attached large crane keeps its running height when the track is raised', () => {
    const craneTrack = track('cranerailtrackspline');
    const proposal = request('largecrane', [craneTrack]);
    const attachment = finalizeFoxholeRailVehicleSnap(proposal).transaction?.operations[0];
    if (attachment?.op !== 'add') assert.fail('Expected a crane rail attachment.');
    proposal.context.entities[0]!.components.push(component('rail-attachment', attachment.data));
    craneTrack.components.find(component => component.componentId === 'spatial-transform')!.data.elevation = 80;
    const pose = finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'transform', followedEntityId: craneTrack.entityId }).transform;
    assert.ok(Math.abs(pose.elevation! - (80 + 26.506 * 0.32)) < 0.001);
});

test('locomotives align with their gauge even when a closer track has the wrong gauge', () => {
    for (const [asset, matching, wrong] of [
        ['trainengine', 'railtracksplinefoundation', 'smallrailtrackspline'],
        ['smalltrainengine', 'smallrailtracksplinebiarc', 'railtracksplinetown'],
    ] as const) {
        const proposal = request(asset, [track(wrong, 'wrong', 10), track(matching)]);
        const pose = finalizeFoxholeRailVehicleSnap(proposal).transform;
        assert.ok(Math.abs(pose.x - 173) < 1e-8);
        assert.ok(Math.abs(pose.y) < 1e-8);
        assert.equal(pose.elevation, 32 + (asset === 'smalltrainengine' ? 20 : 36) * 0.32);
        assert.ok(Math.abs(pose.rotation! - Math.PI) < 1e-8);
        assert.deepEqual(finalizeFoxholeRailVehicleSnap(request(asset, [track(wrong)])).transform, { x: 173, y: 10 });
    }
});

test('translation can snap at the end of a track and never alters explicit transforms or group moves', () => {
    const proposal = request('trainengine', [track('railtrackspline')]);
    proposal.transform.x = 408;
    assert.equal(finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'planar-translation' }).transform.x, 400);
    const unchanged = { x: 408, y: 10 };
    assert.deepEqual(finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'transform' }).transform, unchanged);
    assert.deepEqual(finalizeFoxholeRailVehicleSnap({ ...proposal, movingEntityIds: ['vehicle', 'other'] }).transform, unchanged);
});

test('rails remain selectable and do not contribute a product placement menu', () => {
    for (const key of ['railtracksplinefoundation', 'smallrailtrackspline', 'cranerailtrackspline']) {
        const entity = track(key);
        const plan = renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity],
            settings: { 'nixie.scene.productPlacementPorts': true, 'nixie.scene.pathPlacement': true } });
        assert.ok(plan.spatial);
        assert.equal(plan.selectionGeometry?.pathPlacement, undefined);
        assert.equal(plan.selectionGeometry?.productPlacementPorts, undefined);
    }
});

test('vehicle couplers offer all and only the matching gauge with per-car docking poses', () => {
    const vehicles = Object.entries(assets).filter(([, asset]) => asset.category === 'trains');
    for (const [id] of vehicles) {
        const entity = request(id, []).context.entities[0]!;
        const base = { contractVersion: 1 as const, entities: [entity] };
        const enabled = { ...base, settings: { 'nixie.scene.productPlacementPorts': true } };
        assert.equal(renderFoxholeSceneV2Entity(entity, base).selectionGeometry?.productPlacementPorts, undefined);
        const ports = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity, enabled)).selectionGeometry?.productPlacementPorts;
        assert.equal(ports?.length, 2, id);
        const compatible = vehicles.filter(([other]) => other.startsWith('smalltrain') === id.startsWith('smalltrain'))
            .map(([other]) => `asset.${other}`).sort();
        for (const port of ports!) {
            assert.deepEqual(Object.keys(port.products).sort(), compatible, id);
            const nextCenter = port.products[`asset.${id}`]!;
            assert.equal(Math.sign(nextCenter.x), Math.sign(port.point.x), id);
            assert.ok(Math.abs(nextCenter.x) > Math.abs(port.point.x), id);
            assert.equal(nextCenter.z, 0);
        }
    }
});

test('a snapped vehicle follows its saved station and facing after the rail moves and rotates', () => {
    const rail = track('railtrackspline');
    const proposal = request('trainengine', [rail]);
    const snap = finalizeFoxholeRailVehicleSnap(proposal);
    const add = snap.transaction?.operations[0];
    assert.equal(add?.op, 'add');
    if (add?.op !== 'add') assert.fail();
    assert.equal(add.data.rail, rail.entityId);
    assert.ok(Math.abs(Number(add.data.station) - 173) < 1e-8);
    assert.equal(add.data.reversed, true);
    proposal.context.entities[0]!.components.push(component('rail-attachment', add.data));

    Object.assign(rail.components[0]!.data, { x: 500, y: 600, rotation: Math.PI / 2 });
    Object.assign(rail.components[1]!.data, { elevation: 70 });
    const follow = finalizeFoxholeRailVehicleSnap({ ...proposal, followedEntityId: rail.entityId, interaction: 'transform' });
    assert.ok(Math.abs(follow.transform.x - 500) < 1e-8);
    assert.ok(Math.abs(follow.transform.y - 773) < 1e-8);
    assert.ok(Math.abs(follow.transform.rotation! - 3 * Math.PI / 2) < 1e-8);
    assert.equal(follow.transform.elevation, 70 + 36 * 0.32);
    assert.equal(follow.transaction, undefined);

    const detach = finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'planar-translation',
        transform: { ...proposal.transform, x: -400, y: -400 } });
    assert.equal(detach.transaction?.operations[0]?.op, 'remove');
});

test('a shortened rail clamps the vehicle to the end and a reshaped rail changes its pose', () => {
    const rail = track('railtrackspline');
    const proposal = request('trainflatbed', [rail]);
    const snap = finalizeFoxholeRailVehicleSnap(proposal);
    const add = snap.transaction?.operations[0];
    if (add?.op !== 'add') assert.fail();
    proposal.context.entities[0]!.components.push(component('rail-attachment', add.data));
    const follow = { ...proposal, followedEntityId: rail.entityId, interaction: 'transform' as const };
    Object.assign(rail.components.at(-1)!.data, { endX: 350, endY: 260, endRotation: Math.PI / 2 });
    const curved = finalizeFoxholeRailVehicleSnap(follow);
    assert.ok(curved.transform.y > 10);
    assert.notEqual(curved.transform.rotation, snap.transform.rotation);

    Object.assign(rail.components.at(-1)!.data, { endX: 150, endY: 0, endRotation: 0 });
    assert.ok(Math.abs(finalizeFoxholeRailVehicleSnap(follow).transform.x - 150) < 1e-8);
});

test('long rolling stock steers the two bogies independently through the spatial render plan', () => {
    for (const assetId of ['trainflatbed', 'trainhospital', 'trainlrartillery']) {
        const curved = track('railtrackspline');
        Object.assign(curved.components.at(-1)!.data, { endX: 1050, endY: 700, endRotation: Math.PI / 2 });
        const proposal = request(assetId, [curved]);
        const vehicle = proposal.context.entities[0]!;
        vehicle.components.push(component('rail-attachment', { rail: 'track', station: 650, reversed: false }));
        const { x, y, rotation, elevation } = finalizeFoxholeRailVehicleSnap({
            ...proposal, interaction: 'transform', followedEntityId: 'track',
        }).transform;
        Object.assign(vehicle.components[1]!.data, { x, y, rotation });
        vehicle.components.push(component('spatial-transform', { elevation: elevation! }, 'nixie.core'));
        assert.equal(renderFoxholeSceneV2Entity(vehicle, proposal.context).spatial?.modelNodeTransforms, undefined);
        const context = { ...proposal.context, settings: { 'nixie.scene.modelNodeTransforms': true } };
        const poses = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(vehicle, context)).spatial?.modelNodeTransforms;
        assert.equal(poses?.length, 2, assetId);
        assert.deepEqual(poses?.map(pose => pose.nodeName), ['rail-bogie-front', 'rail-bogie-rear'], assetId);
        assert.ok(poses![0]!.rotation[1] * poses![1]!.rotation[1] < 0, JSON.stringify({ assetId, poses }));

        Object.assign(curved.components.at(-1)!.data, { endX: 1300, endY: 0, endRotation: 0 });
        const straight = finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'transform', followedEntityId: 'track' });
        Object.assign(vehicle.components[1]!.data, straight.transform);
        const straightPoses = renderFoxholeSceneV2Entity(vehicle, context).spatial?.modelNodeTransforms;
        assert.ok(straightPoses?.every(pose => Math.abs(pose.rotation[1]) < 1e-6), assetId);
    }
});

test('long cars keep both bogie poses when a secondary rail is reshaped', () => {
    for (const assetId of ['trainhospital', 'trainlrartillery']) {
        const approach = track('railtrackspline', 'approach');
        Object.assign(approach.components[0]!.data, { x: -900 });
        Object.assign(approach.components.at(-1)!.data, { endX: 900, maxLength: 2500 });
        const continuation = track('railtrackspline', 'continuation');
        Object.assign(continuation.components.at(-1)!.data, {
            endX: 900, endY: 340, endRotation: 0.55, maxLength: 2500,
            startAttachmentNodeId: 'approach', startAttachmentSocketName: 'FrontSocket',
        });
        const unrelated = track('railtrackspline', 'straighter');
        const proposal = request(assetId, [approach, continuation, unrelated]);
        Object.assign(proposal.transform, { x: -110, y: 0, rotation: 0 });
        const snap = finalizeFoxholeRailVehicleSnap(proposal);
        const attachment = snap.transaction?.operations[0];
        if (attachment?.op !== 'add') assert.fail('Expected a multi-rail attachment');
        assert.deepEqual(attachment.data.route, ['continuation'], assetId);
        const vehicle = proposal.context.entities[0]!;
        vehicle.components.push(component('rail-attachment', attachment.data));
        vehicle.components.push(component('spatial-transform', { elevation: snap.transform.elevation! }, 'nixie.core'));
        const context = { ...proposal.context, entities: [vehicle, approach, continuation],
            settings: { 'nixie.scene.modelNodeTransforms': true } };
        const resolve = () => {
            const followed = finalizeFoxholeRailVehicleSnap({ ...proposal, context, interaction: 'transform', followedEntityId: 'approach' });
            Object.assign(vehicle.components[1]!.data, followed.transform);
            const poses = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(vehicle, context)).spatial?.modelNodeTransforms;
            const projection = createFoxholeSpatialProjection(context.entities);
            const rails = [approach, continuation].map(entity => sampleFoxholeSceneV2Connector(
                entity.components.at(-1)!.data as unknown as FoxholeSceneV2SplineConnectorData, assets.railtrackspline,
            ).points.map(point => {
                const [x, y] = projection.toWorld(entity, [point.x, point.y, 0]);
                return { x, y };
            }));
            const supportingRails = new Set<number>();
            for (const bogie of foxholeRailVehicleBogies[assetId]!) {
                const pose = poses?.find(pose => pose.nodeName === bogie.nodeName);
                assert.ok(pose, bogie.nodeName);
                const [tx, , ty] = pose.translation, yaw = -pose.rotation[1];
                for (const axle of bogie.wheelOffsets) {
                    const [x, y] = projection.toWorld(vehicle,
                        [(bogie.pivot + tx + Math.cos(yaw) * axle) * 32, (ty + Math.sin(yaw) * axle) * 32, 0]);
                    const distances = rails.map(rail => Math.min(...rail.slice(1).map((end, index) =>
                        nearestPointOnSegment({ x, y }, rail[index]!, end).distance)));
                    const closest = Math.min(...distances);
                    assert.ok(closest < 0.7, `${assetId} ${bogie.nodeName} axle is ${closest} units from the centerline`);
                    supportingRails.add(distances.indexOf(closest));
                }
            }
            assert.equal(supportingRails.size, 2, assetId);
            return poses;
        };
        const before = resolve();
        assert.equal(before?.length, 2, assetId);
        Object.assign(continuation.components.at(-1)!.data, { endY: 520, endRotation: 0.92 });
        const after = resolve();
        assert.equal(after?.length, 2, assetId);
        assert.notDeepEqual(after, before, assetId);
    }
});
