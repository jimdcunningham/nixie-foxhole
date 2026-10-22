import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedTerrainPixels} from '../runtime/decoded-texture-cache.mjs';
const slice={width:2,height:1,resource:{decodedHash:'a'.repeat(64)}};
const fixture=()=>({bytes:new Uint8Array([12,23,34,0,56,67,78,255]),width:2,height:1});
function storage(){const entries=new Map();return {entries,cachesApi:{open:async()=>({match:async k=>entries.get(typeof k==='string'?k:k.url)?.clone(),put:async(k,r)=>entries.set(k,r),delete:async k=>entries.delete(typeof k==='string'?k:k.url),keys:async()=>[...entries.keys()]})}};}
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
