import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import {
    resolveFoxholeConversionParentAsset,
    resolveFoxholeConversionSourceAsset,
    resolveFoxholeRelationshipSelectionAsset,
    resolveFoxholeRelationshipUpgradeSourceAsset,
    resolveFoxholeStructureTierMutation,
} from '../app/plugins/foxhole/nixie/structure-tier-actions.ts';

const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));

test('facility conversion products are recipes rather than facility upgrade relationships', () => {
    const facility = catalog.assetByKey.facilitymodificationcenter!;
    const motorcycle = catalog.assetByKey.motorcycleoffensivec!;
    const facilityOnlyCatalog = {
        ...catalog,
        assets: catalog.assets.filter(asset => !asset.isVehicle || asset === motorcycle),
    };
    assert.ok(facility.conversionStructureIds.includes(motorcycle.foxholeKey));
    assert.ok(facility.conversionStructureIds.every(id => catalog.assetByKey[id]!.isVehicle));
    assert.equal(resolveFoxholeConversionSourceAsset(catalog, facility), null);
    assert.equal(resolveFoxholeConversionParentAsset(facilityOnlyCatalog, motorcycle), null);
    assert.equal(resolveFoxholeConversionSourceAsset(facilityOnlyCatalog, motorcycle), null);
    assert.equal(resolveFoxholeStructureTierMutation(facilityOnlyCatalog, { foxholeKey: motorcycle.foxholeKey }, 'down'), null);
    assert.equal(resolveFoxholeRelationshipSelectionAsset(facilityOnlyCatalog, motorcycle, motorcycle), null);
});

test('vehicle conversion lookup skips a facility and finds the vehicle parent', () => {
    const motorcycle = catalog.assetByKey.motorcycleoffensivec!;
    const base = {
        ...catalog.assetByKey.motorcyclec!,
        conversionCodeNames: [motorcycle.codeName],
        conversionStructureIds: [motorcycle.foxholeKey],
    };
    const conversionCatalog = {
        assets: [catalog.assetByKey.facilitymodificationcenter!, base, motorcycle],
        assetByKey: { ...catalog.assetByKey, [base.foxholeKey]: base },
    };
    assert.equal(resolveFoxholeConversionParentAsset(conversionCatalog, motorcycle), base);
    assert.equal(resolveFoxholeConversionSourceAsset(conversionCatalog, motorcycle), base);
    assert.equal(resolveFoxholeStructureTierMutation(conversionCatalog, { foxholeKey: motorcycle.foxholeKey }, 'down')?.targetAsset, base);
    assert.equal(resolveFoxholeRelationshipSelectionAsset(conversionCatalog, motorcycle, motorcycle), base);
});

test('selected bunker conversion toggles back to its base at the same tier', () => {
    for (const key of ['fortt2', 'fortt3']) {
        const base = catalog.assetByKey[key]!;
        assert.ok(base);
        const conversions = base.conversionStructureIds.map(id => catalog.assetByKey[id]).filter(Boolean);
        assert.ok(conversions.length > 0);
        assert.equal(resolveFoxholeConversionSourceAsset(catalog, base), base);
        for (const conversion of conversions) {
            assert.equal(resolveFoxholeRelationshipSelectionAsset(catalog, base, conversion), conversion);
            assert.equal(resolveFoxholeRelationshipSelectionAsset(catalog, conversion, conversion), base);
        }
        assert.equal(resolveFoxholeRelationshipSelectionAsset(catalog, base, base),
            resolveFoxholeRelationshipUpgradeSourceAsset(catalog, base));
    }
});

test('tier down still follows the converted structure tier relationship', () => {
    const base = catalog.assetByKey.fortt3!;
    const engine = base.conversionStructureIds.map(id => catalog.assetByKey[id]).find(asset => /engine/i.test(asset?.codeName ?? ''))!;
    assert.ok(engine);
    const mutation = resolveFoxholeStructureTierMutation(catalog, { foxholeKey: engine.foxholeKey }, 'down');
    assert.ok(mutation);
    assert.equal(mutation.targetAsset.tier, 2);
    assert.match(mutation.targetAsset.codeName, /engine/i);
});

test('sandbag cover upgrades to wall and wall returns to cover', () => {
    const cover = catalog.assetByKey.sandbaghalfspline!;
    const wall = catalog.assetByKey.sandbagfullspline!;
    const upgrade = resolveFoxholeStructureTierMutation(catalog, { foxholeKey: 'sandbaghalfspline' }, 'up');
    const downgrade = resolveFoxholeStructureTierMutation(catalog, { foxholeKey: 'sandbagfullspline' }, 'down');
    assert.equal(upgrade?.targetAsset.foxholeKey, 'sandbagfullspline');
    assert.deepEqual(upgrade?.patch, { foxholeKey: 'sandbagfullspline', modificationVariantIds: {} });
    assert.equal(downgrade?.targetAsset.foxholeKey, 'sandbaghalfspline');
    assert.equal(resolveFoxholeRelationshipUpgradeSourceAsset(catalog, cover), null);
    assert.equal(resolveFoxholeRelationshipUpgradeSourceAsset(catalog, wall), cover);
    assert.equal(catalog.assetByKey[cover.upgradeStructureId!], wall);
    assert.equal(resolveFoxholeRelationshipSelectionAsset(catalog, cover, wall), wall);
    assert.equal(resolveFoxholeRelationshipSelectionAsset(catalog, wall, wall), cover);
});
test('upgraded foundations retain their selected upgrade and can toggle back across tiers', () => {
    const concrete = catalog.assetByKey.foundation012x2t3!;
    const wooden = catalog.assetByKey.foundation012x2t1!;
    assert.equal(resolveFoxholeRelationshipUpgradeSourceAsset(catalog, concrete), wooden);
    assert.equal(catalog.assetByKey[wooden.upgradeStructureId!], concrete);
    assert.equal(resolveFoxholeRelationshipSelectionAsset(catalog, concrete, concrete), wooden);
});

test('engine room tiers retain supported wall modifications and use destination-tier visuals', () => {
    const selections = { BackDefenseModSlot: 'sandbags', FrontFortStairsModSlot: 'stairs', LeftModSlot: 'powerconnection' };
    for (const [from, direction, to] of [['engineroomt2', 'up', 'engineroomt3'], ['engineroomt3', 'down', 'engineroomt2']] as const) {
        const result = resolveFoxholeStructureTierMutation(catalog, { foxholeKey: from, modificationVariantIds: selections }, direction)!;
        assert.equal(result.targetAsset.foxholeKey, to);
        assert.deepEqual(result.patch.modificationVariantIds, selections);
        const original = catalog.assetByKey[from]!.modificationSlots.find(slot => slot.id === 'FrontFortStairsModSlot')!.variantById.stairs!;
        const replacement = result.targetAsset.modificationSlots.find(slot => slot.id === 'FrontFortStairsModSlot')!.variantById.stairs!;
        assert.notEqual(replacement.textureUrl, original.textureUrl, 'the logical stairs selection resolves to the new tier artwork');
        assert.deepEqual(selections, { BackDefenseModSlot: 'sandbags', FrontFortStairsModSlot: 'stairs', LeftModSlot: 'powerconnection' });
    }
});

test('trench tier changes retain barbed wire, resolve tier visuals, and omit unsupported modifications', () => {
    for (const [from, direction, to] of [['trencht1', 'up', 'trencht2'], ['trencht2', 'up', 'trencht3'],
        ['trencht3', 'down', 'trencht2'], ['trencht2', 'down', 'trencht1']] as const) {
        const selections = { BackDefenseModSlot: 'barbedwire', FrontEndModSlot: 'stairs', BPTrenchRoofModSlot: 'trenchroof', UnknownSlot: 'barbedwire' };
        const result = resolveFoxholeStructureTierMutation(catalog, { foxholeKey: from, modificationVariantIds: selections }, direction)!;
        const expected = { BackDefenseModSlot: 'barbedwire', FrontEndModSlot: 'stairs', ...(to === 'trencht3' ? { BPTrenchRoofModSlot: 'trenchroof' } : {}) };
        assert.equal(result.targetAsset.foxholeKey, to);
        assert.deepEqual(result.patch.modificationVariantIds, expected);
        const variant = result.targetAsset.modificationSlots.find(slot => slot.id === 'BackDefenseModSlot')!.variantById.barbedwire!;
        assert.ok(variant.textureUrl);
        const previous = catalog.assetByKey[from]!.modificationSlots.find(slot => slot.id === 'BackDefenseModSlot')!.variantById.barbedwire!;
        assert.notEqual(variant.textureUrl, previous.textureUrl, 'barbed wire resolves to destination-tier artwork');
    }
});

test('removing a facility upgrade preserves unrelated supported modifications', () => {
    const facility = catalog.assets.find(asset => asset.isFacility && asset.modificationSlots.some(slot => slot.variants.some(variant => variant.isUpgrade)))!;
    assert.ok(facility);
    const upgradeSlot = facility.modificationSlots.find(slot => slot.variants.some(variant => variant.isUpgrade))!;
    const upgrade = upgradeSlot.variants.find(variant => variant.isUpgrade)!;
    const defenseSlot = catalog.assetByKey.engineroomt2!.modificationSlots.find(slot => slot.id === 'BackDefenseModSlot')!;
    const combined = { ...facility, modificationSlots: [...facility.modificationSlots, defenseSlot] };
    const input = { foxholeKey: facility.foxholeKey, modificationVariantIds: { [upgradeSlot.id]: upgrade.id, BackDefenseModSlot: 'sandbags' } };
    const mutation = resolveFoxholeStructureTierMutation({ ...catalog, assetByKey: { ...catalog.assetByKey, [facility.foxholeKey]: combined } }, input, 'down')!;
    assert.equal(mutation.mode, 'clear-upgrade');
    assert.deepEqual(mutation.patch.modificationVariantIds, { BackDefenseModSlot: 'sandbags' });
    assert.equal(input.modificationVariantIds[upgradeSlot.id], upgrade.id, 'tier resolution does not mutate the source state');
});
