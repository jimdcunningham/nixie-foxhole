import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchCompactResource} from '../runtime/compact-cache.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
const cache={open:async()=>{throw Error('no cache');}};
const payload=new TextEncoder().encode('waiter-safe cancellation');
const hash=createHash('sha256').update(payload).digest('hex');
const ref={path:`content/raw/${hash}/asset.png`,hash,decodedHash:hash,bytes:payload.length,encoding:'raw'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(fn){for(let i=0;i<100&&!fn();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(fn(),'expected controlled operation to start');}
test('last waiter aborts the producer and waits for an ignoring fetcher to drain',async()=>{
 const gate=deferred(),controller=new AbortController(),calls=[];
 const pending=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,signal:controller.signal,fetcher:(...args)=>{calls.push(args);return gate.promise;}});
 const outcome=pending.then(()=>null,e=>e);await until(()=>calls.length===1);controller.abort();await until(()=>calls[0][1].signal.aborted);let settled=false;void outcome.then(()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);gate.resolve(new Response(payload));assert.equal((await outcome).name,'AbortError');
});
test('one aborted waiter leaves a second shared waiter and producer alive',async()=>{
 const gate=deferred(),controller=new AbortController(),calls=[];
 const fetcher=(...args)=>{calls.push(args);return gate.promise;};
 const first=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,signal:controller.signal,fetcher}).then(()=>null,e=>e);
 const second=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,fetcher});await until(()=>calls.length===1);controller.abort();
 assert.equal((await first).name,'AbortError');assert.equal(calls[0][1].signal.aborted,false);gate.resolve(new Response(payload));
 assert.deepEqual(new Uint8Array(await second),payload);assert.equal(calls.length,1);
});
test('an abandoned producer finishing late cannot remove or populate its retry',async()=>{
 const firstGate=deferred(),secondGate=deferred(),controller=new AbortController(),calls=[];
 const fetcher=(...args)=>{calls.push(args);return calls.length===1?firstGate.promise:secondGate.promise;};
 const abandoned=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,signal:controller.signal,fetcher}).then(()=>null,e=>e);
 await until(()=>calls.length===1);controller.abort();await until(()=>calls[0][1].signal.aborted);
 const retry=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,fetcher});await until(()=>calls.length===2);
 firstGate.resolve(new Response(payload));assert.equal((await abandoned).name,'AbortError');for(let i=0;i<20;i++)await Promise.resolve();
 const join=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,fetcher});for(let i=0;i<20;i++)await Promise.resolve();assert.equal(calls.length,2);
 secondGate.resolve(new Response(payload));const [a,b]=await Promise.all([retry,join]);assert.deepEqual(new Uint8Array(a),payload);assert.deepEqual(new Uint8Array(b),payload);assert.notEqual(a,b);
});
test('an arbitrary explicit abort reason is preserved',async()=>{
 const gate=deferred(),controller=new AbortController(),reason=new Error('retired');let started=false;
 const pending=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,signal:controller.signal,fetcher:()=>{started=true;return gate.promise;}}).then(()=>null,e=>e);
 await until(()=>started);controller.abort(reason);gate.resolve(new Response(payload));assert.equal(await pending,reason);
});
test('late response from an ignoring fetcher has its unread stream canceled',async()=>{
 const gate=deferred(),controller=new AbortController();let started=false,canceled=false;
 const pending=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,signal:controller.signal,fetcher:()=>{started=true;return gate.promise;}}).then(()=>null,e=>e);
 await until(()=>started);controller.abort();gate.resolve(new Response(new ReadableStream({cancel(){canceled=true;}})));assert.equal((await pending).name,'AbortError');await until(()=>canceled);
});
test('aborting during legacy migration preserves the old URL-keyed body',async()=>{
 const storage=memoryWorldCaches(),base='https://world.test/',url=new URL(ref.path,base).href,gate=deferred(),controller=new AbortController();let started=false;
 storage.rows('foxhole-world-compact-v1').set(url,new Response(payload));const open=storage.api.open;
 storage.api.open=async name=>{const existing=await open(name);if(name==='foxhole-world-compact-v1'){const put=existing.put;existing.put=async(key,value)=>{if(typeof key==='string'&&key.startsWith('https://foxhole-world-resource.invalid/')){started=true;await gate.promise;}return put(key,value);};}return existing;};
 const pending=fetchCompactResource(base,ref,{cachesApi:storage.api,signal:controller.signal,fetcher:()=>{throw Error('unexpected network');}}).then(()=>null,e=>e);
 await until(()=>started);controller.abort();assert.equal(storage.rows('foxhole-world-compact-v1').has(url),true);gate.resolve();assert.equal((await pending).name,'AbortError');assert.equal(storage.rows('foxhole-world-compact-v1').has(url),true);
});
test('identical callbacks remain independent when one subscriber aborts',async()=>{
 const gate=deferred(),controller=new AbortController();let started=false,observations=0;const onNetwork=()=>{observations++;},fetcher=()=>{started=true;return gate.promise;};
 const first=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,signal:controller.signal,fetcher,onNetwork}).then(()=>null,e=>e);
 const second=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,fetcher,onNetwork});await until(()=>started);controller.abort();assert.equal((await first).name,'AbortError');gate.resolve(new Response(payload));await second;assert.equal(observations,1);
});
test('abort during a primary cache miss does not begin the legacy URL lookup',async()=>{
 const storage=memoryWorldCaches(),base='https://world.test/',gate=deferred(),controller=new AbortController();let started=false;
 const open=storage.api.open;storage.api.open=async name=>{const existing=await open(name);if(name==='foxhole-world-compact-v1'){const match=existing.match;existing.match=async key=>{if(typeof key==='string'&&key.startsWith('https://foxhole-world-resource.invalid/')){started=true;await gate.promise;}return match(key);};}return existing;};
 const pending=fetchCompactResource(base,ref,{cachesApi:storage.api,signal:controller.signal,fetcher:()=>{throw Error('unexpected network');}}).then(()=>null,e=>e);
 await until(()=>started);controller.abort();gate.resolve();assert.equal((await pending).name,'AbortError');const url=new URL(ref.path,base).href;assert.equal(storage.reads.some(x=>x.name==='foxhole-world-compact-v1'&&x.key===url),false);
});

test('last canceled waiter drains an abort-ignoring response stream before settling',async()=>{
 const gate=deferred(),controller=new AbortController();let started=false,transport,settled=false;
 const fetcher=(_url,options)=>{transport=options.signal;return new Response(new ReadableStream({async pull(stream){started=true;await gate.promise;stream.enqueue(payload);stream.close();}}));};
 const pending=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,signal:controller.signal,fetcher}).then(()=>null,e=>e);void pending.then(()=>{settled=true;});
 await until(()=>started);controller.abort();await until(()=>transport.aborted);await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);gate.resolve();assert.equal((await pending).name,'AbortError');
});


test('last aborted waiter waits for asynchronous late-response cancellation',async()=>{
 const fetchGate=deferred(),cancelGate=deferred(),controller=new AbortController();let started=false,cancelStarted=false,settled=false;
 const pending=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,signal:controller.signal,fetcher:()=>{started=true;return fetchGate.promise;}}).then(()=>null,e=>e);void pending.then(()=>{settled=true;});
 await until(()=>started);controller.abort();fetchGate.resolve(new Response(new ReadableStream({cancel(){cancelStarted=true;return cancelGate.promise;}})));
 await until(()=>cancelStarted);await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);cancelGate.resolve();assert.equal((await pending).name,'AbortError');
});
test('failed asynchronous body cancellation preserves the abort reason',async()=>{
 const gate=deferred(),controller=new AbortController();let started=false;
 const pending=fetchCompactResource('https://world.test/',ref,{cachesApi:cache,signal:controller.signal,fetcher:()=>{started=true;return gate.promise;}}).then(()=>null,e=>e);
 await until(()=>started);controller.abort();gate.resolve(new Response(new ReadableStream({cancel(){return Promise.reject(Error('close failed'));}})));assert.equal((await pending).name,'AbortError');
});
