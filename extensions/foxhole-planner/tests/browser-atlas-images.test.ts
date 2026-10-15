import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { readBrowserAtlasImage } from '../build/browser-atlas-images.ts';

test('atlas decoding releases source files so publication can atomically replace them', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'foxhole-atlas-source-'));
    const source = join(folder, 'icon.webp'), staged = join(folder, '.icon.tmp');
    try {
        const first = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#ff0000' } }).webp({ lossless: true }).toBuffer();
        const second = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#00ff00' } }).webp({ lossless: true }).toBuffer();
        await writeFile(source, first);
        const red = await readBrowserAtlasImage(source);
        assert.equal(red.length, 256 * 256 * 4);
        const center = (128 * 256 + 128) * 4;
        assert.deepEqual([...red.subarray(center, center + 4)], [255, 0, 0, 255]);
        assert.equal(red[3], 0, 'atlas cell keeps transparent padding');
        await writeFile(staged, second);
        await rename(staged, source);
        assert.deepEqual(await readFile(source), second);
        const green = await readBrowserAtlasImage(source);
        assert.deepEqual([...green.subarray(center, center + 4)], [0, 255, 0, 255], 'a rebuilt atlas uses the replacement pixels');
    } finally {
        // Release cached native readers on a failing baseline before deleting the fixture.
        sharp.cache(false);
        sharp.cache({ files: 20, items: 100, memory: 50 });
        const fixture = relative(resolve(tmpdir()), folder);
        if (!fixture.startsWith('..') && !fixture.includes(':')) await rm(folder, { recursive: true, force: true });
    }
});
