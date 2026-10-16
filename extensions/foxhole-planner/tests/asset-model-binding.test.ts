import assert from 'node:assert/strict';
import test from 'node:test';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { getFoxholeSceneV2ModelComponentData } from '../src/scene-v2-models.ts';
import metadata from '../src/scene-v2-assets-node.ts';

function entity(assetId: string, destroyed = false): NixieExperimentalComponentEntitySnapshotV1 {
    return { entityId: 'upgraded-bunker', revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'model', version: 1, definitionAvailable: true,
            data: getFoxholeSceneV2ModelComponentData(metadata.fortt2!.model!) },
        { ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1, definitionAvailable: true,
            data: { destroyed } },
    ] };
}

test('previously saved tier changes render the current asset instead of a stale bound model', () => {
    for (const assetId of ['fortt1', 'fortt3']) {
        const subject = entity(assetId);
        const before = structuredClone(subject);
        const plan = renderFoxholeSceneV2Entity(subject);
        assert.deepEqual(plan.experimentalSpatial?.model, getFoxholeSceneV2ModelComponentData(metadata[assetId]!.model!));
        assert.deepEqual(subject, before);
    }
    assert.equal(renderFoxholeSceneV2Entity(entity('fortt2')).experimentalSpatial?.model, undefined);
});

test('asset changes to flat artwork suppress an obsolete model while retaining the planar visual', () => {
    const target = Object.entries(metadata).find(([, asset]) => !asset.isItem && !asset.model && !asset.connector)!;
    assert.ok(target);
    const plan = renderFoxholeSceneV2Entity(entity(target[0]));
    assert.equal(plan.experimentalSpatial?.model, null);
    assert.ok(plan.root.children.length > 0);
});

test('Demolished takes priority over repairing an obsolete intact tier model', () => {
    const plan = renderFoxholeSceneV2Entity(entity('fortt3', true));
    const asset = metadata.fortt3!;
    assert.deepEqual(plan.experimentalSpatial?.model, getFoxholeSceneV2ModelComponentData(metadata[asset.destroyedAssetId!]!.model!));
});
