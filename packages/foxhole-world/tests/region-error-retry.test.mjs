import test from 'node:test';
import assert from 'node:assert/strict';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const scene=id=>({root:{id,removeFromParent(){}},passes:[],metrics:{},destroy(){this.destroyed=true;}});
test('retry keeps ready neighbors and does not restart unsafe post-ready failures',async()=>{
 const calls=[],status=[],view={passes:[],root:{addChild(){}}},scenes=new Map(),options=new Map();
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.invalid/',onStatus:s=>status.push(s),
  fetcher:async()=>new Response(JSON.stringify({version:1,regions:{a:{id:'a'},b:{id:'b'}}})),
  loadRegion:async value=>{const id=value.entry.id;calls.push(id);options.set(id,value);if(id==='b'&&calls.filter(x=>x==='b').length===1)throw Error('resource unavailable');const result=scene(id);scenes.set(id,result);return result;}});
 const sync=()=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex','bHex']}});
 const old=console.error;console.error=()=>{};
 try{
  sync();for(let i=0;i<5;i++)await tick();assert.equal(status.at(-1).phase,'error');const a=scenes.get('a');
  assert.equal(controller.retryFailed(),true);sync();for(let i=0;i<5;i++)await tick();
  assert.deepEqual(calls,['a','b','b']);assert.equal(a.destroyed,undefined);assert.equal(status.at(-1).phase,'Ready');
  const b=scenes.get('b');options.get('b').onProgress({phase:'error',error:'later layer failed'});assert.equal(status.at(-1).phase,'error');
  assert.equal(status.at(-1).retryableFailed,false,'post-ready failure is reported as non-retryable until disposal can be safely drained');
  assert.equal(controller.retryFailed(),false);sync();for(let i=0;i<5;i++)await tick();
  assert.deepEqual(calls,['a','b','b'],'no replacement load is started');assert.equal(controller.records.get('b').scene,b,'failed scene remains attached');
  assert.equal(b.destroyed,undefined);assert.equal(a.destroyed,undefined);assert.equal(status.at(-1).phase,'error');
 }finally{console.error=old;controller.destroy();}
 assert.equal(controller.retryFailed(),false);
});
