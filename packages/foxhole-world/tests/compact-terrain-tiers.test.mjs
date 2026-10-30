import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {brotliDecompressSync} from 'node:zlib';import sharp from 'sharp';
import {publishCompactWorld} from '../publish-compact.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('compact publication declares optional deduplicated terrain variants and retains originals',async()=>{
 const root=await fs.mkdtemp(path.join(path.resolve('.tmp'),'terrain-tiers-'));
 try{
  const input=path.join(root,'prepared'),viewer=path.join(input,'viewer');
  for(const name of ['dependency-bundles/regions','recipe-rollout/regions'])await fs.mkdir(path.join(viewer,name),{recursive:true});await fs.mkdir(path.join(input,'blobs'),{recursive:true});
  const pixels=Buffer.alloc(256*256*4,123);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
  const image=await sharp(pixels,{raw:{width:256,height:256,channels:4}}).png().toBuffer(),blob=hash(image),slice={blob,bytes:image.length,width:256,height:256,pixelHash:hash(pixels)},entry={blob,bytes:image.length,codec:'image'};
  await fs.writeFile(path.join(input,'blobs',blob),image);
  await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:{[blob]:{bytes:image.length,entry}}}));
  await fs.writeFile(path.join(viewer,'recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  await fs.writeFile(path.join(viewer,'recipe-rollout/regions/test.json'),JSON.stringify({version:1,region:'test',terrain:{},roads:{parts:{}}}));
  await fs.writeFile(path.join(viewer,'dependency-bundles/regions/test.json'),JSON.stringify({resources:{'test/terrain-live/albedo-0.bin.gz':{codec:'rgba-image-array',size:256,slices:[slice,slice]}}}));
  const target=path.join(root,'delivery'),result=await publishCompactWorld({input,target,terrainSourceMaxSize:null}),region=result.index.regions.test;
  const doc=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,region.manifest.path)))),rows=doc.resources['test/terrain-live/albedo-0.bin.gz'].slices;
  assert.equal(rows[0].resource.hash,blob);assert.equal(rows[1].resource.hash,blob);
  const tier=rows[0].tiers[128];assert.equal(tier.width,128);assert.equal(tier.height,128);assert.equal(rows[1].tiers[128].resource.path,tier.resource.path);
  const encoded=await fs.readFile(path.join(target,tier.resource.path));assert.equal(hash(encoded),tier.resource.hash);assert.ok(doc.physicalResources.some(ref=>ref.path===tier.resource.path));
  assert.equal(region.downloadBytes,doc.physicalResources.reduce((sum,ref)=>sum+ref.bytes,region.manifest.bytes));
  const prior=await publishCompactWorld({input,target:path.join(root,'old'),terrainTiers:false}),old=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,'old',prior.index.regions.test.manifest.path))));
  assert.equal(old.resources['test/terrain-live/albedo-0.bin.gz'].slices[0].tiers,undefined);
  const again=await publishCompactWorld({input,target:path.join(root,'again'),terrainSourceMaxSize:null});assert.equal(again.index.regions.test.manifest.hash,region.manifest.hash);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
