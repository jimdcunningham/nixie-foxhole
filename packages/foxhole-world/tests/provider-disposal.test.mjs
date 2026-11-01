import {retainContainedWaterMaterials} from "../runtime/contained-water.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const path=new URL('../runtime/compact-provider.mjs',import.meta.url);
const source=readFileSync(path,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(path.href)).replace('export async function','async function')+'\ncreateCompactProvider;';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){for(let i=0;i<100&&!fn();i++)await tick();assert.ok(fn(),'controlled operation did not start');}
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:(...v)=>resolve(...v)};};
async function fixture({scheduleModelTask,models=1,withImage=false}={}){
 const workers=[],jobs=[],cancels=[],controller=new AbortController();
 const ref={path:'asset.json'},manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{'fixture/a.json':{resource:ref}},physicalResources:Array.from({length:models},(_,i)=>({path:i?'model'+i+'.glb':'model.glb'})),recipes:{}};if(withImage)manifest.physicalResources.push({path:'image.webp'});
 class Worker {constructor(){this.index=workers.length%3;workers.push(this);queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(data){if(data.kind==='cancel-resource')cancels.push(data.id);else jobs.push({worker:this,...data});}terminate(){this.terminated=true;}}
 const create=runInNewContext(source,{retainContainedWaterMaterials,glbToGltf:()=>({json:{images:withImage?[{uri:'image.webp'}]:[]},buffers:[]}),decodeWorldImage:async()=>({}),ImageSource:class{constructor(o){Object.assign(this,o);this.style={};}destroy(){this.destroyed=true;}},Texture:class{constructor(o){Object.assign(this,o);}},normalizeMeshopt:async()=>{},restoreNativeSmallWaterMaterials:()=>{},restoreNativeFoliageMasks:()=>[],parseGltf:async()=>({textures:[],destroy(){this.destroyed=true;}}),retainModelMaterialNames:s=>s,createWorldCacheLease:()=>({use:async()=>{},dispose(){}}),createTransferLedger:()=>({summary:()=>({}),values:()=>[],add(){}}),compactResourceCacheKey:r=>r.path,createSourceLeasePool:()=>({}),location:{href:'https://world.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,AbortSignal,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://world.test/',entry:{id:'fixture',manifest:{path:'manifest'}},signal:controller.signal,...(scheduleModelTask?{scheduleModelTask}:{})});
 return {provider,controller,workers,jobs,cancels,reply(job,value='{}'){job.worker.onmessage({data:{id:job.id,result:new TextEncoder().encode(value).buffer}});},fail(job){job.worker.onmessage({data:{id:job.id,error:'canceled'}});}};
}
test('disposal cancels shared read and waits for worker acknowledgement before terminating',async()=>{
 const f=await fixture();const first=f.provider.json('fixture/a.json').catch(e=>e),second=f.provider.json('fixture/a.json').catch(e=>e);await until(()=>f.jobs.length===1);f.controller.abort();const done=f.provider.whenDisposed();let settled=false;void done.then(()=>settled=true);await tick();assert.equal(f.cancels.length,1);assert.equal(settled,false);assert.equal(f.workers[2].terminated,undefined);f.fail(f.jobs[0]);await Promise.all([first,second,done]);assert.equal(f.workers[2].terminated,true);assert.equal(f.provider.whenDisposed(),done);
});
test('direct destruction aborts and drains work without an external signal',async()=>{
 const f=await fixture();const pending=f.provider.json('fixture/a.json').catch(e=>e);await until(()=>f.jobs.length===1);f.provider.destroy();const done=f.provider.whenDisposed();await tick();assert.equal(f.cancels.length,1);assert.notEqual(f.workers[2].terminated,true);f.fail(f.jobs[0]);await Promise.all([pending,done]);assert.equal(f.workers[2].terminated,true);
});
test('disposal waits for a queued model task and forbids new work',async()=>{
 const gate=deferred(),started=deferred(),f=await fixture({scheduleModelTask:async task=>{started.resolve();await gate.promise;return task();}});const model=f.provider.model('model.glb').catch(e=>e);await until(()=>f.jobs.length===1);f.reply(f.jobs[0],new ArrayBuffer(0));await started.promise;f.controller.abort();const done=f.provider.whenDisposed();let settled=false;void done.then(()=>settled=true);await tick();assert.equal(settled,false);await assert.rejects(f.provider.json('fixture/a.json'),{name:'AbortError'});gate.resolve();await Promise.all([model,done]);
});
test('actual resource worker acknowledges cancellation only after started cache write drains',async()=>{
 const fpath=new URL('../runtime/resource-worker.mjs',import.meta.url);
 const workerSource=readFileSync(fpath,'utf8').replace(/^import .*;\r?\n/gm,'');const write=deferred(),started=deferred(),messages=[];let producerSignal;
 const self={postMessage:data=>messages.push(data)};runInNewContext(workerSource,{self,performance,AbortController,Promise,String,fetchCompactResource:async(_base,_ref,{signal})=>{producerSignal=signal;started.resolve();await write.promise;signal.throwIfAborted();},readCachedRecipe:async()=>null,readCachedRoadAssembly:async()=>null});
 const task=self.onmessage({data:{id:3,baseUrl:'https://world.test/',ref:{path:'fixture'}}});await started.promise;await self.onmessage({data:{kind:'cancel-resource',id:3}});assert.equal(producerSignal.aborted,true);assert.ok(!messages.some(row=>row.id===3),'no completion acknowledgement during the write');write.resolve();await task;assert.ok(messages.some(row=>row.id===3&&row.error));
});
test('one worker error cannot make disposal terminate another worker with an active job',async()=>{
 const f=await fixture();const pending=f.provider.json('fixture/a.json').catch(e=>e);await until(()=>f.jobs.length===1);f.controller.abort();const done=f.provider.whenDisposed();f.workers[0].onerror({message:'decoder failed'});await tick();
 try{assert.notEqual(f.workers[2].terminated,true,'resource worker must remain alive until its own job acknowledges');}finally{f.fail(f.jobs[0]);await Promise.all([pending,done]);}
});
test('a resource job remains cancellable after an unrelated worker error rejected its consumer',async()=>{
 const f=await fixture();const pending=f.provider.json('fixture/a.json').catch(e=>e);await until(()=>f.jobs.length===1);f.workers[0].onerror({message:'decoder failed'});await pending;f.controller.abort();const done=f.provider.whenDisposed();await tick();try{assert.equal(f.cancels.length,1);}finally{f.fail(f.jobs[0]);await done;}
});

test('model preparation overlaps I/O but bounds buffers queued for host decoding',async()=>{
 const queued=[],f=await fixture({models:12,scheduleModelTask:task=>new Promise((resolve,reject)=>queued.push({task,resolve,reject}))});
 const models=Array.from({length:12},(_,i)=>f.provider.model(i?'model'+i+'.glb':'model.glb'));
 await until(()=>f.jobs.length===8);
 for(const job of f.jobs)f.reply(job,new ArrayBuffer(0));
 await until(()=>queued.length===8);await tick();
 assert.equal(f.jobs.length,8,'prepared buffers must hold their permit until decoding finishes');
 const replied=new Set(f.jobs);
 for(let i=0;i<24;i++){
  await until(()=>queued.length>i);
  const q=queued[i];q.resolve(await q.task());
  if(i===7)assert.equal(f.jobs.length,8,'image preparation and parse scheduling must retain the source permit');
  await tick();
  for(const job of f.jobs)if(!replied.has(job)){replied.add(job);f.reply(job,new ArrayBuffer(0));}
 }
 await Promise.all(models);f.provider.destroy();await f.provider.whenDisposed();
});


test('texture I/O does not occupy a shared model decode slot',async()=>{
 const queued=[],f=await fixture({withImage:true,scheduleModelTask:task=>new Promise((resolve,reject)=>queued.push({task,resolve,reject}))});
 const model=f.provider.model('model.glb');
 await until(()=>f.jobs.length===1);f.reply(f.jobs[0]);await until(()=>queued.length===1);
 const first=queued[0];let released=false;const decoding=first.task().then(value=>{released=true;first.resolve(value);});
 await tick();await tick();
 try{assert.equal(released,true,'the decode slot must release without waiting for the texture cache read');}
 finally{
  await until(()=>f.jobs.length===2);f.reply(f.jobs[1]);await decoding;
  await tick();if(queued[1])queued[1].resolve(await queued[1].task());
  await model;f.provider.destroy();await f.provider.whenDisposed();
 }
});
