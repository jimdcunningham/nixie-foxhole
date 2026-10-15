import { resolveFoxholePowerDeltaMw } from '../facility-power.ts';
import { FOXHOLE_RECIPE_POWER_RESOURCE_ID, resolveFoxholeRecipeEffectivePowerDelta } from './operating-power.ts';
import type { FoxholeProductionChannel, FoxholeProductionRecipe, FoxholeProductionResourceAmount } from './types.ts';

export interface FoxholeProductionOverlayOutput {
    codename: string;
    channel: Exclude<FoxholeProductionChannel, 'build'> | 'power';
    quantity: number | null;
    durationSeconds: number | null;
}

function resourceOutputs(
    resources: Record<string, FoxholeProductionResourceAmount>,
    channel: FoxholeProductionOverlayOutput['channel'],
    durationSeconds: number | null,
): FoxholeProductionOverlayOutput[] {
    return Object.entries(resources).map(([codename, amount]) => ({
        codename,
        channel,
        quantity: Number.isFinite(amount.quantity) && amount.quantity > 0 ? amount.quantity : null,
        durationSeconds,
    }));
}

/** Preserve the per-cycle amount and channel used by each output tile. */
export function resolveFoxholeProductionOverlayOutputs(
    recipe: FoxholeProductionRecipe,
    structurePowerDelta: number | null | undefined,
): FoxholeProductionOverlayOutput[] {
    const outputs = [
        ...resourceOutputs(recipe.itemOutput, 'item', recipe.durationSeconds),
        ...resourceOutputs(recipe.crateOutput, 'crate', recipe.durationSeconds),
        ...resourceOutputs(recipe.liquidOutput, 'liquid', recipe.durationSeconds),
    ];
    const powerMw = resolveFoxholePowerDeltaMw(resolveFoxholeRecipeEffectivePowerDelta(recipe, structurePowerDelta));
    if (powerMw > 0) {
        outputs.push({ codename: FOXHOLE_RECIPE_POWER_RESOURCE_ID, channel: 'power', quantity: powerMw, durationSeconds: recipe.durationSeconds });
    }
    return outputs.filter((output, index) => outputs.findIndex(entry => entry.codename === output.codename) === index);
}

const quantityFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function formatInterval(intervalSeconds: number): string {
    if (intervalSeconds === 3600) {
        return 'hr';
    }
    if (intervalSeconds % 86400 === 0) {
        return `${intervalSeconds / 86400}d`;
    }
    if (intervalSeconds % 3600 === 0) {
        return `${intervalSeconds / 3600}h`;
    }
    if (intervalSeconds % 60 === 0) {
        return `${intervalSeconds / 60}m`;
    }
    return `${intervalSeconds}s`;
}

export function formatFoxholeProductionOverlayOutputLabel(
    output: FoxholeProductionOverlayOutput,
    completedCycles: number,
    intervalSeconds: number,
): string {
    if (output.quantity === null || !Number.isFinite(output.quantity) || output.quantity <= 0) {
        return 'Production Output';
    }
    if (output.channel === 'power') {
        return `Output: +${quantityFormatter.format(output.quantity)} MW`;
    }
    const total = output.quantity * completedCycles;
    const unit = output.channel === 'crate' ? ` crate${total === 1 ? '' : 's'}` : '';
    return `Output: ×${quantityFormatter.format(total)}/${formatInterval(intervalSeconds)}${unit}`;
}

/** Every resource a queued conversion produces, including power outside the item maps. */
export function resolveFoxholeProductionOutputCodenames(
    recipe: FoxholeProductionRecipe,
    structurePowerDelta: number | null | undefined,
): string[] {
    return resolveFoxholeProductionOverlayOutputs(recipe, structurePowerDelta).map(output => output.codename);
}
