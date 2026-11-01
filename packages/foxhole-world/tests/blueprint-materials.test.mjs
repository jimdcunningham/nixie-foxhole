import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {assignBlueprintMaterials,nativePuddleMaterial} from '../blueprint-materials.mjs';
import {prepareBlueprintMaterials} from '../prepare-blueprint-materials.mjs';
const source='War/Content/Materials/Native.uasset';
const native={name:'Native',path:source,properties:{Expressions:[{ObjectPath:'War/Content/Materials/Puddles.0'}]},colors:{Colo0r1:{R:.01,G:.009769,B:.006244}},scalars:{Opacity:.9,Roughness:.1,Metallic:0,Specular:.3}};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('indexed overrides preserve holes, UV bindings, geometry, and shared defaults',()=>{
 const doc={materials:[{name:'zero'},{name:'one'},{name:'two'}],meshes:[{primitives:[{material:0,attributes:{POSITION:0}},{material:2,attributes:{POSITION:1}}]}]},original=structuredClone(doc);
 const library={doc:{images:[{uri:'unchanged.png'}],textures:[{source:0,sampler:0}],samplers:[{wrapS:10497}]},material:{extras:{foxholeMaterialSource:source},pbrMetallicRoughness:{baseColorTexture:{index:0,texCoord:1}}}};
 const overrides=[{Index:2,MaterialPath:source}];
 assert.equal(assignBlueprintMaterials(doc,overrides,()=>library),1);
 assert.deepEqual(doc.materials.slice(0,3),original.materials);assert.deepEqual(doc.meshes[0].primitives[0],original.meshes[0].primitives[0]);assert.deepEqual(doc.meshes[0].primitives[1].attributes,{POSITION:1});
 assert.equal(doc.materials[3].pbrMetallicRoughness.baseColorTexture.texCoord,1);assert.equal(doc.images[0].uri,'unchanged.png');
 assert.equal(assignBlueprintMaterials(doc,overrides,()=>library),0);
 assert.throws(()=>assignBlueprintMaterials(doc,[{Index:8,MaterialPath:source}],()=>library),/slot missing/);
 assert.equal(nativePuddleMaterial({...native,properties:{Expressions:[{ObjectPath:'Other/Puddles.0'}]}}),null);
 assert.deepEqual(nativePuddleMaterial(native).pbrMetallicRoughness.baseColorFactor,[.01,.009769,.006244,.9]);
});
test('prepared assignments isolate component variants without moving or replacing other actors',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'foxhole-blueprint-materials-'));
 try{
  const folder=path.join(root,'viewer/dependency-bundles');await fs.mkdir(path.join(folder,'regions'),{recursive:true});await fs.mkdir(path.join(root,'blobs'));await fs.mkdir(path.join(root,'native'));
  const doc={asset:{version:'2.0'},materials:[{name:'fallback'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],buffers:[{uri:'original.bin'}]},world={prototypes:[{name:'Fixture_C/Water',path:'War/Mesh.uasset',file:'ready/shared.gltf',placements:[{matrix:[1,2,3]}]},{name:'Other_C/Water',path:'War/Mesh.uasset',file:'ready/shared.gltf',placements:[{matrix:[4,5,6]}]}]};
  const manifest={blobs:{}},resources={};
  for(const [logical,object]of [['a/ready/shared.gltf',doc],['a/world.json',world]]){const bytes=brotliCompressSync(Buffer.from(JSON.stringify(object))),hash=digest(bytes),entry={blob:hash,codec:'brotli',bytes:bytes.length};manifest.blobs[hash]={bytes:bytes.length,ids:[logical],entry};resources[logical]=entry;await fs.writeFile(path.join(root,'blobs',hash),bytes);}
  await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest));await fs.writeFile(path.join(folder,'regions/a.json'),JSON.stringify({region:'a',resources}));
  await fs.writeFile(path.join(root,'native/blueprint-materials.json'),JSON.stringify([{path:'War/Fixture.uasset',components:[{ComponentName:'Water',MeshPath:'War/Mesh.uasset',MaterialOverrides:[{Index:0,MaterialPath:source}]}]}]));
  await fs.writeFile(path.join(root,'native/material-inspection.json'),JSON.stringify({materials:[native]}));
  const options={input:root,native:path.join(root,'native'),regions:['a']};assert.equal((await prepareBlueprintMaterials(options)).assignments,1);
  const receipt=JSON.parse(await fs.readFile(path.join(folder,'regions/a.json'))),read=async name=>JSON.parse(brotliDecompressSync(await fs.readFile(path.join(root,'blobs',receipt.resources[name].blob))));
  const result=await read('a/world.json');assert.deepEqual(result.prototypes[1],world.prototypes[1]);assert.deepEqual(result.prototypes[0].placements,world.prototypes[0].placements);assert.notEqual(result.prototypes[0].file,result.prototypes[1].file);
  assert.deepEqual(await read('a/ready/shared.gltf'),doc);const fixed=await read('a/'+result.prototypes[0].file);assert.deepEqual(fixed.buffers,doc.buffers);assert.equal(fixed.materials[1].extras.foxholeMaterialSource,source);
  assert.equal((await prepareBlueprintMaterials(options)).assignments,0);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
