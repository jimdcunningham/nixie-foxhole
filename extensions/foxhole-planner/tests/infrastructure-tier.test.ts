import assert from 'node:assert/strict';
import test from 'node:test';
import manifest from '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { createFoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import type { PublishedFoxholeManifestForSceneV2 } from '../src/scene-v2-asset-metadata.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';

test('SDK metadata enforces infrastructure tiers even with stale published slots', () => {
    const original = manifest.assets.find(asset => asset.id === 'fortt2')!;
    const infra = (original.modifications ?? []).filter(slot => slot.componentType === 'BPFortInfraModSlot_C');
    assert.equal(infra.length, 4);
    for (const tier of [1, 2, 3]) {
        const generated = createFoxholeSceneV2AssetMetadata({ ...manifest,
            assets: [{ ...original, tier }],
        } as unknown as PublishedFoxholeManifestForSceneV2);
        const statistics = generated.assets.fortt2.statistics;
        assert.ok(statistics);
        for (const slot of infra) {
            assert.equal(Boolean(generated.assets.fortt2.modifications[slot.name]), tier !== 1);
            assert.equal(Boolean(statistics.modificationCosts[slot.name]), tier !== 1);
        }
        assert.ok(Object.keys(generated.assets.fortt2.modifications).length, 'Unrelated slots remain available');
    }
});

test('saved T1 infrastructure selections do not render an invalid overlay', () => {
    const plan = renderFoxholeSceneV2Entity({ entityId: 't1', revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'artilleryait1' } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true,
            data: { selections: [{ slotId: 'BackInfraModSlot', variantId: 'kitchen' }] } },
    ] });
    assert.equal(plan.root.children?.some(node => node.id.startsWith('modification-')), false);
});
