import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import sharp from 'sharp';
import {publishCompactWorld} from '../publish-compact.mjs';
import {reduceDetailTexture} from '../authoring/detail-texture-reduction.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('water publication reduces only metadata-selected water roles and keeps independent references',async()=>{
 const parent=path.resolve('.tmp'),root=await fs.mkdtemp(path.join(parent,'water-publisher-'));
 try{
  const input=path.join(root,'input'),viewer=path.join(input,'viewer'),blobs=path.join(input,'blobs'),target=path.join(root,'output');
  for(const dir of [blobs,path.join(viewer,'dependency-bundles/regions'),path.join(viewer,'recipe-rollout/regions')])await fs.mkdir(dir,{recursive:true});
  const entries={},add=async(bytes,codec,ids=[])=>{const blob=hash(bytes);await fs.writeFile(path.join(blobs,blob),bytes);entries[blob]={bytes:bytes.length,entry:{codec,blob},ids};return {blob,bytes:bytes.length,codec};};
  const images={},fields={waveLarge:'wave-large',waveSmall:'wave-small',foam:'foam',modulation:'modulation',clouds:'clouds'};
  for(const [j,name] of Object.values(fields).entries()){
   const w=256,h=128,pixels=Buffer.alloc(w*h*4);
   for(let i=0;i<w*h;i++){pixels[i*4]=(i*7+j*13)%256;pixels[i*4+1]=(i*11+j*27)%256;pixels[i*4+2]=name.startsWith('wave')?230:(i*19+j*7)%256;pixels[i*4+3]=name==='clouds'?i%256:255;}
   const bytes=await sharp(pixels,{raw:{width:w,height:h,channels:4}}).png().toBuffer(),logical='water-graph/'+name+'.png';images[name]={bytes,entry:await add(bytes,'image',[logical])};
  }
  const indirect=await add(brotliCompressSync(Buffer.from(JSON.stringify({url:'/__delivery_blob/'+images.foam.entry.blob+'/asset.png'}))),'brotli');
  for(const id of ['deadlands','callahans']){
   const meta={textures:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,'water-graph/'+v+'.png']))},metaEntry=await add(brotliCompressSync(Buffer.from(JSON.stringify(meta))),'brotli');
   const resources={[id+'/water-source/render.json']:metaEntry,[id+'/water-source/terrain-height.png']:images['wave-large'].entry,[id+'/water-indirect.json']:indirect};
   for(const [name,image] of Object.entries(images))resources['water-graph/'+name+'.png']=image.entry;
   await fs.writeFile(path.join(viewer,'dependency-bundles/regions',id+'.json'),JSON.stringify({resources}));
   await fs.writeFile(path.join(viewer,'recipe-rollout/regions',id+'.json'),JSON.stringify({version:1,region:id,terrain:{},roads:{parts:{}}}));
  }
  await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:entries}));await fs.writeFile(path.join(viewer,'recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  const args={input,target,regions:['deadlands','callahans'],catalog:null,terrainTiers:false,terrainSourceMaxSize:null,detailTextureMaxSize:null,transportTextureMaxSize:null,worldNormalMaxSize:null,weatherTextureMaxSize:null,waterTextureMaxSize:128,waterNormalQuality:65,waterDataQuantizationStep:4,waterWaveQuantizationStep:null};
  const result=await publishCompactWorld(args),read=async ref=>JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,ref.path))));
  const docs=await Promise.all(args.regions.map(id=>read(result.index.regions[id].manifest)));
  for(const [i,id] of args.regions.entries()){
   const d=docs[i];for(const [name,image] of Object.entries(images)){
    const e=d.resources['water-graph/'+name+'.png'],role=name.startsWith('wave')?'normal':'orm';
    const expected=await reduceDetailTexture(image.bytes,{role,maxSize:128,quality:65,ormQuantizationStep:role==='orm'?4:null});
    assert.equal(e.blob,hash(expected.bytes));assert.equal(e.width,expected.width);assert.equal(e.height,expected.height);assert.equal(hash(await fs.readFile(path.join(target,e.resource.path))),e.blob);assert.ok(d.physicalResources.some(x=>x.path===e.resource.path));
   }
   assert.equal(d.resources[id+'/water-source/terrain-height.png'].blob,images['wave-large'].entry.blob,'unrelated elevation retains original bytes');
   const j=await read(d.resources[id+'/water-indirect.json'].resource);assert.ok(j.url.includes(images.foam.entry.blob));assert.ok(d.physicalResources.some(x=>x.hash===images.foam.entry.blob),'indirect use retains original');
  }
  for(const name of Object.keys(images))assert.equal(docs[0].resources['water-graph/'+name+'.png'].resource.path,docs[1].resources['water-graph/'+name+'.png'].resource.path,'shared source deduplicated');
  const disabled=await publishCompactWorld({...args,regions:['deadlands'],target:path.join(root,'disabled'),waterTextureMaxSize:null});
  const doc=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,'disabled',disabled.index.regions.deadlands.manifest.path))));assert.equal(doc.resources['water-graph/foam.png'].blob,images.foam.entry.blob);
  const waveTarget=path.join(root,'wave-data'),wavePublication=await publishCompactWorld({...args,regions:['deadlands'],target:waveTarget,waterWaveQuantizationStep:4});
  const waveDoc=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(waveTarget,wavePublication.index.regions.deadlands.manifest.path))));
  for(const name of ['wave-large','wave-small']){
   const expected=await reduceDetailTexture(images[name].bytes,{role:'orm',maxSize:128,quality:65,ormQuantizationStep:4});
   assert.equal(waveDoc.resources['water-graph/'+name+'.png'].blob,hash(expected.bytes),'wave RG is independently filtered when requested');
  }
  const defaultTarget=path.join(root,'default-water'),defaultPublication=await publishCompactWorld({...args,regions:['deadlands'],target:defaultTarget,waterTextureMaxSize:undefined,waterDataQuantizationStep:undefined,waterWaveQuantizationStep:undefined});
  const defaultDoc=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(defaultTarget,defaultPublication.index.regions.deadlands.manifest.path))));
  for(const [name,image]of Object.entries(images)){
   const expected=await reduceDetailTexture(image.bytes,{role:'orm',maxSize:512,quality:65,ormQuantizationStep:8});
   assert.equal(defaultDoc.resources['water-graph/'+name+'.png'].blob,hash(expected.bytes),'default filters all shader data channels independently');
  }
  await assert.rejects(()=>publishCompactWorld({...args,waterWaveQuantizationStep:0}),/Invalid water wave quantization step/);
  await assert.rejects(()=>publishCompactWorld({...args,waterTextureMaxSize:100}),/Invalid water texture cap/);
  await assert.rejects(()=>publishCompactWorld({...args,waterNormalQuality:101}),/Invalid water normal quality/);
  await assert.rejects(()=>publishCompactWorld({...args,waterDataQuantizationStep:0}),/Invalid water data quantization step/);
  const regionFile=path.join(viewer,'dependency-bundles/regions/deadlands.json'),original=JSON.parse(await fs.readFile(regionFile)),changed=structuredClone(original);delete changed.resources['water-graph/foam.png'];await fs.writeFile(regionFile,JSON.stringify(changed));
  await assert.rejects(()=>publishCompactWorld({...args,regions:['deadlands'],target:path.join(root,'missing')}),/Missing water texture/);
  const badMeta={textures:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,'water-graph/'+v+'.png']))};badMeta.textures.foam=badMeta.textures.waveLarge;
  const badEntry=await add(brotliCompressSync(Buffer.from(JSON.stringify(badMeta))),'brotli'),badRegion=structuredClone(original);badRegion.resources['deadlands/water-source/render.json']=badEntry;
  await fs.writeFile(regionFile,JSON.stringify(badRegion));await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:entries}));
  await assert.rejects(()=>publishCompactWorld({...args,regions:['deadlands'],target:path.join(root,'conflict')}),/Conflicting water texture roles/);
 }finally{if(!path.resolve(root).startsWith(parent+path.sep))throw Error('Temporary directory escaped workspace');await fs.rm(root,{recursive:true,force:true});}
});
