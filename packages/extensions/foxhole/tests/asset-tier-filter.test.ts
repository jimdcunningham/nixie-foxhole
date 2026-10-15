import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { matchesFoxholeTierFilter } from '../app/plugins/foxhole/nixie/assets-browser.ts';
import type { NixieAssetBrowserContext, NixieResolvedAssetEntry } from '#nixie/plugins/nixie/registry/types.ts';

function entry(metadata: Record<string, unknown>): NixieResolvedAssetEntry {
    return { asset: { id: 'test', metadata } } as unknown as NixieResolvedAssetEntry;
}

const context = { getSettingValue: () => false } as unknown as NixieAssetBrowserContext;

test('standalone transfer stations remain available at every selected tier', () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    for (const id of ['facilitytransfercrate', 'facilitytransferliquid', 'facilitytransferresource', 'facilitytransfermaterial']) {
        const asset = catalog.assetByKey[id];
        assert.ok(asset, id);
        const resolved = entry({
            tier: asset.tier,
            techId: asset.techId,
            isFacility: asset.isFacility,
            parentStructureId: asset.parentStructureId,
            downgradeStructureId: asset.downgradeStructureId,
            hasHigherTierSibling: Boolean(asset.upgradeStructureId),
        });
        for (const tier of ['1', '2', '3']) {
            assert.equal(matchesFoxholeTierFilter(resolved, tier, context), true, `${id} at Tier ${tier}`);
        }
    }
});

test('explicit facility technology unlocks still restrict lower tiers', () => {
    assert.equal(matchesFoxholeTierFilter(entry({ tier: 3, isFacility: true, techId: 'unlockfacilitytier3' }), '2', context), false);
    assert.equal(matchesFoxholeTierFilter(entry({ tier: 2, isFacility: true, techId: 'unlockfacilitytier2' }), '1', context), false);
});

test('actual tier variants and non-facility structures retain tier filtering', () => {
    for (const metadata of [
        { tier: 3, isFacility: true, downgradeStructureId: 'lower-tier' },
        { tier: 2, isFacility: true, parentStructureId: 'base' },
        { tier: 2, isFacility: true, hasHigherTierSibling: true },
        { tier: 3, isFacility: false },
    ]) {
        assert.equal(matchesFoxholeTierFilter(entry(metadata), '1', context), false);
    }
    assert.equal(matchesFoxholeTierFilter(entry({ tier: 1, hasHigherTierSibling: true }), '2', context), false);
});
