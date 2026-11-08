import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {PakImporter} from '../../../packages/extensions/foxhole/app/plugins/foxhole/nixie/map/mod-pak.js';
import {readPublicationConfig} from './asset-pack-publisher.mjs';
import {loadAssetPublicationCredentials} from './asset-pack-credentials.mjs';
import {createAssetPublicationS3} from './asset-pack-s3.mjs';

const width = 2048;
const height = 1776;
const footerSize = 28;
const packageMagic = 0x9e2a83c1;
const texturePath = /^War\/Content\/Textures\/UI\/HexMaps\/Processed\/(Map[A-Za-z0-9]+)$/i;

export function generateMapTextureTemplates(pak, maps) {
    const keys = Object.values(maps ?? {}).map(region => region.textureKey?.trim()).filter(Boolean);
    const expected = new Set(keys.map(key => key.toLowerCase()));
    if (!expected.size || expected.size !== keys.length) {
        throw new Error('Map data must provide unique texture keys.');
    }
    const templates = new Map();
    const found = new Set();
    for (const {assetPath, raw} of new PakImporter(pak).exportHexMaps({skipDecode: true})) {
        const key = texturePath.exec(assetPath)?.[1];
        if (!key || !expected.has(key.toLowerCase())) continue;
        const normalized = key.toLowerCase();
        if (found.has(normalized)) throw new Error('Duplicate cooked map texture: ' + key);
        const bytes = raw.uasset && Buffer.from(raw.uasset);
        const footer = bytes?.subarray(-footerSize);
        const headerSize = (bytes?.length ?? 0) - footerSize - width * height;
        const header = headerSize >= 4 ? bytes.subarray(0, headerSize) : null;
        if (!header || !footer || raw.uexp || raw.ubulk
            || header.readUInt32LE(0) !== packageMagic || !header.includes('PF_BC7')
            || footer.readUInt32LE(0) !== width || footer.readUInt32LE(4) !== height
            || footer.readUInt32LE(8) !== 1 || footer.readUInt32LE(24) !== packageMagic) {
            throw new Error('Expected an inline 2048 × 1776 single-mip cooked texture for ' + key);
        }
        templates.set(key, Buffer.concat([header, footer]).toString('base64'));
        found.add(normalized);
    }
    const missing = keys.filter(key => !found.has(key.toLowerCase()));
    if (missing.length) throw new Error('Missing cooked map textures: ' + missing.join(', '));
    return Buffer.from(JSON.stringify(Object.fromEntries([...templates.keys()].sort().map(key => [key, templates.get(key)])), null, 2) + '\n');
}

export async function runMapTextureTemplatePublication(args, repoRoot) {
    const {values} = parseArgs({args, options: {
        'pak-path': {type: 'string'}, 'map-data': {type: 'string'}, config: {type: 'string'},
        upload: {type: 'boolean'}, help: {type: 'boolean'},
    }});
    if (values.help) {
        console.log('FoxWatch map-templates-publish --pak-path <full 2K map mod.pak> [--map-data <map-data.v1.json>] [--config <config.json>] [--upload]');
        return;
    }
    if (!values['pak-path']) throw new Error('Pass --pak-path with a local 2K full-map mod Pak.');
    const pakPath = path.resolve(repoRoot, values['pak-path']);
    if ((await fs.stat(pakPath)).size > 512 * 1024 ** 2) throw new Error('Expected a map mod Pak under 512 MiB.');
    const input = await fs.readFile(pakPath);
    const mapsFile = path.resolve(repoRoot, values['map-data']
        ?? 'packages/extensions/foxhole/public/foxhole/assets/maps/map-data.v1.json');
    const {maps} = JSON.parse(await fs.readFile(mapsFile, 'utf8'));
    const pak = input.byteOffset === 0 && input.byteLength === input.buffer.byteLength
        ? input.buffer : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    const bytes = generateMapTextureTemplates(pak, maps);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const config = await readPublicationConfig(path.resolve(repoRoot, values.config
        ?? 'tools/foxwatch/local/asset-publication.json'), repoRoot);
    const key = config.target.prefix + '/map-export/templates/' + sha256 + '.json';
    const url = new URL(key, config.target.publicBaseUrl).href;
    let status = 'dry-run';
    if (values.upload) {
        const signal = AbortSignal.timeout(120_000);
        const storage = createAssetPublicationS3(config.target, await loadAssetPublicationCredentials(config, repoRoot));
        try {
            const existing = await storage.head(key, signal);
            if (!existing) {
                const directory = await fs.mkdtemp(path.join(tmpdir(), 'foxwatch-map-templates-'));
                const sourceFile = path.join(directory, 'templates.json');
                try {
                    await fs.writeFile(sourceFile, bytes);
                    await storage.put({key, sourceFile, bytes: bytes.length, sha256,
                        md5: createHash('md5').update(bytes).digest('base64'), decodedSha256: sha256, decodedBytes: bytes.length,
                        mediaType: 'application/json', cacheControl: 'public, max-age=31536000, immutable'}, signal);
                } finally {
                    await fs.unlink(sourceFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
                    await fs.rmdir(directory);
                }
            }
            const uploaded = await storage.readEncoded(key, signal);
            if (!bytes.equals(uploaded)) throw new Error('Stored map texture templates differ from the generated bytes.');
            status = existing ? 'verified-existing' : 'uploaded';
        } finally {
            storage.close();
        }
    }
    console.log(JSON.stringify({status, url, sha256, bytes: bytes.length}));
}
