import test from 'node:test';
import assert from 'node:assert/strict';
import { RunController } from '../electron/run-controller.ts';

test('polling waits a full interval after completion and never overlaps work', async () => {
  let now = 1000, count = 0, finish!: (code: number) => void;
  const run = new RunController(async () => { count++; return new Promise(resolve => finish = resolve); }, () => {}, () => now);
  run.polling(true);
  const first = run.tick();
  assert.equal(count, 1);
  now += 30 * 60_000;
  await run.tick();
  assert.equal(count, 1);
  await assert.rejects(run.run('refresh'), /already running/);
  finish(0); await first;
  assert.equal(run.status.nextPollAt, now + 10 * 60_000);
  now += 10 * 60_000 - 1;
  await run.tick(); assert.equal(count, 1);
  now++;
  const second = run.tick(); assert.equal(count, 2);
  finish(0); await second;
});

test('pausing polling leaves active work running and suppresses its next poll', async () => {
  let finish!: (code: number) => void;
  const run = new RunController(() => new Promise(resolve => finish = resolve));
  run.polling(true); const first = run.tick(); run.polling(false);
  assert.equal(run.status.running, true); assert.equal(run.status.polling, false);
  finish(0); await first;
  assert.equal(run.status.nextPollAt, null); assert.equal(run.status.stage, 'Complete');
});

test('failures are visible, unlock the runner, and retain retry scheduling', async () => {
  let count = 0;
  const run = new RunController(async () => { if (count++ === 0) throw new Error('Steam offline'); return 2; }, () => {}, () => 500);
  run.polling(true); await run.tick();
  assert.equal(run.status.stage, 'Failed'); assert.match(run.status.detail, /Steam offline/);
  assert.equal(run.status.running, false); assert.equal(run.status.nextPollAt, 600500);
  await run.run('refresh'); assert.match(run.status.detail, /code 2/);
});

test('native pipeline and worker messages update bounded output and progress', async () => {
  const run = new RunController(async (_operation, line) => {
    line('FOXWATCH_PROGRESS ' + JSON.stringify({ kind: 'pipeline', stage: 'Rendering', detail: 'Two workers', overallPercent: 40 }));
    line('FOXWATCH_PROGRESS ' + JSON.stringify({ kind: 'blender-start', sceneTotal: 100 }));
    line('FOXWATCH_PROGRESS ' + JSON.stringify({ kind: 'blender-scene', worker: 1, completedScenes: 20, scene: 5, sceneTotal: 10, sceneEntry: 'Hospital' }));
    line('FOXWATCH_PROGRESS ' + JSON.stringify({ kind: 'spatial-asset', completedAssets: 10, assetTotal: 20, active: { 2: 'Relic Base' } }));
    assert.equal(run.status.rendered, 20); assert.equal(run.status.exported, 10);
    assert.equal(run.status.workers.length, 2); assert.equal(run.status.workers[0]?.detail, 'Hospital');
    assert.equal(run.status.percent, 57.5);
    line('FOXWATCH_PROGRESS malformed');
    for (let i = 0; i < 400; i++) line('output ' + i);
    assert.equal(run.status.logs.length, 300); assert.equal(run.status.logs.at(-1), 'output 399');
    return 0;
  });
  await run.run('refresh'); assert.equal(run.status.percent, 100);
});

test('preparation and upload checks never chain into publication', async () => {
  const operations: string[] = [];
  const run = new RunController(async operation => { operations.push(operation); return 0; });
  await run.run('prepare'); assert.match(run.status.detail, /Nothing uploaded/);
  await run.run('check'); assert.match(run.status.detail, /Nothing uploaded/);
  assert.deepEqual(operations, ['prepare', 'check']);
});
