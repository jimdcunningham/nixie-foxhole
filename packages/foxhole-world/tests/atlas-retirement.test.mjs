import test from 'node:test';
import assert from 'node:assert/strict';
import {Geometry3D,GeometryAtlas} from '@pixi/3d';
import {prepareAtlasRetirement} from '../runtime/atlas-retirement.mjs';

test('atlas growth resources survive frame encoding and retire after submission without destroying live geometry',()=>{
 const reference=new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2])});
 const atlas=new GeometryAtlas({referenceGeometry:reference,initialVertexCapacity:4,initialIndexCapacity:4});
 const oldVertex=atlas._vertexBuffer,oldIndex=atlas._indexBuffer,oldGeometry=atlas.geometry;
 const large=new Geometry3D({positions:new Float32Array(300),indices:new Uint32Array(150)}),allocation=atlas.add(large),version=atlas._bufferVersion;
 const hooks=[],deferred=[],renderer={runners:{postrender:{add(h){hooks.push(h)}}}},options={pools:()=>[{_atlases:{a:atlas}}],defer:fn=>deferred.push(fn)};
 prepareAtlasRetirement(renderer,options);prepareAtlasRetirement(renderer,options);assert.equal(hooks.length,1);
 hooks[0].postrender();assert.equal(oldVertex.destroyed,false);assert.equal(oldIndex.destroyed,false);assert.equal(deferred.length,1);
 deferred.shift()();assert.equal(oldVertex.destroyed,true);assert.equal(oldIndex.destroyed,true);assert.equal(oldGeometry.buffers,null);
 assert.equal(atlas._vertexBuffer.destroyed,false);assert.equal(atlas._indexBuffer.destroyed,false);assert.equal(atlas._bufferVersion,version);assert.equal(large._geometryAtlasAllocation,allocation);assert.equal(atlas._retiredBuffers.length,0);
 hooks[0].postrender();deferred.shift()();assert.equal(atlas._vertexBuffer.destroyed,false);
 atlas.destroy();large.destroy(true);reference.destroy(true);
});