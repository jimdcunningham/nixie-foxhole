import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { VisualOutputCache } from './visual-output-cache.mjs';
import { configureStructureIconOutputCache, writeCoLocatedIcon } from './publish-structure-icons.mjs';

async function fixture(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-visual-cache-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const output = path.join(root, 'preview.webp');
    await writeFile(output, 'encoded pixels');
    const cache = new VisualOutputCache(path.join(root, 'cache'), { renderer: 'fixture', webp: '1' });
    const identity = () => cache.identity('preview', [Buffer.from('master'), Buffer.from('badge')], { quality: 90 }, [output]);
    return { root, output, cache, identity };
}

test('unchanged inputs reuse verified bytes and damaged or missing outputs invalidate', async t => {
    const { output, cache, identity } = await fixture(t);
    await cache.record(identity());
    const before = (await stat(output)).mtimeMs;
    assert.equal(await cache.matches(identity()), true);
    assert.equal((await stat(output)).mtimeMs, before);
    await writeFile(output, 'damaged pixels');
    assert.equal(await cache.matches(identity()), false);
    await rm(output);
    assert.equal(await cache.matches(identity()), false);
});

test('masters, overlays, encoders, settings, and all outputs participate in reuse', async t => {
    const { root, output, cache, identity } = await fixture(t);
    const original = identity();
    await cache.record(original);
    for (const inputs of [[Buffer.from('changed master'), Buffer.from('badge')],
        [Buffer.from('master'), Buffer.from('changed badge')]]) {
        assert.equal(await cache.matches(cache.identity('preview', inputs, { quality: 90 }, [output])), false);
    }
    assert.equal(await cache.matches(cache.identity('preview', [Buffer.from('master'), Buffer.from('badge')], { quality: 80 }, [output])), false);
    const changedEncoder = new VisualOutputCache(path.join(root, 'cache'), { renderer: 'fixture', webp: '2' });
    assert.equal(await changedEncoder.matches(changedEncoder.identity('preview', [Buffer.from('master'), Buffer.from('badge')], { quality: 90 }, [output])), false);
    const extra = path.join(root, 'icon.webp');
    await writeFile(extra, 'icon');
    const pair = cache.identity('pair', [Buffer.from('master')], {}, [output, extra]);
    await cache.record(pair);
    await rm(extra);
    assert.equal(await cache.matches(pair), false);
});

test('publication records final alias bytes and corrupt cache records miss', async t => {
    const { output, cache, identity } = await fixture(t);
    const id = identity();
    cache.schedule(id);
    await writeFile(output, 'final composed icon');
    await cache.flush();
    assert.equal(await cache.matches(id), true);
    await writeFile(id.recordPath, '{invalid');
    assert.equal(await cache.matches(id), false);
});

test('co-located icon publication uses the cache and invalidates changed image content', async t => {
    const { root, cache } = await fixture(t);
    configureStructureIconOutputCache(cache);
    t.after(() => configureStructureIconOutputCache(null));
    const content = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const options = { outputPath: path.join(root, 'icon.webp'), assetKind: 'icon.rendered',
        rawSource: { content, sourceFilePath: path.join(root, 'master.png') } };
    assert.equal((await writeCoLocatedIcon(options)).wrote, true);
    await cache.flush();
    let hits = 0;
    const matches = cache.matches.bind(cache);
    cache.matches = async identity => { const result = await matches(identity); if (result) hits += 1; return result; };
    const before = await readFile(options.outputPath);
    assert.equal((await writeCoLocatedIcon(options)).wrote, false);
    assert.equal(hits, 1);
    assert.deepEqual(await readFile(options.outputPath), before);
    options.rawSource.content = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#00ff00' } }).png().toBuffer();
    assert.equal((await writeCoLocatedIcon(options)).wrote, true);
    assert.notDeepEqual(await readFile(options.outputPath), before);
});
