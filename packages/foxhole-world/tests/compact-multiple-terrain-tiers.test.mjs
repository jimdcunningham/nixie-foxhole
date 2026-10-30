import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import sharp from 'sharp';
import {publishCompactWorld} from '../publish-compact.mjs';
import {generateTerrainSliceTier} from '../authoring/terrain-slice-tier.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('publisher keeps smaller tiers in the resource graph, deduplicates shared slices, and omits larger tiers',async()=>{
 const root=await fs.mkdtemp(path.join(path.resolve('.tmp'),'terrain-multitier-'));
 try{
  const size=1024,pixels=Buffer.alloc(size*size*4);let rng=246813579;
  for(let i=0;i<pixels.length;i+=4){rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;pixels[i]=rng&255;pixels[i+1]=(rng>>>8)&255;pixels[i+2]=(rng>>>16)&255;pixels[i+3]=255;}
  const options={raw:{width:size,height:size,channels:4}},large=await sharp(pixels,options).png().toBuffer(),small=await sharp(pixels,options).webp({quality:1}).toBuffer();
  const sample=(bytes,pixelHash)=>({blob:hash(bytes),bytes:bytes.length,width:size,height:size,...(pixelHash?{pixelHash}:{})}),a=sample(large,hash(pixels)),b=sample(small);
  const viewer=path.join(root,'prepared','viewer'),input=path.dirname(viewer),target=path.join(root,'delivery');
  for(const name of ['dependency-bundles/regions','recipe-rollout/regions'])await fs.mkdir(path.join(viewer,name),{recursive:true});await fs.mkdir(path.join(input,'blobs'),{recursive:true});
  const blobs={};for(const [slice,bytes]of [[a,large],[b,small]]){await fs.writeFile(path.join(input,'blobs',slice.blob),bytes);blobs[slice.blob]={bytes:bytes.length,entry:{blob:slice.blob,bytes:bytes.length,codec:'image'}};}
  await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs}));
  await fs.writeFile(path.join(viewer,'recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  await fs.writeFile(path.join(viewer,'recipe-rollout/regions/test.json'),JSON.stringify({version:1,region:'test',terrain:{},roads:{parts:{}}}));
  await fs.writeFile(path.join(viewer,'dependency-bundles/regions/test.json'),JSON.stringify({resources:{'test/terrain-live/albedo-0.bin.gz':{codec:'rgba-image-array',size,slices:[a,a,b]}}}));
  const result=await publishCompactWorld({input,target,terrainSourceMaxSize:null}),region=result.index.regions.test,doc=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,region.manifest.path))));
  const rows=doc.resources['test/terrain-live/albedo-0.bin.gz'].slices;
  for(const targetSize of [128,256,512]){
   const tier=rows[0].tiers[targetSize];assert.equal(tier.width,targetSize);assert.equal(tier.height,targetSize);assert.equal(rows[1].tiers[targetSize].resource.path,tier.resource.path);
   const encoded=await fs.readFile(path.join(target,tier.resource.path));assert.equal(hash(encoded),tier.resource.hash);
   assert.equal(doc.physicalResources.filter(ref=>ref.path===tier.resource.path).length,1);
   if(targetSize!==128)assert.ok(encoded.length<large.length);
  }
  assert.equal(rows[0].resource.hash,a.blob);assert.equal(rows[2].resource.hash,b.blob);assert.ok(rows[2].tiers[128]);
  let omitted=0;
  for(const targetSize of [256,512]){
   const tier=await generateTerrainSliceTier(small,{kind:'color',size,sourceHash:b.blob,target:targetSize});
   if(tier.bytes.length>=small.length){omitted++;assert.equal(rows[2].tiers[targetSize],undefined);}
   else{assert.ok(rows[2].tiers[targetSize]);assert.ok(doc.physicalResources.some(ref=>ref.path===rows[2].tiers[targetSize].resource.path));}
  }
  assert.ok(omitted>0,'fixture must exercise a tier larger than its source');
  assert.equal(region.downloadBytes,doc.physicalResources.reduce((total,ref)=>total+ref.bytes,region.manifest.bytes));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
