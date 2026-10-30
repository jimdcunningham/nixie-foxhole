import test from 'node:test';
import assert from 'node:assert/strict';
import {openRetainedWorldCache} from '../runtime/cache-retention.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
const name='foxhole-world-compact-v1',usage='foxhole-world-cache-usage-v1',key='https://fixture.test/batch/';
const summaryKey='https://foxhole-world-cache.invalid/'+name+'/_summary';

test('new entries write concurrently with one summary commit and retain active leases',async()=>{
 const storage=memoryWorldCaches();let armed=false,active=0,peak=0,release,entered;
 const gate=new Promise(r=>release=r),parallel=new Promise(r=>entered=r);
 const api={open:async n=>{const cache=await storage.api.open(n);return n!==name?cache:{...cache,put:async(k,v)=>{if(armed){peak=Math.max(peak,++active);if(active===2)entered();await gate;active--;}return cache.put(k,v);}};}};
 const cache=await openRetainedWorldCache(name,{cachesApi:api});await cache.put(key+'seed',new Response('x'));await cache.touch([key+'0']);
 const before=storage.writes.filter(r=>r.name===usage&&r.key===summaryKey).length;armed=true;
 const writes=Promise.all(Array.from({length:16},(_,i)=>cache.put(key+i,new Response('x'))));
 let timer;try{await Promise.race([parallel,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('writes serialized')),1000))]);assert.equal(storage.rows(usage).has(summaryKey),false,'incomplete batches invalidate the summary');}finally{clearTimeout(timer);release();}
 assert.ok((await writes).every(Boolean));assert.ok(peak>=2&&peak<=16);
 assert.equal(storage.writes.filter(r=>r.name===usage&&r.key===summaryKey).length-before,1);
 const summary=await storage.rows(usage).get(summaryKey).clone().json();assert.equal(summary.count,17);assert.equal(summary.bytes,17);
 const lease=await storage.rows(usage).get('https://foxhole-world-cache.invalid/'+name+'/'+encodeURIComponent(key+'0')).clone().json();assert.ok(lease.activeUntil>lease.lastUsedAt);
});

test('a partial failed batch leaves totals invalid and the next write reconciles actual bodies',async()=>{
 const storage=memoryWorldCaches();const api={open:async n=>{const cache=await storage.api.open(n);return n!==name?cache:{...cache,put:async(k,v)=>{if(k===key+'bad')throw Error('disk failure');return cache.put(k,v);}};}};
 const cache=await openRetainedWorldCache(name,{cachesApi:api,budget:8});await cache.put(key+'seed',new Response('xx'));
 const results=await Promise.allSettled(['a','bad','b'].map(id=>cache.put(key+id,new Response('xx'))));assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(storage.rows(usage).has(summaryKey),false);
 assert.equal(await cache.put(key+'after',new Response('xx')),true);const summary=await storage.rows(usage).get(summaryKey).clone().json();assert.equal(summary.count,4);assert.equal(summary.bytes,8);
});

test('budget pressure falls back to eviction accounting while protecting leased entries',async()=>{
 const storage=memoryWorldCaches(),cache=await openRetainedWorldCache(name,{cachesApi:storage.api,budget:4});await cache.put(key+'seed',new Response('xx'));await cache.touch([key+'seed']);
 const results=await Promise.all(['a','b','c'].map(id=>cache.put(key+id,new Response('xx'))));assert.ok(results.some(Boolean));assert.equal(storage.rows(name).size,2);assert.ok(storage.rows(name).has(key+'seed'));
 const summary=await storage.rows(usage).get(summaryKey).clone().json();assert.equal(summary.bytes,4);assert.equal(summary.count,2);
});

test('duplicate keys preserve replacement order and count one cached entry',async()=>{
 const storage=memoryWorldCaches(),cache=await openRetainedWorldCache(name,{cachesApi:storage.api});await cache.put(key,new Response('seed'));
 assert.deepEqual(await Promise.all([cache.put(key,new Response('first')),cache.put(key,new Response('last'))]),[true,true]);assert.equal(await (await cache.match(key)).text(),'last');
 const summary=await storage.rows(usage).get(summaryKey).clone().json();assert.equal(summary.count,1);assert.equal(summary.bytes,4);
});
test('batch recreation restores a remembered active lease removed in another context',async()=>{
 const storage=memoryWorldCaches(),cache=await openRetainedWorldCache(name,{cachesApi:storage.api});await cache.put(key+'seed',new Response('x'));await cache.touch([key+'a',key+'b']);
 const metadataKey='https://foxhole-world-cache.invalid/'+name+'/'+encodeURIComponent(key+'a');storage.rows(usage).delete(metadataKey);
 await Promise.all(['a','b'].map(id=>cache.put(key+id,new Response('x'))));
 const record=storage.rows(usage).get(metadataKey);assert.ok(record,'recreated bodies restore a remembered active lease');const lease=await record.clone().json();assert.ok(lease.activeUntil>lease.lastUsedAt);
});