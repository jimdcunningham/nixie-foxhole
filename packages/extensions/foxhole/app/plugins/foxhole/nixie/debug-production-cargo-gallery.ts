import type { FoxholeItemCatalog, FoxholeStructureCatalog } from './catalog.ts';
import {
    hasFoxholeHoldProfileItemSelection,
    resolveFoxholeHoldProfileItemOptions,
} from './hold-profile.ts';
import { createFoxholeProductionSlotVariantKey } from './production/index.ts';
import { resolveFoxholeProductionOverlayOutputs } from './production/overlay-outputs.ts';
import type { FoxholeProductionIndex } from './production/types.ts';
import type { FoxholeStructureProductionOrder } from './types.ts';

export interface FoxholeDebugProductionCargoSelection {
    markedItemCodenames: string[];
    productionOrders: FoxholeStructureProductionOrder[];
}

/** Seed only options that actually produce a visible tile on this placed structure. */
export function resolveFoxholeDebugProductionCargoSelection(options: {
    foxholeKey: string;
    modificationVariantIds?: Readonly<Record<string, string>>;
    structureCatalog: FoxholeStructureCatalog;
    itemCatalog: FoxholeItemCatalog;
    productionIndex: FoxholeProductionIndex;
}): FoxholeDebugProductionCargoSelection | null {
    const { structureCatalog, itemCatalog, productionIndex } = options;
    const structure = structureCatalog.structureByKey[options.foxholeKey];
    if (!structure) {
        return null;
    }

    const holdProfile = structure.holdProfile;
    const cargoOptions = holdProfile && hasFoxholeHoldProfileItemSelection(holdProfile)
        ? resolveFoxholeHoldProfileItemOptions(holdProfile, itemCatalog, (item, codename) => item?.name ?? codename)
        : [];
    const cargo = cargoOptions.find(option => option.item?.iconUrl) ?? cargoOptions[0];

    const modificationRecipeIds = Object.entries(options.modificationVariantIds ?? {}).flatMap(([slotId, variantId]) => (
        productionIndex.modificationRecipeIdsBySlotVariantKey[
            createFoxholeProductionSlotVariantKey(structure.id, slotId, variantId)
        ] ?? []
    ));
    const directRecipeIds = productionIndex.structureRecipeIdsByStructureId[structure.id] ?? [];
    const recipes = [...new Set([...modificationRecipeIds, ...directRecipeIds])]
        .flatMap(recipeId => {
            const recipe = productionIndex.recipeById[recipeId];
            if (!recipe) {
                return [];
            }
            const powerDelta = structureCatalog.structureByKey[recipe.sourceStructureId]?.powerGridInfo?.powerDelta;
            const outputCount = resolveFoxholeProductionOverlayOutputs(recipe, powerDelta).length;
            return outputCount > 0 ? [{ recipe, outputCount }] : [];
        })
        .sort((left, right) => {
            const leftModification = left.recipe.sourceType === 'modification' ? 1 : 0;
            const rightModification = right.recipe.sourceType === 'modification' ? 1 : 0;
            return rightModification - leftModification
                || right.outputCount - left.outputCount
                || left.recipe.id.localeCompare(right.recipe.id);
        });
    const recipe = recipes[0]?.recipe;
    if (!cargo && !recipe) {
        return null;
    }

    return {
        markedItemCodenames: cargo ? [cargo.codename] : [],
        productionOrders: recipe ? [{ recipeId: recipe.id, parent: false, cycles: null, label: null }] : [],
    };
}
