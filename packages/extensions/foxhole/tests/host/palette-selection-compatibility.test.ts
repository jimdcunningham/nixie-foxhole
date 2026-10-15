import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The real project needs scoped Nuxt/viewport loader shims. Keep them in a child
// process so they cannot alter the suite's shared module cache or other tests.
test('saved selections pass real-project dependency and placement scenarios', async context => {
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, [
        '--import', hostSourceUrl('../../../../nixie/tests/nixie/node-test-hooks.mjs', import.meta.url).href,
        '--import', hostSourceUrl('../host-hooks.mjs', import.meta.url).href,
        '--test', '--test-reporter=spec', '--test-isolation=none',
        fileURLToPath(hostSourceUrl('./palette-selection-compatibility-cases.ts', import.meta.url)),
    ], { cwd: fileURLToPath(hostSourceUrl('../../../../nixie/', import.meta.url)), maxBuffer: 1024 * 1024, env: environment });
    assert.match(stdout, /pass 10/);
    context.diagnostic(stdout);
});
