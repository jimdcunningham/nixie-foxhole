import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createFoxholeCatalogLibrary, loadFoxholeCatalogLibrary, readPinnedCatalogJson } from '../../../extensions/foxhole-planner/src/catalog-library.mjs';

const extensionId = 'nixie.foxhole-planner';
const registry = 'https://nixiejs.com/api/nixie/extensions/' + extensionId;
const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function registryJson(url, fetcher) {
    const response = await fetcher(url, {
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('Planner registry returned HTTP ' + response.status);
    return response.json();
}

export async function readPublishedPlannerCatalog({ version, fetcher = fetch } = {}) {
    const versions = await registryJson(registry + '/versions?studioVersion=1.1.0', fetcher);
    if (!Array.isArray(versions)) throw Error('Invalid Planner registry history');
    const release = version === undefined
        ? versions.slice().sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0]
        : versions.find(row => row.version === version);
    if (!release || !isSha256(release.packageSha256)) throw Error('Published Planner version unavailable');
    const descriptorUrl = registry + '/releases/' + release.packageSha256;
    const { manifest } = await registryJson(descriptorUrl, fetcher);
    if (manifest?.id !== extensionId || manifest.version !== release.version) throw Error('Planner release manifest identity mismatch');
    const declaration = manifest.contributes?.productCatalogs?.find(row => row.id === 'foxhole.catalog');
    if (!declaration?.document || !isSha256(declaration.document.sha256)) throw Error('Published Planner version has no catalog');
    const receipt = { ...declaration.document, url: descriptorUrl + '/files/' + declaration.document.path };
    const document = await readPinnedCatalogJson(receipt, fetcher);
    return {
        version: release.version,
        baseUrl: declaration.baseUrl,
        sha256: receipt.sha256,
        library: createFoxholeCatalogLibrary(declaration.baseUrl, document),
    };
}
/** Loads the prepared checkpoint without opening the staged payload files. */
export async function readPreparedPlannerCatalog(directory) {
    const pin = JSON.parse(await readFile(path.join(directory, 'extension-pin.json'), 'utf8'));
    const library = await loadFoxholeCatalogLibrary(pin, async ({ sha256, byteLength }) => {
        const bytes = await readFile(path.join(directory, 'catalog.v1.json'));
        if (bytes.length !== byteLength || createHash('sha256').update(bytes).digest('hex') !== sha256) {
            throw Error('Prepared Planner catalog integrity mismatch');
        }
        return JSON.parse(bytes.toString('utf8'));
    });
    return { baseUrl: pin.baseUrl, sha256: pin.catalog.sha256, library };
}

export function comparePlannerCatalogs(before, after) {
    const result = { before: { version: before.version, sha256: before.sha256 },
        after: { version: after.version, sha256: after.sha256 }, changes: [] };
    if (before.sha256 === after.sha256) return result;
    const previous = before.library.files;
    const next = after.library.files;
    for (const path of new Set([...previous.keys(), ...next.keys()])) {
        const old = previous.get(path) ?? null;
        const current = next.get(path) ?? null;
        if (old && current && old.entry.sha256 === current.entry.sha256 && old.entry.byteLength === current.entry.byteLength) continue;
        result.changes.push({ path, status: !old ? 'added' : !current ? 'deleted' : 'modified', before: old, after: current });
    }
    return result;
}

export async function reviewPreparedPlannerCatalog(directory, options) {
    const [before, after] = await Promise.all([
        readPublishedPlannerCatalog(options),
        readPreparedPlannerCatalog(directory),
    ]);
    return comparePlannerCatalogs(before, after);
}
