import published from '../../../packages/extensions/foxhole/public/foxhole/assets/maps/map-data.v1.json' with { type: 'json' };
import { createFoxholeSceneV2MapMetadata } from './scene-v2-map-metadata.ts';
import { foxholeMapTooltipAssets } from './scene-v2-assets-node.ts';

const generated = createFoxholeSceneV2MapMetadata(published, foxholeMapTooltipAssets);
export const foxholeMapResources = generated.resources;
export default generated.metadata;
