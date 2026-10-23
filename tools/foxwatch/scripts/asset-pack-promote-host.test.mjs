import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareHostPromotion,retargetRelease} from './asset-pack-promote-host.mjs';
import {readPublicationPlan} from './asset-pack-publication.mjs';
test('host promotion publishes only metadata and retains all immutable bulk receipts',async t=>{
 const outputRoot=await fs.mkdtemp(path.join(os.tmpdir(),'asset-host-promotion-'));t.after(()=>fs.rm(outputRoot,{recursive:true,force:true}));
 const receipt={sha256:'a'.repeat(64),byteLength:42},old='https://test.example/assets/',next='https://assets.example/assets/';
 const release={worldBaseUrl:old+'world/',packs:{catalog:{pack:{manifest:{url:old+'index.json',...receipt}},mapping:{url:old+'mapping.json',...receipt}}},bootstrap:{unchanged:receipt}};
 const pin={publication:{url:old+'release.json',...receipt},resourcePack:{manifest:{url:old+'runtime.json',...receipt}},buildMetadata:{url:old+'derived.json',...receipt}};
 const moved=retargetRelease(release,old,next);assert.equal(moved.packs.catalog.pack.manifest.sha256,receipt.sha256);assert.deepEqual(moved.bootstrap,release.bootstrap);
 assert.throws(()=>retargetRelease(release,'https://wrong.test/',next),/escapes/);
 const result=await prepareHostPromotion({pin,target:{endpoint:'https://s3.example',bucket:'test',prefix:'assets',publicBaseUrl:'https://assets.example/'},outputRoot,
  read:async row=>row.url===pin.publication.url?release:{publicationSha256:receipt.sha256,models:{}}});
 const {plan}=await readPublicationPlan(result.planPath);assert.equal(plan.objects.length,2);assert.ok(plan.objects.every(row=>row.mediaType==='application/json'));
 assert.equal(result.pin.resourcePack.manifest.url,next+'runtime.json');assert.equal(result.pin.resourcePack.manifest.sha256,receipt.sha256);
 assert.ok(result.pin.publication.url.startsWith(next));assert.ok(result.pin.buildMetadata.url.startsWith(next));
});
