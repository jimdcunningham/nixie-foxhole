import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeStructureCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeProductionIndex } from '../../app/plugins/foxhole/nixie/production/index.ts';
import { resolveFoxholeProductionCompletedCycles } from '../../app/plugins/foxhole/nixie/production/aggregation.ts';
import {
    formatFoxholeProductionOverlayOutputLabel,
    resolveFoxholeProductionOutputCodenames,
    resolveFoxholeProductionOverlayOutputs,
} from '../../app/plugins/foxhole/nixie/production/overlay-outputs.ts';

const recipes = getFoxholeProductionIndex('/').recipeById;
const structures = getFoxholeStructureCatalog('/').structureByKey;

function outputs(recipeId: string): string[] {
    const recipe = recipes[recipeId];
    assert.ok(recipe, `Missing recipe ${recipeId}`);
    return resolveFoxholeProductionOutputCodenames(
        recipe,
        structures[recipe.sourceStructureKey]?.powerGridInfo?.powerDelta,
    );
}

test('ordered generator recipes expose their power output, including inherited diesel power', () => {
    assert.deepEqual(outputs('structure:facilitypowerdiesel:recipe:0'), ['power']);
    assert.deepEqual(outputs('modification:facilitypowerdiesel:UpgradeSlotComponent:petrol:recipe:0'), ['power']);
});

test('co-products and unresolved catalog resources remain visible alongside power', () => {
    assert.deepEqual(
        outputs('modification:facilitypoweroil:UpgradeSlotComponent:sulfuricreactor:recipe:0'),
        ['Sulfur', 'power'],
    );
    assert.ok(outputs('structure:factory:recipe:106').includes('RadioAircraft'));
});

test('consuming recipes do not claim to produce power', () => {
    const consumer = Object.values(recipes).find(recipe => recipe.powerDelta !== null && recipe.powerDelta < 0);
    assert.ok(consumer);
    assert.equal(
        resolveFoxholeProductionOutputCodenames(
            consumer,
            structures[consumer.sourceStructureKey]?.powerGridInfo?.powerDelta,
        ).includes('power'),
        false,
    );
});

test('output tiles retain their recipe quantities and channel', () => {
    const recipe = recipes['structure:facilityfactorysmallarms:recipe:2'];
    assert.ok(recipe);
    const output = resolveFoxholeProductionOverlayOutputs(recipe, null)
        .find(entry => entry.codename === 'ArmourUniformC');
    assert.ok(output);
    assert.deepEqual(output, {
        codename: 'ArmourUniformC',
        channel: 'crate',
        quantity: 10,
        durationSeconds: recipe.durationSeconds,
    });
    assert.equal(formatFoxholeProductionOverlayOutputLabel(output, 6, 900), 'Output: ×60/15m crates');
});

test('tooltip totals use the same completed-cycle limit as Statistics', () => {
    assert.equal(resolveFoxholeProductionCompletedCycles(60, 3600, null), 60);
    assert.equal(resolveFoxholeProductionCompletedCycles(60, 900, 10), 10);
    assert.equal(resolveFoxholeProductionCompletedCycles(1200, 900, null), 0);
    assert.equal(formatFoxholeProductionOverlayOutputLabel({
        codename: 'FacilityMaterials5',
        channel: 'item',
        quantity: 1,
        durationSeconds: 60,
    }, 60, 3600), 'Output: ×60/hr');
    assert.equal(formatFoxholeProductionOverlayOutputLabel({
        codename: 'FacilityMaterials5',
        channel: 'item',
        quantity: 1,
        durationSeconds: 60,
    }, 90, 5400), 'Output: ×90/90m');
});

test('power output shows the converted MW amount', () => {
    const recipe = recipes['structure:facilitypowerdiesel:recipe:0'];
    assert.ok(recipe);
    const output = resolveFoxholeProductionOverlayOutputs(
        recipe,
        structures[recipe.sourceStructureKey]?.powerGridInfo?.powerDelta,
    ).find(entry => entry.channel === 'power');
    assert.ok(output);
    assert.ok(output.quantity && output.quantity > 0);
    assert.match(formatFoxholeProductionOverlayOutputLabel(output, 0, 900), /^Output: \+[\d,.]+ MW$/);
});
