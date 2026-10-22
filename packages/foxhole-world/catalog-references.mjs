import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';

export function catalogReferences(catalog,assets){
 const refs=new Map();
 for(const asset of assets){
  const descriptor=catalog.assets[asset];if(!descriptor)throw Error('Missing catalog asset '+asset);
  refs.set(descriptor.path,{assetId:asset,path:descriptor.path,sha256:descriptor.sha256,bytes:descriptor.bytes});
  for(const part of descriptor.modelParts?.parts||[]){
   const key=part.resourceId.replace(/^foxhole\.model\./,''),shared=catalog.sharedParts?.[key];
   if(!shared)throw Error('Missing catalog shared part '+key);
   refs.set(shared.path,{assetId:key,path:shared.path,sha256:shared.sha256,bytes:shared.bytes});
  }
 }
 return [...refs.values()];
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Refresh only external catalog receipts after a scoped catalog export. Map payloads stay immutable. */
export async function syncCatalogReferences({target,catalog}){
 target=path.resolve(target);
 catalog??=JSON.parse(await fs.readFile(path.resolve(target,'../models/manifest.v1.json'),'utf8'));
 const index=JSON.parse(await fs.readFile(path.join(target,'index.json'),'utf8')),updated=[];
 if(index.version!==1||index.format!=='compact-recipes-v1')throw Error('Unsupported compact world index');
 for(const [id,entry]of Object.entries(index.regions)){
  const old=entry.manifest;
  if(!/^content\/br\/[a-f0-9]{64}\/asset\.json$/.test(old.path))throw Error('Invalid region manifest path');
  const bytes=await fs.readFile(path.join(target,old.path));
  if(bytes.length!==old.bytes||digest(bytes)!==old.hash)throw Error('Region manifest integrity failure');
  const decoded=brotliDecompressSync(bytes);if(digest(decoded)!==old.decodedHash)throw Error('Decoded region manifest integrity failure');
  const document=JSON.parse(decoded);if(!document.catalogResources?.length)continue;
  const assets=document.catalogResources.map(r=>r.assetId).filter(id=>!id.startsWith('shared.'));
  const refs=catalogReferences(catalog,assets);
  if(JSON.stringify(refs)===JSON.stringify(document.catalogResources))continue;
  document.catalogResources=refs;
  const raw=Buffer.from(JSON.stringify(document)),encoded=brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:6}}),hash=digest(encoded),file='content/br/'+hash+'/asset.json';
  await fs.mkdir(path.dirname(path.join(target,file)),{recursive:true});
  try{await fs.writeFile(path.join(target,file),encoded,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(digest(await fs.readFile(path.join(target,file)))!==hash)throw Error('Existing immutable manifest is corrupt');}
  entry.manifest={path:file,hash,bytes:encoded.length,encoding:'br',decodedHash:digest(raw)};
  entry.downloadBytes+=encoded.length-old.bytes;
  entry.catalogBytes=refs.reduce((n,r)=>n+(r.bytes||0),0);updated.push(id);
 }
 if(updated.length){const temporary=path.join(target,'index.catalog.'+process.pid+'.tmp');await fs.writeFile(temporary,JSON.stringify(index));await fs.rename(temporary,path.join(target,'index.json'));}
 return {regions:updated.length,updated};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(import.meta.dirname,'catalog-references.mjs')){
 const target=process.argv[2];if(!target)throw Error('Pass the published world directory');
 console.log(JSON.stringify(await syncCatalogReferences({target})));
}
