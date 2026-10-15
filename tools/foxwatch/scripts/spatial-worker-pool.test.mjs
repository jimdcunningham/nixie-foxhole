import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spatialWorkerCount, runSpatialWorkerPool } from './spatial-worker-pool.mjs';

test('worker admission reserves CPU and memory and caps explicit concurrency', () => {
    assert.equal(spatialWorkerCount(undefined, { cpus: 12, freeBytes: 12 * 2 ** 30 }), 2);
    assert.equal(spatialWorkerCount(4, { cpus: 12, freeBytes: 8 * 2 ** 30 }), 1);
    assert.equal(spatialWorkerCount(4, { cpus: 4, freeBytes: 32 * 2 ** 30 }), 1);
    assert.throws(() => spatialWorkerCount(12));
});

async function fixture(t) {
    const root = await mkdtemp(resolve(tmpdir(), 'foxwatch-worker-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const workerPath = resolve(root, 'worker.mjs');
    await writeFile(workerPath, `process.on('disconnect',()=>process.exit());
process.on('message',async message=>{
 if(message.kind==='initialize'){process.send({kind:'ready'});return;}
 if(message.id==='crash')process.exit(17);
 await new Promise(resolve=>setTimeout(resolve,message.id==='slow'?100:30));
 process.send({kind:'result',id:message.id,result:{timing:{id:message.id,status:'exported'},pid:process.pid}});
});`);
    return workerPath;
}

test('real persistent processes overlap work while manifest commits stay serialized', async t => {
    const workerPath = await fixture(t), pids = new Set(), results = [], active = new Set();
    let peak = 0, writing = 0;
    await runSpatialWorkerPool(['slow','a','b','c','d'], { count: 2, workerPath, options: {},
        onEvent(event) { if(event.kind==='spatial-asset-start') active.add(event.worker); else if(event.kind==='spatial-asset') active.delete(event.worker); peak=Math.max(peak,active.size); },
        async onResult(result) { writing++;assert.equal(writing,1);await new Promise(resolve=>setTimeout(resolve,5));results.push(result.timing.id);pids.add(result.pid);writing--; } });
    assert.equal(peak,2);assert.equal(pids.size,2);assert.equal(new Set(results).size,5);assert.equal(results.length,5);
});

test('a crashed worker rejects the run and closes its peers', async t => {
    const workerPath=await fixture(t);
    await assert.rejects(runSpatialWorkerPool(['crash','slow'],{count:2,workerPath,options:{}}),/exited/);
});

test('cancelling a queued run does not start more assets', async t => {
    const workerPath=await fixture(t),controller=new AbortController();let started=0;
    await assert.rejects(runSpatialWorkerPool(['slow','a','b','c'],{count:1,workerPath,options:{},signal:controller.signal,
        onEvent(event){if(event.kind==='spatial-asset-start'){started++;controller.abort(Error('test cancellation'));}}}),/test cancellation/);
    assert.equal(started,1);
});

test('Windows cancellation also stops an active Blender child process', { skip: process.platform !== 'win32' }, async t => {
    const workerPath = await fixture(t), controller = new AbortController();
    let childPid;
    await writeFile(workerPath, `import { spawn } from 'node:child_process';
process.on('message', message => {
 if (message.kind === 'initialize') { process.send({ kind: 'ready' }); return; }
 const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
 process.send({ kind: 'phase', modelId: String(child.pid), phase: 'Blender Export' });
});`);
    await assert.rejects(runSpatialWorkerPool(['asset'], { count: 1, workerPath, options: {}, signal: controller.signal,
        onEvent(event) { if (event.kind === 'spatial-phase') { childPid = Number(event.modelId); controller.abort(Error('stop active export')); } }
    }), /stop active export/);
    assert.ok(childPid);
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});
