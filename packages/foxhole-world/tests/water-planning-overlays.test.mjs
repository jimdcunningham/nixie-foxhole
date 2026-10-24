import test from 'node:test';
import assert from 'node:assert/strict';
import {Texture,BufferImageSource} from 'pixi.js';
import {View3D} from '@pixi/3d';
import {createTerrainPlanningOverlays} from '../authoring/terrain-planning-overlays.mjs';
import {createNativeWaterMaterial} from '../authoring/native-water-material.mjs';
import {framedMaterialBits} from '../runtime/spatial-frame.mjs';

const icon=(x,z)=>({iconType:20,x:x/2184+.5,y:.5-z/1890});

test('water uses the shared RDZ mask without terrain contours or changing refraction and depth',async()=>{
 const planning=createTerrainPlanningOverlays();
 const source=new BufferImageSource({resource:new Uint8Array([128,128,128,255]),width:1,height:1}),texture=new Texture({source});
 const colors=Object.fromEntries(['Body Color','Depth Colour','EdgeColour01','FresnelFakeSSS'].map(k=>[k,{R:.03,G:.05,B:.04}]));
 const meta={textures:Object.fromEntries(['waveLarge','waveSmall','foam','modulation','clouds'].map(k=>[k,k])),material:{colors}};
 const {material}=await createNativeWaterMaterial({region:'fixture',json:async id=>id.endsWith('boat-stencils.json')?[]:meta,texture:async()=>texture,extraBits:[planning.waterBit]});
 assert.ok(material._textures.length<=8,'water must fit the WebGL packed sampler indices');
 const view=new View3D();
 try{
  const descriptor=material.getPrimaryDescriptor(view);
  for(const bits of [descriptor.bitsGpu,descriptor.bitsGl])assert.ok(bits.some(bit=>bit.name==='waterPlanningOverlays'),'water must paint RDZ on its visible surface');
  planning.set({rdz:true,topo:true},{items:[icon(0,850)]});planning.bindWater(material);
  assert.deepEqual(Array.from(material.data.terrainOverlayInfo),Array.from(planning.info));
  assert.equal(material.textures.baseColor.source,planning.source,'terrain and water share one exemption texture');
  const sameTexture=material.textures.baseColor;
  planning.set({rdz:true},{items:Array.from({length:300},(_,i)=>icon(-100+i*.5,850))});planning.bindWater(material);
  assert.equal(material.textures.baseColor,sameTexture);assert.equal(planning.source.height,5);
  assert.equal(material.data.terrainOverlayInfo[2],300,'new exemptions reach water without rebuilding its material');
  planning.set({rdz:false,topo:true});planning.bindWater(material);
  assert.equal(material.data.terrainOverlayInfo[0],0);assert.equal(material.data.terrainOverlayInfo[1],1);
  assert.equal(material._passBit,32);assert.equal(material.state.depthMask,true);assert.equal(material.state.depthTest,true);
 }finally{view.destroy({children:true});material.destroy();planning.destroy();texture.destroy(true);}
});

for(const backend of ['gpu','gl'])test(backend+' water RDZ uses native region coordinates after board framing and omits Topo',()=>{
 const planning=createTerrainPlanningOverlays();
 try{
  const bit=planning.waterBit;assert.ok(bit,'a water-compatible planning bit is required');
  const native=bit[backend],framed=framedMaterialBits([bit])[1][backend];
  assert.match(native.fragment.end,/material.terrainOverlayInfo.x>0.5/);
  assert.doesNotMatch(native.fragment.end,/planningContour|planningWidth|terrainOverlayInfo.y>/,'water never shows elevation contour lines');
  assert.match(framed.fragment.end,/material.foxholeFrame/,'RDZ widths and exemptions stay in native metres');
  assert.match(framed.header,/sampleBaseColorDirect/,'the existing byte mask is read through material texture slots');
 }finally{planning.destroy();}
});