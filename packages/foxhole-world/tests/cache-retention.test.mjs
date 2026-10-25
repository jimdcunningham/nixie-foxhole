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
