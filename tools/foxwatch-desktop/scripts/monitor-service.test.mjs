import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { MonitorService } from '../dist-electron/electron/monitor-service.js';

const source = new URL('../../foxwatch/scripts/', import.meta.url);
const waitFor = async predicate => { const deadline = Date.now() + 15000; while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for fake runner'); await new Promise(resolve => setTimeout(resolve, 25)); } };
async function fixture(t) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-controller-'));
  t.after(async () => { assert.ok(path.basename(repo).startsWith('foxwatch-controller-')); await rm(repo, { recursive: true, force: true }); });
  const local = path.join(repo, 'tools/foxwatch/local');
  const scripts = path.join(repo, 'tools/foxwatch/scripts');
  await mkdir(scripts, { recursive: true }); await mkdir(local, { recursive: true });
  for (const [name, exports] of [['steam-monitor-core', '*'], ['asset-pack-publication', '{ validateTarget }'], ['asset-pack-credentials', '*']]) {
    await writeFile(path.join(scripts, name + '.mjs'), `export ${exports} from ${JSON.stringify(new URL(name + '.mjs', source).href)};`);
  }
  await writeFile(path.join(local, 'monitor.config.v1.json'), JSON.stringify({ schemaVersion: 1, intervalMinutes: 10, steamUsername: 'fixture', blenderPath: process.execPath, nixieEnabled: false, branchMode: 'latest', retained: 'existing setting' }));
  await writeFile(path.join(local, 'asset-publication.json'), JSON.stringify({ schemaVersion: 1, assetsRoot: 'assets', outputRoot: 'prepared', credentialFile: 'fixture.credentials', target: { endpoint: 'https://example.r2.cloudflarestorage.com', bucket: 'test-bucket', prefix: 'fixture', publicBaseUrl: 'https://assets.example.com/' } }));
  await writeFile(path.join(repo, 'tools/foxwatch/run-foxwatch.mjs'), `
    import fs from 'node:fs/promises';
    await fs.appendFile('calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
    console.log('FOXWATCH_PROGRESS ' + JSON.stringify({ kind: 'pipeline', stage: 'Fixture Render', overallPercent: 50, detail: 'Synthetic work only' }));
    setTimeout(() => { console.log('final output'); }, 250);
  `);
  const service = new MonitorService(repo, path.join(repo, 'profile'), () => {});
  service.legacyRunning = async () => false;
  await service.initialize(); service.settings.nodePath = process.execPath;
  t.after(() => service.dispose());
  return { repo, service, local };
}

test('existing configuration is reused without starting polling or exposing secrets', { skip: process.platform !== 'win32' }, async t => {
  const { service, repo } = await fixture(t);
  assert.equal(service.controller.status.polling, false);
  const info = await service.info();
  assert.equal(info.settings.steamUsername, 'fixture'); assert.equal(info.steamCredentials, false);
  await assert.rejects(readFile(path.join(repo, 'calls.jsonl')), { code: 'ENOENT' });
});

test('CLI operations are serialized, pause finishes work, and prepare/check never upload', { skip: process.platform !== 'win32' }, async t => {
  const { service, repo, local } = await fixture(t);
  await service.action('start');
  const first = service.controller.tick();
  assert.equal(service.controller.status.running, true);
  await assert.rejects(service.action('refresh'), /active/);
  await service.action('pause');
  await first;
  assert.equal(service.controller.status.stage, 'Complete');
  assert.equal(service.controller.status.nextPollAt, null);
  for (const operation of ['prepare', 'check']) { await service.action(operation); await waitFor(() => !service.controller.status.running); }
  const calls = (await readFile(path.join(repo, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map(args => args[0]), ['monitor-once', 'assets-prepare', 'assets-publish']);
  assert.ok(calls.every(args => !args.includes('--upload')));
  const logs = await readdir(path.join(local, 'logs')); assert.equal(logs.length, 3);
  assert.match(await readFile(path.join(local, 'logs', logs[0]), 'utf8'), /final output/);
});

test('saving settings preserves existing fields and replaces credentials with real DPAPI only', { skip: process.platform !== 'win32' }, async t => {
  const { service, local, repo } = await fixture(t);
  await service.save({ ...service.settings, intervalMinutes: 15 });
  const config = JSON.parse(await readFile(path.join(local, 'monitor.config.v1.json'), 'utf8'));
  assert.equal(config.retained, 'existing setting'); assert.equal(config.intervalMinutes, 15);
  const secret = 'synthetic-test-password-only';
  await service.credentials({ steamPassword: secret, accessKeyId: 'synthetic-access-key', secretAccessKey: secret });
  const encrypted = await readFile(path.join(local, 'credentials/monitor.secrets.dpapi.v1.json'), 'utf8');
  assert.match(encrypted, /dpapi-v1:/); assert.ok(!encrypted.includes(secret));
  const info = await service.info(); assert.equal(info.steamCredentials, true); assert.equal(info.assetCredentials, true);
  assert.ok(!JSON.stringify(info).includes(secret));
  const asset = await readFile(path.join(repo, 'tools/foxwatch/local/asset-publication.credentials.dpapi'), 'utf8');
  assert.match(asset, /^dpapi-v1:/); assert.ok(!asset.includes(secret));
  await assert.rejects(service.save({ ...service.settings, intervalMinutes: 1 }), /5–1440/);
  assert.equal(service.settings.intervalMinutes, 15);
});

test('cancel during runner startup does not start a process later', { skip: process.platform !== 'win32' }, async t => {
  const { service, repo } = await fixture(t);
  let release;
  service.legacyRunning = async () => new Promise(resolve => release = resolve);
  const run = service.controller.run('poll');
  await service.action('cancel');
  release(false); await run;
  assert.equal(service.controller.status.stage, 'Failed'); assert.match(service.controller.status.detail, /cancelled/);
  await assert.rejects(readFile(path.join(repo, 'calls.jsonl')), { code: 'ENOENT' });
});

test('exclusive asset work blocks polling and other operations until completion', {skip:process.platform !== 'win32'}, async t => {
  const {service,repo} = await fixture(t);
  await service.action('start');
  let finish;
  const exclusive = service.withIdle(() => new Promise(resolve => finish=resolve));
  assert.equal(service.busy,true);
  await assert.rejects(service.action('refresh'), /pending/);
  await assert.rejects(service.withIdle(async()=>{}), /active/);
  service.startTimer();
  await new Promise(resolve=>setTimeout(resolve,1100));
  await assert.rejects(readFile(path.join(repo,'calls.jsonl')),{code:'ENOENT'});
  finish(); await exclusive;
  assert.equal(service.busy,false);
  await service.action('pause');
});
