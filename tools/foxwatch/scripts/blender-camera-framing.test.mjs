import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('camera fitting and anchor projections ignore the preceding camera pose', t => {
    const executable = process.env.BLENDER_PATH || 'blender';
    const script = fileURLToPath(new URL('../blender/test_camera_framing.py', import.meta.url));
    const result = spawnSync(executable, [
        '--background', '--factory-startup', '--python-exit-code', '1', '--python', script,
    ], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    if (result.error?.code === 'ENOENT') {
        t.skip('Blender is not installed; set BLENDER_PATH to run this regression');
        return;
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Camera framing is independent/);
});
