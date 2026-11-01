import {framedMaterialBits} from "../runtime/spatial-frame.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {Texture,BufferImageSource} from 'pixi.js';
import {Container3D,parseGltf,RenderPassBit,View3D} from '@pixi/3d';
import {retainContainedWaterMaterials,containedWaterMaterials,createContainedWaterResolver} from '../runtime/contained-water.mjs';
import {createNativeWaterMaterial} from '../authoring/native-water-material.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';
const profile={color:[.01,.009769,.006244],opacity:.9,roughness:.1};
const native={name:'Puddles_Inst2',extras:{foxholeMaterialFamily:'puddles',foxholeMaterialSource:'War/Content/Materials/Puddles_Inst2.uasset'},pbrMetallicRoughness:{baseColorFactor:[...profile.color,profile.opacity],roughnessFactor:profile.roughness},alphaMode:'BLEND'};
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
async function model(){
 const vertices=new Float32Array([0,0,0,1,0,0,0,0,1]);
 const doc={asset:{version:'2.0'},buffers:[{byteLength:vertices.byteLength}],bufferViews:[{buffer:0,byteLength:vertices.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,0,1]}],materials:[native,{name:'Puddles_Inst2'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0},{attributes:{POSITION:0},material:1}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 return retainContainedWaterMaterials(await parseGltf(doc,[vertices.buffer]),doc);
}
test('native family identity selects water and concurrent model users share one owned replacement',async()=>{
 const source=await model(),original=source.materials[0],snapshot=original.data.baseColor.slice();let creates=0;
 const resolve=createContainedWaterResolver(async options=>{creates++;assert.deepEqual(options,profile);return {water:true};});
 try{
  assert.equal(containedWaterMaterials(source).size,1);
  const [a,b]=await Promise.all([resolve(source),resolve(source)]);
  assert.equal(creates,1);assert.equal(a.get(original).material,b.get(original).material);
  assert.equal(a.has(source.materials[1]),false,'a colliding display name is not native identity');
  assert.deepEqual(original.data.baseColor,snapshot,'borrowed source materials stay unchanged');
 }finally{source.destroy();}
});
test('contained surfaces use real refraction and reflections without native boat stencils',async()=>{
 const texture=new Texture({source:new BufferImageSource({resource:new Uint8Array([128,128,255,255]),width:1,height:1})}),requested=[];
 const colors=Object.fromEntries(['Body Color','Depth Colour','EdgeColour01','FresnelFakeSSS'].map(k=>[k,{R:.03,G:.05,B:.04}])),meta={textures:Object.fromEntries(['waveLarge','waveSmall','foam','modulation','clouds'].map(k=>[k,k])),material:{colors}};
 const {material}=await createNativeWaterMaterial({region:'fixture',contained:profile,json:async id=>{requested.push(id);return meta;},texture:async()=>texture}),view=new View3D();
 try{
  assert.equal(material._passBit,RenderPassBit.BLENDED_REFRACTION);assert.equal(material.state.depthMask,true);
  assert.equal(material.data.waterSurface[0],1);assert.ok(Math.abs(material.data.waterSurface[1]-.9)<1e-6);assert.ok(Math.abs(material.data.waterSurface[2]-.1)<1e-6);assert.ok([...material.data.waterBody].every((v,i)=>Math.abs(v-[...profile.color,1][i])<1e-6));
  assert.equal(requested.some(id=>id.endsWith('boat-stencils.json')),false);
  // The same material must fit the fixed row after the board-frame vector is added.
  const framed=new material.constructor({extraBits:framedMaterialBits([...material._featureBits||[],...material._extraBits]),alphaMode:material.alphaMode});
  try{framed.data.waterSurface=material.data.waterSurface;assert.equal(framed.data.waterSurface[0],1);}finally{framed.destroy();}
  const descriptor=material.getPrimaryDescriptor(view);
  for(const bits of [descriptor.bitsGpu,descriptor.bitsGl]){assert.ok(bits.some(b=>b.name==='foxholeWaterScreenReflections'));assert.ok(bits.some(b=>b.name==='foxholeNativeWater2'));assert.equal(bits.some(b=>b.name.startsWith('foxholeBoat')),false);}
 }finally{view.destroy({children:true});material.destroy();texture.destroy(true);}
});
test('world assembly keeps contained water in refraction, preserves geometry, and retains actor visibility',async()=>{
 const previous=globalThis.location;globalThis.location={search:''};
 const source=await model(),root=new Container3D(),texture=Texture.WHITE;
 const colors=Object.fromEntries(['Body Color','Depth Colour','EdgeColour01','FresnelFakeSSS'].map(k=>[k,{R:.03,G:.05,B:.04}]));let material,world;
 try{
  const resolver=createContainedWaterResolver(async contained=>({material}=await createNativeWaterMaterial({region:'fixture',contained,json:async()=>({textures:{},material:{colors}}),texture:async()=>texture}),material));
  world=await loadWorldModels({region:'fixture',root,optimize:false,status(){},teamAt:()=> 'NONE',prepareMaterials:resolver,worldData:{prototypes:[{name:'UnrelatedBarrelBlueprint/Water',category:'structures',kind:'environment',file:'water.gltf',placements:[{actor:'barrel',matrix}]}]},json:async()=>({assets:{}}),loadModel:async()=>source});
  assert.deepEqual(world.counts.failed,[]);const batch=world.batches[0];
  assert.equal(batch.items[0].material,material);assert.equal(batch.items[1].material,source.materials[1]);
  assert.equal(batch.items[0]._lastRenderPass,RenderPassBit.BLENDED_REFRACTION);
  assert.equal(batch.items[0].geometry.indexBuffer.data.length,3);
  world.setWarState(null);assert.equal(batch.items[0]._lastRenderPass,RenderPassBit.BLENDED_REFRACTION);
  world.dispose();assert.equal(material.destroyed,false,'the owning layer releases custom materials after its batches');
 }finally{world?.dispose();root.destroy({children:true});source.destroy();material?.destroy();globalThis.location=previous;}
});
