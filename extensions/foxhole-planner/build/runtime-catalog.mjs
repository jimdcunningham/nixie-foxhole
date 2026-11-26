import {createHash} from 'node:crypto';
import {decodeFoxholeCatalogMetadata} from '../src/catalog-keys.mjs';

/** Keep host asset aliases intact and defer translations to separately loadable modules. */
export function buildRuntimeCatalog(source) {
    const catalog = JSON.parse(source);
    const {catalogLocalizations, ...data} = catalog.data ?? {};
    const localeModules = new Map();
    if (catalogLocalizations) {
        if (catalogLocalizations.en) data.catalogLocalizations = {en: catalogLocalizations.en};
        const {data: decoded} = decodeFoxholeCatalogMetadata({products: [], data: {catalogLocalizations, compactKeys: data.compactKeys}});
        for (const [locale, messages] of Object.entries(decoded.catalogLocalizations)) {
            if (locale === 'en') continue;
            if (!/^[a-z]{2}$/.test(locale)) throw Error('Invalid catalog locale: ' + locale);
            // A JSON string preserves message keys as data even when a key is significant in JavaScript.
            localeModules.set(`assets/catalog-locales/${locale}.js`, Buffer.from('export default JSON.parse(' + JSON.stringify(JSON.stringify(messages)) + ');\n'));
        }
    }
    const bytes = catalogLocalizations === undefined ? source : Buffer.from(JSON.stringify({...catalog, data}));
    return {bytes, localeModules, receipt: {sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length}};
}
