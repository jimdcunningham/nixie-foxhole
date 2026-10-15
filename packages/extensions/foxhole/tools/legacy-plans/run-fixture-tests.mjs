import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const result = spawnSync(
    process.execPath,
    [
        '--import',
        './tools/legacy-plans/register-nixie-imports.mjs',
        '--test',
        '--test-isolation=none',
        './tests/legacy/**/*.test.ts',
    ],
    {
        cwd: root,
        stdio: 'inherit',
        env: {
            ...process.env,
            LEGACY_PLAN_FIXTURES: '1',
        },
        shell: true,
    },
);

process.exit(result.status ?? 1);
