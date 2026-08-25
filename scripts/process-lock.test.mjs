import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import { acquireProcessLock } from './process-lock.mjs';

test('process lock rejects a concurrent live owner and releases by token', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-lock-'));
    const lockPath = path.join(directory, 'refresh.lock');
    try {
        const release = acquireProcessLock(lockPath, 'FoxWatch refresh');
        assert.throws(() => acquireProcessLock(lockPath, 'FoxWatch refresh'), new RegExp(`PID ${process.pid}`));
        release();
        const secondRelease = acquireProcessLock(lockPath, 'FoxWatch refresh');
        secondRelease();
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('process lock recovers a dead PID', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-lock-'));
    const lockPath = path.join(directory, 'refresh.lock');
    try {
        await fs.writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, token: 'stale' }));
        const release = acquireProcessLock(lockPath, 'FoxWatch refresh');
        release();
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
