import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cachedRecipe} from '../runtime/recipe-cache.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function storage(){
 const entries=new Map();
 return {entries,api:{open:async()=>({match:async key=>entries.get(key)?.clone(),put:async(key,response)=>{entries.set(key,response);},delete:async key=>entries.delete(key),keys:async()=>[...entries.keys()]})}};
}
test('lossless derived buffers survive a new load without replaying their recipes',async()=>{
 const bytes=new Float32Array([Math.PI,-1.25,0,78.5]).buffer,h=hash(new Uint8Array(bytes)),cache=storage(),metrics={};let builds=0;
 const options={cachesApi:cache.api,metrics},build=async()=>{builds++;return bytes;};
 const first=await Promise.all([cachedRecipe('https://recipe.test/world/',h,build,options),cachedRecipe('https://recipe.test/world/',h,build,options)]);
 const warm=await cachedRecipe('https://recipe.test/world/',h,build,options);
 assert.equal(builds,1);assert.deepEqual(new Uint8Array(warm),new Uint8Array(bytes));assert.deepEqual(first[0],first[1]);assert.equal(metrics.recipeCacheHits,1);
});
test('corrupt derived data is rebuilt and incorrect recipe output is rejected',async()=>{
 const bytes=new Uint8Array([1,2,3,4]),h=hash(bytes),cache=storage(),base='https://corrupt.test/world/';
 cache.entries.set(new URL('derived-v1/'+h+'.bin',base).href,new Response('broken'));
 const result=await cachedRecipe(base,h,async()=>bytes.buffer,{cachesApi:cache.api});assert.deepEqual(new Uint8Array(result),bytes);
 await assert.rejects(cachedRecipe('https://wrong.test/world/',h,async()=>new Uint8Array([5]).buffer,{cachesApi:storage().api}),/integrity/);
});
test('derived storage stays within its compressed budget and quota failures are nonfatal',async()=>{
 const cache=storage(),base='https://budget.test/world/',bytes=[new Uint8Array([1,2,3]),new Uint8Array([4,5,6])];
 for(const b of bytes)await cachedRecipe(base,hash(b),async()=>b.buffer,{cachesApi:cache.api,budget:30});
 assert.equal(cache.entries.size,1);assert.ok([...cache.entries.values()].every(r=>Number(r.headers.get('X-Foxhole-Recipe-Bytes'))<=30));
 const metrics={},b=bytes[0],cachesApi={open:async()=>({match:async()=>null,keys:async()=>[],put:async()=>{throw Error('quota');}})};
 assert.deepEqual(new Uint8Array(await cachedRecipe('https://quota.test/world/',hash(b),async()=>b.buffer,{cachesApi,metrics})),b);
 assert.equal(metrics.cacheWriteFailures,1);
});
test('aborting one region load cannot poison an independent load of the same recipe',async()=>{
 const a=new AbortController(),b=new AbortController(),bytes=new Uint8Array([7,8,9]),h=hash(bytes),cache=storage();let release;
 const first=cachedRecipe('https://abort.test/world/',h,()=>new Promise(resolve=>{release=()=>resolve(bytes.buffer);}),{signal:a.signal,cachesApi:cache.api});
 const rejected=assert.rejects(first,{name:'AbortError'});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 const second=cachedRecipe('https://abort.test/world/',h,async()=>bytes.buffer,{signal:b.signal,cachesApi:cache.api});
 a.abort();release();
 await rejected;assert.deepEqual(new Uint8Array(await second),bytes);
});
