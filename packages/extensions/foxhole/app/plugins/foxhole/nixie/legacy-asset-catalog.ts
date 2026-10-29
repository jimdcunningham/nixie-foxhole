import { createFoxholeAssetsBaseUrl, getFoxholeItemCatalog, getFoxholeStructureCatalog } from './catalog.ts';

const assetsBaseUrl = createFoxholeAssetsBaseUrl('/');

/** Resolve at use time so nodes never retain the bootstrap or previous generation. */
export function getFoxholeLegacyStructureCatalog() {
    return getFoxholeStructureCatalog(assetsBaseUrl);
}

export function getFoxholeLegacyItemCatalog() {
    return getFoxholeItemCatalog(assetsBaseUrl);
}

export function resolveFoxholeLegacyOverlayIcon(codename: string): string | null {
    const key = String(codename ?? '').trim();
    if (!key) {
        return null;
    }
    const items = getFoxholeLegacyItemCatalog().assetByKey;
    const item = items[key] ?? items[key.toLowerCase()];
    if (item?.iconUrl || item?.previewIconUrl) {
        return item.iconUrl ?? item.previewIconUrl;
    }
    const structures = getFoxholeLegacyStructureCatalog().assetByKey;
    const structure = structures[key] ?? structures[key.toLowerCase()];
    return structure?.iconUrl ?? structure?.previewIconUrl ?? null;
}
