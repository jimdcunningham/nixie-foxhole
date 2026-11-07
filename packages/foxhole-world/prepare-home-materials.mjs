import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const colorSize = 512;
const rgba = (file, size) => sharp(file).resize(size, size, { fit: 'fill' }).ensureAlpha().raw().toBuffer();

function rasterize(terrain, vertices, paint, source, names) {
    const minX = -1092, maxZ = 945, width = 2184, height = 1890;
    const area = width * height;
    const weights = Buffer.alloc(area * names.length);
    const bed = Buffer.alloc(area * 3);
    const coverage = new Uint8Array(area);
    const byName = new Map(names.map((name, i) => [name, i]));
    const paintByOrigin = new Map(paint.components.map(c => [
        c.name + ':' + c.origin[0].toFixed(2) + ':' + c.origin[2].toFixed(2), c,
    ]));
    const at = (c, x, y, axis) => vertices.readFloatLE((c.offset + y * c.size + x) * 12 + axis * 4);
    for (const c of terrain.components) {
        const x0 = at(c, 0, 0, 0), z0 = at(c, 0, 0, 2);
        const component = paintByOrigin.get(c.name + ':' + x0.toFixed(2) + ':' + z0.toFixed(2)) ?? paint.components.find(row => row.name === c.name && Math.hypot(row.origin[0] - x0, row.origin[2] - z0) < .01);
        if (!component || component.size !== c.size) throw Error('Missing paint component ' + c.name);
        const ax = at(c, 1, 0, 0) - x0, az = at(c, 1, 0, 2) - z0;
        const bx = at(c, 0, 1, 0) - x0, bz = at(c, 0, 1, 2) - z0;
        const determinant = ax * bz - az * bx;
        if (Math.abs(determinant) < 1e-6) throw Error('Invalid paint transform ' + c.name);
        const span = c.size - 1;
        const cornersX = [x0, x0 + ax * span, x0 + bx * span, x0 + (ax + bx) * span];
        const cornersZ = [z0, z0 + az * span, z0 + bz * span, z0 + (az + bz) * span];
        const layers = component.layers.map(layer => ({ ...layer, target: byName.get(layer.name) * area }));
        for (let y = Math.max(0, Math.floor(maxZ - Math.max(...cornersZ))); y <= Math.min(height - 1, Math.ceil(maxZ - Math.min(...cornersZ))); y++) {
            for (let x = Math.max(0, Math.floor(Math.min(...cornersX) - minX)); x <= Math.min(width - 1, Math.ceil(Math.max(...cornersX) - minX)); x++) {
                const dx = minX + x - x0, dz = maxZ - y - z0;
                const u = (dx * bz - dz * bx) / determinant;
                const v = (dz * ax - dx * az) / determinant;
                if (u < -0.5 || v < -0.5 || u > span + 0.5 || v > span + 0.5) continue;
                const ix = Math.round(u), iy = Math.round(v);
                const i = y * width + x, j = iy * c.size + ix;
                const elevation = at(c, ix, iy, 1);
                const encoded = Math.round(Math.min(1, Math.max(0, (elevation + 128) / 256)) * 65535);
                if (coverage[i] && encoded <= bed.readUInt16BE(i * 3)) continue;
                if (coverage[i]) for (let l = 0; l < names.length; l++) weights[l * area + i] = 0;
                coverage[i] = 1;
                for (const layer of layers) weights[layer.target + i] = source[layer.offset + j];
                bed.writeUInt16BE(encoded, i * 3);
            }
        }
    }
    if (!coverage.some(Boolean)) throw Error('The home region paint atlas is empty.');
    return { weights, bed, width, height, minX, maxZ };
}

export async function addHomeMaterials({ native, region, terrain, vertices, add, shared }) {
    const paint = await readJson(path.join(native, 'paint/paint.json'));
    const material = await readJson(path.join(native, 'landscape-material.json'));
    const names = [...new Set(paint.components.flatMap(c => c.layers.map(layer => layer.name)))];
    const colors = [], normals = [];
    const textures = new Map(paint.textures.map(row => [row.key.toLowerCase(), row]));
    const prefixFor = name => name.toLowerCase() === 'muddyground' ? 'Muddy Ground' : name;
    const params = material.parameters;
    const flatNormal = Buffer.alloc(colorSize * colorSize * 4);
    flatNormal.fill(Buffer.from([128, 128, 255, 255]));
    const layers = [];
    for (const name of names) {
        const prefix = prefixFor(name);
        const scalar = (key, fallback) => {
            const wanted = (prefix + ' - ' + key).toLowerCase();
            return Object.entries(params.Scalars).find(([k]) => k.toLowerCase() === wanted)?.[1] ?? fallback;
        };
        const variants = [];
        for (const n of [1, 2]) {
            const color = textures.get((prefix + '-Albedo ' + n).toLowerCase());
            const normal = textures.get((prefix + '-Normal ' + n).toLowerCase());
            if (!color) continue;
            variants.push({ tile: Math.max(.01, scalar('Texture ' + n + ' Tile', 3)), slice: colors.length });
            colors.push(await rgba(path.join(native, 'paint', color.file), colorSize));
            normals.push(normal ? await rgba(path.join(native, 'paint', normal.file), colorSize) : flatNormal);
        }
        if (!variants.length) throw Error('Missing terrain albedo for ' + region + ' layer ' + name);
        const masks = [1, 2].map(n => {
            const key = (prefix + ' - Channel ' + n).toLowerCase();
            const c = Object.entries(params.Colors).find(([name]) => name.toLowerCase() === key)?.[1];
            return { tile: Math.max(.01, scalar('Mask ' + n + ' Tile', 6)), channel: c ? [c.R,c.G,c.B,c.A] : [1,0,0,0] };
        });
        layers.push({name, prefix, variants, masks, levels:scalar('Mask Levels',1), intensity:scalar('Mask Intensity',1), variety:variants.length > 1});
    }
    const snowSlice = colors.length;
    colors.push(await rgba(path.join(native, 'paint/native/TerrainSnow4_A.png'), colorSize));
    normals.push(await rgba(path.join(native, 'paint/native/TerrainSnow4_N.png'), colorSize));
    const atlas = rasterize(terrain, vertices, paint, await fs.readFile(path.join(native,'paint/weights.bin')), names);
    const dimensions = {width:atlas.width,height:atlas.height};
    await add('terrain-live/albedo-0.bin.gz', Buffer.concat(colors), 'decoded-gzip-brotli');
    await add('terrain-live/normal-0.bin.gz', Buffer.concat(normals), 'decoded-gzip-brotli');
    await add('terrain-live/weights.bin.gz', atlas.weights, 'decoded-gzip-brotli');
    await add('terrain-live/noise.bin.gz', await rgba(path.join(native,'paint/TilingNoises01.png'),colorSize), 'decoded-gzip-brotli');
    await add('terrain-live/snowMaterial.bin.gz', await rgba(path.join(native,'paint/native/SnowM.png'),colorSize), 'decoded-gzip-brotli');
    await add('terrain-live/material.json', JSON.stringify({
        region, size:colorSize, slices:colors.length, buckets:[{size:colorSize,count:colors.length,start:0}], snowSlice, layers,
        weights:{...dimensions,minX:atlas.minX,maxZ:atlas.maxZ},
        noise:{width:colorSize,height:colorSize}, snowMaterial:{width:colorSize,height:colorSize},
    }), true);
    await add('water-source/terrain-height.png', await sharp(atlas.bed,{raw:{...dimensions,channels:3}}).png().toBuffer());
    await add('water-source/boat-stencils.json', '[]', true);
    const materials = await readJson(path.join(native, 'water-materials.json'));
    const water = materials.materials.find(material => material.name === 'Water2');
    if (!water) throw Error('Missing native Water2 ocean material for ' + region);
    await add('water-source/render.json', JSON.stringify({...shared.water, material:water}), true);
    for (const [key, bytes] of shared.resources) await add(key, bytes, false, true);
}
