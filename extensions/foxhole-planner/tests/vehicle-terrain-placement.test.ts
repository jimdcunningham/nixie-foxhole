import assert from 'node:assert/strict';
import test from 'node:test';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity, NixieExperimentalTransformFinalizeRequestV1 as Request } from '@nixie/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { finalizeFoxholeSurfacePlacement } from '../src/surface-placement.ts';

function vehicle(assetId: string): Entity {
    return { entityId: assetId, revision: 0, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId, catalogId: 'foxhole.structures' } },
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true, data: { x: 20, y: 30, rotation: 0, scaleX: 1, scaleY: 1 } },
        { ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1, definitionAvailable: true, data: { elevation: 0, rotationX: 0, rotationY: 0, scaleZ: 1 } },
    ] };
}

for (const assetId of ['lighttankc', 'scouttankoffensivew', 'trainengine']) {
    test(`${assetId} follows supplied terrain during placement and planar movement`, () => {
        assert.equal(assets[assetId]!.isVehicle, true);
        const subject = vehicle(assetId);
        const before = structuredClone(subject);
        for (const interaction of ['placement', 'planar-translation'] as const) {
            for (const groundElevation of [160, -64, 0]) {
                const request: Request = { contractVersion: 1, entityId: subject.entityId, interaction, groundElevation,
                    transform: { x: 20, y: 30, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities: [subject] } };
                assert.deepEqual(finalizeFoxholeSurfacePlacement(request).transform, { x: 20, y: 30, elevation: groundElevation });
                assert.equal(finalizeFoxholeSurfacePlacement({ ...request, interaction: 'transform' }).transform.elevation, undefined);
                const { groundElevation: _ground, ...withoutTerrain } = request;
                assert.equal(finalizeFoxholeSurfacePlacement(withoutTerrain).transform.elevation, undefined);
            }
        }
        assert.deepEqual(subject, before);
    });
}
