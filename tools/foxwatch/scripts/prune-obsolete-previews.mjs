import fs from 'node:fs/promises';
import path from 'node:path';
import {syncCatalogReferences} from '../../../packages/foxhole-world/catalog-references.mjs';

const obsoletePreview = /\.preview(?:\.[^.]+)*\.webp$/i;
const inside = (root, file) => {
    const relative = path.relative(root, file);
    return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
};

/** Remove retired delivered previews only, after the replacement manifest has committed. */
export async function pruneObsoletePublishedPreviews({assetsRoot, manifest}) {
    if (!Array.isArray(manifest?.assets)) throw Error('Preview cleanup requires a published manifest');
    const root = await fs.realpath(assetsRoot), references = new Set(), candidates = [];
    function collect(value) {
        if (typeof value === 'string') references.add(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    }
    collect(manifest);
    async function walk(directory) {
        let entries;
        try {
            const info = await fs.lstat(directory);
            if (info.isSymbolicLink()) throw Error('Preview cleanup refuses symbolic links: ' + directory);
            const actual = await fs.realpath(directory);
            if (!inside(root, actual)) throw Error('Preview cleanup escaped generated assets');
            entries = await fs.readdir(actual, {withFileTypes: true});
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) throw Error('Preview cleanup refuses symbolic links: ' + file);
            if (entry.isDirectory()) await walk(file);
            else if (entry.isFile() && obsoletePreview.test(entry.name)) {
                const actual = await fs.realpath(file);
                if (!inside(root, actual)) throw Error('Preview cleanup escaped generated assets');
                const relative = path.relative(root, actual).split(path.sep).join('/');
                if (references.has(relative) || references.has('/foxhole/assets/' + relative)) {
                    throw Error('Preview remains referenced by the published manifest: ' + relative);
                }
                candidates.push({file: actual, path: relative, bytes: (await fs.stat(actual)).size});
            }
        }
    }
    // Never traverse render caches, PNG masters, models, maps, or another checkout.
    await walk(path.join(root, 'types'));
    await walk(path.join(root, 'shared'));
    candidates.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    // Validate the complete deletion set before removing any file.
    for (const row of candidates) await fs.unlink(row.file);
    return {removed: candidates.length, bytes: candidates.reduce((n, row) => n + row.bytes, 0)};
}

/** Local finalization only. No render work and no remote storage access. */
export async function finalizeGeneratedAssetPublication({assetsRoot, manifest, metadataOnly = false}) {
    if (metadataOnly) return {regions: 0, removed: 0, bytes: 0};
    const world = path.join(assetsRoot, 'world');
    const present = await fs.stat(path.join(world, 'index.json')).then(() => true).catch(error => {
        if (error.code === 'ENOENT') return false;
        throw error;
    });
    const receipts = present ? await syncCatalogReferences({target: world}) : {regions: 0};
    return {regions: receipts.regions, ...await pruneObsoletePublishedPreviews({assetsRoot, manifest})};
}
