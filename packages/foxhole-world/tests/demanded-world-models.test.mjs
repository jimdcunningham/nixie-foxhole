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
