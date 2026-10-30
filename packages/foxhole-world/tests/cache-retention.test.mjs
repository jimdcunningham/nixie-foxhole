import test from 'node:test';
import assert from 'node:assert/strict';
import {openRetainedWorldCache,createWorldCacheLease} from '../runtime/cache-retention.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
const DAY=86400000, HOUR=3600000, name='foxhole-world-compact-v1', key='https://fixture.test/content/a';

test('compressed world bodies expire after inactivity, hits renew use, and metadata never rewrites them',async()=>{
    const storage=memoryWorldCaches(); let time=DAY;
    const options={cachesApi:storage.api,now:()=>time}, cache=await openRetainedWorldCache(name,options);
    assert.equal(await cache.put(key,new Response('compressed bytes',{headers:{'X-Foxhole-Compression':'gzip'}})),true);
    const bodyWrites=()=>storage.writes.filter(row=>row.name===name).length;
    time+=29*DAY; assert.equal(await (await cache.match(key)).text(),'compressed bytes'); assert.equal(bodyWrites(),1);
    time+=29*DAY; await cache.cleanup(); assert.ok(await cache.match(key)); assert.equal(bodyWrites(),1);
    time+=30*DAY+HOUR; await cache.cleanup(); assert.equal(await cache.match(key),undefined);
});

test('mounted leases protect resident graph content for months and stop renewing on disposal',async()=>{
    const storage=memoryWorldCaches(); let time=DAY;
    const options={cachesApi:storage.api,now:()=>time,budget:8}, cache=await openRetainedWorldCache(name,options), lease=createWorldCacheLease(options);
    await cache.put(key,new Response('resident')); await lease.use(name,key);
    for(let day=0;day<61;day++){time+=DAY;await lease.flush();await cache.cleanup();}
    assert.ok(storage.rows(name).has(key));
    assert.equal(await cache.put(key+'-other',new Response('new data')),false,'capacity pressure protects renewed residents');
    lease.dispose(); time+=30*DAY+HOUR; await cache.cleanup(); assert.equal(storage.rows(name).has(key),false);
});

test('old or malformed timestamps get grace; pressure evicts least recently used unleased data',async()=>{
    const storage=memoryWorldCaches(); let time=100*DAY;
    storage.rows(name).set(key,new Response('old'));
    const cache=await openRetainedWorldCache(name,{cachesApi:storage.api,now:()=>time,budget:6});
    await cache.cleanup(); assert.ok(storage.rows(name).has(key));
    time+=29*DAY; await cache.cleanup(); assert.ok(storage.rows(name).has(key));
    await cache.put(key+'-b',new Response('new')); time+=HOUR;
    await cache.match(key); await cache.put(key+'-c',new Response('end'));
    assert.ok(storage.rows(name).has(key)); assert.ok(!storage.rows(name).has(key+'-b'));
    const metadata=storage.rows('foxhole-world-cache-usage-v1'), entry=[...metadata.keys()][0];
    metadata.set(entry,new Response('{broken')); time+=31*DAY; await cache.cleanup();
    assert.ok(storage.rows(name).size>=1,'malformed metadata gets a fresh grace interval');
});

test('cache usage failure preserves readable offline bodies',async()=>{
    const storage=memoryWorldCaches(); storage.rows(name).set(key,new Response('offline'));
    const api={open:async cacheName=>{if(cacheName==='foxhole-world-cache-usage-v1')throw Error('metadata unavailable'); return storage.api.open(cacheName);}};
    const cache=await openRetainedWorldCache(name,{cachesApi:api});
    assert.equal(await (await cache.match(key)).text(),'offline');
});

test('filling a large world cache avoids reopening every body for each small write',async()=>{
 const storage=memoryWorldCaches(),cache=await openRetainedWorldCache(name,{cachesApi:storage.api});
 for(let i=0;i<200;i++)assert.equal(await cache.put(key+'/'+i,new Response('geometry')),true);
 assert.equal(storage.rows(name).size,200);
 assert.ok(storage.reads.filter(row=>row.name===name).length<1000,'body reads remain proportional to downloads below the budget');
});

test('large region leases renew distinct cached resources without serial metadata waits',async()=>{
    const storage=memoryWorldCaches(), keys=Array.from({length:24},(_,i)=>key+'/'+i);
    for(const resource of keys) storage.rows(name).set(resource,new Response('resident'));
    let armed=false, active=0, peak=0, release, report, timeout;
    const gate=new Promise(resolve=>{release=resolve;});
    const parallel=new Promise(resolve=>{report=resolve;});
    const api={open:async cacheName=>{
        const cache=await storage.api.open(cacheName);
        if(cacheName!=='foxhole-world-cache-usage-v1') return cache;
        return {...cache,match:async value=>{
            if(armed){active++;peak=Math.max(peak,active);if(active===2)report();await gate;active--;}
            return cache.match(value);
        }};
    }};
    const cache=await openRetainedWorldCache(name,{cachesApi:api});
    await cache.cleanup(); armed=true;
    const updates=[]; const renewal=cache.touch(new Set([...keys,keys[0]]),{onProgress:state=>updates.push({...state})});
    try {await Promise.race([parallel,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('metadata reads were serialized')),1000);})]);}
    finally {clearTimeout(timeout);release();}
    await renewal;
    assert.ok(peak>=2 && peak<=16);
    assert.equal(storage.rows('foxhole-world-cache-usage-v1').size,keys.length);
    assert.deepEqual(updates[0],{completed:0,total:keys.length});
    assert.deepEqual(updates.at(-1),{completed:keys.length,total:keys.length});
    assert.equal(updates.length,keys.length+1);
});

test('reopening an active region reuses fresh retention records and renews them when due',async()=>{
 const storage=memoryWorldCaches(),keys=Array.from({length:24},(_,i)=>key+'/warm/'+i);let time=100*DAY;
 for(const item of keys)storage.rows(name).set(item,new Response('resident'));
 const first=await openRetainedWorldCache(name,{cachesApi:storage.api,now:()=>time});await first.touch(keys);
 const usageWrites=()=>storage.writes.filter(row=>row.name==='foxhole-world-cache-usage-v1').length;
 const initial=usageWrites();time+=60_000;
 const second=await openRetainedWorldCache(name,{cachesApi:{open:storage.api.open},now:()=>time});await second.touch(keys);
 assert.equal(usageWrites(),initial,'a new browser context does not rewrite fresh records');
 time+=HOUR;await second.touch(keys);
 assert.equal(usageWrites(),initial+keys.length,'active records are renewed before their lease expires');
 time+=HOUR;await second.cleanup();assert.equal(storage.rows(name).size,keys.length);
});

test('rebuilding cache totals reads entries concurrently under the retention lock',async()=>{
 const storage=memoryWorldCaches(),keys=Array.from({length:48},(_,i)=>key+'/scan/'+i);
 for(const item of keys)storage.rows(name).set(item,new Response('x',{headers:{'X-Foxhole-Cached-Bytes':'1'}}));
 let active=0,peak=0,release,report,timer;
 const gate=new Promise(resolve=>{release=resolve;}),parallel=new Promise(resolve=>{report=resolve;});
 const api={open:async cacheName=>{const cache=await storage.api.open(cacheName);if(cacheName!==name)return cache;
  return {...cache,match:async value=>{const url=typeof value==='string'?value:value.url;if(url.includes('/scan/')){active++;peak=Math.max(peak,active);if(active===2)report();await gate;active--;}return cache.match(value);}};
 }};
 const cache=await openRetainedWorldCache(name,{cachesApi:api,budget:1024});
 const write=cache.put(key+'/new',new Response('new'));
 try{await Promise.race([parallel,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cache scan was serialized')),1000);})]);}
 finally{clearTimeout(timer);release();}
 assert.equal(await write,true);assert.ok(peak>=2&&peak<=16);assert.equal(storage.rows(name).size,keys.length+1);
});

test('recent validated cache totals avoid enumerating the full cache for every write',async()=>{
 const storage=memoryWorldCaches();let time=100*DAY,enumerations=0;
 const api={open:async cacheName=>{const cache=await storage.api.open(cacheName);return cacheName===name?{...cache,keys:async()=>{enumerations++;return cache.keys();}}:cache;}};
 const cache=await openRetainedWorldCache(name,{cachesApi:api,now:()=>time,budget:1000});
 assert.equal(await cache.put(key+'/first',new Response('x')),true);const first=enumerations;
 for(let i=0;i<20;i++)assert.equal(await cache.put(key+'/fast/'+i,new Response('x')),true);
 assert.equal(enumerations,first,'fresh totals do not enumerate on each write');
 time+=30000;assert.equal(await cache.put(key+'/recheck',new Response('x')),true);
 assert.equal(enumerations,first+1,'the summary is periodically reconciled');
});

test('cache totals reconcile external changes and legacy summaries before enforcing budgets',async()=>{
 const storage=memoryWorldCaches();let time=100*DAY;
 const cache=await openRetainedWorldCache(name,{cachesApi:storage.api,now:()=>time,budget:4});
 await cache.put(key+'/first',new Response('x'));await cache.put(key+'/second',new Response('x'));
 storage.rows(name).set(key+'/external',new Response('xx',{headers:{'X-Foxhole-Cached-Bytes':'2'}}));
 time+=30000;await cache.put(key+'/third',new Response('x'));
 const total=await Promise.all([...storage.rows(name).values()].map(async value=>(await value.clone().arrayBuffer()).byteLength));
 assert.ok(total.reduce((a,b)=>a+b,0)<=4,'reconciliation accounts for externally added bytes');
 const metadata=storage.rows('foxhole-world-cache-usage-v1');
 const summaryKey=[...metadata.keys()].find(value=>value.endsWith('/_summary'));
 metadata.set(summaryKey,new Response(JSON.stringify({bytes:0,count:0})));
 await cache.put(key+'/legacy',new Response('x'));
 const after=await Promise.all([...storage.rows(name).values()].map(async value=>(await value.clone().arrayBuffer()).byteLength));
 assert.ok(after.reduce((a,b)=>a+b,0)<=4,'legacy summaries cannot skip reconciliation');
});
test('active leases renew when due and warm hits remain readable',async()=>{
 const storage=memoryWorldCaches(),keys=Array.from({length:24},(_,i)=>key+'/remembered/'+i);let time=100*DAY;
 for(const item of keys)storage.rows(name).set(item,new Response('resident'));
 const cache=await openRetainedWorldCache(name,{cachesApi:storage.api,now:()=>time});await cache.touch(keys);
 await cache.touch(keys);storage.reads.length=0;
 for(const item of keys)assert.equal(await (await cache.match(item)).text(),'resident');
 assert.equal(storage.reads.filter(row=>row.name==='foxhole-world-cache-usage-v1').length,keys.length,'fresh hits check shared metadata');
 time+=HOUR;await cache.touch(keys);
 const usage=storage.rows('foxhole-world-cache-usage-v1');
 const values=await Promise.all([...usage.values()].map(value=>value.clone().json()));
 assert.equal(values.filter(value=>value.lastUsedAt===time&&value.activeUntil===time+2*HOUR).length,keys.length,'leases are renewed when due');
});

test('old remembered usage observes a later renewal in another cache context',async()=>{
 const storage=memoryWorldCaches();let time=100*DAY;
 storage.rows(name).set(key,new Response('resident'));
 const options={now:()=>time},first=await openRetainedWorldCache(name,{...options,cachesApi:storage.api});
 await first.touch([key]);time+=29*DAY;
 const second=await openRetainedWorldCache(name,{...options,cachesApi:{open:storage.api.open}});
 await second.touch([key]);time+=2*DAY;
 assert.equal(await (await first.match(key)).text(),'resident','another context renewed the stored lease');
 assert.ok(storage.rows(name).has(key));
});

test('renewing a lease protects a body deleted and recreated by another context',async()=>{
 const storage=memoryWorldCaches();let time=100*DAY;
 const options={now:()=>time,budget:1},first=await openRetainedWorldCache(name,{...options,cachesApi:storage.api}),second=await openRetainedWorldCache(name,{...options,cachesApi:{open:storage.api.open}});
 assert.equal(await first.put(key,new Response('a')),true);await first.touch([key]);
 await second.delete(key);assert.equal(await second.put(key,new Response('a')),true);
 await first.touch([key]);
 assert.equal(await second.put(key+'-other',new Response('b')),false,'the recreated body remains protected by the renewed lease');
 assert.ok(storage.rows(name).has(key));
});

test('legacy decoded texture byte headers avoid reading cached bodies during accounting',async()=>{
 for(const replaceExisting of [false,true]){
  const storage=memoryWorldCaches(),legacy=key+'/pixels';storage.rows(name).set(legacy,new Response('abc',{headers:{'X-Foxhole-Pixel-Bytes':'3'}}));
  const api={open:async cacheName=>{const cache=await storage.api.open(cacheName);if(cacheName!==name)return cache;return {...cache,match:async value=>{
   const response=await cache.match(value),url=typeof value==='string'?value:value.url;
   if(url===legacy&&response)Object.defineProperty(response,'arrayBuffer',{value(){throw Error('legacy pixel body was read for accounting');}});
   return response;
  }};}};
  const cache=await openRetainedWorldCache(name,{cachesApi:api,budget:3});
  assert.equal(await cache.put(replaceExisting?legacy:key+'/new',new Response('x')),true);
  assert.equal(storage.rows(name).size,1);
 }
});

function mockWorldLocks(){
 const states=new Map(),requested=[];
 function pump(state){if(state.writer||!state.queue.length)return;if(state.queue[0].mode==='exclusive'&&state.readers)return;
  while(state.queue.length&&!state.writer){const item=state.queue[0];if(item.mode==='exclusive'&&state.readers)break;state.queue.shift();if(item.mode==='shared')state.readers++;else state.writer=true;
   Promise.resolve().then(()=>item.callback({name:item.name,mode:item.mode})).then(item.resolve,item.reject).finally(()=>{if(item.mode==='shared')state.readers--;else state.writer=false;pump(state);});
   if(item.mode==='exclusive')break;
  }
 }
 return {requested,request(name,options,callback){if(typeof options==='function'){callback=options;options={};}const mode=options?.mode||'exclusive';requested.push(mode);let state=states.get(name);if(!state){state={readers:0,writer:false,queue:[]};states.set(name,state);}
  if(options?.ifAvailable&&(state.writer||state.queue.length||(mode==='exclusive'&&state.readers)))return Promise.resolve().then(()=>callback(null));
  return new Promise((resolve,reject)=>{state.queue.push({name,mode,callback,resolve,reject});pump(state);});}};
}
async function withWorldNavigator(locks,fn){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{...(locks?{locks}:{})}});try{return await fn();}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}}

test('fresh warm hits run body reads concurrently under shared locks',async()=>{
 const storage=memoryWorldCaches(),keys=Array.from({length:4},(_,i)=>key+'/parallel/'+i);for(const item of keys)storage.rows(name).set(item,new Response('x'));
 let armed=false,active=0,peak=0,release,signal,timer;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{signal=resolve;});
 const api={open:async n=>{const cache=await storage.api.open(n);if(n!==name)return cache;return {...cache,match:async value=>{if(armed){active++;peak=Math.max(peak,active);if(active===2)signal();try{await gate;}finally{active--;}}return cache.match(value);}};}};
 const locks=mockWorldLocks();await withWorldNavigator(locks,async()=>{const cache=await openRetainedWorldCache(name,{cachesApi:api});await cache.touch(keys);armed=true;
  const reads=Promise.all(keys.map(async item=>await (await cache.match(item)).text()));
  try{await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fresh cache reads were serialized')),1000);})]);}
  finally{clearTimeout(timer);release();}assert.deepEqual(await reads,['x','x','x','x']);assert.ok(peak>=2);assert.ok(locks.requested.includes('shared'));
 });
});

test('shared read blocks delete and recreated body can be leased across contexts',async()=>{
 const storage=memoryWorldCaches(),locks=mockWorldLocks();let armed=false,release,signal,deleted=false;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{signal=resolve;});
 const api={open:async n=>{const cache=await storage.api.open(n);if(n!==name)return cache;return {...cache,match:async value=>{const response=await cache.match(value);if(armed){armed=false;signal();await gate;}return response;}};}};
 await withWorldNavigator(locks,async()=>{const first=await openRetainedWorldCache(name,{cachesApi:api,budget:1}),second=await openRetainedWorldCache(name,{cachesApi:{open:storage.api.open},budget:1});
  await first.put(key,new Response('a'));await first.touch([key]);armed=true;const read=first.match(key);await started;
  const del=second.delete(key).then(()=>{deleted=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(deleted,false,'delete waits for the in-flight shared read');
  release();assert.equal(await (await read).text(),'a');await del;assert.equal(deleted,true);
  await second.put(key,new Response('a'));await first.touch([key]);assert.equal(await second.put(key+'-other',new Response('b')),false);assert.ok(storage.rows(name).has(key));
 });
});

test('old and missing metadata fall back to exclusive handling',async()=>{
 const storage=memoryWorldCaches(),locks=mockWorldLocks();let time=100*DAY;storage.rows(name).set(key,new Response('a'));
 await withWorldNavigator(locks,async()=>{const cache=await openRetainedWorldCache(name,{cachesApi:storage.api,now:()=>time});
  assert.equal(await (await cache.match(key)).text(),'a');assert.ok(locks.requested.includes('shared'));assert.ok(locks.requested.includes('exclusive'),'missing usage requires an exclusive refresh');
  time+=31*DAY;assert.equal(await cache.match(key),undefined,'stale bodies expire on the exclusive path');
 });
});

test('cache maintenance enumeration does not block leases or warm hits',async()=>{
 for(const useLocks of [true,false]){
  const storage=memoryWorldCaches(),locks=useLocks?mockWorldLocks():null,asset=key+'/foreground';let release,signal,armed=false;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{signal=resolve;});storage.rows(name).set(asset,new Response('x'));
  const api={open:async n=>{const cache=await storage.api.open(n);return n!==name?cache:{...cache,keys:async()=>{if(armed){signal();await gate;}return cache.keys();}};}};
  await withWorldNavigator(locks,async()=>{const first=await openRetainedWorldCache(name,{cachesApi:api}),second=await openRetainedWorldCache(name,{cachesApi:{open:api.open}});
   armed=true;const maintenance=second.cleanup();await started;
   try{await Promise.race([first.touch([asset]),new Promise((_,reject)=>setTimeout(()=>reject(Error('lease blocked by enumeration')),500))]);
    assert.equal(await (await first.match(asset)).text(),'x','warm read is available while enumeration is in progress');
   }finally{release();await maintenance;}
  });
 }
});

test('automatic maintenance is coalesced across contexts without delaying foreground work',async()=>{
 const storage=memoryWorldCaches(),locks=mockWorldLocks(),asset=key+'/coalesced';let release,signal,enumerations=0;
 const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{signal=resolve;});storage.rows(name).set(asset,new Response('x'));
 const api={open:async n=>{const cache=await storage.api.open(n);return n!==name?cache:{...cache,keys:async()=>{enumerations++;signal();await gate;return cache.keys();}};}};
 await withWorldNavigator(locks,async()=>{const first=await openRetainedWorldCache(name,{cachesApi:api,idleDelay:20}),second=await openRetainedWorldCache(name,{cachesApi:{open:api.open},idleDelay:20});
  await Promise.all([first.touch([asset]),second.touch([asset])]);await started;
  try{assert.equal(await (await first.match(asset)).text(),'x');await second.touch([asset]);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(enumerations,1,'one maintenance scan runs across contexts');}
  finally{release();}
  await new Promise(resolve=>setTimeout(resolve,30));
  const third=await openRetainedWorldCache(name,{cachesApi:{open:api.open},idleDelay:20});await third.touch([asset]);await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(enumerations,1,'a later context reuses the shared maintenance interval');
 });
});

test('failed background maintenance preserves reads and leases',async()=>{
 const storage=memoryWorldCaches(),asset=key+'/failure';let scans=0;storage.rows(name).set(asset,new Response('x'));
 const api={open:async n=>{if(n==='foxhole-world-cache-maintenance-v1')throw Error('maintenance store unavailable');const cache=await storage.api.open(n);return n!==name?cache:{...cache,keys:async()=>{scans++;throw Error('enumeration unavailable');}};}};
 await withWorldNavigator(null,async()=>{const cache=await openRetainedWorldCache(name,{cachesApi:api,idleDelay:20});await cache.touch([asset]);
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(scans,1);
  assert.equal(await (await cache.match(asset)).text(),'x');await cache.touch([asset]);
  await assert.rejects(cache.cleanup(),/enumeration unavailable/);assert.equal(await (await cache.match(asset)).text(),'x');
 });
});

test('maintenance rechecks a newly leased replacement after enumeration',async()=>{
 const storage=memoryWorldCaches(),locks=mockWorldLocks(),asset=key+'/replacement';let time=100*DAY,release,signal,firstEnumeration=true;
 const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{signal=resolve;});
 const api={open:async n=>{const cache=await storage.api.open(n);return n!==name?cache:{...cache,keys:async()=>{const snapshot=await cache.keys();if(firstEnumeration){firstEnumeration=false;signal();await gate;}return snapshot;}};}};
 await withWorldNavigator(locks,async()=>{const first=await openRetainedWorldCache(name,{cachesApi:api,now:()=>time}),second=await openRetainedWorldCache(name,{cachesApi:{open:api.open},now:()=>time});
  storage.rows(name).set(asset,new Response('old'));const usage='https://foxhole-world-cache.invalid/'+name+'/'+encodeURIComponent(asset);storage.rows('foxhole-world-cache-usage-v1').set(usage,new Response(JSON.stringify({lastUsedAt:time-31*DAY,activeUntil:0})));
  const scan=first.cleanup();await started;
  try{await second.touch([asset]);assert.equal(await second.put(asset,new Response('new')),true);}
  finally{release();await scan;}
  assert.equal(await (await second.match(asset)).text(),'new','maintenance must recheck the renewed lease');
 });
});

test('without Web Locks warm hits stay serialized',async()=>{
 const storage=memoryWorldCaches(),keys=[key+'/one',key+'/two'];for(const item of keys)storage.rows(name).set(item,new Response('x'));
 let armed=false,active=0,peak=0,release,signal;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{signal=resolve;});
 const api={open:async n=>{const cache=await storage.api.open(n);return n!==name?cache:{...cache,match:async value=>{if(armed){active++;peak=Math.max(peak,active);signal();try{await gate;}finally{active--;}}return cache.match(value);}};}};
 await withWorldNavigator(null,async()=>{const cache=await openRetainedWorldCache(name,{cachesApi:api});await cache.touch(keys);armed=true;
  const reads=Promise.all(keys.map(async item=>await (await cache.match(item)).text()));await started;await new Promise(resolve=>setImmediate(resolve));assert.equal(peak,1);release();assert.deepEqual(await reads,['x','x']);
 });
});

test('active lease survives deletion and recreation in a third context',async()=>{
 const storage=memoryWorldCaches();let time=100*DAY;const options={now:()=>time,budget:1};
 const first=await openRetainedWorldCache(name,{...options,cachesApi:storage.api}),second=await openRetainedWorldCache(name,{...options,cachesApi:{open:storage.api.open}}),third=await openRetainedWorldCache(name,{...options,cachesApi:{open:storage.api.open}});
 assert.equal(await first.put(key,new Response('a')),true);await first.touch([key]);await second.delete(key);assert.equal(storage.rows(name).has(key),false,'explicit deletion removes the body');
 assert.equal(await third.put(key,new Response('a')),true);assert.equal(await second.put(key+'-other',new Response('b')),false,'the active lease protects the replacement without another renewal');assert.ok(storage.rows(name).has(key));
});

test('recreation restores a remembered active lease when shared metadata is missing',async()=>{
 const storage=memoryWorldCaches();let time=100*DAY;const options={now:()=>time,budget:1};
 const first=await openRetainedWorldCache(name,{...options,cachesApi:storage.api}),second=await openRetainedWorldCache(name,{...options,cachesApi:{open:storage.api.open}});
 assert.equal(await first.put(key,new Response('a')),true);await first.touch([key]);
 storage.rows(name).delete(key);const usageKey='https://foxhole-world-cache.invalid/'+name+'/'+encodeURIComponent(key);storage.rows('foxhole-world-cache-usage-v1').delete(usageKey);
 assert.equal(await first.put(key,new Response('a')),true);assert.equal(await second.put(key+'-other',new Response('b')),false);assert.ok(storage.rows(name).has(key));
});

test('deleting an expired lease removes its usage metadata',async()=>{
 const storage=memoryWorldCaches();let time=100*DAY;const cache=await openRetainedWorldCache(name,{cachesApi:storage.api,now:()=>time});
 await cache.put(key,new Response('a'));await cache.touch([key]);time+=2*HOUR;await cache.delete(key);
 const usageKey='https://foxhole-world-cache.invalid/'+name+'/'+encodeURIComponent(key);assert.equal(storage.rows('foxhole-world-cache-usage-v1').has(usageKey),false);
});

test('replacing a body observes a newer lease from another context',async()=>{
 const storage=memoryWorldCaches();let time=100*DAY;const options={now:()=>time,budget:1};
 const first=await openRetainedWorldCache(name,{...options,cachesApi:storage.api}),second=await openRetainedWorldCache(name,{...options,cachesApi:{open:storage.api.open}});
 await first.put(key,new Response('a'));await first.touch([key]);time+=HOUR;await second.touch([key]);await first.put(key,new Response('b'));
 const usageKey='https://foxhole-world-cache.invalid/'+name+'/'+encodeURIComponent(key),usage=await storage.rows('foxhole-world-cache-usage-v1').get(usageKey).clone().json();
 assert.equal(usage.activeUntil,time+2*HOUR);assert.equal(await second.put(key+'-other',new Response('c')),false);
});
