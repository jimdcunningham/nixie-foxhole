import assert from 'node:assert/strict';
import test from 'node:test';
import {createCatalogModelLease} from '../runtime/catalog-model-leases.mjs';
const flush=()=>new Promise(r=>setTimeout(r,0));
test('catalog sources decode once and unload only after the final owner retires',async()=>{
 let loads=0,unloads=0,resolve;const options={load:()=>{loads++;return new Promise(r=>resolve=r);},unload:async()=>{unloads++;}};
 const a=createCatalogModelLease(options),b=createCatalogModelLease(options),first=a.get('fixture-shared');assert.equal(first,b.get('fixture-shared'));await flush();a.release();resolve({});await first;await flush();assert.equal(loads,1);assert.equal(unloads,0);b.release();await flush();assert.equal(unloads,1);
});
test('reacquiring an in-flight source prevents premature disposal; rejection can retry',async()=>{
 let unloads=0,resolve;const options={load:()=>new Promise(r=>resolve=r),unload:async()=>unloads++};const a=createCatalogModelLease(options),first=a.get('fixture-pending');await flush();a.release();const b=createCatalogModelLease(options);assert.equal(b.get('fixture-pending'),first);resolve({});await first;await flush();assert.equal(unloads,0);b.release();await flush();assert.equal(unloads,1);
 const failed=createCatalogModelLease({load:async()=>{throw Error('missing');},unload:async()=>{}});await assert.rejects(failed.get('fixture-error'));failed.release();await flush();const retry=createCatalogModelLease({load:async()=>42,unload:async()=>{}});assert.equal(await retry.get('fixture-error'),42);retry.release();await flush();
});

test('a new owner waits for an already-started cache unload before decoding the same URL',async()=>{
 let loads=0,release;const options={load:async()=>++loads,unload:()=>new Promise(resolve=>release=resolve)};const a=createCatalogModelLease(options);await a.get('fixture-retiring');a.release();await flush();const b=createCatalogModelLease(options),pending=b.get('fixture-retiring');await flush();assert.equal(loads,1);release();assert.equal(await pending,2);b.release();await flush();release();await flush();
});
