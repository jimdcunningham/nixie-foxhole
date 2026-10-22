import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import sharp from 'sharp';

// Qualified native GrassBlades instance: Use Alpha selects Materiality blue.
// Its albedo is DXT1/RGB, so merely declaring glTF MASK leaves the cards solid.
const rules=[{
 material:'War/Content/Materials/Environment/Props/BirchBushSnow.uasset',
 albedo:'War/Content/Textures/Foliage/BirchBushSnowA.BirchBushSnowA',
 mask:'Textures/Foliage/BirchBushSnowM.png',source:'War/Content/Textures/Foliage/BirchBushSnowM.BirchBushSnowM',channel:2,cutoff:.333,
}];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const compressed=bytes=>brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:6}});

/** Preserve decoded colour bytes and import the authored linear cutout channel. */
export async function packFoliageAlpha(albedo,mask,channel){
 const color=await sharp(albedo).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const opacity=await sharp(mask).removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(color.info.width!==opacity.info.width||color.info.height!==opacity.info.height)throw Error('Native foliage mask dimensions differ from albedo');
 if(!Number.isInteger(channel)||channel<0||channel>=opacity.info.channels)throw Error('Invalid foliage mask channel');
 for(let i=0;i<color.info.width*color.info.height;i++)color.data[i*4+3]=opacity.data[i*opacity.info.channels+channel];
 return sharp(color.data,{raw:{width:color.info.width,height:color.info.height,channels:4}}).png().toBuffer();
}

/** Normalize adopted compact glTF inputs once; retain original immutable blobs. */
export async function prepareNativeFoliageMasks({input,textureRoot}){
 const root=await fs.realpath(input),viewer=path.join(root,'viewer'),manifestFile=path.join(viewer,'dependency-bundles/manifest.json');
 const manifest=JSON.parse(await fs.readFile(manifestFile)),replacements=new Map(),added=new Map(),textures=new Map();
 const regions=(await fs.readdir(path.join(viewer,'dependency-bundles/regions'))).filter(n=>n.endsWith('.json'));
 async function read(hash){const row=manifest.blobs[hash];if(!row)throw Error('Undeclared foliage dependency '+hash);const file=row.entry.dependencyFile?path.resolve(viewer,row.entry.dependencyFile):path.join(root,'blobs',hash),actual=await fs.realpath(file);if(!actual.startsWith(root+path.sep))throw Error('Foliage dependency escapes prepared source');const bytes=await fs.readFile(actual);if(bytes.length!==row.bytes||digest(bytes)!==hash)throw Error('Foliage dependency integrity failure');return row.entry.codec.includes('brotli')?brotliDecompressSync(bytes):bytes;}
 async function store(bytes,entry,ids,region){const hash=digest(bytes);await fs.writeFile(path.join(root,'blobs',hash),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});let row=added.get(hash);if(!row){row={bytes:bytes.length,regions:[],profiles:['initial'],ids,entry:{...entry,bytes:bytes.length,blob:hash}};added.set(hash,row);}if(!row.regions.includes(region))row.regions.push(region);return row.entry;}
 let changedMaterials=0;const updated=[],pendingRegions=[];
 for(const filename of regions){
  const file=path.join(viewer,'dependency-bundles/regions',filename),region=JSON.parse(await fs.readFile(file)),newTextures=new Map();let changed=false;
  for(const [logical,entry]of Object.entries(region.resources)){
   if(!logical.endsWith('.gltf'))continue;
   let replacement=replacements.get(entry.blob);
   if(replacement===undefined){
    const doc=JSON.parse(await read(entry.blob)),used=[];
    for(const material of doc.materials||[]){
     const rule=rules.find(rule=>material.extras?.foxholeMaterialSource===rule.material&&material.extras?.foxholeAlbedoSource===rule.albedo);
     if(!rule||material.extras?.foxholeOpacitySource)continue;
     const texture=doc.textures?.[material.pbrMetallicRoughness?.baseColorTexture?.index],image=doc.images?.[texture?.source];
     const match=image?.uri?.match(/^\/__asset_ab\/content\/B\/([a-f0-9]{64})\/[a-f0-9]{64}\/asset\.[a-z0-9]+$/);
     if(!match)throw Error('Unsupported native foliage image reference');
     let converted=textures.get(match[1]);
     if(!converted){const bytes=await packFoliageAlpha(await read(match[1]),await fs.readFile(path.join(textureRoot,rule.mask)),rule.channel),hash=digest(bytes);converted={bytes,logical:'world-textures/'+hash+'.png',hash};textures.set(match[1],converted);}
     // Clone the binding so a solid material sharing this colour image stays solid.
     const imageIndex=doc.images.push({...image,uri:`/__asset_ab/content/B/${converted.hash}/${converted.hash}/asset.png`})-1;
     const textureIndex=doc.textures.push({...texture,source:imageIndex})-1;
     material.pbrMetallicRoughness.baseColorTexture={...material.pbrMetallicRoughness.baseColorTexture,index:textureIndex};
     material.alphaMode='MASK';material.alphaCutoff=rule.cutoff;
     material.extras={...material.extras,foxholeOpacitySource:rule.source,foxholeOpacityChannel:'B'};
     used.push(converted);changedMaterials++;
    }
    replacement=used.length?{bytes:compressed(Buffer.from(JSON.stringify(doc))),used}:null;
    replacements.set(entry.blob,replacement);
   }
   if(!replacement)continue;
   const fresh=await store(replacement.bytes,{...entry,sourceHash:digest(brotliDecompressSync(replacement.bytes)),dependencyFile:undefined},[logical],region.region);
   // A shared glTF may have several logical aliases across regions.
   const newRow=added.get(fresh.blob);if(!newRow.ids.includes(logical))newRow.ids.push(logical);
   region.resources[logical]=fresh;changed=true;
   for(const texture of replacement.used){const e=await store(texture.bytes,{codec:'identity',sourceHash:texture.hash},[texture.logical],region.region);newTextures.set(texture.logical,e);}
  }
  if(changed){Object.assign(region.resources,Object.fromEntries(newTextures));pendingRegions.push([file,region]);updated.push(region.region);}
 }
 for(const [hash,row]of added)manifest.blobs[hash]=row;
 if(updated.length){await fs.writeFile(manifestFile,JSON.stringify(manifest));for(const [file,region]of pendingRegions)await fs.writeFile(file,JSON.stringify(region));}
 return {regions:updated,materials:changedMaterials,textures:textures.size};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(import.meta.dirname,'prepare-foliage-alpha.mjs')){
 const [input,textureRoot]=process.argv.slice(2);if(!input||!textureRoot)throw Error('Pass prepared source and extracted native texture root');
 console.log(JSON.stringify(await prepareNativeFoliageMasks({input,textureRoot})));
}
