import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import sharp from 'sharp';
import {publishCompactWorld} from '../publish-compact.mjs';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';
import {reduceDetailTexture} from '../authoring/detail-texture-reduction.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('small already-efficient images retain their bytes, format and resolution for every role',async()=>{
 const source=await sharp({create:{width:64,height:32,channels:4,background:{r:40,g:40,b:40,alpha:1}}}).webp({lossless:true}).toBuffer();
 for(const role of ['color','normal','orm']){const result=await reduceDetailTexture(source,{role,maxSize:128,quality:75});assert.equal(result.unchanged,true,role);assert.equal(result.width,64);assert.equal(result.height,32);assert.equal(result.extension,'.webp');assert.deepEqual(result.bytes,source,role);}
 const png=await sharp(Buffer.from([19,98,177,0]),{raw:{width:1,height:1,channels:4}}).png({compressionLevel:9}).toBuffer();
 for(const role of ['color','normal','orm']){const result=await reduceDetailTexture(png,{role,maxSize:128,quality:75});assert.equal(result.unchanged,true,role);assert.equal(result.width,1);assert.equal(result.height,1);assert.equal(result.extension,'.png');assert.deepEqual(result.bytes,png,role);}
});
test('packed ORM scalar channels use linear averaging instead of sRGB color filtering',async()=>{
 const pixels=Buffer.alloc(4*4*4);for(let y=0;y<4;y++)for(let x=0;x<4;x++){const i=4*(y*4+x),v=(x+y)%2?255:0;pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;}
 const source=await sharp(pixels,{raw:{width:4,height:4,channels:4}}).png().toBuffer(),result=await reduceDetailTexture(source,{role:'orm',maxSize:2,quality:100});
 assert.equal(result.width,2);assert.equal(result.height,2);const decoded=await sharp(result.bytes).ensureAlpha().raw().toBuffer();for(let i=0;i<decoded.length;i+=4){assert.ok(decoded[i]>=126&&decoded[i]<=130,`expected linear mean near 128, got ${decoded[i]}`);assert.equal(decoded[i+3],255);}
});
test('detail publication preserves roles, aspect, alpha, immutable source, reuse and indirect closure',async()=>{
 const parent=path.resolve('.tmp'),root=await fs.mkdtemp(path.join(parent,'world-detail-test-'));
 try{
  const input=path.join(root,'input'),viewer=path.join(input,'viewer'),blobs=path.join(input,'blobs'),target=path.join(root,'output');
  for(const dir of [blobs,path.join(viewer,'dependency-bundles/regions'),path.join(viewer,'recipe-rollout/regions')])await fs.mkdir(dir,{recursive:true});
  const width=256,height=128,entries={},images={};
  const add=async(bytes,codec,ids=[])=>{const blob=hash(bytes);await fs.writeFile(path.join(blobs,blob),bytes);entries[blob]={bytes:bytes.length,entry:{codec,blob},ids};return {blob,bytes:bytes.length,codec};};
  for(const role of ['color','normal','orm']){
   const rgba=Buffer.alloc(width*height*4);for(let i=0;i<width*height;i++){rgba[i*4]=(i*7+(role==='normal'?77:0))%256;rgba[i*4+1]=(i*11)%256;rgba[i*4+2]=role==='normal'?225:(i*3)%256;rgba[i*4+3]=role==='color'?(i%256):255;}
   const bytes=await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer(),e=await add(bytes,'image');images[role]={entry:{...e,width,height},rgba};
  }
  const paths=id=>Object.fromEntries(['color','normal','orm'].map(role=>[role,id+'/world-fixes/details/textures/p-'+role+'.webp']));
  for(const id of ['test','other'])for(const role of ['color','normal','orm'])entries[images[role].entry.blob].ids.push(paths(id)[role]);
  for(const id of ['test','other']){
   const file={file:'textures/p-color.webp',normalFile:'textures/p-normal.webp',ormFile:'textures/p-orm.webp'},material=await add(brotliCompressSync(Buffer.from(JSON.stringify({material:file}))),'brotli');
   const indirect=await add(brotliCompressSync(Buffer.from(JSON.stringify({url:'/__delivery_blob/'+images.color.entry.blob+'/asset.webp'}))),'brotli');
   const resources={[id+'/world-fixes/details/materials.json']:material,[id+'/indirect.json']:indirect};for(const [role,logical] of Object.entries(paths(id)))resources[logical]=images[role].entry;
   await fs.writeFile(path.join(viewer,'dependency-bundles/regions',id+'.json'),JSON.stringify({resources}));await fs.writeFile(path.join(viewer,'recipe-rollout/regions',id+'.json'),JSON.stringify({version:1,region:id,terrain:{},roads:{parts:{}}}));
  }
  await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:entries}));await fs.writeFile(path.join(viewer,'recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  const out=await publishCompactWorld({input,target,regions:['test','other'],catalog:null,terrainTiers:false,terrainSourceMaxSize:null,detailTextureMaxSize:128});
  const read=async ref=>JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,ref.path))));
  const docs=await Promise.all(['test','other'].map(id=>read(out.index.regions[id].manifest)));
  for(const [index,id] of ['test','other'].entries()){
   const doc=docs[index];for(const role of ['color','normal','orm']){
    const entry=doc.resources[paths(id)[role]],encoded=await fs.readFile(path.join(target,entry.resource.path));assert.equal(hash(encoded),entry.blob);assert.equal(entry.width,128);assert.equal(entry.height,64);assert.equal(entry.codec,role==='color'?'webp75':'webp85');
    assert.ok(doc.physicalResources.some(ref=>ref.path===entry.resource.path));assert.notEqual(entry.blob,images[role].entry.blob);
    const decoded=await sharp(encoded).ensureAlpha().raw().toBuffer(),reference=resizeTerrainPixels(images[role].rgba,width,height,1,128,{kind:role==='normal'?'normal':'color'}).bytes;
    for(let i=3;i<decoded.length;i+=4)assert.equal(decoded[i],reference[i],'alpha matches independent resize');
   }
   const indirect=await read(doc.resources[id+'/indirect.json'].resource);assert.ok(indirect.url.includes(images.color.entry.blob),'embedded URL keeps its original source image');assert.ok(doc.physicalResources.some(ref=>ref.hash===images.color.entry.blob),'original indirect dependency remains in the closure');
  }
  for(const role of ['color','normal','orm'])assert.equal(docs[0].resources[paths('test')[role]].resource.path,docs[1].resources[paths('other')[role]].resource.path,'shared image deduplicates');
  for(const role of ['color','normal','orm'])assert.equal(hash(await fs.readFile(path.join(blobs,images[role].entry.blob))),images[role].entry.blob,'prepared input unchanged');
  const disabled=await publishCompactWorld({input,target:path.join(root,'disabled'),regions:['test'],catalog:null,terrainTiers:false,terrainSourceMaxSize:null,detailTextureMaxSize:null});const old=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,'disabled',disabled.index.regions.test.manifest.path))));assert.equal(old.resources[paths('test').color].blob,images.color.entry.blob);
  await assert.rejects(()=>publishCompactWorld({input,target:path.join(root,'bad'),detailTextureMaxSize:100}),/Invalid detail texture cap/);
  await assert.rejects(()=>publishCompactWorld({input,target:path.join(root,'bad-quality'),detailColorQuality:101}),/Invalid detail texture quality/);
  const custom=await publishCompactWorld({input,target:path.join(root,'custom'),regions:['test'],catalog:null,terrainTiers:false,terrainSourceMaxSize:null,detailTextureMaxSize:1024,detailColorQuality:90,detailNormalQuality:95,detailOrmQuality:95});const customDoc=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,'custom',custom.index.regions.test.manifest.path))));for(const [role,q] of [['color',90],['normal',95],['orm',95]]){const e=customDoc.resources[paths('test')[role]];assert.equal(e.width,width);assert.equal(e.height,height);assert.equal(e.codec,'webp'+q);}
  const cli=fileURLToPath(new URL('../export-world.mjs',import.meta.url));for(const [label,extra] of [['override',['--detail-texture-max-size','1024','--detail-color-quality','90','--detail-normal-quality','95','--detail-orm-quality','95']],['disabled',['--detail-texture-max-size','none']]]){
   const targetPath=path.join(root,'cli-'+label);await promisify(execFile)(process.execPath,[cli,'--world-input',input,'--world-assets',targetPath,'--world-regions','test',...extra]);const ix=JSON.parse(await fs.readFile(path.join(targetPath,'index.json'))),doc=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(targetPath,ix.regions.test.manifest.path))));const row=doc.resources[paths('test').color];if(label==='override'){assert.equal(row.codec,'webp90');assert.equal(row.width,width);assert.equal(row.height,height);}else assert.equal(row.blob,images.color.entry.blob);
  }
  const conflictRaw=brotliCompressSync(Buffer.from(JSON.stringify({mixed:{file:'textures/p-color.webp',normalFile:'textures/p-color.webp'}}))),conflictHash=hash(conflictRaw);await fs.writeFile(path.join(blobs,conflictHash),conflictRaw);entries[conflictHash]={bytes:conflictRaw.length,entry:{blob:conflictHash,codec:'brotli'}};await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:entries}));const manifestPath=path.join(viewer,'dependency-bundles/regions/test.json'),bad=JSON.parse(await fs.readFile(manifestPath));bad.resources['test/world-fixes/details/materials.json']={blob:conflictHash,bytes:conflictRaw.length,codec:'brotli'};await fs.writeFile(manifestPath,JSON.stringify(bad));await assert.rejects(()=>publishCompactWorld({input,target:path.join(root,'conflict'),regions:['test'],catalog:null,terrainTiers:false,terrainSourceMaxSize:null}),/Conflicting detail texture roles/);
 }finally{if(!path.resolve(root).startsWith(parent+path.sep))throw Error('Temporary directory escaped workspace');await fs.rm(root,{recursive:true,force:true});}
});
