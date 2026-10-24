import fs from 'node:fs/promises';
import path from 'node:path';
import {createFoxholeSceneV2AssetMetadata} from './product-metadata.ts';
import {createFoxholeSceneV2MapMetadata, createFoxholeMapTooltipAssets} from './map-metadata.ts';
import {bindFoxholeSceneV2Models} from '../../../extensions/foxhole-planner/src/scene-v2-models.ts';
import {bindFoxholeModelLayerNodes} from './model-layer-nodes.ts';

/** All extraction interpretation happens before Planner builds or clients run. */
export async function readCatalogSources(assetsRoot) {
    const read = async name => JSON.parse(await fs.readFile(path.join(assetsRoot, name), 'utf8'));
    const manifest = await read('manifest.v1.json');
    const generated = createFoxholeSceneV2AssetMetadata(manifest);
    const models = bindFoxholeSceneV2Models(generated.assets, await read('models/manifest.v1.json'));
    for (const model of models) {
        const asset = generated.assets[model.assetId];
        if (asset?.model && /^Foundation/i.test(asset.codeName) && model.id === model.assetId) {
            bindFoxholeModelLayerNodes(asset, await fs.readFile(path.join(assetsRoot, model.path)));
        }
    }
    const source = url => {
        if (typeof url !== 'string' || !url.startsWith('/foxhole/assets/')) throw Error('Catalog media needs a generated local path');
        return url.slice('/foxhole/assets/'.length);
    };
    const assets = manifest.assets.map(asset => {
        const icon = source(asset.icons?.default);
        if (!icon.endsWith('/' + asset.id + '.icon.default.webp') || !icon.startsWith('types/')) throw Error('Unexpected icon convention: ' + asset.id);
        return {id: asset.id, assetGroup: icon.split('/')[1], icon, texture: icon.replace(/\.icon\.default\.webp$/, '.texture.webp')};
    });
    const maps = createFoxholeSceneV2MapMetadata(await read('maps/map-data.v1.json'), createFoxholeMapTooltipAssets(manifest, generated.assets));
    return {assets, models, buildInputs: ['manifest.v1.json', 'models/manifest.v1.json', 'maps/map-data.v1.json',
            ...['de','fr','pt','ru','zh'].map(locale => 'localizations/' + locale + '.json')],
        browserImageSources: generated.browserImageSources.map(source),
        modifications: generated.modificationResources.map(row => ({id: row.id, sourcePath: source(row.sourceUrl)})),
        visuals: generated.visualResources.map(row => ({id: row.id, sourcePath: source(row.sourceUrl)})), maps,
        metadata: generated.assets,
        data: {catalogLocalizations: Object.fromEntries(await Promise.all(['de','fr','pt','ru','zh'].map(async locale => [locale, await read('localizations/' + locale + '.json')]))),
            productionOutputsByRecipeId: generated.productionOutputsByRecipeId, productionRecipesById: generated.productionRecipesById,
            bunkerDestructionWeapons: generated.bunkerDestructionWeapons, maps: maps.metadata}};
}
