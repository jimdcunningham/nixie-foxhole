const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_ALIASES = 512;
const ALIAS = /^[A-Za-z]{1,2}$/;

function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function visitKeys(value, visit) {
    if (Array.isArray(value)) {
        for (const item of value) visitKeys(item, visit);
    } else if (record(value)) {
        for (const [key, item] of Object.entries(value)) {
            visit(key);
            visitKeys(item, visit);
        }
    }
}

function rewriteKeys(value, names, decode = false) {
    if (Array.isArray(value)) return value.map(item => rewriteKeys(item, names, decode));
    if (!record(value)) return value;
    const entries = Object.entries(value).map(([key, item]) => [
        names.get(key) ?? key,
        rewriteKeys(item, names, decode),
    ]);
    const result = Object.fromEntries(entries);
    if (decode && Object.keys(result).length !== entries.length) {
        throw Error('Duplicate decoded Foxhole catalog metadata key');
    }
    return result;
}

// These tables have their own file-path and receipt contracts.
const sharedMetadata = key => key !== 'world' && key !== 'privateFiles' && key !== 'compactKeys';

/** Only Foxhole-owned metadata is encoded. SDK fields and resource paths stay canonical. */
export function encodeFoxholeCatalogKeys(catalog) {
    const counts = new Map();
    const countKey = key => counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const product of catalog.products) {
        visitKeys(product.data, countKey);
    }
    for (const [key, value] of Object.entries(catalog.data ?? {})) {
        if (sharedMetadata(key)) visitKeys(value, countKey);
    }
    // Skip short names already used anywhere in the metadata, including user-facing maps.
    const available = [...ALPHABET, ...[...ALPHABET].flatMap(first => [...ALPHABET].map(second => first + second))]
        .filter(key => !counts.has(key));
    const candidates = [...counts]
        .filter(([key, count]) => key.length > 2 && count > 1)
        .sort(([a, countA], [b, countB]) => (b.length - 1) * countB - (a.length - 1) * countA
            || (a < b ? -1 : a > b ? 1 : 0));
    const names = new Map();
    for (const [key, count] of candidates) {
        const alias = available[names.size];
        if (!alias || names.size === MAX_ALIASES) break;
        if ((key.length - alias.length) * count <= JSON.stringify({[alias]: key}).length - 1) continue;
        names.set(key, alias);
    }
    const data = Object.fromEntries(Object.entries(catalog.data ?? {}).map(([key, value]) => [
        key, sharedMetadata(key) ? rewriteKeys(value, names) : value,
    ]));
    data.compactKeys = {version: 1, dictionary: Object.fromEntries([...names].map(([key, alias]) => [alias, key]))};
    if (data.world?.contentResources) {
        const contentResources = Object.fromEntries(Object.entries(data.world.contentResources)
            .map(([path, {sha256, byteLength, mediaType}]) => [path, {a: sha256, b: byteLength, c: mediaType}]));
        data.world = {...data.world, contentResources};
    }
    const products = catalog.products.map(product => product.data === undefined ? product
        : {...product, data: rewriteKeys(product.data, names)});
    return {...catalog, products, data};
}

function compactDictionary(catalog) {
    const format = catalog.data?.compactKeys;
    if (format === undefined) return undefined;
    if (!record(format) || format.version !== 1 || !record(format.dictionary)) {
        throw Error('Unsupported Foxhole catalog key format');
    }
    return format.dictionary;
}

export function decodeFoxholeCatalogMetadata(catalog) {
    const keys = compactDictionary(catalog);
    if (!keys) return catalog;
    const aliases = Object.entries(keys);
    const originals = new Set(aliases.map(([, original]) => original));
    if (aliases.length > MAX_ALIASES || originals.size !== aliases.length
        || aliases.some(([alias, original]) => !ALIAS.test(alias) || typeof original !== 'string' || original.length < 3)) {
        throw Error('Invalid Foxhole catalog key dictionary');
    }
    const names = new Map(aliases);
    const products = catalog.products.map(product => product.data === undefined ? product
        : {...product, data: rewriteKeys(product.data, names, true)});
    const data = Object.fromEntries(Object.entries(catalog.data).map(([key, value]) => [
        key, sharedMetadata(key) ? rewriteKeys(value, names, true) : value,
    ]));
    return {...catalog, products, data};
}

export function foxholeWorldReceiptsUseShortKeys(catalog) {
    return compactDictionary(catalog) !== undefined;
}
