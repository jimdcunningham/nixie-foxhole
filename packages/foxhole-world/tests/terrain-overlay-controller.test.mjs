import test from 'node:test';
import assert from 'node:assert/strict';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
test('overlay toggles update existing/preparing regions without reloading or requesting model layers',async()=>{
 let options,finish,loads=0;const seen=[],scene={root:{removeFromParent(){}},passes:[],metrics:{},setPlanningOverlays:value=>seen.push({...value}),destroy(){}};
 const view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},width:800,height:600};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{deadlands:{id:'deadlands'}}})),loadRegion:input=>{loads++;options=input;return new Promise(resolve=>finish=resolve);}});
 const sync=(rdz,topo)=>controller.sync({view,mode:'2d',settings:{enabled:true,regionKeys:['DeadlandsHex'],terrainRdz:rdz,terrainTopo:topo,worldLayers:{terrain:true,building:false}}});
 sync(false,false);await flush();options.onSceneCreated(scene);sync(true,false);assert.deepEqual(seen.at(-1),{rdz:true,topo:false});
 options.onSceneReady(scene);finish(scene);await flush();sync(true,true);assert.deepEqual(seen.at(-1),{rdz:true,topo:true});assert.equal(loads,1);assert.equal(options.layers.building,false);
 controller.destroy();
});
