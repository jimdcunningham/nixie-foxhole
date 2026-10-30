import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedTerrainPixels} from '../runtime/decoded-texture-cache.mjs';
const slice={width:2,height:1,resource:{decodedHash:'a'.repeat(64)}};
const fixture=()=>({bytes:new Uint8Array([12,23,34,0,56,67,78,255]),width:2,height:1});
function storage(){
 const caches=new Map(),stats={bodyKeys:0,bodyMatches:0};
 const open=async name=>{if(!caches.has(name))caches.set(name,new Map());const entries=caches.get(name),body=name==='foxhole-world-terrain-pixels-v1';return {
  match:async k=>{if(body)stats.bodyMatches++;return entries.get(typeof k==='string'?k:k.url)?.clone();},
  put:async(k,r)=>entries.set(k,r),delete:async k=>entries.delete(typeof k==='string'?k:k.url),
  keys:async()=>{if(body)stats.bodyKeys++;return [...entries.keys()];}};};
 const entries=new Map();caches.set('foxhole-world-terrain-pixels-v1',entries);return {entries,cachesApi:{open},stats,caches};
}
test('terrain cache retains every RGBA byte including RGB beneath transparent alpha',async()=>{
 const {entries,cachesApi}=storage(),metrics={};let builds=0;const build=async()=>{builds++;return fixture();};
 const a=await cachedTerrainPixels('https://test.invalid/world/',slice,build,{cachesApi,metrics});
 const b=await cachedTerrainPixels('https://test.invalid/world/',slice,build,{cachesApi,metrics});
 assert.deepEqual(b,fixture());assert.deepEqual(a,b);assert.equal(builds,1);assert.equal(metrics.textureCacheHits,1);assert.equal(entries.size,1);
 const key=[...entries.keys()][0];entries.set(key,new Response(new Uint8Array([1,2,3])));
 assert.deepEqual(await cachedTerrainPixels('https://test.invalid/world/',slice,build,{cachesApi}),fixture());assert.equal(builds,2);
 const valid=entries.get(key),headers=new Headers(valid.headers);headers.set('X-Foxhole-Pixel-Hash','0'.repeat(64));entries.set(key,new Response(await valid.arrayBuffer(),{headers}));
 assert.deepEqual(await cachedTerrainPixels('https://test.invalid/world/',slice,build,{cachesApi}),fixture());assert.equal(builds,3);
});
test('terrain pixel cache stays bounded and source hashes isolate stale pixels',async()=>{
 const {entries,cachesApi}=storage();const options={cachesApi,budget:30};
 await cachedTerrainPixels('https://test.invalid/world/',slice,fixture,options);
 await cachedTerrainPixels('https://test.invalid/world/',{...slice,resource:{decodedHash:'b'.repeat(64)}},fixture,options);
 assert.equal(entries.size,1);assert.ok([...entries.keys()][0].includes('b'.repeat(64)));
});
test('terrain cache quota failure falls back to exact decoded data',async()=>{
 const metrics={},cachesApi={open:async()=>({match:async()=>null,keys:async()=>[],put:async()=>{throw Error('quota');}})};
 assert.deepEqual(await cachedTerrainPixels('https://test.invalid/world/',slice,fixture,{cachesApi,metrics}),fixture());assert.equal(metrics.cacheWriteFailures,1);
});


test('cold terrain slice writes do not repeatedly enumerate cached pixels',async()=>{
 const {entries,cachesApi,stats}=storage();
 const slices=Array.from({length:78},(_,i)=>({...slice,resource:{decodedHash:i.toString(16).padStart(64,'0')}}));
 await Promise.all(slices.map(value=>cachedTerrainPixels('https://test.invalid/world/',value,fixture,{cachesApi})));
 assert.equal(entries.size,78);assert.ok(stats.bodyKeys<=2,`expected at most two cache scans, got ${stats.bodyKeys}`);
 assert.ok(stats.bodyMatches<=160,`expected linear body lookups, got ${stats.bodyMatches}`);
 const scans=stats.bodyKeys;
 const results=await Promise.all(slices.map(value=>cachedTerrainPixels('https://test.invalid/world/',value,()=>{throw Error('unexpected miss');},{cachesApi})));
 assert.equal(results.length,78);assert.equal(stats.bodyKeys,scans,'warm hits do not rescan the body cache');
});


test('warm cache hits renew retention without blocking returned pixels',async()=>{
 const {entries,cachesApi,caches}=storage();
 await cachedTerrainPixels('https://test.invalid/world/',slice,fixture,{cachesApi});
 const key=[...entries.keys()][0],usage=caches.get('foxhole-world-cache-usage-v1');
 const usageKey='https://foxhole-world-cache.invalid/foxhole-world-terrain-pixels-v1/'+encodeURIComponent(key);
 assert.equal((await usage.get(usageKey).clone().json()).activeUntil,0);
 assert.deepEqual(await cachedTerrainPixels('https://test.invalid/world/',slice,()=>{throw Error('unexpected miss');},{cachesApi}),fixture());
 const deadline=Date.now()+1000;let activeUntil=0;
 while(Date.now()<deadline&&activeUntil===0){await new Promise(resolve=>setTimeout(resolve,10));activeUntil=(await usage.get(usageKey).clone().json()).activeUntil;}
 assert.ok(activeUntil>Date.now(),'a recently reused slice is protected from cache pressure');
});
