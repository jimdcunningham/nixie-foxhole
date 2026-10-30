import test from 'node:test';
import assert from 'node:assert/strict';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const scene=id=>({root:{id,removeFromParent(){}},passes:[],metrics:{},destroy(){this.destroyed=true;}});
test('a failed region is reported and can retry while a neighbor is still loading',async()=>{
 const calls=[],status=[],view={passes:[],root:{addChild(){}}},pending=[],other=scene('b');let aCount=0,otherSignal;
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.invalid/',onStatus:s=>status.push(s),
  fetcher:async()=>new Response(JSON.stringify({version:1,regions:{a:{id:'a'},b:{id:'b'}}})),
  loadRegion:({entry,signal})=>{calls.push(entry.id);if(entry.id==='a'){if(++aCount===1)return Promise.reject(Error('first region failed'));return Promise.resolve(scene('a'));}otherSignal=signal;return new Promise(resolve=>pending.push(resolve));}});
 const sync=()=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex','bHex']}});
 const old=console.error;console.error=()=>{};
 try{
  sync();for(let i=0;i<5;i++)await tick();
  const initial=status.at(-1);assert.match(initial.phase,/^Loading regions/);assert.match(initial.error,/a: first region failed/);assert.equal(initial.loadingRegions,1);
  assert.equal(controller.retryFailed(),true);assert.equal(otherSignal.aborted,false,'retry does not cancel loading neighbor');
  sync();for(let i=0;i<5;i++)await tick();assert.equal(otherSignal.aborted,false);assert.deepEqual(calls,['a','b','a']);
  assert.match(status.at(-1).phase,/^Loading regions/);pending[0](other);for(let i=0;i<5;i++)await tick();
  assert.equal(status.at(-1).phase,'Ready');assert.equal(other.destroyed,undefined);
 }finally{console.error=old;for(const resolve of pending)resolve(other);controller.destroy();}
});
