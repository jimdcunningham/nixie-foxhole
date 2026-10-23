import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createBrotliCompress, brotliCompressSync, constants} from 'node:zlib';
import {buildAssetPublicationInventory, publicationPath} from './asset-publication-inventory.mjs';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const order = rows => [...rows].sort((a, b) => a.localeCompare(b, 'en'));
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const inside = (root, candidate) => {const relative = path.relative(root, candidate); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);};
export function portablePath(value) {
    publicationPath(value);
    if (value.length > 512 || !/^[A-Za-z0-9_./-]+$/.test(value)) throw new Error('Asset pack path is not portable: ' + value);
    return value;
}
export function validateTarget(value) {
    if (!value || Object.keys(value).some(key => !['endpoint', 'bucket', 'publicBaseUrl', 'prefix'].includes(key))) throw new Error('Invalid publication target fields');
    const endpoint = new URL(value.endpoint), base = new URL(value.publicBaseUrl);
    for (const url of [endpoint, base]) if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Publication targets require HTTPS without credentials or query strings');
    if (endpoint.pathname !== '/' || !base.pathname.endsWith('/') || base.href !== value.publicBaseUrl) throw new Error('Use an origin endpoint and canonical public directory URL');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket) || !value.prefix) throw new Error('Publication requires a bucket and nonempty isolated prefix');
    portablePath(value.prefix);
    return {endpoint: endpoint.origin, bucket: value.bucket, publicBaseUrl: base.href, prefix: value.prefix};
}
export async function fileHash(file) {
    const digest = createHash('sha256'), md5 = createHash('md5'); let bytes = 0;
    for await (const chunk of createReadStream(file)) {digest.update(chunk); md5.update(chunk); bytes += chunk.length;}
    return {sha256: digest.digest('hex'), bytes, md5: md5.digest('base64')};
}
async function canonicalOutput(output, root) {
    let parent = path.resolve(output), suffix = [];
    while (true) {try {parent = await fs.realpath(parent); break;} catch (error) {if (error.code !== 'ENOENT') throw error; suffix.unshift(path.basename(parent)); parent = path.dirname(parent);}}
    const result = path.join(parent, ...suffix);
    if (inside(root, result) || inside(result, root)) throw new Error('Prepare output must be separate from the served assets tree');
    return result;
}
function verifyInventory(inventory) {
    const {inventorySha256, ...body} = inventory;
    if (inventory.schemaVersion !== 1 || inventory.validation !== 'encoded-and-http-decoded-receipts' || !inventory.valid
        || inventory.issues.length || hash(json(body)) !== inventorySha256) throw new Error('A valid, unchanged publication inventory is required');
}

/** Snapshot verified payloads. Existing source assets and previous releases are never changed. */
export async function prepareAssetPublication({assetsRoot, output, target: inputTarget, inventory: supplied, concurrency = 4, onProgress = () => {}}) {
    const target = validateTarget(inputTarget), root = await fs.realpath(assetsRoot);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Concurrency must be between 1 and 16');
    const inventory = supplied ?? await buildAssetPublicationInventory({assetsRoot: root, onProgress: progress => onProgress({phase: 'inventory', ...progress})});
    verifyInventory(inventory);
    const directory = await canonicalOutput(output, root);
    await fs.mkdir(path.dirname(directory), {recursive: true});
    await fs.mkdir(directory); // Refuse to overwrite any prepared or failed publication.
    await fs.mkdir(path.join(directory, 'payload'));
    const rows = new Map(), objects = new Map(); let cursor = 0, completed = 0;
    const addObject = async (temporary, item) => {
        const file = `payload/${item.sha256}.bin`, destination = path.join(directory, file);
        if (await fs.stat(destination).then(() => true).catch(() => false)) {
            if ((await fileHash(destination)).sha256 !== item.sha256) throw new Error('Prepared object hash collision');
            await fs.unlink(temporary);
        } else await fs.rename(temporary, destination);
        const row = {...item, key: `${target.prefix}/${item.relativeKey}`, file, cacheControl: CACHE_CONTROL};
        const existing = objects.get(row.key);
        if (existing && JSON.stringify(existing) !== JSON.stringify(row)) throw new Error('Conflicting object metadata for ' + row.key);
        objects.set(row.key, row); return row;
    };
    // Serialize final renames so shared hashes cannot race on Windows.
    let stores = Promise.resolve();
    const store = (temporary, item) => {const next = stores.then(() => addObject(temporary, item)); stores = next.catch(() => {}); return next;};
    await Promise.all(Array.from({length: concurrency}, async () => {
        while (cursor < inventory.objects.length) {
            const source = inventory.objects[cursor++]; portablePath(source.path);
            if (source.decodedBytes < 0 || source.decodedBytes > 512 * 1024 ** 2) throw new Error('Asset exceeds SDK data receipt budget: ' + source.path);
            const actual = await fs.realpath(path.join(root, source.path));
            if (!inside(root, actual) || actual === root) throw new Error('Asset escapes its source root');
            const temporary = path.join(directory, 'payload', randomUUID() + '.tmp');
            const originalHash = createHash('sha256'), encodedHash = createHash('sha256'); let originalBytes = 0, encodedBytes = 0;
            const compress = !source.path.startsWith('world/content/') && !source.contentEncoding && source.contentType === 'model/gltf-binary' && source.bytes > 1024;
            await pipeline(createReadStream(actual), new Transform({transform(chunk, _, done) {originalHash.update(chunk); originalBytes += chunk.length; done(null, chunk);}}),
                ...(compress ? [createBrotliCompress({params: {[constants.BROTLI_PARAM_QUALITY]: 5}})] : []),
                new Transform({transform(chunk, _, done) {encodedHash.update(chunk); encodedBytes += chunk.length; done(null, chunk);}}), createWriteStream(temporary, {flags: 'wx'}));
            if (originalHash.digest('hex') !== source.sha256 || originalBytes !== source.bytes) throw new Error('Asset changed after inventory: ' + source.path);
            const sha256 = encodedHash.digest('hex'), contentEncoding = compress ? 'br' : source.contentEncoding;
            const suffix = {'model/gltf-binary': '.glb', 'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'application/json': '.json'}[source.contentType] ?? path.extname(source.path);
            const relativeKey = source.path.startsWith('world/content/') ? source.path
                : `objects/${contentEncoding ?? 'raw'}/${sha256}/${hash(source.contentType).slice(0, 12)}/asset${suffix}`;
            const object = await store(temporary, {relativeKey, phase: 'assets', sha256, bytes: encodedBytes, mediaType: source.contentType,
                ...(contentEncoding ? {contentEncoding} : {}), decodedSha256: source.decodedSha256, decodedBytes: source.decodedBytes});
            rows.set(source.path, {source, object});
            if (++completed % 100 === 0 || completed === inventory.objects.length) onProgress({phase: 'prepare', completed, total: inventory.objects.length});
        }
    }));
    async function metadata(value, name, phase) {
        const decoded = json(value), encoded = brotliCompressSync(decoded, {params: {[constants.BROTLI_PARAM_QUALITY]: 5}});
        const sha256 = hash(encoded), temporary = path.join(directory, 'payload', randomUUID() + '.tmp');
        await fs.writeFile(temporary, encoded, {flag: 'wx'});
        const row = await store(temporary, {relativeKey: `${name}-${sha256}.json`, phase, sha256, bytes: encoded.length,
            mediaType: 'application/json', contentEncoding: 'br', decodedSha256: hash(decoded), decodedBytes: decoded.length});
        return {url: new URL(row.key, target.publicBaseUrl).href, sha256: row.decodedSha256, byteLength: row.decodedBytes};
    }
    const packs = {}, bootstrap = {};
    for (const group of order(Object.keys(inventory.groups))) {
        const members = new Set(inventory.groups[group]), pending = [...members];
        for (let i = 0; i < pending.length; i++) for (const dependency of rows.get(pending[i])?.source.dependencies ?? []) {
            if (!rows.has(dependency)) throw new Error('Missing publication dependency: ' + dependency);
            if (!members.has(dependency)) {members.add(dependency); pending.push(dependency);}
        }
        // The top-level map index enumerates every region; keep it as bootstrap data,
        // rather than one eagerly loadable SDK pack containing the whole world.
        if (group === 'world-index') {
            for (const sourcePath of inventory.groups[group]) {const {object} = rows.get(sourcePath);
                bootstrap[sourcePath] = {path: object.relativeKey, sha256: object.decodedSha256, byteLength: object.decodedBytes, mediaType: object.mediaType};}
            continue;
        }
        const assets = new Map(), files = {};
        for (const sourcePath of order(members)) {
            const {source, object} = rows.get(sourcePath);
            const dependencies = order(new Set(source.dependencies.map(dependency => rows.get(dependency).object.relativeKey)));
            if (dependencies.length > 4096) throw new Error('Asset exceeds SDK dependency budget: ' + sourcePath);
            const entry = {path: object.relativeKey, sha256: object.decodedSha256, byteLength: object.decodedBytes, mediaType: object.mediaType,
                ...(dependencies.length ? {dependencies} : {})};
            const previous = assets.get(entry.path);
            if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error('Conflicting dependency aliases: ' + sourcePath);
            assets.set(entry.path, entry);
            files[sourcePath] = {path: object.relativeKey, ...(source.uses.length ? {uses: source.uses} : {})};
        }
        if (!assets.size) continue;
        const index = {contractVersion: 1, assets: [...assets.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'))};
        if (index.assets.length > 65536 || json(index).length > 8 * 1024 ** 2) throw new Error('Group exceeds SDK index budget; partition the group: ' + group);
        const id = 'foxhole.' + group.replace(/:/g, '.');
        packs[group] = {pack: {contractVersion: 1, id, manifest: await metadata(index, 'pack', 'indexes')},
            mapping: await metadata({schemaVersion: 1, group, files}, 'mapping', 'indexes')};
    }
    const releaseDocument = {schemaVersion: 1, format: 'foxwatch-asset-release-v1', inventorySha256: inventory.inventorySha256,
        worldBaseUrl: new URL(`${target.prefix}/world/`, target.publicBaseUrl).href, packs, bootstrap};
    const release = await metadata(releaseDocument, 'release', 'release');
    const plan = {schemaVersion: 1, target, inventorySha256: inventory.inventorySha256, release,
        objects: [...objects.values()].sort((a, b) => a.key.localeCompare(b.key, 'en')),
        summary: {sourceFiles: inventory.objects.length, objects: objects.size, bytes: [...objects.values()].reduce((n, row) => n + row.bytes, 0), packs: Object.keys(packs).length}};
    const result = {...plan, planSha256: hash(json(plan))};
    await fs.writeFile(path.join(directory, 'plan.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    return {directory, plan: result};
}

export async function readPublicationPlan(planPath) {
    const directory = await fs.realpath(path.dirname(planPath));
    if ((await fs.stat(planPath)).size > 64 * 1024 ** 2) throw new Error('Publication plan exceeds metadata budget');
    const plan = JSON.parse(await fs.readFile(planPath, 'utf8')), {planSha256, ...body} = plan;
    if (plan.schemaVersion !== 1 || hash(json(body)) !== planSha256) throw new Error('Publication plan receipt mismatch');
    validateTarget(plan.target);
    if (!Array.isArray(plan.objects) || plan.objects.length > 100000) throw new Error('Invalid publication objects');
    const keys = new Set(), receipts = new Map();
    for (const row of plan.objects) {
        portablePath(row.key); portablePath(row.file);
        if (!row.key.startsWith(plan.target.prefix + '/') || keys.has(row.key) || !['assets', 'indexes', 'release'].includes(row.phase)
            || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 0) throw new Error('Invalid publication object');
        keys.add(row.key);
        const file = await fs.realpath(path.join(directory, row.file));
        if (!inside(directory, file)) throw new Error('Prepared payload escapes plan directory');
        const receipt = await fileHash(file);
        if (receipt.sha256 !== row.sha256 || receipt.bytes !== row.bytes) throw new Error('Prepared payload changed: ' + row.file);
        receipts.set(row.key, receipt);
    }
    const releases = plan.objects.filter(row => row.phase === 'release');
    if (releases.length !== 1 || new URL(releases[0].key, plan.target.publicBaseUrl).href !== plan.release.url
        || releases[0].decodedSha256 !== plan.release.sha256 || releases[0].decodedBytes !== plan.release.byteLength) throw new Error('Publication release pin mismatch');
    return {directory, plan, receipts};
}
