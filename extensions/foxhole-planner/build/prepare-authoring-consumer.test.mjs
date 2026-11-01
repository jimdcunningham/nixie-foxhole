import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {prepareAuthoringConsumer} from './prepare-authoring-consumer.mjs';

test('isolated authoring fixtures retain map previews and shadow compiler tests without sibling sources', async t => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-authoring-'));
    t.after(() => fs.rm(fixtureRoot, {recursive: true, force: true}));
    const extensionSource = path.resolve(import.meta.dirname, '..');
    for (const directory of ['src', 'tests']) await fs.mkdir(path.join(fixtureRoot, directory));
    await fs.copyFile(path.join(extensionSource, 'tests/contact-shadows.test.ts'), path.join(fixtureRoot, 'tests/contact-shadows.test.ts'));
    await prepareAuthoringConsumer({extensionSource, fixtureRoot});
    const map = await fs.readFile(path.join(fixtureRoot, 'build/.nixie-authoring/map-metadata.ts'), 'utf8');
    assert.match(map, /from '\.\/map-icon-preview\.ts'/);
    assert.doesNotMatch(map, /packages\/extensions/);
    assert.match(await fs.readFile(path.join(fixtureRoot, 'build/.nixie-authoring/map-icon-preview.ts'), 'utf8'), /resolveFoxholeMapIconPreviewAsset/);
    const shadow = await fs.readFile(path.join(fixtureRoot, 'build/.nixie-authoring/contact-shadows.ts'), 'utf8');
    assert.match(shadow, /from '\.\.\/\.\.\/src\/contact-shadow\.ts'/);
    const shadowTest = await fs.readFile(path.join(fixtureRoot, 'tests/contact-shadows.test.ts'), 'utf8');
    assert.match(shadowTest, /\.\.\/build\/\.nixie-authoring\/contact-shadows\.ts/);
    assert.doesNotMatch(shadowTest, /\.\.\/\.\.\/\.\.\/(tools|packages)/);
});
