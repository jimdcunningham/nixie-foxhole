import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {attachCompactBundles,validateCompactBundle} from './runtime/compact-bundles.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const contentPath=/^content\/(br|raw)\/([a-f0-9]{64})\/asset\.[a-z0-9]+$/;
export async function auditCompactBundles({root,expectedRegions,onProgress=()=>{}}){
 root=await fs.realpath(root);const index=JSON.parse(await fs.readFile(path.join(root,'index.json'))),verified=new Map(),archives=new Map(),originals=new Map(),regions=[];
 if(expectedRegions!==undefined&&Object.keys(index.regions).length!==expectedRegions)throw Error('Unexpected compact bundle region count');
 const read=async ref=>{const match=contentPath.exec(ref.path);if(!match||match[2]!==ref.hash||!['br','raw'].includes(ref.encoding||'raw')||match[1]!== (ref.encoding||'raw'))throw Error('Invalid content receipt');const encoded=await fs.readFile(path.join(root,ref.path));if(encoded.length!==ref.bytes||sha(encoded)!==ref.hash)throw Error('Encoded receipt mismatch: '+ref.path);const bytes=ref.encoding==='br'?brotliDecompressSync(encoded,{maxOutputLength:512*1024**2}):encoded;if(sha(bytes)!==ref.decodedHash||ref.decodedBytes!==undefined&&ref.decodedBytes!==bytes.length)throw Error('Decoded receipt mismatch: '+ref.path);return bytes;};
 const verify=async ref=>{const known=verified.get(ref.path);if(known){if(known.hash!==ref.hash||known.bytes!==ref.bytes||known.decodedHash!==ref.decodedHash||known.encoding!==(ref.encoding||'raw')||ref.decodedBytes!==undefined&&known.decodedBytes!==ref.decodedBytes)throw Error('Conflicting content receipt');return known;}const bytes=await read(ref);const row={...ref,encoding:ref.encoding||'raw',decodedBytes:bytes.length};verified.set(ref.path,row);return row;};
 for(const [id,entry] of Object.entries(index.regions).sort(([a],[b])=>a.localeCompare(b))){
  await verify(entry.manifest);const manifest=JSON.parse(await read(entry.manifest));if(manifest.region!==id||manifest.bundles?.version!==1||manifest.bundles.decodedBudget>4*1024**2)throw Error('Invalid bundled region manifest');
  const physical=new Map();for(const ref of manifest.physicalResources){if(physical.has(ref.path))throw Error('Duplicate physical resource');physical.set(ref.path,ref);await verify(ref);}
  const packed=new Set(),bundlePaths=new Set();
  for(const group of manifest.bundles.groups){validateCompactBundle(group);if(!group.regions?.includes(id))throw Error('Invalid bundle region ownership');const body=await read(group.resource);bundlePaths.add(group.resource.path);let archive=archives.get(group.resource.path);if(!archive){archive={...group.resource,regions:new Set()};archives.set(group.resource.path,archive);}archive.regions.add(id);
   for(const e of group.entries){if(packed.has(e.path)||!physical.has(e.path))throw Error('Bundle entry outside regional closure');const ref=await verify(physical.get(e.path)),slice=body.subarray(e.offset,e.offset+e.bytes);if(ref.decodedHash!==e.decodedHash||ref.decodedBytes!==e.bytes||ref.encoding!==e.encoding||sha(slice)!==ref.decodedHash)throw Error('Bundle entry receipt mismatch');packed.add(e.path);}
  }
  // Validate every logical receipt and rewritten dependency against this region.
  const visit=value=>{if(!value||typeof value!=='object')return;if(value.path&&value.decodedHash){const own=physical.get(value.path);if(!own||own.hash!==value.hash||own.bytes!==value.bytes||own.decodedHash!==value.decodedHash)throw Error('Undeclared logical resource');return;}for(const [key,child] of Object.entries(value))if(key!=='bundles')visit(child);};visit(manifest);
  for(const ref of physical.values()){if(bundlePaths.has(ref.path))continue;originals.set(ref.path,ref);if(/\.(json|gltf|cubemap)$/.test(ref.path)){const text=(await read(ref)).toString();for(const match of text.matchAll(/(?:\.\.\/\.\.\/|content\/)(br|raw)\/([a-f0-9]{64})\/asset(\.[a-z0-9]+)/g))if(!physical.has(`content/${match[1]}/${match[2]}/asset${match[3]}`))throw Error('Undeclared rewritten dependency');}}
  attachCompactBundles(manifest);
  const downloadBytes=entry.manifest.bytes+[...physical.values()].reduce((n,r)=>n+r.bytes,0),bundleDownloadBytes=entry.manifest.bytes+[...physical.values()].filter(r=>!packed.has(r.path)).reduce((n,r)=>n+r.bytes,0);if(downloadBytes!==entry.downloadBytes||bundleDownloadBytes!==entry.bundleDownloadBytes)throw Error('Incorrect region download totals');
  const row={id,bundles:bundlePaths.size,bundledResources:packed.size,standaloneResources:physical.size-bundlePaths.size-packed.size,originalEncodedBytes:[...physical.values()].filter(r=>!bundlePaths.has(r.path)).reduce((n,r)=>n+r.bytes,0),bundleDownloadBytes};regions.push(row);onProgress(row);
 }
 return {regionCount:regions.length,verifiedFiles:verified.size,originalFiles:originals.size,originalEncodedBytes:[...originals.values()].reduce((n,r)=>n+r.bytes,0),uniqueBundles:archives.size,bundleEncodedBytes:[...archives.values()].reduce((n,r)=>n+r.bytes,0),sharedBundles:[...archives.values()].filter(r=>r.regions.size>1).length,maximumDecodedBundleBytes:Math.max(0,...[...archives.values()].map(r=>r.decodedBytes)),regions};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const get=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
 const report=await auditCompactBundles({root:get('--root'),expectedRegions:get('--expected-regions')?Number(get('--expected-regions')):undefined,onProgress:row=>console.log(JSON.stringify(row))});
 if(get('--report'))await fs.writeFile(get('--report'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,regions:undefined}));
}
