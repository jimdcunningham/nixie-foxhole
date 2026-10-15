import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacyPlanCargoMapper } from '../app/plugins/foxhole/legacy/plan-cargo-mapper.ts';
import { createFoxholeAssetsBaseUrl, getFoxholeItemCatalog, getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeDebugProductionCargoSelection } from '../app/plugins/foxhole/nixie/debug-production-cargo-gallery.ts';
import { hasFoxholeHoldProfileItemSelection } from '../app/plugins/foxhole/nixie/hold-profile.ts';
import { getFoxholeProductionIndex } from '../app/plugins/foxhole/nixie/production/index.ts';
import { resolveFoxholeProductionOverlayOutputs } from '../app/plugins/foxhole/nixie/production/overlay-outputs.ts';

const baseUrl = createFoxholeAssetsBaseUrl('/');
const structureCatalog = getFoxholeStructureCatalog(baseUrl);
const itemCatalog = getFoxholeItemCatalog(baseUrl);
const productionIndex = getFoxholeProductionIndex(baseUrl);

function select(foxholeKey: string, modificationVariantIds?: Record<string, string>) {
    return resolveFoxholeDebugProductionCargoSelection({
        foxholeKey,
        modificationVariantIds,
        structureCatalog,
        itemCatalog,
        productionIndex,
    });
}

test('selects a real cargo item only for cargo-capable assets', () => {
    const selection = select('ammoroomt2');
    assert.ok(selection);
    assert.equal(selection.markedItemCodenames.length, 1);
    assert.deepEqual(selection.productionOrders, []);
    assert.equal(hasFoxholeHoldProfileItemSelection(structureCatalog.structureByKey.ammoroomt2?.holdProfile), true);
    assert.equal(select('facilitypipe'), null);
});

test('selects cargo and a recipe with visible output for facilities', () => {
    const selection = select('engineroomt2');
    assert.ok(selection);
    assert.equal(selection.markedItemCodenames.length, 1);
    assert.equal(selection.productionOrders.length, 1);
    const recipe = productionIndex.recipeById[selection.productionOrders[0]!.recipeId];
    assert.ok(recipe);
    assert.ok(resolveFoxholeProductionOverlayOutputs(recipe,
        structureCatalog.structureByKey[recipe.sourceStructureId]?.powerGridInfo?.powerDelta).length > 0);
});

test('uses the selected modification recipe for a production variant', () => {
    const selection = select('facilityrefinery1', { UpgradeSlotComponent: 'forge' });
    assert.ok(selection);
    assert.equal(selection.productionOrders.length, 1);
    const recipe = productionIndex.recipeById[selection.productionOrders[0]!.recipeId];
    assert.equal(recipe?.sourceType, 'modification');
    assert.equal(recipe.sourceVariantId, 'forge');
});

test('build sites never expose cargo in the catalog, gallery, or legacy import', () => {
    const mapper = new LegacyPlanCargoMapper(structureCatalog, itemCatalog);
    for (const key of ['fortbuildsite', 'fortcornerbuildsite', 'trenchbuildsite']) {
        assert.equal(structureCatalog.structureByKey[key]?.holdProfile, undefined);
        assert.equal(select(key), null);
        assert.deepEqual(mapper.mapEntityCargo({
            foxholeKey: key,
            inventoryItems: ['BasicMaterials'],
        }).markedItemCodenames, []);
    }
});
