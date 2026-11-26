import {copyFile, readFile, writeFile, mkdir, unlink} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, normalizePath, type Plugin} from 'vite';
import {parseNixieExtensionManifestV1} from '@nixiejs/extension-sdk';
import {parseNixieProductCatalogV1, parseNixieProductProviderV1, parseNixieResourceV1} from '@nixiejs/extension-sdk/scene-v2';
import {verifyCatalogInput, readCatalogPin, catalogInputPath, catalogPinPath} from './build/prepare-catalog-input.mjs';
import {buildRuntimeCatalog} from './build/runtime-catalog.mjs';
import {createCatalogRuntimeManifest} from './build/catalog-runtime-manifest.ts';
import {publishCompletedBuild} from './build/completed-build-publisher.ts';
import {readLocalAssetCatalog} from './build/local-asset-catalog.ts';

const extensionRoot = fileURLToPath(new URL('./', import.meta.url));
const inputFile = catalogInputPath();
const ASSETS = '#foxhole-scene-v2-assets', MAPS = '#foxhole-scene-v2-maps';
const catalogKeys = normalizePath(fileURLToPath(new URL('./src/catalog-keys.mjs', import.meta.url)));
const catalogSource = normalizePath(fileURLToPath(new URL('./src/runtime-catalog-source.ts', import.meta.url)));
function catalogPlugin(development: boolean): Plugin {
    let runtime: ReturnType<typeof buildRuntimeCatalog>, manifest: string;
    let localFiles: ReadonlyMap<string, Buffer> | undefined;
    let flacAudio: string[] = [];
    const marker = resolve(extensionRoot, '.nixie-building');
    return {
        name: 'foxwatch-packaged-catalog', enforce: 'pre',
        async buildStart() {
            await writeFile(marker, 'Building extension output\n');
            const pin = await readCatalogPin();
            const authored = parseNixieExtensionManifestV1(JSON.parse(await readFile(new URL('./nixie.extension.json', import.meta.url), 'utf8')));
            flacAudio = [];
            const audio = authored.contributes.resources.filter(resource => resource.kind === 'audio' && resource.path.endsWith('.wav'));
            if (audio.length) {
                // Independent builds with the older SDK keep using the WAV masters.
                let supportsFlac = false;
                try {
                    parseNixieResourceV1({...audio[0], path: audio[0]!.path.replace(/\.wav$/, '.flac')});
                    supportsFlac = true;
                } catch { /* Older SDKs reject the FLAC extension. */ }
                if (supportsFlac) {
                    for (const resource of audio) {
                        const filename = resource.path.split('/').at(-1)!.replace(/\.wav$/, '.flac');
                        resource.path = 'dist/audio/' + filename;
                        flacAudio.push(filename);
                        this.addWatchFile(resolve(extensionRoot, 'audio-flac', filename));
                    }
                }
            }
            const local = development || this.meta.watchMode ? await readLocalAssetCatalog(
                resolve(extensionRoot, '.tmp/local-asset-catalog'), authored, pin.baseUrl, path => this.addWatchFile(path)) : null;
            localFiles = local?.files;
            let generated = local?.manifest;
            const raw = local?.bytes ?? await readFile(inputFile);
            if (!local) verifyCatalogInput(raw, pin.catalog);
            runtime = buildRuntimeCatalog(raw);
            if (!generated) {
                const catalog = parseNixieProductCatalogV1(JSON.parse(raw.toString('utf8')));
                if (catalog.releaseRoot && new URL(catalog.releaseRoot + 'catalog.v1.json', pin.baseUrl).href !== pin.catalog.url) throw new Error('Catalog differs from its pinned asset release.');
                generated = createCatalogRuntimeManifest(authored, catalog, {...pin, catalog: runtime.receipt});
                this.addWatchFile(inputFile);
            }
            Object.assign(generated.contributes.productCatalogs![0]!.document, runtime.receipt);
            const providers = generated.contributes.productProviders;
            const assetProvider = providers?.findIndex(provider => provider.id === 'assets') ?? -1;
            if (providers && assetProvider !== -1) {
                const scopedProvider = { ...providers[assetProvider], categoryBrowsing: true };
                try {
                    providers[assetProvider] = parseNixieProductProviderV1(scopedProvider);
                } catch { /* Older SDKs keep legacy catalog browsing. */ }
            }
            manifest = JSON.stringify(parseNixieExtensionManifestV1(generated)) + '\n';
            this.addWatchFile(fileURLToPath(new URL('./nixie.extension.json', import.meta.url)));
            this.addWatchFile(catalogPinPath());
        },
        shouldTransformCachedModule({id}) {return id === '\0' + ASSETS || id === '\0' + MAPS;},
        resolveId(id) {
            if (/^\.\/catalog-locales\/[a-z]{2}\.js$/.test(id)) return {id, external: true};
            if (id === ASSETS || id === MAPS) return '\0' + id;
        },
        load(id) {
            if (id !== '\0' + ASSETS && id !== '\0' + MAPS) return;
            const prefix = 'import {takePlannerCatalogText} from ' + JSON.stringify(catalogSource) + ';'
                + 'import {decodeFoxholeCatalogMetadata} from ' + JSON.stringify(catalogKeys) + ';'
                + 'const text=takePlannerCatalogText();'
                + 'const fallback="../catalog.v1.json";'
                + 'const packedCatalog=text===undefined?(await import(/* @vite-ignore */ fallback,{with:{type:"json"}})).default:JSON.parse(text);'
                + 'const catalog=decodeFoxholeCatalogMetadata(packedCatalog);';
            if (id === '\0' + MAPS) return 'export {catalogMaps as default} from ' + JSON.stringify(ASSETS) + ';';
            const localeImports = [...runtime.localeModules.keys()].map(path => {
                const locale = path.split('/').at(-1)!.slice(0,-3);
                return `${JSON.stringify(locale)}:()=>import(${JSON.stringify('./catalog-locales/' + locale + '.js')})`;
            });
            return prefix + 'export const flagAtlasesByResourceId=catalog.data.flagAtlasesByResourceId;export const modelLightHintsByResourceId=catalog.data.modelLightHintsByResourceId;export const catalogLocalizations=catalog.data.catalogLocalizations??{};'
                + 'const localeModules={' + localeImports.join(',') + '};export async function readCatalogLocale(locale){return (await localeModules[locale]?.())?.default;}'
                + 'export const productionOutputsByRecipeId=catalog.data.productionOutputsByRecipeId;'
                + 'export const productionRecipesById=catalog.data.productionRecipesById;'
                + 'export const bunkerDestructionWeapons=catalog.data.bunkerDestructionWeapons;'
                + 'export const catalogMaps=catalog.data.maps;'
                + 'export default Object.fromEntries(catalog.products.map(product=>[product.id,product.data]));';
        },
        async writeBundle(options) {
            const staging = resolve(String(options.dir)), published = resolve(extensionRoot, 'dist'), previous = resolve(extensionRoot, '.nixie-previous');
            if (staging !== resolve(extensionRoot, '.nixie-build') || dirname(staging) !== resolve(extensionRoot)) throw new Error('Unexpected Planner output directory');
            await mkdir(staging, {recursive: true});
            await writeFile(resolve(staging, 'catalog.v1.json'), runtime.bytes);
            await writeFile(resolve(staging, 'nixie.extension.json'), manifest);
            for (const filename of flacAudio) {
                await copyFile(resolve(extensionRoot, 'audio-flac', filename), resolve(staging, 'audio', filename));
                await unlink(resolve(staging, 'audio', filename.replace(/\.flac$/, '.wav')));
            }
            for (const [path, content] of [...runtime.localeModules, ...(localFiles ?? [])]) {
                const file = resolve(staging, path);
                await mkdir(dirname(file), {recursive: true});
                await writeFile(file, content);
            }
            await publishCompletedBuild(staging, published, previous, this.meta.watchMode);
            await unlink(marker);
        },
        async buildEnd(error) {if (error) await unlink(marker).catch(error => {if (error.code !== 'ENOENT') throw error;});},
    };
}
const hostSdk = process.env.NIXIE_HOST_ROOT?.trim();
export default defineConfig(({mode}) => ({root: extensionRoot, base: './',
    ...(hostSdk ? {resolve: {alias: [
        {find: /^@nixiejs\/extension-sdk$/, replacement: resolve(hostSdk, 'packages/extension-sdk/dist/index.js')},
        {find: /^@nixiejs\/extension-sdk\/scene-v2$/, replacement: resolve(hostSdk, 'packages/extension-sdk/dist/scene-v2/index.js')},
    ]}} : {}),
    build: {outDir: '.nixie-build', target: 'esnext',
    rollupOptions: {output: {importAttributesKey: 'with'}}}, plugins: [catalogPlugin(mode === 'development')]}));
