import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {packFoliageAlpha,prepareNativeFoliageMasks} from '../prepare-foliage-alpha.mjs';
import {publishCompactWorld} from '../publish-compact.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const png=(pixels)=>sharp(Buffer.from(pixels),{raw:{width:2,height:1,channels:4}}).png().toBuffer();
test('native foliage uses linear packed blue while preserving decoded RGB exactly',async()=>{
 const color=await png([23,71,124,255,200,150,100,255]),mask=await png([0,255,0,255,0,255,173,255]);
 const result=await sharp(await packFoliageAlpha(color,mask,2)).raw().toBuffer();
 assert.deepEqual([...result],[23,71,124,0,200,150,100,173]);
 await assert.rejects(packFoliageAlpha(color,await sharp({create:{width:1,height:1,channels:3,background:'#fff'}}).png().toBuffer(),2),/dimensions/);
});
for(const [name,colorName,maskName] of [['BirchBushSnow','BirchBushSnowA','BirchBushSnowM'],['BirchBushSmall','BirchBushThinA','BirchBranchThinM']])test(name+' normalization shares the cutout, preserves solids and geometry, and is idempotent',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'foxhole-foliage-'));
 try{
  await fs.mkdir(path.join(root,'viewer/dependency-bundles/regions'),{recursive:true});await fs.mkdir(path.join(root,'blobs'));await fs.mkdir(path.join(root,'native/Textures/Foliage'),{recursive:true});
  const color=await png([10,20,30,255,40,50,60,255]),mask=await png([0,255,0,255,0,255,255,255]);
  const imageHash=hash(color),imageEntry={codec:'identity',blob:imageHash,bytes:color.length,sourceHash:imageHash};
  const material={name,pbrMetallicRoughness:{baseColorTexture:{index:0,texCoord:1},roughnessFactor:.94},extras:{foxholeMaterialSource:'War/Content/Materials/Environment/Props/'+name+'.uasset',foxholeAlbedoSource:'War/Content/Textures/Foliage/'+colorName+'.'+colorName}};
  const doc={asset:{version:'2.0'},materials:[material,{...structuredClone(material),extras:{foxholeMaterialSource:'Other/BirchBushSnow.uasset'}}],textures:[{sampler:0,source:0}],samplers:[{wrapS:10497,wrapT:10497}],images:[{uri:`/__asset_ab/content/B/${imageHash}/${imageHash}/asset.png`}],meshes:[{primitives:[{material:0,attributes:{POSITION:0}}]}],accessors:[{count:3}]};
  const model=brotliCompressSync(Buffer.from(JSON.stringify(doc))),modelHash=hash(model),modelEntry={codec:'brotli',blob:modelHash,bytes:model.length};
  const manifest={blobs:{[imageHash]:{bytes:color.length,ids:['world-textures/color.png'],entry:imageEntry},[modelHash]:{bytes:model.length,ids:['a/ready/bush.gltf','b/ready/bush.gltf'],entry:modelEntry}}};
  await fs.writeFile(path.join(root,'viewer/dependency-bundles/manifest.json'),JSON.stringify(manifest));await fs.writeFile(path.join(root,'blobs',imageHash),color);await fs.writeFile(path.join(root,'blobs',modelHash),model);await fs.writeFile(path.join(root,'native/Textures/Foliage/'+maskName+'.png'),mask);
  for(const id of ['a','b'])await fs.writeFile(path.join(root,'viewer/dependency-bundles/regions',id+'.json'),JSON.stringify({region:id,resources:{[id+'/ready/bush.gltf']:modelEntry}}));
  const result=await prepareNativeFoliageMasks({input:root,textureRoot:path.join(root,'native')});assert.deepEqual(result,{regions:['a','b'],materials:1,textures:1});
  const a=JSON.parse(await fs.readFile(path.join(root,'viewer/dependency-bundles/regions/a.json'))),b=JSON.parse(await fs.readFile(path.join(root,'viewer/dependency-bundles/regions/b.json')));assert.equal(a.resources['a/ready/bush.gltf'].blob,b.resources['b/ready/bush.gltf'].blob);
  const fixed=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,'blobs',a.resources['a/ready/bush.gltf'].blob))));
  assert.deepEqual(fixed.meshes,doc.meshes);assert.deepEqual(fixed.accessors,doc.accessors);assert.deepEqual(fixed.materials[1],doc.materials[1]);assert.deepEqual(fixed.images[0],doc.images[0]);assert.equal(fixed.materials[0].alphaMode,'MASK');assert.equal(fixed.materials[0].alphaCutoff,.333);assert.equal(fixed.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord,1);assert.equal(fixed.textures[1].sampler,0);
  const texture=Object.entries(a.resources).find(([key])=>key.startsWith('world-textures/'));assert.ok(texture);
  assert.deepEqual([...await sharp(await fs.readFile(path.join(root,'blobs',texture[1].blob))).raw().toBuffer()],[10,20,30,0,40,50,60,255]);
  await fs.mkdir(path.join(root,'viewer/recipe-rollout/regions'),{recursive:true});
  await fs.writeFile(path.join(root,'viewer/recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  for(const id of ['a','b'])await fs.writeFile(path.join(root,'viewer/recipe-rollout/regions',id+'.json'),JSON.stringify({version:1,region:id,roads:{parts:{}}}));
  const target=path.join(root,'published'),publication=await publishCompactWorld({input:root,target,catalog:null});
  const receipt=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,publication.index.regions.a.manifest.path))));
  const published=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,receipt.resources['a/ready/bush.gltf'].resource.path))));
  assert.equal(published.materials[0].extras.foxholeOpacitySource,'War/Content/Textures/Foliage/'+maskName+'.'+maskName);
  assert.ok(published.images[1].uri.startsWith('../../raw/'));
  assert.equal(publication.index.regions.a.manifest.bytes>0,true);
  const again=await prepareNativeFoliageMasks({input:root,textureRoot:path.join(root,'native')});assert.deepEqual(again,{regions:[],materials:0,textures:0});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
