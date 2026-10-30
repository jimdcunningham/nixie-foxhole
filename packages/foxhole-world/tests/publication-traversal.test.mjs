import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {publishCompactWorld} from '../publish-compact.mjs';

test('aliased resources never serialize traversal flags and publish consistently across region order',async()=>{
 const temp=path.resolve('.tmp');await fs.mkdir(temp,{recursive:true});const root=await fs.mkdtemp(path.join(temp,'world-traversal-'));
 try{
  const input=root+'/prepared',viewer=input+'/viewer',target=root+'/world';
  await fs.mkdir(input+'/blobs',{recursive:true});for(const folder of ['dependency-bundles/regions','recipe-rollout/regions'])await fs.mkdir(viewer+'/'+folder,{recursive:true});
  const bytes=brotliCompressSync(Buffer.from('shared data')),hash=createHash('sha256').update(bytes).digest('hex'),entry={blob:hash,bytes:bytes.length,codec:'brotli',sourceHash:hash};
  await fs.writeFile(input+'/blobs/'+hash,bytes);
  await fs.writeFile(viewer+'/dependency-bundles/manifest.json',JSON.stringify({blobs:{[hash]:{bytes:bytes.length,entry}}}));
  await fs.writeFile(viewer+'/recipe-rollout/manifest.json',JSON.stringify({content:{}}));
  for(const id of ['first','second']){
   await fs.writeFile(viewer+'/dependency-bundles/regions/'+id+'.json',JSON.stringify({resources:{[id+'/data.bin.gz']:entry,[id+'/data.bin']:entry}}));
   await fs.writeFile(viewer+'/recipe-rollout/regions/'+id+'.json',JSON.stringify({version:1,region:id,terrain:{},roads:{parts:{}}}));
  }
  const result=await publishCompactWorld({input,target,catalog:null});
  for(const [id,region]of Object.entries(result.index.regions)){
   const doc=JSON.parse(brotliDecompressSync(await fs.readFile(target+'/'+region.manifest.path)));
   const walk=value=>{if(!value||typeof value!=='object')return;assert.equal(Object.hasOwn(value,'visited'),false,'bookkeeping leaked in '+id);for(const child of Object.values(value))walk(child);};walk(doc);
   assert.equal(doc.physicalResources.length,1);
  }
  const isolated=await publishCompactWorld({input,target:root+'/isolated',regions:['second'],catalog:null});
  assert.equal(isolated.index.regions.second.manifest.hash,result.index.regions.second.manifest.hash);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
