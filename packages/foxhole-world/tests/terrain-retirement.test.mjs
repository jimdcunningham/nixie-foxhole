import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferImageSource} from 'pixi.js';
import {LiveTerrainPass} from '../authoring/live-terrain.mjs';
import {createTerrainTexturePool} from '../runtime/terrain-texture-pool.mjs';
import {createTerrainGeometryBudget} from '../runtime/terrain-geometry-budget.mjs';
import {createChunkedTerrainLod} from '../runtime/terrain-chunks.mjs';
import {buildTerrainLod} from '../runtime/terrain-geometry-lod.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function pending(p){let done=false;p.then(()=>done=true,()=>done=true);await tick();return !done;}
const descriptor={baseUrl:'https://world.test/',kind:'color',entry:{size:128,slices:[{resource:{path:'a',hash:'a'.repeat(64),decodedHash:'a'.repeat(64)}}]}};
const makeSource=o=>({...o,destroy(){this.destroyed=true;}});
test('last subscriber waits for the underlying canceled texture producer to drain',async()=>{
 const gate=deferred(),abort=new AbortController(),drains=[],pool=createTerrainTexturePool({createSource:makeSource,decode:async()=>{await gate.promise;return new ArrayBuffer(128*128*4);}});
 const acquisition=pool.acquire([descriptor],128,{signal:abort.signal,onDrain:p=>drains.push(p)}).catch(e=>e);await tick();abort.abort();assert.equal((await acquisition).name,'AbortError');assert.equal(drains.length,1);assert.ok(pool.stats.usedBytes>0);assert.equal(await pending(drains[0]),true);gate.resolve();await drains[0];assert.equal(pool.stats.usedBytes,0);
});
test('retiring one subscriber does not wait for or cancel a shared producer',async()=>{
 const gate=deferred(),abort=new AbortController(),drains=[],pool=createTerrainTexturePool({createSource:makeSource,decode:async()=>{await gate.promise;return new ArrayBuffer(128*128*4);}});
 const first=pool.acquire([descriptor],128,{signal:abort.signal,onDrain:p=>drains.push(p)}).catch(e=>e),second=pool.acquire([descriptor],128);await tick();abort.abort();assert.equal((await first).name,'AbortError');assert.equal(drains.length,0);assert.equal(await pending(second),true);gate.resolve();const lease=await second;assert.equal(lease.sources[0].destroyed,undefined);lease.release();assert.equal(pool.stats.usedBytes,0);
});
test('canceling queued quality work does not wait for another scene',async()=>{
 const pool=createTerrainTexturePool(),gate=deferred(),abort=new AbortController();let ran=false;const other=pool.schedule(()=>gate.promise),queued=pool.schedule(()=>{ran=true;},{signal:abort.signal}).catch(e=>e);abort.abort();assert.equal((await queued).name,'AbortError');assert.equal(ran,false);assert.equal(await pending(other),true);gate.resolve();await other;
});
test('terrain retirement waits for every older quality upload before returning',async()=>{
 const source=channels=>new BufferImageSource({resource:new Uint8Array(channels),width:1,height:1,arrayLayerCount:1,viewDimension:'2d-array',format:channels===1?'r8unorm':'rgba8unorm'}),gates=[deferred(),deferred()];let index=0,prepare=()=>{};
 const lease=cap=>({cap,sources:[source(4),source(4),source(1)],release(){for(const s of this.sources)s.destroy();}}),pool={stats:{},schedule:fn=>Promise.resolve().then(fn),acquire:async(_,cap)=>lease(cap)},pass=new LiveTerrainPass();
 const meta={region:'fixture',buckets:[{start:0,size:1,count:1}],weights:{width:1,height:1,minX:0,maxZ:0},layers:[{}],noise:{width:1,height:1},snowMaterial:{width:1,height:1}};
 await pass.load('fixture',{}, {json:async()=>meta,zipped:async()=>new Uint8Array(4).buffer,status(){},terrainDescriptor:id=>({id}),texturePool:pool,prepareTerrain:s=>prepare(s)});
 prepare=()=>gates[Math.min(index++,1)].promise;const a=pass.setTextureSize(512);await tick();const b=pass.setTextureSize(256);await tick();pass.destroy();const drained=pass.whenDisposed();assert.equal(await pending(drained),true);gates[1].resolve();await b;assert.equal(await pending(drained),true);gates[0].resolve();await a;await drained;assert.equal(pass.current,null);
});
test('chunk retirement waits for canceled detail budget to return',async()=>{
 const gate=deferred(),size=8,source=new Float32Array(size*size*3);for(let z=0;z<size;z++)for(let x=0;x<size;x++)source.set([x,0,z],(z*size+x)*3);
 let time=0;const budget=createTerrainGeometryBudget(1e6),meta={min:[0,0,0],max:[7,1,7],components:[{size,offset:0}]};
 const manager=createChunkedTerrainLod({meta,source,budget,create:mesh=>({mesh}),createView:()=>({}),release(){},releaseView(){},apply(){},now:()=>time,build:async(m,s,step,o)=>{if(step===1)await gate.promise;return buildTerrainLod(m,s,step,o);}});
 await manager.initialize();const camera={position:[0,3,0],height:800,fov:45};manager.update(camera);time=250;manager.update(camera);await tick();assert.ok(budget.stats.pendingBytes>0);manager.destroy();const drained=manager.whenDisposed();assert.equal(await pending(drained),true);gate.resolve();await drained;assert.equal(budget.stats.totalBytes,0);
});

