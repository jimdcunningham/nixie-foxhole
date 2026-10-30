import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {boundedByteStream} from '../runtime/bounded-byte-stream.mjs';
import {cachedRecipe,readCachedRoadAssembly,writeCachedRoadAssembly} from '../runtime/recipe-cache.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
const base='https://stream.test/world/',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const compressed=stream=>new Response(stream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
test('bounded input preserves exact compressed bytes for large buffers and offset views',async()=>{
 const backing=new Uint8Array(1024*1024+31);for(let i=0;i<backing.length;i++)backing[i]=(i*67+i%251)%256;
 for(const source of [backing.buffer,backing.subarray(13,backing.length-7),new DataView(backing.buffer,23,300007)]){
  const expected=await compressed(new Blob([source]).stream()),actual=await compressed(boundedByteStream(source));
  assert.deepEqual(new Uint8Array(actual),new Uint8Array(expected));
  const decoded=await new Response(new Blob([actual]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const bytes=source instanceof ArrayBuffer?new Uint8Array(source):new Uint8Array(source.buffer,source.byteOffset,source.byteLength);
  assert.deepEqual(new Uint8Array(decoded),bytes);
 }
});
test('recipe and road caches preserve an offset view without its surrounding bytes',async()=>{
 const storage=memoryWorldCaches(),backing=new Uint8Array(600031);for(let i=0;i<backing.length;i++)backing[i]=i%251;
 const bytes=backing.subarray(13,backing.length-11),h=hash(bytes),key='c'.repeat(64),options={cachesApi:storage.api};
 assert.equal(await cachedRecipe(base,h,()=>bytes,options),bytes);
 assert.deepEqual(new Uint8Array(await cachedRecipe(base,h,()=>{throw Error('unexpected miss');},options)),bytes);
 await writeCachedRoadAssembly(base,key,bytes,options);assert.deepEqual(new Uint8Array(await readCachedRoadAssembly(base,key,options)),bytes);
});
test('road cache waits for compression after digest fails before releasing input',async()=>{
 const storage=memoryWorldCaches(),metrics={},original=globalThis.CompressionStream,subtle=crypto.subtle,oldDigest=subtle.digest;let release,started,settled=false;
 const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 try{
  subtle.digest=async()=>{throw Error('digest unavailable');};
  globalThis.CompressionStream=class {constructor(format){const wait=new TransformStream({async transform(chunk,controller){started();await gate;controller.enqueue(chunk);}}),real=new original(format);return {writable:wait.writable,readable:wait.readable.pipeThrough(real)};}};
  const pending=writeCachedRoadAssembly(base,'d'.repeat(64),new Uint8Array([1,2,3]),{cachesApi:storage.api,metrics});void pending.then(()=>{settled=true;},()=>{settled=true;});
  try{await began;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();await pending;assert.equal(metrics.cacheWriteFailures,1);assert.equal(storage.rows('foxhole-world-recipes-v1').size,0);}finally{release();await pending.catch(()=>{});}
 }finally{subtle.digest=oldDigest;globalThis.CompressionStream=original;}
});
test('road cache waits for digest after compression fails before releasing input',async()=>{
 const storage=memoryWorldCaches(),metrics={},original=globalThis.CompressionStream,subtle=crypto.subtle,oldDigest=subtle.digest;let release,started,settled=false;
 const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 try{
  subtle.digest=async(...args)=>{started();await gate;return oldDigest.call(subtle,...args);};
  globalThis.CompressionStream=class {constructor(){return new TransformStream({transform(){throw Error('compression failed');}});}};
  const pending=writeCachedRoadAssembly(base,'e'.repeat(64),new Uint8Array([1,2,3]),{cachesApi:storage.api,metrics});void pending.then(()=>{settled=true;},()=>{settled=true;});
  try{await began;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();await pending;assert.equal(metrics.cacheWriteFailures,1);assert.equal(storage.rows('foxhole-world-recipes-v1').size,0);}finally{release();await pending.catch(()=>{});}
 }finally{subtle.digest=oldDigest;globalThis.CompressionStream=original;}
});
