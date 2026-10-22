import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGltf,Container3D} from '@pixi/3d';
import {retainModelMaterialNames,modelMaterialNames} from '../runtime/model-material-names.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';

const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
async function source(names){
 const data=new Float32Array([0,0,0,1,0,0,0,1,0]);
 const doc={asset:{version:'2.0'},buffers:[{byteLength:data.byteLength}],bufferViews:[{buffer:0,byteLength:data.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],materials:names.map(name=>({name})),meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 return retainModelMaterialNames(await parseGltf(doc,[data.buffer]),doc);
}

test('duplicate glTF names retain identities for every original slot',async()=>{
 const s=await source(['Paint','Paint']);
 assert.equal(s.material.Paint,s.materials[1]);
 assert.equal(Object.entries(s.material).find(([,m])=>m===s.materials[0]),undefined);
 const names=modelMaterialNames(s);
 assert.equal(names.get(s.materials[0]),'Paint');assert.equal(names.get(s.materials[1]),'Paint');s.destroy();
});

test('standalone loader recovers only compatible exported slot metadata',()=>{
 const a={},b={},s={materials:[a,b],material:{Paint:b}};
 assert.equal(modelMaterialNames(s,['Paint','Paint']).get(a),'Paint');
 assert.equal(modelMaterialNames(s,['Paint','Wrong']).get(a),'');
 assert.equal(modelMaterialNames(s,['Paint']).get(a),'');
});

test('world assembly matches duplicated LOD materials to the full-detail material',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};
 const sources=[],root=new Container3D();let world;
 try{
  world=await loadWorldModels({region:'fixture',root,status(){},teamAt:()=> 'NONE',json:async name=>name.endsWith('/world.json')?{prototypes:[{name:'PaintedProp',path:'fixture',file:'base.gltf',kind:'environment',category:'structures',placements:[{matrix,actor:'prop'}]}]}:name.endsWith('/lod-manifest.json')?{assets:{'base.gltf':{levels:[{file:'lod1.glb'},{file:'lod2.glb'}]}}}:{assets:{}},loadModel:async url=>{const s=await source(url.endsWith('base.gltf')?['Paint']:['Paint','Paint']);sources.push(s);return s;}});
  assert.deepEqual(world.counts.failed,[]);assert.deepEqual(world.counts.lodFailures,[]);
  assert.equal(world.counts.lodResources,2);assert.equal(world.lodRecords.length,1);
  const materials=world.batches.map(b=>b.items[0].material);
  assert.ok(materials.every(m=>m===sources[0].materials[0]));
 }finally{world?.dispose();root.destroy({children:true});for(const s of sources)s.destroy();globalThis.location=saved;}
});
