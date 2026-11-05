import { createNixieLocalizationV1 } from '@nixiejs/extension-sdk';
import assets, { catalogLocalizations } from '#foxhole-scene-v2-assets';
import { FOXHOLE_CATALOG_LOCALES, presentFoxholeCatalogAssets } from './catalog-presentation.ts';

export const foxholeLocalization = createNixieLocalizationV1({
    defaultLocale: 'en', supportedLocales: FOXHOLE_CATALOG_LOCALES, messages: catalogLocalizations,
});
const catalogs = new Map<string, typeof assets>();

export function localizedFoxholeCatalog(preference: unknown, rendered = false): typeof assets {
    const locale = foxholeLocalization.resolveLocale(preference);
    const key = `${locale}:${rendered}`;
    let catalog = catalogs.get(key);
    if (!catalog) {
        catalog = presentFoxholeCatalogAssets(assets,
            (id, fallback) => foxholeLocalization.text(locale, id, fallback) || fallback, rendered);
        catalogs.set(key, catalog);
    }
    return catalog;
}
