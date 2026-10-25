import {installFoxholeMapData, parseFoxholePublishedMapData} from '../plugins/foxhole/nixie/map/data.ts';
import { shallowRef } from 'vue';
import { NixieExtensionResourceUsage } from '#nixie/utils/nixie-extension-resource-usage.ts';
import { NixiePersistentExtensionResourceCache } from '#nixie-internal/desktop-extensions/persistent-resource-cache.ts';
import { createFoxholeCatalogLibrary, type CatalogReceipt, type FoxholeCatalogLibrary } from '#foxhole-planner-assets/catalog-library.mjs';
import { configureWorldAssetLocations } from '@nixiejs/foxhole-world/asset-locations';
import { installFoxholeAssetLocations } from '../plugins/foxhole/nixie/asset-locations.ts';
import { installFoxholeManifest, foxholeManifestSchema } from '../plugins/foxhole/nixie/manifest.ts';
import { useRuntimeConfig } from '#app';
import { createLocalFoxholeAssetDelivery } from './local-asset-delivery.ts';
import { createFoxholeAssetGenerationSelector, type FoxholeAssetGeneration } from './asset-generation.ts';
let localDelivery: ReturnType<typeof createLocalFoxholeAssetDelivery> | null = null;
let publishedLibrary: FoxholeCatalogLibrary | null = null;
const revision = shallowRef(0);
const cache = new NixiePersistentExtensionResourceCache();
const residentUsage = new NixieExtensionResourceUsage(async (_owner, _generation, hashes) => {await cache.markUsed(hashes);});
const metadataCache = new NixiePersistentExtensionResourceCache(
    async () => typeof caches === 'undefined' ? null : caches.open('nixie.extension-pack-metadata.v1'),
    256 * 1024 * 1024, 128,
);
async function read<T>(receipt: CatalogReceipt): Promise<T> {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await metadataCache.loadVerified(receipt.url, receipt, 16 * 1024 * 1024))) as T;
}
export function initializeFoxholeAssetDelivery(): void {
    if (import.meta.dev && useRuntimeConfig().public.foxholeAssetMode === 'local') {
        localDelivery ??= createLocalFoxholeAssetDelivery(new URL('/foxhole/assets/', globalThis.location.href).href);
        installFoxholeAssetLocations(localDelivery.resolve);
        configureWorldAssetLocations(localDelivery);
    }
}
const preparePublishedGeneration = createFoxholeAssetGenerationSelector(async generation => {
    const document = await generation.readProductCatalog('foxhole.catalog');
    const library = createFoxholeCatalogLibrary(document.baseUrl, JSON.parse(document.text));
    const location = library.files.get('manifest.v1.json');
    if (!location || location.entry.mediaType !== 'application/json') throw new Error('The selected catalog has no Foxhole manifest.');
    const manifest = await read<unknown>({url: location.url, ...location.entry});
    foxholeManifestSchema.parse(manifest);
    const mapLocation = library.files.get('maps/map-data.v1.json');
    if (!mapLocation || mapLocation.entry.mediaType !== 'application/json') throw new Error('The selected catalog has no map metadata.');
    const mapData = parseFoxholePublishedMapData(await read({url:mapLocation.url, ...mapLocation.entry}));
    return {library, manifest, mapData};
}, (prepared, generation) => {
    publishedLibrary = prepared?.library ?? null;
    installFoxholeManifest(prepared?.manifest ?? null);
    const library = prepared?.library;
    installFoxholeAssetLocations(library ? path => library.resolve(path) : null);
    if (!library || !generation) configureWorldAssetLocations(null);
    else {
        const byUrl = new Map([...library.files.values()].map(location => [location.url, location]));
        configureWorldAssetLocations({resolve: path => library.resolve(path), retain: url => {
            const location = byUrl.get(url);
            if (!location) throw new Error('Unpinned world catalog asset: ' + url);
            return residentUsage.retain('nixie.foxhole-planner.private', generation.generationHash, location.entry.sha256);
        }, fetch: async url => {
            const location = byUrl.get(url);
            if (!location) throw new Error('Unpinned world catalog asset: ' + url);
            const bytes = await cache.loadVerified(url, location.entry, 512 * 1024 * 1024);
            return new Response(bytes, {headers: {'Content-Type': location.entry.mediaType}});
        }});
    }
    installFoxholeMapData(prepared?.mapData ?? null);
    revision.value++;
});
export function prepareFoxholeAssetGeneration(generation: FoxholeAssetGeneration | null): Promise<() => void> {
    return localDelivery ? Promise.resolve(() => {}) : preparePublishedGeneration(generation);
}
export function resolveSelectedFoxholeAsset(path: string): string | undefined {
    return localDelivery?.resolve(path) ?? publishedLibrary?.resolve(path);
}
export function foxholeWorldAssetDelivery() {
    void revision.value;
    if (localDelivery) return { ...localDelivery.world, revision: revision.value };
    const library = publishedLibrary;
    if (!library?.worldBaseUrl || !library.worldIndex) return null;
    return {baseUrl: library.worldBaseUrl, revision: revision.value, loadIndex: () => read(library.worldIndex!)};
}
