import {parseNixieExperimentalProductCatalogV1, resolveNixieExperimentalProductCatalogResourcesV1} from '@nixiejs/extension-sdk/experimental/scene-v2';

const MAX_DOCUMENT = 16 * 1024 ** 2;
const MAX_RESOURCE = 512 * 1024 ** 2;
const portable = value => typeof value === 'string' && value.length <= 1024 && /^[A-Za-z0-9_./-]+$/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'));
function receipt(value, max = MAX_RESOURCE) {
    if (!value || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || value.byteLength > max) throw Error('Invalid catalog resource receipt');
    return {sha256: value.sha256, byteLength: value.byteLength};
}
function https(value) {
    const url = new URL(value);
    if (url.href !== value || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /%/.test(url.pathname)) throw Error('Catalog assets require canonical HTTPS URLs');
    return url;
}
export async function readPinnedCatalogJson(ref, fetcher = fetch) {
    receipt(ref, MAX_DOCUMENT); if (ref.byteLength < 1) throw Error('Invalid catalog document receipt'); https(ref.url);
    const response = await fetcher(ref.url, {credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(60000)});
    if (!response.ok || !response.body) throw Error('Pinned catalog metadata unavailable (' + response.status + ')');
    const output = new Uint8Array(ref.byteLength), reader = response.body.getReader(); let size = 0;
    try {
        while (true) {
            const {done, value} = await reader.read(); if (done) break;
            if (size + value.length > output.length) throw Error('Pinned catalog metadata exceeds receipt');
            output.set(value, size); size += value.length;
        }
    } finally {void reader.cancel().catch(() => {}); reader.releaseLock();}
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', output))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (size !== output.length || hash !== ref.sha256) throw Error('Pinned catalog metadata integrity mismatch');
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(output));
}

/** Private tooling uses the same immutable catalog as Planner, without another mapping publication. */
export async function loadFoxholeCatalogLibrary(pin, read = readPinnedCatalogJson) {
    if (pin.schemaVersion !== 1) throw Error('Unsupported catalog pin');
    const base = https(pin.baseUrl), namespace = new URL('foxhole-planner/', base), catalogUrl = https(pin.catalog.url);
    if (catalogUrl.origin !== namespace.origin || !catalogUrl.pathname.startsWith(namespace.pathname)) throw Error('Catalog pin escapes Foxhole namespace');
    receipt(pin.catalog, MAX_DOCUMENT);
    return createFoxholeCatalogLibrary(pin.baseUrl, await read(pin.catalog));
}

/** The host verifies packaged bytes before passing their parsed document here. */
export function createFoxholeCatalogLibrary(baseUrl, value) {
    const base = https(baseUrl), namespace = new URL('foxhole-planner/', base);
    const location = source => {
        if (!portable(source)) throw Error('Invalid catalog source path');
        const url = https(new URL(source, base).href);
        if (url.origin !== namespace.origin || !url.pathname.startsWith(namespace.pathname)) throw Error('Catalog source escapes Foxhole namespace');
        return url.href;
    };
    const catalog = parseNixieExperimentalProductCatalogV1(value);
    if (catalog.releaseRoot) throw Error('Private tools require the canonical shared-content catalog');
    const entries = resolveNixieExperimentalProductCatalogResourcesV1(catalog).assets;
    const byPath = new Map(entries.map(row => [row.path, row])), files = new Map();
    const aliases = catalog.data?.privateFiles;
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases) || Object.keys(aliases).length > 65536) throw Error('Missing private catalog file associations');
    for (const [path, logical] of Object.entries(aliases)) {
        const entry = byPath.get(logical);
        if (!portable(path) || !entry) throw Error('Invalid private catalog file association');
        files.set(path, {url: location(entry.sourcePath ?? entry.path), entry});
    }
    const world = catalog.data?.world;
    let worldIndex, worldBaseUrl;
    if (world) {
        if (world.contentRoot !== 'foxhole-planner/world/' || !world.contentResources || typeof world.contentResources !== 'object'
            || Array.isArray(world.contentResources) || Object.keys(world.contentResources).length > 65536) throw Error('Invalid world catalog inventory');
        worldBaseUrl = new URL(world.contentRoot, base).href;
        const root = byPath.get(world.indexResourcePath);
        if (!root || root.mediaType !== 'application/json') throw Error('Missing pinned world index');
        worldIndex = {url: location(root.sourcePath ?? root.path), ...receipt(root)};
        for (const [path, raw] of Object.entries(world.contentResources)) {
            if (!/^content\/(br|raw)\/[a-f0-9]{64}\/asset\.[a-z0-9]+$/.test(path) || typeof raw.mediaType !== 'string') throw Error('Invalid world content identity');
            const entry = {path: 'world/' + path, ...receipt(raw), mediaType: raw.mediaType};
            if (files.has(entry.path)) throw Error('Conflicting world catalog file');
            files.set(entry.path, {url: location(world.contentRoot + path), entry});
        }
    }
    return {catalog, files, worldIndex, worldBaseUrl, resolve(path) {
        const row = files.get(path); if (!row) throw Error('Asset absent from pinned catalog: ' + path);
        return row.url;
    }};
}
