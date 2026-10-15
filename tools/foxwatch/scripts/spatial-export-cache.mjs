import { readFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, basename } from 'node:path';
import { VisualOutputCache } from './visual-output-cache.mjs';
import { spatialModelPath } from './spatial-model-paths.mjs';

/** Only a reviewed, byte-identical implementation may bridge old orchestration fingerprints. */
export async function legacySpatialCache(directory, sourceFiles, versions, compatibilityPath) {
    try {
        const compatibility = JSON.parse(await readFile(compatibilityPath, 'utf8'));
        const current = await Promise.all(sourceFiles.map(async file => [basename(file), createHash('sha256').update(await readFile(file)).digest('hex')]));
        if (JSON.stringify(current) !== JSON.stringify(compatibility.currentSources)) return null;
        return new VisualOutputCache(directory, { sources: compatibility.legacySources, versions });
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Verify old input provenance and every output hash before copying to the co-located layout. */
export async function relocateLegacySpatialCache({ cache, legacy, id, inputs, settings, outputIds, outputRoot, asset, identity }) {
    if (!legacy) return null;
    const metadataPath = resolve(cache.directory, `${id}.metadata.json`);
    const paths = outputIds.map(id => resolve(outputRoot, 'models', id + '.glb'));
    const previous = legacy.identity(id, [Buffer.from(JSON.stringify(inputs))], settings, [...paths, metadataPath]);
    if (!await legacy.matches(previous)) return null;
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    for (const [modelId, model] of [[id, metadata.asset], ...Object.entries(metadata.resources ?? {})]) {
        if (!model || !outputIds.includes(modelId) || model.path !== `models/${modelId}.glb`) return null;
    }
    for (const [modelId, model] of [[id, metadata.asset], ...Object.entries(metadata.resources ?? {})]) {
        const path = spatialModelPath(asset, modelId);
        await mkdir(dirname(resolve(outputRoot, path)), { recursive: true });
        await copyFile(resolve(outputRoot, model.path), resolve(outputRoot, path));
        model.path = path;
    }
    await cache.record(identity, metadata);
    return metadata;
}
