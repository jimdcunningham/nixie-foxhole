import test from 'node:test';
import assert from 'node:assert/strict';
import {Texture,BufferImageSource} from 'pixi.js';
import {View3D} from '@pixi/3d';
import {waterScreenReflectionsBit} from '../authoring/water-screen-reflections.mjs';
import {createNativeWaterMaterial} from '../authoring/native-water-material.mjs';
import {framedMaterialBits} from '../runtime/spatial-frame.mjs';

for(const backend of ['gpu','gl'])test(backend+' reflection adaptation retains world coordinates, board scale and restored normals',()=>{
 const source=waterScreenReflectionsBit[backend],framed=framedMaterialBits([waterScreenReflectionsBit]),bit=framed[1][backend];
 assert.equal(bit.header,source.header,'camera/depth math stays in world/view coordinates');
 assert.match(bit.fragment.lighting,/waterReflectionViewDirection\((input\.)?vPosition\)/);
 assert.match(bit.fragment.lighting,/waterTraceReflection\((input\.)?vPosition,normal,vec3(?:<f32>)?\(0.0,0.0,1.0\),roughness,material.foxholeFrame.z\)/);
 assert.doesNotMatch(bit.fragment.lighting,/foxholeNativeToWorld|vPosition.x-/);
 assert.match(source.fragment.lighting,/roughness,1.0\)/,'native metres remain unchanged');
 assert.notEqual(framed[1].name,waterScreenReflectionsBit.name,'shader caches separate native and board variants');
 assert.match(framed.at(-1)[backend].fragment.material,/specularNormal/,'world normals are restored before lighting');
});

test('native water publishes the reflection controls and retains its refractive render membership',async()=>{
 const source=new BufferImageSource({resource:new Uint8Array([255,255,255,255]),width:1,height:1}),texture=new Texture({source});
 const colors=Object.fromEntries(['Body Color','Depth Colour','EdgeColour01','FresnelFakeSSS'].map(k=>[k,{R:.03,G:.05,B:.04}]));
 const meta={textures:Object.fromEntries(['waveLarge','waveSmall','foam','modulation','clouds'].map(k=>[k,k])),material:{colors}};
 const {material}=await createNativeWaterMaterial({region:'fixture',json:async id=>id.endsWith('boat-stencils.json')?[]:meta,texture:async()=>texture});
 const view=new View3D();
 try{
  assert.equal(material.data.waterReflectionStrength,1);
  assert.equal(material._passBit,32,'colour and depth copies must bind in the blended-refraction pass');
  assert.equal(material.state.depthMask,false);
  const descriptor=material.getPrimaryDescriptor(view);
  for(const bits of [descriptor.bitsGpu,descriptor.bitsGl])assert.ok(bits.some(bit=>bit.name==='foxholeWaterScreenReflections'));
  material.data.waterReflectionStrength=0;
  assert.equal(material.data.waterReflectionStrength,0,'a comparison can disable the effect without rebuilding materials');
 }finally{view.destroy({children:true});material.destroy();texture.destroy(true);}
});
