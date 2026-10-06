import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('render cache verifies transitive visual inputs and complete output contents', t => {
    const script = fileURLToPath(new URL('../blender/test_render_cache.py', import.meta.url));
    const result = spawnSync(process.env.BLENDER_PATH || 'blender', [
        '--background', '--factory-startup', '--python-exit-code', '1', '--python', script,
    ], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    if (result.error?.code === 'ENOENT') {
        t.skip('Blender is not installed; test_render_cache.py also runs with standard Python');
        return;
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Render cache regressions passed/);
});
