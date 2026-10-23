import { copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { createBrowserAtlas } from './build/browser-atlas-images.ts';
import type { createFoxholeSceneV2AssetMetadata } from './src/scene-v2-asset-metadata.ts';
import type { createFoxholeSceneV2MapMetadata } from './src/scene-v2-map-metadata.ts';
import type { FoxholeSceneV2ModelSource } from './src/scene-v2-models.ts';
import { publishCompletedBuild } from './build/completed-build-publisher.ts';
import { createResourceBuildSnapshot } from './build/resource-build-snapshot.ts';
import { bindFoxholeModelLayerNodes } from './src/model-layer-nodes.ts';
import { applyPublishedModelLayers, type PublishedModelLayers } from './build/model-layer-metadata.ts';

import assetReleasePin from './src/asset-release-pin.json' with { type: 'json' };
import { loadFoxholeAssetRelease, readPinnedAssetJson } from './src/asset-release.ts';
const remoteResourcePack = 'resourcePack' in assetReleasePin && process.env.NIXIE_FOXHOLE_ASSET_MODE !== 'bundled'
  ? assetReleasePin.resourcePack as import('@nixie/extension-sdk').NixieExperimentalAssetPackV1 : null;

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
  models: Array<FoxholeSceneV2ModelSource & { packagedPath: string; }>;
  browserImageSources: string[];
  assets: SceneV2AssetSource[];
  catalogLocalizations: Record<string, Record<string, string>>;
  metadata: ReturnType<typeof createFoxholeSceneV2AssetMetadata>['assets'];
  productionOutputsByRecipeId: ReturnType<typeof createFoxholeSceneV2AssetMetadata>['productionOutputsByRecipeId'];
  productionRecipesById: ReturnType<typeof createFoxholeSceneV2AssetMetadata>['productionRecipesById'];
  bunkerDestructionWeapons: ReturnType<typeof createFoxholeSceneV2AssetMetadata>['bunkerDestructionWeapons'];
  modifications: SceneV2ModificationSource[];
  visuals: SceneV2VisualSource[];
  maps: ReturnType<typeof createFoxholeSceneV2MapMetadata>;
}

/** Reload model binding code with each source revision and freeze its destination paths in the build snapshot. */
export async function readSceneV2ModelSources(
  assets: Parameters<typeof import('./src/scene-v2-models.ts')['bindFoxholeSceneV2Models']>[0],
  manifest: Parameters<typeof import('./src/scene-v2-models.ts')['bindFoxholeSceneV2Models']>[1] | undefined,
  selection?: string,
  moduleUrl = new URL('./src/scene-v2-models.ts', import.meta.url),
): Promise<SceneV2ResourceSources['models']> {
  const version = createHash('sha256').update(await readFile(moduleUrl, 'utf8')).digest('hex');
  const { bindFoxholeSceneV2Models, getFoxholeSceneV2PackagedModelPath, selectFoxholeSceneV2ModelBuild } =
    await import(`${moduleUrl.href}?version=${version}`) as typeof import('./src/scene-v2-models.ts');
  const models = manifest ? bindFoxholeSceneV2Models(assets, manifest) : [];
  return selectFoxholeSceneV2ModelBuild(assets, models, selection)
    .map(model => ({ ...model, packagedPath: getFoxholeSceneV2PackagedModelPath(model) }));
}

export async function readSceneV2AssetSources(options: { deriveModelLayers?: boolean; } = {}): Promise<SceneV2ResourceSources> {
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
  let modelManifest: Parameters<typeof import('./src/scene-v2-models.ts')['bindFoxholeSceneV2Models']>[1] | undefined;
  try {
    modelManifest = JSON.parse(await readFile(resolve(foxholeAssetsRoot, 'models/manifest.v1.json'), 'utf8'));
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
  const models = await readSceneV2ModelSources(generated.assets, modelManifest, selection);
  const publishedLayers = remoteResourcePack && !options.deriveModelLayers
    ? await readPinnedAssetJson<PublishedModelLayers>(assetReleasePin.buildMetadata) : null;
  const extractorSource = await readFile(new URL('./src/model-layer-nodes.ts', import.meta.url), 'utf8');
  for (const model of models) {
    const asset = generated.assets[model.assetId];
    if (asset?.model && /^Foundation/i.test(asset.codeName) && model.id === model.assetId) {
      if (publishedLayers) applyPublishedModelLayers(asset, model.assetId, model.path, publishedLayers,
        { publicationSha256: assetReleasePin.publication.sha256, extractorSource });
      else bindFoxholeModelLayerNodes(asset, await readFile(resolve(foxholeAssetsRoot, model.path)));
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
    catalogLocalizations: Object.fromEntries(await Promise.all(['de', 'fr', 'pt', 'ru', 'zh'].map(async locale => [locale, JSON.parse(await readFile(resolve(foxholeAssetsRoot, `localizations/${locale}.json`), 'utf8'))]))),
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

export function sceneV2RemoteResourceBindings(sources: SceneV2ResourceSources) {
  const source = (path: string) => relative(foxholeAssetsRoot, path).split(sep).join('/');
  const prefix = 'dist/assets/scene-v2/';
  return [
    ...sources.models.map(model => ({ path: prefix + model.packagedPath, source: model.path })),
    ...sources.browserImageSources.flatMap((_, index) => index % 64 ? [] : [{ path: prefix + 'browser/' + index / 64 + '.webp', source: '__planner/browser/' + index / 64 + '.webp' }]),
    ...sources.assets.flatMap(asset => [
      { path: prefix + 'assets/' + asset.id + '/texture.webp', source: source(asset.texturePath) },
      ...(asset.iconPath ? [{ path: prefix + 'assets/' + asset.id + '/icon.webp', source: source(asset.iconPath) }] : []),
    ]),
    ...sources.modifications.map(row => ({ path: prefix + 'shared/modifications/' + row.id + '.webp', source: source(row.sourcePath) })),
    ...sources.visuals.map(row => ({ path: prefix + 'shared/visuals/' + row.id + '.webp', source: source(row.sourcePath) })),
    ...sources.maps.resources.map(row => ({ path: row.path, source: row.sourcePath })),
  ];
}

function foxholeSceneV2ResourcesPlugin(): Plugin {
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
          path: `dist/assets/scene-v2/${model.packagedPath}`, ...(remoteResourcePack ? { assetPack: remoteResourcePack.id } : {}) })),
      ];
      if (remoteResourcePack) {
        const library = await loadFoxholeAssetRelease(assetReleasePin.publication);
        // Generated metadata compiled into the extension must describe the pinned bytes.
        for (const path of ['manifest.v1.json', 'models/manifest.v1.json', 'maps/map-data.v1.json',
          ...['de', 'fr', 'pt', 'ru', 'zh'].map(locale => `localizations/${locale}.json`)]) {
          const bytes = await readFile(resolve(foxholeAssetsRoot, path));
          const entry = library.files.get(path)?.entry;
          if (!entry || bytes.length !== entry.byteLength || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
            throw new Error('Local build metadata differs from the pinned publication: ' + path + '. Publish the updated library before building.');
          }
        }
        const index = await readPinnedAssetJson<{ assets: Array<{ path: string; }>; }>(remoteResourcePack.manifest);
        const indexed = new Set(index.assets.map(row => row.path));
        for (const binding of sceneV2RemoteResourceBindings(await getSources())) {
          if (!indexed.has(binding.path)) throw new Error('Rebuild the remote resource index for ' + binding.path);
        }
        declaration.capabilities = [...new Set([...declaration.capabilities, 'resources.remote'])];
        declaration.contributes.experimentalAssetPacks = [remoteResourcePack];
        declaration.contributes.experimentalResourceTemplates = declaration.contributes.experimentalResourceTemplates.map((row: { idPrefix: string; }) =>
          ({ ...row, assetPack: remoteResourcePack.id }));
      }
      if (!remoteResourcePack) {
        delete declaration.contributes.experimentalAssetPacks;
        declaration.contributes.experimentalResourceTemplates = declaration.contributes.experimentalResourceTemplates.map(({ assetPack, ...row }: { assetPack?: string; }) => row);
      }
      updatedManifest = `${JSON.stringify(declaration)}\n`;
      this.addWatchFile(foxholeManifestPath);
        for (const locale of ['de', 'fr', 'pt', 'ru', 'zh']) this.addWatchFile(resolve(foxholeAssetsRoot, `localizations/${locale}.json`));
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
      return `export const catalogLocalizations=${JSON.stringify(sources.catalogLocalizations)};export const productionOutputsByRecipeId=${JSON.stringify(sources.productionOutputsByRecipeId)};export const productionRecipesById=${JSON.stringify(sources.productionRecipesById)};export const bunkerDestructionWeapons=${JSON.stringify(sources.bunkerDestructionWeapons)};export default ${JSON.stringify(sources.metadata)};`;
    },
    async writeBundle(options) {
      const outputRoot = resolve(String(options.dir ?? 'dist'), 'assets/scene-v2');
      await mkdir(outputRoot, { recursive: true });
      const sources = await getSources();
      // Group each catalog asset's render resources together so model growth remains inspectable.
      const assetsRoot = resolve(outputRoot, 'assets');
      await rm(assetsRoot, { recursive: true, force: true });
      await mkdir(assetsRoot, { recursive: true });
      for (const model of remoteResourcePack ? [] : sources.models) {
        const destination = resolve(outputRoot, model.packagedPath);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(resolve(foxholeAssetsRoot, model.path), destination);
      }
      const browserRoot = resolve(outputRoot, 'browser');
      await mkdir(browserRoot, { recursive: true });
      for (let start = 0; !remoteResourcePack && start < sources.browserImageSources.length; start += 64) {
        const atlas = await createBrowserAtlas(sources.browserImageSources.slice(start, start + 64).map(source => resolve(foxholeAssetsRoot, source.slice('/foxhole/assets/'.length))));
        await writeFile(resolve(browserRoot, `${Math.floor(start / 64)}.webp`), atlas);
      }
      for (let start = 0; !remoteResourcePack && start < sources.assets.length; start += 64) {
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
      for (let start = 0; !remoteResourcePack && start < sources.modifications.length; start += 64) {
        await Promise.all(sources.modifications.slice(start, start + 64).map(resource => (
          copyFile(resource.sourcePath, resolve(modificationsRoot, `${resource.id}.webp`))
        )));
      }
      const visualsRoot = resolve(outputRoot, 'shared/visuals');
      await mkdir(visualsRoot, { recursive: true });
      for (let start = 0; !remoteResourcePack && start < sources.visuals.length; start += 64) {
        await Promise.all(sources.visuals.slice(start, start + 64).map(resource => (
          copyFile(resource.sourcePath, resolve(visualsRoot, `${resource.id}.webp`))
        )));
      }
      const mapsRoot = resolve(String(options.dir ?? 'dist'), 'assets/maps');
      await mkdir(mapsRoot, { recursive: true });
      await writeFile(resolve(mapsRoot, 'metadata.json'), JSON.stringify(sources.maps.metadata));
      for (let start = 0; !remoteResourcePack && start < sources.maps.resources.length; start += 64) {
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
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: './',
  build: { outDir: '.nixie-build' },
  plugins: [foxholeSceneV2ResourcesPlugin()],
});
