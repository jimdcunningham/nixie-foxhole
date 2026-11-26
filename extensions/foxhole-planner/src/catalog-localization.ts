import { createNixieLocalizationV1 } from '@nixiejs/extension-sdk';
import assets, { catalogLocalizations, readCatalogLocale } from '#foxhole-scene-v2-assets';
import { FOXHOLE_CATALOG_LOCALES, presentFoxholeCatalogAssets } from './catalog-presentation.ts';

export const foxholeLocalization = createNixieLocalizationV1({
    defaultLocale: 'en', supportedLocales: FOXHOLE_CATALOG_LOCALES,
});
const catalogs = new Map<string, typeof assets>();
const localeMessages = new Map(Object.entries(catalogLocalizations ?? {}));
const pendingLocales = new Map<string, Promise<void>>();

export function prepareFoxholeCatalogLocale(preference: unknown): Promise<void> | undefined {
    const locale = foxholeLocalization.resolveLocale(preference);
    if (locale === 'en' || localeMessages.has(locale)) return;
    let pending = pendingLocales.get(locale);
    if (!pending) {
        pending = readCatalogLocale(locale).then(messages => {
            localeMessages.set(locale, messages ?? {});
        }).finally(() => pendingLocales.delete(locale));
        pendingLocales.set(locale, pending);
    }
    return pending;
}

export function localizedFoxholeCatalog(preference: unknown, rendered = false): typeof assets {
    const locale = foxholeLocalization.resolveLocale(preference);
    const key = `${locale}:${rendered}`;
    let catalog = catalogs.get(key);
    if (!catalog) {
        catalog = presentFoxholeCatalogAssets(assets,
            (id, fallback) => id ? localeMessages.get(locale)?.[id]?.trim() || localeMessages.get('en')?.[id]?.trim() || fallback : fallback,
            rendered);
        catalogs.set(key, catalog);
    }
    return catalog;
}
