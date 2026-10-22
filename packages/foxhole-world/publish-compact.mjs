import {removeEmptyFoliagePlacements} from './authoring/empty-foliage-placements.mjs';
import {catalogReferences} from './catalog-references.mjs';
import {prepareCatalogWorld} from './authoring/catalog-world-policy.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const isHash=value=>/^[a-f0-9]{64}$/.test(value);
/** Publish the verified compact dependency graph; never expand geometry or re-encode textures. */
export async function publishCompactWorld({input,target,regions,catalog,onProgress=()=>{}}){
 const root=await fs.realpath(input),viewer=path.join(root,'viewer');
 const dependencies=JSON.parse(await fs.readFile(path.join(viewer,'dependency-bundles/manifest.json'),'utf8'));
 const recipes=JSON.parse(await fs.readFile(path.join(viewer,'recipe-rollout/manifest.json'),'utf8'));
 const ids=regions?.length?regions:(await fs.readdir(path.join(viewer,'dependency-bundles/regions'))).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5));
 const pending=new Map(),resources=new Map(),index={version:1,format:'compact-recipes-v1',regions:{}};
 const logicalRefs=new Map();for(const [blob,row]of Object.entries(dependencies.blobs))for(const id of row.ids||[])logicalRefs.set(id,{...row.entry,blob});
 target=path.resolve(target);
 if(catalog===undefined){try{catalog=JSON.parse(await fs.readFile(path.resolve(target,'../models/manifest.v1.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;catalog=null;}}
 if(regions?.length){try{const previous=JSON.parse(await fs.readFile(path.join(target,'index.json'),'utf8'));if(previous.version===index.version&&previous.format===index.format)Object.assign(index.regions,previous.regions);}catch(error){if(error.code!=='ENOENT')throw error;}}
 const resolveFile=async file=>{const actual=await fs.realpath(file);if(!actual.startsWith(root+path.sep))throw Error('Prepared resource escapes input directory');return actual;};
 async function store(bytes,extension,encoding){
  // A legacy logical .gz name describes its source, not this Brotli payload.
  // Static servers infer gzip from that suffix and would add a second encoding.
  if(encoding&&extension==='.gz')extension='.bin';
  const hash=digest(bytes),file=`content/${encoding?'br':'raw'}/${hash}/asset${extension}`,destination=path.join(target,file);
  const ref={path:file,hash,bytes:bytes.length,...(encoding?{encoding}:{}),decodedHash:encoding?digest(brotliDecompressSync(bytes)):hash};
  if(!resources.has(file)){await fs.mkdir(path.dirname(destination),{recursive:true});try{await fs.writeFile(destination,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(digest(await fs.readFile(destination))!==hash)throw Error('Existing immutable resource is corrupt');}resources.set(file,ref);}
  return ref;
 }
 // Relative child URIs work with the stock glTF loader, without global URL/fetch patches.
 async function rewrite(value,relative,parent){
  if(typeof value==='string'){
   const match=value.match(/^\/(?:__asset_ab\/content\/B\/([a-f0-9]{64})\/[a-f0-9]{64}\/asset(\.[a-z0-9]+)|__delivery_blob\/([a-f0-9]{64})\/asset(\.[a-z0-9]+))$/);
   if(match){const ref=await content(match[1]||match[3],match[2]||match[4]);return relative?'../../'+ref.path.slice('content/'.length):ref.path;}
   if(parent&&/\.(png|webp|jpg|jpeg|bin|gltf|glb|cubemap)$/i.test(value)&&!value.startsWith('data:')){const key=path.posix.normalize(path.posix.join(path.posix.dirname(parent),value)),child=logicalRefs.get(key);if(!child)throw Error('Undeclared relative asset '+key);const ref=await content(child.blob,path.posix.extname(key));return '../../'+ref.path.slice('content/'.length);}
   return value;
  }
  if(Array.isArray(value))return Promise.all(value.map(v=>rewrite(v,relative,parent)));
  if(value&&typeof value==='object'){const result={};for(const [k,v]of Object.entries(value))result[k]=await rewrite(v,relative,parent);return result;}
  return value;
 }
 async function rewriteUrlText(raw){
  const text=raw.toString(),pattern=/"(\/(?:__asset_ab\/content\/B\/[a-f0-9]{64}\/[a-f0-9]{64}\/asset\.[a-z0-9]+|__delivery_blob\/[a-f0-9]{64}\/asset\.[a-z0-9]+))"/g;
  const urls=new Map();for(const match of text.matchAll(pattern))if(!urls.has(match[1]))urls.set(match[1],await rewrite(match[1],false));
  return urls.size?Buffer.from(text.replace(pattern,(_,url)=>JSON.stringify(urls.get(url)))):raw;
 }
 async function content(hash,extension='.bin'){
  if(!isHash(hash)||!/^\.[a-z0-9]+$/.test(extension))throw Error('Invalid prepared reference');
  const key=hash+extension;if(pending.has(key))return pending.get(key);
  const task=(async()=>{
   const row=dependencies.blobs[hash],entry=row?.entry;if(!entry)throw Error('Undeclared prepared dependency '+hash);
   const file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',hash);
   let bytes=await fs.readFile(await resolveFile(file));if(bytes.length!==row.bytes||digest(bytes)!==hash)throw Error('Prepared integrity failure '+hash);
   const encoding=entry.codec.includes('brotli')?'br':undefined;
   if(['.json','.gltf','.cubemap'].includes(extension)){
    const raw=encoding?brotliDecompressSync(bytes):bytes,assetDocument=['.cubemap','.gltf'].includes(extension),parent=assetDocument?row.ids?.find(id=>id.endsWith(extension)):undefined;
    const updated=assetDocument?Buffer.from(JSON.stringify(await rewrite(JSON.parse(raw),true,parent))):await rewriteUrlText(raw);
    // Keep original compressed bytes whenever rewriting is unnecessary.
    if(!updated.equals(raw))bytes=encoding?brotliCompressSync(updated,{params:{[constants.BROTLI_PARAM_QUALITY]:6}}):updated;
   }
   return store(bytes,extension,encoding);
  })();pending.set(key,task);return task;
 }
 async function recipe(ref){
  const row=recipes.content[ref.blob];if(!row)throw Error('Undeclared geometry recipe');
  let bytes=await fs.readFile(await resolveFile(path.resolve(viewer,row.file)));if(bytes.length!==row.bytes||digest(bytes)!==ref.blob)throw Error('Recipe integrity failure');
  if(row.json){const raw=brotliDecompressSync(bytes),updated=await rewriteUrlText(raw);if(!updated.equals(raw))bytes=brotliCompressSync(updated,{params:{[constants.BROTLI_PARAM_QUALITY]:6}});}
  return store(bytes,row.json?'.json':'.bin','br');
 }
 for(const id of ids){
  if(!/^[a-z0-9]+$/.test(id))throw Error('Invalid region');
  const manifest=JSON.parse(await fs.readFile(path.join(viewer,'dependency-bundles/regions',id+'.json'),'utf8'));
  const recipeIndex=JSON.parse(await fs.readFile(path.join(viewer,'recipe-rollout/regions',id+'.json'),'utf8'));
  const selected=new Map(),out={version:1,format:index.format,region:id,resources:{},recipes:structuredClone(recipeIndex)};
  const overrides=new Map(),rootModels=new Set();let catalogAssets=[],reuse;
  const loadDocument=async logical=>{const entry=manifest.resources[logical];if(!entry?.blob)return null;const row=dependencies.blobs[entry.blob];if(!row)throw Error('Missing prepared metadata');const file=row.entry.dependencyFile?path.resolve(viewer,row.entry.dependencyFile):path.join(root,'blobs',entry.blob),bytes=await fs.readFile(await resolveFile(file));if(bytes.length!==row.bytes||digest(bytes)!==entry.blob)throw Error('Prepared metadata integrity failure');return JSON.parse((entry.codec.includes('brotli')?brotliDecompressSync(bytes):bytes).toString());};
  if(manifest.resources[id+'/world.json']){
   const cleaned=removeEmptyFoliagePlacements(await loadDocument(id+'/world.json'));
   if(cleaned.removed)overrides.set(id+'/world.json',Buffer.from(JSON.stringify(cleaned.world)));
   if(catalog)reuse=prepareCatalogWorld(cleaned.world,catalog);
   if(reuse?.placements.length){
    overrides.set(id+'/world.json',Buffer.from(JSON.stringify(reuse.world)));catalogAssets=reuse.assets;
    for(const name of ['lod-manifest.json','night-materials.json']){const doc=await loadDocument(id+'/'+name);if(doc?.assets){doc.assets=Object.fromEntries(Object.entries(doc.assets).filter(([file])=>reuse.remainingFiles.has(file)));overrides.set(id+'/'+name,Buffer.from(JSON.stringify(doc)));for(const row of Object.values(doc.assets)){if(row.file)rootModels.add(row.file);for(const level of row.levels||[])rootModels.add(level.file);}}}
    for(const file of reuse.remainingFiles)rootModels.add(file);
   }
  }
  const resolveLogical=file=>manifest.resources[file]?file:id+'/'+file;
  const modelRoots=new Set([...rootModels].map(resolveLogical));
  const modelDependency=logical=>/(?:^|\/)(?:ready|night-ready|native-lods)\//.test(logical)||logical.startsWith('world-textures/');
  const virtual=new Map(Object.entries(manifest.resources).filter(([logical,entry])=>entry.blob&&(logical.endsWith('/terrain-lod1.glb')||logical.endsWith('/roads/render-vertices.bin.gz')||logical.endsWith('/world-fixes/details/vertices.bin.gz'))).map(([logical,entry])=>[entry.blob,logical]));
  for(const [logical,entry]of Object.entries(manifest.resources)){
   if(reuse?.placements.length&&modelDependency(logical)&&!modelRoots.has(logical))continue;
   const result={...entry};delete result.sourceHash;delete result.dependencyFile;
   const reconstructed=virtual.has(entry.blob);if(reconstructed)result.recipeOf=virtual.get(entry.blob);
   if(entry.blob&&!reconstructed){const override=overrides.get(logical);const ref=override?await store(brotliCompressSync(await rewriteUrlText(override),{params:{[constants.BROTLI_PARAM_QUALITY]:6}}),path.extname(logical),'br'):await content(entry.blob,path.extname(logical));result.resource=ref;selected.set(ref.path,ref);}
   if(entry.slices)result.slices=await Promise.all(entry.slices.map(async slice=>{const ref=await content(slice.blob,'.png');selected.set(ref.path,ref);return {...slice,resource:ref};}));
   out.resources[logical]=result;
  }
  for(const group of ['roads','decals'])for(const [key,part]of Object.entries(out.recipes[group]?.parts||{})){const ref=await recipe(part);selected.set(ref.path,ref);out.recipes[group].parts[key]=ref;}
  // Include dependencies rewritten inside glTF/cubemap/recipe JSON in this region's declared closure.
  const visit=async ref=>{if(ref.visited)return;ref.visited=true;if(!/\.(json|gltf|cubemap)$/.test(ref.path))return;const bytes=await fs.readFile(path.join(target,ref.path));const raw=ref.encoding?brotliDecompressSync(bytes):bytes;const text=raw.toString();for(const match of text.matchAll(/(?:\.\.\/\.\.\/|content\/)(br|raw)\/([a-f0-9]{64})\/asset(\.[a-z0-9]+)/g)){const file=`content/${match[1]}/${match[2]}/asset${match[3]}`,child=resources.get(file);if(!child)throw Error('Missing rewritten dependency');selected.set(file,child);await visit(child);}};
  // Per-region traversal state must not leak between regions sharing the same parent.
  for(const ref of resources.values())delete ref.visited;
  for(const ref of [...selected.values()])await visit(ref);
  for(const ref of resources.values())delete ref.visited;
  out.physicalResources=[...selected.values()];
  if(catalogAssets.length){out.catalogResources=catalogReferences(catalog,catalogAssets);out.catalogReuse={actors:reuse.placements.length,modelFiles:reuse.replacedFiles.size};}

  const metadata=await store(brotliCompressSync(Buffer.from(JSON.stringify(out)),{params:{[constants.BROTLI_PARAM_QUALITY]:6}}),'.json','br');
  selected.set(metadata.path,metadata);
  index.regions[id]={id,manifest:metadata,downloadBytes:[...selected.values()].reduce((n,r)=>n+r.bytes,0),...(out.catalogResources?{catalogBytes:out.catalogResources.reduce((n,r)=>n+(r.bytes||0),0)}:{})};
  onProgress({region:id,downloadBytes:index.regions[id].downloadBytes});
 }
 await fs.mkdir(target,{recursive:true});const temp=path.join(target,`index.${process.pid}.tmp`);await fs.writeFile(temp,JSON.stringify(index));await fs.rename(temp,path.join(target,'index.json'));
 return {regions:ids.length,resources:resources.size,bytes:[...resources.values()].reduce((n,r)=>n+r.bytes,0),index};
}
