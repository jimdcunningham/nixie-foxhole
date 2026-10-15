import manifest from '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import modelBundle from '../../../packages/extensions/foxhole/public/foxhole/assets/models/manifest.v1.json' with { type: 'json' };
import { createFoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { createFoxholeMapTooltipAssets } from './scene-v2-map-metadata.ts';
import { bindFoxholeSceneV2Models } from './scene-v2-models.ts';

const generated = createFoxholeSceneV2AssetMetadata(
    manifest as unknown as Parameters<typeof createFoxholeSceneV2AssetMetadata>[0],
);
bindFoxholeSceneV2Models(generated.assets, modelBundle);

export const productionOutputsByRecipeId = generated.productionOutputsByRecipeId;
export const productionRecipesById = generated.productionRecipesById;
export const bunkerDestructionWeapons = generated.bunkerDestructionWeapons;
export const foxholeMapTooltipAssets = createFoxholeMapTooltipAssets(manifest, generated.assets);
export default generated.assets;
