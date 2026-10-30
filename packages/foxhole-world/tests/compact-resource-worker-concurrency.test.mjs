import {memoryWorldCaches} from './cache-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

test('concurrent same-content worker responses each own their transferred bytes', async () => {
 const bytes = new Uint8Array(4097);
 for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 41 + (i >>> 3)) & 255;
 const hash = createHash('sha256').update(bytes).digest('hex');
 const refs = ['png','webp','bin'].map(ext => ({path:`content/raw/${hash}/asset.${ext}`,hash,decodedHash:hash,encoding:'raw',bytes:bytes.length}));
 const previous = {self:globalThis.self,fetch:globalThis.fetch,caches:globalThis.caches};
 let release, started, fetches = 0;
 const gate = new Promise(resolve => { release = resolve; });
 const began = new Promise(resolve => { started = resolve; });
 const replies = [];
 globalThis.caches = memoryWorldCaches().api;
 globalThis.fetch = async () => {fetches++;started();await gate;return new Response(bytes);};
 globalThis.self = {postMessage(data,transfer=[]) { replies.push(structuredClone(data,{transfer})); }};
 try {
  await import('../runtime/resource-worker.mjs');
  const requests = refs.map((ref,id) => self.onmessage({data:{id:id+1,baseUrl:'https://worker.test/world/',ref}}));
  await began;release();await Promise.all(requests);
  assert.equal(fetches,1,'same-content requests should share the network operation');
  assert.equal(replies.filter(reply => reply.kind === 'foxhole-worker-ready').length,1);
  for (let id = 1; id <= refs.length; id++) {
   const reply = replies.find(value => value.id === id);
   assert.ok(reply);assert.equal(reply.error,undefined);
   assert.deepEqual(new Uint8Array(reply.result),bytes);
  }
 } finally {
  release();globalThis.self=previous.self;globalThis.fetch=previous.fetch;globalThis.caches=previous.caches;
 }
});
