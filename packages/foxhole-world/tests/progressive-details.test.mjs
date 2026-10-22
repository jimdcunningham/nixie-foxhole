import test from 'node:test';import assert from 'node:assert/strict';
import {Container3D,BatchedMesh3D} from '@pixi/3d';import {Texture} from 'pixi.js';
import {loadWorldDetails} from '../authoring/world-details.mjs';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
async function fixture({nativeRoadTransitions=false,roadMaterial='Props/RoadBlend',category}={}){
 const root=new Container3D();root.visible=false;const seam=defer(),waiting=defer(),owned=[],materials=[];
 const v=new Float32Array([0,0,0,0,1,0,0,0, 1,0,0,0,1,0,1,0, 0,0,1,0,1,0,0,1]),vertices=new Float32Array([...v,...v]),indices=new Uint32Array([0,1,2,0,1,2]);
 const bit={name:'testDetails',gpu:{fragment:{material:''}},gl:{fragment:{material:''}}};
 const meta={chunks:[{material:'Props/Dirt',vertexOffset:0,vertexCount:3,indexOffset:0,indexCount:3},{material:roadMaterial,category,vertexOffset:3,vertexCount:3,indexOffset:3,indexCount:3}],coverage:[]};
 const source=Object.fromEntries(meta.chunks.map(c=>[c.material,{file:'color.png',ormFile:'orm.png',tint:0xffffff,normalScale:1}]));
 const json=async key=>key.endsWith('details/render.json')?meta:key.endsWith('details/materials.json')?source:key.endsWith('effects/render.json')?{materials:{},placements:[],emitters:{},unsupported:[]}:key.endsWith('utility/render.json')?{materials:{},placements:[]}:{};
 const seams={then(resolve,reject){waiting.resolve();return seam.promise.then(resolve,reject);}};
 const loading=loadWorldDetails({region:'test',nativeRoadTransitions,root,json,zipped:async key=>key.endsWith('vertices.bin.gz')?vertices.buffer:indices.buffer,texture:async()=>Texture.WHITE,geo:g=>(owned.push(g),g),mat:m=>(materials.push(m),m),hexBit:bit,weatherSurfaceBit:{...bit,name:'testWeather'},weatherMaterial:m=>m,bridgeRoadSeams:seams});
 await waiting.promise;
 return {root,seam,loading,owned,materials,meta,cleanup(){root.destroy({children:true});for(const g of owned)if(!g.destroyed)g.destroy(true);for(const m of materials)if(!m.destroyed)m.destroy();}};
}
test('progressive details never attach a partially initialized batch, even under a hidden parent',async()=>{
 const f=await fixture();
 try{
  // Pixi updates dirty slots of attached batches even when their parent is hidden.
  assert.ok(f.root.children.every(c=>!(c instanceof BatchedMesh3D)||c.items.every(i=>i.material&&i.geometry)),'all attached slots must already have geometry and material');
  f.seam.resolve(null);await f.loading;assert.equal(f.root.children.length,1);const batch=f.root.children[0];assert.equal(batch.items.length,2);assert.ok(batch.items.every(i=>i.material&&i.geometry));
 }finally{f.seam.resolve(null);await f.loading;f.cleanup();}
});
test('bridge dependency failure leaves no projected decal batch attached',async()=>{
 const f=await fixture();f.seam.reject(Error('bridge preparation failed'));
 try{await assert.rejects(f.loading,/bridge preparation failed/);assert.equal(f.root.children.length,0);}finally{f.cleanup();}
});

test('native transitions replace terrain road blend decals without changing cached metadata',async()=>{
 const f=await fixture({nativeRoadTransitions:true,roadMaterial:'War/Content/Materials/Decals/RoadBlendDirt01.RoadBlendDirt01',category:'terrain'});
 try{f.seam.resolve(null);const result=await f.loading;assert.equal(result.summary.replacedRoadBlendChunks,1);assert.equal(f.root.children[0].items.length,1);assert.equal(f.materials.length,1);assert.equal(f.meta.chunks.length,2);result.syncLayers({decals:false});result.syncLayers({decals:true});assert.equal(f.root.children[0].items.length,1);}finally{f.cleanup();}
});
test('native transitions retain markings and decals on model receivers',async()=>{
 for(const options of [{roadMaterial:'War/Content/Materials/Decals/RoadStreakIndustrial.RoadStreakIndustrial',category:'terrain'},{roadMaterial:'War/Content/Materials/Decals/RoadBlendDirt01.RoadBlendDirt01',category:'structures'}]){
  const f=await fixture({nativeRoadTransitions:true,...options});
  try{f.seam.resolve(null);const result=await f.loading;assert.equal(result.summary.replacedRoadBlendChunks,0);assert.equal(f.root.children[0].items.length,2);}finally{f.cleanup();}
 }
});
test('details consumers without native transitions retain original road blend decals',async()=>{
 const f=await fixture({roadMaterial:'War/Content/Materials/Decals/RoadBlendDirt01.RoadBlendDirt01',category:'terrain'});
 try{f.seam.resolve(null);const result=await f.loading;assert.equal(result.summary.replacedRoadBlendChunks,0);assert.equal(f.root.children[0].items.length,2);}finally{f.cleanup();}
});
