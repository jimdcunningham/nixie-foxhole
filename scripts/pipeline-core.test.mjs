import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { computeBuildProvenance } from './pipeline-core.mjs';

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
