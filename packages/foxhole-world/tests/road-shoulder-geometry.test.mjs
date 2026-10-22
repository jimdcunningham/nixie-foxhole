import test from 'node:test';
import assert from 'node:assert/strict';
import {shoulderChunk} from '../authoring/road-shoulder-geometry.mjs';
test('shoulder vertices retain first-use indexing, native offsets and terrain normals',()=>{
 const p=new Float32Array([0,1,0,1,1,0,0,1,1,1,1,1]),indices=new Uint32Array([2,0,1,2,1,3]);
 const out=shoulderChunk({p,indices,distance:()=>0,sample:(x,z)=>2*x-z}),len=Math.sqrt(6);
 assert.deepEqual(out.ix,new Uint32Array([0,1,2,0,2,3]));
 assert.deepEqual(out.p,new Float32Array([0,1.06,1,0,1.06,0,1,1.06,0,1,1.06,1]));
 assert.deepEqual(out.n,new Float32Array(Array.from({length:4},()=>[-2/len,1/len,1/len]).flat()));
 assert.deepEqual(out.uv,new Float32Array([2.045,0,1.045,0,-.955,0,.045,0]));
 const missing=shoulderChunk({p,indices,distance:()=>0,sample:()=>null});
 assert.deepEqual(missing.uv,new Float32Array([10000,0,10000,0,10000,0,10000,0]));
 assert.equal(shoulderChunk({p,indices,distance:()=>3,sample:()=>0}),null);
});
