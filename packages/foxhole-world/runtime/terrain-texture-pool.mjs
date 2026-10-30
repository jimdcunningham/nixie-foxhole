import {BufferImageSource} from 'pixi.js';
import {TERRAIN_TEXTURE_TIERS,terrainMipBytes} from './terrain-texture-quality.mjs';
const pools=new WeakMap();let fallback;
export function terrainTexturePoolFor(renderer){if(!renderer)return fallback??=createTerrainTexturePool();let pool=pools.get(renderer);if(!pool){pool=createTerrainTexturePool();pools.set(renderer,pool);}return pool;}
export function terrainTextureLayout(descriptor,cap){
 const {entry,kind}=descriptor;const limit=kind==='weights'?(cap<=256?512:cap<=512?1024:Infinity):cap;
 const width=kind==='weights'?descriptor.width:entry.size,height=kind==='weights'?descriptor.height:entry.size,layers=kind==='weights'?descriptor.layers:entry.slices.length;
 const scale=Math.min(1,limit/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)),format=kind==='weights'?'r8unorm':kind==='color'?'rgba8unorm-srgb':'rgba8unorm',channels=kind==='weights'?1:4;
 const identity=kind==='weights'?[entry.resource.decodedHash||entry.resource.hash]:entry.slices.map(s=>s.resource?.decodedHash||s.resource?.hash||s.blob);
 return {width:w,height:h,layers,format,maxSize:limit,bytes:terrainMipBytes(w,h,layers,channels),key:JSON.stringify(['terrain-area-v1',descriptor.baseUrl,kind,width,height,w,h,layers,identity])};
}
/** Reference-counted source ownership. The budget includes reservations and mipmaps. */
export function createTerrainTexturePool({budget=2*1024**3,createSource=options=>new BufferImageSource(options),decode}={}){
 const records=new Map();let usedBytes=0,hits=0,loads=0,worker,workerFailure,workerReady=false,startupTimer,serial=0,active=0,scheduled=false;const pending=new Map(),jobs=[],scheduleJobs=[];
 function stopWorker(){if(worker&&!active&&!jobs.length){clearTimeout(startupTimer);worker.terminate();worker=null;workerFailure=null;workerReady=false;}}
 function runWorker(data,onProgress,onObservation,signal,onFailure){signal?.throwIfAborted();if(workerFailure)throw workerFailure;if(!worker){
  const generation=new Worker(new URL('../authoring/decode-worker.mjs',import.meta.url),{type:'module'});worker=generation;workerReady=false;
  // Before the startup acknowledgement, no decode job can have begun. If
  // startup fails, queued reservations can be released without interrupting
  // another job's cache write. Dispatched work still waits for acknowledgement.
  const fail=error=>{if(worker!==generation)return;workerFailure=error;clearTimeout(startupTimer);for(const [id,p] of pending){p.onFailure?.(error);if(!p.sent){pending.delete(id);p.reject(error);}}};
  startupTimer=setTimeout(()=>fail(Error('Terrain decoder did not start within 30 seconds.')),30000);startupTimer.unref?.();
  generation.onmessage=({data})=>{if(worker!==generation)return;if(data.kind==='foxhole-worker-ready'){
   if(workerReady)return;workerReady=true;clearTimeout(startupTimer);if(!workerFailure)for(const p of pending.values())if(!p.sent)p.dispatch();return;
  }const p=pending.get(data.id);if(!p||!p.sent)return;if(data.kind==='terrain-progress'){p.onProgress?.(data.completed,data.total);return;}if(data.kind==='terrain-observation'){p.onObservation?.(data.observation);return;}pending.delete(data.id);for(const observation of data.observations||[])p.onObservation?.(observation);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
  generation.onerror=e=>fail(Error(e.message||'Terrain decoder failed'));
 }
 const target=worker;return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  const id=++serial;let job;
  const onAbort=()=>{if(!job.sent){if(pending.get(id)!==job)return;pending.delete(id);finish(reject,signal.reason);return;}try{target.postMessage({kind:'cancel-terrain',id});}catch{/* The job may still run; retain its reservation until it drains. */}};
  const finish=(fn,value)=>{signal?.removeEventListener('abort',onAbort);fn(value);};
  job={resolve:value=>finish(resolve,value),reject:error=>finish(reject,error),onProgress,onObservation,onFailure,sent:false};
  job.dispatch=()=>{if(pending.get(id)!==job||job.sent)return;if(signal?.aborted){onAbort();return;}job.sent=true;try{target.postMessage({...data,id});}catch(error){pending.delete(id);finish(reject,error);}};
  pending.set(id,job);signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted){onAbort();return;}if(workerReady)job.dispatch();
 });}
 function pump(){while(active<2&&jobs.length){const job=jobs.shift();job.signal?.removeEventListener('abort',job.onAbort);if(job.signal?.aborted){job.reject(job.signal.reason);continue;}active++;Promise.resolve().then(job.build).then(job.resolve,job.reject).finally(()=>{active--;pump();stopWorker();});}}
 const work=(build,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  const job={build,resolve,reject,signal,onAbort:null};job.onAbort=()=>{const index=jobs.indexOf(job);if(index<0)return;jobs.splice(index,1);signal.removeEventListener('abort',job.onAbort);reject(signal.reason);pump();stopWorker();};
  jobs.push(job);signal?.addEventListener('abort',job.onAbort,{once:true});if(signal?.aborted)job.onAbort();else pump();
 });
 const load=decode||((descriptor,layout,onProgress,onObservation,signal,onFailure)=>work(()=>runWorker(descriptor.kind==='weights'?{kind:'weights',entry:descriptor.entry,baseUrl:descriptor.baseUrl,width:descriptor.width,height:descriptor.height,layers:descriptor.layers,maxSize:layout.maxSize}:{kind:'array',entry:descriptor.entry,baseUrl:descriptor.baseUrl,maxSize:layout.width,normal:descriptor.kind==='normal',reportTextureProgress:true,sliceUrls:descriptor.entry.slices.map(s=>new URL(s.resource.path,descriptor.baseUrl).href)},onProgress,onObservation,signal,onFailure),signal));
 async function pumpSchedule(){if(scheduled)return;scheduled=true;try{while(scheduleJobs.length){const job=scheduleJobs.shift();job.signal?.removeEventListener('abort',job.abort);try{job.signal?.throwIfAborted();job.resolve(await job.build());}catch(error){job.reject(error);}}}finally{scheduled=false;}}
 function free(record){if(!record.accounted)return;record.accounted=false;usedBytes-=record.layout.bytes;if(records.get(record.layout.key)===record)records.delete(record.layout.key);record.source?.destroy();}
 function release(record){record.refs--;if(!record.refs){if(record.settled)free(record);else{if(records.get(record.layout.key)===record)records.delete(record.layout.key);record.controller.abort();return record.promise.catch(()=>{});}}}
 return {
  get stats(){return {usedBytes,budget,arrays:records.size,hits,loads,pending:active+jobs.length};},
  schedule(build,{signal}={}){return new Promise((resolve,reject)=>{
   if(signal?.aborted){reject(signal.reason);return;}
   const job={build,resolve,reject,signal};job.abort=()=>{const i=scheduleJobs.indexOf(job);if(i>=0){scheduleJobs.splice(i,1);signal.removeEventListener('abort',job.abort);reject(signal.reason);}};
   scheduleJobs.push(job);signal?.addEventListener('abort',job.abort,{once:true});if(signal?.aborted)job.abort();else pumpSchedule();
  });},
  async acquire(descriptors,wanted,{signal,onProgress,onObservation,onDrain}={}){
   signal?.throwIfAborted();let cap,layouts;
   for(const candidate of TERRAIN_TEXTURE_TIERS.filter(t=>t<=wanted).reverse()){
    const rows=descriptors.map(d=>terrainTextureLayout(d,candidate)),extra=new Map();for(const layout of rows)if(!records.has(layout.key))extra.set(layout.key,layout.bytes);
    if(usedBytes+[...extra.values()].reduce((a,b)=>a+b,0)<=budget){cap=candidate;layouts=rows;break;}
   }
   if(!layouts)throw Error('Terrain texture budget exhausted');
   const leases=[];
   for(let i=0;i<descriptors.length;i++){
    const descriptor=descriptors[i],layout=layouts[i];let record=records.get(layout.key);
    if(record)hits++;else{
     loads++;record={layout,refs:0,accounted:true,completed:0,total:descriptor.kind==='weights'?1:descriptor.entry.slices.length,listeners:new Set(),observationListeners:new Set(),failureListeners:new Set(),observations:new Map(),settled:false,controller:new AbortController()};records.set(layout.key,record);usedBytes+=layout.bytes;
     const publish=value=>{record.completed=Math.max(record.completed,Math.min(record.total,value));for(const listener of record.listeners)listener();};
     const observe=value=>{if(!value?.id||record.observations.has(value.id))return;record.observations.set(value.id,value);for(const listener of record.observationListeners)listener(value);};
     const fail=error=>{record.failure=error;for(const listener of record.failureListeners)listener(error);};
     record.promise=Promise.resolve().then(()=>{record.controller.signal.throwIfAborted();return load(descriptor,layout,publish,observe,record.controller.signal,fail);}).then(buffer=>{
      record.controller.signal.throwIfAborted();
      const channels=layout.format==='r8unorm'?1:4;if(buffer.byteLength!==layout.width*layout.height*layout.layers*channels)throw Error('Terrain texture size mismatch');
      const source=createSource({resource:new Uint8Array(buffer),width:layout.width,height:layout.height,arrayLayerCount:layout.layers,viewDimension:'2d-array',format:layout.format,alphaMode:'no-premultiply-alpha',autoGenerateMipmaps:true,scaleMode:'linear',mipmapFilter:'linear',addressMode:descriptor.kind==='weights'?'clamp-to-edge':'repeat',maxAnisotropy:16});record.source=source;publish(record.total);record.settled=true;record.observations.clear();if(!record.refs)free(record);return source;
     }).catch(error=>{record.settled=true;free(record);throw error;});
    }
    record.refs++;leases.push(record);
   }
   const notify=()=>{if(!signal?.aborted)try{onProgress?.({completed:leases.reduce((n,record)=>n+record.completed,0),total:leases.reduce((n,record)=>n+record.total,0),unit:'terrain textures'});}catch{}};
   if(onProgress){for(const record of leases)record.listeners.add(notify);notify();}
   const seen=new Set(),observe=value=>{if(signal?.aborted||seen.has(value.id))return;seen.add(value.id);try{onObservation?.(value);}catch{}};
   if(onObservation)for(const record of new Set(leases)){record.observationListeners.add(observe);if(!record.settled)for(const value of record.observations.values())observe(value);}
   let released=false,drain;const releaseAll=()=>{if(released)return drain;released=true;const retiring=[];for(const record of leases){const task=release(record);if(task)retiring.push(task);}if(retiring.length){drain=Promise.allSettled(retiring);try{onDrain?.(drain);}catch{/* Observation cannot interrupt ownership release. */}}return drain;};
   let onAbort,onFailure;
   try{
    const all=Promise.allSettled(leases.map(record=>record.promise));
    const failure=new Promise((_,reject)=>{onFailure=reject;for(const record of new Set(leases)){record.failureListeners.add(onFailure);if(record.failure)onFailure(record.failure);}});
    const abort=signal?new Promise((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();}):new Promise(()=>{});
    const completion=Promise.race([all,failure,abort]);
    const settled=await completion;signal?.throwIfAborted();const failed=settled.find(s=>s.status==='rejected');if(failed)throw failed.reason;return {cap,sources:settled.map(s=>s.value),layouts,release:releaseAll};
   }catch(error){releaseAll();throw error;}finally{if(onAbort)signal.removeEventListener('abort',onAbort);if(onFailure)for(const record of leases)record.failureListeners.delete(onFailure);if(onProgress)for(const record of leases)record.listeners.delete(notify);if(onObservation)for(const record of leases)record.observationListeners.delete(observe);}
  },
 };
}
