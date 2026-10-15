import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FOXHOLE_RECIPE_POWER_RESOURCE_ID,
    foxholeRecipesSharePowerDelta,
    listFoxholeStructuresWithRecipes,
    resolveFoxholeRecipeShowcase,
    resolveFoxholeStructureRecipes,
} from '../../app/plugins/foxhole/nixie/production/recipe-display.ts';

const BASE_ASSETS_URL = '/foxhole/assets/';

test('aircraft maintenance recipes follow the selected faction including upgrades', () => {
    for (const faction of ['c', 'w'] as const) {
        const view = resolveFoxholeStructureRecipes({
            structureId: 'facilityfactoryaircraft', baseAssetsUrl: BASE_ASSETS_URL,
            includeModifications: true, faction,
        });
        assert.equal(view.recipes.length, 8);
        assert.ok(view.recipes.some(recipe => recipe.recipe.sourceType === 'modification'));
        assert.ok(view.recipes.every(recipe => recipe.outputs.every(output => (
            !output.item?.faction || output.item.faction === faction
        ))));
        assert.equal(view.groups.flatMap(group => group.recipes).length, 8);
    }
    assert.equal(resolveFoxholeStructureRecipes({
        structureId: 'facilityfactoryaircraft', baseAssetsUrl: BASE_ASSETS_URL,
        includeModifications: true, faction: 'all',
    }).recipes.length, 16);
});

test('faction filtering preserves shared materials recipes', () => {
    const options = { structureId: 'facilityrefinery1', baseAssetsUrl: BASE_ASSETS_URL };
    assert.deepEqual(
        resolveFoxholeStructureRecipes({ ...options, faction: 'c' }).recipes.map(recipe => recipe.id),
        resolveFoxholeStructureRecipes(options).recipes.map(recipe => recipe.id),
    );
});

test('listFoxholeStructuresWithRecipes returns facilities with conversion recipes', () => {
    const options = listFoxholeStructuresWithRecipes({ baseAssetsUrl: BASE_ASSETS_URL });
    assert.ok(options.length > 0);
    assert.ok(options.every(option => option.recipeCount > 0));
    assert.ok(options.some(option => option.id === 'facilityrefinery1' || option.id === 'factory'));
});

test('resolveFoxholeStructureRecipes returns recipes with item-backed resources', () => {
    const view = resolveFoxholeStructureRecipes({
        structureId: 'facilityrefinery1',
        baseAssetsUrl: BASE_ASSETS_URL,
    });

    assert.equal(view.structureId, 'facilityrefinery1');
    assert.ok(view.structure);
    assert.ok(view.recipes.length >= 1);

    const first = view.recipes[0];
    assert.ok(first);
    assert.ok(first.inputs.length + first.outputs.length > 0);
    assert.ok(
        [...first.inputs, ...first.outputs].some(resource => resource.item != null || resource.structure != null),
        'expected at least one recipe resource to resolve against item or structure catalog',
    );
});

test('build-cost showcase cases are separate from conversion layout picks', () => {
    const cases = resolveFoxholeRecipeShowcase({ baseAssetsUrl: BASE_ASSETS_URL });
    const structureCase = cases.find(entry => entry.id === 'build-structure');
    const vehicleCase = cases.find(entry => entry.id === 'build-vehicle');
    const multiInput = cases.find(entry => entry.id === 'multi-input');

    assert.ok(structureCase || vehicleCase, 'expected at least one build-cost showcase case');
    assert.equal(structureCase?.group ?? vehicleCase?.group, 'Build Costs');

    for (const entry of [structureCase, vehicleCase].filter(Boolean)) {
        assert.equal(entry!.recipe.isBuildCost, true, `${entry!.id}: expected isBuildCost`);
        const buildOutput = entry!.recipe.outputs.find(output => output.channel === 'build');
        assert.ok(buildOutput?.structure, `${entry!.id}: expected structure asset`);
        assert.ok(buildOutput.resolvedName, `${entry!.id}: expected resolved name`);
        assert.ok(buildOutput.resolvedIconUrl, `${entry!.id}: expected structure icon`);
        assert.ok(
            !/^(structure|vehicle):/i.test(buildOutput.resolvedName),
            `${entry!.id}: resolved name should not be a raw build id (${buildOutput.resolvedName})`,
        );
    }

    assert.ok(multiInput, 'expected multi-input layout case');
    assert.equal(multiInput.group, 'Layout Coverage');
    assert.equal(multiInput.recipe.isBuildCost, false, 'multi-input should be a conversion recipe');
});

test('showcase covers major facilities and synthesizes power resources', () => {
    const cases = resolveFoxholeRecipeShowcase({ baseAssetsUrl: BASE_ASSETS_URL });
    const groups = new Set(cases.map(entry => entry.group));

    for (const group of [
        'Layout Coverage',
        'Build Costs',
        'Refinery',
        'Materials Factory',
        'Mass Production Factory',
        'Field Modification Center',
        'Power Station',
        'Diesel Power Plant',
    ]) {
        assert.ok(groups.has(group), `expected showcase group: ${group}`);
    }

    assert.ok(cases.length >= 40, `expected a verbose showcase, got ${cases.length}`);

    for (const entry of cases) {
        assert.match(
            entry.description,
            /\bFrom (structure|modification):/,
            `${entry.id}: expected source provenance in description`,
        );
        assert.match(
            entry.description,
            /\bpower\b/i,
            `${entry.id}: expected power provenance in description`,
        );
        assert.match(
            entry.description,
            /\bid\s+\S+/,
            `${entry.id}: expected recipe id in description`,
        );
    }

    const layoutWithSource = cases.find(entry => (
        entry.group === 'Layout Coverage'
        && entry.label.includes('·')
    ));
    assert.ok(layoutWithSource, 'expected layout case labels to include source structure');

    const powerProduce = cases.find(entry => entry.id === 'power-produce');
    assert.ok(powerProduce, 'expected power-produce layout case');
    assert.ok(
        powerProduce.recipe.outputs.some(output => output.id === FOXHOLE_RECIPE_POWER_RESOURCE_ID),
        'power produce should expose a Power output',
    );
    assert.ok(powerProduce.recipe.title.includes('Power'));

    const fmc = cases.find(entry => entry.group === 'Field Modification Center');
    assert.ok(fmc, 'expected FMC showcase recipes');
    assert.ok(
        [...fmc.recipe.inputs, ...fmc.recipe.outputs].some(entry => entry.structure != null || entry.item != null),
        'FMC recipe resources should resolve names/icons',
    );
    assert.ok(
        !/^[a-z0-9]+$/i.test(fmc.recipe.title) || fmc.recipe.title.includes(' '),
        `FMC title should look localized, got: ${fmc.recipe.title}`,
    );
});

test('power station recipes expose lightning-bolt Power output', () => {
    const view = resolveFoxholeStructureRecipes({
        structureId: 'facilitypoweroil',
        baseAssetsUrl: BASE_ASSETS_URL,
        includeModifications: true,
    });
    const powerRecipe = view.recipes.find(recipe => (recipe.powerDelta ?? 0) > 0);
    assert.ok(powerRecipe, 'expected a power-producing recipe');
    const powerOutput = powerRecipe.outputs.find(output => output.id === FOXHOLE_RECIPE_POWER_RESOURCE_ID);
    assert.ok(powerOutput, 'expected synthetic Power output');
    assert.equal(powerOutput.iconName, 'nx:lightning');
    assert.equal(powerOutput.quantityUnit, 'mw');
    assert.ok(powerOutput.quantity > 0);
});

test('foxholeRecipesSharePowerDelta detects uniform sibling power', () => {
    assert.equal(foxholeRecipesSharePowerDelta([]), false);
    assert.equal(foxholeRecipesSharePowerDelta([{ powerDelta: -2000 }]), false);
    assert.equal(
        foxholeRecipesSharePowerDelta([{ powerDelta: -2000 }, { powerDelta: -2000 }]),
        true,
    );
    assert.equal(
        foxholeRecipesSharePowerDelta([{ powerDelta: -2000 }, { powerDelta: -4000 }]),
        false,
    );
});

test('FMC inherits structure powerGridInfo draw without power input tiles', () => {
    const view = resolveFoxholeStructureRecipes({
        structureId: 'facilitymodificationcenter',
        baseAssetsUrl: BASE_ASSETS_URL,
    });
    assert.ok(view.recipes.length > 0);
    const recipe = view.recipes[0]!;
    assert.equal(recipe.powerDelta, -8000, 'expected FMC structure power draw (-8 MW)');
    assert.ok(
        recipe.inputs.every(input => input.id !== FOXHOLE_RECIPE_POWER_RESOURCE_ID),
        'consumer power must not appear as an input resource',
    );
    assert.ok(
        recipe.outputs.every(output => output.id !== FOXHOLE_RECIPE_POWER_RESOURCE_ID),
        'consumer power must not appear as an output resource',
    );
});

test('Materials Factory recipes with authored 0 still inherit facility operating power', () => {
    const view = resolveFoxholeStructureRecipes({
        structureId: 'facilityrefinery1',
        baseAssetsUrl: BASE_ASSETS_URL,
        includeModifications: true,
    });
    const zeroAuthored = view.recipes.find(recipe => recipe.recipe.powerDelta === 0);
    assert.ok(zeroAuthored, 'expected a Materials Factory recipe with authored powerDelta 0');
    assert.equal(
        zeroAuthored.powerDelta,
        -2000,
        'authored 0 should inherit structure powerGridInfo (-2 MW)',
    );

    const override = view.recipes.find(recipe => recipe.recipe.powerDelta === -4000);
    assert.ok(override, 'expected a recipe with an explicit -4000 override');
    assert.equal(override.powerDelta, -4000);
});
