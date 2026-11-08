import test from 'node:test';
import assert from 'node:assert/strict';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await tick();assert.ok(predicate(),'condition not reached');};
test('post-ready busy scene retries only after old disposal drains and keeps ready neighbor',async()=>{
 const statuses=[],loads=[],destroyed=[],barriers=[];
 const view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://fixture.invalid/',onStatus:s=>statuses.push(s),indexLoader:async()=>({version:1,regions:{a:{id:'a'},b:{id:'b'}}}),loadRegion:async options=>{
  const id=options.entry.id;let finish;const disposed=new Promise(resolve=>finish=resolve);const scene={root:{removeFromParent(){}},passes:[],metrics:{},destroy(){destroyed.push(id);},whenDisposed(){return disposed;}};
  loads.push({id,options,scene,finish});barriers.push(finish);return scene;
 }});
 const sync=()=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex','bHex']}});
 try{sync();await until(()=>loads.length===2&&controller.records.get('a')?.state.phase==='Ready'&&controller.records.get('b')?.state.phase==='Ready');
  const a=loads.find(x=>x.id==='a'),b=loads.find(x=>x.id==='b');a.options.onProgress({phase:'Loading layers: decals'});
  assert.equal(statuses.at(-1).retryableLoading,true,'busy attached scene should have a safe retry');
  assert.equal(controller.retryLoading(),true);await tick();assert.deepEqual(destroyed,['a']);assert.equal(loads.length,2,'replacement must await scene disposal');assert.equal(controller.records.get('b').scene,b.scene);
  a.finish();await until(()=>loads.length===3);assert.equal(loads[2].id,'a');assert.equal(controller.records.get('b').scene,b.scene);
 }finally{for(const finish of barriers)finish();controller.destroy();await tick();}
});


test('controller destruction waits for a retired scene before releasing its barrier',async()=>{
 let release;const disposed=new Promise(resolve=>{release=resolve;});const view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800};let scene;
 const controller=new FoxholeRegionSceneController({baseUrl:'https://fixture.invalid/',indexLoader:async()=>({version:1,regions:{a:{id:'a'}}}),loadRegion:async()=>scene={root:{removeFromParent(){}},passes:[],metrics:{},destroy(){},whenDisposed(){return disposed;}}});
 controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex']}});await until(()=>controller.records.get('a')?.state.phase==='Ready');
 let finished=false;controller.destroy();const drain=controller.whenDisposed().then(()=>{finished=true;});await tick();assert.equal(finished,false);release();await drain;assert.equal(finished,true);
});


test('post-ready failure advertises retry and waits for disposal',async()=>{
 let release;const disposed=new Promise(resolve=>{release=resolve;});let options,loads=0;const statuses=[];
 const view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://fixture.invalid/',onStatus:status=>statuses.push(status),indexLoader:async()=>({version:1,regions:{a:{id:'a'}}}),loadRegion:async value=>{loads++;options=value;return {root:{removeFromParent(){}},passes:[],metrics:{},destroy(){},whenDisposed(){return disposed;}};}});
 const sync=()=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex']}});
 try{sync();await until(()=>controller.records.get('a')?.state.phase==='Ready');options.onProgress({phase:'error',error:'detail failed'});
  assert.equal(statuses.at(-1).retryableFailed,true);assert.equal(controller.retryFailed(),true);sync();await tick();assert.equal(loads,1);
  release();await until(()=>loads===2);
 }finally{release();controller.destroy();await tick();}
});

test('terrain-only map loads nearest first and refines only near a zoomed-in camera',async()=>{
 const loads=[],refined=[],layers=[];
 const view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:32000}},height:600,width:800};
 const controller=new FoxholeRegionSceneController({
  baseUrl:'https://fixture.invalid/',concurrency:1,deferTerrainDetail:true,
  indexLoader:async()=>({version:1,regions:{a:{id:'a'},b:{id:'b'}}}),
  loadRegion:async options=>{
   assert.equal(options.deferTerrainDetail,true);
   const id=options.entry.id;loads.push(id);
   return {root:{removeFromParent(){}},passes:[],metrics:{},destroy(){},setLayers(flags){layers.push([id,flags]);},async refineTerrain(){refined.push(id);}};
  },
 });
 const sync=(water=false)=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex','bHex'],terrainSurface:'map',worldLayers:{terrain:true,shell:true,water}},regions:[
  {id:'a',position:{x:90000,y:0}},{id:'b',position:{x:0,y:0}},
 ]});
 try{
  sync();await until(()=>loads.length===2&&!controller.loading.size);
  assert.deepEqual(loads,['b','a']);
  sync();assert.deepEqual(refined,[]);
  view.camera.position.z=2000;sync();await until(()=>refined.length===1);
  assert.deepEqual(refined,['b']);
  const originals=[...controller.records.values()].map(record=>record.scene);
  sync(true);
  assert.deepEqual([...controller.records.values()].map(record=>record.scene),originals);
  assert.equal(layers.filter(([,flags])=>flags.water).length,2);
  sync();
  assert.deepEqual([...controller.records.values()].map(record=>record.scene),originals);
  assert.ok(layers.slice(-2).every(([,flags])=>!flags.water));
 }finally{controller.destroy();await controller.whenDisposed();}
});
