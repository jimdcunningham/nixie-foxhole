import test from 'node:test';
import assert from 'node:assert/strict';
import {attributeReader} from '../authoring/geometry-attributes.mjs';
test('model attribute fast path retains exact values, strides, offsets and fallbacks',()=>{
 for(const byteOffset of [4,5]){
  const buffer=new ArrayBuffer(128),data=new Uint8Array(buffer,byteOffset,100),view=new DataView(buffer,byteOffset,100);
  const values=[-0,Math.PI,1.25,-26.75,Infinity,NaN];
  for(let i=0;i<2;i++)for(let k=0;k<3;k++)view.setFloat32(4+i*24+k*4,values[i*3+k],true);
  const read=attributeReader({attributes:{position:{buffer:{data},format:'float32x3',offset:4,stride:24}}},'position',4,[0,0,0,1]);
  for(let i=0;i<2;i++)for(let k=0;k<3;k++)assert.ok(Object.is(read(i,k),view.getFloat32(4+i*24+k*4,true)));
  assert.equal(read(0,3),1);
 }
});
test('normalized fast readers retain all integer values and unaligned fallbacks exactly',()=>{
 for(const format of ['snorm16x4','unorm16x4','unorm8x4'])for(const baseOffset of [0,1]){
  const bits=format.includes('16')?16:8,step=bits/8,stride=8*step,offset=2*step,count=65536,raw=new Uint8Array(count*stride+baseOffset),data=raw.subarray(baseOffset),view=new DataView(data.buffer,data.byteOffset,data.byteLength),fallback=[0,0,0,1,7];
  for(let i=0;i<count;i++)for(let k=0;k<4;k++){const at=offset+i*stride+k*step;if(bits===16)view.setUint16(at,(i+k)&65535,true);else view.setUint8(at,(i+k)&255);}
  const read=attributeReader({attributes:{test:{buffer:{data},format,stride,offset}}},'test',5,fallback);
  for(let i=0;i<count;i++)for(let k=0;k<5;k++){const at=offset+i*stride+k*step,expected=k===4?7:format.startsWith('snorm')?Math.max(-1,view.getInt16(at,true)/32767):bits===8?view.getUint8(at)/255:view.getUint16(at,true)/65535;assert.ok(Object.is(read(i,k),expected));}
 }
});
