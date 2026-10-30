import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import sharp from 'sharp';
import {publishCompactWorld} from '../publish-compact.mjs';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';
import {packWeatherSurfacePixels} from '../authoring/weather-surface.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
test('weather publication preserves coupled dimensions, linear mask channels and shared references',async()=>{
 const parent=path.resolve('.tmp'),root=await fs.mkdtemp(path.join(parent,'weather-publisher-'));
 try{
  const input=path.join(root,'input'),viewer=path.join(input,'viewer'),blobs=path.join(input,'blobs'),target=path.join(root,'output');
  for(const dir of [blobs,path.join(viewer,'dependency-bundles/regions'),path.join(viewer,'recipe-rollout/regions')])await fs.mkdir(dir,{recursive:true});
  const entries={};
  const add=async(bytes,codec,ids=[])=>{const blob=hash(bytes);await fs.writeFile(path.join(blobs,blob),bytes);entries[blob]={bytes:bytes.length,entry:{codec,blob},ids};return {blob,bytes:bytes.length,codec};};
  const images={};
  for(const [j,name]of ['snow','normal','mask','noise'].entries()){
   const w=256,h=128,pixels=Buffer.alloc(w*h*4);
   for(let i=0;i<w*h;i++){pixels[4*i]=(i*7+j*13)%256;pixels[4*i+1]=(i*11+j*27)%256;pixels[4*i+2]=name==='normal'?230:(i*19+j*7)%256;pixels[4*i+3]=name==='noise'?i%256:255;}
   images[name]={pixels,entry:await add(await sharp(pixels,{raw:{width:w,height:h,channels:4}}).png().toBuffer(),'image')};
  }
  const copy=await add(brotliCompressSync(Buffer.from(JSON.stringify({url:'/__delivery_blob/'+images.normal.entry.blob+'/asset.png'}))),'brotli');
  for(const id of ['deadlands','callahans']){
   const resources={};
   for(const name of Object.keys(images)){const logical=id+'/terrain-live/weather/'+name+'.png';resources[logical]=images[name].entry;entries[images[name].entry.blob].ids.push(logical);}
   resources[id+'/terrain-live/normal-1.bin.gz']=images.normal.entry;
   resources[id+'/weather-indirect.json']=copy;
   await fs.writeFile(path.join(viewer,'dependency-bundles/regions',id+'.json'),JSON.stringify({resources}));
   await fs.writeFile(path.join(viewer,'recipe-rollout/regions',id+'.json'),JSON.stringify({version:1,region:id,terrain:{},roads:{parts:{}}}));
  }
  await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:entries}));
  await fs.writeFile(path.join(viewer,'recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  const args={input,target,regions:['deadlands','callahans'],catalog:null,terrainTiers:false,terrainSourceMaxSize:null,detailTextureMaxSize:null,transportTextureMaxSize:null,worldNormalMaxSize:null,weatherTextureMaxSize:128};
  const result=await publishCompactWorld(args),read=async ref=>JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,ref.path))));
  const docs=await Promise.all(args.regions.map(id=>read(result.index.regions[id].manifest)));
  for(const [k,id]of args.regions.entries()){
   const d=docs[k],decoded={};
   for(const [name,image]of Object.entries(images)){
    const e=d.resources[id+'/terrain-live/weather/'+name+'.png'];
    assert.notEqual(e.blob,image.entry.blob);assert.equal(e.width,128);assert.equal(e.height,64);
    const b=await fs.readFile(path.join(target,e.resource.path));assert.equal(hash(b),e.blob);
    assert.ok(d.physicalResources.some(x=>x.path===e.resource.path));decoded[name]=await sharp(b).ensureAlpha().raw().toBuffer();
   }
   const packed=packWeatherSurfacePixels(decoded.snow,decoded.mask);
   for(let i=0;i<packed.length;i+=4){assert.equal(decoded.snow[i+3],255);assert.equal(packed[i+3],decoded.mask[i+1]);}
   for(const name of ['mask','noise']){
    const expected=Buffer.alloc(128*64*4),p=images[name].pixels;
    for(let c=0;c<4;c++){const plane=new Uint8Array(256*128);for(let i=0;i<plane.length;i++)plane[i]=p[4*i+c];const scaled=resizeTerrainPixels(plane,256,128,1,128,{channels:1}).bytes;for(let i=0;i<scaled.length;i++)expected[4*i+c]=c===3?scaled[i]:Math.min(255,Math.round(scaled[i]/4)*4);}
    assert.deepEqual(decoded[name],expected,name+' data channels are filtered independently; alpha is unquantized');
   }
   assert.equal(d.resources[id+'/terrain-live/normal-1.bin.gz'].blob,images.normal.entry.blob,'other logical user keeps source');
   const indirect=await read(d.resources[id+'/weather-indirect.json'].resource);
   assert.ok(indirect.url.includes(images.normal.entry.blob));
   assert.ok(d.physicalResources.some(x=>x.hash===images.normal.entry.blob),'indirect reference keeps original in closure');
  }
  for(const name of Object.keys(images))assert.equal(docs[0].resources['deadlands/terrain-live/weather/'+name+'.png'].resource.path,docs[1].resources['callahans/terrain-live/weather/'+name+'.png'].resource.path,'shared sources are deduplicated');
  const disabled=await publishCompactWorld({...args,regions:['deadlands'],target:path.join(root,'disabled'),weatherTextureMaxSize:null});
  const d=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,'disabled',disabled.index.regions.deadlands.manifest.path))));
  assert.equal(d.resources['deadlands/terrain-live/weather/snow.png'].blob,images.snow.entry.blob);
  await assert.rejects(()=>publishCompactWorld({...args,weatherTextureMaxSize:100}),/Invalid weather texture cap/);
  await assert.rejects(()=>publishCompactWorld({...args,weatherNormalQuality:101}),/Invalid weather texture quality/);
  await assert.rejects(()=>publishCompactWorld({...args,weatherDataQuantizationStep:0}),/Invalid weather data quantization step/);
  const regionFile=path.join(viewer,'dependency-bundles/regions/deadlands.json'),original=JSON.parse(await fs.readFile(regionFile));
  const changed=structuredClone(original);delete changed.resources['deadlands/terrain-live/weather/mask.png'];await fs.writeFile(regionFile,JSON.stringify(changed));
  await assert.rejects(()=>publishCompactWorld({...args,regions:['deadlands'],target:path.join(root,'missing')}),/Incomplete weather snow\/mask pair/);
  const wrong=await add(await sharp({create:{width:128,height:128,channels:4,background:'white'}}).png().toBuffer(),'image');
  const bad=structuredClone(original);bad.resources['deadlands/terrain-live/weather/mask.png']=wrong;await fs.writeFile(regionFile,JSON.stringify(bad));await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:entries}));
  await assert.rejects(()=>publishCompactWorld({...args,regions:['deadlands'],target:path.join(root,'mismatch')}),/Weather snow\/mask dimensions differ/);
  const pixels=Buffer.from(images.snow.pixels);pixels[3]=0;const nonopaque=await add(await sharp(pixels,{raw:{width:256,height:128,channels:4}}).png().toBuffer(),'image');
  const badAlpha=structuredClone(original);badAlpha.resources['deadlands/terrain-live/weather/snow.png']=nonopaque;await fs.writeFile(regionFile,JSON.stringify(badAlpha));await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:entries}));
  await assert.rejects(()=>publishCompactWorld({...args,regions:['deadlands'],target:path.join(root,'nonopaque')}),/Weather snow texture must be opaque/);
 }finally{if(!path.resolve(root).startsWith(parent+path.sep))throw Error('Temporary directory escaped workspace');await fs.rm(root,{recursive:true,force:true});}
});

