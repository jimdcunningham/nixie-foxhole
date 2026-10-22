import {createSourceLeasePool} from '../runtime/source-leases.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../runtime/compact-provider.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(import.meta.url)).replace('export async function','async function')+'\ncreateCompactProvider;';
test('idle providers stop decoder workers and restart them for a later requested layer',async()=>{
 const workers=[],manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{'fixture/first.json':{resource:{path:'first'}},'fixture/next.json':{resource:{path:'next'}}},recipes:{},physicalResources:[]};
 class Worker {constructor(){workers.push(this);queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(message){queueMicrotask(()=>this.onmessage({data:{id:message.id,result:new TextEncoder().encode(JSON.stringify({file:message.ref.path})).buffer}}));}terminate(){this.stopped=true;}}
 const create=runInNewContext(source,{createSourceLeasePool,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}});
 assert.equal(workers.length,0,'no decoder is started until it is needed');assert.equal((await provider.json('fixture/first.json')).file,'first');assert.equal(workers.length,3);
 provider.finish();assert.ok(workers.every(w=>w.stopped));assert.equal((await provider.json('fixture/next.json')).file,'next');assert.equal(workers.length,6);assert.ok(workers.slice(3).every(w=>!w.stopped));
 provider.finish();assert.ok(workers.every(w=>w.stopped));provider.destroy();await assert.rejects(provider.json('fixture/next.json'),{name:'AbortError'});
});

test('native model leases share sources and release the final cell without retiring the region',async()=>{
 let decoded=0,destroyed=0;const manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{},recipes:{},physicalResources:[{path:'native.gltf'}]};
 class Worker {constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(message){queueMicrotask(()=>this.onmessage({data:{id:message.id,result:new TextEncoder().encode('{}').buffer}}));}terminate(){}}
 const create=runInNewContext(source,{createSourceLeasePool,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,
  normalizeMeshopt:async()=>{},retainModelMaterialNames:s=>s,parseGltf:async()=>{decoded++;return{textures:[],destroyed:false,destroy(){if(!this.destroyed){this.destroyed=true;destroyed++;}}};},fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}}),a=provider.createModelLease(),b=provider.createModelLease(),url='https://fixture.test/world/native.gltf';
 const first=await a.get(url);assert.equal(await b.get(url),first);assert.equal(decoded,1);a.release();await new Promise(r=>setTimeout(r,0));assert.equal(destroyed,0);b.release();await new Promise(r=>setTimeout(r,0));assert.equal(destroyed,1);
 const c=provider.createModelLease();assert.notEqual(await c.get(url),first);assert.equal(decoded,2);c.release();await new Promise(r=>setTimeout(r,0));provider.destroy();
});
