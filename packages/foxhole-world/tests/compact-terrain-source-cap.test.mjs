import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import sharp from 'sharp';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {publishCompactWorld} from '../publish-compact.mjs';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('terrain publication caps source data and matching material buckets without changing prepared inputs',async()=>{
 const base=path.resolve('.tmp'),root=await fs.mkdtemp(path.join(base,'terrain-source-cap-'));
 try{
  const input=path.join(root,'prepared'),viewer=path.join(input,'viewer'),blobs=path.join(input,'blobs');
  for(const name of ['dependency-bundles/regions','recipe-rollout/regions'])await fs.mkdir(path.join(viewer,name),{recursive:true});await fs.mkdir(blobs,{recursive:true});
  const size=512,pixels={};for(const kind of ['albedo','normal']){const p=Buffer.alloc(size*size*4);for(let i=0;i<size*size;i++){p[i*4]=(i*11)%256;p[i*4+1]=(i*7)%256;p[i*4+2]=kind==='normal'?224:(i*3)%256;p[i*4+3]=i%19===0?128:255;}pixels[kind]=p;}
  const blobRows={},slices={};
  for(const kind of ['albedo','normal']){const bytes=await sharp(pixels[kind],{raw:{width:size,height:size,channels:4}}).png().toBuffer(),blob=hash(bytes);await fs.writeFile(path.join(blobs,blob),bytes);blobRows[blob]={bytes:bytes.length,entry:{blob,bytes:bytes.length,codec:'image'}};slices[kind]={blob,bytes:bytes.length,width:size,height:size,pixelHash:hash(pixels[kind])};}
  const materialRaw=Buffer.from(JSON.stringify({size,buckets:[{size,count:2,start:0}],layers:[],weights:{},slices:2})),materialBytes=brotliCompressSync(materialRaw),materialHash=hash(materialBytes);
  await fs.writeFile(path.join(blobs,materialHash),materialBytes);blobRows[materialHash]={bytes:materialBytes.length,entry:{blob:materialHash,bytes:materialBytes.length,codec:'brotli'}};
  await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:blobRows}));await fs.writeFile(path.join(viewer,'recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  for(const id of ['test','other']){
   await fs.writeFile(path.join(viewer,'recipe-rollout/regions',id+'.json'),JSON.stringify({version:1,region:id,terrain:{},roads:{parts:{}}}));
   await fs.writeFile(path.join(viewer,'dependency-bundles/regions',id+'.json'),JSON.stringify({resources:{[id+'/terrain-live/material.json']:{blob:materialHash,bytes:materialBytes.length,codec:'brotli'},[id+'/terrain-live/albedo-0.bin.gz']:{codec:'rgba-image-array',size,slices:[slices.albedo,slices.albedo]},[id+'/terrain-live/normal-0.bin.gz']:{codec:'rgba-image-array',size,slices:[slices.normal,slices.normal]}}}));
  }
  const target=path.join(root,'delivery'),result=await publishCompactWorld({input,target,catalog:null,terrainTiers:true,terrainSourceMaxSize:256});
  const read=async ref=>JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,ref.path))));
  const docs=await Promise.all(['test','other'].map(id=>read(result.index.regions[id].manifest)));
  for(const [i,id] of ['test','other'].entries()){
   const doc=docs[i],material=await read(doc.resources[id+'/terrain-live/material.json'].resource);
   assert.equal(material.size,256);assert.deepEqual(material.buckets,[{size:256,count:2,start:0}]);
   for(const kind of ['albedo','normal']){
    const entry=doc.resources[id+'/terrain-live/'+kind+'-0.bin.gz'];assert.equal(entry.size,256);assert.equal(entry.slices.length,2);
    const [first,second]=entry.slices;assert.equal(first.width,256);assert.equal(first.height,256);assert.equal(first.resource.path,second.resource.path);assert.notEqual(first.resource.hash,slices[kind].blob);
    assert.ok(first.tiers['128'], 'smaller preview tier is generated from the capped source');assert.ok(doc.physicalResources.some(r=>r.path===first.tiers['128'].resource.path));assert.ok(doc.physicalResources.some(r=>r.path===first.resource.path));assert.ok(!doc.physicalResources.some(r=>r.hash===slices[kind].blob));
    const encoded=await fs.readFile(path.join(target,first.resource.path));assert.equal(hash(encoded),first.resource.hash);
    const decoded=await sharp(encoded).ensureAlpha().raw().toBuffer();assert.equal(hash(decoded),first.pixelHash);
    const expected=resizeTerrainPixels(pixels[kind],size,size,1,256,{kind:kind==='normal'?'normal':'color'}).bytes;
    const quality=kind==='normal'?85:75;assert.equal(first.codec,'webp'+quality);assert.notEqual(hash(decoded),hash(expected),'RGB uses lossy encoding');const expectedBytes=await sharp(Buffer.from(expected),{raw:{width:256,height:256,channels:4}}).webp({quality,alphaQuality:100,effort:2,exact:true}).toBuffer();assert.deepEqual(encoded,expectedBytes,'encoding matches the viewer candidate');
    for(let n=3;n<decoded.length;n+=4)assert.equal(decoded[n],expected[n],'alpha channel is preserved');
   }
   assert.equal(result.index.regions[id].downloadBytes,doc.physicalResources.reduce((n,r)=>n+r.bytes,result.index.regions[id].manifest.bytes));
  }
  assert.equal(docs[0].resources['test/terrain-live/normal-0.bin.gz'].slices[0].resource.path,docs[1].resources['other/terrain-live/normal-0.bin.gz'].slices[0].resource.path,'source reductions are reused across regions');
  for(const kind of ['albedo','normal']){const original=await fs.readFile(path.join(blobs,slices[kind].blob));assert.equal(hash(original),slices[kind].blob,'prepared originals remain unchanged');}
  const sameSizePub=await publishCompactWorld({input,target:path.join(root,'same-size'),catalog:null,terrainTiers:false}),sameSize=await readFrom(path.join(root,'same-size'),sameSizePub.index.regions.test.manifest);
  const sameNormal=sameSize.resources['test/terrain-live/normal-0.bin.gz'].slices[0];assert.equal(sameNormal.width,size);assert.notEqual(sameNormal.resource.hash,slices.normal.blob,'normal sources already within the cap are re-encoded');assert.equal(sameNormal.codec,'webp85');const sameEncoded=await fs.readFile(path.join(root,'same-size',sameNormal.resource.path)),sameDecoded=await sharp(sameEncoded).ensureAlpha().raw().toBuffer();assert.equal(hash(sameDecoded),sameNormal.pixelHash);for(let n=3;n<sameDecoded.length;n+=4)assert.equal(sameDecoded[n],pixels.normal[n],'same-size alpha is preserved');const sameAlbedo=sameSize.resources['test/terrain-live/albedo-0.bin.gz'].slices[0];assert.notEqual(sameAlbedo.resource.hash,slices.albedo.blob,'same-size albedo is re-encoded');assert.equal(sameAlbedo.codec,'webp75');const sameColor=await sharp(await fs.readFile(path.join(root,'same-size',sameAlbedo.resource.path))).ensureAlpha().raw().toBuffer();assert.equal(hash(sameColor),sameAlbedo.pixelHash);for(let n=3;n<sameColor.length;n+=4)assert.equal(sameColor[n],pixels.albedo[n],'same-size color alpha is preserved');
  const originalPub=await publishCompactWorld({input,target:path.join(root,'uncapped'),catalog:null,terrainTiers:false,terrainSourceMaxSize:null}),uncapped=await readFrom(path.join(root,'uncapped'),originalPub.index.regions.test.manifest);
  assert.equal(uncapped.resources['test/terrain-live/normal-0.bin.gz'].size,512);assert.equal(uncapped.resources['test/terrain-live/normal-0.bin.gz'].slices[0].resource.hash,slices.normal.blob);
  await assert.rejects(()=>publishCompactWorld({input,target:path.join(root,'invalid'),catalog:null,terrainSourceMaxSize:100}),/Invalid terrain source size cap/);
  await assert.rejects(()=>publishCompactWorld({input,target:path.join(root,'invalid-quality'),catalog:null,terrainColorQuality:101}),/Invalid terrain source quality/);
  const customPub=await publishCompactWorld({input,target:path.join(root,'custom-quality'),catalog:null,terrainTiers:false,terrainSourceMaxSize:1024,terrainColorQuality:90,terrainNormalQuality:95}),custom=await readFrom(path.join(root,'custom-quality'),customPub.index.regions.test.manifest);assert.equal(custom.resources['test/terrain-live/albedo-0.bin.gz'].slices[0].codec,'webp90');assert.equal(custom.resources['test/terrain-live/normal-0.bin.gz'].slices[0].codec,'webp95');
  const cliTarget=path.join(root,'cli');await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../export-world.mjs',import.meta.url)),'--world-input',input,'--world-assets',cliTarget,'--world-regions','test','--terrain-source-max-size','1024','--terrain-color-quality','90','--terrain-normal-quality','95']);const cliIndex=JSON.parse(await fs.readFile(path.join(cliTarget,'index.json'))),cli=await readFrom(cliTarget,cliIndex.regions.test.manifest);assert.equal(cli.resources['test/terrain-live/albedo-0.bin.gz'].slices[0].codec,'webp90');assert.equal(cli.resources['test/terrain-live/normal-0.bin.gz'].slices[0].codec,'webp95');
 }finally{if(!path.resolve(root).startsWith(base+path.sep))throw Error('Temporary directory escaped workspace');await fs.rm(root,{recursive:true,force:true});}
});
async function readFrom(root,ref){return JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,ref.path))));}
