import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const extension = fileURLToPath(new URL('..', import.meta.url));
const studio = resolve(process.env.NIXIE_HOST_ROOT || fileURLToPath(new URL('../../../../../nixie', import.meta.url)));
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--experimental-transform-types', '--import', pathToFileURL(resolve(extension, 'tests/sdk-host-hooks.mjs')).href,
    '--import', pathToFileURL(resolve(studio, 'packages/nixie/tests/nixie/node-test-hooks.mjs')).href,
    '--test', ...args.length ? args : ['tests/scene-v2-sdk-connector-gestures.test.ts']],
    { cwd: extension, env: { ...process.env, NIXIE_HOST_ROOT: studio }, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
