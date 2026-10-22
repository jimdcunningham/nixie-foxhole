import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,parseGltf} from '@pixi/3d';
import {createChunkedTerrainLod} from '../runtime/terrain-chunks.mjs';
import {buildTerrainLod} from '../runtime/terrain-geometry-lod.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';

test('resident terrain builds native detail once and ignores camera, frustum and refinement budget',async()=>{
 const size=8,source=new Float32Array(size*size*3);for(let z=0;z<size;z++)for(let x=0;x<size;x++)source.set([x,x*.2+z,z],(z*size+x)*3);
 const meta={components:[{name:'native',size,offset:0}],min:[0,0,0],max:[7,9,7]},steps=[],released=[];
 const manager=createChunkedTerrainLod({meta,source,adaptive:false,frustumCulling:false,budget:{stats:{},reserve(){throw Error('no camera detail reservation');}},build:async(...args)=>{steps.push(args[2]);return buildTerrainLod(...args);},create:mesh=>mesh,release:mesh=>released.push(mesh),apply(){}});
 const geometry=await manager.initialize(),native=await buildTerrainLod(meta,source,1);
 assert.deepEqual(geometry.positions,native.positions);assert.deepEqual(geometry.indices,native.indices);
 for(const position of [[0,0,0],[0,100000,0]])manager.update({position,height:1,orthographicHeight:100000});
 assert.deepEqual(manager.getDraws(new Float32Array(24).fill(-1)),[geometry]);assert.deepEqual(steps,[1]);assert.equal(manager.stats.step,1);assert.equal(manager.stats.pending,false);
 manager.destroy();manager.destroy();assert.deepEqual(released,[geometry]);
});

test('resident model loading never requests LOD metadata or reduced models',async()=>{
 const positions=new Float32Array([0,0,0,1,0,0,0,1,0]),source=await parseGltf({asset:{version:'2.0'},buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],materials:[{name:'Body'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0},[positions.buffer]);
 const root=new Container3D(),requests=[],models=[];let world;
 try{world=await loadWorldModels({region:'fixture',root,optimize:false,status(){},teamAt:()=> 'NONE',json:async path=>{requests.push(path);if(path.endsWith('world.json'))return{prototypes:[{name:'Rock',file:'rock.glb',category:'rocks',placements:[{actor:'rock',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,7,0,1]}]}]};if(path.endsWith('lod-manifest.json'))throw Error('LOD metadata must not be loaded');return{assets:{}};},loadModel:async path=>{models.push(path);return source;}});
  assert.equal(world.lod,null);assert.equal(world.lodRecords.length,0);assert.equal(world.counts.lodResources,0);assert.equal(world.counts.placements,1);assert.deepEqual(models,['fixture/rock.glb']);assert.ok(!requests.some(path=>path.endsWith('lod-manifest.json')));assert.deepEqual(world.counts.failed,[]);
 }finally{world?.dispose();root.destroy({children:true});source.destroy();}
});

test('resident controller retains distant layer demand, turns culling off and restores view ownership on switches',async()=>{
 const view={cull:'gpu',_sceneBatch:{cull:'auto'},passes:[],height:800,width:1200,camera:{mode:'perspective',position:{x:0,y:0,z:30000*32}},root:{addChild(){}}},seen=[],destroyed=[];
 const controller=new FoxholeRegionSceneController({baseUrl:'https://test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),loadRegion:async options=>{seen.push(options);return{root:{removeFromParent(){}},passes:[],metrics:{},destroy(){destroyed.push(options.adaptiveStreaming);}};}});
 const flags={terrain:true,water:true,building:true,vegetation:true},sync=progressive=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['fixtureHex'],progressiveLoading:progressive,adaptiveStreaming:progressive,frustumCulling:false,worldLayers:flags}}),flush=()=>new Promise(r=>setTimeout(r,0));
 sync(false);await flush();assert.equal(view.cull,'off');assert.equal(view._sceneBatch.cull,'off');assert.equal(seen[0].layers,flags);assert.equal(controller.detailLayers({position:{x:0,y:0}}),flags);
 sync(true);await flush();assert.equal(view.cull,'off');assert.equal(view._sceneBatch.cull,'off');assert.equal(seen[1].layers.building,false);assert.deepEqual(destroyed,[false]);
 sync(false);await flush();assert.equal(view.cull,'off');controller.destroy();assert.equal(view.cull,'gpu');assert.equal(view._sceneBatch.cull,'auto');assert.deepEqual(destroyed,[false,true,false]);
});
