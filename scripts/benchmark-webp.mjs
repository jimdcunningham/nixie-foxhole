import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const repositoryRoot = process.cwd();
const renderedRoot = path.join(repositoryRoot, 'tools', 'foxwatch', 'tmp', 'rendered-assets');
const efforts = [3, 4, 5, 6];

const files = await walkFiles(renderedRoot);
const previewPath = files.find(filePath => filePath.endsWith('.preview.png'));
const defaultIconPath = files.find(filePath => filePath.endsWith('.icon.default.png'));
const texturePaths = files.filter(filePath => filePath.endsWith('.texture.webp'));
const largestTexturePath = (await Promise.all(texturePaths.map(async filePath => ({
    filePath,
    size: (await fs.stat(filePath)).size,
})))).sort((left, right) => right.size - left.size)[0]?.filePath;

if (!previewPath || !defaultIconPath || !largestTexturePath) {
    throw new Error('WebP benchmark requires preview, default-icon, and texture masters from a prior targeted render.');
}

const sampleDefinitions = [
    { name: 'preview', path: previewPath, options: { quality: 90, alphaQuality: 100 } },
    { name: 'rendered-icon', path: previewPath, resize: 256, options: { quality: 90, alphaQuality: 100 } },
    { name: 'default-icon', path: defaultIconPath, options: { lossless: true, quality: 100 } },
    { name: 'alpha-heavy', path: previewPath, options: { lossless: true, quality: 100 } },
    { name: 'large-texture', path: largestTexturePath, options: { lossless: true, quality: 100 } },
];

const results = [];
for (const sample of sampleDefinitions) {
    const source = await fs.readFile(sample.path);
    let pipeline = sharp(source).ensureAlpha();
    if (sample.resize) {
        pipeline = pipeline.resize(sample.resize, sample.resize, { fit: 'inside', withoutEnlargement: true });
    }
    const reference = await pipeline.clone().raw().toBuffer({ resolveWithObject: true });
    for (const effort of efforts) {
        const startedAt = performance.now();
        const encoded = await pipeline.clone().webp({ ...sample.options, effort }).toBuffer();
        const elapsedMs = performance.now() - startedAt;
        const decoded = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const metrics = comparePixels(reference, decoded);
        results.push({
            sample: sample.name,
            sourcePath: path.relative(repositoryRoot, sample.path).replaceAll('\\', '/'),
            effort,
            elapsedMs: Number(elapsedMs.toFixed(2)),
            size: encoded.length,
            ...metrics,
        });
    }
}

const baselineBySample = new Map(results.filter(result => result.effort === 6).map(result => [result.sample, result]));
const summary = efforts.map(effort => {
    const candidates = results.filter(result => result.effort === effort);
    const aggregateSize = candidates.reduce((sum, result) => sum + result.size, 0);
    const baselineSize = candidates.reduce((sum, result) => sum + baselineBySample.get(result.sample).size, 0);
    const aggregateMs = candidates.reduce((sum, result) => sum + result.elapsedMs, 0);
    const accepted = candidates.every(result => {
        const baseline = baselineBySample.get(result.sample);
        return result.alphaEqual
            && result.size <= baseline.size * 1.10
            && result.psnr + 0.1 >= baseline.psnr;
    }) && aggregateSize <= baselineSize * 1.05;
    return {
        effort,
        accepted,
        aggregateMs: Number(aggregateMs.toFixed(2)),
        aggregateSize,
        sizeDeltaPercent: Number((((aggregateSize / baselineSize) - 1) * 100).toFixed(2)),
    };
});

const selected = summary.filter(entry => entry.accepted).sort((left, right) => left.aggregateMs - right.aggregateMs)[0];
console.info(JSON.stringify({
    schemaVersion: 1,
    sharp: sharp.versions,
    selectedEffort: selected?.effort ?? 6,
    summary,
    results,
}, null, 2));

function comparePixels(reference, candidate) {
    if (reference.info.width !== candidate.info.width || reference.info.height !== candidate.info.height) {
        return { alphaEqual: false, psnr: 0 };
    }
    let alphaEqual = true;
    let squaredError = 0;
    let colorChannels = 0;
    for (let index = 0; index < reference.data.length; index += 4) {
        alphaEqual &&= reference.data[index + 3] === candidate.data[index + 3];
        if (reference.data[index + 3] === 0 && candidate.data[index + 3] === 0) {
            continue;
        }
        for (let channel = 0; channel < 3; channel += 1) {
            const delta = reference.data[index + channel] - candidate.data[index + channel];
            squaredError += delta * delta;
            colorChannels += 1;
        }
    }
    const mse = squaredError / Math.max(1, colorChannels);
    return { alphaEqual, psnr: mse === 0 ? 99 : Number((10 * Math.log10((255 * 255) / mse)).toFixed(4)) };
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
