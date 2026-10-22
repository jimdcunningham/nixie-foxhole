import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {CubeTexture} from 'pixi.js';
import {Container3D,View3D} from '@pixi/3d';
import {FoxholeRegionSceneController,worldLightingProfile} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('host-managed time of day survives region arrival, reconciliation and removal',async()=>{
 const sky={skyColor:0x394c73,groundColor:0x172031,intensity:.025,up:{x:0,y:0,z:1}};
 const view=new View3D({environment:sky});
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',manageEnvironment:false,
  fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),
  loadRegion:async()=>({root:new Container3D(),passes:[],metrics:{},environment:{skyColor:0xffffff,intensity:1},destroy(){}})});
 const sync=enabled=>controller.sync({view,settings:{enabled,regionKeys:['fixtureHex']},mode:'3d'});
 try{
  sync(true);await flush();
  assert.equal(controller.active,true);
  assert.equal(view.environment,sky,'a loaded Noon Sky must not replace the midnight host environment');
  sky.intensity=.25;controller.reconcile();assert.equal(view.environment,sky);
  sky.intensity=.025;controller.reconcile();assert.equal(view.environment.intensity,.025);
  sync(false);assert.equal(view.environment,sky);
 }finally{controller.destroy();view.destroy({children:true});}
});

for(const filename of ['live-terrain','road-shoulders'])test(filename+' selects the live view environment instead of forcing its authored noon cubemap',()=>{
 const source=readFileSync(new URL('../authoring/'+filename+'.mjs',import.meta.url),'utf8');
 const expression=source.match(/,env=(.*?),filter=/)[1];
 const resolve=environment=>runInNewContext('(function(){return '+expression+';}).call({owner:{environment:"game"}})',{session:{view3d:{environment}},CubeTexture,o:{terrainPass:{environment:'game'}}});
 assert.equal(resolve({skyColor:0x394c73,intensity:.025}),'hemisphere');
 assert.equal(resolve(null),'none');
 assert.equal(resolve(Object.create(CubeTexture.prototype)),'cube');
});

const lightingProfileKey=Symbol.for('nixie.spatial.lighting-profile');
test('world appearance follows camera scale and restores a prior view calibration on release',async()=>{
 const previous={sunIntensity:5},view=new View3D({toneMapping:'none'});view[lightingProfileKey]=previous;
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',manageEnvironment:false,
  fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),
  loadRegion:async()=>({root:new Container3D(),passes:[],metrics:{},destroy(){}})});
 const sync=enabled=>controller.sync({view,settings:{enabled,regionKeys:['fixtureHex']},mode:'3d'});
 try{
  view.camera.position.z=400;view.camera.near=10;view.camera.far=150000;
  sync(true);await flush();assert.equal(view.toneMapping,'aces');
  assert.equal(view[lightingProfileKey].shadow.cascades,3);
  assert.equal(view[lightingProfileKey].shadow.maxDistance,2048);
  view.camera.position.z=2000;sync(true);assert.equal(view[lightingProfileKey].shadow.maxDistance,8000);
  view.camera.mode='orthographic';view.camera.orthographicSize=12000;view.camera.zoom=1;
  sync(true);assert.equal(view[lightingProfileKey].shadow.maxDistance,48000);
  sync(false);assert.equal(view.toneMapping,'none');assert.equal(view[lightingProfileKey],previous);
  sync(true);controller.destroy();assert.equal(view.toneMapping,'none');assert.equal(view[lightingProfileKey],previous);
 }finally{controller.destroy();view.destroy({children:true});}
});
test('shadow reach covers oblique camera focus without exceeding its far plane',()=>{
 assert.equal(worldLightingProfile({camera:{near:300,far:100000,position:{z:10}}}).shadow.maxDistance,45000);
 assert.equal(worldLightingProfile({camera:{near:10000,far:200000,position:{z:100000}}}).shadow.maxDistance,128000);
 assert.equal(worldLightingProfile({camera:{near:100,far:10000,position:{z:10000}}}).shadow.maxDistance,10000);
});
