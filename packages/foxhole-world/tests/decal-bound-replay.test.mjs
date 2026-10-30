import test from 'node:test';
import assert from 'node:assert/strict';
import {replayDecalSource,replayBoundDecalSource} from '../authoring/decal-recipe-replay.mjs';

function fixture(){
 const source=new Float32Array(27);let at=0;
 for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++){source[at++]=x;source[at++]=(x+z)*0.125;source[at++]=z;}
 const triangle=2*(945*2184+1092);
 return {terrain:source,meta:{min:[-1,0,-1],max:[1,0,1]},bank:new Map(),recipe:{chunks:[{sourceVertices:3,polygonOffset:0,polygonCount:1}],polygons:new Uint32Array([0,0,triangle]),projectors:[{inv:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],ext:[100,100,100],offset:0.125}],receivers:[]}};
}
function original(f,bindings,exceptions){
 const source=replayDecalSource(f.recipe,f.meta,f.terrain,f.bank),out=new Float32Array(bindings.length*8);
 for(let i=0;i<bindings.length;i++){const id=bindings[i],exception=id>=source.length/8,p=exception?exceptions:source,at=(exception?id-source.length/8:id)*8;out.set(p.subarray(at,at+8),i*8);}return out;
}
function bytes(array){return new Uint8Array(array.buffer,array.byteOffset,array.byteLength);}

test('direct bound replay matches source assembly with reordered vertices and exceptions',()=>{
 const f=fixture(),bindings=new Uint32Array([2,0,3,1]),exceptions=new Float32Array([-0,3.25,-7.5,0.5,1.125,0,0.3,1]);
 const expected=original(f,bindings,exceptions),actual=replayBoundDecalSource(f.recipe,f.meta,f.terrain,f.bank,bindings,exceptions);
 assert.ok(actual);assert.deepEqual(bytes(actual),bytes(expected));
});
test('direct bound replay handles unreferenced vertices and exception-only output',()=>{
 const f=fixture(),exceptions=new Float32Array([1,2,3,4,5,6,7,8]);
 for(const bindings of [new Uint32Array([]),new Uint32Array([1]),new Uint32Array([3])]){
  const actual=replayBoundDecalSource(f.recipe,f.meta,f.terrain,f.bank,bindings,exceptions);
  assert.ok(actual);assert.deepEqual(bytes(actual),bytes(original(f,bindings,exceptions)));
 }
});
test('duplicate and oversized bindings request the original replay fallback',()=>{
 const f=fixture(),duplicate=new Uint32Array([0,0]),exceptions=new Float32Array();
 assert.equal(replayBoundDecalSource(f.recipe,f.meta,f.terrain,f.bank,duplicate,exceptions),null);
 assert.equal(original(f,duplicate,exceptions).length,16);
 assert.equal(replayBoundDecalSource(f.recipe,f.meta,f.terrain,f.bank,{length:0xffffffff},exceptions),null);
 const oversized={...f.recipe,chunks:[{sourceVertices:0xffffffff,polygonOffset:0,polygonCount:0}]};
 assert.equal(replayBoundDecalSource(oversized,f.meta,f.terrain,f.bank,new Uint32Array(),exceptions),null);
});
