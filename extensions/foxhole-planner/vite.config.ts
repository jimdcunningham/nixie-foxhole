import {copyFile, readFile, writeFile, mkdir, unlink} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, normalizePath, type Plugin} from 'vite';
import {parseNixieExtensionManifestV1} from '@nixiejs/extension-sdk';
import {parseNixieProductCatalogV1, parseNixieResourceV1} from '@nixiejs/extension-sdk/scene-v2';
import {verifyCatalogInput, readCatalogPin, catalogPinPath} from './build/prepare-catalog-input.mjs';
import {createCatalogRuntimeManifest} from './build/catalog-runtime-manifest.ts';
import {publishCompletedBuild} from './build/completed-build-publisher.ts';
import {readLocalAssetCatalog} from './build/local-asset-catalog.ts';

const extensionRoot = fileURLToPath(new URL('./', import.meta.url));
const inputFile = process.env.NIXIE_FOXHOLE_CATALOG_FILE?.trim() || resolve(process.env.NIXIE_FOXHOLE_ASSETS_ROOT?.trim()
    || fileURLToPath(new URL('../../packages/extensions/foxhole/public/foxhole/assets/', import.meta.url)), 'catalog.v1.json');
const ASSETS = '#foxhole-scene-v2-assets', MAPS = '#foxhole-scene-v2-maps';
const catalogKeys = normalizePath(fileURLToPath(new URL('./src/catalog-keys.mjs', import.meta.url)));
function catalogPlugin(development: boolean): Plugin {
    let bytes: Buffer, manifest: string;
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
            if (local) {
                bytes = local.bytes;
                manifest = JSON.stringify(parseNixieExtensionManifestV1(local.manifest)) + '\n';
            } else {
                bytes = await readFile(inputFile);
                verifyCatalogInput(bytes, pin.catalog);
                const catalog = parseNixieProductCatalogV1(JSON.parse(bytes.toString('utf8')));
                if (catalog.releaseRoot && new URL(catalog.releaseRoot + 'catalog.v1.json', pin.baseUrl).href !== pin.catalog.url) throw new Error('Catalog differs from its pinned asset release.');
                manifest = JSON.stringify(parseNixieExtensionManifestV1(createCatalogRuntimeManifest(authored, catalog, pin))) + '\n';
                this.addWatchFile(inputFile);
            }
            this.addWatchFile(fileURLToPath(new URL('./nixie.extension.json', import.meta.url)));
            this.addWatchFile(catalogPinPath());
        },
        shouldTransformCachedModule({id}) {return id === '\0' + ASSETS || id === '\0' + MAPS;},
        resolveId(id) {
            if (id === '../catalog.v1.json') return {id, external: true};
            if (id === ASSETS || id === MAPS) return '\0' + id;
        },
        load(id) {
            if (id !== '\0' + ASSETS && id !== '\0' + MAPS) return;
            const prefix = 'import packedCatalog from "../catalog.v1.json" with {type:"json"};'
                + 'import {decodeFoxholeCatalogMetadata} from ' + JSON.stringify(catalogKeys) + ';'
                + 'const catalog=decodeFoxholeCatalogMetadata(packedCatalog);';
            if (id === '\0' + MAPS) return 'export {catalogMaps as default} from ' + JSON.stringify(ASSETS) + ';';
            return prefix + 'export const flagAtlasesByResourceId=catalog.data.flagAtlasesByResourceId;export const modelLightHintsByResourceId=catalog.data.modelLightHintsByResourceId;export const catalogLocalizations=catalog.data.catalogLocalizations;'
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
            await writeFile(resolve(staging, 'catalog.v1.json'), bytes);
            await writeFile(resolve(staging, 'nixie.extension.json'), manifest);
            for (const filename of flacAudio) {
                await copyFile(resolve(extensionRoot, 'audio-flac', filename), resolve(staging, 'audio', filename));
                await unlink(resolve(staging, 'audio', filename.replace(/\.flac$/, '.wav')));
            }
            for (const [path, content] of localFiles ?? []) {
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
