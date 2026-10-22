import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegionRevealQueue,readyAssets,prioritizeRegionPrototypes} from '../runtime/progressive-loading.mjs';

test('reveal work is budgeted, yields, and abort rejects unpublished batches',async()=>{
 const controller=new AbortController(),turns=[],events=[];let time=0;
 const queue=createRegionRevealQueue({signal:controller.signal,budgetMs:4,now:()=>time,schedule:fn=>(turns.push(fn),turns.length),cancel(){}});
 const jobs=Array.from({length:3},(_,i)=>queue.run(()=>{events.push(i);time+=3;return i;}));
 const settled=Promise.allSettled(jobs);
 assert.deepEqual(events,[]);turns.shift()();assert.deepEqual(events,[0,1]);assert.equal(turns.length,1);
 controller.abort();turns.shift()();const result=await settled;
 assert.deepEqual(result.map(row=>row.status),['fulfilled','fulfilled','rejected']);assert.deepEqual(events,[0,1]);
 await assert.rejects(queue.run(()=>events.push(4)),{name:'AbortError'});
});

test('complete assets can be consumed while a slower sibling is still downloading',async()=>{
 let release;const slow=new Promise(resolve=>{release=resolve;});const seen=[];
 const run=(async()=>{for await(const asset of readyAssets(['slow','fast'],asset=>asset==='slow'?slow:Promise.resolve(),{progressive:true})){seen.push(asset);if(asset==='fast')release();}})();
 await run;assert.deepEqual(seen,['fast','slow']);
 const atomic=[];for await(const asset of readyAssets(['slow','fast'],()=>Promise.resolve()))atomic.push(asset);assert.deepEqual(atomic,['slow','fast']);
});

test('a failed asset drains outstanding siblings before cleanup',async()=>{
 let release,drained=false;const sibling=new Promise(resolve=>{release=()=>{drained=true;resolve();};});
 const task=(async()=>{for await(const _ of readyAssets(['broken','slow'],asset=>asset==='broken'?Promise.reject(Error('broken')):sibling,{progressive:true})){} })();
 let rejected=false;const finished=task.catch(error=>{rejected=true;assert.equal(error.message,'broken');assert.equal(drained,true);});
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(rejected,false);release();await finished;
});

test('nearby prototype sources are prioritized without changing native layout data',()=>{
 const prototype=(name,x)=>({name,placements:[{matrix:[...Array(12).fill(0),x,0,0,1]}]});
 const source=[prototype('far',1000),prototype('near',2),prototype('tie',-2)];
 assert.deepEqual(prioritizeRegionPrototypes(source,[0,100,0]).map(p=>p.name),['near','tie','far']);assert.equal(source[0].name,'far');assert.equal(prioritizeRegionPrototypes(source),source);
});
