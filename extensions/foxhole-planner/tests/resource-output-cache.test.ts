import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIncrementalBuildMirror, createResourceOutputCache } from '../build/resource-output-cache.ts';

test('a changed model copies alone; identical regeneration and untouched outputs are reused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foxhole-resource-cache-'));
    const stage = join(root, 'stage'), model = join(root, 'model.glb'), icon = join(root, 'icon.webp');
    const modelOut = join(stage, 'model.glb'), atlas = join(stage, 'atlas.webp');
    let renders = 0;
    const cache = createResourceOutputCache();
    const build = async () => {
        cache.begin();
        await cache.copy(model, modelOut);
        await cache.generate(atlas, [icon], async () => { renders++; return readFile(icon); });
        return cache.finish(stage, []);
    };
    try {
        await writeFile(model, 'model-a'); await writeFile(icon, 'icon-a');
        assert.deepEqual(await build(), { copied: 1, generated: 1, written: 0, reused: 0, removed: 0 });
        const untouchedAtlas = await stat(atlas);
        await writeFile(model, 'model-b');
        assert.deepEqual(await build(), { copied: 1, generated: 0, written: 0, reused: 1, removed: 0 });
        assert.equal((await stat(atlas)).mtimeMs, untouchedAtlas.mtimeMs);
        assert.equal(await readFile(modelOut, 'utf8'), 'model-b');
        await utimes(model, new Date(), new Date(Date.now() + 1000));
        assert.deepEqual(await build(), { copied: 0, generated: 0, written: 0, reused: 2, removed: 0 });
        assert.equal(renders, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('only dependent atlases rebuild, including reordered membership; removed resources and bundles disappear', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foxhole-atlas-cache-'));
    const stage = join(root, 'stage'), a = join(root, 'a'), b = join(root, 'b');
    const first = join(stage, 'first.webp'), second = join(stage, 'second.webp');
    const cache = createResourceOutputCache();
    let firstRenders = 0, secondRenders = 0;
    const build = async (members = [a]) => {
        cache.begin();
        await cache.generate(first, members, async () => { firstRenders++; return Buffer.from('first'); });
        await cache.generate(second, [b], async () => { secondRenders++; return readFile(b); });
        return cache.finish(stage, []);
    };
    try {
        await writeFile(a, 'a'); await writeFile(b, 'b');
        await build();
        await writeFile(a, 'c');
        await build();
        assert.equal(firstRenders, 2); assert.equal(secondRenders, 1);
        await build([a, b]); await build([b, a]);
        assert.equal(firstRenders, 4); assert.equal(secondRenders, 1);
        await writeFile(join(stage, 'old.js'), 'stale');
        cache.begin();
        await cache.generate(second, [b], async () => { secondRenders++; return readFile(b); });
        assert.equal((await cache.finish(stage, [])).removed, 2);
        await assert.rejects(readFile(first)); await assert.rejects(readFile(join(stage, 'old.js')));
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing or externally changed staged outputs are repaired and failed generation can retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foxhole-resource-repair-'));
    const input = join(root, 'input'), stage = join(root, 'stage'), output = join(stage, 'image.webp');
    const cache = createResourceOutputCache();
    try {
        await writeFile(input, 'correct');
        cache.begin();
        await assert.rejects(cache.generate(output, [input], async () => { throw new Error('decoder failed'); }), /decoder failed/);
        await cache.generate(output, [input], () => readFile(input));
        await cache.finish(stage, []);
        await writeFile(output, 'corrupt');
        cache.begin(); await cache.copy(input, output);
        assert.equal(await readFile(output, 'utf8'), 'correct');
        await rm(output);
        cache.begin(); await cache.copy(input, output);
        assert.equal(await readFile(output, 'utf8'), 'correct');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('incremental publication skips unchanged bytes, repairs modified destinations, and prunes stale files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foxhole-incremental-publish-'));
    const source = join(root, 'source'), target = join(root, 'target');
    const copies: string[] = [], mirror = createIncrementalBuildMirror(path => copies.push(path));
    try {
        await mkdir(source); await mkdir(target);
        await writeFile(join(source, 'model.glb'), 'model'); await writeFile(join(source, 'entry.js'), 'old');
        await mirror(source, target); assert.equal(copies.length, 2); copies.length = 0;
        const modelStamp = (await stat(join(target, 'model.glb'))).mtimeMs;
        await writeFile(join(source, 'entry.js'), 'new');
        await mirror(source, target); assert.deepEqual(copies, [join(target, 'entry.js')]); copies.length = 0;
        assert.equal((await stat(join(target, 'model.glb'))).mtimeMs, modelStamp);
        await utimes(join(source, 'model.glb'), new Date(), new Date(Date.now() + 1000));
        await mirror(source, target); assert.deepEqual(copies, []);
        await writeFile(join(target, 'model.glb'), 'wrong');
        await mirror(source, target); assert.deepEqual(copies, [join(target, 'model.glb')]);
        await rm(join(source, 'entry.js')); await mirror(source, target);
        await assert.rejects(readFile(join(target, 'entry.js')));
    } finally { await rm(root, { recursive: true, force: true }); }
});
