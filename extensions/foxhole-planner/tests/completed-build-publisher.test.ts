import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isBuildPublishLockError, mirrorCompletedBuild, publishCompletedBuild } from '../build/completed-build-publisher.ts';

test('completed build mirroring replaces files and prunes stale output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nixie-extension-publish-'));
    const source = join(root, 'source');
    const target = join(root, 'target');
    try {
        await mkdir(join(source, 'assets'), { recursive: true });
        await mkdir(join(target, 'assets'), { recursive: true });
        await writeFile(join(source, 'index.html'), 'new entry');
        await writeFile(join(source, 'assets', 'new.js'), 'new bundle');
        await writeFile(join(target, 'index.html'), 'old entry');
        await writeFile(join(target, 'assets', 'old.js'), 'old bundle');
        await mirrorCompletedBuild(source, target);
        assert.equal(await readFile(join(target, 'index.html'), 'utf8'), 'new entry');
        assert.equal(await readFile(join(target, 'assets', 'new.js'), 'utf8'), 'new bundle');
        await assert.rejects(readFile(join(target, 'assets', 'old.js')));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('only Windows-style publish lock failures use the mirror fallback', () => {
    assert.equal(isBuildPublishLockError(Object.assign(new Error(), { code: 'EPERM' })), true);
    assert.equal(isBuildPublishLockError(Object.assign(new Error(), { code: 'EBUSY' })), true);
    assert.equal(isBuildPublishLockError(Object.assign(new Error(), { code: 'ENOENT' })), false);
});

test('watched builds mirror completed output without renaming the live directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nixie-extension-watch-publish-'));
    const source = join(root, 'source');
    const target = join(root, 'target');
    const previous = join(root, 'previous');
    let renameCalls = 0;
    try {
        await mkdir(source, { recursive: true });
        await mkdir(target, { recursive: true });
        await writeFile(join(source, 'index.html'), 'new entry');
        await writeFile(join(target, 'index.html'), 'old entry');
        await writeFile(join(target, 'stale.js'), 'stale bundle');
        await publishCompletedBuild(source, target, previous, true, {
            mirror: mirrorCompletedBuild,
            rename: async () => { renameCalls++; throw Object.assign(new Error('live directory is locked'), { code: 'EPERM' }); },
            rm,
        });
        assert.equal(renameCalls, 0);
        assert.equal(await readFile(join(target, 'index.html'), 'utf8'), 'new entry');
        await assert.rejects(readFile(join(target, 'stale.js')));
        await assert.rejects(readFile(join(source, 'index.html')));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('one-shot builds publish through the atomic swap or its lock fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nixie-extension-build-publish-'));
    const source = join(root, 'source');
    const target = join(root, 'target');
    const previous = join(root, 'previous');
    try {
        await mkdir(source, { recursive: true });
        await mkdir(target, { recursive: true });
        await writeFile(join(source, 'index.html'), 'new entry');
        await writeFile(join(target, 'index.html'), 'old entry');
        await publishCompletedBuild(source, target, previous, false);
        assert.equal(await readFile(join(target, 'index.html'), 'utf8'), 'new entry');
        const previousEntry = await readFile(join(previous, 'index.html'), 'utf8').catch(() => null);
        assert.ok(previousEntry === null || previousEntry === 'old entry');
        await assert.rejects(readFile(join(source, 'index.html')));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('incremental watched publication retains complete staging for the next build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nixie-extension-retained-stage-'));
    const source = join(root, 'source'), target = join(root, 'target'), previous = join(root, 'previous');
    try {
        await mkdir(source); await writeFile(join(source, 'model.glb'), 'model');
        await publishCompletedBuild(source, target, previous, true, {
            mirror: mirrorCompletedBuild,
            rename: async () => { throw new Error('A watched build must not rename the live directory'); },
            rm,
            retainSource: true,
        });
        assert.equal(await readFile(join(target, 'model.glb'), 'utf8'), 'model');
        assert.equal(await readFile(join(source, 'model.glb'), 'utf8'), 'model');
    } finally { await rm(root, { recursive: true, force: true }); }
});
