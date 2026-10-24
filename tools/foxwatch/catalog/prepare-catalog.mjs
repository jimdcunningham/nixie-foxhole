import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync, constants} from 'node:zlib';
import {parseNixieExperimentalProductCatalogV1, resolveNixieExperimentalProductCatalogResourcesV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
import {validateTarget, portablePath} from '../scripts/asset-pack-publication.mjs';
import {createBrowserAtlas} from './browser-atlas-images.ts';
import {readCatalogSources} from './read-catalog-sources.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = bytes => ({sha256: hash(bytes), byteLength: bytes.length});
const inside = (root, candidate) => { const relative = path.relative(root, candidate); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); };

/** Prepare only: the frozen readable snapshot and upload plan never contact R2. */
export async function prepareProductCatalog({assetsRoot, output, assetRelease, target: rawTarget, sources, atlas = createBrowserAtlas, onProgress = () => {}}) {
    const target = validateTarget(rawTarget);
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(assetRelease) || ['.', '..'].includes(assetRelease)) throw Error('Choose a readable immutable asset release ID');
    const root = await fs.realpath(assetsRoot);
    const directory = path.resolve(output);
    await fs.mkdir(path.dirname(directory), {recursive: true});
    const parent = await fs.realpath(path.dirname(directory));
    if (inside(root, path.join(parent, path.basename(directory))) || inside(directory, root)) throw Error('Catalog snapshot must be outside generated input assets');
    await fs.mkdir(directory);
    sources ??= await readCatalogSources(root);
    const releaseRoot = target.prefix + '/releases/' + assetRelease + '/';
    const catalog = {catalogSchemaVersion: 1, assetRelease, releaseRoot, resourceDefaults: {
        icon: {pathTemplate: 'types/{assetGroup}/{id}/{id}.icon.{variant}.webp', resourcePathTemplate: 'icons/{id}.webp', variant: 'default', mediaType: 'image/webp'},
        texture: {pathTemplate: 'types/{assetGroup}/{id}/{id}.texture.{variant}.webp', resourcePathTemplate: 'textures/{id}.webp', variant: 'default', mediaType: 'image/webp'},
        model: {pathTemplate: 'types/{assetGroup}/{id}/{id}.model.{variant}.glb', resourcePathTemplate: 'models/{id}.{variant}.glb', variant: 'base', mediaType: 'model/gltf-binary'},
    }, products: sources.assets.map(asset => ({id: asset.id, assetGroup: asset.assetGroup, resources: {}, data: sources.metadata[asset.id]})), sharedResources: [], data: sources.data};
    const products = new Map(catalog.products.map(product => [product.id, product]));
    const objects = [], keys = new Set();
    async function snapshot(relativePath, source, mediaType, phase = 'assets') {
        portablePath(relativePath);
        const key = releaseRoot + relativePath;
        if (keys.has(key)) throw Error('Duplicate catalog delivery path: ' + key);
        keys.add(key);
        let bytes;
        if (Buffer.isBuffer(source)) bytes = source;
        else {
            portablePath(source);
            const actual = await fs.realpath(path.join(root, source));
            if (!inside(root, actual)) throw Error('Catalog source escapes generated assets');
            bytes = await fs.readFile(actual);
        }
        if (bytes.length > 32 * 1024 ** 2) throw Error('Catalog media exceeds the render budget: ' + relativePath);
        const decoded = receipt(bytes);
        const compressed = mediaType === 'model/gltf-binary' && bytes.length > 1024;
        const encoded = compressed ? brotliCompressSync(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 5}}) : bytes;
        const file = 'payload/' + relativePath;
        await fs.mkdir(path.dirname(path.join(directory, file)), {recursive: true});
        await fs.writeFile(path.join(directory, file), encoded, {flag: 'wx'});
        objects.push({relativeKey: 'releases/' + assetRelease + '/' + relativePath, key, file, phase,
            sha256: hash(encoded), bytes: encoded.length, mediaType, ...(compressed ? {contentEncoding: 'br'} : {}),
            decodedSha256: decoded.sha256, decodedBytes: decoded.byteLength, cacheControl: 'public, max-age=31536000, immutable'});
        onProgress({objects: objects.length, path: relativePath});
        return decoded;
    }
    for (const asset of sources.assets) {
        const product = products.get(asset.id);
        for (const role of ['icon', 'texture']) {
            const file = 'types/' + asset.assetGroup + '/' + asset.id + '/' + asset.id + '.' + role + '.default.webp';
            product.resources[role] = [await snapshot(file, asset[role], 'image/webp')];
        }
    }
    const sharedModels = sources.models.filter(model => model.sharedPart).sort((a,b) => a.id.localeCompare(b.id, 'en'));
    for (const [index, model] of sharedModels.entries()) {
        const file = 'shared/models/part-' + String(index + 1).padStart(4, '0') + '.glb';
        catalog.sharedResources.push({id: model.id, path: file, ...await snapshot(file, model.path, 'model/gltf-binary'), mediaType: 'model/gltf-binary'});
    }
    for (const model of sources.models.filter(model => !model.sharedPart)) {
        const product = products.get(model.assetId);
        if (!product) throw Error('Model has no catalog product: ' + model.assetId);
        const variant = model.id === model.assetId ? 'base' : model.id.slice(model.assetId.length + 1);
        if (variant === 'base' && model.id !== model.assetId) throw Error('Model variant collides with base identity');
        const file = 'types/' + product.assetGroup + '/' + product.id + '/' + product.id + '.model.' + variant + '.glb';
        (product.resources.model ??= []).push({...await snapshot(file, model.path, 'model/gltf-binary'), variant,
            ...(model.dependencyIds?.length ? {dependencies: model.dependencyIds} : {})});
    }
    for (let start = 0; start < sources.browserImageSources.length; start += 64) {
        const id = String(start / 64), file = 'shared/icons/browser-' + id + '.webp';
        const bytes = await atlas(sources.browserImageSources.slice(start, start + 64).map(source => path.join(root, source)));
        catalog.sharedResources.push({id: 'browser.' + id, path: file, ...await snapshot(file, bytes, 'image/webp'), mediaType: 'image/webp'});
    }
    for (const [group, rows] of [['modifications', sources.modifications], ['visuals', sources.visuals]]) for (const row of rows) {
        const file = 'shared/' + group + '/' + row.id + '.webp';
        catalog.sharedResources.push({id: group + '.' + row.id, path: file, ...await snapshot(file, row.sourcePath, 'image/webp'), mediaType: 'image/webp'});
    }
    for (const resource of sources.maps.resources) {
        const file = 'maps/' + resource.id.slice('foxhole.map.'.length) + '.webp';
        catalog.sharedResources.push({id: 'map.' + resource.id.slice('foxhole.map.'.length), path: file,
            ...await snapshot(file, resource.sourcePath, 'image/webp'), mediaType: 'image/webp'});
    }
    const buildInputs = {};
    for (const name of sources.buildInputs ?? []) {
        portablePath(name);
        const file = 'source/' + name;
        buildInputs[name] = {path: file, ...await snapshot(file, name, 'application/json')};
    }
    const normalized = parseNixieExperimentalProductCatalogV1(JSON.parse(JSON.stringify(catalog)));
    const decoded = Buffer.from(JSON.stringify(normalized));
    const document = {url: new URL(releaseRoot + 'catalog.v1.json', target.publicBaseUrl).href, ...receipt(decoded)};
    await snapshot('catalog.v1.json', decoded, 'application/json', 'indexes');
    await fs.writeFile(path.join(directory, 'catalog.v1.json'), decoded, {flag: 'wx'});
    const completion = Buffer.from(JSON.stringify({schemaVersion: 1, format: 'foxwatch-product-catalog-release-v1', assetRelease, catalog: document, buildInputs}));
    const release = {url: new URL(releaseRoot + 'release.json', target.publicBaseUrl).href, ...receipt(completion)};
    await snapshot('release.json', completion, 'application/json', 'release');
    const body = {schemaVersion: 1, target, inventorySha256: document.sha256, release, objects,
        summary: {sourceFiles: objects.length - 2, objects: objects.length, bytes: objects.reduce((sum,row) => sum + row.bytes, 0), packs: 1}};
    await fs.writeFile(path.join(directory, 'plan.json'), JSON.stringify({...body, planSha256: hash(Buffer.from(JSON.stringify(body)))}, null, 2) + '\n', {flag: 'wx'});
    const pin = {schemaVersion: 1, baseUrl: target.publicBaseUrl, catalog: document, completion: release};
    await fs.writeFile(path.join(directory, 'extension-pin.json'), JSON.stringify(pin, null, 2) + '\n', {flag: 'wx'});
    return {directory, planPath: path.join(directory, 'plan.json'), pin, products: normalized.products.length,
        resources: resolveNixieExperimentalProductCatalogResourcesV1(normalized).assets.length, catalogBytes: decoded.length};
}
