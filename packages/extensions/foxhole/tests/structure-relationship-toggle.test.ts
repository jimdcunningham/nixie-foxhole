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
