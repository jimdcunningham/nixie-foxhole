import test from 'node:test';
import assert from 'node:assert/strict';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';

// Reference the original area coverage and accumulation order so fractional
// boundaries and half-value rounding remain byte-identical to published data.
function referenceWeights(bytes,width,height,layers,maxSize){
 const scale=Math.min(1,maxSize/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
 if(w===width&&h===height)return {bytes,width,height};
 const out=new Uint8Array(w*h*layers),sx=width/w,sy=height/h;
 for(let layer=0;layer<layers;layer++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const left=x*sx,right=(x+1)*sx,top=y*sy,bottom=(y+1)*sy;let value=0,weight=0;
  for(let iy=Math.floor(top);iy<Math.ceil(bottom)&&iy<height;iy++){
   const wy=Math.min(bottom,iy+1)-Math.max(top,iy);
   for(let ix=Math.floor(left);ix<Math.ceil(right)&&ix<width;ix++){
    const index=(layer*height+iy)*width+ix,f=wy*(Math.min(right,ix+1)-Math.max(left,ix));weight+=f;value+=bytes[index]*f;
   }
  }
  out[(layer*h+y)*w+x]=Math.round(value/weight);
 }
 return {bytes:out,width:w,height:h};
}

test('weight resize preserves exact area-filter bytes across fractional layers',()=>{
 let state=0x9e3779b9;const rand=n=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)%n;};
 for(let n=0;n<400;n++){
  const width=1+rand(160),height=1+rand(140),layers=1+rand(4),cap=1+rand(180),bytes=new Uint8Array(width*height*layers);
  for(let i=0;i<bytes.length;i++)bytes[i]=rand(256);
  const expected=referenceWeights(bytes,width,height,layers,cap),actual=resizeTerrainPixels(bytes,width,height,layers,cap,{channels:1});
  assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);
  assert.deepEqual(actual.bytes,expected.bytes,`case ${n}: ${width}x${height}x${layers}, cap ${cap}`);
 }
});

test('weight resize keeps native-size ownership and rejects malformed reduced input',()=>{
 const bytes=new Uint8Array([0,255,128,64]);
 assert.equal(resizeTerrainPixels(bytes,2,2,1,2,{channels:1}).bytes,bytes);
 assert.throws(()=>resizeTerrainPixels(bytes.subarray(1),2,2,1,1,{channels:1}),/Invalid terrain pixel dimensions/);
 assert.deepEqual(bytes,new Uint8Array([0,255,128,64]));
});
