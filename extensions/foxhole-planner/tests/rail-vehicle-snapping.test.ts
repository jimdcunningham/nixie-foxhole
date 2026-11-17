import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk';
import type { NixieComponentEntitySnapshotV1, NixieTransformFinalizeRequestV1 } from '@nixiejs/extension-sdk/scene-v2';
import { matchesNixieTransformFinalizerV1, parseNixieTransformFinalizerV1 } from '@nixiejs/extension-sdk/scene-v2';
import manifest from '../nixie.extension.json' with { type: 'json' };
import { finalizeFoxholeRailVehicleSnap } from '../src/rail-vehicle-snapping.ts';
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

test('large cranes snap to crane rails and locomotives ignore them', () => {
    const craneTrack = track('cranerailtrackspline');
    const pose = finalizeFoxholeRailVehicleSnap(request('largecrane', [track('railtrackspline', 'wrong', 10), craneTrack])).transform;
    assert.equal(pose.x, 173);
    assert.equal(pose.y, 0);
    assert.equal(pose.elevation, 32);
    for (const id of ['trainengine', 'smalltrainengine']) {
        assert.deepEqual(finalizeFoxholeRailVehicleSnap(request(id, [craneTrack])).transform, { x: 173, y: 10 });
    }
    assert.deepEqual(finalizeFoxholeRailVehicleSnap(request('largecrane', [track('smallrailtrackspline')])).transform, { x: 173, y: 10 });
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
