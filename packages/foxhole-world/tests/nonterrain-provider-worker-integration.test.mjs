import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {createWorldCacheLease} from '../runtime/cache-retention.mjs';
import {createTransferLedger} from '../runtime/terrain-network-observation.mjs';
import {fetchCompactResource,compactResourceCacheKey} from '../runtime/compact-cache.mjs';
import {recipeKey,roadKey} from '../runtime/recipe-cache.mjs';
import {createSourceLeasePool} from '../runtime/source-leases.mjs';
const providerPath=new URL('../runtime/compact-provider.mjs',import.meta.url);
const providerSource=readFileSync(providerPath,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(providerPath.href)).replace('export async function','async function')+'\ncreateCompactProvider;';
const workerSource=readFileSync(new URL('../runtime/resource-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const wait=()=>new Promise(resolve=>setImmediate(resolve));
const unavailableCache={open:async()=>{throw Error('cache unavailable');}};
test('actual provider + resource worker + compact fetch abort transport after last layer',async()=>{
 const body=new TextEncoder().encode('{}'),hash=createHash('sha256').update(body).digest('hex'),ref={path:`content/raw/${hash}/asset.json`,hash,decodedHash:hash,bytes:body.length},requests=[],workers=[];
 const manifest={version:1,format:'compact-recipes-v1',region:'fixture',resources:{'fixture/water.json':{resource:ref}},recipes:{},physicalResources:[]};
 const network=async(_url,{signal})=>{const row={signal};requests.push(row);return await new Promise((resolve,reject)=>{row.resolve=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});};
 class Worker {constructor(){this.index=workers.length%3;workers.push(this);if(this.index===2){const self={postMessage:data=>queueMicrotask(()=>this.onmessage?.({data}))};runInNewContext(workerSource,{self,performance,AbortController,Promise,String,readCachedRecipe:async()=>null,readCachedRoadAssembly:async()=>null,fetchCompactResource:(base,resource,options)=>fetchCompactResource(base,resource,{...options,fetcher:network,cachesApi:unavailableCache})});this.workerSelf=self;}else queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(data){if(this.workerSelf)void this.workerSelf.onmessage({data});}terminate(){this.stopped=true;}}
 const create=runInNewContext(providerSource,{createWorldCacheLease,createTransferLedger,compactResourceCacheKey,recipeKey,roadKey,createSourceLeasePool,location:{href:'https://fixture.test/'},performance,URL,Worker,Map,Set,Promise,AbortController,DOMException,setTimeout,clearTimeout,queueMicrotask,TextDecoder,TextEncoder,console,fetchCompactResource:async()=>new TextEncoder().encode(JSON.stringify(manifest)).buffer});
 const provider=await create({baseUrl:'https://fixture.test/world/',entry:{id:'fixture',manifest:{path:'manifest'}}}),a=new AbortController(),b=new AbortController();
 try{
  const first=provider.json('fixture/water.json',{signal:a.signal}),firstAborted=assert.rejects(first,{name:'AbortError'}),second=provider.json('fixture/water.json',{signal:b.signal});
  for(let i=0;i<10&&!requests.length;i++)await wait();assert.equal(requests.length,1);a.abort();await firstAborted;assert.equal(requests[0].signal.aborted,false,'remaining layer keeps shared transport');
  const secondAborted=assert.rejects(second,{name:'AbortError'});b.abort();await secondAborted;assert.equal(requests[0].signal.aborted,true,'last layer abort reaches the actual fetch');
 }finally{provider.destroy();}
});
