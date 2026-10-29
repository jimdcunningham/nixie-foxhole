import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { createFoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import { renderFoxholeVehicleSeatOverlays } from '../src/scene-v2-vehicle-seat-overlays.ts';

test('2D seat overlays preserve compact source coordinates, labels and availability', () => {
    const source = { assets: [{ id: 'vehicle', isVehicle: true, sprite: { width: 128, height: 128 },
        vehicleSeats: [{ n: 'DriverSeat', t: 'Driver', x: 100, y: -50, r: 90 },
            { name: 'Gunner', seatType: 'Gunner', seatDirection: 'Forward', x: -20, y: 30, rotation: -45 },
            { n: 'OriginSeat' }, { n: 'Invalid', x: 'bad', y: 2 }] }] };
    const asset = createFoxholeSceneV2AssetMetadata(source).assets.vehicle!;
    assert.equal(asset.vehicleSeats?.length, 3);
    assert.deepEqual(asset.vehicleSeats?.[0], { name: 'DriverSeat', seatType: 'Driver', x: 32, y: -16, rotation: Math.PI / 2 });
    assert.deepEqual(asset.vehicleSeats?.[2], { name: 'OriginSeat', x: 0, y: 0, rotation: 0 });
    const appearance = { destroyed: false, packaged: false };
    assert.deepEqual(renderFoxholeVehicleSeatOverlays(asset, {}, appearance), []);
    assert.deepEqual(renderFoxholeVehicleSeatOverlays(asset, { 'foxhole.debug.structure.vehicleSeats': true }, { ...appearance, destroyed: true }), []);
    assert.deepEqual(renderFoxholeVehicleSeatOverlays(asset, { 'foxhole.debug.structure.vehicleSeats': true }, { ...appearance, packaged: true }), []);
    const group = renderFoxholeVehicleSeatOverlays(asset, { 'foxhole.debug.structure.vehicleSeats': true }, appearance)[0]!;
    assert.equal(group.kind, 'group');
    if (group.kind !== 'group') throw Error('expected group');
    assert.equal(group.experimentalPresentation?.excludeFromBounds, true);
    assert.equal(group.children.length, 3);
    const gunner = group.children[1]!;
    assert.equal(gunner.kind, 'group');
    if (gunner.kind !== 'group') throw Error('expected group');
    assert.equal(gunner.x, -6.4);
    assert.equal(gunner.y, 9.6);
    const label = gunner.children[1]!;
    assert.equal(label.kind, 'text');
    if (label.kind === 'text') assert.equal(label.text, 'Gunner (Forward)');
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: group }));
});


test('Tankette C source seats remain available in the V2 overlay', () => {
    // Coordinates from the FoxWatch compact vehicle-seat source manifest.
    const asset = createFoxholeSceneV2AssetMetadata({ assets: [{ id: 'tankettec', isVehicle: true,
        sprite: { width: 128, height: 128 }, vehicleSeats: [
            { n: 'DriverSeat0_GEN_VARIABLE', t: 'driver', d: 'None', x: -53.313, y: -44.85 },
            { n: 'GunnerSeat1_GEN_VARIABLE', t: 'gunner', d: 'Front', x: -11.627, y: 32.118 },
            { n: 'PassengerSeat2_GEN_VARIABLE', t: 'passenger', x: -163.102, y: -37.415 },
            { n: 'PassengerSeat3_GEN_VARIABLE', t: 'passenger', x: -159.979, y: 37.415 },
        ] }] }).assets.tankettec!;
    const group = renderFoxholeVehicleSeatOverlays(asset, { 'foxhole.debug.structure.vehicleSeats': true },
        { destroyed: false, packaged: false })[0];
    assert.equal(group?.kind, 'group');
    if (group?.kind !== 'group') throw Error('expected seat group');
    assert.equal(group.children.length, 4);
    assert.equal(group.children[0]!.x, -53.313 * 0.32);
    assert.equal(group.children[0]!.y, -44.85 * 0.32);
});
