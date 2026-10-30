import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {generateTerrainSliceTier} from '../authoring/terrain-slice-tier.mjs';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function source(){const pixels=Buffer.alloc(256*256*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=(i/4)%256;pixels[i+1]=(i/1024)%256;pixels[i+2]=99;pixels[i+3]=i%20?255:0;}const bytes=await sharp(pixels,{raw:{width:256,height:256,channels:4}}).png().toBuffer();return{bytes,pixels};}
test('generated tiers retain exact runtime-filtered pixels and deterministic bytes',async()=>{
 const {bytes,pixels}=await source();for(const kind of ['color','normal']){
  const options={kind,size:256,sourceHash:hash(bytes),pixelHash:hash(pixels)};
  const one=await generateTerrainSliceTier(bytes,options),two=await generateTerrainSliceTier(bytes,options);
  const expected=resizeTerrainPixels(pixels,256,256,1,128,{kind}).bytes;
  assert.equal(one.pixelHash,hash(expected));assert.equal(one.width,128);assert.equal(one.height,128);assert.deepEqual(one.bytes,two.bytes);
  const decoded=await sharp(one.bytes).ensureAlpha().raw().toBuffer();assert.deepEqual(decoded,Buffer.from(expected));
 }
});
test('tier generation rejects invalid content and out-of-budget input',async()=>{
 const {bytes,pixels}=await source(),options={kind:'color',size:256,sourceHash:hash(bytes),pixelHash:hash(pixels)};
 await assert.rejects(generateTerrainSliceTier(bytes,{...options,sourceHash:'0'.repeat(64)}),/source integrity/);
 await assert.rejects(generateTerrainSliceTier(bytes,{...options,pixelHash:'0'.repeat(64)}),/pixel integrity/);
 await assert.rejects(generateTerrainSliceTier(bytes,{...options,size:4097}),/Invalid terrain tier source/);
 await assert.rejects(generateTerrainSliceTier(bytes,{...options,size:512}),/image dimensions/);
 await assert.rejects(generateTerrainSliceTier(bytes,{...options,target:256}),/Invalid terrain tier source/);
});
