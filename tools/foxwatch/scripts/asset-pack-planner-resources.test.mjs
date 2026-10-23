import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {preparePlannerResourcePublication} from './asset-pack-planner-resources.mjs';
import {readPublicationPlan} from './asset-pack-publication.mjs';
import {publishAssetPublication} from './asset-pack-publisher.mjs';
test('planner overlays publish only new UI images and a pinned index; library models remain remote',async()=>{
 const output=await fs.mkdtemp(path.join(tmpdir(),'planner-resource-overlay-'));
 try {
  const image=Buffer.from('UI pixels'),sha=createHash('sha256').update(image).digest('hex'),imagePath='objects/raw/'+sha+'/asset.webp';
  const index={contractVersion:1,assets:[
   {path:imagePath,sha256:sha,byteLength:image.length,mediaType:'image/webp'},
   {path:'dist/browser/0.webp',sourcePath:imagePath,sha256:sha,byteLength:image.length,mediaType:'image/webp'},
   {path:'dist/factory.glb',sourcePath:'objects/existing/asset.glb',sha256:'a'.repeat(64),byteLength:1000,mediaType:'model/gltf-binary'}]};
  const target={endpoint:'https://s3.example.test',bucket:'asset-test',publicBaseUrl:'https://assets.example.test/',prefix:'library'};
  const publication={url:'https://assets.example.test/library/release.json',sha256:'b'.repeat(64),byteLength:100};
  const prepared=await preparePlannerResourcePublication({index,target,publication,outputRoot:output,payloads:[{path:imagePath,bytes:image}]});
  const {plan}=await readPublicationPlan(prepared.planPath);
  assert.equal(plan.objects.length,2);assert.equal(plan.objects[0].phase,'assets');assert.equal(plan.objects[1].phase,'release');
  const uploaded=[],stored=new Map();
  const transport={head:async key=>stored.get(key),put:async row=>{uploaded.push(row);stored.set(row.key,row);}};
  const first=await publishAssetPublication({planPath:prepared.planPath,transport});
  assert.equal(first.stats.uploaded,2);assert.ok(uploaded[0].key.includes(sha));assert.ok(uploaded[1].key.includes('planner-resources-'));
  assert.equal(uploaded.some(row=>row.key.endsWith('.glb')),false);
  const resumed=await publishAssetPublication({planPath:prepared.planPath,transport});
  assert.equal(resumed.stats.uploadedBytes,0);assert.equal(resumed.stats.reused,2);
 }finally{assert.ok(output.startsWith(path.resolve(tmpdir())+path.sep));await fs.rm(output,{recursive:true,force:true});}
});
