import test from 'node:test';
import assert from 'node:assert/strict';
import {createLayerDemand} from '../runtime/layer-demand.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('only requested groups load; prerequisites precede consumers and completed groups are reused',async()=>{
 const calls=[],tasks=Object.fromEntries(['terrain','water','bridges','roads','building'].map(key=>[key,{needed:flags=>flags[key]===true,dependencies:key==='roads'?['bridges']:[],load:async()=>calls.push(key)}]));
 const demand=createLayerDemand({tasks});demand.setLayers({terrain:true,water:true});await demand.whenIdle();assert.deepEqual(calls,['terrain','water']);
 demand.setLayers({terrain:true,water:true,roads:true});await demand.whenIdle();assert.deepEqual(calls,['terrain','water','bridges','roads']);
 demand.setLayers({});await demand.whenIdle();demand.setLayers({terrain:true,water:true,roads:true});await demand.whenIdle();assert.equal(calls.length,4);demand.dispose();
});
test('disabling in-flight work aborts it, drains cleanup, then allows re-enable without duplicating ready groups',async()=>{
 const started=deferred(),release=deferred(),calls=[];let first=true,cleanup=false;
 const demand=createLayerDemand({concurrency:1,tasks:{building:{needed:f=>f.building,load:async signal=>{calls.push('building');if(first){first=false;started.resolve();try{await release.promise;signal.throwIfAborted();}finally{cleanup=true;}}}},nature:{needed:f=>f.nature,load:async()=>{assert.equal(cleanup,true);calls.push('nature');}}}});
 demand.setLayers({building:true});await started.promise;demand.setLayers({building:false,nature:true});await tick();assert.deepEqual(calls,['building']);release.resolve();await demand.whenIdle();assert.deepEqual(calls,['building','nature']);
 demand.setLayers({building:true,nature:true});await demand.whenIdle();assert.deepEqual(calls,['building','nature','building']);demand.dispose();
});
test('region disposal waits for active asynchronous work and never starts queued groups',async()=>{
 const release=deferred(),started=deferred(),calls=[];const lifetime=new AbortController();
 const demand=createLayerDemand({signal:lifetime.signal,concurrency:1,tasks:{a:{needed:()=>true,load:async signal=>{calls.push('a');started.resolve();await release.promise;signal.throwIfAborted();}},b:{needed:()=>true,load:async()=>calls.push('b')}}});
 demand.setLayers({});await started.promise;lifetime.abort();let settled=false;const done=demand.whenSettled().then(()=>settled=true);await tick();assert.equal(settled,false);release.resolve();await done;assert.deepEqual(calls,['a']);await assert.rejects(demand.whenIdle(),{name:'AbortError'});
});
test('dependency failures reject readiness without starting dependent geometry',async()=>{
 let roads=0;const demand=createLayerDemand({tasks:{bridges:{needed:()=>false,load:async()=>{throw Error('missing bridge');}},roads:{needed:()=>true,dependencies:['bridges'],load:async()=>roads++}}});demand.setLayers({});await assert.rejects(demand.whenIdle(),/missing bridge/);assert.equal(roads,0);demand.dispose();
});

test('retiring prerequisites waits for dependent work and a fast re-enable waits for resource release',async()=>{
 const gate=deferred(),retire=deferred(),calls=[];let first=true;
 const demand=createLayerDemand({tasks:{base:{needed:()=>false,load:async()=>calls.push('base'),unload:async()=>{calls.push('release');await retire.promise;}},detail:{needed:f=>f.detail,dependencies:['base'],load:async signal=>{if(first){first=false;calls.push('detail');await gate.promise;signal.throwIfAborted();}}}}});
 demand.setLayers({detail:true});await tick();demand.setLayers({detail:false});await tick();assert.deepEqual(calls,['base','detail']);gate.resolve();await tick();assert.deepEqual(calls,['base','detail','release']);
 demand.setLayers({detail:true});await tick();assert.equal(calls.length,3);retire.resolve();await demand.whenIdle();assert.equal(calls.filter(c=>c==='base').length,2);demand.dispose();
});
