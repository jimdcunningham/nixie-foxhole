import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {memoryWorldCaches} from './cache-fixture.mjs';
import {fetchCompactResource,compactResourceCacheKey} from '../runtime/compact-cache.mjs';

test('modern raw and gzip cache hits do not clone an unused response',async()=>{
 const memory=memoryWorldCaches();let clones=0,fetches=0;
 const api={open:async name=>{const cache=await memory.api.open(name);if(name!=='foxhole-world-compact-v1')return cache;
  return {...cache,match:async key=>{const result=await cache.match(key);if(result&&String(key).startsWith('https://foxhole-world-resource.invalid/')){
   const original=result.clone.bind(result);result.clone=()=>{clones++;return original();};}return result;}};
 }};
 for(const encoding of ['raw','br']){
  const bytes=new TextEncoder().encode('warm modern '+encoding),hash=createHash('sha256').update(bytes).digest('hex');
  const ref={path:`content/${encoding}/${hash}/asset.bin`,hash,decodedHash:hash,encoding,bytes:bytes.length};
  const response=encoding==='br'?new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),{headers:{'X-Foxhole-Compression':'gzip'}}):new Response(bytes);
  memory.rows('foxhole-world-compact-v1').set(compactResourceCacheKey(ref),response);
  const actual=await fetchCompactResource('https://modern-cache.test/world/',ref,{cachesApi:api,fetcher:async()=>{fetches++;throw Error('unexpected network');}});
  assert.deepEqual(new Uint8Array(actual),bytes);
 }
 assert.equal(fetches,0);assert.equal(clones,0);
});