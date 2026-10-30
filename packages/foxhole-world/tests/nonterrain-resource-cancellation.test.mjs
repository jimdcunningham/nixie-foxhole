import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createWorldCacheLease} from '../runtime/cache-retention.mjs';
import {createTransferLedger} from '../runtime/terrain-network-observation.mjs';
import {compactResourceCacheKey} from '../runtime/compact-cache.mjs';
import {recipeKey,roadKey} from '../runtime/recipe-cache.mjs';
import {createSourceLeasePool} from '../runtime/source-leases.mjs';
import {createLayerDemand} from '../runtime/layer-demand.mjs';
const path=new URL('../runtime/compact-provider.mjs',import.meta.url);
const source=readFileSync(path,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(path.href)).replace('export async function','async function')+'\ncreateCompactProvider;';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(){
 const workers=[],jobs=[],cancel=[];const hash='b'.repeat(64),ref={path:'asset.json',decodedHash:hash};
 const manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{'fixture/water.json':{resource:ref},'fixture/water.glb':{resource:ref}},recipes:{},physicalResources:[]};
 class Worker {constructor(){this.index=workers.length%3;workers.push(this);queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(msg){if(msg.kind==='cancel-resource'){cancel.push({worker:this,...msg});return;}if(this.index===2)jobs.push({worker:this,...msg});}terminate(){this.stopped=true;}}
 const create=runInNewContext(source,{createWorldCacheLease,createTransferLedger,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}});
 const reply=(job,value='{}')=>job.worker.onmessage({data:{id:job.id,result:new TextEncoder().encode(value).buffer}});
 const canceled=job=>job.worker.onmessage({data:{id:job.id,error:'AbortError: cancelled'}});
 return {provider,jobs,cancel,reply,canceled};
}
test('last disabled layer cancels worker, drains, and frees demand slot',async()=>{
 const f=await fixture();let started=false;const demand=createLayerDemand({concurrency:1,tasks:{water:{needed:x=>x.water,load:async signal=>{await f.provider.json('fixture/water.json',{signal});}},terrain:{needed:x=>x.terrain,load:async()=>{started=true;}}}});
 try{demand.setLayers({water:true});await tick();assert.equal(f.jobs.length,1);demand.setLayers({terrain:true});await tick();assert.equal(f.cancel.length,1);assert.equal(started,false,'slot waits for cleanup');f.canceled(f.jobs[0]);await demand.whenIdle();assert.equal(started,true);}finally{demand.dispose();f.provider.destroy();}
});
test('aborted subscriber does not cancel another layer sharing its read',async()=>{
 const f=await fixture(),a=new AbortController(),b=new AbortController();try{let rejected=false;const first=f.provider.json('fixture/water.json',{signal:a.signal}).catch(error=>{rejected=true;throw error;});const rejection=assert.rejects(first,{name:'AbortError'});const second=f.provider.json('fixture/water.json',{signal:b.signal});await tick();assert.equal(f.jobs.length,1);a.abort();await tick();assert.equal(rejected,true);assert.equal(f.cancel.length,0);f.reply(f.jobs[0],'{"value":7}');await rejection;assert.equal((await second).value,7);}finally{f.provider.destroy();}
});
test('already aborted callers do not start workers',async()=>{const f=await fixture(),controller=new AbortController();controller.abort();try{await assert.rejects(f.provider.json('fixture/water.json',{signal:controller.signal}),{name:'AbortError'});assert.equal(f.jobs.length,0);}finally{f.provider.destroy();}});
test('aborted generation cannot poison a retry or delete its new request',async()=>{
 const f=await fixture(),a=new AbortController();try{const first=f.provider.binary('fixture/water.glb',{signal:a.signal});const rejection=assert.rejects(first,{name:'AbortError'});await tick();assert.equal(f.jobs.length,1);a.abort();await tick();assert.equal(f.cancel.length,1);const retry=f.provider.binary('fixture/water.glb');await tick();assert.equal(f.jobs.length,2);f.canceled(f.jobs[0]);await rejection;f.reply(f.jobs[1],'ok');assert.equal(new TextDecoder().decode(await retry),'ok');}finally{f.provider.destroy();}
});

test('late errors and messages from a retired worker do not poison its replacement',async()=>{
 const f=await fixture();try{
  const first=f.provider.json('fixture/water.json');await tick();assert.equal(f.jobs.length,1);const old=f.jobs[0];f.reply(old,'{}');await first;f.provider.finish();assert.equal(old.worker.stopped,true);
  const second=f.provider.json('fixture/water.json');await tick();assert.equal(f.jobs.length,2);const replacement=f.jobs[1];old.worker.onerror({message:'old generation failed'});old.worker.onmessage({data:{id:replacement.id,error:'stale result'}});f.reply(replacement,'{"value":8}');assert.equal((await second).value,8);
 }finally{f.provider.destroy();}
});

test('completed binary data stays reusable without memoizing an aborted generation',async()=>{
 const f=await fixture(),controller=new AbortController();try{
  const first=f.provider.binary('fixture/water.glb',{signal:controller.signal});await tick();assert.equal(f.jobs.length,1);f.reply(f.jobs[0],'cached');assert.equal(new TextDecoder().decode(await first),'cached');
  const second=f.provider.binary('fixture/water.glb',{signal:controller.signal});await tick();assert.equal(f.jobs.length,1,'second consumer uses the completed binary');assert.equal(new TextDecoder().decode(await second),'cached');
  f.provider.finish();const third=f.provider.binary('fixture/water.glb',{signal:controller.signal});await tick();assert.equal(f.jobs.length,2,'finish still releases binary memo');f.reply(f.jobs[1],'new');assert.equal(new TextDecoder().decode(await third),'new');
 }finally{f.provider.destroy();}
});
