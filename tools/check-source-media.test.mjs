import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verifySourceMedia } from './check-source-media.mjs';

const bytes = Buffer.from([0, 1, 2, 3]);
const allowed = { sha256: createHash('sha256').update(bytes).digest('hex'), provenance: 'Synthetic four-byte test fixture.' };
const policy = { forbiddenPrefixes: ['public/game/'], files: { 'fixture.bin': allowed } };

test('exact reviewed synthetic bytes pass', () => {
    assert.equal(verifySourceMedia([{ path: 'fixture.bin', bytes }], policy), 1);
});
test('renamed binary and text-form model files fail without review', () => {
    for (const entry of [{ path: 'hidden.txt', bytes }, { path: 'asset.gltf', bytes: Buffer.from('{}') }]) {
        assert.throws(() => verifySourceMedia([entry], { ...policy, files: {} }), /Unreviewed/);
    }
});
test('changed allowlisted bytes and missing provenance fail', () => {
    assert.throws(() => verifySourceMedia([{ path: 'fixture.bin', bytes: Buffer.from([0, 2]) }], policy), /Unreviewed/);
    assert.throws(() => verifySourceMedia([{ path: 'fixture.bin', bytes }], { ...policy, files: { 'fixture.bin': { ...allowed, provenance: '' } } }), /Unreviewed/);
});
test('game-content roots cannot be allowlisted', () => {
    assert.throws(() => verifySourceMedia([{ path: 'public/game/a.bin', bytes }], { ...policy, files: { 'public/game/a.bin': allowed } }), /must not be tracked/);
});
test('embedded raster data and stale allowlists fail', () => {
    assert.throws(() => verifySourceMedia([{ path: 'source.ts', bytes: Buffer.from('data:image/png;base64,' + 'A'.repeat(160)) }], { ...policy, files: {} }), /Embedded/);
    assert.throws(() => verifySourceMedia([], policy), /Stale/);
});
test('generated logs, screenshots, reports and backups cannot be allowlisted', () => {
    for (const path of ['output/result.json', 'screenshots/ui.jpg', 'test-results/run.txt', 'debug.log', 'pose.json.bak']) {
        assert.throws(() => verifySourceMedia([{ path, bytes }], { ...policy, files: { [path]: allowed } }), /Generated output/);
    }
    assert.throws(() => verifySourceMedia([{ path: 'migration-report.json', bytes: Buffer.from('{}') }], { ...policy, files: {}, forbiddenFiles: ['migration-report.json'] }), /Generated output/);
});
