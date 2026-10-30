import test from 'node:test';
import assert from 'node:assert/strict';
import {openRetainedWorldCache} from '../runtime/cache-retention.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
const name='foxhole-world-compact-v1',key='https://fixture.test/missing';
function fakeLocks(){const calls=[],previous=Object.getOwnPropertyDescriptor(navigator,'locks');Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name,options,fn)=>{if(typeof options==='function'){fn=options;options={mode:'exclusive'};}calls.push({name,mode:options.mode||'exclusive'});return fn({name});}}});return {calls,restore(){if(previous)Object.defineProperty(navigator,'locks',previous);else delete navigator.locks;}};}

test('a shared cache miss avoids metadata reads and an exclusive retry',async()=>{
 const locks=fakeLocks();try{
  const storage=memoryWorldCaches(),cache=await openRetainedWorldCache(name,{cachesApi:storage.api});
  assert.equal(await cache.match(key),undefined);
  assert.deepEqual(locks.calls.filter(r=>r.name===name).map(r=>r.mode),['shared']);
  assert.equal(storage.reads.filter(r=>r.name===name).length,1);
  assert.equal(storage.reads.filter(r=>r.name==='foxhole-world-cache-usage-v1').length,0);
 }finally{locks.restore();}
});

test('shared hits still inspect retention metadata and renew expired leases exclusively',async()=>{
 const locks=fakeLocks();try{
  const storage=memoryWorldCaches();let now=100*86400000;
  const cache=await openRetainedWorldCache(name,{cachesApi:storage.api,now:()=>now});
  await cache.put(key,new Response('resident'));locks.calls.length=0;storage.reads.length=0;
  assert.equal(await (await cache.match(key)).text(),'resident');
  assert.deepEqual(locks.calls.filter(r=>r.name===name).map(r=>r.mode),['shared']);
  assert.equal(storage.reads.filter(r=>r.name==='foxhole-world-cache-usage-v1').length,1);
  now+=3600000;locks.calls.length=0;
  assert.equal(await (await cache.match(key)).text(),'resident');
  assert.deepEqual(locks.calls.filter(r=>r.name===name).map(r=>r.mode),['shared','exclusive']);
 }finally{locks.restore();}
});