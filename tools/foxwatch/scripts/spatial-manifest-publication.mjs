import { readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { writeJsonAtomic } from './pipeline-core.mjs';
import { mergeSharedPartPublications } from './spatial-shared-parts.mjs';

/** Model workers checkpoint in their private cache; only a successful run publishes live metadata. */
export async function runSpatialManifestPublication({ manifestPath, manifest, outputRoot, sharedParts, generate, signal,
    writeManifest = writeJsonAtomic, removeFile = unlink }) {
    const obsolete = new Set();
    let failed = false;
    await generate(result => {
        const { timing, asset, resources } = result;
        if (timing.status === 'failed') { failed = true; return; }
        const old = [manifest.assets[timing.id], ...Object.values(manifest.resources).filter(model => model.assetId === timing.id)].filter(Boolean);
        delete manifest.assets[timing.id];
        for (const [key, model] of Object.entries(manifest.resources)) if (model.assetId === timing.id) delete manifest.resources[key];
        if (asset) manifest.assets[timing.id] = asset;
        Object.assign(manifest.resources, resources);
        manifest.sharedParts = mergeSharedPartPublications(manifest, sharedParts);
        for (const model of old) if (asset && model.path?.startsWith('models/') && /^models\/[a-z0-9.-]+\.glb$/.test(model.path))
            obsolete.add(model.path);
    });
    signal?.throwIfAborted();
    if (failed) return false;
    // A cache-only retry with identical metadata must not trigger HMR either.
    let previous;
    try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!isDeepStrictEqual(previous, manifest)) await writeManifest(manifestPath, manifest);
    const livePaths = new Set([...Object.values(manifest.assets), ...Object.values(manifest.resources),
        ...Object.values(manifest.sharedParts ?? {})].map(model => model.path));
    for (const path of obsolete) if (!livePaths.has(path))
        await removeFile(resolve(outputRoot, path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return true;
}
