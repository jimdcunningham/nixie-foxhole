import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyResourceTiming, createResourceTimingObserver, createTransferLedger} from '../runtime/terrain-network-observation.mjs';

test('resource timing distinguishes observed transfer, cache, and unknown', () => {
 assert.deepEqual(classifyResourceTiming({transferSize:300,encodedBodySize:1000}),{kind:'observed',bytes:300});
 assert.deepEqual(classifyResourceTiming({transferSize:0,encodedBodySize:1000}),{kind:'http-cache',bytes:0});
 assert.deepEqual(classifyResourceTiming({transferSize:0,encodedBodySize:0}),{kind:'unknown'});
 assert.deepEqual(classifyResourceTiming(null),{kind:'unknown'});
});
test('a real fetch cannot reuse an old or already accounted timing',()=>{
 const old={startTime:1,transferSize:900,encodedBodySize:500};
 const current={startTime:10,transferSize:300,encodedBodySize:200};let id=0;
 const observe=createResourceTimingObserver({now:()=>5,getEntriesByName:()=>[old,current]},()=>String(++id));
 assert.deepEqual(observe.finish(observe.start('https://world.test/a')),{id:'1',kind:'observed',bytes:300});
 assert.deepEqual(observe.finish(observe.start('https://world.test/a')),{id:'2',kind:'unknown'});
});
test('overlapping same-URL fetches are unknown even if one timing finishes first',()=>{
 let now=1,id=0;const entries=[{startTime:2,transferSize:500,encodedBodySize:400}];
 const observe=createResourceTimingObserver({now:()=>now++,getEntriesByName:()=>entries},()=>String(++id));
 const first=observe.start('https://world.test/a'),second=observe.start('https://world.test/a');
 assert.deepEqual(observe.finish(second),{id:'1',kind:'unknown'});assert.deepEqual(observe.finish(first),{id:'2',kind:'unknown'});
});
test('equal rounded timestamps cannot attach an earlier transfer to a later retry',()=>{
 const entries=[{startTime:1,transferSize:4096,encodedBodySize:3796}];let id=0;
 const observe=createResourceTimingObserver({now:()=>1,getEntriesByName:()=>entries},()=>String(++id));
 const a=observe.start('https://world.test/a'),b=observe.start('https://world.test/a');
 assert.equal(observe.finish(a).kind,'unknown');assert.equal(observe.finish(b).kind,'unknown');
 assert.deepEqual(observe.finish(observe.start('https://world.test/a')),{id:'3',kind:'unknown'});
});
test('ledger deduplicates request IDs and preserves unknown counts', () => {
 const ledger=createTransferLedger();
 ledger.add({id:'a',kind:'observed',bytes:300});ledger.add({id:'a',kind:'observed',bytes:300});
 ledger.add({id:'b',kind:'unknown'});ledger.add({id:'c',kind:'http-cache',bytes:0});
 assert.deepEqual(ledger.summary(),{bytes:300,unknown:1,observed:1,cached:1});
});
