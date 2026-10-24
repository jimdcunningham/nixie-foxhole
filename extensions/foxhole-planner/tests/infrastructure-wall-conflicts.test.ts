import assert from 'node:assert/strict';
import test from 'node:test';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import { filterFoxholeSameWallInfrastructureSelections, hasFoxholeSameWallModificationConflict } from '../src/modification-wall-conflicts.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { aggregateFoxholeEcsResources } from '../src/resource-statistics.ts';

test('wall identity uses socket names rather than slot names or proximity', () => {
    const slots = {
        a: { componentType: 'BPFortInfraModSlot_C', linkedSocketNames: [' BackFortSocket '] },
        b: { componentType: 'BPFortWallModSlot_C', linkedSocketNames: ['backfortsocket'] },
        c: { componentType: 'BPFortWallModSlot_C', linkedSocketNames: ['LeftFortSocket'] },
    };
    assert.equal(hasFoxholeSameWallModificationConflict(slots.a, 'kitchen', slots, [{ slotId: 'b', variantId: 'firingport' }]), true);
    assert.equal(hasFoxholeSameWallModificationConflict(slots.a, 'kitchen', slots, [{ slotId: 'c', variantId: 'firingport' }]), false);
    assert.equal(hasFoxholeSameWallModificationConflict(slots.a, 'kitchen', slots, [{ slotId: 'b', variantId: 'door' }]), false);
    assert.equal(hasFoxholeSameWallModificationConflict({ componentType: 'BPFortInfraModSlot_C' }, 'kitchen', slots,
        [{ slotId: 'b', variantId: 'firingport' }]), false, 'missing wall identity cannot block other walls');
});

test('saved same-wall conflicts retain the firing port without rendering or charging infrastructure', () => {
    for (const assetId of ['fortt2', 'fortt3', 'fortcornert2', 'fortcornert3']) {
        const asset = assets[assetId]!;
        const port = { slotId: 'BackModSlot', variantId: 'firingport' };
        const kitchen = { slotId: 'BackInfraModSlot', variantId: 'kitchen' };
        const adjacent = { slotId: 'LeftInfraModSlot', variantId: 'kitchen' };
        const entity = (selections: typeof port[]): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId: assetId, revision: 1, components: [
            { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId } },
            { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true, data: { selections } },
        ] });
        const render = (selections: typeof port[]) => renderFoxholeSceneV2Entity(entity(selections));
        const costs = (selections: typeof port[]) => aggregateFoxholeEcsResources([entity(selections)], assets, 3600).costs;
        for (const selections of [[port, kitchen], [kitchen, port]]) {
            const before = structuredClone(selections);
            assert.deepEqual(filterFoxholeSameWallInfrastructureSelections(asset.modifications, selections), [port]);
            assert.deepEqual(render(selections), render([port]));
            assert.deepEqual(costs(selections), costs([port]));
            assert.deepEqual(selections, before);
        }
        assert.deepEqual(filterFoxholeSameWallInfrastructureSelections(asset.modifications, [port, adjacent]), [port, adjacent]);
        assert.notDeepEqual(render([port, adjacent]), render([port]));
        assert.notDeepEqual(costs([port, adjacent]), costs([port]));
    }
});
