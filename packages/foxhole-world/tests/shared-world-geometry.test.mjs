import {leaseFlattenedGeometry} from '../authoring/shared-model-geometry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,parseGltf,Geometry3D,Matrix4} from '@pixi/3d';
import {loadWorldModels} from '../authoring/world-models.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
async function source(){const a=new Float32Array([0,0,0,1,0,0,0,1,0]);return parseGltf({asset:{version:'2.0'},buffers:[{byteLength:a.byteLength}],bufferViews:[{buffer:0,byteLength:a.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],materials:[{name:'Body'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0},[a.buffer]);}
test('resident native cells share flattened buffers and release only the final lease',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const src=await source(),roots=[],worlds=[];
 async function load(anchor){const root=new Container3D();roots.push(root);const world=await loadWorldModels({region:'fixture',root,status(){},teamAt:()=> 'NONE',json:async p=>p.endsWith('world.json')?{prototypes:[{name:'Prop',file:'prop.glb',category:'structures',anchor,placements:[{actor:'prop',matrix:identity}]}]}:{assets:{}},loadModel:async()=>src});assert.deepEqual(world.counts.failed,[]);worlds.push(world);return world;}
 try{
  const a=await load(),b=await load(),g=a.batches[0].items[0].geometry,buffer=g.attributes.aPosition.buffer;
  assert.equal(g,b.batches[0].items[0].geometry);
  a.dispose();assert.notEqual(buffer.destroyed,true);assert.ok(b.batches[0].items[0].geometry.attributes.aPosition.buffer.data);
  const shifted=await load({x:2,y:0,z:0});assert.notEqual(shifted.batches[0].items[0].geometry,g);
  b.dispose();assert.equal(buffer.destroyed,true);assert.notEqual(src.geometries[0][0].destroyed,true);
  const reloaded=await load();assert.notEqual(reloaded.batches[0].items[0].geometry,g);assert.notEqual(reloaded.batches[0].items[0].geometry.destroyed,true);
 }finally{for(const w of worlds)w.dispose();for(const r of roots)r.destroy({children:true});src.destroy();globalThis.location=saved;}
});

test('geometry leases isolate color layouts, mutable input matrices and dynamic sources',()=>{
 const source=new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2])}),matrix=new Matrix4();matrix.elements[12]=5;
 const a=leaseFlattenedGeometry(source,matrix,false),b=leaseFlattenedGeometry(source,matrix,true);
 try{
  assert.notEqual(a.geometry,b.geometry);assert.equal(a.geometry.attributes.aColor,undefined);assert.ok(b.geometry.attributes.aColor);
  matrix.elements[12]=9;assert.equal(a.vertices[0][0],5,'lazy clipping vertices retain their original local transform');
  source.dynamic=true;const x=leaseFlattenedGeometry(source,matrix,false),y=leaseFlattenedGeometry(source,matrix,false);
  assert.notEqual(x.geometry,y.geometry);x.release();y.release();
 }finally{a.release();a.release();b.release();source.destroy(true);}
});

test('a rejected world load releases flattened leases even without a partial-scene callback',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const src=await source(),root=new Container3D(),controller=new AbortController();
 try{
  await assert.rejects(loadWorldModels({region:'fixture',root,signal:controller.signal,status(){},teamAt:()=> 'NONE',json:async p=>p.endsWith('world.json')?{prototypes:[{name:'Prop',file:'prop.glb',category:'structures',placements:[{actor:'prop',matrix:identity}]}]}:{assets:{}},loadModel:async()=>src,publishBatch:build=>{const batch=build();controller.abort();return batch;}}),{name:'AbortError'});
  const matrix=new Matrix4();matrix.elements[10]=-1;const probe=leaseFlattenedGeometry(src.geometries[0][0],matrix,false),buffer=probe.geometry.attributes.aPosition.buffer;
  probe.release();assert.equal(buffer.destroyed,true,'no lease from the rejected load may remain');
 }finally{root.destroy({children:true});src.destroy();globalThis.location=saved;}
});
