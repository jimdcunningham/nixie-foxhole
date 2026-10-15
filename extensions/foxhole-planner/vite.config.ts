import { copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import sharp from 'sharp';
import { readBrowserAtlasImage } from './build/browser-atlas-images.ts';
import type { createFoxholeSceneV2AssetMetadata } from './src/scene-v2-asset-metadata.ts';
import type { createFoxholeSceneV2MapMetadata } from './src/scene-v2-map-metadata.ts';
import { bindFoxholeSceneV2Models, getFoxholeSceneV2PackagedModelPath, selectFoxholeSceneV2ModelBuild } from './src/scene-v2-models.ts';
import { publishCompletedBuild } from './build/completed-build-publisher.ts';
import { createResourceBuildSnapshot } from './build/resource-build-snapshot.ts';
import { bindFoxholeModelLayerNodes } from './src/model-layer-nodes.ts';

const virtualFoxholeSceneV2AssetsId = '#foxhole-scene-v2-assets';
const resolvedVirtualFoxholeSceneV2AssetsId = `\0${virtualFoxholeSceneV2AssetsId}`;
const virtualFoxholeMapId = '#foxhole-scene-v2-maps';
const resolvedVirtualFoxholeMapId = `\0${virtualFoxholeMapId}`;
const configuredFoxholeAssetsRoot = process.env.NIXIE_FOXHOLE_ASSETS_ROOT?.trim();
const foxholeAssetsRoot = configuredFoxholeAssetsRoot
  ? resolve(configuredFoxholeAssetsRoot)
  : fileURLToPath(new URL(
    '../../packages/extensions/foxhole/public/foxhole/assets/',
    import.meta.url,
  ));
const foxholeManifestPath = resolve(foxholeAssetsRoot, 'manifest.v1.json');
const foxholeMapDataPath = resolve(foxholeAssetsRoot, 'maps/map-data.v1.json');
const metadataModuleUrl = new URL('./src/scene-v2-asset-metadata.ts', import.meta.url);
interface PublishedFoxholeAsset {
  id: string;
  isItem?: boolean;
  icons?: { default?: string; };
  sprite?: {
    width?: number;
    height?: number;
    offsetX?: number;
    offsetY?: number;
  };
}

interface PublishedFoxholeManifest {
  shared?: {
    modifications?: Record<string, unknown>;
  };
  assets?: PublishedFoxholeAsset[];
}

interface SceneV2AssetSource {
  id: string;
  iconPath: string | null;
  texturePath: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

interface SceneV2ModificationSource {
  id: string;
  sourcePath: string;
}

interface SceneV2VisualSource {
  id: string;
  sourcePath: string;
}

interface SceneV2ResourceSources {
  models: Array<{ id: string; assetId: string; path: string; }>;
  browserImageSources: string[];
  assets: SceneV2AssetSource[];
  metadata: ReturnType<typeof createFoxholeSceneV2AssetMetadata>['assets'];
  productionOutputsByRecipeId: ReturnType<typeof createFoxholeSceneV2AssetMetadata>['productionOutputsByRecipeId'];
  productionRecipesById: ReturnType<typeof createFoxholeSceneV2AssetMetadata>['productionRecipesById'];
  bunkerDestructionWeapons: ReturnType<typeof createFoxholeSceneV2AssetMetadata>['bunkerDestructionWeapons'];
  modifications: SceneV2ModificationSource[];
  visuals: SceneV2VisualSource[];
  maps: ReturnType<typeof createFoxholeSceneV2MapMetadata>;
}

async function readSceneV2AssetSources(): Promise<SceneV2ResourceSources> {
  const manifest = JSON.parse(await readFile(foxholeManifestPath, 'utf8')) as PublishedFoxholeManifest;
  // Rollup watch invalidates the virtual module, but does not reload imports
  // captured by its config. Reload the pure generators when their source changes.
  const metadataSource = await readFile(metadataModuleUrl, 'utf8');
  const version = createHash('sha256').update(metadataSource).digest('hex');
  const { createFoxholeSceneV2AssetMetadata } = await import(`${metadataModuleUrl.href}?version=${version}`) as typeof import('./src/scene-v2-asset-metadata.ts');
  const mapModuleUrl = new URL('./src/scene-v2-map-metadata.ts', import.meta.url);
  const mapVersion = createHash('sha256').update(await readFile(mapModuleUrl, 'utf8')).digest('hex');
  const { createFoxholeSceneV2MapMetadata, createFoxholeMapTooltipAssets } = await import(`${mapModuleUrl.href}?version=${mapVersion}`) as typeof import('./src/scene-v2-map-metadata.ts');
  const generated = createFoxholeSceneV2AssetMetadata(
    manifest as unknown as Parameters<typeof createFoxholeSceneV2AssetMetadata>[0],
  );
  let models: SceneV2ResourceSources['models'] = [];
  try {
    models = bindFoxholeSceneV2Models(generated.assets, JSON.parse(await readFile(resolve(foxholeAssetsRoot, 'models/manifest.v1.json'), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  let selection = process.env.NIXIE_FOXHOLE_MODEL_IDS;
  if (selection === undefined) {
    try { selection = (await readFile(new URL('./.model-build-selection', import.meta.url), 'utf8')).trim(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  selection = selection?.trim() || undefined;
  models = selectFoxholeSceneV2ModelBuild(generated.assets, models, selection);
  for (const model of models) {
    const asset = generated.assets[model.assetId];
    if (asset?.model && /^Foundation/i.test(asset.codeName) && model.id === model.assetId) {
      bindFoxholeModelLayerNodes(asset, await readFile(resolve(foxholeAssetsRoot, model.path)));
    }
  }
  const assets = (manifest.assets ?? []).map(asset => {
    const iconUrl = asset.icons?.default;
    const sprite = asset.sprite;
    if (typeof iconUrl !== 'string'
        || !iconUrl.startsWith('/foxhole/assets/')
        || !iconUrl.endsWith(`/${asset.id}.icon.default.webp`)
        || typeof sprite?.width !== 'number'
        || typeof sprite.height !== 'number') {
      throw new Error(`Foxhole Scene V2 asset metadata is incomplete: ${asset.id}`);
    }
    const iconPath = resolve(foxholeAssetsRoot, iconUrl.slice('/foxhole/assets/'.length));
    return {
      id: asset.id,
      iconPath: asset.isItem === true || asset.id === 'facilityfactoryammo' ? iconPath : null,
      texturePath: iconPath.replace(/\.icon\.default\.webp$/u, '.texture.webp'),
      width: sprite.width / 2,
      height: sprite.height / 2,
      x: (sprite.offsetX ?? 0) / 2,
      y: (sprite.offsetY ?? 0) / 2,
    };
  });
  return {
    models,
    browserImageSources: generated.browserImageSources,
    assets,
    metadata: generated.assets,
    productionOutputsByRecipeId: generated.productionOutputsByRecipeId,
    productionRecipesById: generated.productionRecipesById,
    bunkerDestructionWeapons: generated.bunkerDestructionWeapons,
    modifications: generated.modificationResources.map(resource => ({
      id: resource.id,
      sourcePath: resolve(foxholeAssetsRoot, resource.sourceUrl.slice('/foxhole/assets/'.length)),
    })),
    visuals: generated.visualResources.map(resource => ({
      id: resource.id,
      sourcePath: resolve(foxholeAssetsRoot, resource.sourceUrl.slice('/foxhole/assets/'.length)),
    })),
    maps: createFoxholeSceneV2MapMetadata(JSON.parse(await readFile(foxholeMapDataPath, 'utf8')), createFoxholeMapTooltipAssets(manifest, generated.assets)),
  };
}

function foxholeSceneV2ResourcesPlugin() {
  const sources = createResourceBuildSnapshot(readSceneV2AssetSources);
  let updatedManifest = '';
  const extensionRoot = resolve(fileURLToPath(new URL('./', import.meta.url)));
  const buildingMarker = resolve(extensionRoot, '.nixie-building');
  const getSources = sources.read;
  return {
    name: 'nixie-foxhole-scene-v2-resources',
    apply: 'build',
    enforce: 'pre',
    async buildStart() {
      await writeFile(buildingMarker, 'Building extension output\n');
      // Keep declarations aligned with the filtered generated input, including future allowed exports.
      const manifestPath = fileURLToPath(new URL('./nixie.extension.json', import.meta.url));
      const original = await readFile(manifestPath, 'utf8');
      const declaration = JSON.parse(original);
      const models = (await sources.begin()).models;
      declaration.contributes.experimentalResources = [
        ...declaration.contributes.experimentalResources.filter((resource: { id: string; kind: string; }) =>
          resource.kind !== 'model' || !resource.id.startsWith('foxhole.model.')),
        ...models.map(model => ({ contractVersion: 1, id: `foxhole.model.${model.id}`, kind: 'model',
          path: `dist/assets/scene-v2/${getFoxholeSceneV2PackagedModelPath(model)}` })),
      ];
      updatedManifest = `${JSON.stringify(declaration)}\n`;
      this.addWatchFile(foxholeManifestPath);
      this.addWatchFile(resolve(foxholeAssetsRoot, 'models/manifest.v1.json'));
      this.addWatchFile(fileURLToPath(new URL('./src/scene-v2-models.ts', import.meta.url)));
      this.addWatchFile(fileURLToPath(new URL('./src/scene-v2-model-policy.json', import.meta.url)));
      this.addWatchFile(foxholeMapDataPath);
      this.addWatchFile(fileURLToPath(new URL('./src/scene-v2-map-metadata.ts', import.meta.url)));
      this.addWatchFile(fileURLToPath(new URL('./src/scene-v2-asset-metadata.ts', import.meta.url)));
    },
    async buildEnd(error) {
      if (!error) return;
      await unlink(buildingMarker).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
      });
    },
    shouldTransformCachedModule({ id }) {
      return id === resolvedVirtualFoxholeSceneV2AssetsId || id === resolvedVirtualFoxholeMapId;
    },
    resolveId(id) {
      if (id === virtualFoxholeMapId) {
        return resolvedVirtualFoxholeMapId;
      }
      return id === virtualFoxholeSceneV2AssetsId
        ? resolvedVirtualFoxholeSceneV2AssetsId
        : null;
    },
    async load(id) {
      if (id === resolvedVirtualFoxholeMapId) {
        return `export default ${JSON.stringify((await getSources()).maps.metadata)};`;
      }
      if (id !== resolvedVirtualFoxholeSceneV2AssetsId) {
        return null;
      }
      const sources = await getSources();
      return `export const productionOutputsByRecipeId=${JSON.stringify(sources.productionOutputsByRecipeId)};export const productionRecipesById=${JSON.stringify(sources.productionRecipesById)};export const bunkerDestructionWeapons=${JSON.stringify(sources.bunkerDestructionWeapons)};export default ${JSON.stringify(sources.metadata)};`;
    },
    async writeBundle(options) {
      const outputRoot = resolve(String(options.dir ?? 'dist'), 'assets/scene-v2');
      await mkdir(outputRoot, { recursive: true });
      const sources = await getSources();
      // Group each catalog asset's render resources together so model growth remains inspectable.
      const assetsRoot = resolve(outputRoot, 'assets');
      await rm(assetsRoot, { recursive: true, force: true });
      await mkdir(assetsRoot, { recursive: true });
      for (const model of sources.models) {
        const destination = resolve(outputRoot, getFoxholeSceneV2PackagedModelPath(model));
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(resolve(foxholeAssetsRoot, model.path), destination);
      }
      const browserRoot = resolve(outputRoot, 'browser');
      await mkdir(browserRoot, { recursive: true });
      for (let start = 0; start < sources.browserImageSources.length; start += 64) {
        const images = await Promise.all(sources.browserImageSources.slice(start, start + 64).map(source =>
          readBrowserAtlasImage(resolve(foxholeAssetsRoot, source.slice('/foxhole/assets/'.length)))));
        const pixels = Buffer.alloc(2048 * 2048 * 4);
        for (const [index, image] of images.entries()) {
          for (let row = 0; row < 256; row++) {
            image.copy(pixels, ((Math.floor(index / 8) * 256 + row) * 2048 + (index % 8) * 256) * 4, row * 256 * 4, (row + 1) * 256 * 4);
          }
        }
        await sharp(pixels, { raw: { width: 2048, height: 2048, channels: 4 } }).webp({ lossless: true, effort: 6 })
          .toFile(resolve(browserRoot, `${Math.floor(start / 64)}.webp`));
      }
      for (let start = 0; start < sources.assets.length; start += 64) {
        await Promise.all(sources.assets.slice(start, start + 64).map(async asset => {
          const assetRoot = resolve(assetsRoot, asset.id);
          await mkdir(assetRoot, { recursive: true });
          await Promise.all([
            copyFile(asset.texturePath, resolve(assetRoot, 'texture.webp')),
            ...(asset.iconPath
              ? [copyFile(asset.iconPath, resolve(assetRoot, 'icon.webp'))]
              : []),
          ]);
        }));
      }
      const modificationsRoot = resolve(outputRoot, 'shared/modifications');
      await mkdir(modificationsRoot, { recursive: true });
      for (let start = 0; start < sources.modifications.length; start += 64) {
        await Promise.all(sources.modifications.slice(start, start + 64).map(resource => (
          copyFile(resource.sourcePath, resolve(modificationsRoot, `${resource.id}.webp`))
        )));
      }
      const visualsRoot = resolve(outputRoot, 'shared/visuals');
      await mkdir(visualsRoot, { recursive: true });
      for (let start = 0; start < sources.visuals.length; start += 64) {
        await Promise.all(sources.visuals.slice(start, start + 64).map(resource => (
          copyFile(resource.sourcePath, resolve(visualsRoot, `${resource.id}.webp`))
        )));
      }
      const mapsRoot = resolve(String(options.dir ?? 'dist'), 'assets/maps');
      await mkdir(mapsRoot, { recursive: true });
      await writeFile(resolve(mapsRoot, 'metadata.json'), JSON.stringify(sources.maps.metadata));
      for (let start = 0; start < sources.maps.resources.length; start += 64) {
        await Promise.all(sources.maps.resources.slice(start, start + 64).map(resource =>
          copyFile(resolve(foxholeAssetsRoot, resource.sourcePath), resolve(mapsRoot, resource.path.split('/').at(-1)!))));
      }
      // Publish a completed build once. Discovery must never hash an asset copy in progress.
      const staging = resolve(String(options.dir));
      const published = resolve(extensionRoot, 'dist');
      const previous = resolve(extensionRoot, '.nixie-previous');
      if (staging !== resolve(extensionRoot, '.nixie-build') || ![staging, published, previous].every(path => dirname(path) === extensionRoot)) {
        throw new Error('Unexpected extension staging directory.');
      }
      await publishCompletedBuild(staging, published, previous, this.meta.watchMode);
      const manifestPath = resolve(extensionRoot, 'nixie.extension.json');
      if (await readFile(manifestPath, 'utf8') !== updatedManifest) {
        await writeFile(manifestPath, updatedManifest);
      }
      await unlink(buildingMarker);
      await rm(previous, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  base: './',
  build: { outDir: '.nixie-build' },
  plugins: [foxholeSceneV2ResourcesPlugin()],
});
