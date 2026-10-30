import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldCacheLease,openRetainedWorldCache} from '../runtime/cache-retention.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';

const name='world-lease-test',a='https://fixture.test/a',b='https://fixture.test/b',c='https://fixture.test/c';
function gatedStorage(){
 const memory=memoryWorldCaches();let signal,release;
 const started=new Promise(resolve=>{signal=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const api={open:async name=>{const cache=await memory.api.open(name);return name!=='foxhole-world-cache-usage-v1'?cache:{...cache,match:async key=>{signal();await gate;return cache.match(key);}};}};
 return {memory,api,started,release};
}
test('duplicate and overlapping callers await registration of their shared keys',async()=>{
 const f=gatedStorage(),lease=createWorldCacheLease({cachesApi:f.api});let firstDone=false,duplicateDone=false,overlapDone=false;
 const first=lease.use(name,[a,b]).then(()=>{firstDone=true;});await f.started;
 const duplicate=lease.use(name,[a]).then(()=>{duplicateDone=true;});
 const overlap=lease.use(name,[b,c]).then(()=>{overlapDone=true;});
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(firstDone,false);assert.equal(duplicateDone,false,'shared key must not resolve before its registration');assert.equal(overlapDone,false);
  f.release();await Promise.all([first,duplicate,overlap]);assert.equal(f.memory.rows('foxhole-world-cache-usage-v1').size,3);
  const cache=await openRetainedWorldCache(name,{cachesApi:f.api,budget:3});assert.equal(await cache.put(a,new Response('a')),true);assert.equal(await cache.put(b,new Response('b')),true);assert.equal(await cache.put(c,new Response('c')),true);
  assert.equal(await cache.put('https://fixture.test/other',new Response('x')),false,'all registered assets remain protected under pressure');
 }finally{f.release();await Promise.all([first,duplicate,overlap]);lease.dispose();}
});
test('disposing a lease does not resolve already-waiting callers early or start new work',async()=>{
 const f=gatedStorage(),lease=createWorldCacheLease({cachesApi:f.api});let finished=0;
 const first=lease.use(name,a).then(()=>{finished++;});await f.started;
 const duplicate=lease.use(name,a).then(()=>{finished++;});lease.dispose();await lease.use(name,c);
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,0);assert.equal(f.memory.rows('foxhole-world-cache-usage-v1').size,0);
  f.release();await Promise.all([first,duplicate]);assert.equal(finished,2);assert.equal(f.memory.rows('foxhole-world-cache-usage-v1').size,1);
  await lease.flush();assert.equal(f.memory.rows('foxhole-world-cache-usage-v1').size,1);
 }finally{f.release();await Promise.all([first,duplicate]);lease.dispose();}
});
test('failed metadata storage remains a nonfatal offline fallback for overlapping callers',async()=>{
 const api={open:async()=>{throw Error('unavailable');}},lease=createWorldCacheLease({cachesApi:api});
 try{await Promise.all([lease.use(name,a),lease.use(name,a)]);}finally{lease.dispose();}
});
