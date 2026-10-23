import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

/** Reuse the monitor's current-user DPAPI boundary; secrets never enter command arguments. */
export async function transformAssetCredentialSecret(action, value) {
    if (process.platform !== 'win32') throw new Error('Monitor credential files require Windows DPAPI; use the publication environment variables on other systems');
    if (!['encrypt-stdin', 'decrypt-stdin'].includes(action)) throw new Error('Invalid credential operation');
    const script = fileURLToPath(new URL('./foxwatch-monitor-secrets.ps1', import.meta.url));
    return await new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action],
            {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
        let stdout = '', failed = false;
        const timer = setTimeout(() => {failed = true; child.kill(); reject(new Error('Credential operation timed out'));}, 15000);
        child.stdout.on('data', chunk => {stdout += chunk; if (stdout.length > 65536) {failed = true; child.kill(); reject(new Error('Credential output exceeds budget'));}});
        child.stderr.resume();
        child.on('error', () => {clearTimeout(timer); reject(new Error('Could not start the monitor credential helper'));});
        child.on('close', code => {clearTimeout(timer); if (failed) return; if (code === 0) resolve(stdout); else reject(new Error('Could not unlock asset credentials for the current Windows user'));});
        child.stdin.on('error', () => {}); child.stdin.end(value);
    });
}
export async function loadAssetPublicationCredentials(config, repoRoot, env = process.env) {
    if (env.FOXWATCH_ASSETS_ACCESS_KEY_ID || env.FOXWATCH_ASSETS_SECRET_ACCESS_KEY) return env;
    if (!config.credentialFile) return env;
    const file = path.resolve(repoRoot, config.credentialFile);
    if ((await fs.stat(file)).size > 65536) throw new Error('Asset credential file exceeds its budget');
    const encrypted = (await fs.readFile(file, 'utf8')).trim();
    if (!encrypted.startsWith('dpapi-v1:')) throw new Error('Asset credential file must be protected with current-user DPAPI');
    const value = JSON.parse(await transformAssetCredentialSecret('decrypt-stdin', encrypted));
    if (typeof value.accessKeyId !== 'string' || typeof value.secretAccessKey !== 'string') throw new Error('Invalid asset credential record');
    return {FOXWATCH_ASSETS_ACCESS_KEY_ID: value.accessKeyId, FOXWATCH_ASSETS_SECRET_ACCESS_KEY: value.secretAccessKey};
}
