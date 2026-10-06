import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pruneRootStructureArtifactDirectory } from './publish-render-utils.mjs';

test('publication keeps cached intermediate projections while pruning public and stale artifacts', async t => {
    const root = await mkdtemp(join(tmpdir(), 'foxwatch-projection-prune-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const intermediate = join(root, 'renders', 'fixture');
    const published = join(root, 'public', 'fixture');
    const names = ['fixture.render.json', 'fixture.c.render.json', 'fixture.preview.webp', 'fixture.stale.webp', 'scene.json'];
    for (const directory of [intermediate, published]) {
        await mkdir(directory, { recursive: true });
        for (const name of names) await writeFile(join(directory, name), name);
        await pruneRootStructureArtifactDirectory(directory, {
            structureId: 'fixture',
            preserveProjectionSidecars: directory === intermediate,
            isAllowedArtifact: name => name === 'fixture.preview.webp',
        });
    }
    assert.deepEqual((await readdir(intermediate)).sort(), ['fixture.c.render.json', 'fixture.preview.webp', 'fixture.render.json', 'scene.json']);
    assert.equal(await readFile(join(intermediate, 'fixture.render.json'), 'utf8'), 'fixture.render.json');
    assert.deepEqual((await readdir(published)).sort(), ['fixture.preview.webp', 'scene.json']);
});
