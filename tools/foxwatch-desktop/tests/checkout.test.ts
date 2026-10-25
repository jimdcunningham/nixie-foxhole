import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveToolsCheckout } from '../electron/checkout.ts';

async function setup(t: test.TestContext) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-checkout-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const checkout = path.join(base, 'tools checkout'), profile = path.join(base, 'profile');
  await mkdir(path.join(checkout, 'tools/foxwatch'), { recursive: true });
  await mkdir(profile);
  await writeFile(path.join(checkout, 'package.json'), JSON.stringify({ name: 'nixie-foxhole' }));
  await writeFile(path.join(checkout, 'tools/foxwatch/run-foxwatch.mjs'), '');
  return { base, checkout, profile };
}
test('installed app remembers its selected checkout across launches', async t => {
  const { checkout, profile } = await setup(t);
  const selected = await resolveToolsCheckout({ profile, pickDirectory: async () => checkout });
  assert.equal(selected, checkout);
  assert.equal(await resolveToolsCheckout({ profile, pickDirectory: async () => { throw Error('unexpected picker'); } }), checkout);
});
test('development launch remembers the checkout for the installed app', async t => {
  const { checkout, profile } = await setup(t);
  await resolveToolsCheckout({ profile, developmentRoot: checkout, pickDirectory: async () => undefined });
  assert.equal(JSON.parse(await readFile(path.join(profile, 'tools-checkout.json'), 'utf8')).checkout, checkout);
});
test('installed app recovers a moved checkout and rejects unrelated folders', async t => {
  const { checkout, profile, base } = await setup(t);
  await writeFile(path.join(profile, 'tools-checkout.json'), JSON.stringify({ checkout: path.join(base, 'missing') }));
  const choices = [base, checkout];
  assert.equal(await resolveToolsCheckout({ profile, pickDirectory: async () => choices.shift() }), checkout);
  assert.equal(choices.length, 0);
});
test('existing saved assets identify the checkout without prompting', async t => {
  const { checkout, profile } = await setup(t);
  await writeFile(path.join(profile, 'inspector.json'), JSON.stringify({ assetsDirectory: path.join(checkout, 'packages/extensions/foxhole/public/foxhole/assets') }));
  assert.equal(await resolveToolsCheckout({ profile, pickDirectory: async () => { throw Error('unexpected picker'); } }), checkout);
});
test('cancelling setup leaves the profile unconfigured', async t => {
  const { profile } = await setup(t);
  assert.equal(await resolveToolsCheckout({ profile, pickDirectory: async () => undefined }), undefined);
  await assert.rejects(readFile(path.join(profile, 'tools-checkout.json')), { code: 'ENOENT' });
});
