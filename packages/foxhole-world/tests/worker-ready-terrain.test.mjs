import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainTexturePool} from '../runtime/terrain-texture-pool.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){for(let i=0;i<100&&!fn();i++)await tick();assert.ok(fn(),'controlled operation did not start');}
const descriptor=id=>({baseUrl:'https://world.test/',kind:'color',entry:{size:128,slices:[{resource:{path:id,hash:id.repeat(64),decodedHash:id.repeat(64)}}]}});
const createSource=o=>({...o,destroy(){this.destroyed=true;}}),jobs=w=>w.sent.filter(v=>v.kind!=='cancel-terrain');
function fixture({timer=false}={}){
 const priorWorker=globalThis.Worker,priorSet=globalThis.setTimeout,priorClear=globalThis.clearTimeout,workers=[],timers=[];
 if(timer){globalThis.setTimeout=fn=>{timers.push(fn);return timers.length;};globalThis.clearTimeout=()=>{};}
 globalThis.Worker=class{constructor(){this.sent=[];this.terminated=false;workers.push(this);}postMessage(data){this.sent.push(data);}terminate(){this.terminated=true;}ready(){this.onmessage?.({data:{kind:'foxhole-worker-ready'}});}error(){this.onerror?.({message:'decoder startup failure'});}ack(id){this.onmessage?.({data:{id,result:new ArrayBuffer(128*128*4)}});}};
 return{workers,timers,restore(){globalThis.Worker=priorWorker;globalThis.setTimeout=priorSet;globalThis.clearTimeout=priorClear;}};
}
test('startup failure releases two undispatched reservations',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource});try{const a=pool.acquire([descriptor('a')],128).catch(e=>e),b=pool.acquire([descriptor('b')],128).catch(e=>e);await until(()=>f.workers.length===1);const w=f.workers[0];assert.equal(jobs(w).length,0);w.error();assert.match((await a).message,/startup failure/);assert.match((await b).message,/startup failure/);await until(()=>pool.stats.usedBytes===0&&w.terminated);w.ready();assert.equal(jobs(w).length,0);}finally{f.restore();}
});
test('cancel before ready removes only its queued job; another dispatches after ready',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),abort=new AbortController();try{const a=pool.acquire([descriptor('a')],128,{signal:abort.signal}).catch(e=>e),b=pool.acquire([descriptor('b')],128);await until(()=>f.workers.length===1);const w=f.workers[0];abort.abort();assert.equal((await a).name,'AbortError');await tick();assert.equal(w.sent.length,0);w.ready();w.ready();assert.equal(jobs(w).length,1);w.ack(jobs(w)[0].id);const lease=await b;lease.release();await until(()=>pool.stats.usedBytes===0&&w.terminated);}finally{f.restore();}
});
test('timeout releases unstarted job and stale ready cannot affect replacement',async()=>{
 const f=fixture({timer:true}),pool=createTerrainTexturePool({createSource});try{const a=pool.acquire([descriptor('a')],128).catch(e=>e);await until(()=>f.workers.length===1&&f.timers.length);const old=f.workers[0];f.timers[0]();assert.match((await a).message,/did not start/);await until(()=>old.terminated);const b=pool.acquire([descriptor('b')],128);await until(()=>f.workers.length===2);const current=f.workers[1];old.ready();assert.equal(current.sent.length,0);current.ready();assert.equal(jobs(current).length,1);current.ack(jobs(current)[0].id);const lease=await b;lease.release();await until(()=>pool.stats.usedBytes===0);}finally{f.restore();}
});
test('error after ready retains in-flight reservation until physical acknowledgment',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),drains=[];try{const result=pool.acquire([descriptor('a')],128,{onDrain:p=>drains.push(p)}).catch(e=>e);await until(()=>f.workers.length===1);const w=f.workers[0];w.ready();assert.equal(jobs(w).length,1);w.error();assert.match((await result).message,/startup failure/);assert.equal(drains.length,1);assert.ok(pool.stats.usedBytes>0);assert.equal(w.terminated,false);w.ack(jobs(w)[0].id);await drains[0];await until(()=>pool.stats.usedBytes===0&&w.terminated);}finally{f.restore();}
});
