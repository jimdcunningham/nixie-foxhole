import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,Geometry3D,GeometryAtlasPool,parseGltf} from '@pixi/3d';
import {createMirroredGeometryCache,isMirroredTransform} from '../authoring/mirrored-geometry.mjs';
import {clipWorld,transform} from '../authoring/world-geometry.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mirror=x=>[-1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1];
const vertices=[[0,0,0,0,1,0,0,0],[0,0,2,0,1,0,0,1],[3,0,0,0,1,0,1,0]],ix=new Uint32Array([0,1,2]);
function facing(v,indices,m=identity){for(let i=0;i<indices.length;i+=3){const [a,b,c]=[0,1,2].map(k=>transform(v[indices[i+k]],m)),u=b.map((x,j)=>x-a[j]),w=c.map((x,j)=>x-a[j]);assert.ok(u[2]*w[0]-u[0]*w[2]>0,'triangle must face the same upward direction as its shading normals');}}

test('mirrored boundary and floor clipping retain outward triangle winding',()=>{
 for(const x of [0,1091]){const cut=clipWorld(vertices,ix,mirror(x));facing(cut.vertices,cut.indices);}
 const sloped=vertices.map((v,i)=>v.map((n,k)=>k===1?(i===2?-222:-218):n));
 const floorCut=clipWorld(sloped,ix,mirror(0));assert.ok(floorCut.indices.length);assert.ok(floorCut.vertices.every(v=>v[1]>=-220));facing(floorCut.vertices,floorCut.indices);
 assert.equal(isMirroredTransform(mirror(0)),true);assert.equal(isMirroredTransform(identity),false);
});

test('mirrored variants reuse all vertex buffers and own only their reversed indices',()=>{
 const g=new Geometry3D({positions:new Float32Array(vertices.flatMap(v=>v.slice(0,3))),normals:new Float32Array(vertices.flatMap(v=>v.slice(3,6))),indices:ix}),cache=createMirroredGeometryCache(),v=cache.get(g),buffer=g.attributes.aPosition.buffer;
 assert.equal(cache.get(g),v);assert.equal(v.attributes.aPosition.buffer,buffer);assert.deepEqual([...g.indexBuffer.data],[0,1,2]);assert.deepEqual([...v.indexBuffer.data],[0,2,1]);
 assert.deepEqual(v.bounds3D,g.bounds3D);assert.deepEqual(v.boundsSphere,g.boundsSphere);
 const reversed=v.indexBuffer;cache.destroy();assert.equal(reversed.destroyed,true);assert.equal(buffer.destroyed,false);assert.equal(g.indexBuffer.destroyed,false);g.destroy(true);
});

test('model assembly corrects mirrored placements in full detail, both LODs, and boundary cuts',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const root=new Container3D(),sources=[];let world;
 const json=async path=>path.endsWith('/world.json')?{prototypes:[{name:'MirroredProp',file:'base.gltf',kind:'environment',category:'structures',placements:[{matrix:identity},{matrix:mirror(0)},{matrix:mirror(1091)}]}]}:path.endsWith('/lod-manifest.json')?{assets:{'base.gltf':{levels:[{file:'lod1.glb'},{file:'lod2.glb'}]}}}:{assets:{}};
 const loadModel=async()=>{const p=new Float32Array(vertices.flatMap(v=>v.slice(0,3))),doc={asset:{version:'2.0'},buffers:[{byteLength:p.byteLength}],bufferViews:[{buffer:0,byteLength:p.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[3,0,2]}],materials:[{name:'Paint'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0},s=await parseGltf(doc,[p.buffer]);sources.push(s);return s;};
 try{world=await loadWorldModels({region:'fixture',root,json,loadModel,status(){},teamAt:()=> 'NONE'});assert.deepEqual(world.counts.failed,[]);assert.deepEqual(world.counts.lodFailures,[]);
  for(const b of world.batches){for(let i=0;i<b.items.length;i++){const g=b.items[i].geometry,v=Array.from({length:g.vertexCount},(_,j)=>[...g.attributes.aPosition.buffer.data.slice(j*3,j*3+3)]);facing(v,g.indexBuffer.data,i===1?mirror(0):identity);}}
 }finally{world?.dispose();root.destroy({children:true});for(const s of sources)s.destroy();globalThis.location=saved;}
});

test('retiring streamed source geometry also frees its reflected atlas allocation',()=>{
 const cache=createMirroredGeometryCache(),pool=new GeometryAtlasPool({rebaseIndices:false});
 try{
  for(let i=0;i<200;i++){
   const source=new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2])});
   const reflected=cache.get(source),indices=reflected.indexBuffer,allocation=pool.allocate(reflected),atlas=allocation.atlas;
   source.destroy(true);
   assert.ok(reflected._geometryAtlasAllocation===null,'a retired source must not leave its reflected copy resident in the global atlas');
   assert.equal(indices.destroyed,true);
   assert.equal(atlas._liveAllocations.length,0,'repeated streaming must not accumulate retired reflected geometry');
  }
  assert.doesNotThrow(()=>cache.destroy());
 }finally{cache.destroy();pool.clear();}
});

test('reflected cache teardown tolerates geometry already destroyed by another owner',()=>{
 const source=new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2])}),cache=createMirroredGeometryCache();
 const reflected=cache.get(source),positions=source.positions,indices=reflected.indexBuffer;
 reflected.destroy(false);
 assert.doesNotThrow(()=>cache.destroy());
 assert.equal(indices.destroyed,true);
 assert.equal(source.positions,positions);
 assert.equal(source.indexBuffer.destroyed,false);
 source.destroy(true);
});
