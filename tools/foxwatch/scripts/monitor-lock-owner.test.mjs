import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesMonitorLockOwner } from './monitor-lock-owner.mjs';

const runner = 'C:/Code/nixie-foxhole/tools/foxwatch/run-foxwatch.mjs';
const lock = { pid: 19172, startedAt: '2026-10-07T19:32:26.825Z' };
const owner = { commandLine: `node.exe "${runner}" monitor-once`, startedAt: '2026-10-07T19:32:26.000Z' };

test('an actual runner predating its lock remains protected', () => {
    assert.equal(matchesMonitorLockOwner(lock, owner, runner), true);
    assert.equal(matchesMonitorLockOwner(lock, { ...owner, commandLine: owner.commandLine.replaceAll('/', '\\').toUpperCase() }, runner), true);
});
test('PID reuse by a console or a later runner cannot block refresh', () => {
    assert.equal(matchesMonitorLockOwner(lock, { ...owner, commandLine: 'conhost.exe 0x4' }, runner), false);
    assert.equal(matchesMonitorLockOwner(lock, { ...owner, startedAt: '2026-10-07T19:43:30.000Z' }, runner), false);
    assert.equal(matchesMonitorLockOwner(lock, { ...owner, commandLine: 'node.exe other-runner.mjs' }, runner), false);
    assert.equal(matchesMonitorLockOwner(lock, null, runner), false);
});

test('live Windows owner inspection recognizes the current runner process', async () => {
    if (process.platform !== 'win32') return;
    const { isMonitorLockOwnerAlive } = await import('./monitor-lock-owner.mjs');
    const liveLock = { pid: process.pid, startedAt: new Date().toISOString() };
    const absoluteOwner = await isMonitorLockOwnerAlive(liveLock, process.argv[1]);
    const relativeOwner = absoluteOwner || await isMonitorLockOwnerAlive(liveLock, path.relative(process.cwd(), process.argv[1]));
    assert.equal(relativeOwner, true);
});
