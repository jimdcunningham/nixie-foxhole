import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {generateTerrainSliceTier,generateTerrainSliceTiers} from '../authoring/terrain-slice-tier.mjs';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('all generated sizes are independently filtered from original color and normal pixels',async()=>{
 const size=1024,pixels=new Uint8Array(size*size*4);let rng=123456789;
 for(let i=0;i<pixels.length;i+=4){rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;pixels[i]=rng&255;pixels[i+1]=(rng>>>8)&255;pixels[i+2]=(rng>>>16)&255;pixels[i+3]=(i%28===0)?0:255;}
 const bytes=await sharp(pixels,{raw:{width:size,height:size,channels:4}}).png().toBuffer();
 for(const kind of ['color','normal']){
  const options={kind,size,sourceHash:hash(bytes),pixelHash:hash(pixels)},targets=[128,256,512];
  const tiers=await generateTerrainSliceTiers(bytes,{...options,targets});
  for(let i=0;i<targets.length;i++){
   const target=targets[i],tier=tiers[i],expected=resizeTerrainPixels(pixels,size,size,1,target,{kind}).bytes;
   assert.equal(tier.width,target);assert.equal(tier.height,target);assert.equal(tier.pixelHash,hash(expected));
   const single=await generateTerrainSliceTier(bytes,{...options,target});assert.deepEqual(tier.bytes,single.bytes);
  }
 }
});
test('multi-tier generation rejects duplicate, empty or source-sized targets',async()=>{
 for(const targets of [[],[128,128],[128,256],[0]])await assert.rejects(generateTerrainSliceTiers(Buffer.alloc(1),{kind:'color',size:256,sourceHash:'a'.repeat(64),targets}),/Invalid terrain tier source/);
});
