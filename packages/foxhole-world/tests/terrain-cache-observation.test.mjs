import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {fetchCompactResource} from '../runtime/compact-cache.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
test('one physical fetch reaches every in-flight observer and warm cache makes no observation',async()=>{
 const bytes=new Uint8Array([1,2,3]),hash=createHash('sha256').update(bytes).digest('hex');
 const ref={path:`content/raw/${hash}/asset.bin`,hash,decodedHash:hash,bytes:bytes.length},cache=memoryWorldCaches();
 let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r),one=[],two=[];let fetches=0;
 const options={cachesApi:cache.api,fetcher:async()=>{fetches++;started();await gate;return new Response(bytes);}};
 const first=fetchCompactResource('https://terrain-metrics.fixture/',ref,{...options,onNetwork:event=>one.push(event)});
 await ready;const second=fetchCompactResource('https://terrain-metrics.fixture/',ref,{...options,onNetwork:event=>two.push(event)});
 release();await Promise.all([first,second]);assert.equal(fetches,1);assert.equal(one.length,1);assert.deepEqual(two,one);assert.equal(one[0].kind,'unknown');
 const warm=[];await fetchCompactResource('https://terrain-metrics.fixture/',ref,{...options,onNetwork:event=>warm.push(event)});assert.equal(fetches,1);assert.deepEqual(warm,[]);
});
test('a failed fetch is unknown and a retry gets a distinct identity',async()=>{
 const bytes=new Uint8Array([4,5]),hash=createHash('sha256').update(bytes).digest('hex');const ref={path:`content/raw/${hash}/asset.bin`,hash,decodedHash:hash,bytes:bytes.length};
 const observations=[];let fail=true;const options={cachesApi:null,onNetwork:event=>observations.push(event),fetcher:async()=>{if(fail)throw Error('offline');return new Response(bytes);}};
 await assert.rejects(fetchCompactResource('https://terrain-failed.fixture/',ref,options),/Could not fetch/);fail=false;await fetchCompactResource('https://terrain-failed.fixture/',ref,options);
 assert.equal(observations.length,2);assert.equal(observations[0].kind,'unknown');assert.notEqual(observations[0].id,observations[1].id);
});
test('a waiter joining after the response but before cache persistence receives the same event',async()=>{
 const bytes=new Uint8Array([6,7]),hash=createHash('sha256').update(bytes).digest('hex');const ref={path:`content/raw/${hash}/asset.bin`,hash,decodedHash:hash,bytes:bytes.length};
 const memory=memoryWorldCaches();let started,release;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r),one=[],two=[];
 const api={open:async name=>{const cache=await memory.api.open(name);if(name!=='foxhole-world-compact-v1')return cache;return {...cache,put:async(...args)=>{started();await gate;return cache.put(...args);}};}};
 const options={cachesApi:api,fetcher:async()=>new Response(bytes)};const first=fetchCompactResource('https://terrain-late.fixture/',ref,{...options,onNetwork:e=>one.push(e)});
 await ready;const second=fetchCompactResource('https://terrain-late.fixture/',ref,{...options,onNetwork:e=>two.push(e)});release();await Promise.all([first,second]);assert.equal(one.length,1);assert.deepEqual(two,one);
});
