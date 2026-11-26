import {assets, data} from '../build/catalog-node.ts';
export const {productionOutputsByRecipeId, productionRecipesById, bunkerDestructionWeapons, catalogLocalizations} = data;
export async function readCatalogLocale(locale: string): Promise<Record<string, string> | undefined> {
    return catalogLocalizations?.[locale];
}
export const modelLightHintsByResourceId = data.modelLightHintsByResourceId;
export default assets;

export const flagAtlasesByResourceId = data.flagAtlasesByResourceId;
