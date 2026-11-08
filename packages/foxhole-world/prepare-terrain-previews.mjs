import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { makeGlb } from './authoring/mesh.mjs';
import { terrainSurfaceSampler } from './authoring/terrain-surface.mjs';
import { decodeWordPlanar } from './authoring/word-planar.mjs';
import { buildTerrainPreview } from './runtime/terrain-preview.mjs';

const root = resolve(process.argv[2]);
const indexPath = resolve(root, 'index.json');
const index = JSON.parse(await readFile(indexPath, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readResource = async ref => {
    const bytes = await readFile(resolve(root, ref.path));
    return ref.encoding === 'br' ? brotliDecompressSync(bytes) : bytes;
};

for (const region of Object.values(index.regions)) {
    const manifest = JSON.parse(await readResource(region.manifest));
    const metadata = manifest.resources[region.id + '/terrain.json'];
    const terrain = manifest.resources[region.id + '/terrain.bin'];
    if (!metadata || !terrain) continue;

    const meta = JSON.parse(await readResource(metadata.resource));
    const bytes = await readResource(terrain.resource);
    let source;
    if (terrain.codec === 'word-planar-brotli') {
        source = new Float32Array(decodeWordPlanar(bytes, terrain.delta));
    } else if (terrain.codec === 'xyz-planar-brotli') {
        const planar = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
        const count = planar.length / 3;
        source = new Float32Array(planar.length);
        for (let i = 0; i < count; i++) source.set([planar[i], planar[i + count], planar[i + 2 * count]], i * 3);
    } else {
        source = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    }
    const mesh = buildTerrainPreview(terrainSurfaceSampler(meta, source));
    if (!mesh.indices.length) throw Error('Empty terrain preview: ' + region.id);
    const glb = makeGlb({ ...meta, map: region.id }, mesh);
    const compressed = brotliCompressSync(glb, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
    const digest = hash(compressed);
    const path = 'content/br/' + digest + '/asset.glb';
    const destination = resolve(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, compressed);
    region.terrainPreview = { path, hash: digest, decodedHash: hash(glb), bytes: compressed.length, encoding: 'br' };
    const keys = ['terrain.json', 'terrain.bin', 'map/terrain.webp', 'world-fixes/boundary/profile.json'];
    region.terrainPreviewResources = Object.fromEntries(keys.flatMap(key => {
        const id = region.id + '/' + key;
        const resource = manifest.resources[id];
        return resource?.resource ? [[id, resource]] : [];
    }));
    console.log(region.id, terrain.resource.bytes, compressed.length);
}

const stagedIndex = indexPath + '.terrain-preview.tmp';
await writeFile(stagedIndex, JSON.stringify(index));
await rename(stagedIndex, indexPath);
