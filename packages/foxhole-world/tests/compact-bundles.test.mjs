import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {attachCompactBundles,validateCompactBundle} from '../runtime/compact-bundles.mjs';
import {fetchCompactResource,compactResourceCacheKey} from '../runtime/compact-cache.mjs';
import {bundleCompactWorld} from '../bundle-compact.mjs';
import {memoryWorldCaches} from './cache-fixture.mjs';
import {auditCompactBundles} from '../audit-compact-bundles.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(suffix=''){
 const chunks=['one'+suffix,'two'+suffix].map(v=>Buffer.from(v)),refs=chunks.map(b=>({path:`content/raw/${hash(b)}/asset.bin`,hash:hash(b),bytes:b.length,decodedHash:hash(b)}));
 const body=Buffer.concat(chunks),encoded=brotliCompressSync(body),bundle={resource:{path:`content/br/${hash(encoded)}/asset.bin`,hash:hash(encoded),bytes:encoded.length,encoding:'br',decodedHash:hash(body),decodedBytes:body.length},entries:refs.map((r,i)=>({path:r.path,decodedHash:r.decodedHash,encoding:'raw',offset:i?chunks[0].length:0,bytes:r.bytes}))};
 refs.forEach(r=>r.bundle=bundle);return {chunks,refs,body,bundle};
}
test('one demanded group seeds shared per-asset cache without fetching disabled layers',async()=>{
 const f=fixture('shared'),disabled=fixture('disabled'),storage=memoryWorldCaches(),calls=[],metrics={downloadBytes:0,cacheHits:0,cacheMisses:0};
 const options={cachesApi:storage.api,metrics,fetcher:async url=>{calls.push(url);return new Response(f.body);}};
 const values=await Promise.all(f.refs.map(ref=>fetchCompactResource('https://bundle.invalid/world/',ref,options)));
 assert.deepEqual(values.map(b=>Buffer.from(b)),f.chunks);assert.equal(calls.length,1);assert.equal(metrics.downloadBytes,f.bundle.resource.bytes);
 for(const ref of f.refs){const independent={...ref};delete independent.bundle;await fetchCompactResource('https://other-region.invalid/world/',independent,{...options,fetcher:()=>{throw Error('Unexpected network');}});}
 assert.equal(storage.rows('foxhole-world-compact-v1').has(compactResourceCacheKey(disabled.refs[0])),false);
});
test('corrupt or missing bundle falls back to the original verified resource',async()=>{
 for(const missing of [true,false]){const f=fixture('fallback'+missing),calls=[],storage=memoryWorldCaches();const result=await fetchCompactResource('https://fallback.invalid/world/',f.refs[0],{cachesApi:storage.api,fetcher:async url=>{calls.push(url);return url.endsWith(f.bundle.resource.path)?new Response(missing?'missing':'bad',{status:missing?404:200}):new Response(f.chunks[0]);}});assert.deepEqual(Buffer.from(result),f.chunks[0]);assert.equal(calls.length,2);}
});
test('reject invalid bundle bounds and attach only declared unchanged identities',()=>{
 const f=fixture('validate');assert.throws(()=>validateCompactBundle({...f.bundle,resource:{...f.bundle.resource,decodedBytes:4*1024**2+1}}),/Invalid/);
 assert.throws(()=>validateCompactBundle({...f.bundle,entries:[{...f.bundle.entries[0],offset:-1},f.bundle.entries[1]]}),/entry/);
 const refs=f.refs.map(({bundle,...ref})=>ref),manifest={resources:{terrain:{resource:{...refs[0]}}},physicalResources:[...refs,f.bundle.resource],bundles:{version:1,groups:[f.bundle]}};
 attachCompactBundles(manifest);assert.equal(manifest.resources.terrain.resource.bundle,f.bundle);
});
test('aborting one bundled subscriber keeps another alive and drains the final owner',async()=>{
 const f=fixture('abort'),storage=memoryWorldCaches(),abort=new AbortController();let started,finish;
 const ready=new Promise(r=>started=r),released=new Promise(r=>finish=r);let calls=0;
 const options={cachesApi:storage.api,fetcher:async()=>{calls++;started();await released;return new Response(f.body);}};
 const first=fetchCompactResource('https://abort-bundle.invalid/world/',f.refs[0],{...options,signal:abort.signal}),second=fetchCompactResource('https://abort-bundle.invalid/world/',f.refs[1],options);
 const rejected=assert.rejects(first,{name:'AbortError'});await ready;abort.abort();finish();await rejected;assert.deepEqual(Buffer.from(await second),f.chunks[1]);assert.equal(calls,1);
});
test('builder separates water, terrain tiers and region usage, and stays within decoded budget',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'compact-bundles-'));try{
 const source=root+'/source',target=root+'/candidate';await fs.mkdir(source,{recursive:true});
 const store=async(value,extension='.bin')=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value)),encoded=brotliCompressSync(bytes),ref={path:`content/br/${hash(encoded)}/asset${extension}`,hash:hash(encoded),bytes:encoded.length,encoding:'br',decodedHash:hash(bytes)};await fs.mkdir(path.dirname(source+'/'+ref.path),{recursive:true});await fs.writeFile(source+'/'+ref.path,encoded);return ref;};
 const refs=await Promise.all(['color-a','color-b','water-a','water-b','lower-a','lower-b'].map(s=>store(s)));
 const index={version:1,format:'compact-recipes-v1',regions:{}};
 for(const id of ['a','b']){const manifest={version:1,format:'compact-recipes-v1',region:id,resources:{[id+'/terrain-live/albedo-0.bin.gz']:{slices:refs.slice(0,2).map((resource,i)=>({resource,tiers:{128:{resource:refs[i+4]}}}))},'water-source/x':{resource:refs[2]},'water-source/y':{resource:refs[3]}},physicalResources:refs,recipes:{}};index.regions[id]={id,manifest:await store(manifest,'.json')};}
 await fs.writeFile(source+'/index.json',JSON.stringify(index));const result=await bundleCompactWorld({source,target,regions:['a'],decodedBudget:64});assert.deepEqual(Object.keys(result.regions),['a']);
 const receipt=result.regions.a.manifest,manifest=JSON.parse(brotliDecompressSync(await fs.readFile(target+'/'+receipt.path)));assert.equal(manifest.bundles.groups.length,3);attachCompactBundles(manifest);
 for(const group of manifest.bundles.groups){assert.ok(group.resource.decodedBytes<=64);assert.deepEqual(group.usage[0],['shared','a']);assert.equal(group.usage[1].length,1);}
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('separate worker realms share a bundle lock and reuse the seeded content cache',async()=>{
 const f=fixture('realms'),storage=memoryWorldCaches(),cache=await storage.api.open('foxhole-world-compact-v1');let tail=Promise.resolve(),calls=0;
 const locks={request:(_name,_options,run)=>{const result=tail.then(run);tail=result.catch(()=>{});return result;}};
 const [first,second]=await Promise.all([import('../runtime/compact-bundles.mjs?realm=one'),import('../runtime/compact-bundles.mjs?realm=two')]);
 const options={cache,locks,fetcher:async()=>{calls++;return new Response(f.body);}};
 const values=await Promise.all([first.readCompactBundle('https://realms.invalid/world/',f.refs[0],options),second.readCompactBundle('https://realms.invalid/world/',f.refs[1],options)]);
 assert.deepEqual(values.map(b=>Buffer.from(b)),f.chunks);assert.equal(calls,1);
});

test('all-region generation preserves regional closures and reuses content-addressed archives',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'compact-all-regions-'));try{
  const source=root+'/source';await fs.mkdir(source,{recursive:true});
  const store=async(value,extension='.bin')=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value)),encoded=brotliCompressSync(bytes),ref={path:`content/br/${hash(encoded)}/asset${extension}`,hash:hash(encoded),bytes:encoded.length,encoding:'br',decodedHash:hash(bytes)};await fs.mkdir(path.dirname(source+'/'+ref.path),{recursive:true});await fs.writeFile(source+'/'+ref.path,encoded);return ref;};
  const shared=await Promise.all(['sky-common-one','sky-common-two'].map(s=>store(s)));
  const partial=await Promise.all(['water-ab-one','water-ab-two','water-ac-one','water-ac-two'].map(s=>store(s)));
  const index={version:1,format:'compact-recipes-v1',regions:{}};
  for(const id of ['a','b','c']){const water=id==='a'?partial:id==='b'?partial.slice(0,2):partial.slice(2),refs=[...shared,...water],resources=Object.fromEntries(refs.map((resource,i)=>[id+'/'+(i<2?'sky-source/':'water-source/')+i,{resource}]));index.regions[id]={id,manifest:await store({version:1,format:'compact-recipes-v1',region:id,resources,physicalResources:refs,recipes:{}},'.json')};}
  await fs.writeFile(source+'/index.json',JSON.stringify(index));
  const all=await bundleCompactWorld({source,target:root+'/all',regions:'all'});assert.deepEqual(Object.keys(all.regions),['a','b','c']);
  const manifests=await Promise.all(Object.values(all.regions).map(async e=>JSON.parse(brotliDecompressSync(await fs.readFile(root+'/all/'+e.manifest.path)))));
  for(const manifest of manifests){attachCompactBundles(structuredClone(manifest));const own=new Set(manifest.physicalResources.map(r=>r.path));for(const group of manifest.bundles.groups)for(const entry of group.entries)assert.ok(own.has(entry.path));}
  const skies=manifests.map(m=>m.bundles.groups.find(g=>g.usage[1].includes('sky')).resource.path);assert.equal(new Set(skies).size,1);
  const single=await bundleCompactWorld({source,target:root+'/single',regions:['b']});assert.equal(single.regions.b.manifest.hash,all.regions.b.manifest.hash);
  const report=await auditCompactBundles({root:root+'/all',expectedRegions:3});assert.equal(report.regions.length,3);assert.ok(report.sharedBundles>0);
  await fs.writeFile(root+'/all/'+manifests[0].bundles.groups[0].resource.path,'corrupt');await assert.rejects(auditCompactBundles({root:root+'/all'}),/receipt/);
  await assert.rejects(bundleCompactWorld({source,target:source+'/nested',regions:'all'}),/outside the source/);
  await assert.rejects(bundleCompactWorld({source,target:root+'/all',regions:'all'}),/empty/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('last cancellation waits for every started bundle cache write to drain',async()=>{
 const f=fixture('drain'),storage=memoryWorldCaches(),abort=new AbortController();let started,release;
 const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r),open=storage.api.open;
 storage.api.open=async name=>{const cache=await open(name);if(name!=='foxhole-world-compact-v1')return cache;return {...cache,put:async(key,response)=>{started();await gate;return cache.put(key,response);}};};
 let settled=false;const pending=fetchCompactResource('https://drain-bundle.invalid/world/',f.refs[0],{cachesApi:storage.api,signal:abort.signal,fetcher:async()=>new Response(f.body)}).catch(error=>{settled=true;throw error;});const rejected=assert.rejects(pending,{name:'AbortError'});
 await ready;abort.abort();await new Promise(r=>setImmediate(r));assert.equal(settled,false);release();await rejected;assert.equal(settled,true);
});
