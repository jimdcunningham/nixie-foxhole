import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync, brotliDecompressSync, constants} from 'node:zlib';
import {prepareHomeRoads} from './prepare-home-roads.mjs';
import {addHomeMaterials} from './prepare-home-materials.mjs';
import {makeGlb} from './authoring/mesh.mjs';
import {publishCompactWorld} from './publish-compact.mjs';

const regions = ['homeregionc', 'homeregionw'];
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value));

function waterMesh(level) {
    const ring = [[-1092, 0], [-546, 945], [546, 945], [1092, 0], [546, -945], [-546, -945]];
    return {
        positions: Float32Array.from([[0, level, 0], ...ring.map(([x, z]) => [x, level, z])].flat()),
        normals: Float32Array.from(Array.from({length: 7}, () => [0, 1, 0]).flat()),
        indices: Uint32Array.from(ring.flatMap((_, i) => [0, i + 1, (i + 1) % 6 + 1])),
    };
}

async function readShared(root) {
    const read = async ref => {
        const bytes = await fs.readFile(path.join(root, ref.path));
        return ref.encoding === 'br' ? brotliDecompressSync(bytes) : bytes;
    };
    const index = await readJson(path.join(root, 'index.json'));
    const manifest = JSON.parse(await read(index.regions.deadlands.manifest));
    const resource = key => read(manifest.resources[key].resource);
    const water = JSON.parse(await resource('deadlands/water-source/render.json'));
    const cubeKey = 'sky-source/NoonSky.cubemap';
    const cube = JSON.parse(await resource(cubeKey));
    const skyFiles = Object.keys(cube).map(face => {
        cube[face] = 'NoonSky-' + face + '.png';
        return 'sky-source/' + cube[face];
    });
    const keys = [...new Set([...Object.values(water.textures).filter(key => typeof key === 'string' && key.startsWith('water-graph/')), ...skyFiles])];
    const resources = await Promise.all(keys.map(async key => [key, await resource(key)]));
    resources.push([cubeKey, Buffer.from(JSON.stringify(cube))]);
    return {water, resources};
}

export async function prepareHomeRegions({nativeRoot, scratch, target, sharedRoot = target}) {
    const shared = await readShared(sharedRoot);
    await fs.mkdir(scratch, {recursive:true});
    const prepared = await fs.mkdtemp(path.join(scratch, 'home-regions-'));
    const viewer = path.join(prepared, 'viewer');
    const manifestDir = path.join(viewer, 'dependency-bundles');
    const recipesDir = path.join(viewer, 'recipe-rollout');
    const blobsDir = path.join(prepared, 'blobs');
    const blobs = {};
    await Promise.all([blobsDir, path.join(manifestDir, 'regions'), path.join(recipesDir, 'regions')].map(dir => fs.mkdir(dir, {recursive:true})));
    for (const region of regions) {
        const native = path.join(nativeRoot, region);
        const resources = {};
        async function add(name, original, compressed = false, global = false) {
            const logical = global ? name : region + '/' + name;
            const data = compressed ? brotliCompressSync(original, {params:{[constants.BROTLI_PARAM_QUALITY]:4}}) : original;
            const blob = createHash('sha256').update(data).digest('hex');
            const entry = {blob, bytes:data.length, codec:typeof compressed === 'string' ? compressed : compressed ? 'brotli' : 'identity'};
            if (!blobs[blob]) {
                await fs.writeFile(path.join(blobsDir, blob), data);
                blobs[blob] = {bytes:data.length, entry, ids:[]};
            }
            blobs[blob].ids.push(logical);
            resources[logical] = entry;
        }
        const terrainJson = await fs.readFile(path.join(native, 'terrain.json'));
        const terrain = JSON.parse(terrainJson);
        const vertices = await fs.readFile(path.join(native, 'terrain.bin'));
        if (terrain.errors.length || !terrain.components.length || vertices.length !== terrain.vertices * 12) throw Error('Incomplete native terrain for ' + region);
        await add('terrain.json', terrainJson, true);
        await add('terrain.bin', vertices, true);
        const models = [];
        for (const file of ['scene-full.json', 'scene-extra.json', 'scene-bridges.json']) {
            const data = await readJson(path.join(native, file));
            for (const model of data.prototypes) {
                if (!model.file || model.category === 'utility') continue;
                const placements = model.placements.filter(row => !row.spline);
                if (!placements.length) continue;
                if (!resources[region + '/' + model.file]) await add(model.file, await fs.readFile(path.join(native, model.file)));
                models.push({...model, placements});
            }
        }
        await add('native-roads.glb', await prepareHomeRoads(native));
        models.push({name:'Native Home Roads', category:'infrastructure', file:'native-roads.glb', placements:[{actor:'Native Home Roads', matrix:identity}]});
        const water = (await readJson(path.join(native, 'water-meshes.json'))).find(model => model.name === 'WaterHexPlane');
        const sea = water?.placements.find(row => /^Ocean/i.test(row.actor))?.matrix[13];
        if (!Number.isFinite(sea)) throw Error('Missing native sea level for ' + region);
        await add('water-visible.glb', makeGlb(terrain, waterMesh(sea)));
        await addHomeMaterials({native, region, terrain, vertices, add, shared});
        await add('world.json', JSON.stringify({prototypes:models}), true);
        await add('lod-manifest.json', JSON.stringify({assets:{}}), true);
        await add('night-materials.json', JSON.stringify({assets:{}}), true);
        await writeJson(path.join(manifestDir, 'regions', region + '.json'), {profile:'home-native-v1', resources});
        await writeJson(path.join(recipesDir, 'regions', region + '.json'), {version:1, region, terrain:{}, roads:{parts:{}}});
        console.log(region, terrain.components.length, 'terrain components,', models.length, 'model prototypes');
    }
    await writeJson(path.join(manifestDir, 'manifest.json'), {blobs});
    await writeJson(path.join(recipesDir, 'manifest.json'), {content:{}});
    return publishCompactWorld({input:prepared, target, regions, catalog:null});
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(import.meta.dirname, 'prepare-home-regions.mjs')) {
    const [nativeRoot, scratch, target, sharedRoot] = process.argv.slice(2);
    if (!nativeRoot || !scratch || !target) throw Error('Usage: prepare-home-regions.mjs <native root> <scratch directory> <local world directory>');
    await prepareHomeRegions({nativeRoot, scratch, target, sharedRoot});
}
