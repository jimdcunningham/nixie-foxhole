import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainTexturePool} from '../runtime/terrain-texture-pool.mjs';
const descriptor=(id='a')=>({baseUrl:'https://world.test/',kind:'color',entry:{size:128,slices:[{resource:{path:id,hash:id.repeat(64),decodedHash:id.repeat(64)}}]}});
const createSource=options=>({...options,destroy(){this.destroyed=true;}}),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({throwCancel=false}={}){const original=globalThis.Worker,workers=[];globalThis.Worker=class{constructor(){this.sent=[];this.terminated=false;workers.push(this);queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(data){if(throwCancel&&data.kind==='cancel-terrain')throw Error('cancel dispatch failed');this.sent.push(data);}terminate(){this.terminated=true;}};return {workers,restore(){globalThis.Worker=original;}};}
async function until(fn){for(let i=0;i<50&&!fn();i++)await tick();assert.ok(fn(),'worker operation not reached');}
const jobs=w=>w.sent.filter(v=>v.kind!=='cancel-terrain'),cancels=w=>w.sent.filter(v=>v.kind==='cancel-terrain');
const result=(w,id)=>w.onmessage({data:{id,result:new ArrayBuffer(128*128*4)}}),reject=(w,id)=>w.onmessage({data:{id,error:'retired'}});
test('last subscriber aborts immediately, requests worker cancel, and retains budget until drain',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),abort=new AbortController(),p=pool.acquire([descriptor()],128,{signal:abort.signal}).then(()=>null,e=>e);let w;
 try{await until(()=>f.workers[0]?.sent.length);w=f.workers[0];const id=jobs(w)[0].id,prior=pool.stats.usedBytes;abort.abort();assert.equal((await p).name,'AbortError');assert.deepEqual(cancels(w).map(x=>x.id),[id]);assert.equal(pool.stats.usedBytes,prior);assert.equal(w.terminated,false);reject(w,id);await until(()=>pool.stats.usedBytes===0&&w.terminated);}
 finally{if(w)for(const j of jobs(w))try{reject(w,j.id);}catch{}f.restore();}
});
test('one canceled subscriber cannot cancel the shared remaining subscriber',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),abort=new AbortController(),first=pool.acquire([descriptor()],128,{signal:abort.signal}).then(()=>null,e=>e),second=pool.acquire([descriptor()],128);let w;
 try{await until(()=>f.workers[0]?.sent.length);w=f.workers[0];abort.abort();assert.equal((await first).name,'AbortError');assert.equal(cancels(w).length,0);result(w,jobs(w)[0].id);const lease=await second;assert.ok(lease.sources.length);lease.release();assert.equal(pool.stats.usedBytes,0);}
 finally{if(w)for(const j of jobs(w))try{reject(w,j.id);}catch{}f.restore();}
});
test('canceling a multi-record acquire removes queued jobs and drains started jobs',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),abort=new AbortController(),p=pool.acquire([descriptor('a'),descriptor('b'),descriptor('c')],128,{signal:abort.signal}).then(()=>null,e=>e);let w;
 try{await until(()=>f.workers[0]&&jobs(f.workers[0]).length===2);w=f.workers[0];abort.abort();assert.equal((await p).name,'AbortError');await until(()=>cancels(w).length===2);assert.equal(jobs(w).length,2);for(const j of jobs(w))reject(w,j.id);await until(()=>pool.stats.usedBytes===0&&w.terminated);}
 finally{if(w)for(const j of jobs(w))try{reject(w,j.id);}catch{}f.restore();}
});
test('a late canceled result cannot destroy the replacement record',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),abort=new AbortController(),first=pool.acquire([descriptor()],128,{signal:abort.signal}).then(()=>null,e=>e);let w;
 try{await until(()=>f.workers[0]?.sent.length);w=f.workers[0];const old=jobs(w)[0].id;abort.abort();assert.equal((await first).name,'AbortError');const second=pool.acquire([descriptor()],128);await until(()=>jobs(w).length===2);const replacement=jobs(w)[1].id;result(w,old);result(w,replacement);const lease=await second;assert.equal(lease.sources[0].destroyed,undefined);assert.equal(pool.stats.arrays,1);lease.release();await until(()=>pool.stats.usedBytes===0);}
 finally{if(w)for(const j of jobs(w))try{reject(w,j.id);}catch{}f.restore();}
});
test('aborting after acquisition does not release the returned lease',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),abort=new AbortController(),pending=pool.acquire([descriptor()],128,{signal:abort.signal});let w;
 try{await until(()=>f.workers[0]?.sent.length);w=f.workers[0];result(w,jobs(w)[0].id);const lease=await pending;abort.abort();assert.equal(lease.sources[0].destroyed,undefined);lease.release();assert.equal(lease.sources[0].destroyed,true);}
 finally{f.restore();}
});
test('failed cancel delivery keeps reservation until the still-running job replies',async()=>{
 const f=fixture({throwCancel:true}),pool=createTerrainTexturePool({createSource}),abort=new AbortController(),p=pool.acquire([descriptor()],128,{signal:abort.signal}).then(()=>null,e=>e);let w;
 try{await until(()=>f.workers[0]?.sent.length);w=f.workers[0];const prior=pool.stats.usedBytes;abort.abort();assert.equal((await p).name,'AbortError');await tick();assert.equal(pool.stats.usedBytes,prior);assert.equal(w.terminated,false);result(w,jobs(w)[0].id);await until(()=>pool.stats.usedBytes===0&&w.terminated);}
 finally{if(w)for(const j of jobs(w))try{reject(w,j.id);}catch{}f.restore();}
});
test('duplicate descriptors release each reference when the subscriber aborts',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),abort=new AbortController(),p=pool.acquire([descriptor(),descriptor()],128,{signal:abort.signal}).then(()=>null,e=>e);let w;
 try{await until(()=>f.workers[0]?.sent.length);w=f.workers[0];assert.equal(jobs(w).length,1);abort.abort();assert.equal((await p).name,'AbortError');assert.equal(cancels(w).length,1);reject(w,jobs(w)[0].id);await until(()=>pool.stats.usedBytes===0&&w.terminated);}
 finally{if(w)for(const j of jobs(w))try{reject(w,j.id);}catch{}f.restore();}
});

test('stale messages and errors from a retired worker do not harm its replacement',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource});let old,current;
 try{const initial=pool.acquire([descriptor('a')],128);await until(()=>f.workers[0]?.sent.length);old=f.workers[0];result(old,jobs(old)[0].id);const first=await initial;first.release();await until(()=>old.terminated);
  const next=pool.acquire([descriptor('b')],128);await until(()=>f.workers[1]?.sent.length);current=f.workers[1];const id=jobs(current)[0].id;
  old.onmessage({data:{id,error:'stale message'}});old.onerror({message:'stale worker error'});assert.equal(current.terminated,false);result(current,id);const lease=await next;assert.ok(lease.sources.length);lease.release();
 }finally{if(current)for(const j of jobs(current))try{reject(current,j.id);}catch{}f.restore();}
});

test('worker error reports failure but retains each in-flight reservation until acknowledgement',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),drains=[];let w;
 try{
  const first=pool.acquire([descriptor('a')],128,{onDrain:p=>drains.push(p)}).catch(e=>e),second=pool.acquire([descriptor('b')],128,{onDrain:p=>drains.push(p)}).catch(e=>e);
  await until(()=>f.workers[0]&&jobs(f.workers[0]).length===2);w=f.workers[0];const before=pool.stats.usedBytes;w.onerror({message:'fixture decoder failure'});
  assert.match((await first).message,/fixture decoder failure/);assert.match((await second).message,/fixture decoder failure/);assert.equal(drains.length,2);assert.equal(pool.stats.usedBytes,before);assert.equal(w.terminated,false);
  let drained=false;void Promise.all(drains).then(()=>drained=true);await tick();assert.equal(drained,false);
  reject(w,jobs(w)[0].id);await tick();assert.ok(pool.stats.usedBytes>0);assert.equal(w.terminated,false);
  reject(w,jobs(w)[1].id);await Promise.all(drains);await until(()=>pool.stats.usedBytes===0&&w.terminated);
 }finally{if(w)for(const j of jobs(w))try{reject(w,j.id);}catch{}f.restore();}
});
