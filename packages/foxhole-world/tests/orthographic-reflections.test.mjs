import test from 'node:test';
import assert from 'node:assert/strict';
import {Material3D,BaseMaterial3D,View3D,ShaderDescriptor} from '@pixi/3d';
import {prepareCameraRelativeMaterial} from '../runtime/camera-relative-material.mjs';
import {framedMaterialBits} from '../runtime/spatial-frame.mjs';
import {nativeWaterBit} from '../authoring/native-water-bit.mjs';
import {waterScreenReflectionsBit} from '../authoring/water-screen-reflections.mjs';
import {withOrthographicPlanningReflections,orthographicReflectionBit} from '../runtime/orthographic-reflections.mjs';

test('imported models and framed puddles share the orthographic policy without mutating material parameters',()=>{
 const view=new View3D();
 try{for(const extraBits of [[],framedMaterialBits([{name:'nativePuddleTerrainIntersection'}])]){
  const material=new Material3D({roughness:.1,metallic:1,alpha:.9,extraBits}),original=material.getPrimaryDescriptor(view);
  try{prepareCameraRelativeMaterial(material);const descriptor=material.getPrimaryDescriptor(view);
   assert.notEqual(descriptor,original);assert.equal(material.getPrimaryDescriptor(view),descriptor);
   for(const key of ['bitsGpu','bitsGl'])assert.equal(descriptor[key].filter(b=>b===orthographicReflectionBit).length,1);
   assert.equal(material.roughness,Math.fround(.1));assert.equal(material.metallic,1);assert.equal(material.alpha,.9);
   assert.ok(!original.bitsGpu.includes(orthographicReflectionBit));
  }finally{material.destroy();}
 }}finally{view.destroy();}
});

test('sky and ocean reflections consume the same fade after native frame restoration',()=>{
 const view=new View3D(),material=new Material3D({extraBits:framedMaterialBits([nativeWaterBit,waterScreenReflectionsBit])});

 try{prepareCameraRelativeMaterial(material);const descriptor=material.getPrimaryDescriptor(view);
  for(const [backend,key] of [['gpu','bitsGpu'],['gl','bitsGl']]){
   const bits=descriptor[key],last=bits.at(-1);
   assert.equal(last,orthographicReflectionBit);
   assert.ok(bits.findIndex(b=>b.name==='foxholeNativeFrameEnd:material')<bits.indexOf(last));
   assert.match(last[backend].fragment.material,/uViewMatrix\[0\]\[2\]/);
   assert.match(last[backend].fragment.material,/metallic \*= foxholeReflectionScale/);
   assert.match(bits.find(b=>b.name.startsWith('foxholeWaterScreenReflections'))[backend].fragment.lighting,/waterReflectionStrength\*foxholeReflectionScale/);
  }
 }finally{material.destroy();view.destroy();}
});

test('IBL adaptation scales reflected sky light while retaining diffuse irradiance and source bits',async()=>{
 const {iblBit}=await import('@pixi/3d');
 const source=[{name:'pbrMaterial'},iblBit],adapted=withOrthographicPlanningReflections(source);
 for(const backend of ['gl','gpu']){
  assert.match(adapted[1][backend].fragment.lighting,/foxholeReflectionScale \* \(FssEss \* radiance \+ FmsEms \* irradiance\) \+ k_D \* irradiance/);
  assert.doesNotMatch(iblBit[backend].fragment.lighting,/foxholeReflectionScale/);
 }
 const custom=new BaseMaterial3D({descriptor:new ShaderDescriptor({template:{gpu:'custom'}})}),view=new View3D();
 try{const original=custom.getPrimaryDescriptor(view);prepareCameraRelativeMaterial(custom);assert.equal(custom.getPrimaryDescriptor(view),original);}finally{custom.destroy();view.destroy();}
});
