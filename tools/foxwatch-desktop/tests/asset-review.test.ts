import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliCompressSync, constants } from 'node:zlib';
import { AssetDirectory } from '../electron/asset-directory.ts';
import { AssetReview } from '../electron/asset-review.ts';

async function setup(t: test.TestContext) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-review-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'assets');
  await mkdir(root);
  const directory = await AssetDirectory.open(root);
  const open = () => AssetReview.open(directory, path.join(base, 'reviews'));
  return { root, open, review: await open() };
}
test('approval is explicit and preserves deleted bytes across restarts', async (t) => {
  const { root, review, open } = await setup(t);
  await writeFile(path.join(root, 'removed.txt'), 'approved contents');
  await assert.rejects(review.compare(), /Approve/);
  await review.approve();
  await rm(path.join(root, 'removed.txt'));
  assert.equal(review.summary().deleted, 0);
  assert.equal((await review.compare()).deleted, 1);
  const [row] = await review.list('');
  assert.equal(row?.change, 'deleted');
  assert.equal((await review.inspect('removed.txt')).fromBaseline, true);
  assert.equal(
    await readFile(await review.resolve('removed.txt'), 'utf8'),
    'approved contents',
  );
  const reopened = await open();
  assert.ok(reopened.summary().approvedAt);
  await reopened.compare();
  assert.equal(reopened.summary().deleted, 1);
  await assert.rejects(reopened.resolve('../outside.txt'));
});
test('compares added and same-size modified files by content, ignoring timestamps', async (t) => {
  const { root, review } = await setup(t);
  await writeFile(path.join(root, 'changed.txt'), 'before');
  await writeFile(path.join(root, 'same.txt'), 'same');
  await review.approve();
  await writeFile(path.join(root, 'changed.txt'), 'after!');
  await writeFile(path.join(root, 'added.txt'), 'new');
  await utimes(path.join(root, 'same.txt'), new Date(), new Date('2030-01-01'));
  const result = await review.compare();
  assert.deepEqual(
    [result.added, result.modified, result.deleted, result.unchanged],
    [1, 1, 0, 1],
  );
  assert.equal((await review.inspect('changed.txt')).change, 'modified');
  await review.approve();
  assert.equal((await review.compare()).modified, 0);
});
test('deleted directories remain navigable', async (t) => {
  const { root, review } = await setup(t);
  await mkdir(path.join(root, 'old/nested'), { recursive: true });
  await writeFile(path.join(root, 'old/nested/asset.json'), '{}');
  await review.approve();
  await rm(path.join(root, 'old'), { recursive: true });
  await review.compare();
  assert.equal((await review.list(''))[0]?.directory, true);
  assert.equal((await review.list('old'))[0]?.change, 'deleted');
  assert.equal((await review.list('old/nested'))[0]?.name, 'asset.json');
  await assert.rejects(review.list('../'));
});
test('world transport recompression does not appear as an asset modification', async (t) => {
  const { root, review } = await setup(t);
  await mkdir(path.join(root, 'world/content/br/sample'), { recursive: true });
  const file = path.join(root, 'world/content/br/sample/asset.json'),
    body = Buffer.from(
      '{"region":"Deadlands","data":"' + 'x'.repeat(10000) + '"}',
    );
  await writeFile(
    file,
    brotliCompressSync(body, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 2 },
    }),
  );
  await review.approve();
  await writeFile(
    file,
    brotliCompressSync(body, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
    }),
  );
  assert.equal((await review.compare()).modified, 0);
  await review.approve();
  await rm(file);
  await review.compare();
  const removed = await review.inspect('world/content/br/sample/asset.json');
  assert.equal(removed.bytes, (await readFile(removed.absolutePath)).length);
});
