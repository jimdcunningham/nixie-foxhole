import {shallowRef} from 'vue';
import publishedFoxholeManifest from '../../../../public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { z } from 'zod';

import {
    createLocaleCandidates,
    DEFAULT_PUBLISHED_FOXHOLE_ASSETS_BASE_URL,
    foxholeManifestSchema,
    rebaseFoxholeManifestAssetUrls,

} from './manifest-schema.ts';
import type { FoxholeManifest } from './manifest-schema.ts';

export * from './manifest-schema.ts';

let selectedManifest: unknown = null;
const manifestRevision = shallowRef(0);
const manifestCache = new Map<string, FoxholeManifest>();
const localizationBundleCache = new Map<string, Map<string, Record<string, string>>>();
const localizationBundleLoadCache = new Map<string, Promise<Record<string, string>>>();

/** Selected immutable generation data; compiled metadata is bootstrap-only. */
export function installFoxholeManifest(value: unknown): void {
    if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid selected Foxhole manifest.');
    selectedManifest = value;
    manifestCache.clear(); localizationBundleCache.clear(); localizationBundleLoadCache.clear();
    manifestRevision.value++;
}
export function getFoxholeManifestRevision(): number {return manifestRevision.value;}

export function getFoxholeManifest(baseAssetsUrl: string): FoxholeManifest {
    void manifestRevision.value;
    const cacheKey = String(baseAssetsUrl ?? '').trim() || '/foxhole/assets/';
    const existing = manifestCache.get(cacheKey);
    if (existing) {
        return existing;
    }

    const manifest = createPublishedFoxholeManifest(cacheKey);
    manifestCache.set(cacheKey, manifest);
    seedLocalizationBundleCache(cacheKey, manifest);
    return manifest;
}

function createPublishedFoxholeManifest(baseAssetsUrl: string): FoxholeManifest {
    const clonedManifest = JSON.parse(JSON.stringify(selectedManifest ?? publishedFoxholeManifest)) as FoxholeManifest;
    return rebaseFoxholeManifestAssetUrls(
        foxholeManifestSchema.parse(clonedManifest),
        DEFAULT_PUBLISHED_FOXHOLE_ASSETS_BASE_URL,
        baseAssetsUrl,
    );
}

function seedLocalizationBundleCache(baseAssetsUrl: string, manifest: FoxholeManifest): void {
    const cacheKey = String(baseAssetsUrl ?? '').trim() || '/foxhole/assets/';
    const existing = localizationBundleCache.get(cacheKey) ?? new Map<string, Record<string, string>>();
    for (const bundle of manifest.localizations) {
        existing.set(bundle.locale.toLowerCase(), bundle.strings);
    }
    localizationBundleCache.set(cacheKey, existing);
}

function getLocalizationBundleCache(baseAssetsUrl: string): Map<string, Record<string, string>> {
    const cacheKey = String(baseAssetsUrl ?? '').trim() || '/foxhole/assets/';
    const existing = localizationBundleCache.get(cacheKey);
    if (existing) {
        return existing;
    }

    const manifest = getFoxholeManifest(cacheKey);
    seedLocalizationBundleCache(cacheKey, manifest);
    return localizationBundleCache.get(cacheKey) ?? new Map<string, Record<string, string>>();
}

function createLocalizationLoadCacheKey(baseAssetsUrl: string, locale: string): string {
    return `${String(baseAssetsUrl ?? '').trim() || '/foxhole/assets/'}|${locale.toLowerCase()}`;
}

function resolveFoxholeLocalizationFileUrl(
    manifest: FoxholeManifest,
    baseAssetsUrl: string,
    locale: string,
): string | null {
    const normalizedLocale = String(locale ?? '').trim().toLowerCase();
    if (!normalizedLocale) {
        return null;
    }

    const file = manifest.localizationIndex?.files?.[normalizedLocale];
    if (!file) {
        return null;
    }

    if (/^https?:\/\//i.test(file) || file.startsWith('/')) {
        return file;
    }

    return `${String(baseAssetsUrl ?? '').trim() || '/foxhole/assets/'}${file.replace(/^\/+/, '')}`;
}

async function fetchFoxholeLocalizationBundle(url: string): Promise<Record<string, string>> {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
        throw new Error(`Failed to load Foxhole localization bundle: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return z.record(z.string(), z.string()).parse(payload);
}

export function getFoxholeManifestLocalizationMap(baseAssetsUrl: string, locale = 'en'): Record<string, string> {
    const manifest = getFoxholeManifest(baseAssetsUrl);
    const bundlesByLocale = getLocalizationBundleCache(baseAssetsUrl);

    for (const candidate of createLocaleCandidates(locale)) {
        const bundle = bundlesByLocale.get(candidate);
        if (bundle) {
            return bundle;
        }
    }

    return bundlesByLocale.get('en') ?? {};
}

export async function loadFoxholeManifestLocalizationMap(baseAssetsUrl: string, locale = 'en'): Promise<Record<string, string>> {
    const manifest = getFoxholeManifest(baseAssetsUrl);
    const bundlesByLocale = getLocalizationBundleCache(baseAssetsUrl);

    for (const candidate of createLocaleCandidates(locale)) {
        const existing = bundlesByLocale.get(candidate);
        if (existing) {
            return existing;
        }

        const url = resolveFoxholeLocalizationFileUrl(manifest, baseAssetsUrl, candidate);
        if (!url) {
            continue;
        }

        const loadCacheKey = createLocalizationLoadCacheKey(baseAssetsUrl, candidate);
        const pending = localizationBundleLoadCache.get(loadCacheKey)
            ?? fetchFoxholeLocalizationBundle(url)
                .then(bundle => {
                    bundlesByLocale.set(candidate, bundle);
                    return bundle;
                })
                .finally(() => {
                    if (localizationBundleLoadCache.get(loadCacheKey) === pending) localizationBundleLoadCache.delete(loadCacheKey);
                });
        localizationBundleLoadCache.set(loadCacheKey, pending);

        try {
            return await pending;
        } catch {
            // Fall back to the next candidate, then to English below.
        }
    }

    return bundlesByLocale.get('en') ?? {};
}
