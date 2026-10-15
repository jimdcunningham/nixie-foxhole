import { readFile, writeFile, mkdir, realpath, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { SpatialDependencies, SpatialModelCache } from './spatial-model-cache.mjs';
import { writeJsonAtomic } from './pipeline-core.mjs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prepareSpatialStructureScene, prepareSpatialStructureModifications, spatialStructureProfile } from './spatial-structure-profiles.mjs';
import { spatialConnectorProfile, prepareSpatialConnectorScene } from './spatial-connector-profiles.mjs';
import { pruneUnusedStaticGltfUvs } from './spatial-gltf-geometry.mjs';
import { compressSpatialMeshopt } from './spatial-meshopt.mjs';
import { optimizeSpatialGeometry } from './spatial-geometry.mjs';
import { filterSpatialModelManifest, resolveSpatialExportPolicy } from './spatial-export-policy.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const foxwatchRoot = resolve(repositoryRoot, 'tools/foxwatch');
const args = process.argv.slice(2);
const option = name => {
    const direct = args.find(arg => arg.startsWith(`--${name}=`));
    if (direct) return direct.slice(name.length + 3);
    const index = args.indexOf(`--${name}`);
    return index < 0 ? undefined : args[index + 1];
};
const sourceRoot = await realpath(option('asset-root') ?? option('foxwatch-output-root') ?? resolve(foxwatchRoot, 'tmp/assets'));
const sceneRoot = option('scene-root') ?? resolve(foxwatchRoot, 'tmp/renders');
const outputRoot = option('output-root') ?? resolve(repositoryRoot, 'packages/extensions/foxhole/public/foxhole/assets');
const config = JSON.parse(await readFile(resolve(foxwatchRoot, 'asset-overrides/spatial-models.json'), 'utf8'));
const catalog = JSON.parse(await readFile(resolve(outputRoot, 'manifest.v1.json'), 'utf8'));
const only = args.flatMap((arg, index) => arg.startsWith('--only=') ? arg.slice(7).split(',')
    : arg === '--only' ? (args[index + 1] ?? '').split(',') : []).map(value => value.trim().toLowerCase()).filter(Boolean);
const policy = resolveSpatialExportPolicy(config, catalog, { only: only.length ? only : undefined, geometryProfile: option('geometry-profile') });
const categories = args.flatMap((arg, index) => arg.startsWith('--category=') ? arg.slice(11).split(',')
    : arg === '--category' ? (args[index + 1] ?? '').split(',') : []).map(value => value.trim().toLowerCase()).filter(Boolean);
const { geometryProfile } = policy;
const targets = policy.targets.filter(id => !categories.length || categories.includes(catalog.assets.find(asset => asset.id === id).categoryId));
if (policy.skipped.length) console.log(`Skipping spatial assets outside the intact asset allowlist: ${policy.skipped.join(', ')}`);
if (config.unitsPerMetre !== 32 || ![512, 1024].includes(config.maxTextureSize)) throw new Error('Invalid authored spatial export profile');
const modelRoot = resolve(outputRoot, 'models');
const temporaryRoot = option('temporary-root') ?? resolve(foxwatchRoot, 'tmp/spatial-models');
await mkdir(modelRoot, { recursive: true });
await mkdir(temporaryRoot, { recursive: true });
let manifest = { schemaVersion: 1, assets: {}, resources: {} };
try { manifest = JSON.parse(await readFile(resolve(modelRoot, 'manifest.v1.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
manifest.resources ??= {};
manifest = filterSpatialModelManifest(manifest, policy.allowedIds, { includeDamaged: config.assetSelection === 'catalog' });
manifest.packingPolicy = { assetSelection: config.assetSelection, categoryIds: config.categoryIds, assets: [...policy.allowedIds],
    defaultGeometryProfile: config.geometryProfile ?? 'curved50-compact16' };

const startedAt = performance.now();
const timings = [];
const timingReportPath = option('timing-report') ?? resolve(foxwatchRoot, 'tmp/spatial-timing-last.v1.json');
const blender = option('blender') ?? process.env.BLENDER_PATH ?? 'blender';
const repack = args.includes('--repack-existing');
const force = args.includes('--force-render') || args.includes('--force-spatial');
const blenderVersion = repack || !targets.length ? 'repack-existing'
    : (await promisify(execFile)(blender, ['--version'], { windowsHide: true })).stdout.trim();
const sourceFiles = (await readdir(resolve(foxwatchRoot, 'blender')))
    .filter(name => name.endsWith('.py') && !name.startsWith('test_'))
    .map(name => resolve(foxwatchRoot, 'blender', name));
sourceFiles.push(...['publish-spatial-models.mjs', 'spatial-model-cache.mjs', 'visual-output-cache.mjs',
    'spatial-export-policy.mjs', 'spatial-structure-profiles.mjs', 'spatial-connector-profiles.mjs', 'spatial-geometry.mjs', 'spatial-meshopt.mjs', 'spatial-gltf-geometry.mjs']
    .map(name => resolve(foxwatchRoot, 'scripts', name)));
const cache = await SpatialModelCache.create(option('cache-root') ?? resolve(foxwatchRoot, 'tmp/pipeline-cache/v1/spatial-models'),
    sourceFiles, { blender: blenderVersion, sharp: sharp.versions,
        meshoptimizer: JSON.parse(await readFile(resolve(repositoryRoot, 'node_modules/meshoptimizer/package.json'), 'utf8')).version });
const dependencies = new SpatialDependencies(sourceRoot);
const preparedStructures = new Map();
const structuralSharedIds = new Map();
try {
    const index=JSON.parse(await readFile(resolve(foxwatchRoot,'tmp/modification-render-index.v1.json'),'utf8'));
    for(const entry of Object.values(index.entries??{}))for(const consumer of entry.consumers??[])
        structuralSharedIds.set(consumer.structureId+':'+consumer.slotName+':'+consumer.variantId,entry.renderId);
}catch(error){if(error.code!=='ENOENT')throw error;}

function filteredScene(document, mode) {
    const copy = structuredClone(document);
    const visit = (node, inside = false) => {
        if (node.visible === false) return null;
        inside ||= node.id?.includes(':upgrade:');
        if (mode === 'base' && inside) return null;
        if (mode === 'upgrade' && !inside) { delete node.meshId; delete node.primitive; }
        node.children = (node.children ?? []).map(child => visit(child, inside)).filter(Boolean);
        return node;
    };
    copy.scene.roots = copy.scene.roots.map(root => visit(root)).filter(Boolean);
    return copy;
}
function meshCount(document, mode) {
    let count = 0;
    const visit = node => { if (node.meshId || node.primitive?.type === 'trench_berm') count++; node.children.forEach(visit); };
    filteredScene(document, mode).scene.roots.forEach(visit);
    return count;
}
function coreSignature(document) {
    const filtered = filteredScene(document, 'base');
    const meshIds = new Set();
    const visit = node => { if (node.meshId) meshIds.add(node.meshId); node.children.forEach(visit); };
    filtered.scene.roots.forEach(visit);
    return JSON.stringify({ scene: filtered.scene, assets: filtered.assets.meshes.filter(mesh => meshIds.has(mesh.id)) });
}

async function exportRaw(id, scenePath, slice) {
    const path = resolve(temporaryRoot, `${id}.glb`);
    const preparedPath = resolve(temporaryRoot, `${id}.scene.json`);
    const original = JSON.parse(await readFile(scenePath, 'utf8'));
    await writeJsonAtomic(preparedPath, prepareSpatialConnectorScene(id.split('.')[0], preparedStructures.get(id) ?? original));
    if (!args.includes('--repack-existing')) await run(blender, ['--background', '--python-exit-code', '1', '--python',
        resolve(foxwatchRoot, 'blender/export_scene_model.py'), '--', '--foxwatch-root', foxwatchRoot, '--asset-root', sourceRoot,
        '--scene', preparedPath, '--slice', slice, '--max-texture-size', String(config.maxTextureSize), '--output', path, '--temp-dir', temporaryRoot]);
    return { bytes: await readFile(path), exported: JSON.parse(await readFile(`${path}.json`, 'utf8')) };
}
async function publish(id, asset, scenePath, raw, groundReference, assembly) {
    const { bytes, exported } = raw;
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
    const binary = bytes.subarray(28 + jsonLength);
    const pathProfile = spatialConnectorProfile(asset.id, document, exported, JSON.parse(await readFile(resolve(sceneRoot, asset.id, 'scene.json'), 'utf8')));
    const structuralProfile = spatialStructureProfile(preparedStructures.get(id) ?? {}, exported);
    const geometryOptimization = pruneUnusedStaticGltfUvs(document);
    const imageViews = new Map((document.images ?? []).map(image => [image.bufferView, image]));
    const chunks = [];
    let length = 0;
    for (const [index, view] of document.bufferViews.entries()) {
        let content = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        if (imageViews.has(index)) {
            content = await sharp(content).resize(config.maxTextureSize, config.maxTextureSize, { fit: 'inside', withoutEnlargement: true }).webp({ quality: config.webpQuality, alphaQuality: 100, effort: 6 }).toBuffer();
            imageViews.get(index).mimeType = 'image/webp';
        }
        const padding = Buffer.alloc((4 - length % 4) % 4);
        chunks.push(padding, content); length += padding.length;
        view.byteOffset = length; view.byteLength = content.length; length += content.length;
    }
    chunks.push(Buffer.alloc((4 - length % 4) % 4));
    const compression = geometryProfile === 'lossless'
        ? await compressSpatialMeshopt(document, Buffer.concat(chunks))
        : await optimizeSpatialGeometry(document, Buffer.concat(chunks), geometryProfile);
    const packed = compression.binary;
    for (const texture of document.textures ?? []) {
        texture.extensions ??= {};
        texture.extensions.EXT_texture_webp = { source: texture.source };
        delete texture.source;
    }
    for (const key of ['extensionsUsed', 'extensionsRequired']) document[key] = [...new Set([...(document[key] ?? []), 'EXT_texture_webp'])];
    const groundZ = groundReference?.zMetres ?? 0;
    const center = exported.boundsCenterMeters;
    if (!center?.every(Number.isFinite) || !Number.isFinite(groundZ)) throw new Error(`Invalid authored origin: ${id}`);
    const anchor = { version: 1, ...exported.sceneDimensions, offsetX: center[0] * 32, offsetY: -center[1] * 32, offsetZ: (center[2] - groundZ) * 32 };
    document.asset.extras = { ...document.asset.extras, nixieModelAnchor: anchor,
        nixieBlueprintOrigin: { version: 1, x: 0, y: 0, z: -groundZ * 32 }, ...(structuralProfile ? { nixieStructuralProfile: structuralProfile } : {}), ...(assembly ? { nixieModelAssembly: assembly } : {}) };
    let json = Buffer.from(JSON.stringify(document));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + packed.length, 8);
    header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(packed.length); binHeader.writeUInt32LE(0x004e4942, 4);
    const glb = Buffer.concat([header, json, binHeader, packed]);
    if (glb.length > 32 * 1024 * 1024 || compression.decodedGeometryBytes > 128 * 1024 * 1024) throw new Error(`Model exceeds bounded resource limits: ${id} (${glb.length} bytes)`);
    await writeFile(resolve(modelRoot, `${id}.glb`), glb);
    console.log(`Published ${id}: ${glb.length} bytes; meshopt saved ${compression.bytesSaved}`);
    return { ...(structuralProfile ? { structuralProfile } : {}), ...(pathProfile ? { pathProfile } : {}), assetId: asset.id, codeName: asset.codeName, resourceId: `foxhole.model.${id}`, path: `models/${id}.glb`,
        ...exported.sceneDimensions, offsetX: anchor.offsetX, offsetY: anchor.offsetY, offsetZ: anchor.offsetZ,
        blueprintOrigin: { x: 0, y: 0, z: -groundZ * 32 }, groundReference: groundReference ?? { zMetres: 0, basis: 'blueprint-origin' },
        triangles: compression.precisionOptimization?.triangles ?? exported.triangles, ...geometryOptimization, meshoptBytesSaved: compression.bytesSaved,
        ...(compression.precisionOptimization ? { geometryProfile, precisionOptimization: compression.precisionOptimization } : {}),
        ...(compression.compactVertexOptimization ? { sourceTriangles: exported.triangles, compactVertexOptimization: compression.compactVertexOptimization } : {}),
        bytes: glb.length, sha256: createHash('sha256').update(glb).digest('hex'),
        source: { sceneSha256: createHash('sha256').update(await readFile(scenePath)).digest('hex'), unitsPerMetre: 32,
            maxTextureSize: config.maxTextureSize, webpQuality: config.webpQuality } };
}
const descriptor = metadata => Object.fromEntries(['resourceId', 'width', 'height', 'depth', 'offsetX', 'offsetY', 'offsetZ'].map(key => [key, metadata[key]]));

try {
for (const id of targets) {
    const assetStartedAt = performance.now();
    const timing = { id, status: 'failed', checkMs: 0, exportMs: 0, packMs: 0, models: 0 };
    timings.push(timing);
    try {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Excluded spatial asset: ${id}`);
    const asset = catalog.assets.find(entry => entry.id === id);
    if (!asset) throw new Error(`Missing real catalog entry: ${id}`);
    const scenePath = resolve(sceneRoot, id, 'scene.json');
    let scene;
    try { scene = JSON.parse(await readFile(scenePath, 'utf8')); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        timing.status = 'skipped'; timing.reason = 'No extracted scene';
        delete manifest.assets[id];
        for (const [key, value] of Object.entries(manifest.resources)) if (value.assetId === id) delete manifest.resources[key];
        continue;
    }
    if (!meshCount(scene, 'whole')) {
        timing.status = 'skipped'; timing.reason = 'Scene has no visible static mesh';
        delete manifest.assets[id];
        for (const [key, value] of Object.entries(manifest.resources)) if (value.assetId === id) delete manifest.resources[key];
        continue;
    }
    scene = await prepareSpatialStructureModifications(asset,prepareSpatialStructureScene(asset, scene),async path=>{
        if(!/^[a-z0-9/-]+\.scene\.json$/.test(path))throw Error('Invalid structural scene reference');
        try{return JSON.parse(await readFile(resolve(sceneRoot,path),'utf8'));}
        catch(error){if(error.code==='ENOENT')return undefined;throw error;}
    },structuralSharedIds);
    preparedStructures.set(id, scene);
    const upgrades = (asset.modifications ?? []).flatMap(slot => Object.entries(slot.variants ?? {})
        .filter(([variantId, variant]) => variant.isUpgrade)
        .map(([variantId]) => ({ slotId: slot.name, variantId })));
    const useAssembly = config.includeUpgrades && upgrades.length > 0;
    const hasCore = meshCount(scene, 'base') > 0;
    const scenes = [[scenePath, scene]];
    if (useAssembly) for (const upgrade of upgrades) {
        const path = resolve(sceneRoot, id, 'modifications', `${upgrade.variantId}.scene.json`);
        scenes.push([path, JSON.parse(await readFile(path, 'utf8'))]);
    }
    const partIds = useAssembly ? [
        ...(hasCore && meshCount(scene, 'upgrade') ? [`${id}.default`] : []),
        ...upgrades.map(upgrade => `${id}.upgrade.${upgrade.variantId}`),
    ] : [];
    const outputIds = [id, ...partIds];
    const inputs = [];
    for (const [path, document] of scenes) inputs.push({ path, document, dependencies: await dependencies.scene(prepareSpatialConnectorScene(id, document)) });
    if (repack) for (const outputId of outputIds) for (const suffix of ['.glb', '.glb.json']) {
        const path = resolve(temporaryRoot, outputId + suffix);
        inputs.push({ path, hash: createHash('sha256').update(await readFile(path)).digest('hex') });
    }
    const identity = cache.identity(id, inputs, { geometryProfile, unitsPerMetre: config.unitsPerMetre,
        maxTextureSize: config.maxTextureSize, webpQuality: config.webpQuality, includeUpgrades: config.includeUpgrades,
        grounded: !!(config.groundAllVehicles && asset.isVehicle || config.groundedVehicles?.includes(id)), groundReference: config.placementGroundReferences?.[id],
        codeName: asset.codeName, upgrades, repack }, outputIds.map(outputId => resolve(modelRoot, `${outputId}.glb`)));
    const cached = force ? null : await cache.lookup(identity);
    timing.checkMs = performance.now() - assetStartedAt;
    timing.models = outputIds.length;
    if (cached) {
        for (const [key, value] of Object.entries(manifest.resources)) if (value.assetId === id) delete manifest.resources[key];
        manifest.assets[id] = cached.asset;
        Object.assign(manifest.resources, cached.resources);
        await writeJsonAtomic(resolve(modelRoot, 'manifest.v1.json'), manifest);
        timing.status = 'reused';
        continue;
    }
    const raw = await timedExport(id, scenePath, useAssembly && hasCore ? 'base' : 'whole');
    let groundReference = config.placementGroundReferences?.[id];
    if (config.groundAllVehicles && asset.isVehicle || config.groundedVehicles?.includes(id)) groundReference = { zMetres: raw.exported.boundsMinMeters[2], basis: 'static-vehicle-contact' };
    for (const [key, value] of Object.entries(manifest.resources)) if (value.assetId === id) delete manifest.resources[key];
    let assembly;
    if (useAssembly) {
        assembly = { version: 1, scale: 32, slots: [] };
        const slots = [...new Set(upgrades.map(value => value.slotId))];
        if (slots.length !== 1) throw new Error(`Multiple upgrade slots require authored scene slices: ${id}`);
        const slot = { id: 'upgrade', componentId: 'modification', field: 'selections', options: [] };
        if (hasCore && meshCount(scene, 'upgrade')) {
            const partId = `${id}.default`;
            const part = await timedPublish(partId, asset, scenePath, await timedExport(partId, scenePath, 'upgrade'), groundReference);
            manifest.resources[partId] = part;
            slot.default = descriptor(part);
        }
        for (const upgrade of upgrades) {
            const path = resolve(sceneRoot, id, 'modifications', `${upgrade.variantId}.scene.json`);
            const upgraded = JSON.parse(await readFile(path, 'utf8'));
            const replacesBase = !hasCore || coreSignature(scene) !== coreSignature(upgraded) || !meshCount(upgraded, 'upgrade');
            const partId = `${id}.upgrade.${upgrade.variantId}`;
            const part = await timedPublish(partId, asset, path, await timedExport(partId, path, replacesBase ? 'whole' : 'upgrade'), groundReference);
            manifest.resources[partId] = part;
            slot.options.push({ match: { slotId: upgrade.slotId, variantId: upgrade.variantId }, part: { ...descriptor(part), replacesBase } });
        }
        assembly.slots.push(slot);
    }
    manifest.assets[id] = await timedPublish(id, asset, scenePath, raw, groundReference, assembly);
    await writeJsonAtomic(resolve(modelRoot, 'manifest.v1.json'), manifest);
    await cache.record(identity, { asset: manifest.assets[id], resources: Object.fromEntries(
        Object.entries(manifest.resources).filter(([, value]) => value.assetId === id)) });
    timing.status = 'exported';

    async function timedExport(...parameters) {
        const start = performance.now();
        try { return await exportRaw(...parameters); } finally { timing.exportMs += performance.now() - start; }
    }
    async function timedPublish(...parameters) {
        const start = performance.now();
        try { return await publish(...parameters); } finally { timing.packMs += performance.now() - start; }
    }
    } catch (error) {
        timing.error = error.message;
        delete manifest.assets[id];
        for (const [key, value] of Object.entries(manifest.resources)) if (value.assetId === id) delete manifest.resources[key];
        console.error(`Spatial ${id} failed: ${error.message}`);
    } finally {
        timing.totalMs = performance.now() - assetStartedAt;
        console.log(`Spatial ${id}: ${timing.status}${timing.reason ? ` (${timing.reason})` : ''}, ${(timing.totalMs / 1000).toFixed(2)}s (check ${(timing.checkMs / 1000).toFixed(2)}s, export ${(timing.exportMs / 1000).toFixed(2)}s, pack ${(timing.packMs / 1000).toFixed(2)}s)`);
    }
}
await writeJsonAtomic(resolve(modelRoot, 'manifest.v1.json'), manifest);
if (timings.some(row => row.status === 'failed')) process.exitCode = 1;
} finally {
    const report = { schemaVersion: 1, createdAt: new Date().toISOString(), totalMs: performance.now() - startedAt,
        exported: timings.filter(row => row.status === 'exported').length,
        reused: timings.filter(row => row.status === 'reused').length,
        skipped: timings.filter(row => row.status === 'skipped').length,
        failed: timings.filter(row => row.status === 'failed').length, assets: timings };
    await writeJsonAtomic(timingReportPath, report);
    console.log(`Spatial models: ${report.exported} exported, ${report.reused} reused, ${report.skipped} skipped, ${report.failed} failed; ${(report.totalMs / 1000).toFixed(2)}s. Timings: ${timingReportPath}`);
}

function run(command, arguments_) {
    return new Promise((resolve_, reject) => {
        const child = spawn(command, arguments_, { stdio: 'inherit', windowsHide: true });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve_() : reject(new Error(`Spatial export failed (${code})`)));
    });
}
