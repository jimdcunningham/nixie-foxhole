import test from 'node:test';import assert from 'node:assert/strict';
import {Texture} from 'pixi.js';
import {Container3D,parseGltf} from '@pixi/3d';
import {nativeMaterialPeer} from '../authoring/native-material-peer.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const peer={name:'BPCoverStreetlamp1a_C/StaticMesh',file:'peer.gltf',category:'structures',materials:[{name:'FireBarrel'},{name:'StreetLamp',diffuse:'StreetlampA.png'},{name:'GlassBasic'}],placements:[]};
const broken={name:'BPCoverStreetlamp1aSouth_C/StaticMesh',file:'south.gltf',category:'structures',materials:Array.from({length:3},()=>({name:'WorldGridMaterial',diffuse:null})),placements:[{actor:'south',matrix:identity}]};
async function model(names){const positions=new Float32Array([0,0,0,1,0,0,0,1,0]);return parseGltf({asset:{version:'2.0'},buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],materials:names.map((name,i)=>({name,pbrMetallicRoughness:{baseColorFactor:[.1+i*.2,.2,.3,1]}})),meshes:[{primitives:names.map((_,i)=>({attributes:{POSITION:0},material:i}))}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0},[positions.buffer]);}
test('material recovery only accepts the known placeholder lamp and a complete authored peer',()=>{
 assert.equal(nativeMaterialPeer(broken,[peer]),peer);
 assert.equal(nativeMaterialPeer({...broken,name:'Unrelated/StaticMesh'},[peer]),null);
 assert.equal(nativeMaterialPeer({...broken,materials:[{name:'StreetLamp'}]},[peer]),null);
 assert.equal(nativeMaterialPeer(broken,[]),null);
});
test('a streamed southern lamp recovers all slots from an off-cell peer without changing source materials or geometry',async()=>{
 const originalLocation=globalThis.location;globalThis.location={search:''};const source=await model(broken.materials.map(m=>m.name)),reference=await model(peer.materials.map(m=>m.name)),root=new Container3D(),loads=[];let world;
 try{
  world=await loadWorldModels({region:'fixture',root,optimize:false,status(){},teamAt:()=> 'NONE',worldData:{prototypes:[broken]},visibilityData:{prototypes:[peer,broken]},json:async()=>({assets:{}}),loadModel:async url=>{loads.push(url);return url.includes('peer.gltf')?reference:source;}});
  assert.deepEqual(world.counts.failed,[]);assert.equal(world.batches[0].size,3);assert.equal(loads.length,2);
  for(let i=0;i<3;i++)assert.equal(world.batches[0].items[i].material,reference.materials[i]);
  assert.equal(source.materials[1].textures.baseColor,Texture.WHITE);assert.notEqual(source.materials[1],reference.materials[1]);
  assert.equal(world.batches[0].items[1].geometry.indexBuffer.data.length,3);
 }finally{world?.dispose();root.destroy({children:true});source.destroy();reference.destroy();globalThis.location=originalLocation;}
});
