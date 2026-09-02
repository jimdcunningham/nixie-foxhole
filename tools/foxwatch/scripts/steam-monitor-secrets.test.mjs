import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const secretsScriptPath = path.join(scriptsRoot, 'foxwatch-monitor-secrets.ps1');

test('FoxWatch monitor secrets round-trip through current-user DPAPI', {
    skip: process.platform !== 'win32' ? 'Windows DPAPI is required.' : false,
}, () => {
    const secret = 'dummy pasted password + typed suffix';
    const encrypted = runSecretsScript('encrypt-stdin', secret);

    assert.match(encrypted, /^dpapi-v1:/);
    assert.notEqual(encrypted, secret);
    assert.equal(runSecretsScript('decrypt-stdin', encrypted), secret);
});

function runSecretsScript(action, input) {
    const result = spawnSync('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        secretsScriptPath,
        '-Action',
        action,
    ], {
        encoding: 'utf8',
        input,
        windowsHide: true,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
}
