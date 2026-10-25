import {readFile, writeFile, mkdir, unlink} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, type Plugin} from 'vite';
import {parseNixieExtensionManifestV1} from '@nixiejs/extension-sdk';
import {parseNixieExperimentalProductCatalogV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
import {verifyCatalogInput, readCatalogPin, catalogPinPath} from './build/prepare-catalog-input.mjs';
import {createCatalogRuntimeManifest} from './build/catalog-runtime-manifest.ts';
import {publishCompletedBuild} from './build/completed-build-publisher.ts';

const extensionRoot = fileURLToPath(new URL('./', import.meta.url));
const inputFile = process.env.NIXIE_FOXHOLE_CATALOG_FILE?.trim() || resolve(process.env.NIXIE_FOXHOLE_ASSETS_ROOT?.trim()
    || fileURLToPath(new URL('../../packages/extensions/foxhole/public/foxhole/assets/', import.meta.url)), 'catalog.v1.json');
const ASSETS = '#foxhole-scene-v2-assets', MAPS = '#foxhole-scene-v2-maps';
function catalogPlugin(): Plugin {
    let bytes: Buffer, manifest: string;
    const marker = resolve(extensionRoot, '.nixie-building');
    return {
        name: 'foxwatch-packaged-catalog', enforce: 'pre',
        async buildStart() {
            await writeFile(marker, 'Building extension output\n');
            const pin = await readCatalogPin();
            bytes = await readFile(inputFile);
            verifyCatalogInput(bytes, pin.catalog);
            const catalog = parseNixieExperimentalProductCatalogV1(JSON.parse(bytes.toString('utf8')));
            if (catalog.releaseRoot && new URL(catalog.releaseRoot + 'catalog.v1.json', pin.baseUrl).href !== pin.catalog.url) throw new Error('Catalog differs from its pinned asset release.');
            const authored = parseNixieExtensionManifestV1(JSON.parse(await readFile(new URL('./nixie.extension.json', import.meta.url), 'utf8')));
            manifest = JSON.stringify(parseNixieExtensionManifestV1(createCatalogRuntimeManifest(authored, catalog, pin))) + '\n';
            this.addWatchFile(inputFile); this.addWatchFile(fileURLToPath(new URL('./nixie.extension.json', import.meta.url)));
            this.addWatchFile(catalogPinPath());
        },
        shouldTransformCachedModule({id}) {return id === '\0' + ASSETS || id === '\0' + MAPS;},
        resolveId(id) {
            if (id === '../catalog.v1.json') return {id, external: true};
            if (id === ASSETS || id === MAPS) return '\0' + id;
        },
        load(id) {
            if (id !== '\0' + ASSETS && id !== '\0' + MAPS) return;
            const prefix = 'import catalog from "../catalog.v1.json" with {type:"json"};';
            if (id === '\0' + MAPS) return prefix + 'export default catalog.data.maps;';
            return prefix + 'export const catalogLocalizations=catalog.data.catalogLocalizations;'
                + 'export const productionOutputsByRecipeId=catalog.data.productionOutputsByRecipeId;'
                + 'export const productionRecipesById=catalog.data.productionRecipesById;'
                + 'export const bunkerDestructionWeapons=catalog.data.bunkerDestructionWeapons;'
                + 'export default Object.fromEntries(catalog.products.map(product=>[product.id,product.data]));';
        },
        async writeBundle(options) {
            const staging = resolve(String(options.dir)), published = resolve(extensionRoot, 'dist'), previous = resolve(extensionRoot, '.nixie-previous');
            if (staging !== resolve(extensionRoot, '.nixie-build') || dirname(staging) !== resolve(extensionRoot)) throw new Error('Unexpected Planner output directory');
            await mkdir(staging, {recursive: true});
            await writeFile(resolve(staging, 'catalog.v1.json'), bytes);
            await writeFile(resolve(staging, 'nixie.extension.json'), manifest);
            await publishCompletedBuild(staging, published, previous, this.meta.watchMode);
            await unlink(marker);
        },
        async buildEnd(error) {if (error) await unlink(marker).catch(error => {if (error.code !== 'ENOENT') throw error;});},
    };
}
export default defineConfig({root: extensionRoot, base: './', build: {outDir: '.nixie-build', target: 'esnext',
    rollupOptions: {output: {importAttributesKey: 'with'}}}, plugins: [catalogPlugin()]});
