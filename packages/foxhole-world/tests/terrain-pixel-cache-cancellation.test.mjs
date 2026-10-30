import test from 'node:test';import assert from 'node:assert/strict';import {gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';import {cachedTerrainPixels} from '../runtime/decoded-texture-cache.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
const pixels=new Uint8Array(16).fill(12),hash=createHash('sha256').update(pixels).digest('hex'),slice={resource:{decodedHash:'a'.repeat(64)},width:2,height:2},base='https://world.test/';
const key=new URL(`decoded-rgba-jsquash-v1/${slice.resource.decodedHash}/2x2.bin`,base).href, deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(fn){for(let i=0;i<80&&!fn();i++)await Promise.resolve();assert.ok(fn(),'controlled operation not started');}
test('abort during cached match preserves valid cached pixels and skips rebuild',async()=>{
 const storage=memoryWorldCaches(),gate=deferred(),controller=new AbortController();let started=false,builds=0;
 storage.rows('foxhole-world-terrain-pixels-v1').set(key,new Response(gzipSync(pixels),{headers:{'X-Foxhole-Pixel-Hash':hash}}));
 const open=storage.api.open;storage.api.open=async name=>{const existing=await open(name);if(name==='foxhole-world-terrain-pixels-v1'){const match=existing.match;existing.match=async request=>{started=true;await gate.promise;return match(request);};}return existing;};
 const result=cachedTerrainPixels(base,slice,()=>{builds++;throw Error('unexpected rebuild');},{cachesApi:storage.api,signal:controller.signal}).then(()=>null,e=>e);
 await until(()=>started);controller.abort();gate.resolve();assert.equal((await result).name,'AbortError');assert.equal(builds,0);assert.equal(storage.rows('foxhole-world-terrain-pixels-v1').has(key),true);
});
test('abort while source builds prevents compression or cache writes',async()=>{
 const storage=memoryWorldCaches(),gate=deferred(),controller=new AbortController();let started=false;
 const result=cachedTerrainPixels(base,slice,async()=>{started=true;await gate.promise;return {bytes:pixels,width:2,height:2};},{cachesApi:storage.api,signal:controller.signal}).then(()=>null,e=>e);
 await until(()=>started);controller.abort();gate.resolve();assert.equal((await result).name,'AbortError');assert.equal(storage.rows('foxhole-world-terrain-pixels-v1').has(key),false);
});
