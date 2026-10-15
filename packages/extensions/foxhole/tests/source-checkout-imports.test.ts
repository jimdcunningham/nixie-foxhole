import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('runtime imports and styles do not assume the host is beside the Foxhole layer', () => {
    const layer = fileURLToPath(new URL('../', import.meta.url));
    const stale = /(?:\.\.\/){2,}nixie\/(?:app|server|types|desktop-extensions)\//;
    const violations: string[] = [];
    function inspect(directory: string) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) inspect(path);
            else if (/\.(?:ts|vue|mjs|css)$/.test(entry.name) && stale.test(readFileSync(path, 'utf8'))) violations.push(path);
        }
    }
    for (const directory of ['app', 'server', 'tasks']) inspect(join(layer, directory));
    assert.deepEqual(violations, [], 'Use #nixie-internal for private host dependencies across checkouts.');
});
