import {createWorldCacheLease} from '../runtime/cache-retention.mjs';
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
 const create=runInNewContext(source,{createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}});
 assert.equal(workers.length,0,'no decoder is started until it is needed');assert.equal((await provider.json('fixture/first.json')).file,'first');assert.equal(workers.length,3);
 provider.finish();assert.ok(workers.every(w=>w.stopped));assert.equal((await provider.json('fixture/next.json')).file,'next');assert.equal(workers.length,6);assert.ok(workers.slice(3).every(w=>!w.stopped));
 provider.finish();assert.ok(workers.every(w=>w.stopped));provider.destroy();await assert.rejects(provider.json('fixture/next.json'),{name:'AbortError'});
});

test('native model leases share sources and release the final cell without retiring the region',async()=>{
 let decoded=0,destroyed=0;const manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{},recipes:{},physicalResources:[{path:'native.gltf'}]};
 class Worker {constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(message){queueMicrotask(()=>this.onmessage({data:{id:message.id,result:new TextEncoder().encode('{}').buffer}}));}terminate(){}}
 const create=runInNewContext(source,{createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,
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
 const create=runInNewContext(source,{createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,
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
 const create=runInNewContext(source,{createWorldCacheLease,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,restoreNativeSmallWaterMaterials,restoreNativeFoliageMasks,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,ImageSource,Texture,decodeWorldImage:async()=>({close(){}}),normalizeMeshopt:async()=>{},retainModelMaterialNames:s=>s,parseGltf:async document=>{parsed=document;return{textures:[],destroy(){}};},fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}}),a=provider.createModelLease(),b=provider.createModelLease();
 try{const model=await a.get('https://fixture.test/world/bush.gltf');assert.equal(await b.get('https://fixture.test/world/bush.gltf'),model);assert.equal(parsed.materials[0].alphaMode,'MASK');assert.equal(parsed.materials[0].alphaCutoff,.333);assert.equal(seen.filter(p=>p===descriptor.resource.path).length,1);a.release();await new Promise(r=>setTimeout(r,0));assert.equal(destroyedImages,0);b.release();await new Promise(r=>setTimeout(r,0));assert.equal(destroyedImages,2,'both original and restored textures follow the model lease');}finally{provider.destroy();}
});
