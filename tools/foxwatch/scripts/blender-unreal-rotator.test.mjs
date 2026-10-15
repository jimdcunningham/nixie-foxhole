import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Unreal pitch/roll and assembly-station socket meshes retain their native orientation', t => {
    const script = fileURLToPath(new URL('../blender/test_unreal_rotator.py', import.meta.url));
    const result = spawnSync(process.env.BLENDER_PATH || 'blender', [
        '--background', '--factory-startup', '--python-exit-code', '1', '--python', script,
    ], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    if (result.error?.code === 'ENOENT') { t.skip('Blender is not installed'); return; }
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Unreal rotator regressions passed/);
});
