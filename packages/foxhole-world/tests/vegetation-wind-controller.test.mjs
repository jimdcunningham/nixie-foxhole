import test from 'node:test';import assert from 'node:assert/strict';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
test('vegetation wind toggles live, keeps region ownership, and receives the scene wind snapshot',async()=>{
 const enabled=[],updates=[],loads=[],wind={directionDeg:135,strength:.65},view={camera:{position:{x:0,y:0,z:100}},passes:[],root:{addChild(){}}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://fixture.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),loadRegion:async options=>{loads.push(options);return {root:{removeFromParent(){}},passes:[],metrics:{},setVegetationWind(value){enabled.push(value);},update(value){updates.push(value);},destroy(){}};}});
 const settings={enabled:true,regionKeys:['fixtureHex']},flush=()=>new Promise(r=>setTimeout(r,0));
 try{controller.sync({view,mode:'3d',settings,wind,deltaMS:16});await flush();assert.equal(loads.length,1);assert.equal(loads[0].vegetationWind,true);
 for(const value of [false,true,false]){settings.vegetationWind=value;controller.sync({view,mode:'3d',settings,wind,deltaMS:16});await flush();assert.equal(enabled.at(-1),value);assert.equal(loads.length,1);assert.equal(loads[0].signal.aborted,false);assert.equal(updates.at(-1).wind,wind);}
 }finally{controller.destroy();}
});
