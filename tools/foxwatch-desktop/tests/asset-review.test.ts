import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  utimes,
  readdir,
  realpath,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliCompressSync, constants } from 'node:zlib';
import { AssetDirectory } from '../electron/asset-directory.ts';
import { AssetReview } from '../electron/asset-review.ts';

async function setup(t: test.TestContext) {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'foxwatch-review-')));
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

test('per-file comparison reads independent approved and working sides without a directory scan', async t => {
  const {root,review} = await setup(t);
  await writeFile(path.join(root,'asset.json'), '{"version":1}');
  assert.equal((await review.comparison('asset.json')).approvedAt, null);
  await review.approve();
  await writeFile(path.join(root,'asset.json'), '{"version":2}');
  const pair = await review.comparison('asset.json');
  assert.ok(pair.approvedAt);
  assert.equal(await readFile(pair.before!.absolutePath,'utf8'), '{"version":1}');
  assert.equal(await readFile(pair.after!.absolutePath,'utf8'), '{"version":2}');
  await rm(path.join(root,'asset.json'));
  const removed = await review.comparison('asset.json');
  assert.ok(removed.before); assert.equal(removed.after,null);
  await writeFile(path.join(root,'new.json'), '{}');
  const added = await review.comparison('new.json');
  assert.equal(added.before,null); assert.ok(added.after);
  await assert.rejects(review.comparison('../outside.json'), /Invalid/);
  await assert.rejects(review.comparison('missing.json'), /unavailable/);
});

test('discard restores modified and deleted files, removes additions, and preserves the approved baseline', async t => {
  const {root,review} = await setup(t);
  await writeFile(path.join(root,'modified.txt'),'original');
  await mkdir(path.join(root,'old'));
  await writeFile(path.join(root,'old/deleted.txt'),'restore me');
  await review.approve();
  const approved = await readFile(path.join(review.storage,'approved.json'),'utf8');
  const approvedAt = review.summary().approvedAt;
  await writeFile(path.join(root,'modified.txt'),'working');
  await rm(path.join(root,'old/deleted.txt'));
  await mkdir(path.join(root,'new'));
  await writeFile(path.join(root,'new/added.txt'),'discard me');
  await writeFile(path.join(root,'.local-settings'),'keep hidden metadata');
  const plan = await review.prepareDiscard();
  assert.deepEqual([plan.summary.added,plan.summary.modified,plan.summary.deleted],[1,1,1]);
  const result = await review.discard(plan);
  assert.deepEqual([result.added,result.modified,result.deleted],[0,0,0]);
  assert.equal(await readFile(path.join(root,'modified.txt'),'utf8'),'original');
  assert.equal(await readFile(path.join(root,'old/deleted.txt'),'utf8'),'restore me');
  await assert.rejects(readFile(path.join(root,'new/added.txt')), {code:'ENOENT'});
  await assert.rejects(readFile(path.join(root,'new')), {code:'ENOENT'});
  assert.equal(await readFile(path.join(root,'.local-settings'),'utf8'),'keep hidden metadata');
  assert.equal(review.summary().approvedAt,approvedAt);
  assert.equal(await readFile(path.join(review.storage,'approved.json'),'utf8'),approved);
  assert.ok(!(await readdir(root)).some(name=>name.startsWith('.foxwatch-restore-')));
});

test('discard verifies every needed baseline object before moving working files', async t => {
  const {root,review} = await setup(t);
  for(const name of ['a.txt','z.txt']) await writeFile(path.join(root,name),'original '+name);
  await review.approve();
  for(const name of ['a.txt','z.txt']) await writeFile(path.join(root,name),'modified '+name);
  const plan = await review.prepareDiscard();
  const snapshot = (await review.comparison('z.txt')).before!;
  await writeFile(snapshot.absolutePath,'corrupt baseline copy');
  await assert.rejects(review.discard(plan), /missing or corrupt/);
  for(const name of ['a.txt','z.txt']) assert.equal(await readFile(path.join(root,name),'utf8'),'modified '+name);
  assert.ok(!(await readdir(root)).some(name=>name.startsWith('.foxwatch-restore-')));
});

test('discard refuses a changed working set or changed approval after confirmation', async t => {
  const {root,review} = await setup(t);
  await assert.rejects(review.prepareDiscard(), /Approve a baseline/);
  await writeFile(path.join(root,'file.txt'),'original'); await review.approve();
  await writeFile(path.join(root,'file.txt'),'change one');
  const plan = await review.prepareDiscard();
  await writeFile(path.join(root,'new-after-confirmation.txt'),'unconfirmed');
  await assert.rejects(review.discard(plan), /changed after confirmation/);
  assert.equal(await readFile(path.join(root,'file.txt'),'utf8'),'change one');
  const next = await review.prepareDiscard(); await review.approve();
  await assert.rejects(review.discard(next), /baseline changed/);
});

test('discard rejects a replaced directory link before touching any file', async t => {
  const {root,review} = await setup(t);
  await writeFile(path.join(root,'first.txt'),'original');
  const folder = path.join(root,'nested'); await mkdir(folder);
  await writeFile(path.join(folder,'file.txt'),'approved'); await review.approve();
  const outside = path.join(path.dirname(root),'outside'); await mkdir(outside);
  await writeFile(path.join(outside,'file.txt'),'outside must survive');
  assert.equal(path.dirname(folder),root);
  await rm(folder,{recursive:true});
  try { await symlink(outside,folder,process.platform === 'win32' ? 'junction' : 'dir'); }
  catch(error) { if(['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code!)) {t.skip('Directory links unavailable');return;} throw error; }
  await writeFile(path.join(root,'first.txt'),'modified');
  const plan = await review.prepareDiscard();
  await assert.rejects(review.discard(plan), /link or changed file type/);
  assert.equal(await readFile(path.join(root,'first.txt'),'utf8'),'modified');
  assert.equal(await readFile(path.join(outside,'file.txt'),'utf8'),'outside must survive');
});

test('an interrupted discard retains working bytes and a journal and can be retried', async t => {
  const {root,review} = await setup(t);
  for(const name of ['a.txt','b.txt']) await writeFile(path.join(root,name),'approved '+name);
  await review.approve();
  for(const name of ['a.txt','b.txt']) await writeFile(path.join(root,name),'working '+name);
  const plan = await review.prepareDiscard();
  await assert.rejects(review.discard(plan,(phase,count)=>{ if(phase==='Returning to Baseline'&&count===1)throw new Error('Injected failure'); }), /Recoverable working files/);
  const retained = (await readdir(root)).find(name=>name.startsWith('.foxwatch-restore-'))!;
  const journal = JSON.parse(await readFile(path.join(root,retained,'restore.json'),'utf8'));
  assert.equal(journal.root,root);
  assert.equal(await readFile(path.join(root,retained,'discarded','0'),'utf8'),'working '+journal.files[0].logical);
  const result = await review.discard(await review.prepareDiscard());
  assert.deepEqual([result.added,result.modified,result.deleted],[0,0,0]);
  assert.equal(await readFile(path.join(root,'b.txt'),'utf8'),'approved b.txt');
});

test('discard restores Brotli asset content from its approved object', async t => {
  const {root,review} = await setup(t);
  const folder = path.join(root,'world/content/br/sample'); await mkdir(folder,{recursive:true});
  const file = path.join(folder,'terrain.json');
  const original = brotliCompressSync(Buffer.from('{"height":10}'));
  await writeFile(file,original); await review.approve();
  await writeFile(file,brotliCompressSync(Buffer.from('{"height":20}')));
  await review.discard(await review.prepareDiscard());
  assert.deepEqual(await readFile(file),original);
});
