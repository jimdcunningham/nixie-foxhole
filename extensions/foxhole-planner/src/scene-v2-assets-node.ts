import de from '../../../packages/extensions/foxhole/public/foxhole/assets/localizations/de.json' with { type: 'json' };
import fr from '../../../packages/extensions/foxhole/public/foxhole/assets/localizations/fr.json' with { type: 'json' };
import pt from '../../../packages/extensions/foxhole/public/foxhole/assets/localizations/pt.json' with { type: 'json' };
import ru from '../../../packages/extensions/foxhole/public/foxhole/assets/localizations/ru.json' with { type: 'json' };
import zh from '../../../packages/extensions/foxhole/public/foxhole/assets/localizations/zh.json' with { type: 'json' };
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

export const catalogLocalizations: Record<string, Record<string, string>> = { de, fr, pt, ru, zh };
