import {memoryWorldCaches} from './cache-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchCompactResource} from '../runtime/compact-cache.mjs';

function fixture(label) {
 const bytes=new TextEncoder().encode(label),hash=createHash('sha256').update(bytes).digest('hex');
 return {bytes,ref:{path:`content/raw/${hash}/asset.bin`,hash,decodedHash:hash,encoding:'raw',bytes:bytes.length}};
}

test('an aborted concurrent waiter does not detach or prevent the other result',async()=>{
 const {bytes,ref}=fixture('aborted concurrent waiter');const storage=memoryWorldCaches(),controller=new AbortController();
 let release,started,calls=0;const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 const opts={cachesApi:storage.api,fetcher:async()=>{calls++;started();await gate;return new Response(bytes);}},base='https://aborted-waiter.test/world/';
 const abandoned=fetchCompactResource(base,ref,{...opts,signal:controller.signal}),remaining=fetchCompactResource(base,ref,opts);
 const outcomes=Promise.allSettled([abandoned,remaining]);
 try{
  await began;controller.abort();release();const [first,second]=await outcomes;
  assert.equal(first.status,'rejected');assert.equal(first.reason.name,'AbortError');assert.equal(second.status,'fulfilled');
  const transferred=structuredClone(second.value,{transfer:[second.value]});assert.deepEqual(new Uint8Array(transferred),bytes);assert.equal(calls,1);
 }finally{release();await outcomes;}
});

test('a failed shared in-flight request is removed and a later retry succeeds',async()=>{
 const {bytes,ref}=fixture('failed shared request then retry');const storage=memoryWorldCaches();
 let release,started,calls=0;const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 const opts={cachesApi:storage.api,fetcher:async()=>{calls++;if(calls===1){started();await gate;throw Error('offline');}return new Response(bytes);}},base='https://retry-waiter.test/world/';
 const outcomes=Promise.allSettled([fetchCompactResource(base,ref,opts),fetchCompactResource(base,ref,opts)]);
 try{
  await began;release();const failures=await outcomes;assert.equal(failures[0].status,'rejected');assert.equal(failures[1].status,'rejected');assert.equal(calls,1);
  const retried=await fetchCompactResource(base,ref,opts);assert.deepEqual(new Uint8Array(retried),bytes);assert.equal(calls,2);
 }finally{release();await outcomes;}
});
