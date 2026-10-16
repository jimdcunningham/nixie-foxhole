import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import metadata from '../src/scene-v2-assets-node.ts';
import { getFoxholeSceneV2ModelComponentData } from '../src/scene-v2-models.ts';

test('demolished structures select their real destroyed model without rewriting saved identity or upgrades', () => {
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'factory', revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'facilityrefinery1' } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1, definitionAvailable: true, data: { destroyed: true } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true,
            data: { selections: [{ slotId: 'UpgradeSlotComponent', variantId: 'smelter' }] } },
    ] };
    const before = structuredClone(entity);
    const destroyed = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity));
    assert.deepEqual(destroyed.experimentalSpatial?.model, getFoxholeSceneV2ModelComponentData(metadata.facilityrefinery1destroyed!.model!));
    assert.equal(destroyed.experimentalSpatial?.supplementModel, true);
    assert.equal(destroyed.experimentalSpatial?.hiddenModelNodes, undefined);
    assert.deepEqual(entity, before);
    entity.components[1]!.data.destroyed = false;
    assert.equal(renderFoxholeSceneV2Entity(entity).experimentalSpatial?.model, undefined);
});

test('every published destroyed model is selected using catalog metadata and its own dimensions', () => {
    for (const [assetId, asset] of Object.entries(metadata)) {
        if (!asset.destroyedAssetId || !asset.model || asset.isItem) continue;
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({ entityId: assetId, revision: 1, components: [
            { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
                data: { catalogId: 'foxhole.structures', assetId } },
            { ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1, definitionAvailable: true, data: { destroyed: true } },
        ] }));
        const destroyedModel = metadata[asset.destroyedAssetId]?.model;
        assert.deepEqual(plan.experimentalSpatial?.model, destroyedModel ? getFoxholeSceneV2ModelComponentData(destroyedModel) : null, assetId);
    }
});
