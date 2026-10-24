import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseNixieExperimentalProductCatalogV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
import type {FoxholeSceneV2AssetMetadata} from '../src/scene-v2-asset-metadata.ts';
import type {FoxholeSceneV2MapMetadata} from '../src/scene-v2-map-metadata.ts';
import type {createFoxholeSceneV2AssetMetadata} from '../src/scene-v2-asset-metadata.ts';
type Generated = ReturnType<typeof createFoxholeSceneV2AssetMetadata>;
const input = process.env.NIXIE_FOXHOLE_CATALOG_FILE?.trim() || resolve(process.env.NIXIE_FOXHOLE_ASSETS_ROOT?.trim()
    || fileURLToPath(new URL('../../../packages/extensions/foxhole/public/foxhole/assets/', import.meta.url)), 'catalog.v1.json');
const bytes = readFileSync(input);
if (bytes.length > 16 * 1024 * 1024) throw new Error('Catalog input exceeds 16 MiB');
export const catalog = parseNixieExperimentalProductCatalogV1(JSON.parse(bytes.toString('utf8')));
export const assets = Object.fromEntries(catalog.products.map(product => [product.id, product.data])) as Record<string, FoxholeSceneV2AssetMetadata>;
export const data = catalog.data as {catalogLocalizations: Record<string, Record<string, string>>;
    productionOutputsByRecipeId: Generated['productionOutputsByRecipeId']; productionRecipesById: Generated['productionRecipesById'];
    bunkerDestructionWeapons: Generated['bunkerDestructionWeapons']; maps: FoxholeSceneV2MapMetadata};
