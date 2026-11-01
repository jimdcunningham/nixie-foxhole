import {retainFireStaticMaterials} from './fire-static.mjs';
import {retainContainedWaterMaterials} from "./contained-water.mjs";
import {attachCompactBundles} from './compact-bundles.mjs';
import {createWorldCacheLease} from './cache-retention.mjs';
import {createTransferLedger} from './terrain-network-observation.mjs';
import {restoreNativeFoliageMasks} from './native-foliage-masks.mjs';
import {restoreNativeSmallWaterMaterials} from './native-small-water.mjs';
import {createSourceLeasePool} from './source-leases.mjs';
import {decodeWorldImage} from './image-bitmap.mjs';
import {retainModelMaterialNames} from './model-material-names.mjs';
import {Texture,ImageSource,CubeTexture} from 'pixi.js';
import {glbToGltf,normalizeMeshopt,parseGltf} from '@pixi/3d';
import {cachedRecipe,writeCachedRoadAssembly,recipeKey,roadKey} from './recipe-cache.mjs';
import {fetchCompactResource,compactResourceCacheKey} from './compact-cache.mjs';
export async function createCompactProvider({baseUrl,entry,signal:externalSignal,onProgress=()=>{},scheduleModelTask=task=>task()}){
 const lifetime=new AbortController(),signal=externalSignal?AbortSignal.any([externalSignal,lifetime.signal]):lifetime.signal;
 performance.setResourceTimingBufferSize(30000);
 const externalAssets=new Set(),workerTimings=[];const start=performance.now(),base=new URL(baseUrl,location.href),metrics={downloadBytes:0,cacheHits:0,cacheMisses:0,cacheWriteFailures:0,decodeMs:0};
 const terrainLedger=createTransferLedger(),terrainTransfers={events:[],...terrainLedger.summary()};metrics.terrainTransfers=terrainTransfers;
 const observeTerrain=event=>{terrainLedger.add(event);terrainTransfers.events=terrainLedger.values();Object.assign(terrainTransfers,terrainLedger.summary());};
 const usage=createWorldCacheLease();
 let workerRead;const read=async(ref,{signal:consumerSignal}={})=>{signal.throwIfAborted();consumerSignal?.throwIfAborted();await usage.use('foxhole-world-compact-v1',compactResourceCacheKey(ref));signal.throwIfAborted();consumerSignal?.throwIfAborted();return workerRead?workerRead(ref,{signal:consumerSignal}):fetchCompactResource(base,ref,{signal:consumerSignal&&signal?AbortSignal.any([consumerSignal,signal]):consumerSignal||signal,metrics});};
 const stages={};let stageStart=performance.now(),stageName='manifest';
 async function measure(name,fn){const begin=performance.now();try{return await fn();}finally{const end=performance.now();stages[name]=end-begin;performance.measure('foxhole:'+entry.id+':'+name,{start:begin,end});}}
 function stage(name){const now=performance.now();stages[stageName]=(stages[stageName]||0)+now-stageStart;performance.measure('foxhole:'+entry.id+':'+stageName,{start:stageStart,end:now});stageName=name;stageStart=now;}

 let manifest;try{manifest=JSON.parse(new TextDecoder().decode(await read(entry.manifest)));
 if(manifest.version!==1||manifest.format!=='compact-recipes-v1'||manifest.region!==entry.id)throw Error('Unsupported compact region');
 if(manifest.bundles)attachCompactBundles(manifest);
 let reportedPercent=-1;
 await usage.use('foxhole-world-compact-v1',(manifest.physicalResources||entry.resources||[]).map(compactResourceCacheKey),{onProgress:({completed,total})=>{
  const percent=total?Math.floor(completed*100/total):100;
  if(!signal?.aborted&&percent!==reportedPercent){reportedPercent=percent;onProgress({phase:'Preparing region cache',progress:{completed,total,unit:'asset records'},...metrics});}
 }});}catch(error){usage.dispose();throw error;}
 const pending=new Map(),memo=new Map(),resolvedBinary=new Map(),textureUrls=new Set(),modelPromises=new Map(),texturePromises=new Map(),modelSources=new Set(),imageSources=new Set(),cubes=new Set(),modelImageUrls=new Set(),imagesByModel=new Map(),sourcesByModel=new Map();let serial=0,disposed=false,workersDisposed=true,fatal=null,readyWorkers=0,workers=[],readySet=new WeakSet(),startupTimer,workerGeneration=0,binaryEpoch=0;
 const destroyWorkers=()=>{if(workersDisposed)return;workersDisposed=true;workerGeneration++;clearTimeout(startupTimer);for(const worker of workers)worker.terminate();for(const p of pending.values())p.reject(new DOMException('Region disposed','AbortError'));pending.clear();};
 // Keep every owned asynchronous operation until its cleanup has completed,
 // including model/image entries removed from the reusable maps.
 const owned=new Set(),track=task=>{const promise=Promise.resolve(task);owned.add(promise);void promise.then(()=>owned.delete(promise),()=>owned.delete(promise));return promise;};
 let resolveDisposed,rejectDisposed;const disposedPromise=new Promise((resolve,reject)=>{resolveDisposed=resolve;rejectDisposed=reject;});
 const destroy=()=>{if(disposed)return;disposed=true;binaryEpoch++;resolvedBinary.clear();lifetime.abort();for(const record of reads.values())record.controller.abort();for(const job of pending.values())job.cancel?.();void (async()=>{while(owned.size)await Promise.allSettled([...owned]);destroyWorkers();usage.dispose();for(const cube of cubes)cube.destroy(true);for(const source of modelSources)if(!source.destroyed){source.textures.length=0;source.destroy();}for(const source of imageSources)if(!source.destroyed){source.resource?.close?.();source.destroy();}signal.removeEventListener('abort',destroy);})().then(resolveDisposed,rejectDisposed);};
 signal.addEventListener('abort',destroy,{once:true});
 function startWorkers(){
  if(disposed)throw new DOMException('Region disposed','AbortError');
  if(!workersDisposed)return;
  workersDisposed=false;fatal=null;readyWorkers=0;readySet=new WeakSet();const generation=++workerGeneration;
  const created=[];
  try{
   // Literal URLs let Vite discover and bundle each module worker.
   created.push(new Worker(new URL('../authoring/decode-worker.mjs',import.meta.url),{type:'module'}));
   created.push(new Worker(new URL('../authoring/geometry-recipe-worker.mjs',import.meta.url),{type:'module'}));
   created.push(new Worker(new URL('./resource-worker.mjs',import.meta.url),{type:'module'}));
  }
  catch(error){for(const worker of created)worker.terminate();workers=[];workersDisposed=true;workerGeneration++;throw error;}
  workers=created;
  // No physical job is sent before its own worker acknowledges startup. On a
  // startup failure, undispatched jobs have no writes to drain; dispatched jobs
  // in other workers still retain their acknowledgement barrier.
  const fail=error=>{if(workersDisposed||generation!==workerGeneration)return;fatal=error;clearTimeout(startupTimer);for(const [id,p] of pending){p.reject(error);if(!p.sent){pending.delete(id);p.complete();}}};
  startupTimer=setTimeout(()=>fail(Error('The region decoder workers did not start within 30 seconds.')),30000);
  for(const worker of workers){worker.onmessage=({data})=>{if(workersDisposed||generation!==workerGeneration)return;if(data.kind==='foxhole-worker-ready'){
   if(readySet.has(worker))return;readySet.add(worker);readyWorkers++;if(readyWorkers===workers.length)clearTimeout(startupTimer);
   if(!fatal)for(const p of pending.values())if(p.target===worker&&!p.sent)p.dispatch();return;
  }const p=pending.get(data.id);if(!p||p.target!==worker||!p.sent)return;if(data.kind==='terrain-observation'){if(!disposed&&!signal?.aborted)observeTerrain(data.observation);return;}if(data.kind==='geometry-progress'){if(!disposed&&!signal?.aborted)try{p.onProgress?.(data);}catch{}return;}pending.delete(data.id);metrics.decodeMs+=data.ms||0;workerTimings.push(...(data.timings||[]));for(const [key,value]of Object.entries(data.cacheMetrics||{}))metrics[key]=(metrics[key]||0)+value;data.error?p.reject(Error(data.error)):p.resolve(data.result);p.complete();};worker.onerror=e=>{if(workersDisposed||generation!==workerGeneration)return;const error=Error(e.message||'A region decoder worker failed to start.');console.error('Foxhole region worker failed',e.message,e.filename);fail(error);};}
 }
 const run=(worker,data,onWorkerProgress,jobSignal)=>{signal?.throwIfAborted();jobSignal?.throwIfAborted();if(fatal)throw fatal;if(workersDisposed)startWorkers();return track(new Promise((resolve,reject)=>{
  const id=++serial,target=workers[worker];let cancellationSent=false,completed;
  track(new Promise(resolve=>completed=resolve));
  const complete=()=>{jobSignal?.removeEventListener('abort',cancel);completed();};
  const job={resolve,reject,complete,target,sent:false,onProgress:onWorkerProgress};
  const cancel=()=>{if(!job.sent){if(pending.get(id)!==job)return;pending.delete(id);reject(jobSignal?.reason||signal.reason||new DOMException('Region disposed','AbortError'));complete();return;}if(cancellationSent||worker!==2||!data.ref)return;cancellationSent=true;try{target.postMessage({kind:'cancel-resource',id});}catch{}};
  job.cancel=cancel;job.dispatch=()=>{if(pending.get(id)!==job||job.sent)return;if(signal.aborted||jobSignal?.aborted){cancel();return;}job.sent=true;try{target.postMessage({...data,id});}catch(error){pending.delete(id);reject(error);complete();}};
  pending.set(id,job);jobSignal?.addEventListener('abort',cancel,{once:true});
  if(signal.aborted||jobSignal?.aborted){cancel();return;}if(readySet.has(target))job.dispatch();
 }));};
 // Per-layer callers may share a physical resource. Aborting one subscriber
 // must not cancel another; the last waits for the worker to drain its writes.
 const reads=new Map();workerRead=async(ref,{signal:consumerSignal}={})=>{
  consumerSignal?.throwIfAborted();let record=reads.get(ref.path);
  if(!record){
   record={waiters:0,settled:false,controller:new AbortController()};
   record.task=run(2,{baseUrl:base.href,ref},undefined,record.controller.signal).finally(()=>{record.settled=true;if(reads.get(ref.path)===record)reads.delete(ref.path);});
   reads.set(ref.path,record);
  }
  record.waiters++;let onAbort;
  try{
   const result=consumerSignal?new Promise((resolve,reject)=>{onAbort=()=>reject(consumerSignal.reason);consumerSignal.addEventListener('abort',onAbort,{once:true});if(consumerSignal.aborted)onAbort();record.task.then(resolve,reject);}):record.task;
   const bytes=await result;consumerSignal?.throwIfAborted();return bytes;
  }finally{
   if(onAbort)consumerSignal.removeEventListener('abort',onAbort);
   record.waiters--;
   if(!record.waiters&&!record.settled){if(reads.get(ref.path)===record)reads.delete(ref.path);record.controller.abort();await record.task.catch(()=>{});}
  }
 };
 const resource=id=>{const ref=manifest.resources[id];if(!ref)throw Error('Undeclared region resource '+id);return ref;};
 const json=(id,options={})=>track((async()=>{const bytes=await read(resource(id).resource,options);signal.throwIfAborted();options.signal?.throwIfAborted();return JSON.parse(new TextDecoder().decode(bytes));})());
 const plain=async(id,zipped=false,options={})=>{
  options.signal?.throwIfAborted();const e=resource(id);if(e.codec==='rgba-image-array')return run(0,{kind:'array',entry:e,baseUrl:base.href,sliceUrls:e.slices.map(s=>new URL(s.resource.path,base).href)});
  const bytes=await read(e.resource,options);options.signal?.throwIfAborted();
  if(['xyz-planar-brotli','meshopt-glb-brotli','word-planar-brotli','meshopt-road-brotli'].includes(e.codec))return run(0,{kind:'binary',codec:e.codec,entry:e,bytes});
  if(zipped&&e.codec!=='decoded-gzip-brotli')return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return bytes;
 };
 const once=(id,fn)=>{if(!memo.has(id))memo.set(id,fn());return memo.get(id);};
 const part=(group,name,type='bytes')=>read(manifest.recipes[group].parts[name]).then(bytes=>type==='json'?JSON.parse(new TextDecoder().decode(bytes)):bytes);
 function absolute(value){if(typeof value==='string'&&value.startsWith('content/'))return new URL(value,base).href;if(Array.isArray(value))return value.map(absolute);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,absolute(v)]));return value;}
 const recipe=async(hash,build)=>{await usage.use('foxhole-world-recipes-v1',recipeKey(base,hash));return await run(2,{kind:'recipe-read',baseUrl:base.href,hash})||cachedRecipe(base,hash,build,{signal,metrics});};
 const binary=(id,options={})=>{
  signal.throwIfAborted();options.signal?.throwIfAborted();if(resolvedBinary.has(id))return Promise.resolve(resolvedBinary.get(id));
  const epoch=binaryEpoch,task=id.endsWith('/terrain-lod1.glb')?once(id,()=>recipe(manifest.recipes.terrain.sha256,async()=>run(1,{kind:'terrain',meta:await json(entry.id+'/terrain.json'),source:await binary(entry.id+'/terrain.bin'),hash:manifest.recipes.terrain.sha256}))):options.signal?plain(id,false,options):once(id,()=>plain(id));
  // Only successful results are reusable. Never memoize a subscriber's abort,
  // and do not repopulate the memo after finish or disposal invalidates it.
  return track(task.then(bytes=>{signal.throwIfAborted();options.signal?.throwIfAborted();if(epoch===binaryEpoch)resolvedBinary.set(id,bytes);return bytes;}));
 };
 const zipped=id=>{signal.throwIfAborted();return track(once(id,async()=>{
  const alias=manifest.resources[id]?.recipeOf;if(alias&&alias!==id)return zipped(alias);
  const r=entry.id;
  if(id.endsWith('/roads/render-vertices.bin.gz'))return recipe(manifest.recipes.roads.report.renderHash,async()=>{
   const [recipe,sourceMeta,meta,indices,values]=await Promise.all([part('roads','recipe','json'),part('roads','metadata','json'),json(r+'/roads/render.json'),zipped(r+'/roads/render-indices.bin.gz'),Promise.all(['bindings','exceptions','source-correction','normal-correction'].map(async key=>[key,await part('roads',key)]))]);
   return run(1,{kind:'roads',recipe,sourceMeta,meta,indices,parts:Object.fromEntries(values),hash:manifest.recipes.roads.report.renderHash});
  });
  if(id.endsWith('/world-fixes/details/vertices.bin.gz'))return recipe(manifest.recipes.decals.report.renderHash,async()=>{
   const [recipe,polygons,bindings,exceptions,terrainMeta,source]=await Promise.all([part('decals','recipe','json'),part('decals','polygons'),part('decals','bindings'),part('decals','exceptions'),json(r+'/terrain.json'),binary(r+'/terrain.bin')]),report=manifest.recipes.decals.report;
   return run(1,{kind:'decals',recipe:absolute(recipe),polygons,bindings,exceptions,terrainMeta,source,vertices:report.vertices,polygonsCount:report.polygons,polygonCodec:report.polygonCodec,hash:report.renderHash,canonical:false,baseUrl:base.href,resources:manifest.physicalResources||entry.resources,reportGeometryProgress:true},event=>{
    if(event.stage==='assembly'){onProgress({phase:'Assembling surface geometry',...metrics});return;}
    if(event.stage==='assets'&&Number.isSafeInteger(event.completed)&&Number.isSafeInteger(event.total)&&event.total>0&&event.completed>=0&&event.completed<=event.total)onProgress({phase:'Preparing surface geometry',...metrics,progress:{completed:event.completed,total:event.total,unit:'surface geometry assets'}});
   });
  });
  return plain(id,true);
 }));};
 const refs=new Map((manifest.physicalResources||entry.resources).map(ref=>[new URL(ref.path,base).href,ref]));
 function refFor(url){const ref=refs.get(new URL(url,base).href);if(!ref)throw Error('Undeclared model dependency '+url);return ref;}
 async function image(url,embedded){signal.throwIfAborted();if(!texturePromises.has(url))texturePromises.set(url,track((async()=>{signal?.throwIfAborted();const bytes=embedded||await read(refFor(url)),bitmap=await decodeWorldImage(bytes),source=new ImageSource({resource:bitmap,alphaMode:'premultiply-alpha-on-upload',autoGenerateMipmaps:true});imageSources.add(source);source.style.maxAnisotropy=8;return new Texture({source});})()));return texturePromises.get(url);}
 // Keep a small amount of I/O ahead of expensive source decoding. Holding
 // this permit through decoding also bounds prepared buffers waiting in the
 // shared host queue; no region-wide eager download or decode fan-out.
 let preparingModels=0;const waitingModels=[];
 async function prepareModel(prepare,build){
  if(preparingModels<8)preparingModels++;else await new Promise(resolve=>waitingModels.push(resolve));
  try{signal.throwIfAborted();const prepared=await prepare();signal.throwIfAborted();return await scheduleModelTask(()=>{signal.throwIfAborted();return build(prepared);});}
  finally{const next=waitingModels.shift();if(next)next();else preparingModels--;}
 }
 // Texture reads/bitmap decoding retain the source permit, but only meshopt and
 // glTF parsing occupy the shared host CPU queue.
 async function model(url){signal.throwIfAborted();url=new URL(url,base).href;if(!modelPromises.has(url))modelPromises.set(url,track(prepareModel(async()=>{const bytes=await read(refFor(url));let doc,buffers;if(url.endsWith('.glb')){({json:doc,buffers}=glbToGltf(bytes));while(buffers.length<(doc.buffers?.length||0))buffers.push(new ArrayBuffer(0));}else{doc=JSON.parse(new TextDecoder().decode(bytes));buffers=await Promise.all((doc.buffers||[]).map(buffer=>buffer.uri?read(refFor(new URL(buffer.uri,url).href)):new ArrayBuffer(buffer.byteLength||0)));}restoreNativeSmallWaterMaterials(doc);for(const ref of restoreNativeFoliageMasks(doc,base.href))refs.set(new URL(ref.path,base).href,ref);await scheduleModelTask(()=>normalizeMeshopt(doc,buffers));const imageUrls=new Set();imagesByModel.set(url,imageUrls);const decodedImages=await Promise.allSettled((doc.images||[]).map(async(row,i)=>{if(row.uri){const key=new URL(row.uri,url).href;modelImageUrls.add(key);imageUrls.add(key);return image(key);}const view=doc.bufferViews[row.bufferView],embedded=buffers[view.buffer].slice(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);const digest=await crypto.subtle.digest('SHA-256',embedded),key='embedded-sha256:'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')+JSON.stringify((doc.textures||[]).filter(t=>t.source===i).map(t=>doc.samplers?.[t.sampler]||null));signal.throwIfAborted();modelImageUrls.add(key);imageUrls.add(key);return image(key,embedded);}));const failedImage=decodedImages.find(r=>r.status==='rejected');if(failedImage)throw failedImage.reason;const textures=decodedImages.map(r=>r.value);return {doc,buffers,textures};},async({doc,buffers,textures})=>{const source=retainFireStaticMaterials(retainContainedWaterMaterials(retainModelMaterialNames(await parseGltf(doc,buffers,textures),doc),doc),doc);modelSources.add(source);sourcesByModel.set(url,source);signal?.throwIfAborted();return source;}).catch(error=>{retireModel(url);throw error;})));return modelPromises.get(url);}
 async function loadEnvironment(){const id='sky-source/NoonSky.cubemap',url=new URL(resource(id).resource.path,base),doc=await json(id),faces=Object.fromEntries(await Promise.all(['right','left','top','bottom','front','back'].map(async key=>[key,await image((textureUrls.add(new URL(doc[key],url).href),new URL(doc[key],url).href))])));const cube=CubeTexture.from({faces,label:'Foxhole Noon Sky'});cubes.add(cube);return cube;}
 const environment=()=>track(loadEnvironment());
 const sourceLeases=createSourceLeasePool();
 function retireModel(url){
  const source=sourcesByModel.get(url),images=imagesByModel.get(url)||new Set();
  modelPromises.delete(url);sourcesByModel.delete(url);imagesByModel.delete(url);
  if(source){modelSources.delete(source);if(!source.destroyed){source.textures.length=0;source.destroy();}}
  const liveImages=new Set([...imagesByModel.values()].flatMap(images=>[...images]));
  for(const key of images){if(textureUrls.has(key)||liveImages.has(key))continue;const pending=texturePromises.get(key);texturePromises.delete(key);modelImageUrls.delete(key);if(pending)track(pending.then(texture=>{const source=texture.source;imageSources.delete(source);if(source&&!source.destroyed){source.resource?.close?.();texture.destroy(true);}}).catch(()=>{}));}
 }
 const createModelLease=()=>sourceLeases.lease({load:model,unload:retireModel});
 function releaseModels(){
  // Called only after model tasks and their owners have drained. Detach cache
  // entries synchronously so a later load cannot inherit a retiring source.
  modelPromises.clear();for(const source of modelSources)if(!source.destroyed){source.textures.length=0;source.destroy();}modelSources.clear();
  for(const url of modelImageUrls){if(textureUrls.has(url))continue;const pending=texturePromises.get(url);texturePromises.delete(url);if(pending)track(pending.then(texture=>{const source=texture.source;imageSources.delete(source);if(source&&!source.destroyed){source.resource?.close?.();texture.destroy(true);}}).catch(()=>{}));}modelImageUrls.clear();
 }
 if(signal.aborted)destroy();
 return {createModelLease,releaseModels,observeTerrain,terrainDescriptor:(id,kind,dimensions={})=>({baseUrl:base.href,entry:resource(id),kind,...dimensions}),trackExternalAsset:url=>externalAssets.add(new URL(url,base).href),readRoadAssembly:()=>track((async()=>{signal.throwIfAborted();await usage.use('foxhole-world-recipes-v1',roadKey(base,entry.manifest.hash));signal.throwIfAborted();return run(2,{kind:'road-assembly-read',baseUrl:base.href,hash:entry.manifest.hash});})()),writeRoadAssembly:bytes=>{signal.throwIfAborted();return track(writeCachedRoadAssembly(base,entry.manifest.hash,bytes,{metrics}));},json,binary,zipped,metrics,model,environment,stage,measure,url:id=>new URL(resource(id).resource.path,base).href,texture:(id,repeat=false)=>track((async()=>{signal.throwIfAborted();const url=new URL(resource(id).resource.path,base).href;textureUrls.add(url);const t=await image(url);if(repeat)t.source.style.addressMode='repeat';return t;})()),report:(phase,progress)=>onProgress({phase,...metrics,...(progress?{progress}:{})}),finish(){stage('ready');metrics.stages=stages;metrics.readyMs=performance.now()-start;metrics.preparedFetchBytes=metrics.downloadBytes;const entries=[...performance.getEntriesByType('resource').filter(e=>e.startTime>=start&&(e.name.startsWith(base.href)||externalAssets.has(e.name))),...workerTimings.filter(e=>e.name.startsWith(base.href))];const unique=[...new Map(entries.map(e=>[[e.name,e.startTime,e.duration].join('|'),e])).values()];metrics.downloadBytes=unique.filter(e=>e.transferSize>0).reduce((sum,e)=>sum+e.encodedBodySize,0);metrics.requestedEncodedBytes=unique.reduce((sum,e)=>sum+e.encodedBodySize,0);metrics.httpCacheResponses=unique.filter(e=>e.transferSize===0&&e.encodedBodySize>0).length;binaryEpoch++;resolvedBinary.clear();memo.clear();if(!pending.size)destroyWorkers();return metrics;},destroy,whenDisposed:()=>disposedPromise,textureUrls};
}
