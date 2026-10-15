import type { FoxholeProductionRecipe } from './types.ts';

export const FOXHOLE_RECIPE_POWER_RESOURCE_ID = 'power';

export function isFoxholeBuildOnlyRecipe(recipe: FoxholeProductionRecipe): boolean {
    const hasBuildOutput = Object.keys(recipe.buildOutput).length > 0;
    const hasCommodityOutput = Object.keys(recipe.itemOutput).length > 0
        || Object.keys(recipe.crateOutput).length > 0
        || Object.keys(recipe.liquidOutput).length > 0;
    return hasBuildOutput && !hasCommodityOutput;
}

/** Recipe overrides win; conversion recipes otherwise inherit their structure's operating power. */
export function resolveFoxholeRecipeEffectivePowerDelta(
    recipe: FoxholeProductionRecipe,
    structurePowerDelta: number | null | undefined,
): number | null {
    if (typeof recipe.powerDelta === 'number' && Number.isFinite(recipe.powerDelta) && recipe.powerDelta !== 0) {
        return recipe.powerDelta;
    }
    if (isFoxholeBuildOnlyRecipe(recipe)) {
        return null;
    }
    return typeof structurePowerDelta === 'number' && Number.isFinite(structurePowerDelta)
        ? structurePowerDelta
        : null;
}
