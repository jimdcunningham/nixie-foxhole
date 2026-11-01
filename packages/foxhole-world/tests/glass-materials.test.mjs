import test from 'node:test';
import assert from 'node:assert/strict';
import {glassProfile,translateGlass} from '../glass-materials.mjs';
const row={path:'War/Content/Materials/Environment/GlassBasic.uasset',blend:'BLEND_Translucent',properties:{TwoSided:true,Expressions:[{ObjectPath:'War/Content/Materials/Environment/Glass.35'}]},colors:{'Diffuse Color':{R:.06,G:.073855,B:.08,A:0}},scalars:{'Overall Opacity':.2,Metallic:0,Roughness:.5,NPower:0},switches:{'Diffuse Texture?':true,'Mat Texture?':false,'Normal Map?':true},textures:{'Diffuse Texture':{path:'native.diffuse'}}};
const material=()=>({name:'unrelated display name',pbrMetallicRoughness:{baseColorFactor:[.06,.073855,.08,.2],baseColorTexture:{index:0},metallicRoughnessTexture:{index:1},metallicFactor:1,roughnessFactor:1},normalTexture:{index:2,scale:1},emissiveFactor:[.2,.1,.01],extensions:{KHR_materials_emissive_strength:{emissiveStrength:0}},extras:{foxholeMaterialSource:row.path}});
test('glass requires qualified master and explicit switches rather than basename matching',()=>{
 assert.ok(glassProfile(row));assert.equal(glassProfile({...row,properties:{}}),null);assert.equal(glassProfile({...row,switches:{}}),null);assert.equal(glassProfile({...row,scalars:{...row.scalars,'Overall Opacity':NaN}}),null);
});
test('native diffuse texture branch replaces the color instead of multiplying a dark tint',async()=>{
 const m=material(),night=structuredClone({emissiveFactor:m.emissiveFactor,extensions:m.extensions});const requested=[];
 await translateGlass({material:m,row,image:async()=>({index:3}),nativeImage:async path=>{requested.push(path);return new Uint8Array([1]);}});
 assert.deepEqual(m.pbrMetallicRoughness.baseColorFactor,[1,1,1,.2]);assert.deepEqual(requested,['native.diffuse']);assert.equal(m.pbrMetallicRoughness.baseColorTexture.index,3);
 assert.equal(m.pbrMetallicRoughness.metallicRoughnessTexture,undefined);assert.equal(m.pbrMetallicRoughness.roughnessFactor,.5);assert.equal(m.pbrMetallicRoughness.metallicFactor,0);
 assert.deepEqual(m.normalTexture,{index:2,scale:1},'do not guess the stripped native NPower lerp');assert.deepEqual({emissiveFactor:m.emissiveFactor,extensions:m.extensions},night);assert.equal(m.doubleSided,true);
 const saved=structuredClone(m);assert.equal(await translateGlass({material:m,row}),false);assert.deepEqual(m,saved);
});
test('color and disabled normal branches remove unused maps while preserving unresolved packed surfaces',async()=>{
 const m=material(),native={...row,switches:{'Diffuse Texture?':false,'Mat Texture?':true,'Normal Map?':false},scalars:{...row.scalars,'Overall Opacity':.5}};let requests=0;
 await translateGlass({material:m,row:native,image:()=>{requests++;}});
 assert.deepEqual(m.pbrMetallicRoughness.baseColorFactor,[.06,.073855,.08,.5]);assert.equal(m.pbrMetallicRoughness.baseColorTexture,undefined);assert.equal(m.normalTexture,undefined);assert.equal(requests,0);assert.deepEqual(m.pbrMetallicRoughness.metallicRoughnessTexture,{index:1});assert.equal(m.alphaMode,'BLEND');
});
