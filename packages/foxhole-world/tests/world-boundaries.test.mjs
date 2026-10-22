import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,clipWorld} from '../authoring/world-geometry.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
test('boundary classification retains the hexagon and shared floor tolerances',()=>{
 const box={min:[-1,-1,-1],max:[1,1,1]};
 assert.equal(classify(box,identity),'inside');
 for(const [x,y,z,expected]of [[1092,0,0,'crossing'],[1200,0,0,'outside'],[0,-220,0,'crossing'],[0,-222,0,'outside'],[0,0,946,'crossing'],[0,0,948,'outside']]){
  const m=[...identity];m[12]=x;m[13]=y;m[14]=z;assert.equal(classify(box,m),expected);
 }
});
test('clipping preserves interior vertex attributes exactly and clips boundary intersections',()=>{
 const vertices=[[0,0,0,0,1,0,0,0],[0,0,2,0,1,0,0,1],[2,0,0,0,1,0,1,0]],indices=new Uint32Array([0,1,2]);
 assert.deepEqual(clipWorld(vertices,indices,identity),{vertices,indices});
 const m=[...identity];m[12]=1091;
 const result=clipWorld(vertices,indices,m);
 assert.ok(result.indices.length>0);assert.ok(result.vertices.every(v=>Math.abs(v[0])+Math.abs(v[2])*546/945<=1092+1e-8));
 assert.ok(result.vertices.every(v=>v[3]===0&&v[4]===1&&v[5]===0));
});

test('boundary geometry keeps shared source vertices indexed without welding material seams',()=>{
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const vertices=[[0,0,0,0,1,0,0,0],[10,0,0,0,1,0,1,0],[0,0,10,0,1,0,0,1],[10,0,10,0,1,0,1,1],[0,0,0,0,1,0,.5,.5]],indices=new Uint32Array([0,1,2,1,3,2,4,1,2]);
 const result=clipWorld(vertices,indices,identity);
 assert.equal(result.vertices.length,5,'shared source indices must not expand into nine vertex arrays');
 assert.deepEqual([...result.indices].map(i=>result.vertices[i]),[...indices].map(i=>vertices[i]));
 assert.notEqual(result.indices[0],result.indices[6],'coincident UV seams remain distinct');
});
