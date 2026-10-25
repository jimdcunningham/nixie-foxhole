import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { computeBuildProvenance, createFoxWatchCacheTargets, writeJsonAtomic } from './pipeline-core.mjs';

test('FoxWatch build provenance ignores machine-local Steam monitor data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-provenance-'));
    try {
        const sourceRoot = path.join(root, 'tools', 'foxwatch');
        await fs.mkdir(path.join(sourceRoot, 'local', 'installs'), { recursive: true });
        await fs.writeFile(path.join(sourceRoot, 'Pipeline.cs'), 'class Pipeline {}\n');
        await fs.writeFile(path.join(sourceRoot, 'local', 'installs', 'ShouldNotBeRead.cs'), 'class LocalGameFile {}\n');

        const provenance = await computeBuildProvenance(root);

        assert.deepEqual(provenance.entries.map(([file]) => file), ['tools/foxwatch/Pipeline.cs']);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('FoxWatch cache clearing stays inside temporary generated data', () => {
    const root = path.resolve('C:/repo');
    const targets = createFoxWatchCacheTargets(root);
    const temporaryRoot = path.join(root, 'tools', 'foxwatch', 'tmp');

    assert.ok(targets.length > 1);
    assert.ok(targets.every(target => path.relative(temporaryRoot, target)
        && !path.relative(temporaryRoot, target).startsWith('..')));
    assert.ok(targets.some(target => target.endsWith('decoded-asset-bundles')));
    assert.ok(targets.every(target => !target.includes(`${path.sep}local${path.sep}`)));
    assert.ok(targets.every(target => !target.includes(`${path.sep}public${path.sep}`)));
});

async function atomicFixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-atomic-json-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const target = path.join(root, 'manifest.v1.json');
    await fs.writeFile(target, JSON.stringify({ version: 'previous' }));
    return { root, target };
}

async function holdWindowsReader(target, milliseconds) {
    const hold = `Start-Sleep -Milliseconds ${milliseconds}`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$stream = [System.IO.File]::Open($env:FOXWATCH_TEST_MANIFEST, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); try { [Console]::WriteLine('ready'); ${hold} } finally { $stream.Dispose() }`],
    { env: { ...process.env, FOXWATCH_TEST_MANIFEST: target }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; });
    const release = async () => {
        assert.equal((await exited)[0], 0, output);
    };
    await new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => { if (chunk.toString().includes('ready')) resolve(); });
        child.once('error', reject);
        child.once('exit', () => reject(Error('Windows reader exited before opening the file: ' + output)));
    });
    return { exited, release };
}

test('atomic JSON replacement survives a temporary Windows reader without removing the old manifest', { skip: process.platform !== 'win32' }, async t => {
    const { root, target } = await atomicFixture(t);
    const reader = await holdWindowsReader(target, 600);
    try {
        const result = writeJsonAtomic(target, { version: 'next' }).then(() => ({ ok: true }), error => ({ error }));
        assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { version: 'previous' });
        await reader.exited;
        const outcome = await result;
        assert.equal(outcome.ok, true, outcome.error?.stack);
        assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { version: 'next' });
        assert.deepEqual(await fs.readdir(root), ['manifest.v1.json']);
    } finally { await reader.release(); }
});

test('a persistent Windows lock fails without removing the previous manifest or leaving a temporary file', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
    const { root, target } = await atomicFixture(t);
    const reader = await holdWindowsReader(target, 9500);
    try {
        await assert.rejects(writeJsonAtomic(target, { version: 'next' }), { code: 'EPERM', syscall: 'rename' });
        assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { version: 'previous' });
        assert.deepEqual(await fs.readdir(root), ['manifest.v1.json']);
    } finally { await reader.release(); }
});

test('nonretryable rename failures propagate immediately and clean only their temporary file', async t => {
    const { root, target } = await atomicFixture(t);
    const failure = Object.assign(Error('disk I/O failure'), { code: 'EIO' });
    const rename = t.mock.method(fs, 'rename', async () => { throw failure; });
    await assert.rejects(writeJsonAtomic(target, { version: 'next' }), error => error === failure);
    assert.equal(rename.mock.callCount(), 1);
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { version: 'previous' });
    assert.deepEqual(await fs.readdir(root), ['manifest.v1.json']);
});
