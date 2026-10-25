import {existingAssetObjects,existingAssetIdentity} from '../scripts/existing-objects.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync, brotliDecompressSync, gunzipSync, constants} from 'node:zlib';
import {parseNixieExperimentalProductCatalogV1, resolveNixieExperimentalProductCatalogResourcesV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
import {validateTarget, portablePath, fileHash} from '../scripts/asset-pack-publication.mjs';
import {createBrowserAtlas} from './browser-atlas-images.ts';
import {readCatalogSources} from './read-catalog-sources.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = bytes => ({sha256: hash(bytes), byteLength: bytes.length});
const inside = (root, candidate) => {const relative = path.relative(root, candidate); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);};
const suffix = mediaType => {
    const extension = {'image/webp': 'webp', 'model/gltf-binary': 'glb', 'application/json': 'json'}[mediaType];
    if (!extension) throw Error('Unsupported catalog object type: ' + mediaType);
    return extension;
};

/** Prepare shared immutable objects and a pinned catalog; never contacts R2. */
export async function prepareProductCatalog({assetsRoot, output, target: rawTarget, sources, existingInventory, readExistingObject, atlas = createBrowserAtlas, onProgress = () => {}}) {
    const target = validateTarget(rawTarget);
    const existing = existingAssetObjects(existingInventory, target);
    if (target.prefix !== 'foxhole-planner') throw Error('Foxhole publication must use the foxhole-planner prefix');
    const root = await fs.realpath(assetsRoot), directory = path.resolve(output);
    await fs.mkdir(path.dirname(directory), {recursive: true});
    const parent = await fs.realpath(path.dirname(directory));
    if (inside(root, path.join(parent, path.basename(directory))) || inside(directory, root)) throw Error('Catalog snapshot must be outside generated input assets');
    await fs.mkdir(directory);
    sources ??= await readCatalogSources(root);
    const objectPath = (pinned, type) => target.prefix + '/objects/' + pinned.sha256 + '.' + suffix(type);
    const catalog = {catalogSchemaVersion: 1, resourceDefaults: {
        icon: {pathTemplate: target.prefix + '/objects/{sha256}.webp', resourcePathTemplate: 'icons/{id}.webp', variant: 'default', mediaType: 'image/webp'},
        texture: {pathTemplate: target.prefix + '/objects/{sha256}.webp', resourcePathTemplate: 'textures/{id}.webp', variant: 'default', mediaType: 'image/webp'},
        model: {pathTemplate: target.prefix + '/objects/{sha256}.glb', resourcePathTemplate: 'models/{id}.{variant}.glb', variant: 'base', mediaType: 'model/gltf-binary'},
    }, products: sources.assets.map(asset => ({id: asset.id, assetGroup: asset.assetGroup, resources: {}, data: sources.metadata[asset.id]})), sharedResources: [], data: sources.data};
    const products = new Map(catalog.products.map(product => [product.id, product]));
    const objects = new Map(), privateFiles = {}; let sourceFiles = 0;
    async function snapshot(logicalPath, source, mediaType, phase = 'assets') {
        portablePath(logicalPath); sourceFiles++;
        let bytes;
        if (Buffer.isBuffer(source)) bytes = source;
        else {
            portablePath(source);
            const actual = await fs.realpath(path.join(root, source));
            if (!inside(root, actual)) throw Error('Catalog source escapes generated assets');
            bytes = await fs.readFile(actual);
        }
        if (bytes.length > 32 * 1024 ** 2) throw Error('Catalog media exceeds the render budget: ' + logicalPath);
        const decoded = receipt(bytes); let key = objectPath(decoded, mediaType);
        const compressed = mediaType === 'model/gltf-binary' && bytes.length > 1024;
        let encoded = compressed ? brotliCompressSync(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 5}}) : bytes;
        const candidates = phase === 'assets' ? existing.byIdentity.get(existingAssetIdentity({decodedSha256:decoded.sha256,decodedBytes:decoded.byteLength,mediaType})) ?? [] : [];
        const reused = candidates.find(row => row.key === key)
            ?? candidates.find(row => row.sha256 === hash(encoded) && row.bytes === encoded.length && row.contentEncoding === (compressed ? 'br' : undefined))
            ?? candidates[0];
        if (reused) {
            if (hash(encoded) !== reused.sha256 || encoded.length !== reused.bytes || reused.contentEncoding !== (compressed ? 'br' : undefined)) {
                if (!readExistingObject) throw Error('Existing object representation requires a verified encoded read: ' + reused.key);
                encoded = Buffer.from(await readExistingObject(reused.key));
                if (encoded.length !== reused.bytes || hash(encoded) !== reused.sha256) throw Error('Existing encoded object differs from inventory: ' + reused.key);
                const decodedExisting = reused.contentEncoding === 'br' ? brotliDecompressSync(encoded,{maxOutputLength:32*1024**2})
                    : reused.contentEncoding === 'gzip' ? gunzipSync(encoded,{maxOutputLength:32*1024**2}) : encoded;
                if (!decodedExisting.equals(bytes)) throw Error('Existing decoded object differs from source: ' + reused.key);
            }
            key = reused.key;
        }
        const file = 'payload/' + decoded.sha256 + '.' + suffix(mediaType);
        const row = {relativeKey: key.slice(target.prefix.length + 1), key, file, phase,
            sha256: hash(encoded), bytes: encoded.length, mediaType, ...((reused?.contentEncoding ?? (reused ? undefined : compressed ? 'br' : undefined)) ? {contentEncoding: reused?.contentEncoding ?? 'br'} : {}),
            decodedSha256: decoded.sha256, decodedBytes: decoded.byteLength, cacheControl: reused?.cacheControl ?? 'public, max-age=31536000, immutable'};
        const previous = objects.get(key);
        if (previous) {
            if (['sha256','bytes','mediaType','contentEncoding','decodedSha256','decodedBytes','cacheControl'].some(name => previous[name] !== row[name])) throw Error('Conflicting catalog object representation: ' + key);
        } else {
            await fs.mkdir(path.dirname(path.join(directory, file)), {recursive: true});
            await fs.writeFile(path.join(directory, file), encoded, {flag: 'wx'});
            objects.set(key, row);
        }
        onProgress({objects: objects.size, path: logicalPath});
        return {...decoded, ...(key === objectPath(decoded,mediaType) ? {} : {sourcePath:key})};
    }
    async function shared(id, logicalPath, source, mediaType) {
        const pinned = await snapshot(logicalPath, source, mediaType);
        catalog.sharedResources.push({id, path: logicalPath, sourcePath: pinned.sourcePath ?? objectPath(pinned, mediaType), ...pinned, mediaType});
        if (typeof source === 'string') privateFiles[source] = logicalPath;
    }
    for (const asset of sources.assets) {
        const product = products.get(asset.id);
        for (const role of ['icon', 'texture']) {
            product.resources[role] = [await snapshot(role + 's/' + asset.id + '.webp', asset[role], 'image/webp')];
            privateFiles[asset[role]] = role + 's/' + asset.id + '.webp';
        }
    }
    const sharedModels = sources.models.filter(model => model.sharedPart).sort((a,b) => a.id.localeCompare(b.id, 'en'));
    for (const [index, model] of sharedModels.entries()) {
        await shared(model.id, 'shared/models/part-' + String(index + 1).padStart(4, '0') + '.glb', model.path, 'model/gltf-binary');
    }
    for (const model of sources.models.filter(model => !model.sharedPart)) {
        const product = products.get(model.assetId);
        if (!product) throw Error('Model has no catalog product: ' + model.assetId);
        const variant = model.id === model.assetId ? 'base' : model.id.slice(model.assetId.length + 1);
        if (variant === 'base' && model.id !== model.assetId) throw Error('Model variant collides with base identity');
        (product.resources.model ??= []).push({...await snapshot('models/' + product.id + '.' + variant + '.glb', model.path, 'model/gltf-binary'), variant,
            ...(model.dependencyIds?.length ? {dependencies: model.dependencyIds} : {})});
        privateFiles[model.path] = 'models/' + product.id + '.' + variant + '.glb';
    }
    for (let start = 0; start < sources.browserImageSources.length; start += 64) {
        const id = String(start / 64), file = 'shared/icons/browser-' + id + '.webp';
        const bytes = await atlas(sources.browserImageSources.slice(start, start + 64).map(source => path.join(root, source)));
        await shared('browser.' + id, file, bytes, 'image/webp');
    }
    for (const [group, rows] of [['modifications', sources.modifications], ['visuals', sources.visuals]]) for (const row of rows) {
        await shared(group + '.' + row.id, 'shared/' + group + '/' + row.id + '.webp', row.sourcePath, 'image/webp');
    }
    for (const resource of sources.maps.resources) {
        const id = resource.id.slice('foxhole.map.'.length);
        await shared('map.' + id, 'maps/' + id + '.webp', resource.sourcePath, 'image/webp');
    }
    const buildInputs = {};
    for (const name of sources.buildInputs ?? []) {
        portablePath(name);
        const content = sources.buildInputContents?.[name];
        const pinned = await snapshot('source/' + name, content === undefined ? name : Buffer.from(content), 'application/json');
        buildInputs[name] = {...pinned, path: pinned.sourcePath ?? objectPath(pinned, 'application/json')};
        const logical = 'shared/private/' + hash(Buffer.from(name)) + '.json';
        catalog.sharedResources.push({id: 'input.' + hash(Buffer.from(name)), path: logical, sourcePath: buildInputs[name].path, ...pinned, mediaType: 'application/json'});
        privateFiles[name] = logical;
    }
    for (const source of sources.privateSources ?? []) {
        if (privateFiles[source]) continue;
        const mediaType = source.endsWith('.webp') ? 'image/webp' : source.endsWith('.glb') ? 'model/gltf-binary' : source.endsWith('.json') ? 'application/json' : null;
        if (!mediaType || /\.preview(?:\.|$)/.test(source)) throw Error('Unsupported private catalog source: ' + source);
        await shared('private.' + hash(Buffer.from(source)), 'shared/private/' + hash(Buffer.from(source)) + '.' + suffix(mediaType), source, mediaType);
    }
    if (sources.world) {
        if (!sources.world.valid || sources.world.issues?.length) throw Error('World publication graph must be valid');
        const contentResources = {};
        for (const row of sources.world.objects) {
            if (row.path.startsWith('world/content/')) {
                const actual = await fs.realpath(path.join(root, row.path));
                if (!inside(root, actual)) throw Error('World source escapes generated assets');
                const key = target.prefix + '/' + row.path, file = 'payload/' + row.path;
                await fs.mkdir(path.dirname(path.join(directory, file)), {recursive: true});
                await fs.copyFile(actual, path.join(directory, file));
                const copied = await fileHash(path.join(directory, file));
                if (copied.sha256 !== row.sha256 || copied.bytes !== row.bytes) throw Error('World resource changed after inventory: ' + row.path);
                objects.set(key, {key, relativeKey: row.path, file, phase: 'assets', sha256: row.sha256, bytes: row.bytes,
                    mediaType: row.contentType, ...(row.contentEncoding ? {contentEncoding: row.contentEncoding} : {}),
                    decodedSha256: row.decodedSha256, decodedBytes: row.decodedBytes, cacheControl: 'public, max-age=31536000, immutable'});
                contentResources[row.path.slice('world/'.length)] = {sha256: row.decodedSha256, byteLength: row.decodedBytes, mediaType: row.contentType};
                sourceFiles++;
            } else if (!privateFiles[row.path]) {
                const id = 'private.' + hash(Buffer.from(row.path));
                await shared(id, 'shared/private/' + hash(Buffer.from(row.path)) + '.' + suffix(row.contentType), row.path, row.contentType);
            }
        }
        const worldIndex = catalog.sharedResources.find(row => row.path === privateFiles['world/index.json']);
        if (!worldIndex) throw Error('World index was not prepared');
        catalog.data = {...catalog.data, world: {indexResourcePath: worldIndex.path, contentRoot: target.prefix + '/world/', contentResources}};
    }
    catalog.data = {...catalog.data, privateFiles: Object.fromEntries(Object.entries(privateFiles).sort(([a], [b]) => a.localeCompare(b, 'en')))};
    const normalized = parseNixieExperimentalProductCatalogV1(JSON.parse(JSON.stringify(catalog)));
    const decoded = Buffer.from(JSON.stringify(normalized));
    const documentReceipt = await snapshot('catalog.v1.json', decoded, 'application/json', 'indexes');
    const document = {url: new URL(objectPath(documentReceipt, 'application/json'), target.publicBaseUrl).href, ...documentReceipt};
    await fs.writeFile(path.join(directory, 'catalog.v1.json'), decoded, {flag: 'wx'});
    const completion = Buffer.from(JSON.stringify({schemaVersion: 1, format: 'foxwatch-product-catalog-release-v1', catalog: document, buildInputs}));
    const completionReceipt = await snapshot('completion.json', completion, 'application/json', 'release');
    const release = {url: new URL(objectPath(completionReceipt, 'application/json'), target.publicBaseUrl).href, ...completionReceipt};
    const rows = [...objects.values()];
    const body = {schemaVersion: 1, target, ...(existing.proof ? {reuseInventory:existing.proof} : {}), inventorySha256: document.sha256, release, objects: rows,
        summary: {sourceFiles: sourceFiles - 2, objects: rows.length, bytes: rows.reduce((sum,row) => sum + row.bytes, 0), packs: 1}};
    await fs.writeFile(path.join(directory, 'plan.json'), JSON.stringify({...body, planSha256: hash(Buffer.from(JSON.stringify(body)))}, null, 2) + '\n', {flag: 'wx'});
    const pin = {schemaVersion: 1, baseUrl: target.publicBaseUrl, catalog: document, completion: release};
    await fs.writeFile(path.join(directory, 'extension-pin.json'), JSON.stringify(pin, null, 2) + '\n', {flag: 'wx'});
    return {directory, planPath: path.join(directory, 'plan.json'), pin, products: normalized.products.length,
        resources: resolveNixieExperimentalProductCatalogResourcesV1(normalized).assets.length, catalogBytes: decoded.length, omittedOptionalIcons: sources.omittedOptionalIcons ?? []};
}
