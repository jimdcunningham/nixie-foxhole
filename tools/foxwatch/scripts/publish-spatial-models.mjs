import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { writeJsonAtomic } from './pipeline-core.mjs';
import { resolveSpatialExportPolicy, filterSpatialModelManifest } from './spatial-export-policy.mjs';
import { spatialExportCatalog } from './spatial-export-catalog.mjs';
import { spatialWorkerCount, runSpatialWorkerPool } from './spatial-worker-pool.mjs';
import { createSpatialModelExporter } from './spatial-model-engine.mjs';
import { runSpatialManifestPublication } from './spatial-manifest-publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3)
    ?? (args.includes('--' + name) ? args[args.indexOf('--' + name) + 1] : undefined);
const outputRoot = resolve(option('output-root') ?? resolve(root, 'packages/extensions/foxhole/public/foxhole/assets'));
const catalog = await spatialExportCatalog(JSON.parse(await readFile(option('catalog') ?? resolve(outputRoot, 'manifest.v1.json'), 'utf8')),
    resolve(root, 'tools/foxwatch/asset-overrides'));
const config = JSON.parse(await readFile(resolve(root, 'tools/foxwatch/asset-overrides/spatial-models.json'), 'utf8'));
const values = name => args.flatMap((arg, index) => arg.startsWith('--' + name + '=') ? arg.slice(name.length + 3).split(',')
    : arg === '--' + name ? (args[index + 1] ?? '').split(',') : []).map(id => id.trim().toLowerCase()).filter(Boolean);
const only = values('only'), categories = values('category');
const policy = resolveSpatialExportPolicy(config, catalog, { only: only.length ? only : undefined, geometryProfile: option('geometry-profile') });
const ids = policy.targets.filter(id => !categories?.length || categories.includes(catalog.assets.find(asset => asset.id === id).categoryId));
const count = Math.min(ids.length, spatialWorkerCount(option('spatial-workers')));
const blender = option('blender') ?? process.env.BLENDER_PATH ?? 'blender';
const blenderVersion = args.includes('--repack-existing') || !ids.length ? 'repack-existing'
    : (await promisify(execFile)(blender, ['--version'], { windowsHide: true })).stdout.trim();
const manifestPath = resolve(outputRoot, 'models/manifest.v1.json');
let manifest = { schemaVersion: 1, assets: {}, resources: {}, sharedParts: {} };
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
manifest = filterSpatialModelManifest(manifest, policy.allowedIds, { includeDamaged: config.assetSelection === 'catalog' });
manifest.resources ??= {};
manifest.packingPolicy = { assetSelection: config.assetSelection, categoryIds: config.categoryIds, assets: [...policy.allowedIds], defaultGeometryProfile: config.geometryProfile ?? 'curved50-compact16' };
const timings = [], started = performance.now(), states = { exported: 0, reused: 0, skipped: 0, failed: 0 };
const active = new Map(), abort = new AbortController();
const cancel = () => abort.abort(Error('3D export cancelled'));
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
const emit = event => console.log('FOXWATCH_PROGRESS ' + JSON.stringify({ stage: 'Exporting 3D Models', assetTotal: ids.length,
    completedAssets: timings.length, workerCount: count, ...states, background: args.includes('--background'),
    active: Object.fromEntries(active), ...event }));
emit({ kind: 'spatial-start', detail: `Exporting ${ids.length} assets with ${count} CPU worker(s).` });
let failure;
try {
    const sharedExporter = await createSpatialModelExporter({ args, catalog, blenderVersion });
    abort.signal.addEventListener('abort', () => sharedExporter.cancel(), { once: true });
    const sharedParts = await sharedExporter.exportSharedParts(ids);
    manifest.sharedParts = { ...manifest.sharedParts, ...sharedParts };
    await runSpatialManifestPublication({ manifestPath, manifest, outputRoot, sharedParts, signal: abort.signal,
        generate: record => runSpatialWorkerPool(ids, { count, workerPath: resolve(root, 'tools/foxwatch/scripts/spatial-model-worker.mjs'),
            options: { args, catalog, blenderVersion, sharedParts }, signal: abort.signal,
            onEvent(event) {
                if (event.kind === 'spatial-asset-start') active.set(event.worker, event.assetId + ' · Preparing');
                if (event.kind === 'spatial-phase') active.set(event.worker, event.modelId + ' · ' + event.phase);
                if (event.kind === 'spatial-asset') active.delete(event.worker);
                emit({ ...event, result: undefined });
            },
            async onResult(result) {
                const { timing } = result;
                timings.push(timing); states[timing.status]++;
                record(result);
            } }),
    });
} catch (error) { failure = error; }
finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    const report = { schemaVersion: 1, createdAt: new Date().toISOString(), totalMs: performance.now() - started,
        workerCount: count, ...states, assets: timings.toSorted((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)), ...(failure ? { error: failure.message } : {}) };
    await writeJsonAtomic(option('timing-report') ?? resolve(root, 'tools/foxwatch/tmp/spatial-timing-last.v1.json'), report);
    emit({ kind: 'spatial-complete', success: !failure && states.failed === 0 });
    console.log(`Spatial models: ${states.exported} exported, ${states.reused} reused, ${states.skipped} skipped, ${states.failed} failed; ${(report.totalMs / 1000).toFixed(2)}s.`);
}
if (failure) throw failure;
if (states.failed) process.exitCode = 1;
