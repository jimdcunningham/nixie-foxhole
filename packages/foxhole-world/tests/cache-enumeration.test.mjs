import test from 'node:test';
import assert from 'node:assert/strict';
import {createCacheEnumeration,trackedCacheSummary,freshCacheSummary} from '../runtime/cache-enumeration.mjs';
import {openRetainedWorldCache} from '../runtime/cache-retention.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
const name='foxhole-world-compact-v1',summaryKey='https://foxhole-world-cache.invalid/'+name+'/_summary';

function fixture({blocked=false,fail=false,locks}={}){
 let time=0,shared=0,summary={bytes:2,count:2,verifiedAt:0,accountedAt:0,accountingVersion:2,revision:'seed'},held=false,tail=Promise.resolve(),release,entered;
 const keys=new Set(['a','b']),gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),timers=[];let scans=0,reports=0;
 const read=async()=>structuredClone(summary),write=async s=>{summary=structuredClone(s);};
 const mutate=fn=>{const p=tail.then(async()=>{held=true;try{return await fn();}finally{held=false;}});tail=p.catch(()=>{});return p;};
 const helper=createCacheEnumeration({name,now:()=>time,recheck:30000,locks,mutate,readSummary:read,writeSummary:write,
  readActivity:async()=>shared,writeActivity:async t=>{shared=t;reports++;},setTimer:(fn,delay)=>{timers.push({fn,delay});return{unref(){}};},
  body:{keys:async()=>{scans++;assert.equal(held,false);const snapshot=[...keys];entered();if(blocked)await gate;if(fail)throw Error('disk failed');return snapshot.map(url=>({url}));}}});
 return {helper,read,write,mutate,keys,release,started,timers,get scans(){return scans;},get reports(){return reports;},time:t=>{time=t;},shared:t=>{shared=t;}};
}

test('local activity defers enumeration until idle',async()=>{const f=fixture();f.helper.activity();f.time(29999);assert.equal(await f.helper.verify(),false);assert.equal(f.scans,0);f.time(30000);assert.equal(await f.helper.verify(),true);assert.equal(f.scans,1);assert.equal((await f.read()).verifiedAt,30000);assert.ok(freshCacheSummary(await f.read(),30000,30000));});
test('activity in another context also defers enumeration',async()=>{const f=fixture();f.time(30000);f.shared(29000);assert.equal(await f.helper.verify(),false);assert.equal(f.scans,0);f.time(60000);assert.equal(await f.helper.verify(),true);});
test('an idle scan does not block a resumed writer or overwrite its newer revision',async()=>{const f=fixture({blocked:true});f.time(30000);const work=f.helper.verify();await f.started;let timer;try{await Promise.race([f.mutate(()=>f.write(trackedCacheSummary(null,{bytes:3,count:3,verifiedAt:0},[],{time:30000,token:'new'}))),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('writer blocked')),1000))]);}finally{clearTimeout(timer);f.release();}await work;assert.equal((await f.read()).revision,'new');assert.equal((await f.read()).verifiedAt,0);});
test('untracked external entries do not validate incorrect totals',async()=>{const f=fixture();f.keys.add('external');f.time(30000);await f.helper.verify();assert.equal(await f.read(),null);});
test('failed enumeration leaves existing accounting untouched',async()=>{const f=fixture({fail:true});f.time(30000);await assert.rejects(f.helper.verify(),/disk failed/);assert.equal((await f.read()).revision,'seed');assert.equal((await f.read()).verifiedAt,0);});
test('activity reporting is throttled and idle timers are coalesced',async()=>{const f=fixture();for(let i=0;i<10;i++)f.helper.activity();await new Promise(setImmediate);assert.equal(f.reports,1);assert.equal(f.timers.length,1);assert.equal(f.timers[0].delay,30000);f.time(1000);f.helper.activity();await new Promise(setImmediate);assert.equal(f.reports,2);assert.equal(f.timers.length,1);});
test('accounting lock coalesces idle scans from multiple contexts',async()=>{let active=false;const locks={request:async(name,options,fn)=>{if(active)return fn(null);active=true;try{return await fn({name});}finally{active=false;}}};const a=fixture({locks,blocked:true}),b=fixture({locks});a.time(30000);b.time(30000);const work=a.helper.verify();await a.started;await b.helper.verify();assert.equal(b.scans,0);a.release();await work;});

test('continuous crash-safe writes keep exact totals without foreground enumeration',async()=>{
 const storage=memoryWorldCaches();let now=100000,scans=0;const api={open:async n=>{const c=await storage.api.open(n);return n===name?{...c,keys:async()=>{scans++;return c.keys();}}:c;}};
 const cache=await openRetainedWorldCache(name,{cachesApi:api,now:()=>now});await cache.put('https://fixture.test/seed',new Response('x'));const initial=scans;
 for(let i=0;i<90;i++){now+=1000;await cache.put('https://fixture.test/'+i,new Response('x'));}
 assert.equal(scans,initial);const summary=await storage.rows('foxhole-world-cache-usage-v1').get(summaryKey).clone().json();assert.equal(summary.bytes,91);assert.equal(summary.count,91);assert.equal(summary.accountedAt,now);
 // Old writers do not carry the crash-safe accounting marker: reconcile them.
 storage.rows('foxhole-world-cache-usage-v1').set(summaryKey,new Response(JSON.stringify({bytes:91,count:91,verifiedAt:100000})));
 await cache.put('https://fixture.test/legacy',new Response('x'));assert.equal(scans,initial+1);
});
test('a failed single write invalidates totals before touching the body',async()=>{
 const storage=memoryWorldCaches(),api={open:async n=>{const c=await storage.api.open(n);return n===name?{...c,put:async(k,v)=>{if(k.endsWith('/bad'))throw Error('disk failed');return c.put(k,v);}}:c;}};
 const cache=await openRetainedWorldCache(name,{cachesApi:api});await cache.put('https://fixture.test/seed',new Response('x'));await assert.rejects(cache.put('https://fixture.test/bad',new Response('x')),/disk failed/);assert.equal(storage.rows('foxhole-world-cache-usage-v1').has(summaryKey),false);
 await cache.put('https://fixture.test/okay',new Response('x'));const summary=await storage.rows('foxhole-world-cache-usage-v1').get(summaryKey).clone().json();assert.equal(summary.count,2);assert.equal(summary.bytes,2);
});

test('activity resuming during an idle scan schedules the next idle check',async()=>{
 const f=fixture({blocked:true});f.helper.activity();await new Promise(setImmediate);f.time(30000);f.timers[0].fn();await f.started;
 f.time(31000);f.helper.activity();f.release();await new Promise(setImmediate);await new Promise(setImmediate);assert.equal(f.timers.length,2);assert.equal(f.timers[1].delay,30000);
});