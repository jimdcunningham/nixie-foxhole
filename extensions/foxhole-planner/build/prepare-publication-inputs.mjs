import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { preparePublicationCatalogInputs } from './publication-catalog-inputs.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** CI-only model inputs for geometry tests. Remote builds never package these bytes. */
export async function preparePublicationModels({ output, library, fetcher = fetch, concurrency = 6 }) {
    const manifest = JSON.parse(await fs.readFile(path.join(output, 'models/manifest.v1.json'), 'utf8'));
    const paths = new Set(Object.values({ ...manifest.assets, ...manifest.resources, ...manifest.sharedParts }).map(model => {
        const name = model.path;
        if (typeof name !== 'string' || !/^[a-z0-9._/-]+\.glb$/.test(name) || name.startsWith('/')
            || name.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
            throw new Error('Invalid publication model path.');
        }
        const location = library.files.get(name);
        if (!location || location.entry.sha256 !== model.sha256 || location.entry.byteLength !== model.bytes
            || !Number.isSafeInteger(model.bytes) || model.bytes <= 0 || model.bytes > 32 * 1024 ** 2) {
            throw new Error('Model differs from the pinned R2 publication: ' + name);
        }
        return name;
    }));
    let downloadedBytes = 0, reusedBytes = 0;
    const pending = [...paths];
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
        for (let name; (name = pending.shift()) !== undefined;) {
            const location = library.files.get(name);
            const { byteLength, sha256 } = location.entry;
            const destination = path.join(output, name);
            const previous = await fs.readFile(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
            if (previous) {
                if (previous.length !== byteLength || digest(previous) !== sha256) throw new Error('Existing model differs from pin: ' + name);
                reusedBytes += previous.length;
                continue;
            }
            const response = await fetcher(location.url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(60_000) });
            if (!response.ok || !response.body) throw new Error('Pinned model unavailable: ' + name);
            const chunks = []; let size = 0;
            for await (const chunk of response.body) {
                size += chunk.length;
                if (size > byteLength) throw new Error('Pinned model exceeds receipt: ' + name);
                chunks.push(chunk);
            }
            const bytes = Buffer.concat(chunks);
            if (size !== byteLength || digest(bytes) !== sha256) throw new Error('Pinned model integrity mismatch: ' + name);
            await fs.mkdir(path.dirname(destination), { recursive: true });
            const temporary = destination + '.' + randomUUID() + '.tmp';
            try {
                await fs.writeFile(temporary, bytes, { flag: 'wx' });
                await fs.rename(temporary, destination);
            } finally {
                await fs.rm(temporary, { force: true });
            }
            downloadedBytes += size;
        }
    }));
    return { files: paths.size, downloadedBytes, reusedBytes };
}

async function run() {
    const { values } = parseArgs({ options: { output: { type: 'string' } } });
    const extension = path.resolve(import.meta.dirname, '..');
    const output = path.resolve(values.output ?? path.join(extension, '../../packages/extensions/foxhole/public/foxhole/assets'));
    const pin = JSON.parse(await fs.readFile(path.join(extension, 'src/catalog-release-pin.json'), 'utf8'));
    const {metadata, library} = await preparePublicationCatalogInputs({pin, output, localFile: process.env.NIXIE_FOXHOLE_CATALOG_FILE});
    const models = await preparePublicationModels({ output, library });
    console.log(JSON.stringify({ output, metadata, models }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
