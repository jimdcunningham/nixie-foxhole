import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const path=new URL('../runtime/compact-provider.mjs',import.meta.url);
const source=readFileSync(path,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(path.href)).replace('export async function','async function')+'\ncreateCompactProvider;';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){for(let i=0;i<100&&!fn();i++)await tick();assert.ok(fn(),'controlled operation did not start');}
async function fixture({throwAt=-1}={}){
 let failPending=true;const workers=[],timers=[],ref={path:'asset.json'},manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{'fixture/a.json':{resource:ref}},physicalResources:[],recipes:{}};
 class Worker{constructor(){if(failPending&&workers.length===throwAt){failPending=false;throw Error('worker constructor failure');}this.index=workers.length%3;this.sent=[];this.terminated=false;workers.push(this);}postMessage(data){this.sent.push(data);}terminate(){this.terminated=true;}ready(){this.onmessage?.({data:{kind:'foxhole-worker-ready'}});}error(){this.onerror?.({message:'script startup failure'});}ack(id){this.onmessage?.({data:{id,result:new TextEncoder().encode('{}').buffer}});}}
 const create=runInNewContext(source,{createWorldCacheLease:()=>({use:async()=>{},dispose(){}}),createTransferLedger:()=>({summary:()=>({}),values:()=>[],add(){}}),compactResourceCacheKey:r=>r.path,createSourceLeasePool:()=>({}),location:{href:'https://world.test/'},performance,URL,Worker,Map,Set,WeakSet,Promise,AbortController,AbortSignal,DOMException,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},queueMicrotask,TextDecoder,TextEncoder,console,fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://world.test/',entry:{id:'fixture',manifest:{path:'manifest'}}});return{provider,workers,timers};
}
const jobs=w=>w.sent.filter(row=>row.kind!=='cancel-resource');
test('startup failure rejects unsent jobs and completes disposal without acknowledgment',async()=>{
 const f=await fixture(),task=f.provider.json('fixture/a.json').catch(e=>e);await until(()=>f.workers.length===3);assert.equal(jobs(f.workers[2]).length,0);
 f.workers[2].error();assert.match((await task).message,/startup failure/);f.provider.destroy();await f.provider.whenDisposed();f.workers[2].ready();assert.equal(jobs(f.workers[2]).length,0);assert.ok(f.workers.every(w=>w.terminated));
});
test('cancel before readiness neither dispatches nor leaves retirement pending',async()=>{
 const f=await fixture(),abort=new AbortController(),task=f.provider.json('fixture/a.json',{signal:abort.signal}).catch(e=>e);await until(()=>f.workers.length===3);abort.abort();assert.equal((await task).name,'AbortError');assert.equal(f.workers[2].sent.length,0);f.workers[2].ready();assert.equal(jobs(f.workers[2]).length,0);f.provider.destroy();await f.provider.whenDisposed();
});
test('ready dispatches once and runtime failure preserves dispatched job drain',async()=>{
 const f=await fixture(),task=f.provider.json('fixture/a.json').catch(e=>e);await until(()=>f.workers.length===3);const w=f.workers[2];w.ready();w.ready();assert.equal(jobs(w).length,1);w.error();assert.match((await task).message,/startup failure/);f.provider.destroy();let done=false;const drain=f.provider.whenDisposed().then(()=>done=true);await tick();assert.equal(done,false);assert.equal(w.terminated,false);w.ack(jobs(w)[0].id);await drain;assert.equal(w.terminated,true);
});
test('startup timeout drains undispatched jobs and cannot send after a late ready',async()=>{
 const f=await fixture(),task=f.provider.json('fixture/a.json').catch(e=>e);await until(()=>f.workers.length===3&&f.timers.length);f.timers[0]();assert.match((await task).message,/did not start/);f.provider.destroy();await f.provider.whenDisposed();f.workers[2].ready();assert.equal(jobs(f.workers[2]).length,0);
});
test('startup failure in one worker does not retire another worker active write',async()=>{
 const f=await fixture(),task=f.provider.json('fixture/a.json').catch(e=>e);await until(()=>f.workers.length===3);const resource=f.workers[2];resource.ready();assert.equal(jobs(resource).length,1);f.workers[0].error();await task;f.provider.destroy();let done=false;const drain=f.provider.whenDisposed().then(()=>done=true);await tick();assert.equal(done,false);assert.equal(resource.terminated,false);resource.ack(jobs(resource)[0].id);await drain;assert.equal(resource.terminated,true);
});

test('worker constructor failure terminates previously created unstarted workers',async()=>{
 const f=await fixture({throwAt:1}),task=f.provider.json('fixture/a.json').catch(e=>e);assert.match((await task).message,/constructor failure/);f.provider.destroy();await f.provider.whenDisposed();assert.equal(f.workers.length,1);assert.equal(f.workers[0].terminated,true);
});

test('provider starts fresh workers after a failed constructor',async()=>{
 const f=await fixture({throwAt:1});assert.match((await f.provider.json('fixture/a.json').catch(e=>e)).message,/constructor failure/);assert.equal(f.workers[0].terminated,true);
 const second=f.provider.json('fixture/a.json');await until(()=>f.workers.length===4);const resource=f.workers[3];resource.ready();assert.equal(jobs(resource).length,1);resource.ack(jobs(resource)[0].id);assert.equal(JSON.stringify(await second),'{}');f.provider.destroy();await f.provider.whenDisposed();assert.ok(f.workers.slice(1).every(w=>w.terminated));
});
