import test from 'node:test';
import assert from 'node:assert/strict';
import {removeEmptyFoliagePlacements} from '../authoring/empty-foliage-placements.mjs';
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const ghost={actor:'InstancedFoliageActor_0',name:'FoliageInstancedStaticMeshComponent_11',instanced:false,matrix};
test('legacy empty foliage containers disappear without discarding real origin instances or ordinary meshes',()=>{
 const real={...ghost,instanced:true},ordinary={...ghost,actor:'StaticMeshActor_0'},unknown={...ghost};delete unknown.instanced;
 const offset={...ghost,matrix:[...matrix]};offset.matrix[12]=50;
 const data={region:'fixture',prototypes:[{name:'MixedBush',file:'bush.gltf',placements:[ghost,real,ordinary,unknown]},{name:'EmptyTree',file:'tree.gltf',placements:[ghost,offset]}]};
 const {world,removed}=removeEmptyFoliagePlacements(data);
 assert.equal(removed,3);assert.equal(world.prototypes.length,1);
 assert.deepEqual(world.prototypes[0].placements,[real,ordinary,unknown]);
 assert.equal(data.prototypes[0].placements.length,4,'source is not mutated');
 assert.equal(world.prototypes[0].file,'bush.gltf');
 assert.equal(removeEmptyFoliagePlacements(world).world,world,'cleanup is idempotent');
});

test('compact publication cleans adopted world data even without a catalog',async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),{createHash}=await import('node:crypto'),{brotliCompressSync,brotliDecompressSync}=await import('node:zlib'),{publishCompactWorld}=await import('../publish-compact.mjs');
 const base=path.resolve('.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'empty-foliage-'));
 try{
  const input=path.join(root,'input'),viewer=path.join(input,'viewer'),target=path.join(root,'output');
  for(const dir of ['dependency-bundles/regions','recipe-rollout/regions'])await fs.mkdir(path.join(viewer,dir),{recursive:true});await fs.mkdir(path.join(input,'blobs'));
  const real={...ghost,instanced:true},raw=Buffer.from(JSON.stringify({prototypes:[{name:'Ghost',placements:[ghost]},{name:'RealOrigin',placements:[real]}]})),encoded=brotliCompressSync(raw),hash=createHash('sha256').update(encoded).digest('hex'),entry={blob:hash,codec:'brotli',bytes:encoded.length};
  await fs.writeFile(path.join(input,'blobs',hash),encoded);
  await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs:{[hash]:{bytes:encoded.length,entry,ids:['fixture/world.json']}}}));
  await fs.writeFile(path.join(viewer,'dependency-bundles/regions/fixture.json'),JSON.stringify({resources:{'fixture/world.json':entry}}));
  await fs.writeFile(path.join(viewer,'recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  await fs.writeFile(path.join(viewer,'recipe-rollout/regions/fixture.json'),JSON.stringify({roads:{parts:{}},decals:{parts:{}}}));
  const result=await publishCompactWorld({input,target,catalog:null}),region=result.index.regions.fixture;
  const manifest=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,region.manifest.path))));
  const world=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,manifest.resources['fixture/world.json'].resource.path))));
  assert.deepEqual(world.prototypes.map(p=>p.name),['RealOrigin']);assert.deepEqual(world.prototypes[0].placements,[real]);
  assert.equal(region.downloadBytes,manifest.physicalResources.reduce((n,r)=>n+r.bytes,region.manifest.bytes));
  const again=await publishCompactWorld({input,target,catalog:null});assert.deepEqual(again.index.regions.fixture,region,'repeat exports remain deterministic');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
