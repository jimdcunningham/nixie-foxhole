import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { PublishedLibrary } from '../electron/published-library.ts';

const hash = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex');
const base = 'https://assets.example/foxhole-planner/';
async function setup(t: test.TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const objects = new Map<string, { body: Buffer; encoding?: string }>(),
    requests: string[] = [];
  const metadata = (value: unknown, name: string) => {
    const body = Buffer.from(JSON.stringify(value));
    const url = new URL(name, base).href;
    objects.set(new URL(url).pathname, {
      body: brotliCompressSync(body),
      encoding: 'br',
    });
    return { url, sha256: hash(body), byteLength: body.length };
  };
  const makeRelease = (version: string, invalidPath?: string) => {
    const model = Buffer.from('model ' + version),
      world = Buffer.from('{"region":"Deadlands"}');
    objects.set('/foxhole-planner/objects/' + version + '.glb', {
      body: brotliCompressSync(model),
      encoding: 'br',
    });
    objects.set('/foxhole-planner/world/content/br/example/asset.json', {
      body: brotliCompressSync(world),
      encoding: 'br',
    });
    const contentPath = 'content/br/' + hash(brotliCompressSync(world)) + '/asset.json';
    objects.set('/foxhole-planner/world/' + contentPath, {body:brotliCompressSync(world), encoding:'br'});
    const worldIndex = metadata({version:1,format:'compact-recipes-v1',regions:{}}, 'world-index.json');
    const catalog = metadata({catalogSchemaVersion:1, resourceDefaults:{}, products:[], sharedResources:[
      {id:'model',path:'shared/models/model.glb',sourcePath:'foxhole-planner/objects/' + version + '.glb',sha256:hash(model),byteLength:model.length,mediaType:'model/gltf-binary'},
      {id:'world-index',path:'shared/world-index.json',sourcePath:'foxhole-planner/world-index.json',sha256:worldIndex.sha256,byteLength:worldIndex.byteLength,mediaType:'application/json'},
    ], data:{privateFiles:{[invalidPath ?? 'types/structures/factory/factory.glb']:'shared/models/model.glb', 'shared/models/factory.glb':'shared/models/model.glb'},
      world:{indexResourcePath:'shared/world-index.json',contentRoot:'foxhole-planner/world/',contentResources:{[contentPath]:{sha256:hash(world),byteLength:world.length,mediaType:'application/json'}}}}}, 'catalog-' + version + '.json');
    const release = {schemaVersion:1,baseUrl:'https://assets.example/',catalog};
    const channel = Buffer.from(JSON.stringify({schemaVersion:1,pin:release}));
    objects.set('/foxhole-planner/channels/stable.json',{body:channel});
    return release;
  };
  const pin = makeRelease('one');
  const server = http.createServer((req, res) => {
    const key = new URL(req.url!, 'http://localhost').pathname;
    requests.push(key);
    const row = objects.get(key);
    if (!row) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': key.endsWith('.json')
        ? 'application/json'
        : 'model/gltf-binary',
      ...(row.encoding ? { 'content-encoding': row.encoding } : {}),
      'content-length': row.body.length,
    });
    res.end(row.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const fetcher: typeof fetch = (url, options) =>
    fetch('http://127.0.0.1:' + port + new URL(String(url)).pathname, options);
  const library = new PublishedLibrary({
    root: directory,
    pin,
    channelUrl: new URL('channels/stable.json', base).href,
    fetcher,
  });
  return {
    directory,
    objects,
    requests,
    makeRelease,
    pin,
    library,
    signal: new AbortController().signal,
  };
}
test('downloads verified readable paths, restores Brotli files, and reuses shared objects', async (t) => {
  const f = await setup(t),
    plan = await f.library.check('all', f.signal);
  assert.equal(plan.source, 'channel');
  assert.equal(plan.files.length, 3);
  const info = await f.library.download(plan, f.signal);
  assert.equal(
    await readFile(
      path.join(info.assetsPath, 'types/structures/factory/factory.glb'),
      'utf8',
    ),
    'model one',
  );
  assert.equal(
    brotliDecompressSync(
      await readFile(
        path.join(info.assetsPath, plan.files.find(row=>row.path.startsWith('world/content/'))!.path),
      ),
    ).toString(),
    '{"region":"Deadlands"}',
  );
  assert.equal(
    f.requests.filter((key) => key === '/foxhole-planner/objects/one.glb')
      .length,
    1,
  );
  const before = f.requests.length;
  let reused = 0;
  await f.library.download(plan, f.signal, (progress) => {
    reused = progress.reused;
  });
  assert.equal(f.requests.length, before);
  assert.equal(reused, 3);
});
test('an update keeps the old library intact and downloads only changed content', async (t) => {
  const f = await setup(t),
    first = await f.library.download(
      await f.library.check('all', f.signal),
      f.signal,
    );
  f.makeRelease('two');
  const plan = await f.library.check('all', f.signal);
  const oldRequests = f.requests.filter((key) =>
    key.startsWith('/foxhole-planner/world/content/'),
  ).length;
  const next = await f.library.download(plan, f.signal);
  assert.notEqual(first.assetsPath, next.assetsPath);
  assert.equal(
    await readFile(
      path.join(first.assetsPath, 'types/structures/factory/factory.glb'),
      'utf8',
    ),
    'model one',
  );
  assert.equal(
    await readFile(
      path.join(next.assetsPath, 'types/structures/factory/factory.glb'),
      'utf8',
    ),
    'model two',
  );
  assert.equal(
    f.requests.filter((key) =>
      key.startsWith('/foxhole-planner/world/content/'),
    ).length,
    oldRequests,
  );
  assert.equal(
    (await f.library.current())?.release.sha256,
    plan.release.sha256,
  );
});
test('a missing channel uses the bundled pin; traversal and wrong receipts cannot activate a library', async (t) => {
  const f = await setup(t);
  f.objects.delete('/foxhole-planner/channels/stable.json');
  const plan = await f.library.check('catalog', f.signal);
  assert.equal(plan.source, 'bundled');
  const original = await f.library.download(plan, f.signal);
  f.makeRelease('bad', '../escape.glb');
  await assert.rejects(f.library.check('all', f.signal), /portable|association/);
  f.makeRelease('corrupt');
  const corrupt = await f.library.check('all', f.signal);
  f.objects.set('/foxhole-planner/objects/corrupt.glb', {
    body: Buffer.from('bad'),
  });
  await assert.rejects(f.library.download(corrupt, f.signal), /checksum/);
  assert.equal((await f.library.current())?.assetsPath, original.assetsPath);
});
test('cancellation never cuts over to a partial download, and cache corruption is repaired', async (t) => {
  const f = await setup(t),
    plan = await f.library.check('all', f.signal);
  const controller = new AbortController();
  controller.abort(new Error('Cancelled'));
  await assert.rejects(
    f.library.download(plan, controller.signal),
    /Cancelled/,
  );
  assert.equal(await f.library.current(), null);
  await f.library.download(plan, f.signal);
  const row = plan.files[0]!;
  await writeFile(
    path.join(f.directory, 'objects', row.sha256 + '.raw'),
    'corrupt',
  );
  const before = f.requests.length;
  await f.library.download(plan, f.signal);
  assert.ok(f.requests.length > before);
});
test('rejects release URLs outside the trusted HTTPS asset root', async (t) => {
  const f = await setup(t);
  const body = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      pin: {...f.pin,catalog:{...f.pin.catalog,url:'file:///C:/private'}},
    }),
  );
  f.objects.set('/foxhole-planner/channels/stable.json', { body });
  await assert.rejects(f.library.check('all', f.signal), /trusted HTTPS/);
});
