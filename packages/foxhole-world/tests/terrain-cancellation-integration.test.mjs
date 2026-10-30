import test from 'node:test';import assert from 'node:assert/strict';import {createHash,webcrypto} from 'node:crypto';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
import {createTerrainTexturePool} from '../runtime/terrain-texture-pool.mjs';import {fetchCompactResource} from '../runtime/compact-cache.mjs';import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';
const source=readFileSync(new URL('../authoring/decode-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''),bytes=new Uint8Array([7,8,9]),hash=createHash('sha256').update(bytes).digest('hex');
const ref={path:`content/raw/${hash}/asset.webp`,hash,decodedHash:hash,bytes:3,encoding:'raw'},descriptor={baseUrl:'https://world.test/',kind:'color',entry:{size:128,slices:[{resource:ref}]}},cache={open:async()=>{throw Error('no cache');}};
const createSource=o=>({...o,destroy(){this.destroyed=true;}}),tick=()=>new Promise(r=>setImmediate(r));
async function until(fn){for(let i=0;i<100&&!fn();i++)await tick();assert.ok(fn(),'controlled operation did not start');}
function fixture(){
 const original=globalThis.Worker,workers=[],requests=[];let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const fetcher=(_url,{signal})=>{requests.push(signal);return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});gate.then(()=>resolve(new Response(bytes)));});};
 globalThis.Worker=class{
  constructor(){this.terminated=false;workers.push(this);const self={location:{href:'https://world.test/'},postMessage:data=>queueMicrotask(()=>this.onmessage?.({data}))};this.self=self;
   runInNewContext(source,{self,AbortController,DOMException,performance:{setResourceTimingBufferSize(){},now:()=>0,getEntriesByName:()=>[]},MeshoptDecoder:{ready:Promise.resolve()},crypto:webcrypto,resizeTerrainPixels,URL,Uint8Array,ArrayBuffer,Promise,webpWasm:'',initWebp:async()=>{},decodeWebp:async()=>({width:128,height:128,data:new Uint8Array(128*128*4)}),cachedTerrainPixels:async(_base,_key,build)=>build(),fetchCompactResource:(base,ref,options)=>fetchCompactResource(base,ref,{...options,cachesApi:cache,fetcher})});
  }
  postMessage(data){queueMicrotask(()=>this.self.onmessage({data}));}terminate(){this.terminated=true;}
 };
 return {workers,requests,release,restore(){globalThis.Worker=original;}};
}
test('last region cancellation reaches real worker and compact fetch and drains pool',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),abort=new AbortController();
 try{const pending=pool.acquire([descriptor],128,{signal:abort.signal}).then(()=>null,e=>e);await until(()=>f.requests.length===1);abort.abort();assert.equal((await pending).name,'AbortError');await until(()=>f.requests[0].aborted&&pool.stats.usedBytes===0&&f.workers[0].terminated);}
 finally{f.release();f.restore();}
});
test('canceling one region leaves the shared real-worker fetch available to another',async()=>{
 const f=fixture(),pool=createTerrainTexturePool({createSource}),abort=new AbortController();
 try{const first=pool.acquire([descriptor],128,{signal:abort.signal}).then(()=>null,e=>e),second=pool.acquire([descriptor],128);await until(()=>f.requests.length===1);abort.abort();assert.equal((await first).name,'AbortError');assert.equal(f.requests[0].aborted,false);f.release();const lease=await second;assert.ok(lease.sources.length);lease.release();await until(()=>pool.stats.usedBytes===0);}
 finally{f.release();f.restore();}
});
