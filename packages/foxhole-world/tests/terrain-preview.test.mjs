import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTerrainPreview} from '../runtime/terrain-preview.mjs';
import {inHex} from '../authoring/terrain-tools.mjs';

test('loading preview is bounded, follows sampled relief and clips to the region hex',()=>{
 const mesh=buildTerrainPreview((x,z)=>2*x+3*z+5);assert.ok(mesh.positions.length/3<20000);assert.ok(mesh.indices.length/3<40000);assert.ok(mesh.positions.byteLength+mesh.normals.byteLength+mesh.indices.byteLength<1024**2);
 for(let i=0;i<mesh.positions.length;i+=3){const [x,y,z]=mesh.positions.subarray(i,i+3);assert.ok(inHex(x,z,.001));assert.ok(Math.abs(y-(2*x+3*z+5))<.002);assert.ok(Math.abs(mesh.normals[i+1]-1/Math.sqrt(14))<1e-6);}
 for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.subarray(i,i+3),p=mesh.positions;const cross=(p[b*3+2]-p[a*3+2])*(p[c*3]-p[a*3])-(p[b*3]-p[a*3])*(p[c*3+2]-p[a*3+2]);assert.ok(cross>=-1e-6);}
});

test('missing landscape samples create holes rather than false zero-height terrain',()=>{const mesh=buildTerrainPreview((x,z)=>x>0?null:10);assert.ok(mesh.indices.length);assert.ok([...mesh.positions].every(Number.isFinite));for(let i=0;i<mesh.positions.length;i+=3){assert.ok(mesh.positions[i]<=1e-6);assert.equal(mesh.positions[i+1],10);}const empty=buildTerrainPreview(()=>null);assert.equal(empty.indices.length,0);assert.equal(empty.positions.length,0);});
