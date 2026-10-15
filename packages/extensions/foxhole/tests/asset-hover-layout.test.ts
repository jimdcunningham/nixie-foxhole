import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FOXHOLE_ASSET_HOVER_RECIPE_LIST_THRESHOLD,
    formatFoxholeHoverPowerLabel,
    planFoxholeAssetHoverRecipeGridLayout,
    resolveFoxholeAssetHoverAttributes,
    resolveFoxholeAssetHoverRecipePresentation,
    splitFoxholeHoverRecipeColumns,
} from '../app/plugins/foxhole/nixie/asset-hover-layout.ts';
import type { FoxholeRecipeViewModel } from '../app/plugins/foxhole/nixie/production/recipe-display.ts';

function recipe(id: string): FoxholeRecipeViewModel {
    return {
        id,
        recipe: {} as FoxholeRecipeViewModel['recipe'],
        title: id,
        subtitle: null,
        groupId: 'facility',
        durationSeconds: 1,
        powerDelta: -2000,
        isBuildCost: false,
        consumesResourceNodes: false,
        inputs: [],
        outputs: [],
    };
}

test('resolveFoxholeAssetHoverRecipePresentation switches after threshold', () => {
    assert.equal(
        resolveFoxholeAssetHoverRecipePresentation(FOXHOLE_ASSET_HOVER_RECIPE_LIST_THRESHOLD),
        'grid',
    );
    assert.equal(
        resolveFoxholeAssetHoverRecipePresentation(FOXHOLE_ASSET_HOVER_RECIPE_LIST_THRESHOLD + 1),
        'outputs-list',
    );
});

test('planFoxholeAssetHoverRecipeGridLayout collapses I/O then truncates', () => {
    const recipes = Array.from({ length: 8 }, (_, index) => recipe(`r${index}`));

    const full = planFoxholeAssetHoverRecipeGridLayout(recipes, 400);
    assert.equal(full.hideIo, false);
    assert.equal(full.visibleRecipes.length, 8);
    assert.equal(full.hiddenCount, 0);

    const headerOnly = planFoxholeAssetHoverRecipeGridLayout(recipes, 140);
    assert.equal(headerOnly.hideIo, true);
    assert.equal(headerOnly.visibleRecipes.length, 8);
    assert.equal(headerOnly.hiddenCount, 0);

    const truncated = planFoxholeAssetHoverRecipeGridLayout(recipes, 50);
    assert.equal(truncated.hideIo, true);
    assert.ok(truncated.visibleRecipes.length < 8);
    assert.ok(truncated.hiddenCount > 0);
});

test('splitFoxholeHoverRecipeColumns balances two columns', () => {
    const columns = splitFoxholeHoverRecipeColumns([
        recipe('a'),
        recipe('b'),
        recipe('c'),
    ]);
    assert.equal(columns.length, 2);
    assert.equal(columns[0]?.recipes.length, 2);
    assert.equal(columns[1]?.recipes.length, 1);
    assert.equal(columns[0]?.pad, false);
    assert.equal(columns[1]?.pad, true);
});

test('formatFoxholeHoverPowerLabel formats megawatts', () => {
    assert.equal(formatFoxholeHoverPowerLabel(-8000), '-8 MW');
    assert.equal(formatFoxholeHoverPowerLabel(5000), '+5 MW');
    assert.equal(formatFoxholeHoverPowerLabel(0), '');
});

test('resolveFoxholeAssetHoverAttributes includes inventory and foundation', () => {
    const attributes = resolveFoxholeAssetHoverAttributes(
        { isFacility: true },
        {
            inventorySlots: 15,
            decays: true,
            bIsBuiltOnFoundation: true,
        },
    );
    assert.deepEqual(
        attributes.map(entry => entry.id),
        ['inventory', 'foundation', 'decays'],
    );
});

test('resolveFoxholeAssetHoverAttributes does not infer foundation from isFacility', () => {
    const attributes = resolveFoxholeAssetHoverAttributes(
        { isFacility: true },
        {
            inventorySlots: 15,
            decays: true,
            bIsBuiltOnFoundation: false,
        },
    );
    assert.deepEqual(
        attributes.map(entry => entry.id),
        ['inventory', 'decays'],
    );
});

test('resolveFoxholeAssetHoverAttributes includes liquid, fuel, and stockpile capacities', () => {
    const attributes = resolveFoxholeAssetHoverAttributes(
        {},
        {
            liquidCapacity: 5000,
            fuelTanks: [{ capacity: 100 }, { capacity: 100 }],
            stockpile: { totalItemCapacity: 2500 },
        },
    );
    assert.deepEqual(attributes, [
        { id: 'liquid-capacity', label: 'Liquid: 5,000' },
        { id: 'fuel-capacity', label: 'Fuel: 200' },
        { id: 'stockpile-capacity', label: 'Stockpile: 2,500' },
    ]);
});

test('resolveFoxholeAssetHoverAttributes falls back to fuel hold limits', () => {
    const attributes = resolveFoxholeAssetHoverAttributes(
        {},
        {
            holdProfile: {
                mode: 'fuel-tank',
                itemQuantityLimits: { Petrol: 1000 },
            },
        },
    );
    assert.deepEqual(attributes, [
        { id: 'fuel-capacity', label: 'Fuel: 1,000' },
    ]);
});

test('resolveFoxholeAssetHoverAttributes omits production order limits', () => {
    const attributes = resolveFoxholeAssetHoverAttributes(
        {},
        { maxOrders: 5 },
    );
    assert.deepEqual(attributes, []);
});
