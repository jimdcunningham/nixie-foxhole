import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssetDirectory, assetKind } from '../electron/asset-directory.ts';

async function fixture(t: test.TestContext) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-inspector-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'assets');
  await mkdir(root);
  await mkdir(path.join(root, 'structures'));
  await writeFile(path.join(root, 'hospital.glb'), 'model');
  await writeFile(path.join(root, 'hospital.preview.webp'), 'image');
  await writeFile(path.join(root, '.private'), 'hidden');
  await writeFile(path.join(base, 'outside.txt'), 'outside');
  return { root, base };
}

test('lists original readable names, folders first, without hidden entries', async (t) => {
  const { root } = await fixture(t);
  const source = await AssetDirectory.open(root);
  const entries = await source.list('');
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ['structures', 'hospital.glb', 'hospital.preview.webp'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ['file', 'model', 'image'],
  );
  const details = await source.inspect('hospital.glb');
  assert.equal(details.name, 'hospital.glb');
  assert.equal(details.bytes, 5);
  assert.equal(details.extension, 'GLB');
  assert.equal(
    await readFile(path.join(root, 'hospital.glb'), 'utf8'),
    'model',
  );
  assert.equal((await AssetDirectory.open(root)).root.path, source.root.path);
  assert.notEqual((await AssetDirectory.open(root)).root.id, source.root.id);
});

test('rejects traversal, absolute paths, missing entries, and directory inspection', async (t) => {
  const { root, base } = await fixture(t);
  const source = await AssetDirectory.open(root);
  for (const invalid of [
    '../outside.txt',
    '..\\outside.txt',
    path.join(base, 'outside.txt'),
    'C:\\Windows',
    '\\\\server\\share',
    'bad\0name',
  ]) {
    await assert.rejects(source.resolve(invalid));
  }
  await assert.rejects(source.inspect('missing.glb'));
  await assert.rejects(source.inspect('structures'), /Select a file/);
  await assert.rejects(
    AssetDirectory.open(path.join(root, 'hospital.glb')),
    /directory/,
  );
});

test('excludes linked folders and rejects escaping through a junction', async (t) => {
  const { root, base } = await fixture(t);
  await symlink(
    base,
    path.join(root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const source = await AssetDirectory.open(root);
  assert.equal(
    (await source.list('')).some((entry) => entry.name === 'linked'),
    false,
  );
  await assert.rejects(source.inspect('linked/outside.txt'), /outside/);
});

test('uses owner and region names without renaming shared physical files', async (t) => {
  const { root } = await fixture(t);
  const hash = 'a'.repeat(64);
  await mkdir(path.join(root, 'models'));
  await mkdir(path.join(root, 'shared/models'), { recursive: true });
  await mkdir(path.join(root, `world/content/br/${hash}`), { recursive: true });
  await writeFile(path.join(root, `shared/models/${hash}.glb`), 'shared');
  await writeFile(
    path.join(root, 'models/manifest.v1.json'),
    JSON.stringify({
      sharedParts: {
        part: { resourceId: 'shared.part', path: `shared/models/${hash}.glb` },
      },
      assets: {
        hospital: {
          codeName: 'Hospital',
          modelParts: { parts: [{ resourceId: 'shared.part' }] },
        },
      },
    }),
  );
  await writeFile(
    path.join(root, 'world/index.json'),
    JSON.stringify({
      regions: {
        deadlands: {
          id: 'Deadlands',
          manifest: { path: `content/br/${hash}/asset.json` },
        },
      },
    }),
  );
  const source = await AssetDirectory.open(root);
  const [shared] = await source.list('shared/models');
  assert.equal(shared?.name, `${hash}.glb`);
  assert.equal(shared?.label, 'Hospital · Shared Part 1.glb');
  assert.equal((await source.inspect(shared!.path)).label, shared?.label);
  assert.equal(
    (await source.list('world/content/br'))[0]?.label,
    'Deadlands · Region',
  );
  assert.equal(await readFile(path.join(root, shared!.path), 'utf8'), 'shared');
});

test('refreshing a directory sees added and removed files', async (t) => {
  const { root } = await fixture(t);
  const source = await AssetDirectory.open(root);
  await source.list('structures');
  await writeFile(path.join(root, 'structures/truck.glb'), 'truck');
  assert.equal((await source.list('structures'))[0]?.name, 'truck.glb');
  await rm(path.join(root, 'structures/truck.glb'));
  assert.equal((await source.list('structures')).length, 0);
});

test('recognizes supported inspector categories without decoding files', () => {
  assert.equal(assetKind('truck.GLB'), 'model');
  assert.equal(assetKind('icon.webp'), 'image');
  assert.equal(assetKind('manifest.json'), 'data');
  assert.equal(assetKind('README.md'), 'text');
  assert.equal(assetKind('ambient.ogg'), 'audio');
});
