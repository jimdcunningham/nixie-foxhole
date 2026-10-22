import test from 'node:test';
import assert from 'node:assert/strict';
import {splitVertices} from '../authoring/split-vertices.mjs';
test('interleaved attribute splitting preserves native bytes and chunk offsets',()=>{
 const source=new Float32Array(80);for(let i=0;i<source.length;i++)source[i]=i%11===0?-0:Math.sin(i)*123;
 for(const [offset,count]of [[0,10],[2,5],[10,0]]){
  const a=splitVertices(source,offset,count),expected={p:new Float32Array(count*3),n:new Float32Array(count*3),uv:new Float32Array(count*2)};
  for(let i=0;i<count;i++){const at=(offset+i)*8;expected.p.set(source.subarray(at,at+3),i*3);expected.n.set(source.subarray(at+3,at+6),i*3);expected.uv.set(source.subarray(at+6,at+8),i*2);}
  assert.deepEqual(a,expected);
 }
});
