import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,parseGltf,BatchedMesh3D,RenderPassBit} from '@pixi/3d';
import {loadWorldModels} from '../authoring/world-models.mjs';
import {loadWorldDetails} from '../authoring/world-details.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const triangle=async()=>{const p=new Float32Array([0,0,0,0,0,2,3,0,0]);return parseGltf({asset:{version:'2.0'},buffers:[{byteLength:p.byteLength}],bufferViews:[{buffer:0,byteLength:p.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[3,0,2]}],materials:[{name:'Paint'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0},[p.buffer]);};
test('model category filtering skips other categories and their LOD resources before any model request',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const root=new Container3D(),sources=[],requests=[];let world;
 const prototypes=[{name:'House',kind:'building',category:'structures',file:'building.gltf'},{name:'Bush',kind:'environment',category:'vegetation',file:'bush.gltf'},{name:'StoneBridge',kind:'environment',category:'infrastructure',file:'bridge.gltf'}].map(p=>({...p,placements:[{actor:p.name,matrix:identity}]}));
 try{world=await loadWorldModels({region:'fixture',root,categories:['building'],status(){},teamAt:()=> 'NONE',json:async path=>path.endsWith('world.json')?{prototypes}:{assets:{}},loadModel:async path=>{requests.push(path);assert.equal(path,'fixture/building.gltf');const source=await triangle();sources.push(source);return source;}});assert.deepEqual(requests,['fixture/building.gltf']);assert.equal(world.counts.placements,1);assert.equal(world.counts.lodResources,0);assert.equal(world.layers.vegetation.children.length,0);}
 finally{world?.dispose();root.destroy({children:true});sources.forEach(source=>source.destroy());globalThis.location=saved;}
});
test('disabled detail types do not fetch geometry, recipes or textures',async()=>{
 const root=new Container3D(),requests=[],bit={name:'fixture',gpu:{fragment:{material:''}},gl:{fragment:{material:''}}};
 try{await loadWorldDetails({region:'fixture',root,layers:{decals:false,puddles:false,effects:false},hexBit:bit,json:async path=>{requests.push(path);assert.equal(path,'fixture/world-fixes/complete.json');return {};},texture:async()=>{throw Error('unexpected texture');},zipped:async()=>{throw Error('unexpected geometry');}});assert.equal(root.children.length,0);assert.deepEqual(requests,['fixture/world-fixes/complete.json']);}finally{root.destroy({children:true});}
});

test('vegetation shadow changes preserve colour passes and hidden actor state',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const root=new Container3D(),sources=[],masks=new Map(),original=BatchedMesh3D.prototype.setItemActive;let world,visible=true,revision=0;
 BatchedMesh3D.prototype.setItemActive=function(index,mask){masks.set(this.label+':'+index,mask);return original.call(this,index,mask);};
 const policy={get revision(){return revision;},summary:{},visible:()=>visible,setWarState(){revision++;}};
 const prototypes=[{name:'Bush',kind:'environment',category:'vegetation',file:'bush.gltf',placements:[{actor:'bush',matrix:identity}]}];
 try{world=await loadWorldModels({region:'fixture',root,vegetationShadows:false,optimize:false,actorVisibility:policy,status(){},teamAt:()=> 'NONE',json:async path=>path.endsWith('world.json')?{prototypes}:{assets:{}},loadModel:async()=>{const source=await triangle();sources.push(source);return source;}});
  assert.deepEqual([...masks.values()],[RenderPassBit.OPAQUE]);world.setVegetationShadows(true);assert.deepEqual([...masks.values()],[RenderPassBit.OPAQUE|RenderPassBit.SHADOW]);
  visible=false;world.setWarState({});world.setVegetationShadows(false);world.setVegetationShadows(true);assert.deepEqual([...masks.values()],[0]);
  visible=true;world.setWarState({});assert.deepEqual([...masks.values()],[RenderPassBit.OPAQUE|RenderPassBit.SHADOW]);world.setVegetationShadows(false);world.setWarState({});assert.deepEqual([...masks.values()],[RenderPassBit.OPAQUE]);
 }finally{BatchedMesh3D.prototype.setItemActive=original;world?.dispose();root.destroy({children:true});sources.forEach(source=>source.destroy());globalThis.location=saved;}
});

test('tree, nature and blueprint rock requests load only their own native meshes',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};
 const prototypes=[{name:'Fir02',category:'vegetation',file:'tree.glb'},{name:'Bush',category:'vegetation',file:'bush.glb'},{name:'Cluster_C/StaticMesh',path:'War/Content/Meshes/Environment/Props/RockShorlineCliff.uasset',category:'structures',file:'rock.glb'},{name:'Crate',category:'structures',file:'crate.glb'}].map(p=>({...p,kind:'environment',placements:[{actor:p.name,matrix:identity}]}));
 try{for(const [category,file]of [['trees','tree.glb'],['vegetation','bush.glb'],['rocks','rock.glb'],['structures','crate.glb']]){
  const root=new Container3D(),sources=[],requests=[];let world;
  try{world=await loadWorldModels({region:'fixture',root,categories:[category],optimize:false,status(){},teamAt:()=> 'NONE',json:async path=>path.endsWith('world.json')?{prototypes}:{assets:{}},loadModel:async path=>{requests.push(path);const source=await triangle();sources.push(source);return source;}});
   assert.deepEqual(requests,['fixture/'+file]);assert.deepEqual(world.counts.failed,[]);assert.equal(world.layers[category].children.length,1);assert.equal(world.counts.placements,1);
  }finally{world?.dispose();root.destroy({children:true});sources.forEach(source=>source.destroy());}
 }}finally{globalThis.location=saved;}
});

test('buildings load promoted native assemblies while props retain independent scenery',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};
 const prototypes=[
  {name:'UniqueWWarehouseG3_C/HouseMesh',file:'warehouse.glb'},
  {name:'UniqueWWarehouseG3_C/RoofMesh',file:'roof.glb'},
  {name:'Barn2',file:'barn.glb'},
  {name:'Crate',file:'crate.glb'},
  {name:'MetalLightBarn',file:'lamp.glb'},
 ].map(p=>({...p,category:'structures',kind:'environment',placements:[{actor:p.name.startsWith('Unique')?'warehouse':p.name,matrix:identity}]}));
 try{for(const [category,files]of [['building',['warehouse.glb','roof.glb','barn.glb']],['structures',['crate.glb','lamp.glb']]]){
  const root=new Container3D(),sources=[],requests=[];let world;
  try{world=await loadWorldModels({region:'fixture',root,categories:[category],optimize:false,status(){},teamAt:()=> 'NONE',
   worldData:{prototypes},json:async()=>({assets:{}}),loadModel:async path=>{requests.push(path);const source=await triangle();sources.push(source);return source;}});
   assert.deepEqual(requests.sort(),files.map(file=>'fixture/'+file).sort());
   assert.equal(world.counts.placements,files.length);assert.deepEqual(world.counts.failed,[]);
   assert.equal(world.layers[category==='building'?'structures':'building'].children.length,0,'the other toggle owns none of these meshes');
  }finally{world?.dispose();root.destroy({children:true});sources.forEach(source=>source.destroy());}
 }}finally{globalThis.location=saved;}
});

test('transport loads bridge fixtures and rail assemblies while props keep independent scenery',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};
 const prototypes=[
  {name:'BPTrainBridgeA_C/TrimMesh',path:'War/Content/Meshes/Environment/Props/SteelBeam01.uasset',file:'bridge-beam.glb'},
  {name:'BPLoadingDock_C/Rope01',file:'dock-rope.glb'},
  {name:'BPPreplacedRailTrackSplineFoundation_C/BackSwitchMesh',file:'switch.glb'},
  {name:'BPRailBumper_C/StaticMesh',file:'buffer.glb'},
  {name:'BPAircraftRunwayT1_C/$Catalog',file:'runway.glb'},
  {name:'StaticMeshActor',path:'War/Content/Meshes/Environment/Props/TrainCar02.uasset',file:'train-car.glb'},
  {name:'Wagon02',file:'wagon.glb'},
  {name:'CastleFence3_C/StaticMesh',path:'War/Content/Meshes/Environment/Props/WetlandsWalkwayPlanks07.uasset',file:'fence.glb'},
  {name:'UniqueWTrainStationG1_C/StaticMesh',path:'War/Content/Meshes/Environment/Props/Railroad_03.uasset',file:'station.glb'},
 ].map(p=>({...p,category:'structures',kind:'environment',placements:[{actor:p.name,matrix:identity}]}));
 try{for(const [category,files]of [['infrastructure',['bridge-beam.glb','dock-rope.glb','buffer.glb','runway.glb','train-car.glb']],['structures',['wagon.glb','fence.glb']],['building',['station.glb']]]){
  const root=new Container3D(),sources=[],requests=[];let world;
  try{world=await loadWorldModels({region:'fixture',root,categories:[category],optimize:false,status(){},teamAt:()=> 'NONE',worldData:{prototypes},json:async()=>({assets:{}}),loadModel:async path=>{requests.push(path);const source=await triangle();sources.push(source);return source;}});
   assert.deepEqual(requests.sort(),files.map(file=>'fixture/'+file).sort());assert.equal(world.counts.placements,files.length);assert.deepEqual(world.counts.failed,[]);
   assert.ok(!requests.includes('fixture/switch.glb'),'rail switch proxies remain owned by the dedicated native rail pass');
   for(const other of ['infrastructure','structures','building'].filter(key=>key!==category))assert.equal(world.layers[other].children.length,0);
  }finally{world?.dispose();root.destroy({children:true});sources.forEach(source=>source.destroy());}
 }}finally{globalThis.location=saved;}
});


test('Rocks requests natural ice and underwater meshes while Props keeps masonry and planks',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};
 const prototypes=[
  {name:'BPIcePlatform02_C/StaticMesh9',path:'War/Content/Meshes/Environment/Props/IcePlatformSharp_03.uasset',file:'ice-cluster.glb'},
  {name:'IcePlatformSoft_09',file:'ice.glb'},
  {name:'SnowRocks',file:'snow-rocks.glb'},
  {name:'StaticMeshActor',path:'War/Content/Meshes/Environment/Props/UnderWaterRockShorelineLarge.uasset',file:'underwater-rock.glb'},
  {name:'BrokenRockStoneWall1_C/Brick1h',path:'War/Content/Meshes/Environment/Towns/Walls/Brick1h.uasset',file:'wall.glb'},
  {name:'PlatformPeice01',file:'plank.glb'},
 ].map(p=>({...p,category:'structures',kind:'environment',placements:[{actor:p.name,matrix:identity}]}));
 try{for(const [category,files]of [['rocks',['ice-cluster.glb','ice.glb','snow-rocks.glb','underwater-rock.glb']],['structures',['wall.glb','plank.glb']]]){
  const root=new Container3D(),sources=[],requests=[];let world;
  try{world=await loadWorldModels({region:'fixture',root,categories:[category],optimize:false,status(){},teamAt:()=> 'NONE',worldData:{prototypes},json:async()=>({assets:{}}),loadModel:async path=>{requests.push(path);const source=await triangle();sources.push(source);return source;}});
   assert.deepEqual(requests.sort(),files.map(file=>'fixture/'+file).sort());assert.equal(world.counts.placements,files.length);assert.deepEqual(world.counts.failed,[]);
   assert.equal(world.layers[category==='rocks'?'structures':'rocks'].children.length,0);
  }finally{world?.dispose();root.destroy({children:true});sources.forEach(source=>source.destroy());}
 }}finally{globalThis.location=saved;}
});
