import {memoryWorldCaches} from './cache-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchCompactResource,compactResourceCacheKey} from '../runtime/compact-cache.mjs';
test('compact cache validates decoded bytes, persists compressed bodies and shares requests',async()=>{
 const bytes=new TextEncoder().encode('decoded recipe input'),hash=createHash('sha256').update(bytes).digest('hex'),ref={path:`content/br/${hash}/asset.bin`,hash,decodedHash:hash,bytes:12},storage=memoryWorldCaches(),entries=storage.rows('foxhole-world-compact-v1');let calls=0;
 const cachesApi=storage.api;
 const options={cachesApi,fetcher:async()=>{calls++;return new Response(bytes);}},base='https://test.invalid/world/';
 const values=await Promise.all([fetchCompactResource(base,ref,options),fetchCompactResource(base,ref,options)]);assert.deepEqual(new Uint8Array(values[0]),bytes);assert.equal(calls,1);
 await fetchCompactResource(base,ref,options);assert.equal(calls,1);
 entries.set(compactResourceCacheKey(ref),new Response('corrupt'));await fetchCompactResource(base,ref,options);assert.equal(calls,2);
 await assert.rejects(fetchCompactResource('https://broken.invalid/world/',ref,{fetcher:async()=>new Response('wrong')}),/integrity/);
});
