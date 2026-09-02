import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function acquireProcessLock(filePath, label) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = randomUUID();
        try {
            const descriptor = fs.openSync(filePath, 'wx');
            fs.writeFileSync(descriptor, JSON.stringify({
                pid: process.pid,
                token,
                label,
                startedAt: new Date().toISOString(),
            }));
            fs.closeSync(descriptor);
            return () => releaseProcessLock(filePath, token);
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            const existing = readLock(filePath);
            if (!existing?.pid) {
                throw new Error(`${label} lock exists but its owner cannot be verified: ${filePath}`);
            }
            if (isProcessAlive(existing.pid)) {
                throw new Error(`${label} is already running as PID ${existing.pid}.`);
            }
            fs.rmSync(filePath, { force: true });
        }
    }
    throw new Error(`Unable to acquire ${label} lock.`);
}

function releaseProcessLock(filePath, token) {
    const existing = readLock(filePath);
    if (existing?.token === token) {
        fs.rmSync(filePath, { force: true });
    }
}

function readLock(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        return null;
    }
}

function isProcessAlive(pid) {
    try {
        process.kill(Number(pid), 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}
