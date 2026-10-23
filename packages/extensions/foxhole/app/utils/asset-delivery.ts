import { NixiePersistentExtensionResourceCache } from '#nixie-internal/desktop-extensions/persistent-resource-cache.ts';
import { loadFoxholeAssetRelease, type AssetReceipt } from '#foxhole-planner-assets/asset-release.ts';
import pin from '#foxhole-planner-assets/asset-release-pin.json';
import { configureWorldAssetLocations } from '@nixie/foxhole-world/asset-locations';
import { installFoxholeAssetLocations } from '../plugins/foxhole/nixie/asset-locations.ts';
import { useRuntimeConfig } from '#app';
import { createLocalFoxholeAssetDelivery } from './local-asset-delivery.ts';
let localDelivery: ReturnType<typeof createLocalFoxholeAssetDelivery> | null = null;
const cache = new NixiePersistentExtensionResourceCache();
const metadataCache = new NixiePersistentExtensionResourceCache(
    async () => typeof caches === 'undefined' ? null : caches.open('nixie.extension-pack-metadata.v1'),
    256 * 1024 * 1024, 128,
);
let pending: Promise<Awaited<ReturnType<typeof loadFoxholeAssetRelease>>> | null = null;
async function read<T>(receipt: AssetReceipt): Promise<T> {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await metadataCache.loadVerified(receipt.url, receipt, 512 * 1024 * 1024))) as T;
}
export function initializeFoxholeAssetDelivery() {
    if (import.meta.dev && useRuntimeConfig().public.foxholeAssetMode === 'local') {
        localDelivery ??= createLocalFoxholeAssetDelivery(new URL('/foxhole/assets/', globalThis.location.href).href);
        installFoxholeAssetLocations(localDelivery.resolve);
        configureWorldAssetLocations(localDelivery);
        return Promise.resolve(localDelivery);
    }
    return initializePublishedFoxholeAssets();
}
function initializePublishedFoxholeAssets() {
    return pending ??= loadFoxholeAssetRelease(pin.publication, read).then(library => {
        installFoxholeAssetLocations(path => library.resolve(path));
        const byUrl = new Map([...library.files.values()].map(location => [location.url, location]));
        configureWorldAssetLocations({ resolve: (path: string) => library.resolve(path), fetch: async (url: string) => {
            const location = byUrl.get(url);
            if (!location) throw new Error('Unpinned world catalog asset: ' + url);
            const bytes = await cache.loadVerified(url, location.entry);
            return new Response(bytes, { headers: { 'Content-Type': location.entry.mediaType } });
        } });
        return library;
    }).catch(error => { pending = null; throw error; });
}
export function foxholeWorldAssetDelivery() {
    if (localDelivery) return localDelivery.world;
    if (!pending) throw new Error('Foxhole assets have not initialized.');
    return { baseUrl: new URL('world/', pin.publication.url).href,
        loadIndex: async () => read((await initializePublishedFoxholeAssets()).worldIndex) };
}
