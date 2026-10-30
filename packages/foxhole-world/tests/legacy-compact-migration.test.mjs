import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {memoryWorldCaches} from './cache-fixture.mjs';
import {fetchCompactResource,compactResourceCacheKey} from '../runtime/compact-cache.mjs';
import {openRetainedWorldCache} from '../runtime/cache-retention.mjs';

const name='foxhole-world-compact-v1', base='https://legacy.fixture/world/', usage='foxhole-world-cache-usage-v1';
const summaryKey='https://foxhole-world-cache.invalid/'+name+'/_summary';
function resource(text) {
 const bytes=new TextEncoder().encode(text), hash=createHash('sha256').update(bytes).digest('hex');
 return {text,ref:{path:`content/raw/${hash}/asset.bin`,hash,decodedHash:hash,bytes:bytes.length}};
}
function fixture({failWrite=false,failDelete=false}={}) {
 const memory=memoryWorldCaches();let enumerations=0;
 const api={open:async n=>{
  const c=await memory.api.open(n);
  if(n!==name)return c;
  return {...c,keys:async()=>{enumerations++;return c.keys();},
   put:async(key,response)=>{if(failWrite&&String(key).includes('foxhole-world-resource.invalid'))throw Error('simulated failed write');return c.put(key,response);},
   delete:async key=>{if(failDelete&&String(key).startsWith(base))throw Error('simulated failed deletion');return c.delete(key);}};
 }};
 return {memory,api,get enumerations(){return enumerations;},seed({text,ref},size=text.length){
  memory.rows(name).set(new URL(ref.path,base).href,new Response(text,{headers:{'X-Foxhole-Cached-Bytes':String(size)}}));
 }};
}
async function read(f,{text,ref}) {
 const result=await fetchCompactResource(base,ref,{cachesApi:f.api,fetcher:()=>{throw Error('unexpected network');}});
 assert.equal(new TextDecoder().decode(result),text);
}
test('legacy migrations reconcile once and preserve exact totals without network access',async()=>{
 const f=fixture(), refs=['first bytes','second bytes','third bytes'].map(resource);
 for(const item of refs)f.seed(item);
 for(const item of refs)await read(f,item);
 assert.equal(f.enumerations,1,'subsequent migrations should not rescan the full cache');
 assert.equal(f.memory.rows(name).size,refs.length);
 for(const {ref} of refs){assert.ok(f.memory.rows(name).has(compactResourceCacheKey(ref)));assert.ok(!f.memory.rows(name).has(new URL(ref.path,base).href));}
 const sum=await f.memory.rows(usage).get(summaryKey).json();
 assert.equal(sum.count,refs.length);assert.equal(sum.bytes,refs.reduce((n,row)=>n+row.ref.bytes,0));
});
test('a migration that cannot fit under the cache budget keeps the original',async()=>{
 const f=fixture(),item=resource('protected legacy');f.seed(item,1024**3);
 const cache=await openRetainedWorldCache(name,{cachesApi:f.api});const url=new URL(item.ref.path,base).href;
 await cache.touch([url]);
 await read(f,item);
 assert.ok(f.memory.rows(name).has(url),'budget rejection must not discard the original');
 assert.ok(!f.memory.rows(name).has(compactResourceCacheKey(item.ref)));
});
test('migration write failure keeps the legacy body and returns verified bytes',async()=>{
 const f=fixture({failWrite:true}),item=resource('legacy write failure');f.seed(item);
 await read(f,item);
 assert.ok(f.memory.rows(name).has(new URL(item.ref.path,base).href));
 assert.ok(!f.memory.rows(name).has(compactResourceCacheKey(item.ref)));
});
test('migration deletion failure keeps the legacy body and does not preserve a stale summary',async()=>{
 const f=fixture({failDelete:true}),item=resource('legacy delete failure');f.seed(item);
 await read(f,item);
 assert.ok(f.memory.rows(name).has(new URL(item.ref.path,base).href));
 assert.ok(f.memory.rows(name).has(compactResourceCacheKey(item.ref)));
 assert.ok(!f.memory.rows(usage).has(summaryKey));
});
test('corrupt or expired totals are invalidated and rescanned after deletion',async()=>{
 const cases=[new Response('{bad'),new Response(JSON.stringify({bytes:-1,count:2,verifiedAt:100000})),
  new Response(JSON.stringify({bytes:2,count:2,verifiedAt:0}))];
 for(const corrupt of cases){
  const f=fixture();let now=100000;
  const cache=await openRetainedWorldCache(name,{cachesApi:f.api,now:()=>now});
  const a='https://fixture/a',b='https://fixture/b',c='https://fixture/c';
  await cache.put(a,new Response('a'));await cache.put(b,new Response('b'));
  f.memory.rows(usage).set(summaryKey,corrupt);
  const before=f.enumerations;
  assert.equal(await cache.delete(a),true);
  assert.ok(!f.memory.rows(usage).has(summaryKey));
  assert.equal(await cache.put(c,new Response('c')),true);
  assert.equal(f.enumerations,before+1);
  const sum=await f.memory.rows(usage).get(summaryKey).json();
  assert.equal(sum.bytes,2);assert.equal(sum.count,2);
 }
});


test('concurrent stale removals update a shared total without lost deletes',async()=>{
 const f=fixture(),a='https://fixture.test/stale/a',b='https://fixture.test/stale/b',time=100*86400000;
 f.memory.rows(name).set(a,new Response('a',{headers:{'X-Foxhole-Cached-Bytes':'1'}}));
 f.memory.rows(name).set(b,new Response('b',{headers:{'X-Foxhole-Cached-Bytes':'1'}}));
 const metadata=f.memory.rows(usage);
 const metaKey=key=>'https://foxhole-world-cache.invalid/'+name+'/'+encodeURIComponent(key);
 for(const key of [a,b])metadata.set(metaKey(key),new Response(JSON.stringify({lastUsedAt:time-32*86400000,activeUntil:0})));
 metadata.set(summaryKey,new Response(JSON.stringify({bytes:2,count:2,verifiedAt:time})));
 let release,started;const gate=new Promise(resolve=>{release=resolve}),began=new Promise(resolve=>{started=resolve});
 const api={open:async n=>{const cache=await f.api.open(n);if(n!==usage)return cache;return {...cache,match:async key=>{
  const result=await cache.match(key);
  if(String(key)===summaryKey){started();await gate;}
  return result;
 }};}};
 const cache=await openRetainedWorldCache(name,{cachesApi:api,now:()=>time});
 const pending=cache.touch([a,b]);
 try{await began;await new Promise(resolve=>setTimeout(resolve,20));}finally{release();}
 await pending;
 assert.equal(f.memory.rows(name).size,0);
 const summary=await metadata.get(summaryKey).json();
 assert.equal(summary.count,0);assert.equal(summary.bytes,0);
});
test('legacy summary without verifiedAt is invalidated before a delete',async()=>{
 const f=fixture(),a='https://fixture/a',b='https://fixture/b',cache=await openRetainedWorldCache(name,{cachesApi:f.api});
 await cache.put(a,new Response('a'));f.memory.rows(usage).set(summaryKey,new Response(JSON.stringify({bytes:1,count:1})));
 const before=f.enumerations;await cache.delete(a);await cache.put(b,new Response('b'));
 assert.equal(f.enumerations,before+1);
});


test('deletion accounts zero and malformed cached byte headers like a full scan',async()=>{
 for(const header of ['0','not-a-number']){
  const f=fixture(),a='https://fixture/header/a',b='https://fixture/header/b',c='https://fixture/header/c';
  f.memory.rows(name).set(a,new Response('abc',{headers:{'X-Foxhole-Cached-Bytes':header}}));
  const cache=await openRetainedWorldCache(name,{cachesApi:f.api});
  await cache.put(b,new Response('b'));
  assert.equal((await f.memory.rows(usage).get(summaryKey).clone().json()).bytes,4);
  await cache.delete(a);await cache.put(c,new Response('c'));
  const summary=await f.memory.rows(usage).get(summaryKey).json();
  assert.equal(summary.bytes,2);assert.equal(summary.count,2);
 }
});


test('negative cached byte headers invalidate totals before deletion',async()=>{
 const f=fixture(),a='https://fixture/negative/a',b='https://fixture/negative/b',c='https://fixture/negative/c';
 f.memory.rows(name).set(a,new Response('abc',{headers:{'X-Foxhole-Cached-Bytes':'-1'}}));
 const cache=await openRetainedWorldCache(name,{cachesApi:f.api});
 await cache.put(b,new Response('x'.repeat(100)));
 assert.equal((await f.memory.rows(usage).get(summaryKey).clone().json()).bytes,99);
 await cache.delete(a);assert.ok(!f.memory.rows(usage).has(summaryKey));
 await cache.put(c,new Response('c'));
 const summary=await f.memory.rows(usage).get(summaryKey).json();
 assert.equal(summary.bytes,101);assert.equal(summary.count,2);
});


test('fractional cached byte headers invalidate totals even if their sum is integral',async()=>{
 const f=fixture(),a='https://fixture/fraction/a',b='https://fixture/fraction/b',c='https://fixture/fraction/c';
 for(const key of [a,b])f.memory.rows(name).set(key,new Response('abc',{headers:{'X-Foxhole-Cached-Bytes':'0.5'}}));
 const cache=await openRetainedWorldCache(name,{cachesApi:f.api});
 await cache.put(c,new Response('x'.repeat(100)));
 assert.equal((await f.memory.rows(usage).get(summaryKey).clone().json()).bytes,101);
 await cache.delete(a);assert.ok(!f.memory.rows(usage).has(summaryKey));
});


test('failed summary invalidation leaves the legacy body and valid total intact',async()=>{
 const f=fixture(),item=resource('summary delete fails');f.seed(item);
 const broken={open:async n=>{const cache=await f.api.open(n);if(n!==usage)return cache;return {...cache,delete:async key=>{
  if(String(key)===summaryKey&&f.memory.rows(name).has(compactResourceCacheKey(item.ref)))throw Error('simulated metadata delete failure');
  return cache.delete(key);
 }};}};
 const result=await fetchCompactResource(base,item.ref,{cachesApi:broken,fetcher:()=>{throw Error('unexpected network');}});
 assert.equal(new TextDecoder().decode(result),item.text);
 assert.ok(f.memory.rows(name).has(new URL(item.ref.path,base).href),'cannot delete a body without invalidating accounting first');
 assert.ok(f.memory.rows(name).has(compactResourceCacheKey(item.ref)));
 const summary=await f.memory.rows(usage).get(summaryKey).json();
 assert.equal(summary.count,2);assert.equal(summary.bytes,item.ref.bytes*2);
});


test('failed pre-write summary invalidation preserves the original without creating a compact body',async()=>{
 const f=fixture(),item=resource('pre-write invalidation fails');f.seed(item);
 const original={bytes:item.ref.bytes,count:1,verifiedAt:Date.now()};
 f.memory.rows(usage).set(summaryKey,new Response(JSON.stringify(original)));
 const broken={open:async n=>{const cache=await f.api.open(n);if(n!==usage)return cache;return {...cache,delete:async key=>{
  if(String(key)===summaryKey)throw Error('simulated metadata delete failure');
  return cache.delete(key);
 }};}};
 await read({...f,api:broken},item);
 assert.ok(f.memory.rows(name).has(new URL(item.ref.path,base).href));
 assert.ok(!f.memory.rows(name).has(compactResourceCacheKey(item.ref)));
 assert.deepEqual(await f.memory.rows(usage).get(summaryKey).json(),original);
});
