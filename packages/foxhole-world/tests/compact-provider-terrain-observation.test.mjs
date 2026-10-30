import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createTransferLedger} from '../runtime/terrain-network-observation.mjs';

const source=readFileSync(new URL('../runtime/compact-provider.mjs',import.meta.url),'utf8')
 .replace(/^import .*;\r?\n/gm,'')
 .replaceAll('import.meta.url',JSON.stringify(import.meta.url))
 .replace('export async function','async function')+'\ncreateCompactProvider;';

async function fixture(){
 const workers=[];let start;
 const started=new Promise(resolve=>start=resolve);
 const manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{
  'fixture/terrain-live/albedo-0.bin.gz':{codec:'rgba-image-array',slices:[]},
 },recipes:{},physicalResources:[]};
 class Worker{
  constructor(){this.index=workers.length;workers.push(this);queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}
  postMessage(message){if(this.index===0){this.job=message;start();}}
  emit(message){this.onmessage?.({data:{id:this.job.id,...message}});}
  terminate(){this.stopped=true;}
 }
 const create=runInNewContext(source,{createTransferLedger,createWorldCacheLease:()=>({use:async()=>{},dispose(){}}),
  compactResourceCacheKey:()=>'',recipeKey:()=>'',roadKey:()=>'',createSourceLeasePool:()=>({}),
  location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,AbortSignal,DOMException,
  setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,
  fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}});
 const result=provider.zipped('fixture/terrain-live/albedo-0.bin.gz');
 await started;
 return {provider,result,worker:workers[0],workers};
}

test('terrain network observations do not complete the decode job',async()=>{
 const f=await fixture();let settled=false;
 void f.result.then(()=>{settled=true;},()=>{settled=true;});
 try{
  f.worker.emit({kind:'terrain-observation',observation:{id:'slice-1',kind:'observed',bytes:73}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false,'a network observation is not the decoded pixel result');
  assert.equal(f.provider.metrics.terrainTransfers.observed,1);
  assert.equal(f.provider.metrics.terrainTransfers.bytes,73);
  f.worker.emit({result:new Uint8Array([1,2,3]).buffer});
  assert.deepEqual(Array.from(new Uint8Array(await f.result)),[1,2,3]);
  f.worker.emit({kind:'terrain-observation',observation:{id:'late',kind:'observed',bytes:99}});
  assert.equal(f.provider.metrics.terrainTransfers.bytes,73,'late observations for a completed job are ignored');
 }finally{f.provider.destroy();await f.provider.whenDisposed();}
});

test('retired terrain work ignores later observations while the worker drains',async()=>{
 const f=await fixture();
 f.worker.emit({kind:'terrain-observation',observation:{id:'before',kind:'observed',bytes:7}});
 assert.equal(f.provider.metrics.terrainTransfers.bytes,7);
 f.provider.destroy();
 f.worker.emit({kind:'terrain-observation',observation:{id:'after',kind:'observed',bytes:11}});
 assert.equal(f.provider.metrics.terrainTransfers.bytes,7);
 assert.ok(f.workers.every(worker=>!worker.stopped),'dispatched decode must drain before termination');
 f.worker.emit({result:new Uint8Array([1]).buffer});
 await f.result.catch(()=>{});
 await f.provider.whenDisposed();
 assert.ok(f.workers.every(worker=>worker.stopped));
});

test('a decoder error after an observation still rejects the caller',async()=>{
 const f=await fixture();
 try{
  f.worker.emit({kind:'terrain-observation',observation:{id:'slice',kind:'observed',bytes:4}});
  f.worker.emit({error:'invalid terrain pixels'});
  await assert.rejects(f.result,/invalid terrain pixels/);
  assert.equal(f.provider.metrics.terrainTransfers.bytes,4);
 }finally{f.provider.destroy();await f.provider.whenDisposed();}
});
