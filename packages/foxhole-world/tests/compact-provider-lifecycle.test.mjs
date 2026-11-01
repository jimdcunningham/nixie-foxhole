import {retainFireStaticMaterials} from '../runtime/fire-static.mjs';
import {retainContainedWaterMaterials} from "../runtime/contained-water.mjs";
import {createWorldCacheLease} from '../runtime/cache-retention.mjs';
import {createTransferLedger} from '../runtime/terrain-network-observation.mjs';
import {compactResourceCacheKey} from '../runtime/compact-cache.mjs';
import {recipeKey,roadKey} from '../runtime/recipe-cache.mjs';
import {restoreNativeFoliageMasks} from '../runtime/native-foliage-masks.mjs';
import {restoreNativeSmallWaterMaterials} from '../runtime/native-small-water.mjs';
import {createSourceLeasePool} from '../runtime/source-leases.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../runtime/compact-provider.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(import.meta.url)).replace('export async function','async function')+'\ncreateCompactProvider;';
test('idle providers stop decoder workers and restart them for a later requested layer',async()=>{
 const workers=[],manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{'fixture/first.json':{resource:{path:'first'}},'fixture/next.json':{resource:{path:'next'}}},recipes:{},physicalResources:[]};
 class Worker {constructor(){workers.push(this);queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(message){queueMicrotask(()=>this.onmessage({data:{id:message.id,result:new TextEncoder().encode(JSON.stringify({file:message.ref.path})).buffer}}));}terminate(){this.stopped=true;}}
 const create=runInNewContext(source,{retainFireStaticMaterials,retainContainedWaterMaterials,createTransferLedger,createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}});
 assert.equal(workers.length,0,'no decoder is started until it is needed');assert.equal((await provider.json('fixture/first.json')).file,'first');assert.equal(workers.length,3);
 provider.finish();assert.ok(workers.every(w=>w.stopped));assert.equal((await provider.json('fixture/next.json')).file,'next');assert.equal(workers.length,6);assert.ok(workers.slice(3).every(w=>!w.stopped));
 provider.finish();assert.ok(workers.every(w=>w.stopped));provider.destroy();await assert.rejects(provider.json('fixture/next.json'),{name:'AbortError'});
});

test('native model leases share sources and release the final cell without retiring the region',async()=>{
 let decoded=0,destroyed=0;const manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{},recipes:{},physicalResources:[{path:'native.gltf'}]};
 class Worker {constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(message){queueMicrotask(()=>this.onmessage({data:{id:message.id,result:new TextEncoder().encode('{}').buffer}}));}terminate(){}}
 const create=runInNewContext(source,{retainFireStaticMaterials,retainContainedWaterMaterials,createTransferLedger,createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,
  normalizeMeshopt:async()=>{},retainModelMaterialNames:s=>s,parseGltf:async()=>{decoded++;return{textures:[],destroyed:false,destroy(){if(!this.destroyed){this.destroyed=true;destroyed++;}}};},fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}}),a=provider.createModelLease(),b=provider.createModelLease(),url='https://fixture.test/world/native.gltf';
 const first=await a.get(url);assert.equal(await b.get(url),first);assert.equal(decoded,1);a.release();await new Promise(r=>setTimeout(r,0));assert.equal(destroyed,0);b.release();await new Promise(r=>setTimeout(r,0));assert.equal(destroyed,1);
 const c=provider.createModelLease();assert.notEqual(await c.get(url),first);assert.equal(decoded,2);c.release();await new Promise(r=>setTimeout(r,0));provider.destroy();
});


test('the actual compact model loader restores native well water tint and opacity before parsing',async()=>{
 const material={name:'SmallPuddle',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],roughnessFactor:.1,metallicFactor:0},alphaMode:'BLEND',normalTexture:{index:0,scale:1},extras:{foxholeMaterialSource:'War/Content/Materials/SmallPuddle.uasset'}};
 const doc={asset:{version:'2.0'},materials:[material,{...structuredClone(material),extras:{foxholeMaterialSource:'Other/SmallPuddle.uasset'}}]};
 const manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{},recipes:{},physicalResources:[{path:'well.gltf'}]};
 let parsed;
 class Worker {constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(message){queueMicrotask(()=>this.onmessage({data:{id:message.id,result:new TextEncoder().encode(JSON.stringify(doc)).buffer}}));}terminate(){}}
 const create=runInNewContext(source,{retainFireStaticMaterials,retainContainedWaterMaterials,createTransferLedger,createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,
  normalizeMeshopt:async()=>{},retainModelMaterialNames:s=>s,parseGltf:async document=>{parsed=document;return{textures:[],destroy(){}};},fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}});
 try{
  await provider.model('https://fixture.test/world/well.gltf');
  assert.deepEqual(Array.from(parsed.materials[0].pbrMetallicRoughness.baseColorFactor),[.02,.016119,.011275,.945872]);
  assert.equal(parsed.materials[0].normalTexture.scale,.688991);
  assert.equal(parsed.materials[0].extensions.KHR_materials_specular.specularFactor,.6);
  assert.deepEqual(Array.from(parsed.materials[1].pbrMetallicRoughness.baseColorFactor),[1,1,1,1],'same-basename unrelated materials stay intact');
  assert.deepEqual(material.pbrMetallicRoughness.baseColorFactor,[1,1,1,1],'source files stay intact');
 }finally{provider.destroy();}
});

test('the compact provider declares and shares the native bush cutout before decoding legacy models',async()=>{
 const descriptor=(await import('../authoring/native-foliage-masks.json',{with:{type:'json'}})).default.materials[0],seen=[];let parsed,destroyedImages=0;
 const doc={materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}},extras:{foxholeMaterialSource:descriptor.material,foxholeAlbedoSource:descriptor.albedo}}],textures:[{source:0}],images:[{uri:'rgb.png'}]};
 const manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{},recipes:{},physicalResources:[{path:'bush.gltf'},{path:'rgb.png'}]};
 class Worker{constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(message){seen.push(message.ref.path);queueMicrotask(()=>this.onmessage({data:{id:message.id,result:message.ref.path==='bush.gltf'?new TextEncoder().encode(JSON.stringify(doc)).buffer:new Uint8Array([1,2,3]).buffer}}));}terminate(){}}
 class ImageSource{constructor(options){Object.assign(this,options);this.style={};}destroy(){this.destroyed=true;destroyedImages++;}}
 class Texture{constructor(options){Object.assign(this,options);}destroy(){this.source.destroy();}}
 const create=runInNewContext(source,{retainFireStaticMaterials,retainContainedWaterMaterials,createTransferLedger,createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,ImageSource,Texture,decodeWorldImage:async()=>({close(){}}),normalizeMeshopt:async()=>{},retainModelMaterialNames:s=>s,parseGltf:async document=>{parsed=document;return{textures:[],destroy(){}};},fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}}),a=provider.createModelLease(),b=provider.createModelLease();
 try{const model=await a.get('https://fixture.test/world/bush.gltf');assert.equal(await b.get('https://fixture.test/world/bush.gltf'),model);assert.equal(parsed.materials[0].alphaMode,'MASK');assert.equal(parsed.materials[0].alphaCutoff,.333);assert.equal(seen.filter(p=>p===descriptor.resource.path).length,1);a.release();await new Promise(r=>setTimeout(r,0));assert.equal(destroyedImages,0);b.release();await new Promise(r=>setTimeout(r,0));assert.equal(destroyedImages,2,'both original and restored textures follow the model lease');}finally{provider.destroy();}
});


function geometryProgressFixture({cached=false}={}){
 const events=[],workers=[],hash='a'.repeat(64),ref=path=>({path});let start;
 const started=new Promise(resolve=>start=resolve);
 const manifest={version:1,format:'compact-recipes-v1',region:'fixture',physicalResources:[],resources:{
  'fixture/terrain.json':{resource:ref('terrain.json')},'fixture/terrain.bin':{resource:ref('terrain.bin')},
 },recipes:{decals:{report:{renderHash:hash,vertices:0,polygons:0,polygonCodec:'word-planar'},parts:{recipe:ref('recipe.json'),polygons:ref('polygons'),bindings:ref('bindings'),exceptions:ref('exceptions')}}}};
 class Worker{
  constructor(){this.index=workers.length;workers.push(this);queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}
  postMessage(message){
   if(this.index===1){this.job=message;start();return;}
   const result=message.kind==='recipe-read'?(cached?new Uint8Array([7]).buffer:null):new TextEncoder().encode(message.ref?.path==='recipe.json'?'{}':message.ref?.path==='terrain.json'?'{}':'').buffer;
   queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result}}));
  }
  emit(message){this.onmessage?.({data:{id:this.job.id,...message}});}
  terminate(){this.stopped=true;}
 }
 const create=runInNewContext(source,{retainFireStaticMaterials,retainContainedWaterMaterials,createTransferLedger,createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,AbortSignal,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,Number,console,
  cachedRecipe:async(_base,_hash,build,{signal}={})=>{const bytes=await build();signal?.throwIfAborted();return bytes;},fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const controller=new AbortController();
 const createProvider=()=>create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}},signal:controller.signal,onProgress:event=>events.push(event)});
 return {events,workers,started,createProvider,controller};
}
test('surface geometry progress is forwarded without settling the worker request',async()=>{
 const f=geometryProgressFixture(),provider=await f.createProvider();let settled=false;
 try{
  const result=provider.zipped('fixture/world-fixes/details/vertices.bin.gz');void result.then(()=>{settled=true;},()=>{settled=true;});await f.started;
  const worker=f.workers[1];assert.equal(worker.job.reportGeometryProgress,true);
  worker.emit({kind:'geometry-progress',stage:'assets',completed:0,total:3});worker.emit({kind:'geometry-progress',stage:'assets',completed:2,total:3});
  worker.emit({kind:'geometry-progress',stage:'assets',completed:4,total:3});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  const events=f.events.filter(event=>event.phase==='Preparing surface geometry');
  assert.equal(events.length,2);assert.equal(events[1].progress.completed,2);assert.equal(events[1].progress.total,3);assert.equal(events[1].progress.unit,'surface geometry assets');
  worker.emit({kind:'geometry-progress',stage:'assembly'});assert.equal(f.events.at(-1).phase,'Assembling surface geometry');assert.equal(f.events.at(-1).progress,undefined);
  worker.emit({result:new Uint8Array([9]).buffer});assert.equal(new Uint8Array(await result)[0],9);
 }finally{provider.destroy();}
});
test('cached surface geometry emits no rebuild progress',async()=>{
 const f=geometryProgressFixture({cached:true}),provider=await f.createProvider();
 try{const result=await provider.zipped('fixture/world-fixes/details/vertices.bin.gz');assert.equal(new Uint8Array(result)[0],7);assert.equal(f.workers[1].job,undefined);assert.ok(!f.events.some(event=>event.phase?.includes('surface geometry')));}finally{provider.destroy();}
});
test('retired geometry requests ignore later progress and reject pending work',async()=>{
 const f=geometryProgressFixture(),provider=await f.createProvider();
 const result=provider.zipped('fixture/world-fixes/details/vertices.bin.gz');await f.started;
 const worker=f.workers[1];worker.emit({kind:'geometry-progress',stage:'assets',completed:1,total:3});const count=f.events.length;
 f.controller.abort();worker.emit({kind:'geometry-progress',stage:'assets',completed:2,total:3});
 assert.equal(f.events.length,count);assert.ok(f.workers.every(worker=>!worker.stopped),'active geometry work must drain before termination');
 worker.emit({result:new Uint8Array([9]).buffer});await assert.rejects(result,{name:'AbortError'});await provider.whenDisposed();assert.ok(f.workers.every(worker=>worker.stopped));
});

test('failed geometry requests reject and ignore late worker progress',async()=>{
 const f=geometryProgressFixture(),provider=await f.createProvider();
 try{
  const result=provider.zipped('fixture/world-fixes/details/vertices.bin.gz');await f.started;
  const worker=f.workers[1];worker.emit({kind:'geometry-progress',stage:'assets',completed:1,total:3});
  worker.emit({error:'receiver unavailable'});await assert.rejects(result,/receiver unavailable/);const count=f.events.length;
  worker.emit({kind:'geometry-progress',stage:'assets',completed:2,total:3});assert.equal(f.events.length,count);
 }finally{provider.destroy();}
});

test('identical embedded images share decoding across model leases until the last owner releases',async()=>{
 const {webcrypto}=await import('node:crypto');let decoded=0,closed=0;
 const manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{},recipes:{},physicalResources:[{path:'a.glb'},{path:'b.glb'}]};
 class Worker{constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(m){queueMicrotask(()=>this.onmessage({data:{id:m.id,result:new Uint8Array([1,2,3]).buffer}}));}terminate(){}}
 class ImageSource{constructor(o){Object.assign(this,o);this.style={};}}
 class Texture{constructor(o){Object.assign(this,o);}destroy(){this.source.destroyed=true;}}
 const create=runInNewContext(source,{retainFireStaticMaterials,retainContainedWaterMaterials,crypto:webcrypto,Uint8Array,Array,createTransferLedger,createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,ImageSource,Texture,
 glbToGltf:()=>({json:{materials:[],buffers:[{byteLength:3}],bufferViews:[{buffer:0,byteLength:3}],images:[{bufferView:0}]},buffers:[new Uint8Array([1,2,3]).buffer]}),
 normalizeMeshopt:async()=>{},retainModelMaterialNames:s=>s,decodeWorldImage:async()=>{decoded++;return{close(){closed++;}};},parseGltf:async(_j,_b,textures)=>({textures,destroy(){}}),fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const p=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}}),a=p.createModelLease(),b=p.createModelLease();
 const [x,y]=await Promise.all([a.get('https://fixture.test/world/a.glb'),b.get('https://fixture.test/world/b.glb')]);assert.equal(decoded,1);assert.equal(x.textures[0],y.textures[0]);a.release();await new Promise(r=>setTimeout(r,0));assert.equal(closed,0);b.release();await new Promise(r=>setTimeout(r,0));assert.equal(closed,1);p.destroy();
});
