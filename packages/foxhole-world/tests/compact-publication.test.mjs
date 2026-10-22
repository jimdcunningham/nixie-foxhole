import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {adoptPreparedSource} from '../adopt-prepared.mjs';
import {retireUnusedWorldContent} from '../retire-unused.mjs';
import {publishCompactWorld} from '../publish-compact.mjs';

test('compact publication preserves encoded images, rewrites model dependencies and excludes every expanded alias',async()=>{
 const temp=path.resolve('.tmp');await fs.mkdir(temp,{recursive:true});const root=await fs.mkdtemp(path.join(temp,'foxhole-compact-test-'));
 try{
  const input=path.join(root,'prepared'),viewer=path.join(input,'viewer'),target=path.join(root,'delivery'),blobs={};
  for(const name of ['dependency-bundles/regions','recipe-rollout/regions'])await fs.mkdir(path.join(viewer,name),{recursive:true});await fs.mkdir(path.join(input,'blobs'),{recursive:true});
  async function save(raw,codec='identity'){const bytes=codec==='brotli'?brotliCompressSync(raw):raw,hash=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(path.join(input,'blobs',hash),bytes);const entry={blob:hash,bytes:bytes.length,codec,sourceHash:hash};blobs[hash]={bytes:bytes.length,entry};return entry;}
  const image=await save(Buffer.from('original encoded texture bytes'));
  const gltf=await save(Buffer.from(JSON.stringify({images:[{uri:`/__asset_ab/content/B/${image.blob}/${image.sourceHash}/asset.png`}]})),'brotli');
  const weights=await save(Buffer.from('decoded terrain weights'),'brotli');
  const expanded=await save(Buffer.from('expanded road geometry'),'brotli');
  await fs.writeFile(path.join(viewer,'dependency-bundles/manifest.json'),JSON.stringify({blobs}));
  await fs.writeFile(path.join(viewer,'recipe-rollout/manifest.json'),JSON.stringify({content:{}}));
  await fs.writeFile(path.join(viewer,'recipe-rollout/regions/test.json'),JSON.stringify({version:1,region:'test',terrain:{},roads:{parts:{}}}));
  await fs.writeFile(path.join(viewer,'dependency-bundles/regions/test.json'),JSON.stringify({resources:{'test/terrain-live/weights.bin.gz':weights,'test/model.gltf':gltf,'shared/image.png':image,'test/roads/render-vertices.bin.gz':expanded,'test/roads/reduced-vertices.bin.gz':expanded}}));
  const result=await publishCompactWorld({input,target});
  const entry=result.index.regions.test,metadata=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,entry.manifest.path))));
  assert.match(metadata.resources['test/terrain-live/weights.bin.gz'].resource.path,/asset\.bin$/);
  assert.equal(metadata.resources['test/roads/reduced-vertices.bin.gz'].resource,undefined);
  assert.equal(metadata.resources['test/roads/reduced-vertices.bin.gz'].recipeOf,'test/roads/render-vertices.bin.gz');
  assert.ok(!metadata.physicalResources.some(ref=>ref.hash===expanded.blob));assert.equal(entry.resources,undefined);assert.ok(JSON.stringify(result.index).length<2000);
  const texture=metadata.resources['shared/image.png'].resource;assert.equal(texture.hash,image.blob);
  assert.deepEqual(await fs.readFile(path.join(target,texture.path)),Buffer.from('original encoded texture bytes'));
  const model=metadata.resources['test/model.gltf'].resource,doc=JSON.parse(brotliDecompressSync(await fs.readFile(path.join(target,model.path))));
  assert.equal(new URL(doc.images[0].uri,new URL(model.path,'https://assets.test/world/')).pathname,'/world/'+texture.path);
  assert.equal(entry.downloadBytes,metadata.physicalResources.reduce((n,r)=>n+r.bytes,entry.manifest.bytes));
  const adopted=path.join(root,'adopted');await adoptPreparedSource(viewer,adopted);const roundtrip=await publishCompactWorld({input:adopted,target:path.join(root,'roundtrip')});assert.equal(roundtrip.index.regions.test.manifest.hash,entry.manifest.hash);
  const oldIndex=JSON.parse(await fs.readFile(path.join(target,'index.json'),'utf8'));oldIndex.regions.other={...entry,id:'other'};await fs.writeFile(path.join(target,'index.json'),JSON.stringify(oldIndex));
  const second=await publishCompactWorld({input,target,regions:['test']});assert.deepEqual(second.index.regions.test,entry);assert.ok(second.index.regions.other);
  const orphan='content/raw/'+expanded.blob+'/asset.bin';await fs.mkdir(path.dirname(path.join(target,orphan)),{recursive:true});await fs.writeFile(path.join(target,orphan),'old unreachable output');
  await assert.rejects(retireUnusedWorldContent({target,retired:path.join(target,'retired')}),/outside/);
  const retired=path.join(root,'retired'),cleanup=await retireUnusedWorldContent({target,retired});assert.equal(cleanup.files,1);assert.equal(await fs.readFile(path.join(retired,orphan),'utf8'),'old unreachable output');await fs.access(path.join(target,texture.path));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
