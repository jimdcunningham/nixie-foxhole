import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Transform, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {brotliDecompressSync, createBrotliDecompress} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {worldRuntimePublicationRoots} from '../../../packages/foxhole-world/publication-roots.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contentPath = /^content\/(br|raw)\/([a-f0-9]{64})\/asset\.[a-z0-9]+$/;
const assetExtension = /\.(?:json|glb|gltf|bin|cubemap|webp|png|jpe?g|gif|avif|ktx2?|basis|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm)$/i;
const sorted = values => [...values].sort((a, b) => a.localeCompare(b, 'en'));
const total = rows => rows.reduce((n, row) => n + row.bytes, 0);

export function publicationPath(value) {
    if (typeof value !== 'string' || !value || value.length > 1024 || /[\\:\0?#]/.test(value)
        || value.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error(`Invalid publication path: ${JSON.stringify(value)}`);
    }
    return value;
}

/** Detect the HTTP-decoded payload, independently of its legacy file suffix. */
export function publicationMedia(prefix, file) {
    if (prefix.subarray(0, 4).toString() === 'RIFF' && prefix.subarray(8, 12).toString() === 'WEBP') {
        const chunk = prefix.subarray(12, 16).toString();
        let width, height;
        if (chunk === 'VP8X' && prefix.length >= 30) {width = prefix.readUIntLE(24, 3) + 1; height = prefix.readUIntLE(27, 3) + 1;}
        if (chunk === 'VP8L' && prefix.length >= 25) {const bits = prefix.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;}
        if (chunk === 'VP8 ' && prefix.length >= 30 && prefix.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {width = prefix.readUInt16LE(26) & 0x3fff; height = prefix.readUInt16LE(28) & 0x3fff;}
        return {contentType: 'image/webp', ...(width && height ? {width, height} : {})};
    }
    if (prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && prefix.length >= 24) {
        return {contentType: 'image/png', width: prefix.readUInt32BE(16), height: prefix.readUInt32BE(20)};
    }
    if (prefix.subarray(0, 4).toString() === 'glTF') return {contentType: 'model/gltf-binary'};
    if (/^GIF8[79]a/.test(prefix.subarray(0, 6).toString()) && prefix.length >= 10) return {contentType: 'image/gif', width: prefix.readUInt16LE(6), height: prefix.readUInt16LE(8)};
    if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) return {contentType: 'image/jpeg'};
    if (prefix.subarray(0, 12).equals(Buffer.from([171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10]))) return {contentType: 'image/ktx2'};
    if (/\.(json|gltf|cubemap)$/.test(file) && /^[\s\uFEFF]*[\[{]/.test(prefix.toString())) return {contentType: file.endsWith('.gltf') ? 'model/gltf+json' : 'application/json'};
    return {contentType: 'application/octet-stream'};
}

async function inspectFile(root, file, encoding, maxDecodedBytes) {
    const actual = await fs.realpath(path.join(root, file));
    if (!actual.startsWith(root + path.sep)) throw new Error('Asset escapes publication root');
    const encodedHash = createHash('sha256'), decodedHash = createHash('sha256');
    let bytes = 0, decodedBytes = 0, prefix = Buffer.alloc(0), tail = '';
    const dependencies = new Set();
    await pipeline(createReadStream(actual), new Transform({transform(chunk, _, done) {
        bytes += chunk.length; encodedHash.update(chunk); done(null, chunk);
    }}), ...(encoding === 'br' ? [createBrotliDecompress()] : []), new Writable({write(chunk, _, done) {
        decodedBytes += chunk.length;
        if (decodedBytes > maxDecodedBytes) return done(new Error('Decoded asset exceeds publication budget'));
        decodedHash.update(chunk);
        if (prefix.length < 512) prefix = Buffer.concat([prefix, chunk.subarray(0, 512 - prefix.length)]);
        if (/json/.test(publicationMedia(prefix, file).contentType)) {
            const text = tail + chunk.toString('utf8');
            for (const match of text.matchAll(/(?:content\/|\.\.\/\.\.\/)(br|raw)\/([a-f0-9]{64})\/asset(\.[a-z0-9]+)(?=["\s])/g)) dependencies.add(`world/content/${match[1]}/${match[2]}/asset${match[3]}`);
            tail = text.slice(-256);
        }
        done();
    }}));
    return {path: file, bytes, sha256: encodedHash.digest('hex'), decodedBytes, decodedSha256: decodedHash.digest('hex'),
        ...publicationMedia(prefix, file), ...(encoding ? {contentEncoding: encoding} : {}), dependencies: sorted(dependencies)};
}

/** Nonmutating publication plan. Reports failures; never repairs, uploads, or deletes assets. */
export async function buildAssetPublicationInventory({assetsRoot, runtimeRoots = worldRuntimePublicationRoots(), concurrency = 4,
    maxDecodedBytes = 512 * 1024 ** 2, onProgress = () => {}}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Concurrency must be between 1 and 16');
    if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes <= 0) throw new Error('Decoded byte budget must be positive');
    const root = await fs.realpath(assetsRoot), files = new Map(), issues = [], warnings = [], selected = new Map(), receipts = [];
    const groups = new Map(), worldRegions = new Map(), catalogModels = new Map();
    const issue = (code, file, message, group) => issues.push({code, path: file, ...(group ? {group} : {}), message});
    async function walk(directory = '') {
        for (const entry of await fs.readdir(path.join(root, directory), {withFileTypes: true})) {
            if (entry.name === '.git' || entry.name === '.github') continue;
            const file = directory ? `${directory}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink()) {issue('symlink', file, 'Publication assets must not contain symbolic links'); continue;}
            if (entry.isDirectory()) await walk(file);
            else if (entry.isFile()) files.set(file, (await fs.stat(path.join(root, file))).size);
        }
    }
    await walk();
    function add(file, group, receipt, use) {
        publicationPath(file);
        const item = selected.get(file) || {path: file, groups: new Set(), encodings: new Set(), uses: new Map()};
        item.groups.add(group);
        if (receipt?.encoding) item.encodings.add(receipt.encoding);
        if (file.startsWith('world/content/br/')) item.encodings.add('br');
        if (use) item.uses.set(JSON.stringify(use), use);
        selected.set(file, item);
        const members = groups.get(group) || new Set(); members.add(file); groups.set(group, members);
        if (receipt) receipts.push({file, group, ...receipt});
        if (receipt && !/^[a-f0-9]{64}$/.test(receipt.sha256 || receipt.hash || '')) issue('receipt', file, 'Missing or invalid encoded SHA-256 receipt', group);
        if (receipt?.bytes !== undefined && (!Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0)) issue('receipt', file, 'Invalid encoded byte length', group);
    }
    async function readJSON(file, ref) {
        publicationPath(file);
        const actual = await fs.realpath(path.join(root, file));
        if (!actual.startsWith(root + path.sep)) throw new Error('Metadata escapes publication root');
        let data = await fs.readFile(actual);
        if (data.length > 16 * 1024 ** 2) throw new Error('Publication metadata exceeds encoded budget');
        if (ref?.bytes !== undefined && data.length !== ref.bytes || ref?.hash && sha(data) !== ref.hash) throw new Error('Metadata encoded receipt mismatch');
        if (ref?.encoding === 'br') data = brotliDecompressSync(data, {maxOutputLength: 32 * 1024 ** 2});
        if (ref?.decodedHash && sha(data) !== ref.decodedHash) throw new Error('Metadata decoded receipt mismatch');
        return JSON.parse(data.toString());
    }
    for (const [file] of files) if (!file.startsWith('world/') && assetExtension.test(file)) add(file, file.split('/')[0] === 'types' ? 'catalog' : 'support');
    let catalog;
    if (files.has('models/manifest.v1.json')) {
        catalog = await readJSON('models/manifest.v1.json');
        for (const [id, row] of Object.entries({...catalog.assets, ...catalog.resources, ...catalog.sharedParts})) {
            if (!row?.path) continue;
            add(row.path, 'catalog', {sha256: row.sha256, bytes: row.bytes}, {id, kind: 'model'});
            catalogModels.set(row.resourceId || `foxhole.model.${id}`, row);
        }
    }
    const activeContent = new Set();
    if (files.has('world/index.json')) {
        add('world/index.json', 'world-index');
        const index = await readJSON('world/index.json');
        if (index.version !== 1 || index.format !== 'compact-recipes-v1') throw new Error('Unsupported compact world index');
        for (const [id, entry] of Object.entries(index.regions)) {
            const group = `region:${id}`, ref = entry.manifest;
            if (!contentPath.test(ref?.path || '')) throw new Error('Invalid region manifest path');
            const file = `world/${ref.path}`;
            try {
                const doc = await readJSON(file, ref);
                if (doc.region !== id || doc.version !== 1 || doc.format !== index.format) throw new Error('Region manifest identity mismatch');
                for (const r of [...doc.physicalResources, ref]) {
                    const match = contentPath.exec(r.path || '');
                    if (!match || r.hash !== match[2] || (match[1] === 'br' ? r.encoding !== 'br' : !!r.encoding)) throw new Error('Invalid content receipt or encoding');
                    const p = `world/${r.path}`; activeContent.add(p); add(p, group, r);
                }
                for (const [logical, row] of Object.entries(doc.resources || {})) {
                    if (row.resource) {
                        const p = `world/${publicationPath(row.resource.path)}`;
                        if (!groups.get(group)?.has(p)) throw new Error('Logical resource is absent from region closure: ' + logical);
                        add(p, group, row.resource, {id: logical, codec: row.codec || 'identity',
                            ...(row.delta === undefined ? {} : {delta: row.delta}), ...(row.decodedBytes === undefined ? {} : {applicationDecodedBytes: row.decodedBytes}),
                            ...(row.decodedHash ? {applicationDecodedSha256: row.decodedHash} : {})});
                    }
                }
                for (const r of doc.catalogResources || []) add(r.path, group, {sha256: r.sha256, bytes: r.bytes}, {id: r.assetId, kind: 'model'});
                worldRegions.set(id, new Set([...groups.get(group)].filter(p => p.startsWith('world/content/'))));
            } catch (error) {issue('region-manifest', file, error.message, group);}
        }
    }
    for (const r of runtimeRoots) add(r.path, 'world-runtime', r, {id: r.id, kind: 'texture'});
    const objects = new Map(), queue = sorted(selected.keys()); let cursor = 0, completed = 0;
    await Promise.all(Array.from({length: concurrency}, async () => {
        while (cursor < queue.length) {
            const file = queue[cursor++], item = selected.get(file);
            if (!files.has(file)) {issue('missing-file', file, 'Declared asset is missing'); continue;}
            if (item.encodings.size > 1 || [...item.encodings].some(e => e !== 'br')) {issue('encoding', file, 'Conflicting or unsupported content encoding'); continue;}
            try {
                const object = await inspectFile(root, file, [...item.encodings][0], maxDecodedBytes);
                object.groups = sorted(item.groups); object.uses = [...item.uses.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
                objects.set(file, object);
                const expectedImageType = {'.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ktx2': 'image/ktx2'}[path.extname(file).toLowerCase()];
                if (expectedImageType && object.contentType.startsWith('image/') && object.contentType !== expectedImageType) warnings.push({code: 'media-suffix', path: file, message: `Serve as ${object.contentType} despite legacy ${path.extname(file)} suffix`});
                if (Math.max(object.width || 0, object.height || 0) > 8192) warnings.push({code: 'texture-dimension', path: file, message: 'Provide a device-compatible variant or tiles for dimensions above 8192'});
            } catch (error) {issue('asset-read', file, error.message);}
            if (++completed % 1000 === 0) onProgress({completed, selected: queue.length});
        }
    }));
    for (const r of receipts) {
        const object = objects.get(r.file); if (!object) continue;
        if (r.bytes !== undefined && object.bytes !== r.bytes) issue('receipt-size', r.file, `Expected ${r.bytes} bytes; found ${object.bytes}`, r.group);
        const expected = r.sha256 || r.hash;
        if (expected && object.sha256 !== expected) issue('receipt-hash', r.file, `Expected ${expected}; found ${object.sha256}`, r.group);
        if (r.decodedHash && object.decodedSha256 !== r.decodedHash) issue('decoded-hash', r.file, 'HTTP-decoded bytes differ from the receipt', r.group);
    }
    for (const object of objects.values()) for (const dependency of object.dependencies) {
        if (!objects.has(dependency)) issue('undeclared-dependency', object.path, `Dependency is absent from publication inventory: ${dependency}`);
        for (const group of object.groups.filter(g => g.startsWith('region:'))) if (!groups.get(group).has(dependency)) issue('region-dependency', object.path, `Dependency is absent from ${group}: ${dependency}`, group);
    }
    for (const row of catalogModels.values()) for (const part of row.modelParts?.parts || []) {
        const dependency = catalogModels.get(part.resourceId);
        if (!dependency || !objects.has(dependency.path)) issue('model-part', row.path, `Undeclared shared model resource ${part.resourceId}`);
        else if (dependency.path === row.path) issue('model-part', row.path, 'A model cannot depend on itself');
        else objects.get(row.path)?.dependencies.push(dependency.path);
    }
    const worldObjects = [...activeContent].map(p => objects.get(p)).filter(Boolean), regionUsage = new Map(); let regionBytes = 0;
    for (const [id, paths] of worldRegions) for (const p of paths) {
        const bytes = objects.get(p)?.bytes || 0; regionBytes += bytes;
        const users = regionUsage.get(p) || new Set(); users.add(id); regionUsage.set(p, users);
    }
    const shared = worldObjects.filter(o => regionUsage.get(o.path)?.size > 1);
    const unusedWorld = [...files].filter(([p]) => p.startsWith('world/content/') && !selected.has(p)).map(([p, bytes]) => ({path: p, bytes})).sort((a, b) => a.path.localeCompare(b.path, 'en'));
    const rows = [...objects.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
    for (const row of rows) row.dependencies = sorted(new Set(row.dependencies));
    const sharingByMedia = {};
    for (const object of worldObjects) {const row = sharingByMedia[object.contentType] ||= {uniqueFiles: 0, uniqueBytes: 0, sharedFiles: 0, sharedBytes: 0}; row.uniqueFiles++; row.uniqueBytes += object.bytes;
        if (regionUsage.get(object.path)?.size > 1) {row.sharedFiles++; row.sharedBytes += object.bytes;}}
    const inventory = {schemaVersion: 1, validation: 'encoded-and-http-decoded-receipts', valid: !issues.length, objects: rows,
        groups: Object.fromEntries(sorted(groups.keys()).map(g => [g, sorted(groups.get(g))])),
        summary: {files: rows.length, bytes: total(rows), world: {regions: worldRegions.size, uniqueFiles: worldObjects.length, uniqueBytes: total(worldObjects),
            sumRegionBytes: regionBytes, sharedAcrossRegionsFiles: shared.length, sharedAcrossRegionsBytes: total(shared), avoidedRepeatedRegionBytes: regionBytes - total(worldObjects), byMedia: sharingByMedia,
            runtimeRoots: runtimeRoots.length, unreferencedFiles: unusedWorld.length, unreferencedBytes: total(unusedWorld)}},
        issues: issues.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')), warnings: warnings.sort((a, b) => a.path.localeCompare(b.path, 'en')),
        unreferencedWorld: unusedWorld};
    return {...inventory, inventorySha256: sha(JSON.stringify(inventory))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const {values} = parseArgs({options: {assets: {type: 'string'}, output: {type: 'string'}, help: {type: 'boolean'}}});
    if (values.help) console.log('Usage: node tools/foxwatch/scripts/asset-publication-inventory.mjs --assets <directory> --output <inventory.json>');
    else {
        if (!values.assets || !values.output) throw new Error('Pass --assets and --output; inventory creation does not publish assets');
        let output = path.resolve(values.output); const root = await fs.realpath(values.assets);
        // Resolve an existing ancestor too: a differently cased path or directory symlink
        // must not let a report overwrite a file inside the served asset tree.
        let parent = path.dirname(output); const suffix = [];
        while (true) {try {parent = await fs.realpath(parent); break;} catch (error) {if (error.code !== 'ENOENT') throw error; suffix.unshift(path.basename(parent)); const next = path.dirname(parent); if (next === parent) throw error; parent = next;}}
        output = path.join(parent, ...suffix, path.basename(output));
        const relative = path.relative(root, output);
        if (!relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)) throw new Error('Write the inventory outside the served asset directory');
        const inventory = await buildAssetPublicationInventory({assetsRoot: root, onProgress: p => console.error(`Verified ${p.completed}/${p.selected} objects`)});
        await fs.mkdir(path.dirname(output), {recursive: true}); await fs.writeFile(output, JSON.stringify(inventory, null, 2) + '\n');
        console.log(JSON.stringify({valid: inventory.valid, ...inventory.summary, issues: inventory.issues.length, warnings: inventory.warnings.length, inventorySha256: inventory.inventorySha256, output}, null, 2));
        if (!inventory.valid) process.exitCode = 1;
    }
}
