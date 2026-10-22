import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {retireUnusedWorldContent} from '../retire-unused.mjs';

test('world retirement retains code-declared runtime masks outside region manifests', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'world-runtime-retention-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const target = path.join(directory, 'world'), retired = path.join(directory, 'retired');
    async function content(bytes) {const hash = createHash('sha256').update(bytes).digest('hex'), file = `content/raw/${hash}/asset.webp`; await fs.mkdir(path.dirname(path.join(target, file)), {recursive: true}); await fs.writeFile(path.join(target, file), bytes); return file;}
    const mask = await content(Buffer.from('active repair mask')), obsolete = await content(Buffer.from('old mask'));
    await fs.writeFile(path.join(target, 'index.json'), JSON.stringify({version: 1, format: 'compact-recipes-v1', regions: {}}));
    const result = await retireUnusedWorldContent({target, retired, runtimeRoots: [{path: `world/${mask}`} ]});
    assert.equal(result.files, 1); assert.equal((await fs.readFile(path.join(target, mask))).toString(), 'active repair mask');
    assert.equal((await fs.readFile(path.join(retired, obsolete))).toString(), 'old mask');
    await assert.rejects(() => fs.access(path.join(target, obsolete)));
});
