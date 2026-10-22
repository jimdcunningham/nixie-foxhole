import test from 'node:test';import assert from 'node:assert/strict';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
test('vegetation wind toggles live, keeps region ownership, and receives the scene wind snapshot',async()=>{
 const enabled=[],prepared=[],updates=[],loads=[],wind={directionDeg:135,strength:.65},view={camera:{position:{x:0,y:0,z:100}},passes:[],root:{addChild(){}}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://fixture.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),loadRegion:async options=>{loads.push(options);return {root:{removeFromParent(){}},passes:[],metrics:{},prepareWindShadows(value){prepared.push(value);},setVegetationWind(value){enabled.push(value);},update(value){updates.push(value);},destroy(){}};}});
 const settings={enabled:true,regionKeys:['fixtureHex']},flush=()=>new Promise(r=>setTimeout(r,0));
 try{controller.sync({view,mode:'3d',settings,wind,deltaMS:16});await flush();assert.equal(loads.length,1);assert.equal(loads[0].vegetationWind,true);assert.equal(prepared.at(-1),view);
 for(const value of [false,true,false]){settings.vegetationWind=value;controller.sync({view,mode:'3d',settings,wind,deltaMS:16});await flush();assert.equal(enabled.at(-1),value);assert.equal(loads.length,1);assert.equal(loads[0].signal.aborted,false);assert.equal(updates.at(-1).wind,wind);}
 }finally{controller.destroy();}
});

test('late regions join the same monotonic gust clock without restarting existing regions',async()=>{
 const updates=new Map(),loads=[],wind={directionDeg:70,strength:.8},view={camera:{position:{x:0,y:0,z:100}},passes:[],root:{addChild(){}}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://fixture.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'},late:{id:'late'}}})),loadRegion:async options=>{loads.push(options);return {root:{removeFromParent(){}},passes:[],metrics:{},update(value){updates.set(options.entry.id,value);},destroy(){}};}});
 const settings={enabled:true,regionKeys:['fixtureHex']},flush=()=>new Promise(r=>setTimeout(r,0)),sync=()=>controller.sync({view,mode:'3d',settings,wind,deltaMS:16});
 try{sync();await flush();sync();const first=updates.get('fixture').time;assert.ok(Number.isFinite(first));settings.regionKeys.push('lateHex');sync();await flush();sync();
  assert.equal(loads.length,2);assert.equal(updates.get('fixture').time,updates.get('late').time);assert.ok(updates.get('fixture').time>=first);assert.equal(updates.get('late').wind,wind);
 }finally{controller.destroy();}
});
