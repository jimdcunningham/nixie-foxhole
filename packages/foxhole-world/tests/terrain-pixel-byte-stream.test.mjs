import test from 'node:test';import assert from 'node:assert/strict';
import {terrainPixelByteStream,cachedTerrainPixels} from '../runtime/decoded-texture-cache.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
const chunk=256*1024;
test('pixel compression input is demand-driven, bounded, and reuses the original buffer',async()=>{
 const pixels=new Uint8Array(chunk*2+17);for(let i=0;i<pixels.length;i++)pixels[i]=i%251;
 let slices=0;const original=pixels.subarray.bind(pixels);pixels.subarray=(...args)=>{slices++;return original(...args);};
 const reader=terrainPixelByteStream(pixels).getReader();await new Promise(resolve=>setImmediate(resolve));assert.equal(slices,0,'no compression input is queued before demand');
 const chunks=[];for(;;){const next=await reader.read();if(next.done)break;chunks.push(next.value);assert.equal(next.value.buffer,pixels.buffer);assert.ok(next.value.byteLength<=chunk);}
 assert.deepEqual(chunks.map(x=>x.byteLength),[chunk,chunk,17]);assert.equal(slices,3);assert.deepEqual(Buffer.concat(chunks.map(x=>Buffer.from(x))),Buffer.from(pixels));
});
test('cancelled pixel streams do not keep producing chunks',async()=>{
 const pixels=new Uint8Array(chunk*3);let slices=0;const original=pixels.subarray.bind(pixels);pixels.subarray=(...args)=>{slices++;return original(...args);};
 const reader=terrainPixelByteStream(pixels).getReader();await reader.read();assert.equal(slices,1);await reader.cancel('retired');await new Promise(resolve=>setImmediate(resolve));assert.equal(slices,1);assert.equal((await reader.read()).done,true);
});
test('chunked compression preserves all pixels across chunk boundaries and warm cache reads',async()=>{
 const storage=memoryWorldCaches(),pixels=new Uint8Array(512*512*4);for(let i=0;i<pixels.length;i++)pixels[i]=(i*67)%256;
 const slice={width:512,height:512,resource:{decodedHash:'a'.repeat(64)}},build=async()=>({bytes:pixels,width:512,height:512}),metrics={};
 const first=await cachedTerrainPixels('https://test.invalid/world/',slice,build,{cachesApi:storage.api,metrics});let calls=0;
 const second=await cachedTerrainPixels('https://test.invalid/world/',slice,()=>{calls++;throw Error('unexpected miss');},{cachesApi:storage.api,metrics});
 assert.equal(first.bytes,pixels);assert.deepEqual(second.bytes,pixels);assert.equal(calls,0);assert.equal(metrics.textureCacheHits,1);
});
test('cache compression errors return the exact decoded pixels and report the failure',async()=>{
 const storage=memoryWorldCaches(),pixels=new Uint8Array([19,33,127,0]),slice={width:1,height:1,resource:{decodedHash:'b'.repeat(64)}},metrics={},original=globalThis.CompressionStream;
 try{globalThis.CompressionStream=class {constructor(){throw Error('compression unavailable');}};const decoded=await cachedTerrainPixels('https://test.invalid/world/',slice,()=>({bytes:pixels,width:1,height:1}),{cachesApi:storage.api,metrics});assert.equal(decoded.bytes,pixels);assert.deepEqual([...decoded.bytes],[19,33,127,0]);assert.equal(metrics.cacheWriteFailures,1);assert.equal(storage.rows('foxhole-world-terrain-pixels-v1').size,0);}finally{globalThis.CompressionStream=original;}
});
test('decoded pixels remain owned until a pending cache write settles',async()=>{
 const storage=memoryWorldCaches(),pixels=new Uint8Array([2,3,4,0]),slice={width:1,height:1,resource:{decodedHash:'c'.repeat(64)}},open=storage.api.open;let release,started,settled=false;
 const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 storage.api.open=async name=>{const cache=await open(name);if(name==='foxhole-world-terrain-pixels-v1'){const put=cache.put;cache.put=async(...args)=>{started();await gate;return put(...args);};}return cache;};
 const pending=cachedTerrainPixels('https://test.invalid/world/',slice,()=>({bytes:pixels,width:1,height:1}),{cachesApi:storage.api});void pending.then(()=>{settled=true;},()=>{settled=true;});
 try{await began;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.deepEqual([...pixels],[2,3,4,0]);release();const result=await pending;assert.equal(result.bytes,pixels);}finally{release();await pending.catch(()=>{});}
});
test('a digest failure waits for in-flight pixel compression before returning ownership',async()=>{
 const storage=memoryWorldCaches(),pixels=new Uint8Array([10,20,30,0]),slice={width:1,height:1,resource:{decodedHash:'d'.repeat(64)}},metrics={};
 const originalCompressor=globalThis.CompressionStream,subtle=globalThis.crypto.subtle,originalDigest=subtle.digest;let release,started,settled=false;
 const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 try{
  subtle.digest=async()=>{throw Error('digest unavailable');};
  globalThis.CompressionStream=class {constructor(format){const wait=new TransformStream({async transform(chunk,controller){started();await gate;controller.enqueue(chunk);}}),real=new originalCompressor(format);return {writable:wait.writable,readable:wait.readable.pipeThrough(real)};}};
  const pending=cachedTerrainPixels('https://test.invalid/world/',slice,()=>({bytes:pixels,width:1,height:1}),{cachesApi:storage.api,metrics});void pending.then(()=>{settled=true;},()=>{settled=true;});
  try{await began;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'the input must not be returned while compression still reads it');release();const result=await pending;assert.equal(result.bytes,pixels);assert.equal(metrics.cacheWriteFailures,1);assert.equal(storage.rows('foxhole-world-terrain-pixels-v1').size,0);}finally{release();await pending.catch(()=>{});}
 }finally{subtle.digest=originalDigest;globalThis.CompressionStream=originalCompressor;}
});
test('a compression failure waits for in-flight digest work before returning ownership',async()=>{
 const storage=memoryWorldCaches(),pixels=new Uint8Array([40,50,60,0]),slice={width:1,height:1,resource:{decodedHash:'e'.repeat(64)}},metrics={};
 const originalCompressor=globalThis.CompressionStream,subtle=globalThis.crypto.subtle,originalDigest=subtle.digest;let release,started,settled=false;
 const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 try{
  subtle.digest=async(...args)=>{started();await gate;return originalDigest.call(subtle,...args);};
  globalThis.CompressionStream=class {constructor(){return new TransformStream({transform(){throw Error('compression failed');}});}};
  const pending=cachedTerrainPixels('https://test.invalid/world/',slice,()=>({bytes:pixels,width:1,height:1}),{cachesApi:storage.api,metrics});void pending.then(()=>{settled=true;},()=>{settled=true;});
  try{await began;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'the input must not be returned while digest still reads it');release();const result=await pending;assert.equal(result.bytes,pixels);assert.equal(metrics.cacheWriteFailures,1);assert.equal(storage.rows('foxhole-world-terrain-pixels-v1').size,0);}finally{release();await pending.catch(()=>{});}
 }finally{subtle.digest=originalDigest;globalThis.CompressionStream=originalCompressor;}
});
