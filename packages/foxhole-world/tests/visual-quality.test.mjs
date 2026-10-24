import test from 'node:test';
import assert from 'node:assert/strict';
import {SafeSsaoEffect,SceneColorFinishEffect,sceneColorFinish} from '../authoring/safe-ssao.mjs';
import {filterVegetationPlacements,vegetationPlacementVisible} from '../authoring/vegetation-density.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';
import {Container3D,parseGltf} from '@pixi/3d';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
const matrix=i=>[1,0,0,0,0,1,0,0,0,0,1,0,i*2,0,0,1],rows=Array.from({length:100},(_,i)=>({actor:'grass-'+i,matrix:matrix(i)}));
const grass={name:'GroundCoverGrass',file:'grass.glb',kind:'environment',category:'vegetation',placements:rows};

test('AO off builds only the identical colour finish, with no depth sampling or AO targets',()=>{
 const renderer={renderPipes:{view3d:{globalSlots:{opaqueDepth:7}}}},io={renderer,input:{},output:{}};
 function graph(){return{passes:[],colors:[],sceneDepth:{},createColor(options){const handle={options};this.colors.push(handle);return handle;},addPass(pass){this.passes.push(pass);return pass;}};}
 const on=graph(),off=graph(),original=on.addPass;
 new SafeSsaoEffect().build(on,io);new SceneColorFinishEffect().build(off,io);
 assert.equal(on.addPass,original,'graph method ownership is restored');assert.deepEqual(on.passes.map(p=>p.name),['ssao:compute','ssao:blur','ssao:merge']);assert.equal(on.colors.length,2);
 assert.deepEqual(off.passes.map(p=>p.name),['scene:color-finish']);assert.equal(off.colors.length,0);assert.deepEqual(Object.keys(off.passes[0]._reads),['color']);
 for(const backend of ['gpu','gl']){
  assert.equal(sceneColorFinish(true)[backend].replace('*sampleColor2(uv).rgb',''),sceneColorFinish(false)[backend]);
  assert.ok(on.passes[2]._fragment[backend].includes(sceneColorFinish(true)[backend]));assert.ok(off.passes[0]._fragment[backend].includes(sceneColorFinish(false)[backend]));
 }
 for(const p of [...on.passes,...off.passes])p.destroy();
});

test('vegetation density is stable across source order and cell splits and preserves non-small foliage',()=>{
 const full=filterVegetationPlacements(grass,'full'),reduced=filterVegetationPlacements(grass,'reduced'),minimal=filterVegetationPlacements(grass,'minimal');
 assert.equal(full,grass);assert.ok(reduced.placements.length>25&&reduced.placements.length<75);assert.ok(minimal.placements.length>0&&minimal.placements.length<30);
 assert.ok(minimal.placements.every(row=>reduced.placements.includes(row)));assert.equal(grass.placements.length,100);
 const split=[...filterVegetationPlacements({...grass,placements:rows.slice(0,37)},'reduced').placements,...filterVegetationPlacements({...grass,placements:rows.slice(37)},'reduced').placements];assert.deepEqual(split,reduced.placements);
 assert.deepEqual(filterVegetationPlacements({...grass,placements:[...rows].reverse()},'reduced').placements.reverse(),reduced.placements);
 for(const name of ['PineTree','BushTree','Ivy12','HangingVine','Rock','UnknownFoliage'])assert.equal(filterVegetationPlacements({...grass,name},'minimal').placements,rows);
 assert.equal(filterVegetationPlacements({...grass,category:'structures'},'minimal').placements,rows);
 assert.equal(filterVegetationPlacements(grass,'invalid'),grass);
});

test('the real world loader applies density before loading small foliage and retains all trees',async()=>{
 const positions=new Float32Array([0,0,0,1,0,0,0,1,0]),source=await parseGltf({asset:{version:'2.0'},buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],materials:[{name:'Body'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0},[positions.buffer]);
 try{for(const density of ['full','reduced','minimal']){
  const root=new Container3D(),tree={...grass,name:'PineTree',file:'tree.glb',placements:rows.slice(0,3)},expected=rows.filter(row=>vegetationPlacementVisible(grass,row,density)).length;let world;
  try{world=await loadWorldModels({region:'fixture',root,optimize:false,vegetationDensity:density,worldData:{prototypes:[grass,tree]},json:async()=>({assets:{}}),status(){},teamAt:()=> 'NONE',loadModel:async()=>source});assert.deepEqual(world.counts.failed,[]);assert.equal(world.counts.placements,expected+3);assert.equal(world.counts.byCategory.vegetation,expected);assert.equal(world.counts.byCategory.trees,3);}finally{world?.dispose();root.destroy({children:true});}
 }}finally{source.destroy();}
});

test('AO and shadows change live without region reload, vegetation reloads, and view ownership restores',async()=>{
 const key=Symbol.for('nixie.spatial.shadow-quality'),camera={position:{x:0,y:0,z:100}},view={camera,passes:[],root:{addChild(){}},shadowQuality:'ultra',shadowFilter:'pcf',[key]:'prior'},seen=[],changes=[];
 const c=new FoxholeRegionSceneController({baseUrl:'https://test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),loadRegion:async options=>{seen.push(options);return{root:{removeFromParent(){}},passes:[],metrics:{},setAmbientOcclusion(value){changes.push(value);},destroy(){}};}});
 const settings={enabled:true,regionKeys:['fixtureHex'],ambientOcclusion:true,shadowQuality:'medium',vegetationDensity:'full'},sync=()=>c.sync({view,settings,mode:'3d'}),flush=()=>new Promise(r=>setTimeout(r,0));
 try{
  sync();await flush();assert.equal(seen[0].ambientOcclusion,true);assert.equal(seen[0].vegetationDensity,'full');
  for(const [quality,filter]of [['off','pcf-high'],['low','pcf'],['high','pcf-high'],['medium','pcf-high']]){settings.shadowQuality=quality;settings.ambientOcclusion=!settings.ambientOcclusion;sync();await flush();assert.equal(view[key],quality);assert.equal(view.shadowQuality,quality==='off'?'medium':quality);assert.equal(view.shadowFilter,filter);assert.equal(changes.at(-1),settings.ambientOcclusion);assert.equal(seen.length,1);assert.equal(seen[0].signal.aborted,false);}
  settings.shadowQuality='low';settings.softShadows=false;sync();await flush();assert.equal(view.shadowFilter,'hard');assert.equal(seen.length,1);
  settings.softShadows=true;sync();await flush();assert.equal(view.shadowFilter,'pcf');assert.equal(seen.length,1);
  settings.vegetationDensity='minimal';sync();await flush();assert.equal(seen.length,2);assert.equal(seen[0].signal.aborted,true);assert.equal(seen[1].vegetationDensity,'minimal');assert.equal(view.camera,camera);
  settings.enabled=false;sync();assert.equal(view.shadowQuality,'ultra');assert.equal(view.shadowFilter,'pcf');assert.equal(view[key],'prior');
 }finally{c.destroy();}
});
