import {removeEmptyFoliagePlacements} from './authoring/empty-foliage-placements.mjs';
import {catalogReferences} from './catalog-references.mjs';
import {prepareCatalogWorld} from './authoring/catalog-world-policy.mjs';
import {generateTerrainSliceTiers,generateTerrainSource} from './authoring/terrain-slice-tier.mjs';
import {reduceDetailTexture} from './authoring/detail-texture-reduction.mjs';
import {validateWeatherTexturePair} from './authoring/weather-texture-reduction.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const isHash=value=>/^[a-f0-9]{64}$/.test(value);
/** Publish verified compact dependencies with bounded terrain sources and optional exact tiers. */
export async function publishCompactWorld({input,target,regions,catalog,terrainTiers=true,terrainSourceMaxSize=512,terrainColorQuality=75,terrainNormalQuality=85,detailTextureMaxSize=512,detailColorQuality=75,detailNormalQuality=85,detailOrmQuality=85,transportTextureMaxSize=512,transportColorQuality=75,transportNormalQuality=85,transportOrmQuality=85,transportOrmQuantizationStep=16,worldNormalMaxSize=512,worldNormalQuality=65,worldColorMaxSize=512,worldColorCutoutMaxSize=1024,worldColorQuality=65,weatherTextureMaxSize=512,weatherColorQuality=65,weatherNormalQuality=65,weatherDataQuantizationStep=4,waterTextureMaxSize=512,waterNormalQuality=65,waterDataQuantizationStep=8,waterWaveQuantizationStep=8,onProgress=()=>{}}){
 if(waterTextureMaxSize!==null&&(!Number.isInteger(waterTextureMaxSize)||waterTextureMaxSize<128||waterTextureMaxSize>4096||(waterTextureMaxSize&(waterTextureMaxSize-1))!==0))throw Error('Invalid water texture cap');
 if(!Number.isInteger(waterNormalQuality)||waterNormalQuality<1||waterNormalQuality>100)throw Error('Invalid water normal quality');
 if(waterWaveQuantizationStep!==null&&(!Number.isInteger(waterWaveQuantizationStep)||waterWaveQuantizationStep<1||waterWaveQuantizationStep>255))throw Error('Invalid water wave quantization step');
 if(!Number.isInteger(waterDataQuantizationStep)||waterDataQuantizationStep<1||waterDataQuantizationStep>255)throw Error('Invalid water data quantization step');
 if(weatherTextureMaxSize!==null&&(!Number.isInteger(weatherTextureMaxSize)||weatherTextureMaxSize<128||weatherTextureMaxSize>4096||(weatherTextureMaxSize&(weatherTextureMaxSize-1))!==0))throw Error('Invalid weather texture cap');
 if(![weatherColorQuality,weatherNormalQuality].every(q=>Number.isInteger(q)&&q>=1&&q<=100))throw Error('Invalid weather texture quality');
 if(!Number.isInteger(weatherDataQuantizationStep)||weatherDataQuantizationStep<1||weatherDataQuantizationStep>255)throw Error('Invalid weather data quantization step');
 if(worldColorMaxSize!==null&&(!Number.isInteger(worldColorMaxSize)||worldColorMaxSize<128||worldColorMaxSize>4096||(worldColorMaxSize&(worldColorMaxSize-1))!==0))throw Error('Invalid world color texture cap');
 if(!Number.isInteger(worldColorCutoutMaxSize)||worldColorCutoutMaxSize<128||worldColorCutoutMaxSize>4096||(worldColorCutoutMaxSize&(worldColorCutoutMaxSize-1))!==0)throw Error('Invalid world cutout texture cap');
 if(!Number.isInteger(worldColorQuality)||worldColorQuality<1||worldColorQuality>100)throw Error('Invalid world color texture quality');
 if(worldNormalMaxSize!==null&&(!Number.isInteger(worldNormalMaxSize)||worldNormalMaxSize<128||worldNormalMaxSize>4096||(worldNormalMaxSize&(worldNormalMaxSize-1))!==0))throw Error('Invalid world normal texture cap');
 if(!Number.isInteger(worldNormalQuality)||worldNormalQuality<1||worldNormalQuality>100)throw Error('Invalid world normal texture quality');
 if(terrainSourceMaxSize!==null&&(!Number.isInteger(terrainSourceMaxSize)||terrainSourceMaxSize<128||terrainSourceMaxSize>4096||(terrainSourceMaxSize&(terrainSourceMaxSize-1))!==0))throw Error('Invalid terrain source size cap');
 if(![terrainColorQuality,terrainNormalQuality].every(q=>Number.isInteger(q)&&q>=1&&q<=100))throw Error('Invalid terrain source quality');
 if(detailTextureMaxSize!==null&&(!Number.isInteger(detailTextureMaxSize)||detailTextureMaxSize<128||detailTextureMaxSize>4096||(detailTextureMaxSize&(detailTextureMaxSize-1))!==0))throw Error('Invalid detail texture cap');
 if(transportTextureMaxSize!==null&&(!Number.isInteger(transportTextureMaxSize)||transportTextureMaxSize<128||transportTextureMaxSize>4096||(transportTextureMaxSize&(transportTextureMaxSize-1))!==0))throw Error('Invalid transport texture cap');
 if(![transportColorQuality,transportNormalQuality,transportOrmQuality].every(q=>Number.isInteger(q)&&q>=1&&q<=100))throw Error('Invalid transport texture quality');
 if(transportOrmQuantizationStep!==null&&(!Number.isInteger(transportOrmQuantizationStep)||transportOrmQuantizationStep<1||transportOrmQuantizationStep>255))throw Error('Invalid transport ORM quantization step');
 if(![detailColorQuality,detailNormalQuality,detailOrmQuality].every(q=>Number.isInteger(q)&&q>=1&&q<=100))throw Error('Invalid detail texture quality');
 const root=await fs.realpath(input),viewer=path.join(root,'viewer');
 const dependencies=JSON.parse(await fs.readFile(path.join(viewer,'dependency-bundles/manifest.json'),'utf8'));
 const recipes=JSON.parse(await fs.readFile(path.join(viewer,'recipe-rollout/manifest.json'),'utf8'));
 const ids=regions?.length?regions:(await fs.readdir(path.join(viewer,'dependency-bundles/regions'))).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5));
 const pending=new Map(),terrainVariants=new Map(),terrainSources=new Map(),detailSources=new Map(),transportSources=new Map(),resources=new Map(),index={version:1,format:'compact-recipes-v1',regions:{}};
 const logicalRefs=new Map();for(const [blob,row]of Object.entries(dependencies.blobs))for(const id of row.ids||[])logicalRefs.set(id,{...row.entry,blob});
 target=path.resolve(target);
 if(catalog===undefined){try{catalog=JSON.parse(await fs.readFile(path.resolve(target,'../models/manifest.v1.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;catalog=null;}}
 if(regions?.length){try{const previous=JSON.parse(await fs.readFile(path.join(target,'index.json'),'utf8'));if(previous.version===index.version&&previous.format===index.format)Object.assign(index.regions,previous.regions);}catch(error){if(error.code!=='ENOENT')throw error;}}
 const worldColorSources=new Map(),worldColorCutouts=new Set(),worldNormalSources=new Map(),worldNormalUses=new Map(),worldNormalDocuments=new Map(),weatherSources=new Map(),weatherPairs=new Map(),waterSources=new Map();
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
 // Classify by glTF material references, never by normal-looking names. The
 // global pass makes a shared color/normal source ineligible for replacement.
 function imageBlob(uri,parent){
  if(typeof uri!=='string'||uri.startsWith('data:'))return null;
  const match=uri.match(/^\/(?:__asset_ab\/content\/B\/([a-f0-9]{64})\/[a-f0-9]{64}\/asset\.[a-z0-9]+|__delivery_blob\/([a-f0-9]{64})\/asset\.[a-z0-9]+)$/);
  if(match)return match[1]||match[2];
  return parent?logicalRefs.get(path.posix.normalize(path.posix.join(path.posix.dirname(parent),uri)))?.blob:null;
 }
 async function classifyWorldNormals(){
  if(worldNormalMaxSize===null&&worldColorMaxSize===null)return;
  for(const [hash,row] of Object.entries(dependencies.blobs)){
   const parents=(row.ids||[]).filter(id=>id.endsWith('.gltf'));if(!parents.length)continue;
   const entry=row.entry,file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',hash),bytes=await fs.readFile(await resolveFile(file));
   if(bytes.length!==row.bytes||digest(bytes)!==hash)throw Error('World model integrity failure '+hash);
   const doc=JSON.parse((entry.codec.includes('brotli')?brotliDecompressSync(bytes):bytes).toString()),normal=new Set(),color=new Set(),other=new Set(),cutout=new Set();
   // Only core glTF base color and normal roles are eligible. Unknown extension
   // and material texture uses protect the shared source from replacement.
   const scan=(v,key,location)=>{if(!v||typeof v!=='object')return;if(key?.endsWith('Texture')&&Number.isInteger(v.index))(location==='normalTexture'?normal:location==='pbrMetallicRoughness.baseColorTexture'?color:other).add(v.index);for(const [k,x]of Object.entries(v))scan(x,k,location+'.'+k);};
   for(const material of doc.materials||[]){for(const [key,value]of Object.entries(material))scan(value,key,key);const colorIndex=material?.pbrMetallicRoughness?.baseColorTexture?.index;if(Number.isInteger(colorIndex)&&material?.alphaMode&&material.alphaMode!=='OPAQUE')cutout.add(colorIndex);}
   const rows=[];
   const record=(hash,role)=>{if(!hash||!dependencies.blobs[hash]?.ids?.some(id=>id.startsWith('world-textures/')))return;if(!worldNormalUses.has(hash))worldNormalUses.set(hash,new Set());worldNormalUses.get(hash).add(role);};
   const hashesForImage=index=>{const uri=doc.images?.[index]?.uri;return uri?parents.map(parent=>imageBlob(uri,parent)):[];};
   for(let i=0;i<(doc.textures||[]).length;i++){
    const texture=doc.textures[i];
    // Texture extensions may supply their own image sources (for example
    // KHR_texture_basisu). Protect those from a different document's rewrite.
    const scanSources=v=>{if(!v||typeof v!=='object')return;if(Number.isInteger(v.source))for(const h of hashesForImage(v.source))record(h,'other');for(const x of Object.values(v))scanSources(x);};
    scanSources(texture.extensions);
    if(!Number.isInteger(texture.source))continue;
    const hashes=hashesForImage(texture.source);if(!hashes.length)continue;
    // An identical document can be mounted beneath different parent paths.
    // Ambiguous relative URIs must protect every possible source, not only the
    // first parent, from optimization as a supposedly exclusive material role.
    if(!hashes[0]||hashes.some(h=>h!==hashes[0])){for(const h of hashes)record(h,'other');continue;}
    const source=hashes[0],sourceRow=dependencies.blobs[source];if(!sourceRow?.ids?.some(id=>id.startsWith('world-textures/')))continue;
    const role=!texture.extensions&&!other.has(i)&&normal.has(i)&&!color.has(i)?'normal':!texture.extensions&&!other.has(i)&&color.has(i)&&!normal.has(i)?'color':'other';
    record(source,role);
    if(color.has(i)&&cutout.has(i))worldColorCutouts.add(source);
    if(role==='normal'||role==='color')rows.push({index:texture.source,source,role});
   }
   worldNormalDocuments.set(hash,rows);
  }
 }
 async function worldNormalSourceFor(source){
  if(worldNormalSources.has(source))return worldNormalSources.get(source);
  const task=(async()=>{const row=dependencies.blobs[source],entry=row?.entry;if(!entry)throw Error('Undeclared world normal '+source);
   const file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',source),bytes=await fs.readFile(await resolveFile(file));
   if(bytes.length!==row.bytes||digest(bytes)!==source)throw Error('World normal integrity failure '+source);
   const reduced=await reduceDetailTexture(bytes,{role:'normal',maxSize:worldNormalMaxSize,quality:worldNormalQuality}),ref=await store(reduced.bytes,reduced.extension);
   return {ref,width:reduced.width,height:reduced.height,unchanged:reduced.unchanged,codec:reduced.extension==='.png'?'rgba-lossless-image':'webp'+worldNormalQuality};
  })();worldNormalSources.set(source,task);return task;
 }
 async function worldColorSourceFor(source){
  if(worldColorSources.has(source))return worldColorSources.get(source);
  const task=(async()=>{const row=dependencies.blobs[source],entry=row?.entry;if(!entry)throw Error('Undeclared world color '+source);
   const file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',source),bytes=await fs.readFile(await resolveFile(file));
   if(bytes.length!==row.bytes||digest(bytes)!==source)throw Error('World color integrity failure '+source);
   const maxSize=worldColorCutouts.has(source)?Math.max(worldColorMaxSize,worldColorCutoutMaxSize):worldColorMaxSize;
   const reduced=await reduceDetailTexture(bytes,{role:'color',maxSize,quality:worldColorQuality}),ref=await store(reduced.bytes,reduced.extension);
   return {ref,width:reduced.width,height:reduced.height,unchanged:reduced.unchanged,codec:reduced.extension==='.png'?'rgba-lossless-image':'webp'+worldColorQuality};
  })();worldColorSources.set(source,task);return task;
 }
 const eligibleWorldNormal=hash=>worldNormalMaxSize!==null&&worldNormalUses.get(hash)?.size===1&&worldNormalUses.get(hash)?.has('normal');
 const eligibleWorldColor=hash=>worldColorMaxSize!==null&&worldNormalUses.get(hash)?.size===1&&worldNormalUses.get(hash)?.has('color');
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
    let updated;
    if(assetDocument){const original=JSON.parse(raw),normalUrls=new Map();
     if(extension==='.gltf')for(const {index,source,role}of worldNormalDocuments.get(hash)||[])if(role==='normal'?eligibleWorldNormal(source):eligibleWorldColor(source)){
      const reduced=role==='normal'?await worldNormalSourceFor(source):await worldColorSourceFor(source);normalUrls.set(index,'../../'+reduced.ref.path.slice('content/'.length));
      // Keep the generic rewriter from unnecessarily storing the full-size
      // original before we replace the image URL.
      original.images[index].uri='__world_normal_'+index;
      if(original.images[index].mimeType)original.images[index].mimeType=reduced.ref.path.endsWith('.webp')?'image/webp':'image/png';
     }
     const document=await rewrite(original,true,parent);for(const [index,url]of normalUrls)document.images[index].uri=url;
     updated=Buffer.from(JSON.stringify(document));
    }else updated=await rewriteUrlText(raw);
    // Keep original compressed bytes whenever rewriting is unnecessary.
    if(!updated.equals(raw))bytes=encoding?brotliCompressSync(updated,{params:{[constants.BROTLI_PARAM_QUALITY]:6}}):updated;
   }
   return store(bytes,extension,encoding);
  })();pending.set(key,task);return task;
 }
 // Each source is decoded once; shared slices reuse all generated tiers.
 async function terrainTiersFor(slice,kind,size,ref){
  const key=[slice.blob,kind,size,slice.pixelHash||''].join(':');if(terrainVariants.has(key))return terrainVariants.get(key);
  const task=(async()=>{
   const original=await fs.readFile(path.join(target,ref.path)),targets=[128,256,512].filter(value=>value<size);
   const generated=await generateTerrainSliceTiers(original,{kind,size,sourceHash:slice.blob,pixelHash:slice.pixelHash,targets}),tiers={};
   for(const tier of generated){
    // Keep the established 128px preview even when an exceptionally small
    // source beats it; larger variants are only useful when they save bytes.
    if(tier.width!==128&&tier.bytes.length>=original.length)continue;
    const resource=await store(tier.bytes,tier.extension);
    tiers[tier.width]={width:tier.width,height:tier.height,pixelHash:tier.pixelHash,resource};
   }
   return tiers;
  })();terrainVariants.set(key,task);return task;
 }
 async function terrainSourceFor(slice,kind,size){
  const quality=kind==='normal'?terrainNormalQuality:terrainColorQuality,key=[slice.blob,kind,size,slice.pixelHash||'',terrainSourceMaxSize,quality].join(':');if(terrainSources.has(key))return terrainSources.get(key);
  const task=(async()=>{
   const row=dependencies.blobs[slice.blob],entry=row?.entry;if(!row||!entry)throw Error('Undeclared terrain source '+slice.blob);
   const file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',slice.blob);
   const bytes=await fs.readFile(await resolveFile(file));if(bytes.length!==row.bytes||digest(bytes)!==slice.blob)throw Error('Terrain source integrity failure');
   const reduced=await generateTerrainSource(bytes,{kind,size,sourceHash:slice.blob,pixelHash:slice.pixelHash,target:Math.min(size,terrainSourceMaxSize),quality});
   const ref=await store(reduced.bytes,reduced.extension);
   return {ref,pixelHash:reduced.pixelHash,opaque:reduced.opaque,extension:reduced.extension};
  })();terrainSources.set(key,task);return task;
 }
 async function detailSourceFor(source,role){
  const quality=role==='normal'?detailNormalQuality:role==='orm'?detailOrmQuality:detailColorQuality,key=[source.blob,role,detailTextureMaxSize,quality].join(':');if(detailSources.has(key))return detailSources.get(key);
  const task=(async()=>{const row=dependencies.blobs[source.blob],entry=row?.entry;if(!entry)throw Error('Undeclared detail source '+source.blob);
   const file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',source.blob),bytes=await fs.readFile(await resolveFile(file));
   if(bytes.length!==row.bytes||digest(bytes)!==source.blob)throw Error('Detail source integrity failure');
   const reduced=await reduceDetailTexture(bytes,{role,maxSize:detailTextureMaxSize,quality}),ref=await store(reduced.bytes,reduced.extension);
   return {ref,width:reduced.width,height:reduced.height,unchanged:reduced.unchanged,codec:reduced.extension==='.png'?'rgba-lossless-image':'webp'+quality};
  })();detailSources.set(key,task);return task;
 }
 async function transportSourceFor(source,role,rail){
  const quality=role==='normal'?transportNormalQuality:role==='orm'?transportOrmQuality:transportColorQuality,quantization=role==='orm'&&rail?transportOrmQuantizationStep:null,key=[source.blob,role,transportTextureMaxSize,quality,quantization].join(':');if(transportSources.has(key))return transportSources.get(key);
  const task=(async()=>{const row=dependencies.blobs[source.blob],entry=row?.entry;if(!entry)throw Error('Undeclared transport source '+source.blob);
   const file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',source.blob),bytes=await fs.readFile(await resolveFile(file));
   if(bytes.length!==row.bytes||digest(bytes)!==source.blob)throw Error('Transport source integrity failure');
   const reduced=await reduceDetailTexture(bytes,{role,maxSize:transportTextureMaxSize,quality,ormQuantizationStep:quantization}),ref=await store(reduced.bytes,reduced.extension);
   return {ref,width:reduced.width,height:reduced.height,unchanged:reduced.unchanged,codec:reduced.quantized?'rgba-quantized-image':reduced.extension==='.png'?'rgba-lossless-image':'webp'+quality};
  })();transportSources.set(key,task);return task;
 }
 // Weather inputs have distinct sampling semantics. Snow and its roughness mask
 // are a coupled pair at runtime, while noise and normal are independent.
 async function weatherBytes(source){
  const row=dependencies.blobs[source.blob],entry=row?.entry;if(!entry)throw Error('Undeclared weather source '+source.blob);
  const file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',source.blob),bytes=await fs.readFile(await resolveFile(file));
  if(bytes.length!==row.bytes||digest(bytes)!==source.blob)throw Error('Weather source integrity failure '+source.blob);
  return bytes;
 }
 async function validateWeatherPair(snow,mask){
  const key=snow.blob+':'+mask.blob;if(!weatherPairs.has(key))weatherPairs.set(key,(async()=>validateWeatherTexturePair(await weatherBytes(snow),await weatherBytes(mask)))());
  return weatherPairs.get(key);
 }
 async function weatherSourceFor(source,role){
  const quality=role==='normal'?weatherNormalQuality:weatherColorQuality,quantization=role==='data'?weatherDataQuantizationStep:null,key=[source.blob,role,weatherTextureMaxSize,quality,quantization].join(':');if(weatherSources.has(key))return weatherSources.get(key);
  const task=(async()=>{const bytes=await weatherBytes(source),reduced=await reduceDetailTexture(bytes,{role:role==='data'?'orm':role,maxSize:weatherTextureMaxSize,quality,ormQuantizationStep:quantization}),ref=await store(reduced.bytes,reduced.extension);
   return {ref,width:reduced.width,height:reduced.height,unchanged:reduced.unchanged,codec:reduced.quantized?'rgba-quantized-image':reduced.extension==='.png'?'rgba-lossless-image':'webp'+quality};
  })();weatherSources.set(key,task);return task;
 }
 // Water shaders sample wave RG and independent linear foam/modulation/cloud
 // channels. Preserve alpha, and do not touch the encoded bed height.
 async function waterSourceFor(source,role){
  const quantization=role==='data'?waterDataQuantizationStep:waterWaveQuantizationStep,key=[source.blob,role,waterTextureMaxSize,waterNormalQuality,quantization].join(':');if(waterSources.has(key))return waterSources.get(key);
  const task=(async()=>{const row=dependencies.blobs[source.blob],entry=row?.entry;if(!entry)throw Error('Undeclared water source '+source.blob);
   const file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',source.blob),bytes=await fs.readFile(await resolveFile(file));
   if(bytes.length!==row.bytes||digest(bytes)!==source.blob)throw Error('Water source integrity failure '+source.blob);
   const reduced=await reduceDetailTexture(bytes,{role:quantization!==null?'orm':'normal',maxSize:waterTextureMaxSize,quality:waterNormalQuality,ormQuantizationStep:quantization}),ref=await store(reduced.bytes,reduced.extension);
   return {ref,width:reduced.width,height:reduced.height,unchanged:reduced.unchanged,codec:reduced.quantized?'rgba-quantized-image':reduced.extension==='.png'?'rgba-lossless-image':'webp'+waterNormalQuality};
  })();waterSources.set(key,task);return task;
 }
 async function recipe(ref){
  const row=recipes.content[ref.blob];if(!row)throw Error('Undeclared geometry recipe');
  let bytes=await fs.readFile(await resolveFile(path.resolve(viewer,row.file)));if(bytes.length!==row.bytes||digest(bytes)!==ref.blob)throw Error('Recipe integrity failure');
  if(row.json){const raw=brotliDecompressSync(bytes),updated=await rewriteUrlText(raw);if(!updated.equals(raw))bytes=brotliCompressSync(updated,{params:{[constants.BROTLI_PARAM_QUALITY]:6}});}
  return store(bytes,row.json?'.json':'.bin','br');
 }
 await classifyWorldNormals();
 for(const id of ids){
  if(!/^[a-z0-9]+$/.test(id))throw Error('Invalid region');
  const manifest=JSON.parse(await fs.readFile(path.join(viewer,'dependency-bundles/regions',id+'.json'),'utf8'));
  const recipeIndex=JSON.parse(await fs.readFile(path.join(viewer,'recipe-rollout/regions',id+'.json'),'utf8'));
  const selected=new Map(),out={version:1,format:index.format,region:id,resources:{},recipes:structuredClone(recipeIndex)};
  const overrides=new Map(),rootModels=new Set();let catalogAssets=[],reuse;
  const loadDocument=async logical=>{const entry=manifest.resources[logical];if(!entry?.blob)return null;const row=dependencies.blobs[entry.blob];if(!row)throw Error('Missing prepared metadata');const file=row.entry.dependencyFile?path.resolve(viewer,row.entry.dependencyFile):path.join(root,'blobs',entry.blob),bytes=await fs.readFile(await resolveFile(file));if(bytes.length!==row.bytes||digest(bytes)!==entry.blob)throw Error('Prepared metadata integrity failure');return JSON.parse((entry.codec.includes('brotli')?brotliDecompressSync(bytes):bytes).toString());};
  // The runtime loads these exact region-local paths and packs snow and mask.
  const weatherRoles=new Map();
  if(weatherTextureMaxSize!==null){
   const prefix=id+'/terrain-live/weather/',snow=manifest.resources[prefix+'snow.png'],mask=manifest.resources[prefix+'mask.png'];
   if(!!snow?.blob!==!!mask?.blob)throw Error('Incomplete weather snow/mask pair '+id);
   if(snow?.blob)await validateWeatherPair(snow,mask);
   for(const [name,role]of [['snow','color'],['normal','normal'],['mask','data'],['noise','data']])if(manifest.resources[prefix+name+'.png']?.blob)weatherRoles.set(prefix+name+'.png',role);
  }
  // Only the water graph paths used by the current material are eligible.
  // Other logical users and indirect hash references retain their originals.
  const waterRoles=new Map();
  if(waterTextureMaxSize!==null){
   const water=await loadDocument(id+'/water-source/render.json');
   for(const [field,role]of [['waveLarge','normal'],['waveSmall','normal'],['foam','data'],['modulation','data'],['clouds','data']]){
    const logical=water?.textures?.[field];if(typeof logical!=='string'||!logical.startsWith('water-graph/')||path.posix.normalize(logical)!==logical)continue;
    if(!manifest.resources[logical]?.blob)throw Error('Missing water texture '+logical);
    const previous=waterRoles.get(logical);if(previous&&previous!==role)throw Error('Conflicting water texture roles '+logical);waterRoles.set(logical,role);
   }
  }
  // Derive roles from actual material usage, never from a hash or filename.
  const detailRoles=new Map();
  if(detailTextureMaxSize!==null){const materials=await loadDocument(id+'/world-fixes/details/materials.json');
   for(const m of Object.values(materials||{}))for(const [field,role] of [['file','color'],['normalFile','normal'],['ormFile','orm']]){
    const rel=m?.[field];if(typeof rel!=='string')continue;
    const logical=path.posix.normalize(id+'/world-fixes/details/'+rel);if(!logical.startsWith(id+'/world-fixes/details/textures/'))continue;
    const previous=detailRoles.get(logical);if(previous&&previous!==role)throw Error('Conflicting detail texture roles '+logical);detailRoles.set(logical,role);
   }
  }
  // Road surfaces and transitions share materials in their active region;
  // rail materials may instead refer to another region. Only the verified
  // TownRailDecal material is included; other decals keep their existing
  // world-detail handling.
  const transportRoles=new Map();
  if(transportTextureMaxSize!==null){
   const roads=await loadDocument(id+'/roads/render.json'),rails=await loadDocument(id+'/world-fixes/rails/render.json');
   for(const [materials,rail]of [[roads?.materials||{},false],[rails?.materials||{},true]])for(const material of Object.values(materials))for(const [field,role]of (rail?[['file','color'],['normalFile','normal'],['ormFile','orm']]:[['file','color'],['normalFile','normal']])){
    const rel=material?.[field],region=rail?(material?.region||id):id;if(typeof rel!=='string'||!/^[a-z0-9]+$/.test(region))continue;
    const logical=path.posix.normalize(region+'/'+rel);if(!logical.startsWith(region+'/')||!manifest.resources[logical]?.blob)continue;
    const previous=transportRoles.get(logical),previousRole=previous?.role||detailRoles.get(logical);if(previousRole&&previousRole!==role)throw Error('Conflicting transport texture roles '+logical);transportRoles.set(logical,{role,rail:rail||!!previous?.rail});
   }
   const decals=await loadDocument(id+'/roads/decals.json'),restored=await loadDocument(id+'/world-fixes/decals.json'),fixes=await loadDocument('deadlands/world-fixes/road-materials.json');
   const key='War/Content/Materials/Decals/TownRailDecal.TownRailDecal',candidate=restored?.materials?.[key]||decals?.materials?.[key],decal=candidate?(fixes?.[key]||candidate):null;
   if((decal?.region||id)==='deadlands'&&decal?.file==='world-fixes/decals/TownRailDecal-uv90-alpha-g.png')for(const [field,role,expected]of [['file','color','world-fixes/decals/TownRailDecal-uv90-alpha-g.png'],['normalFile','normal','world-fixes/decals/TownRailDecal-uv90-alpha-g-normal.png'],['ormFile','orm','world-fixes/decals/TownRailDecal-uv90-alpha-g-orm.png']]){
    if(decal[field]!==expected)continue;const logical='deadlands/'+expected;if(!manifest.resources[logical]?.blob)continue;
    const previous=transportRoles.get(logical),previousRole=previous?.role||detailRoles.get(logical);if(previousRole&&previousRole!==role)throw Error('Conflicting transport texture roles '+logical);transportRoles.set(logical,{role,rail:true});
   }
  }
  const terrainEntries=Object.entries(manifest.resources).filter(([logical,entry])=>new RegExp('^'+id+'/terrain-live/(albedo|normal)-[0-9]+\\.bin\\.gz$').test(logical)&&entry.size>terrainSourceMaxSize);
  if(terrainSourceMaxSize!==null&&terrainEntries.length){
   const material=await loadDocument(id+'/terrain-live/material.json');if(!Array.isArray(material?.buckets))throw Error('Missing terrain material metadata for source reduction');
   for(const [logical,entry] of terrainEntries){const match=logical.match(/(albedo|normal)-(\d+)\.bin\.gz$/),bucket=material.buckets[Number(match[2])];
    if(!bucket||bucket.size!==entry.size||bucket.count!==entry.slices?.length)throw Error('Terrain source does not match material bucket '+logical);
    const other=manifest.resources[id+'/terrain-live/'+(match[1]==='albedo'?'normal':'albedo')+'-'+match[2]+'.bin.gz'];
    if(!other||other.size!==entry.size||other.slices?.length!==entry.slices.length)throw Error('Terrain source pair does not match '+logical);
   }
   for(const bucket of material.buckets)bucket.size=Math.min(bucket.size,terrainSourceMaxSize);if(Number.isFinite(material.size))material.size=Math.min(material.size,terrainSourceMaxSize);
   overrides.set(id+'/terrain-live/material.json',Buffer.from(JSON.stringify(material)));
  }
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
   if(entry.blob&&!reconstructed){const override=overrides.get(logical),role=detailRoles.get(logical),transportRole=transportRoles.get(logical),weatherRole=weatherRoles.get(logical),waterRole=waterRoles.get(logical);let ref;
    if(override)ref=await store(brotliCompressSync(await rewriteUrlText(override),{params:{[constants.BROTLI_PARAM_QUALITY]:6}}),path.extname(logical),'br');
    else if(logical.startsWith('world-textures/')&&eligibleWorldNormal(entry.blob)){const reduced=await worldNormalSourceFor(entry.blob);ref=reduced.ref;result.blob=ref.hash;result.bytes=ref.bytes;result.width=reduced.width;result.height=reduced.height;if(!reduced.unchanged)result.codec=reduced.codec;}
    else if(logical.startsWith('world-textures/')&&eligibleWorldColor(entry.blob)){const reduced=await worldColorSourceFor(entry.blob);ref=reduced.ref;result.blob=ref.hash;result.bytes=ref.bytes;result.width=reduced.width;result.height=reduced.height;if(!reduced.unchanged)result.codec=reduced.codec;}
    else if(weatherRole){const reduced=await weatherSourceFor(entry,weatherRole);ref=reduced.ref;result.blob=ref.hash;result.bytes=ref.bytes;result.width=reduced.width;result.height=reduced.height;if(!reduced.unchanged)result.codec=reduced.codec;}
    else if(waterRole){const reduced=await waterSourceFor(entry,waterRole);ref=reduced.ref;result.blob=ref.hash;result.bytes=ref.bytes;result.width=reduced.width;result.height=reduced.height;if(!reduced.unchanged)result.codec=reduced.codec;}
    else if(role){const reduced=await detailSourceFor(entry,role);ref=reduced.ref;result.blob=ref.hash;result.bytes=ref.bytes;result.width=reduced.width;result.height=reduced.height;if(!reduced.unchanged)result.codec=reduced.codec;}
    else if(transportRole){const reduced=await transportSourceFor(entry,transportRole.role,transportRole.rail);ref=reduced.ref;result.blob=ref.hash;result.bytes=ref.bytes;result.width=reduced.width;result.height=reduced.height;if(!reduced.unchanged)result.codec=reduced.codec;}
    else ref=await content(entry.blob,path.extname(logical));result.resource=ref;selected.set(ref.path,ref);}
   if(entry.slices){
    const terrain=new RegExp('^'+id+'/terrain-live/(albedo|normal)-[0-9]+\\.bin\\.gz$').exec(logical);
    const sourceSize=terrain&&terrainSourceMaxSize!==null?Math.min(entry.size,terrainSourceMaxSize):entry.size;if(terrain)result.size=sourceSize;
    result.slices=[];
    // Decode one source at a time: the largest input expands to 64 MiB.
    for(const slice of entry.slices){let ref,row;
     if(terrain&&terrainSourceMaxSize!==null){const reduced=await terrainSourceFor(slice,terrain[1]==='normal'?'normal':'color',entry.size);ref=reduced.ref;row={...slice,blob:ref.hash,bytes:ref.bytes,width:sourceSize,height:sourceSize,codec:reduced.extension==='.png'?'rgba-lossless-image':'webp'+(terrain[1]==='normal'?terrainNormalQuality:terrainColorQuality),pixelHash:reduced.pixelHash,resource:ref};if(reduced.opaque)row.opaque=true;else delete row.opaque;delete row.tiers;}
     else{ref=await content(slice.blob,'.png');row={...slice,resource:ref};}
     selected.set(ref.path,ref);
     if(terrainTiers&&terrain&&sourceSize>128){const tiers=await terrainTiersFor(row,terrain[1]==='normal'?'normal':'color',sourceSize,ref);row.tiers={...row.tiers,...tiers};for(const tier of Object.values(tiers))selected.set(tier.resource.path,tier.resource);}
     result.slices.push(row);
    }
   }
   out.resources[logical]=result;
  }
  for(const group of ['roads','decals'])for(const [key,part]of Object.entries(out.recipes[group]?.parts||{})){const ref=await recipe(part);selected.set(ref.path,ref);out.recipes[group].parts[key]=ref;}
  // Include dependencies rewritten inside glTF/cubemap/recipe JSON in this region's declared closure.
  const visited=new Set();
  const visit=async ref=>{if(visited.has(ref.path))return;visited.add(ref.path);if(!/\.(json|gltf|cubemap)$/.test(ref.path))return;const bytes=await fs.readFile(path.join(target,ref.path));const raw=ref.encoding?brotliDecompressSync(bytes):bytes;const text=raw.toString();for(const match of text.matchAll(/(?:\.\.\/\.\.\/|content\/)(br|raw)\/([a-f0-9]{64})\/asset(\.[a-z0-9]+)/g)){const file=`content/${match[1]}/${match[2]}/asset${match[3]}`,child=resources.get(file);if(!child)throw Error('Missing rewritten dependency');selected.set(file,child);await visit(child);}};
  // Traversal state belongs to this region, never to shared serialized receipts.
  for(const ref of [...selected.values()])await visit(ref);
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
