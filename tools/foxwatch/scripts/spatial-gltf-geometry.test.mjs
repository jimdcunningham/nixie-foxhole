import assert from 'node:assert/strict';
import test from 'node:test';
import { pruneUnusedStaticGltfUvs } from './spatial-gltf-geometry.mjs';
function fixture() {
 return { buffers:[{byteLength:900}], bufferViews:Array.from({length:9},(_,i)=>({buffer:0,byteOffset:i*100,byteLength:20})),
  accessors:Array.from({length:8},(_,i)=>({bufferView:i,count:3,componentType:5126,type:'VEC2'})),
  images:[{bufferView:8,mimeType:'image/png'}], materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],
  meshes:[{primitives:[{material:0,attributes:{POSITION:0,TEXCOORD_0:1,TEXCOORD_1:2,TEXCOORD_2:3,TEXCOORD_7:4,NORMAL:5,COLOR_0:6},indices:7,targets:[{POSITION:0}]}]}] };
}
test('unused UV payload is pruned while position, normal, color, index and image views keep their original bytes',()=>{
 const d=fixture();const material=structuredClone(d.materials);const views=structuredClone(d.bufferViews);
 const stats=pruneUnusedStaticGltfUvs(d);assert.equal(stats.removedUvAttributes,3);
 const p=d.meshes[0].primitives[0];assert.deepEqual(Object.keys(p.attributes),['POSITION','TEXCOORD_0','NORMAL','COLOR_0']);
 for(const [name,oldIndex] of [['POSITION',0],['TEXCOORD_0',1],['NORMAL',5],['COLOR_0',6]]){
  assert.deepEqual(d.bufferViews[d.accessors[p.attributes[name]].bufferView],views[oldIndex]);
 }
 assert.deepEqual(d.bufferViews[d.accessors[p.indices].bufferView],views[7]);
 assert.deepEqual(d.bufferViews[d.images[0].bufferView],views[8]);assert.equal(p.targets[0].POSITION,p.attributes.POSITION);
 assert.deepEqual(d.materials,material);assert.equal(d.bufferViews.length,6);
});
test('normal-map UVs and texture-transform UV overrides are retained',()=>{
 const d=fixture();d.materials[0].normalTexture={index:1,texCoord:1};
 d.materials[0].pbrMetallicRoughness.baseColorTexture.extensions={KHR_texture_transform:{texCoord:2}};
 pruneUnusedStaticGltfUvs(d);assert.deepEqual(Object.keys(d.meshes[0].primitives[0].attributes),['POSITION','TEXCOORD_0','TEXCOORD_1','TEXCOORD_2','NORMAL','COLOR_0']);
});
test('unbaked rigs and animated models are rejected without partial edits',()=>{
 for(const key of ['skins','animations']) {const d=fixture();d[key]=[{}];const before=structuredClone(d);
  assert.throws(()=>pruneUnusedStaticGltfUvs(d),/baked static/);assert.deepEqual(d,before);
 }
});
