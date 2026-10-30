import test from 'node:test';import assert from 'node:assert/strict';
import {createTerrainTexturePool,terrainTextureLayout} from '../runtime/terrain-texture-pool.mjs';
const descriptor=(kind='color')=>({baseUrl:'https://world.test/',kind,entry:{size:256,slices:[{resource:{path:'same',hash:'a'}}]}});
const create=options=>({...options,destroy(){this.destroyed=(this.destroyed||0)+1;}});
const decode=async(_,layout)=>new ArrayBuffer(layout.width*layout.height*layout.layers*(layout.format==='r8unorm'?1:4));
test('regions share identical source arrays and release only after the last owner',async()=>{const pool=createTerrainTexturePool({createSource:create,decode}),a=await pool.acquire([descriptor()],256),b=await pool.acquire([descriptor()],256);assert.equal(a.sources[0],b.sources[0]);assert.equal(pool.stats.loads,1);assert.equal(pool.stats.hits,1);a.release();a.release();assert.equal(b.sources[0].destroyed,undefined);b.release();assert.equal(b.sources[0].destroyed,1);assert.equal(pool.stats.usedBytes,0);});
test('reservations obey the memory budget and fall back to a smaller tier',async()=>{const pool=createTerrainTexturePool({budget:100000,createSource:create,decode}),a=await pool.acquire([descriptor()],256);assert.equal(a.cap,128);assert.ok(pool.stats.usedBytes<=100000);assert.notEqual(terrainTextureLayout(descriptor('normal'),128).key,terrainTextureLayout(descriptor(),128).key);a.release();});
test('retiring one region does not cancel a shared decode needed by another region',async()=>{let resolve;const wait=new Promise(r=>resolve=r),pool=createTerrainTexturePool({createSource:create,decode:async(d,l)=>{await wait;return decode(d,l);}}),abort=new AbortController();const a=pool.acquire([descriptor()],128,{signal:abort.signal}),b=pool.acquire([descriptor()],128);abort.abort();resolve();await assert.rejects(a,{name:'AbortError'});const lease=await b;assert.equal(lease.sources[0].destroyed,undefined);lease.release();assert.equal(pool.stats.usedBytes,0);});
test('decode failures release reservations and allow a later retry',async()=>{let fail=true;const pool=createTerrainTexturePool({createSource:create,decode:async(d,l)=>{if(fail)throw Error('decode failed');return decode(d,l);}});await assert.rejects(pool.acquire([descriptor()],128),/decode failed/);assert.equal(pool.stats.usedBytes,0);fail=false;const lease=await pool.acquire([descriptor()],128);lease.release();assert.equal(pool.stats.usedBytes,0);});

test('shared terrain loads report completed texture slices to each active region',async()=>{
 let finish,started;const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 const input=descriptor();input.entry.slices=[...input.entry.slices,{resource:{path:'b',hash:'b'}},{resource:{path:'c',hash:'c'}}];
 const pool=createTerrainTexturePool({createSource:create,decode:async(d,layout,progress)=>{progress(1);started();await gate;progress(2);return decode(d,layout);}});
 const first=[],second=[];
 const a=pool.acquire([input],128,{onProgress:value=>first.push({...value})});await ready;
 const b=pool.acquire([input],128,{onProgress:value=>second.push({...value})});
 assert.deepEqual(first.at(-1),{completed:1,total:3,unit:'terrain textures'});
 assert.deepEqual(second[0],{completed:1,total:3,unit:'terrain textures'});
 finish();const [one,two]=await Promise.all([a,b]);
 assert.ok(first.some(value=>value.completed===2));assert.ok(second.some(value=>value.completed===2));
 assert.deepEqual(first.at(-1),{completed:3,total:3,unit:'terrain textures'});
 assert.deepEqual(second.at(-1),{completed:3,total:3,unit:'terrain textures'});
 one.release();two.release();assert.equal(pool.stats.usedBytes,0);
});

test('worker progress messages do not settle the texture job early',async()=>{
 const original=globalThis.Worker,events=[];
 globalThis.Worker=class {
  constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}
  postMessage(data){assert.equal(data.reportTextureProgress,true);queueMicrotask(()=>{
   this.onmessage({data:{kind:'terrain-progress',id:data.id,completed:1,total:2}});
   this.onmessage({data:{id:data.id,result:new ArrayBuffer(128*128*2*4)}});
  });}
  terminate(){}
 };
 try{
  const input=descriptor();input.entry.slices.push({resource:{path:'b',hash:'b'}});
  const pool=createTerrainTexturePool({createSource:create});
  const lease=await pool.acquire([input],128,{onProgress:value=>events.push({...value})});
  assert.ok(events.some(value=>value.completed===1&&value.total===2));
  assert.deepEqual(events.at(-1),{completed:2,total:2,unit:'terrain textures'});
  lease.release();
 }finally{globalThis.Worker=original;}
});