import {restoreNativeFoliageMasks} from './native-foliage-masks.mjs';
import {restoreNativeSmallWaterMaterials} from './native-small-water.mjs';
import {createSourceLeasePool} from './source-leases.mjs';
import {decodeWorldImage} from './image-bitmap.mjs';
import {retainModelMaterialNames} from './model-material-names.mjs';
import {Texture,ImageSource,CubeTexture} from 'pixi.js';
import {glbToGltf,normalizeMeshopt,parseGltf} from '@pixi/3d';
import {cachedRecipe,writeCachedRoadAssembly} from './recipe-cache.mjs';
import {fetchCompactResource} from './compact-cache.mjs';
export async function createCompactProvider({baseUrl,entry,signal,onProgress=()=>{},scheduleModelTask=task=>task()}){
 performance.setResourceTimingBufferSize(30000);
 const externalAssets=new Set(),workerTimings=[];const start=performance.now(),base=new URL(baseUrl,location.href),metrics={downloadBytes:0,cacheHits:0,cacheMisses:0,cacheWriteFailures:0,decodeMs:0};
 let workerRead;const read=ref=>workerRead?workerRead(ref):fetchCompactResource(base,ref,{signal,metrics});
 const stages={};let stageStart=performance.now(),stageName='manifest';
 async function measure(name,fn){const begin=performance.now();try{return await fn();}finally{const end=performance.now();stages[name]=end-begin;performance.measure('foxhole:'+entry.id+':'+name,{start:begin,end});}}
 function stage(name){const now=performance.now();stages[stageName]=(stages[stageName]||0)+now-stageStart;performance.measure('foxhole:'+entry.id+':'+stageName,{start:stageStart,end:now});stageName=name;stageStart=now;}

 const manifest=JSON.parse(new TextDecoder().decode(await read(entry.manifest)));
 if(manifest.version!==1||manifest.format!=='compact-recipes-v1'||manifest.region!==entry.id)throw Error('Unsupported compact region');
 const pending=new Map(),memo=new Map(),textureUrls=new Set(),modelPromises=new Map(),texturePromises=new Map(),modelSources=new Set(),imageSources=new Set(),cubes=new Set(),modelImageUrls=new Set(),imagesByModel=new Map(),sourcesByModel=new Map();let serial=0,disposed=false,workersDisposed=true,fatal=null,readyWorkers=0,workers=[],startupTimer;
 const destroyWorkers=()=>{if(workersDisposed)return;workersDisposed=true;clearTimeout(startupTimer);for(const worker of workers)worker.terminate();for(const p of pending.values())p.reject(new DOMException('Region disposed','AbortError'));pending.clear();};
 const destroy=()=>{if(disposed)return;disposed=true;destroyWorkers();void Promise.allSettled([...modelPromises.values(),...texturePromises.values()]).then(()=>{for(const cube of cubes)cube.destroy(true);for(const source of modelSources)source.destroy();for(const source of imageSources){source.resource?.close?.();source.destroy();}});};
 signal?.addEventListener('abort',destroy,{once:true});
 function startWorkers(){
  if(disposed)throw new DOMException('Region disposed','AbortError');
  if(!workersDisposed)return;
  workersDisposed=false;fatal=null;readyWorkers=0;
  workers=[new Worker(new URL('../authoring/decode-worker.mjs',import.meta.url),{type:'module'}),new Worker(new URL('../authoring/geometry-recipe-worker.mjs',import.meta.url),{type:'module'}),new Worker(new URL('./resource-worker.mjs',import.meta.url),{type:'module'})];
 startupTimer=setTimeout(()=>{fatal=Error('The region decoder workers did not start within 30 seconds.');for(const p of pending.values())p.reject(fatal);pending.clear();},30000);
 for(const worker of workers){worker.onmessage=({data})=>{if(data.kind==='foxhole-worker-ready'){readyWorkers++;if(readyWorkers===workers.length)clearTimeout(startupTimer);return;}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);metrics.decodeMs+=data.ms||0;workerTimings.push(...(data.timings||[]));for(const [key,value]of Object.entries(data.cacheMetrics||{}))metrics[key]=(metrics[key]||0)+value;data.error?p.reject(Error(data.error)):p.resolve(data.result);};worker.onerror=e=>{fatal=Error(e.message||'A region decoder worker failed to start.');console.error('Foxhole region worker failed',e.message,e.filename);for(const p of pending.values())p.reject(fatal);pending.clear();};}
 }
 const run=(worker,data)=>{signal?.throwIfAborted();if(fatal)throw fatal;if(workersDisposed)startWorkers();return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});workers[worker].postMessage({...data,id});});};
 const reads=new Map();workerRead=ref=>{if(!reads.has(ref.path)){const task=run(2,{baseUrl:base.href,ref}).finally(()=>reads.delete(ref.path));reads.set(ref.path,task);}return reads.get(ref.path);};
 const resource=id=>{const ref=manifest.resources[id];if(!ref)throw Error('Undeclared region resource '+id);return ref;};
 const json=async id=>JSON.parse(new TextDecoder().decode(await read(resource(id).resource)));
 const plain=async(id,zipped=false)=>{
  const e=resource(id);if(e.codec==='rgba-image-array')return run(0,{kind:'array',entry:e,baseUrl:base.href,sliceUrls:e.slices.map(s=>new URL(s.resource.path,base).href)});
  const bytes=await read(e.resource);
  if(['xyz-planar-brotli','meshopt-glb-brotli','word-planar-brotli','meshopt-road-brotli'].includes(e.codec))return run(0,{kind:'binary',codec:e.codec,entry:e,bytes});
  if(zipped&&e.codec!=='decoded-gzip-brotli')return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return bytes;
 };
 const once=(id,fn)=>{if(!memo.has(id))memo.set(id,fn());return memo.get(id);};
 const part=(group,name,type='bytes')=>read(manifest.recipes[group].parts[name]).then(bytes=>type==='json'?JSON.parse(new TextDecoder().decode(bytes)):bytes);
 function absolute(value){if(typeof value==='string'&&value.startsWith('content/'))return new URL(value,base).href;if(Array.isArray(value))return value.map(absolute);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,absolute(v)]));return value;}
 const recipe=async(hash,build)=>await run(2,{kind:'recipe-read',baseUrl:base.href,hash})||cachedRecipe(base,hash,build,{signal,metrics});
 const binary=id=>id.endsWith('/terrain-lod1.glb')?once(id,()=>recipe(manifest.recipes.terrain.sha256,async()=>run(1,{kind:'terrain',meta:await json(entry.id+'/terrain.json'),source:await binary(entry.id+'/terrain.bin'),hash:manifest.recipes.terrain.sha256}))):once(id,()=>plain(id));
 const zipped=id=>once(id,async()=>{
  const alias=manifest.resources[id]?.recipeOf;if(alias&&alias!==id)return zipped(alias);
  const r=entry.id;
  if(id.endsWith('/roads/render-vertices.bin.gz'))return recipe(manifest.recipes.roads.report.renderHash,async()=>{
   const [recipe,sourceMeta,meta,indices,values]=await Promise.all([part('roads','recipe','json'),part('roads','metadata','json'),json(r+'/roads/render.json'),zipped(r+'/roads/render-indices.bin.gz'),Promise.all(['bindings','exceptions','source-correction','normal-correction'].map(async key=>[key,await part('roads',key)]))]);
   return run(1,{kind:'roads',recipe,sourceMeta,meta,indices,parts:Object.fromEntries(values),hash:manifest.recipes.roads.report.renderHash});
  });
  if(id.endsWith('/world-fixes/details/vertices.bin.gz'))return recipe(manifest.recipes.decals.report.renderHash,async()=>{
   const [recipe,polygons,bindings,exceptions,terrainMeta,source]=await Promise.all([part('decals','recipe','json'),part('decals','polygons'),part('decals','bindings'),part('decals','exceptions'),json(r+'/terrain.json'),binary(r+'/terrain.bin')]),report=manifest.recipes.decals.report;
   return run(1,{kind:'decals',recipe:absolute(recipe),polygons,bindings,exceptions,terrainMeta,source,vertices:report.vertices,polygonsCount:report.polygons,polygonCodec:report.polygonCodec,hash:report.renderHash,canonical:false,baseUrl:base.href,resources:manifest.physicalResources||entry.resources});
  });
  return plain(id,true);
 });
 const refs=new Map((manifest.physicalResources||entry.resources).map(ref=>[new URL(ref.path,base).href,ref]));
 function refFor(url){const ref=refs.get(new URL(url,base).href);if(!ref)throw Error('Undeclared model dependency '+url);return ref;}
 async function image(url,embedded){if(!texturePromises.has(url))texturePromises.set(url,(async()=>{signal?.throwIfAborted();const bytes=embedded||await read(refFor(url)),bitmap=await decodeWorldImage(bytes),source=new ImageSource({resource:bitmap,alphaMode:'premultiply-alpha-on-upload',autoGenerateMipmaps:true});imageSources.add(source);source.style.maxAnisotropy=8;return new Texture({source});})());return texturePromises.get(url);}
 async function model(url){url=new URL(url,base).href;if(!modelPromises.has(url))modelPromises.set(url,scheduleModelTask(async()=>{const bytes=await read(refFor(url));let doc,buffers;if(url.endsWith('.glb')){({json:doc,buffers}=glbToGltf(bytes));while(buffers.length<(doc.buffers?.length||0))buffers.push(new ArrayBuffer(0));}else{doc=JSON.parse(new TextDecoder().decode(bytes));buffers=await Promise.all((doc.buffers||[]).map(buffer=>buffer.uri?read(refFor(new URL(buffer.uri,url).href)):new ArrayBuffer(buffer.byteLength||0)));}restoreNativeSmallWaterMaterials(doc);for(const ref of restoreNativeFoliageMasks(doc,base.href))refs.set(new URL(ref.path,base).href,ref);await normalizeMeshopt(doc,buffers);const imageUrls=new Set();imagesByModel.set(url,imageUrls);const textures=await Promise.all((doc.images||[]).map((row,i)=>{if(row.uri){const key=new URL(row.uri,url).href;modelImageUrls.add(key);imageUrls.add(key);return image(key);}modelImageUrls.add(url+'#image'+i);imageUrls.add(url+'#image'+i);const view=doc.bufferViews[row.bufferView];return image(url+'#image'+i,buffers[view.buffer].slice(view.byteOffset||0,(view.byteOffset||0)+view.byteLength));}));const source=retainModelMaterialNames(await parseGltf(doc,buffers,textures),doc);modelSources.add(source);sourcesByModel.set(url,source);signal?.throwIfAborted();return source;}).catch(error=>{retireModel(url);throw error;}));return modelPromises.get(url);}
 async function environment(){const id='sky-source/NoonSky.cubemap',url=new URL(resource(id).resource.path,base),doc=await json(id),faces=Object.fromEntries(await Promise.all(['right','left','top','bottom','front','back'].map(async key=>[key,await image((textureUrls.add(new URL(doc[key],url).href),new URL(doc[key],url).href))])));const cube=CubeTexture.from({faces,label:'Foxhole Noon Sky'});cubes.add(cube);return cube;}
 const sourceLeases=createSourceLeasePool();
 function retireModel(url){
  const source=sourcesByModel.get(url),images=imagesByModel.get(url)||new Set();
  modelPromises.delete(url);sourcesByModel.delete(url);imagesByModel.delete(url);
  if(source){modelSources.delete(source);if(!source.destroyed){source.textures.length=0;source.destroy();}}
  const liveImages=new Set([...imagesByModel.values()].flatMap(images=>[...images]));
  for(const key of images){if(textureUrls.has(key)||liveImages.has(key))continue;const pending=texturePromises.get(key);texturePromises.delete(key);modelImageUrls.delete(key);void pending?.then(texture=>{const source=texture.source;imageSources.delete(source);if(source&&!source.destroyed){source.resource?.close?.();texture.destroy(true);}}).catch(()=>{});}
 }
 const createModelLease=()=>sourceLeases.lease({load:model,unload:retireModel});
 function releaseModels(){
  // Called only after model tasks and their owners have drained. Detach cache
  // entries synchronously so a later load cannot inherit a retiring source.
  modelPromises.clear();for(const source of modelSources)if(!source.destroyed){source.textures.length=0;source.destroy();}modelSources.clear();
  for(const url of modelImageUrls){if(textureUrls.has(url))continue;const pending=texturePromises.get(url);texturePromises.delete(url);void pending?.then(texture=>{const source=texture.source;imageSources.delete(source);if(source&&!source.destroyed){source.resource?.close?.();texture.destroy(true);}}).catch(()=>{});}modelImageUrls.clear();
 }
 return {createModelLease,releaseModels,terrainDescriptor:(id,kind,dimensions={})=>({baseUrl:base.href,entry:resource(id),kind,...dimensions}),trackExternalAsset:url=>externalAssets.add(new URL(url,base).href),readRoadAssembly:()=>run(2,{kind:'road-assembly-read',baseUrl:base.href,hash:entry.manifest.hash}),writeRoadAssembly:bytes=>writeCachedRoadAssembly(base,entry.manifest.hash,bytes,{metrics}),json,binary,zipped,metrics,model,environment,stage,measure,url:id=>new URL(resource(id).resource.path,base).href,texture:async(id,repeat=false)=>{const url=new URL(resource(id).resource.path,base).href;textureUrls.add(url);const t=await image(url);if(repeat)t.source.style.addressMode='repeat';return t;},report:phase=>onProgress({phase,...metrics}),finish(){stage('ready');metrics.stages=stages;metrics.readyMs=performance.now()-start;metrics.preparedFetchBytes=metrics.downloadBytes;const entries=[...performance.getEntriesByType('resource').filter(e=>e.startTime>=start&&(e.name.startsWith(base.href)||externalAssets.has(e.name))),...workerTimings.filter(e=>e.name.startsWith(base.href))];const unique=[...new Map(entries.map(e=>[[e.name,e.startTime,e.duration].join('|'),e])).values()];metrics.downloadBytes=unique.filter(e=>e.transferSize>0).reduce((sum,e)=>sum+e.encodedBodySize,0);metrics.requestedEncodedBytes=unique.reduce((sum,e)=>sum+e.encodedBodySize,0);metrics.httpCacheResponses=unique.filter(e=>e.transferSize===0&&e.encodedBodySize>0).length;memo.clear();if(!pending.size)destroyWorkers();return metrics;},destroy,textureUrls};
}
