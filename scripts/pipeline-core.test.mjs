import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { computeBuildProvenance, createFoxWatchCacheTargets } from './pipeline-core.mjs';

test('FoxWatch build provenance ignores machine-local Steam monitor data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-provenance-'));
    try {
        const sourceRoot = path.join(root, 'tools', 'foxwatch');
        await fs.mkdir(path.join(sourceRoot, 'local', 'installs'), { recursive: true });
        await fs.writeFile(path.join(sourceRoot, 'Pipeline.cs'), 'class Pipeline {}\n');
        await fs.writeFile(path.join(sourceRoot, 'local', 'installs', 'ShouldNotBeRead.cs'), 'class LocalGameFile {}\n');

        const provenance = await computeBuildProvenance(root);

        assert.deepEqual(provenance.entries.map(([file]) => file), ['tools/foxwatch/Pipeline.cs']);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('FoxWatch cache clearing stays inside temporary generated data', () => {
    const root = path.resolve('C:/repo');
    const targets = createFoxWatchCacheTargets(root);
    const temporaryRoot = path.join(root, 'tools', 'foxwatch', 'tmp');

    assert.ok(targets.length > 1);
    assert.ok(targets.every(target => path.relative(temporaryRoot, target)
        && !path.relative(temporaryRoot, target).startsWith('..')));
    assert.ok(targets.some(target => target.endsWith('decoded-asset-bundles')));
    assert.ok(targets.every(target => !target.includes(`${path.sep}local${path.sep}`)));
    assert.ok(targets.every(target => !target.includes(`${path.sep}public${path.sep}`)));
});
