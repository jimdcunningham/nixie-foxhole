import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { packSharedMaterial } from '../../../packages/foxhole-world/prepare-shared-materials.mjs';

const repo = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(repo, 'packages/foxhole-world/package.json'));
const sharp = require('sharp');
const [nativeTextures, assets = path.join(repo, 'packages/extensions/foxhole/public/foxhole/assets')] = process.argv.slice(2);
if (!nativeTextures) throw Error('Pass the extracted texture root containing Textures/Structures.');

const stages = ['01', '02', '03'];
const materials = [];
for (const stage of stages) {
    const albedo = `HowitzerA${stage}`, packed = `HowitzerS${stage}`;
    const read = name => fs.readFile(path.join(nativeTextures, 'Textures/Structures', `${name}.png`));
    const { orm } = await packSharedMaterial(await read(albedo), await read(packed), {
        metalChannel: 0, roughChannel: 1, roughMultiply: 1, alpha: null,
    });
    const bytes = await sharp(orm).webp({ lossless: true }).toBuffer();
    const digest = createHash('sha256').update(bytes).digest('hex');
    const assetPath = `content/raw/${digest}/asset.webp`;
    const file = path.join(assets, 'world', assetPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    materials.push({
        material: `War/Content/Materials/Structures/Howitzer${stage}.uasset`,
        albedo: `War/Content/Textures/Structures/${albedo}.${albedo}`,
        packed: `War/Content/Textures/Structures/${packed}.${packed}`,
        resource: { path: assetPath, hash: digest, decodedHash: digest, bytes: bytes.length },
    });
}
const descriptor = path.join(repo, 'packages/foxhole-world/authoring/native-howitzer-surfaces.json');
await fs.writeFile(descriptor, JSON.stringify({ version: 1, materials }, null, 2) + '\n');
