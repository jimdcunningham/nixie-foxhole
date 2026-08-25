import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const renderedRoot = path.join(process.cwd(), 'tools', 'foxwatch', 'tmp', 'rendered-assets');

if (process.argv.includes('--child')) {
    const queueSize = Number(process.argv[process.argv.indexOf('--child') + 1]);
    const sharpConcurrency = Number(process.argv[process.argv.indexOf('--child') + 2]);
    sharp.concurrency(sharpConcurrency);
    const files = await walkFiles(renderedRoot);
    const previews = files.filter(filePath => filePath.endsWith('.preview.png')).slice(0, 2);
    const defaultIcon = files.find(filePath => filePath.endsWith('.icon.default.png'));
    const textureCandidates = [];
    for (const filePath of files.filter(value => value.endsWith('.texture.webp'))) {
        const size = (await fs.stat(filePath)).size;
        if (size > 250_000 && size < 2_000_000) {
            textureCandidates.push({ filePath, size });
        }
    }
    const texture = textureCandidates.sort((left, right) => right.size - left.size)[0]?.filePath;
    const sources = [...previews, defaultIcon, texture].filter(Boolean);
    if (sources.length < 4) {
        throw new Error('Sharp queue benchmark requires four representative rendered assets.');
    }
    const jobs = [...sources, ...sources, ...sources];
    const startedAt = performance.now();
    const hashes = await mapWithConcurrency(jobs, queueSize, async filePath => {
        const input = await fs.readFile(filePath);
        const isPreview = filePath.endsWith('.preview.png');
        const output = await sharp(input).webp(isPreview
            ? { quality: 90, alphaQuality: 100, effort: 3 }
            : { lossless: true, quality: 100, effort: 3 }).toBuffer();
        return createHash('sha256').update(output).digest('hex');
    });
    console.info(JSON.stringify({
        queueSize,
        sharpConcurrency,
        uvThreadpoolSize: Number(process.env.UV_THREADPOOL_SIZE),
        elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
        hashes,
    }));
    process.exit(0);
}

const configurations = [2, 4, 6].flatMap(queueSize => [1, 2].map(sharpConcurrency => ({ queueSize, sharpConcurrency })));
const results = [];
for (const configuration of configurations) {
    const { stdout } = await execFileAsync(process.execPath, [
        new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1)),
        '--child',
        String(configuration.queueSize),
        String(configuration.sharpConcurrency),
    ], {
        cwd: process.cwd(),
        env: { ...process.env, UV_THREADPOOL_SIZE: String(configuration.queueSize) },
        maxBuffer: 1024 * 1024,
    });
    results.push(JSON.parse(stdout.trim()));
}

const baselineHashes = results[0].hashes;
for (const result of results) {
    if (JSON.stringify(result.hashes) !== JSON.stringify(baselineHashes)) {
        throw new Error(`Sharp output differs for queue=${result.queueSize}, sharp.concurrency=${result.sharpConcurrency}`);
    }
}
const selected = [...results].sort((left, right) => left.elapsedMs - right.elapsedMs)[0];
console.info(JSON.stringify({ schemaVersion: 1, selected, results }, null, 2));

async function mapWithConcurrency(items, concurrency, mapper) {
    const output = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            output[index] = await mapper(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return output;
}

async function walkFiles(root) {
    const output = [];
    async function visit(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolutePath);
            } else if (entry.isFile()) {
                output.push(absolutePath);
            }
        }
    }
    await visit(root);
    return output.sort();
}
