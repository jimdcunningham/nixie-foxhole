import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFakeNixieExtensionHost } from '@nixiejs/extension-sdk/testing';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity, NixieExperimentalTransformFinalizeRequestV1 as Request } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { createFoxholeSpatialProjection } from '../src/scene-v2-spatial-transforms.ts';
import { resolveFoxholeSceneV2WorldMatrices } from '../src/scene-v2-attachments.ts';
import { finalizeFoxholeSceneV2Transform } from '../src/scene-v2-transform-finalizer.ts';
import { finalizeFoxholeSurfacePlacement } from '../src/surface-placement.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { readFoxholeSceneV2CoreTransform, withFoxholeSceneV2TransformProposal } from '../src/scene-v2-core-transforms.ts';
import assets from '../src/scene-v2-assets-node.ts';
import { resolveFoxholeSpatialSplineAttachments } from '../src/scene-v2-spatial-attachments.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

const owner = 'nixie.foxhole-planner';
function entity(entityId: string, assetId = 'artilleryait1', x = 0): Entity {
    return { entityId, revision: 3, components: [
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true, data: { x, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } },
        { ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1, definitionAvailable: true, data: { elevation: 0, rotationX: 0, rotationY: 0, scaleZ: 1 } },
        { ownerId: owner, componentId: 'asset', version: 1, definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId } },
        { ownerId: owner, componentId: 'socket-attachments', version: 1, definitionAvailable: true, data: { attachments: [] } },
    ] };
}
function canonical(source: Entity): Entity {
    const copy = structuredClone(source);
    const planar = copy.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'transform')!.data;
    const spatial = copy.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'spatial-transform')?.data;
    copy.components = copy.components.filter(component => component.ownerId !== 'nixie.core' || component.componentId !== 'spatial-transform')
        .map(component => component.ownerId === 'nixie.core' && component.componentId === 'transform'
            ? { ...component, version: 2, data: { position: { x: Number(planar.x), y: Number(planar.y), z: Number(spatial?.elevation ?? 0) },
                rotation: { x: Number(spatial?.rotationX ?? 0), y: Number(spatial?.rotationY ?? 0), z: Number(planar.rotation) },
                scale: { x: Number(planar.scaleX), y: Number(planar.scaleY), z: Number(spatial?.scaleZ ?? 1) } } } : component);
    return copy;
}
const transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

test('canonical socket frames match existing XYZ and flat projections beneath tilted mirrored nonuniform parents', () => {
    const parent = entity('parent', '', 50), child = entity('child', 'powerpole', 10);
    Object.assign(parent.components[0]!.data, { y: -20, rotation: 0.4, scaleX: -2, scaleY: 3 });
    Object.assign(parent.components[1]!.data, { elevation: 100, rotationX: 0.2, rotationY: -0.3, scaleZ: 4 });
    Object.assign(child.components[0]!.data, { y: 30, rotation: -0.6, scaleX: 1.5, scaleY: -2 });
    Object.assign(child.components[1]!.data, { elevation: 40, rotationX: -0.1, rotationY: 0.5, scaleZ: 2 });
    child.components.push({ ownerId: 'nixie.core', componentId: 'hierarchy', version: 1, definitionAvailable: true, data: { parentId: 'parent', order: 0 } });
    const old = [parent, child], native = old.map(canonical), before = structuredClone(native);
    const expected = createFoxholeSpatialProjection(old), actual = createFoxholeSpatialProjection(native);
    for (const point of [[0,0,0], [10,20,30], [-40,3,12]] as [number,number,number][]) {
        assert.deepEqual(actual.toWorld(native[1]!, point), expected.toWorld(child, point));
        const roundTrip = actual.toLocal(native[1]!, actual.toWorld(native[1]!, point));
        roundTrip.forEach((value, axis) => assert.ok(Math.abs(value - point[axis]!) < 1e-9));
    }
    assert.deepEqual(resolveFoxholeSceneV2WorldMatrices({ contractVersion: 1, entities: native }),
        resolveFoxholeSceneV2WorldMatrices({ contractVersion: 1, entities: old }));
    assert.deepEqual(native, before);
});

function pipe(): Entity {
    const value = entity('pipe', 'facilitypipe');
    value.components = value.components.filter(component => component.componentId !== 'asset');
    value.components.push({ ownerId: owner, componentId: 'spline-connector', version: 1, definitionAvailable: true,
        data: { foxholeKey: 'facilitypipe', startX: 95, startY: 0, startRotation: 0, endX: 300, endY: 0, endRotation: Math.PI,
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 48, maxLength: 1000,
            minRadius: 24, maxRadius: 24, maxBuffer: 0, curveT: 0, blueprint: false } });
    return value;
}

for (const group of [false, true]) {
    test(`canonical ${group ? 'rigid group' : 'endpoint'} socket finalization matches existing public RPC geometry`, async context => {
        const moving = pipe(), target = entity('target', 'facilitypipe', 100), internal = entity('internal', 'facilitypipe', 300);
        if (group) {
            Object.assign(moving.components.find(component => component.componentId === 'spline-connector')!.data,
                { endAttachmentNodeId: 'internal', endAttachmentSocketName: 'BackSocket' });
            internal.components.find(component => component.componentId === 'socket-attachments')!.data.attachments = [
                { localSocketName: 'BackSocket', targetEntityId: 'pipe', targetSocketName: 'FrontSocket' }];
        }
        const old = [moving, target, ...(group ? [internal] : [])], native = old.map(canonical), before = structuredClone(native);
        const host = createFakeNixieExtensionHost({ extensionId: owner });
        const connection = await host.connect({ sceneV2: { transformFinalizers: { snap: finalizeFoxholeSceneV2Transform } } });
        context.after(() => connection.dispose());
        const run = async (entities: Entity[]) => {
            const result = await host.finalizeTransform('snap', { contractVersion: 1, entityId: 'pipe', transform,
                interaction: 'placement', ...(group ? { movingEntityIds: ['pipe','internal'] } : {}), context: { contractVersion: 1, entities } });
            return { transform: result.transform, operations: result.transaction?.operations };
        };
        const expected = await run(old);
        assert.ok(expected.operations?.length);
        assert.deepEqual(await run(native), expected);
        assert.deepEqual(native, before);
    });
}

test('canonical floating placement retains draft and tilted parent pose through public RPC', async context => {
    const ship = entity('ship', 'barge', 20), parent = entity('parent', '', 50);
    ship.components[0]!.data.y = 30;
    ship.components.push({ ownerId: 'nixie.core', componentId: 'hierarchy', version: 1, definitionAvailable: true, data: { parentId: 'parent', order: 0 } });
    Object.assign(parent.components[0]!.data, { y: 10, rotation: 0.4, scaleX: 2, scaleY: 3 });
    Object.assign(parent.components[1]!.data, { elevation: -20, rotationX: 0.2, rotationY: -0.15, scaleZ: 2 });
    const old = [ship, parent], native = old.map(canonical), before = structuredClone(native);
    const host = createFakeNixieExtensionHost({ extensionId: owner });
    const connection = await host.connect({ sceneV2: { transformFinalizers: { surface: finalizeFoxholeSurfacePlacement } } });
    context.after(() => connection.dispose());
    const request: Request = { contractVersion: 1, entityId: 'ship', interaction: 'placement', groundElevation: 100, waterElevation: 100,
        transform: { ...transform, x: 20, y: 30 }, context: { contractVersion: 1, entities: old } };
    const expected = await host.finalizeTransform('surface', request);
    assert.ok(Number.isFinite(expected.transform.elevation));
    assert.deepEqual(await host.finalizeTransform('surface', { ...request, context: { contractVersion: 1, entities: native } }), expected);
    assert.deepEqual(native, before);
});

test('canonical planning labels and bearings retain authored yaw for every planning renderer', () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../nixie.extension.json', import.meta.url), 'utf8')));
    for (const id of ['range', 'binocular-line', 'triangulation', 'tactical-line']) {
        const product = manifest.contributes.experimentalProducts!.find(candidate => candidate.components.some(component => component.componentId === id))!;
        assert.ok(product, id);
        const subject = entity(id);
        subject.components = [...subject.components.filter(component => component.ownerId === 'nixie.core'),
            ...product.components.map(component => ({ ...component, definitionAvailable: true, data: structuredClone(component.data) }))];
        subject.components[0]!.data.rotation = 0.7;
        const native = canonical(subject), before = structuredClone(native);
        assert.deepEqual(renderFoxholeSceneV2Entity(native), renderFoxholeSceneV2Entity(subject), id);
        assert.deepEqual(native, before);
    }
});

test('canonical model socket bindings retain cable height beneath nested spatial frames', () => {
    const pole = entity('pole', 'powerpole', 20), parent = entity('parent', '', 50), cable = pipe();
    Object.assign(parent.components[0]!.data, { y: -40, rotation: 0.6, scaleX: -2, scaleY: 3 });
    Object.assign(parent.components[1]!.data, { elevation: 70, rotationX: 0.2, rotationY: -0.1, scaleZ: 1.5 });
    pole.components.push({ ownerId: 'nixie.core', componentId: 'hierarchy', version: 1, definitionAvailable: true, data: { parentId: 'parent', order: 0 } });
    Object.assign(cable.components[0]!.data, { x: -20, y: 10, rotation: -0.4, scaleX: 2, scaleY: -1 });
    Object.assign(cable.components[1]!.data, { elevation: 30, rotationX: -0.2, rotationY: 0.3, scaleZ: 2 });
    const spline = { ...cable.components.find(component => component.componentId === 'spline-connector')!.data,
        foxholeKey: 'powerline', startAttachmentNodeId: 'pole', startAttachmentSocketName: 'PowerSocket' } as unknown as FoxholeSceneV2SplineConnectorData;
    const old = [pole, parent, cable], native = old.map(canonical), before = structuredClone(native);
    const expected = resolveFoxholeSpatialSplineAttachments(cable, spline, { contractVersion: 1, entities: old }, assets);
    const actual = resolveFoxholeSpatialSplineAttachments(native[2]!, spline, { contractVersion: 1, entities: native }, assets);
    assert.ok(expected.endpointBindings.start);
    assert.notEqual(expected.startZ, 0);
    assert.deepEqual(actual, expected);
    assert.deepEqual(native, before);
});

test('native temporary proposals retain closed XYZ data while unresolved components remain opaque', () => {
    const native = canonical(entity('native'));
    native.components.push({ ownerId: 'nixie.core', componentId: 'legacy-source', version: 1, definitionAvailable: true,
        data: { x: 999, elevation: 999, rotation: 999 } });
    const pose = native.components[0]!.data;
    pose.position = { x: 10, y: 20, z: 30 };
    pose.rotation = { x: 0.2, y: -0.3, z: 0.4 };
    pose.scale = { x: -2, y: 3, z: 4 };
    const before = structuredClone(native);
    const proposed = withFoxholeSceneV2TransformProposal(native, { x: 80, rotation: 0.7, scaleX: 2 }, 90);
    assert.deepEqual(readFoxholeSceneV2CoreTransform(proposed), {
        position: { x: 80, y: 20, z: 90 }, rotation: { x: 0.2, y: -0.3, z: 0.7 }, scale: { x: 2, y: 3, z: 4 },
    });
    assert.equal(proposed.components.some(component => component.componentId === 'spatial-transform'), false);
    assert.throws(() => withFoxholeSceneV2TransformProposal(native, { scaleX: 0 }), /invalid/);
    for (const mode of ['future', 'unavailable', 'malformed', 'split', 'duplicate']) {
        const unresolved = structuredClone(native);
        if (mode === 'future') unresolved.components[0]!.version = 99;
        if (mode === 'unavailable') unresolved.components[0]!.definitionAvailable = false;
        if (mode === 'malformed') unresolved.components[0]!.data.x = 500;
        if (mode === 'split') unresolved.components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1, definitionAvailable: true, data: { elevation: 500 } });
        if (mode === 'duplicate') unresolved.components.push(structuredClone(unresolved.components[0]!));
        const preserved = structuredClone(unresolved);
        assert.equal(readFoxholeSceneV2CoreTransform(unresolved), null, mode);
        assert.throws(() => withFoxholeSceneV2TransformProposal(unresolved, { x: 5 }), /supported/, mode);
        assert.deepEqual(unresolved, preserved);
    }
    assert.deepEqual(native, before);
});
