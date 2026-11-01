import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {sharedMaterialProfile} from '../material-families.mjs';
import {packSharedMaterial,prepareSharedMaterials} from '../prepare-shared-materials.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const png=pixels=>sharp(Buffer.from(pixels),{raw:{width:2,height:1,channels:4}}).png().toBuffer();
function native(family='props'){
 const tree=family==='tree';return {path:'War/Content/Fixture.uasset',blend:'BLEND_Masked',
  properties:{Expressions:[{ObjectPath:'War/Content/Materials/Environment/'+(tree?'Tree':'Props')+'.0'}]},
  textures:{[tree?'M':'RoughnessUVTexture']:{path:'native-packed'},[tree?'A':'Albedo']:{path:'native-albedo'}},
  scalars:{},switches:{'Use Roughness Texture':true,"Don't Use Opacity Mask":false}};
}
test('master identity and active branches select material channels without basename guesses',()=>{
 const row=native(),p=sharedMaterialProfile(row);
 assert.equal(p.family,'props');assert.equal(p.alpha,3);assert.equal(p.roughChannel,1);assert.equal(p.metalChannel,0);
 assert.equal(sharedMaterialProfile({...row,properties:{Expressions:[{ObjectPath:'Other/Props.0'}]}}),null);
 assert.equal(sharedMaterialProfile({...row,scalars:{Tiling:2}}),null);
 assert.equal(sharedMaterialProfile({...row,scalars:{MetallicLevels:2}}),null);
 assert.equal(sharedMaterialProfile({...row,switches:{...row.switches,'use albedo for Alpha':true}}),null);
 assert.equal(sharedMaterialProfile({...row,colors:{ColorShift:{R:.5,G:1,B:1}}}),null);
 assert.equal(sharedMaterialProfile({...row,switches:{...row.switches,"Don't Use Opacity Mask":true}}).alpha,null);
 assert.equal(sharedMaterialProfile(native('tree')).alpha,null);
 assert.equal(sharedMaterialProfile({...native('tree'),switches:{'Use Alpha Channel?':true}}).alpha,2);
});
test('linear surface packing and cutouts preserve albedo RGB and use authored channels',async()=>{
 const color=await png([10,20,30,255,40,50,60,255]),packed=await png([31,83,117,0,190,220,30,255]);
 const result=await packSharedMaterial(color,packed,sharedMaterialProfile(native()));
 assert.deepEqual([...await sharp(result.orm).raw().toBuffer()],[255,83,31,255,255,220,190,255]);
 assert.deepEqual([...await sharp(result.color).raw().toBuffer()],[10,20,30,0,40,50,60,255]);
 const tree=await packSharedMaterial(color,packed,sharedMaterialProfile(native('tree')));assert.equal(tree.color,null);
});
test('prepared normalization shares immutable textures, preserves unrelated materials and geometry, and reruns safely',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'foxhole-shared-materials-'));
 try{
  await fs.mkdir(path.join(root,'viewer/dependency-bundles/regions'),{recursive:true});await fs.mkdir(path.join(root,'blobs'));await fs.mkdir(path.join(root,'native'));
  const color=await png([10,20,30,255,40,50,60,255]),packed=await png([31,83,117,0,190,220,30,255]),imageHash=hash(color);
  const material={name:'Fixture',pbrMetallicRoughness:{baseColorTexture:{index:0,texCoord:1}},extras:{foxholeMaterialSource:'War/Content/Fixture.uasset',foxholeAlbedoSource:'native-albedo'}};
  const doc={asset:{version:'2.0'},materials:[material,{...structuredClone(material),extras:{foxholeMaterialSource:'Other/Fixture.uasset'}}],
   images:[{uri:`/__asset_ab/content/B/${imageHash}/${imageHash}/asset.png`}],textures:[{source:0,sampler:0}],samplers:[{wrapS:10497}],meshes:[{primitives:[{material:0,attributes:{POSITION:0}}]}]};
  const model=brotliCompressSync(Buffer.from(JSON.stringify(doc))),modelHash=hash(model),entry={codec:'brotli',blob:modelHash,bytes:model.length};
  const manifest={blobs:{[imageHash]:{bytes:color.length,ids:['world-textures/color.png'],entry:{codec:'identity'}},[modelHash]:{bytes:model.length,entry,ids:['a/ready/fixture.gltf','b/ready/fixture.gltf']}}};
  await fs.writeFile(path.join(root,'viewer/dependency-bundles/manifest.json'),JSON.stringify(manifest));await fs.writeFile(path.join(root,'blobs',imageHash),color);await fs.writeFile(path.join(root,'blobs',modelHash),model);
  for(const region of ['a','b'])await fs.writeFile(path.join(root,'viewer/dependency-bundles/regions',region+'.json'),JSON.stringify({region,resources:{[region+'/ready/fixture.gltf']:entry}}));
  await fs.writeFile(path.join(root,'native/packed.png'),packed);await fs.writeFile(path.join(root,'native/material-inspection.json'),JSON.stringify({materials:[native()]}));await fs.writeFile(path.join(root,'native/material-source.json'),JSON.stringify([{path:'native-packed',file:'packed.png'}]));
  const result=await prepareSharedMaterials({input:root,native:path.join(root,'native')});assert.equal(result.materials,1);assert.deepEqual(result.regions,['a','b']);
  const a=JSON.parse(await fs.readFile(path.join(root,'viewer/dependency-bundles/regions/a.json'))),b=JSON.parse(await fs.readFile(path.join(root,'viewer/dependency-bundles/regions/b.json')));
  assert.equal(a.resources['a/ready/fixture.gltf'].blob,b.resources['b/ready/fixture.gltf'].blob);
  const fixed=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,'blobs',a.resources['a/ready/fixture.gltf'].blob))));
  assert.deepEqual(fixed.meshes,doc.meshes);assert.deepEqual(fixed.materials[1],doc.materials[1]);assert.equal(fixed.materials[0].alphaMode,'MASK');assert.equal(fixed.materials[0].pbrMetallicRoughness.metallicFactor,1);
  assert.equal(fixed.materials[0].pbrMetallicRoughness.metallicRoughnessTexture.texCoord,1);assert.equal(fixed.images[0].uri,doc.images[0].uri);
  assert.deepEqual(await fs.readFile(path.join(root,'blobs',modelHash)),model);
  assert.equal((await prepareSharedMaterials({input:root,native:path.join(root,'native')})).materials,0);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
