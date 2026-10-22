import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGltf,Container3D,RenderPassBit} from '@pixi/3d';
import {Texture} from 'pixi.js';
import {loadWorldModels} from '../authoring/world-models.mjs';
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
async function model(masked){
 const data=new Float32Array([0,0,0,1,0,0,0,1,0]),doc={asset:{version:'2.0'},buffers:[{byteLength:data.byteLength}],bufferViews:[{buffer:0,byteLength:data.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],materials:[{name:'Ivy',...(masked?{alphaMode:'MASK',alphaCutoff:0.35}:{} )},{name:'Frame'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0},{attributes:{POSITION:0},material:1}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 const source=await parseGltf(doc,[data.buffer]);source.materials[0].textures.baseColor=masked?Texture.WHITE:Texture.EMPTY;return source;
}
test('building foliage restores the existing cutout texture without changing solid parts',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const root=new Container3D(),sources=[];let world;
 const proto=(name,file,masked,path='War/Content/Meshes/Environment/Foliage/Ivy12.uasset')=>({name,file,path,kind:'environment',category:'structures',materials:[{name:'Ivy',diffuse:'model-textures/IvyC.png',masked},{name:'Frame',masked:false}],placements:[{matrix}]});
 const bad=proto('Greenhouse/Ivy','bad.gltf',false),reference=proto('Ivy05','reference.gltf',true),solid=proto('PaintedWall','wall.gltf',false,'War/Content/Meshes/Environment/Towns/Wall.uasset');
 try{
  world=await loadWorldModels({region:'fixture',root,status(){},teamAt:()=> 'NONE',json:async path=>path.endsWith('/world.json')?{prototypes:[bad,reference,solid]}:path.endsWith('/lod-manifest.json')?{assets:{'bad.gltf':{levels:[{file:'lod1.glb'},{file:'lod2.glb'}]}}}:{assets:{}},loadModel:async url=>{const s=await model(url.endsWith('reference.gltf'));sources.push({url,s});return s;}});
  assert.deepEqual(world.counts.failed,[]);assert.deepEqual(world.counts.lodFailures,[]);
  const target=sources.find(x=>x.url.endsWith('bad.gltf')).s.materials[0],wall=sources.find(x=>x.url.endsWith('wall.gltf')).s.materials[0];
  assert.equal(target.alphaMode,'mask');
  assert.equal(target.alphaCutoff,0.35);
  assert.equal(target.textures.baseColor,Texture.WHITE,'the alpha-bearing peer texture replaces the stripped RGB copy');
  assert.equal(target.state.depthMask,true);
  assert.equal(wall.alphaMode,'opaque','matching names on non-foliage geometry do not change');
  assert.equal(wall.textures.baseColor,Texture.EMPTY);
  assert.ok(sources.filter(x=>x.url.endsWith('bad.gltf')).every(x=>x.s.materials[1].alphaMode==='opaque'));
  assert.ok(world.batches.filter(b=>b.lodOnly).every(b=>b.items[0].material===target),'LODs reuse the restored full-detail cutout material');
  assert.ok(world.batches.every(b=>b.items.every(i=>(i._lastRenderPass&RenderPassBit.OPAQUE)!==0)));
 }finally{world?.dispose();root.destroy({children:true});for(const {s} of sources)s.destroy();globalThis.location=saved;}
});
