import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {memoryWorldCaches} from './cache-fixture.mjs';
import {fetchCompactResource} from '../runtime/compact-cache.mjs';

test('raw cache writes finish before transfer and preserve the warm image bytes',async()=>{
 const bytes=new Uint8Array(1024*1024+23);
 for(let i=0;i<bytes.length;i++)bytes[i]=(i*43+(i>>>8))&255;
 const hash=createHash('sha256').update(bytes).digest('hex');
 const ref={path:`content/raw/${hash}/asset.webp`,hash,decodedHash:hash,bytes:bytes.length};
 const memory=memoryWorldCaches();let release,started,settled=false,fetches=0;
 const gate=new Promise(resolve=>{release=resolve;});const began=new Promise(resolve=>{started=resolve;});
 const api={open:async name=>{const cache=await memory.api.open(name);
  if(name!=='foxhole-world-compact-v1')return cache;
  return {...cache,put:async(key,response)=>{started();await gate;return cache.put(key,response);}};
 }};
 const options={cachesApi:api,fetcher:async()=>{fetches++;return new Response(bytes);}};
 const pending=fetchCompactResource('https://raw-stream.fixture/world/',ref,options);
 void pending.then(()=>{settled=true;},()=>{settled=true;});
 try {
  await began;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false,'the worker may not transfer bytes before the cache write settles');
  release();const cold=await pending;
  assert.deepEqual(new Uint8Array(cold),bytes);
  const moved=structuredClone(cold,{transfer:[cold]});assert.equal(cold.byteLength,0);
  assert.deepEqual(new Uint8Array(moved),bytes);
  const warm=await fetchCompactResource('https://raw-stream.fixture/world/',ref,options);
  assert.deepEqual(new Uint8Array(warm),bytes);assert.equal(fetches,1);
 } finally {release();await pending.catch(()=>{});}
});


test('failed raw cache writes settle before transferring verified bytes',async()=>{
 const bytes=new Uint8Array(262147);
 for(let i=0;i<bytes.length;i++)bytes[i]=(i*71+(i>>>5))&255;
 const hash=createHash('sha256').update(bytes).digest('hex');
 const ref={path:`content/raw/${hash}/asset.webp`,hash,decodedHash:hash,bytes:bytes.length};
 const memory=memoryWorldCaches();let release,started,settled=false;
 const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 const api={open:async name=>{const cache=await memory.api.open(name);if(name!=='foxhole-world-compact-v1')return cache;
  return {...cache,put:async()=>{started();await gate;throw Error('simulated quota failure');}};
 }};
 const metrics={cacheHits:0,cacheMisses:0,cacheWriteFailures:0,downloadBytes:0};
 const pending=fetchCompactResource('https://raw-stream-failure.fixture/world/',ref,{cachesApi:api,metrics,fetcher:async()=>new Response(bytes)});
 void pending.then(()=>{settled=true;},()=>{settled=true;});
 try{
  await began;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  release();const cold=await pending;assert.equal(metrics.cacheWriteFailures,1);
  const moved=structuredClone(cold,{transfer:[cold]});assert.equal(cold.byteLength,0);
  assert.deepEqual(new Uint8Array(moved),bytes);
 }finally{release();await pending.catch(()=>{});}
});

