import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,Material3D} from '@pixi/3d';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
import {waterScreenReflectionsBit} from '../authoring/water-screen-reflections.mjs';

const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

for(const published of [false,true])test(`failed ${published?'published':'preparing'} regions stop receiving material settings`,async t=>{
 t.mock.method(console,'error',()=>{});
 let fail,settingsCalls=0;
 const waterMat=new Material3D({extraBits:[waterScreenReflectionsBit]});
 const scene={root:new Container3D(),passes:[],metrics:{},
  setWaterReflections(enabled){settingsCalls++;waterMat.data.waterReflectionStrength=enabled?1:0;},
  destroy(){waterMat.destroy();}
 };
 const view={passes:[],root:new Container3D()};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',
  indexLoader:async()=>({version:1,regions:{terminus:{id:'terminus'}}}),
  loadRegion:options=>{options.onSceneCreated(scene);if(published)options.onSceneReady(scene);
   return new Promise((_resolve,reject)=>fail=()=>{scene.destroy();reject(Error('A region layer failed'));});}
 });
 const sync=()=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['TerminusHex'],waterReflections:true}});
 try{
  sync();await flush();sync();assert.ok(settingsCalls>0,'settings reach the live scene during preparation');
  fail();await flush();
  assert.equal(waterMat.destroyed,true);assert.equal(waterMat.data,undefined,'Pixi discards the destroyed material facade');
  const before=settingsCalls;
  assert.doesNotThrow(sync,'later frames must not update a failed scene with destroyed resources');
  assert.equal(settingsCalls,before);
  assert.equal(controller.records.get('terminus').preparing,null);
  assert.equal(controller.records.get('terminus').scene,null);
  assert.equal(controller.records.get('terminus').state.phase,'error');
  assert.match(controller.diagnostics().join('\n'),/A region layer failed/,'retain the original load error');
 }finally{controller.destroy();waterMat.destroy();view.root.destroy({children:true});}
});

test('a completed region receives settings once per frame after preparation ends',async()=>{
 let finish,settingsCalls=0;
 const scene={root:new Container3D(),passes:[],metrics:{},setWaterReflections(){settingsCalls++;},destroy(){}};
 const view={passes:[],root:new Container3D()};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',
  indexLoader:async()=>({version:1,regions:{terminus:{id:'terminus'}}}),
  loadRegion:options=>{options.onSceneCreated(scene);return new Promise(resolve=>finish=()=>resolve(scene));}
 });
 const sync=()=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['TerminusHex']}});
 try{
  sync();await flush();finish();await flush();const before=settingsCalls;sync();
  assert.equal(settingsCalls-before,1,'completed regions have one active scene reference');
  assert.equal(controller.records.get('terminus').preparing,null);
 }finally{controller.destroy();view.root.destroy({children:true});}
});