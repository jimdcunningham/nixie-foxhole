import {memoryWorldCaches} from './cache-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchCompactResource} from '../runtime/compact-cache.mjs';

test('compact cache drains compression before transferring and preserves warm bytes', async () => {
 const bytes = new Uint8Array(1024 * 1024 + 23);
 for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 41 + (i >>> 8)) & 255;
 const hash = createHash('sha256').update(bytes).digest('hex');
 const ref = {path:`content/br/${hash}/asset.bin`,hash,decodedHash:hash,encoding:'br',bytes:bytes.length};
 const storage = memoryWorldCaches(), metrics = {cacheHits:0,cacheMisses:0,cacheWriteFailures:0,downloadBytes:0}, base = 'https://compact-stream.test/world/';
 let fetches = 0, release, started, settled = false;
 const gate = new Promise(resolve => { release = resolve; });
 const began = new Promise(resolve => { started = resolve; });
 const original = globalThis.CompressionStream;
 globalThis.CompressionStream = class {
  constructor(format) {
   const wait = new TransformStream({async transform(chunk, controller) { started(); await gate; controller.enqueue(chunk); }});
   const compressor = new original(format);
   return {writable:wait.writable,readable:wait.readable.pipeThrough(compressor)};
  }
 };
 const options = {cachesApi:storage.api,metrics,fetcher:async()=>{fetches++;return new Response(bytes);}};
 const pending = fetchCompactResource(base,ref,options);
 void pending.then(()=>{settled=true;},()=>{settled=true;});
 try {
  await began; await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled,false,'the caller must not transfer bytes while compression still reads them');
  release();
  const result = await pending;
  assert.deepEqual(new Uint8Array(result),bytes);
  const transferred = structuredClone(result,{transfer:[result]});
  assert.equal(result.byteLength,0);
  assert.deepEqual(new Uint8Array(transferred),bytes);
  const warm = await fetchCompactResource(base,ref,options);
  assert.deepEqual(new Uint8Array(warm),bytes);
  assert.equal(fetches,1);
  assert.equal(metrics.cacheHits,1);
 } finally { release(); await pending.catch(()=>{}); globalThis.CompressionStream=original; }
});
