import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import sharp from 'sharp';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';
import {publishCompactWorld} from '../publish-compact.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
test('world model colors respect glTF roles, alpha and shared dependencies',async()=>{
 const parent=path.resolve('.tmp'),root=await fs.mkdtemp(path.join(parent,'world-color-publisher-'));
 try{
  const input=path.join(root,'input'),viewer=path.join(input,'viewer'),blobs=path.join(input,'blobs'),target=path.join(root,'output');for(const dir of [blobs,path.join(viewer,'dependency-bundles/regions'),path.join(viewer,'recipe-rollout/regions')])await fs.mkdir(dir,{recursive:true});
  const entries={};async function add(data,codec,ids){const blob=digest(data);await fs.writeFile(path.join(blobs,blob),data);entries[blob]={bytes:data.length,entry:{codec,blob},ids};return {blob,bytes:data.length,codec};}
  async function image(offset,id){let pixels=Buffer.alloc(256*128*4);for(let i=0;i<256*128;i++){pixels[4*i]=(i*7+offset)%256;pixels[4*i+1]=(i*11+offset)%256;pixels[4*i+2]=(i*13+offset)%256;pixels[4*i+3]=(i*3+offset)%256;}return {entry:await add(await sharp(pixels,{raw:{width:256,height:128,channels:4}}).png().toBuffer(),'image',[id]),pixels};}
  const color=(await image(17,'world-textures/color.png')),shared=(await image(43,'world-textures/shared.png')),only=(await image(71,'world-textures/only.png')),rough=(await image(101,'world-textures/rough.png')),other=(await image(121,'world-textures/other.png')),ext=(await image(139,'world-textures/ext.png')),ambigA=(await image(157,'world-textures/ambigA.png')),ambigB=(await image(181,'world-textures/ambigB.png')),cutout=(await image(199,'world-textures/cutout.png'));
  let url=b=>'/__delivery_blob/'+b+'/asset.png';const entriesByName={color:color.entry,shared:shared.entry,only:only.entry,rough:rough.entry,other:other.entry,ext:ext.entry,ambigA:ambigA.entry,ambigB:ambigB.entry,cutout:cutout.entry};
  let gltf={asset:{version:'2.0'},images:Object.values(entriesByName).map(x=>({uri:url(x.blob),mimeType:'image/png'})),textures:[{source:0},{source:1},{source:2},{source:3},{source:4},{source:5},{source:6},{source:7},{extensions:{KHR_texture_basisu:{source:5}}},{source:8}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}},{pbrMetallicRoughness:{baseColorTexture:{index:1}}},{pbrMetallicRoughness:{baseColorTexture:{index:2}}},{pbrMetallicRoughness:{baseColorTexture:{index:3},metallicRoughnessTexture:{index:3}}},{pbrMetallicRoughness:{baseColorTexture:{index:4}},extensions:{EXT_example:{otherTexture:{index:4}}}},{pbrMetallicRoughness:{baseColorTexture:{index:5}}},{pbrMetallicRoughness:{baseColorTexture:{index:6}}},{pbrMetallicRoughness:{baseColorTexture:{index:7}}},{pbrMetallicRoughness:{baseColorTexture:{index:9}}}]};
  let normalGltf={asset:{version:'2.0'},images:[{uri:url(shared.entry.blob)}],textures:[{source:0}],materials:[{normalTexture:{index:0}}]};
  const doc=async(value,id)=>add(brotliCompressSync(Buffer.from(JSON.stringify(value))),'brotli',[id]);
  entries[ambigA.entry.blob].ids.push('deadlands/ready/alias.png');entries[ambigB.entry.blob].ids.push('other/ready/alias.png');
  const ambiguous={asset:{version:'2.0'},images:[{uri:'alias.png'}],textures:[{source:0}],materials:[{normalTexture:{index:0}}]};
  const ambiguousRef=await doc(ambiguous,'deadlands/ready/ambiguous.gltf');entries[ambiguousRef.blob].ids.push('other/ready/ambiguous.gltf');
  const gltfRef=await doc(gltf,'deadlands/ready/model.gltf'),normalRef=await doc(normalGltf,'other/ready/normal.gltf'),indirect=await doc({url:url(color.entry.blob)},'deadlands/indirect.json');
  const cutoutDoc={asset:{version:'2.0'},images:[{uri:url(cutout.entry.blob)}],textures:[{source:0}],materials:[{alphaMode:'MASK',alphaCutoff:0.35,pbrMetallicRoughness:{baseColorTexture:{index:0}}},{alphaMode:'MASK',alphaCutoff:0.8,pbrMetallicRoughness:{baseColorTexture:{index:0}}},{alphaMode:'BLEND',pbrMetallicRoughness:{baseColorTexture:{index:0}}}]};
  const cutoutRef=await doc(cutoutDoc,'other/ready/cutout.gltf');
  const resources=Object.fromEntries(Object.entries(entriesByName).map(([name,entry])=>['world-textures/'+name+'.png',entry]));Object.assign(resources,{'deadlands/ready/model.gltf':gltfRef,'other/ready/normal.gltf':normalRef,'other/ready/cutout.gltf':cutoutRef,'deadlands/indirect.json':indirect});
  for(const id of ['deadlands','other']){await fs.writeFile(path.join(viewer,'dependency-bundles/regions',id+'.json'),JSON.stringify({resources}));await fs.writeFile(path.join(viewer,'recipe-rollout/regions',id+'.json'),JSON.stringify({version:1,region:id,terrain:{},roads:{parts:{}}}));}
  await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:entries}));await fs.writeFile(path.join(viewer,'recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  const args={input,regions:['deadlands','other'],catalog:null,terrainTiers:false,terrainSourceMaxSize:null,detailTextureMaxSize:null,transportTextureMaxSize:null,worldNormalMaxSize:128,worldNormalQuality:85,worldColorMaxSize:128,worldColorCutoutMaxSize:256,worldColorQuality:75};
  const output=await publishCompactWorld({...args,target});const read=async ref=>JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,ref.path))));
  for(const id of ['deadlands','other']){const m=await read(output.index.regions[id].manifest),changed=m.resources['world-textures/color.png'];assert.notEqual(changed.blob,color.entry.blob);assert.equal(changed.width,128);assert.equal(changed.height,64);
   for(const name of ['shared','rough','other','ext','ambigA','ambigB'])assert.equal(m.resources['world-textures/'+name+'.png'].blob,entriesByName[name].blob,'shared or unknown texture role must remain original');
   const selectedCutout=m.resources['world-textures/cutout.png'];assert.equal(selectedCutout.width,256);assert.equal(selectedCutout.height,128);const selectedCutoutPixels=await sharp(await fs.readFile(path.join(target,selectedCutout.resource.path))).ensureAlpha().raw().toBuffer();for(let i=3;i<selectedCutoutPixels.length;i+=4)assert.equal(selectedCutoutPixels[i],cutout.pixels[i]);
   const savedCutout=await read(m.resources['other/ready/cutout.gltf'].resource);assert.ok(savedCutout.images[0].uri.includes(selectedCutout.blob));assert.deepEqual(savedCutout.materials.map(x=>x.alphaCutoff),[0.35,0.8,undefined]);
   const model=await read(m.resources['deadlands/ready/model.gltf'].resource),normalDoc=await read(m.resources['other/ready/normal.gltf'].resource);assert.ok(model.images[0].uri.includes(changed.blob));assert.ok(model.images[1].uri.includes(shared.entry.blob));assert.ok(normalDoc.images[0].uri.includes(shared.entry.blob));assert.ok(model.images[2].uri.includes(m.resources['world-textures/only.png'].blob));assert.equal(model.images[0].mimeType,'image/webp');
   const pointer=await read(m.resources['deadlands/indirect.json'].resource);assert.ok(pointer.url.includes(color.entry.blob));assert.ok(m.physicalResources.some(x=>x.hash===color.entry.blob));assert.ok(m.physicalResources.some(x=>x.hash===changed.blob));assert.ok(!m.physicalResources.some(x=>x.hash===only.entry.blob));
   const decoded=await sharp(await fs.readFile(path.join(target,changed.resource.path))).ensureAlpha().raw().toBuffer();const expected=resizeTerrainPixels(color.pixels,256,128,1,128,{kind:'color'}).bytes;for(let i=3;i<decoded.length;i+=4)assert.equal(decoded[i],expected[i],'alpha must equal resized source');
  }
  const disabled=await publishCompactWorld({...args,target:path.join(root,'disabled'),regions:['deadlands'],worldColorMaxSize:null});const d=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,'disabled',disabled.index.regions.deadlands.manifest.path))));assert.equal(d.resources['world-textures/color.png'].blob,color.entry.blob);
  await assert.rejects(()=>publishCompactWorld({...args,target,worldColorMaxSize:100}),/Invalid world color texture cap/);await assert.rejects(()=>publishCompactWorld({...args,target,worldColorCutoutMaxSize:100}),/Invalid world cutout texture cap/);await assert.rejects(()=>publishCompactWorld({...args,target,worldColorQuality:101}),/Invalid world color texture quality/);
 }finally{if(!path.resolve(root).startsWith(parent+path.sep))throw Error('Temporary directory escaped workspace');await fs.rm(root,{recursive:true,force:true});}
});
