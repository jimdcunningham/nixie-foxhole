import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import sharp from 'sharp';
import {fireStaticProfile} from './effect-materials.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Keep all four independent linear channels; browser premultiplication must not mix masks. */
export async function packFireMasks(bytes){
 const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});const rgb=Buffer.from(data),alpha=Buffer.from(data);
 for(let i=0;i<data.length;i+=4){rgb[i+3]=255;alpha[i]=alpha[i+1]=alpha[i+2]=data[i+3];alpha[i+3]=255;}
 const png=buffer=>sharp(buffer,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();return Promise.all([png(rgb),png(alpha)]);
}
/** Bounded immutable model pass. Geometry and world/placement documents are never rewritten. */
export async function prepareEffectMaterials({input,native,regions,translate}){
 const root=await fs.realpath(input),viewer=path.join(root,'viewer'),mf=path.join(viewer,'dependency-bundles/manifest.json'),manifest=JSON.parse(await fs.readFile(mf));
 const inspection=JSON.parse(await fs.readFile(path.join(native,'material-inspection.json'))),rows=new Map(inspection.materials.map(r=>[r.path.toLowerCase(),r]));
 const files=new Map(JSON.parse(await fs.readFile(path.join(native,'material-source.json'))).map(r=>[r.path,path.resolve(native,r.file)]));
 const converted=new Map(),added=new Map(),updates=[];let materials=0;
 async function read(digest){const row=manifest.blobs[digest];if(!row)throw Error('Undeclared material dependency');const file=await fs.realpath(row.entry.dependencyFile?path.resolve(viewer,row.entry.dependencyFile):path.join(root,'blobs',digest));if(!file.startsWith(root+path.sep))throw Error('Material dependency escapes source');const bytes=await fs.readFile(file);if(hash(bytes)!==digest||bytes.length!==row.bytes)throw Error('Material dependency integrity failure');return row.entry.codec.includes('brotli')?brotliDecompressSync(bytes):bytes;}
 async function store(bytes,entry,logical,region){const digest=hash(bytes);await fs.writeFile(path.join(root,'blobs',digest),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});let row=added.get(digest);if(!row){row={bytes:bytes.length,regions:[],profiles:['initial'],ids:[],entry:{...entry,dependencyFile:undefined,bytes:bytes.length,blob:digest}};added.set(digest,row);}if(!row.regions.includes(region))row.regions.push(region);if(!row.ids.includes(logical))row.ids.push(logical);return row.entry;}
 for(const filename of (await fs.readdir(path.join(viewer,'dependency-bundles/regions'))).sort()){
  if(!filename.endsWith('.json')||(regions&&!regions.includes(filename.slice(0,-5))))continue;
  const file=path.join(viewer,'dependency-bundles/regions',filename),region=JSON.parse(await fs.readFile(file));let changed=false;
  for(const [logical,entry]of Object.entries(region.resources)){
   if(!logical.endsWith('.gltf'))continue;let result=converted.get(entry.blob);
   if(result===undefined){const doc=JSON.parse(await read(entry.blob)),resources=[];let count=0;
    async function image(bytes){const digest=hash(bytes),logical='world-textures/'+digest+'.png';resources.push({bytes,digest,logical});doc.images??=[];doc.textures??=[];doc.samplers??=[];const sampler=doc.samplers.push({wrapS:10497,wrapT:10497,minFilter:9987,magFilter:9729})-1,source=doc.images.push({uri:`/__asset_ab/content/B/${digest}/${digest}/asset.png`})-1;return {index:doc.textures.push({source,sampler})-1};}
    for(const material of doc.materials||[]){const row=rows.get(material.extras?.foxholeMaterialSource?.toLowerCase());if(!row)continue;
     const nativeImage=async source=>{const file=files.get(source);if(!file)throw Error('Missing native effect texture '+source);return fs.readFile(file);};
     if(await translate({material,row,doc,image,nativeImage}))count++;
    }
    result=count?{bytes:brotliCompressSync(Buffer.from(JSON.stringify(doc))),resources}:null;materials+=count;converted.set(entry.blob,result);
   }
   if(!result)continue;region.resources[logical]=await store(result.bytes,{...entry,sourceHash:hash(brotliDecompressSync(result.bytes))},logical,region.region);changed=true;
   for(const image of result.resources)region.resources[image.logical]=await store(image.bytes,{codec:'identity',sourceHash:image.digest},image.logical,region.region);
  }
  if(changed)updates.push([file,region]);
 }
 if(updates.length){for(const [digest,row]of added)manifest.blobs[digest]=row;await fs.writeFile(mf,JSON.stringify(manifest));for(const [file,region]of updates)await fs.writeFile(file,JSON.stringify(region));}
 return {regions:updates.map(([,r])=>r.region),materials};
}
export async function translateFireStatic({material,row,image,nativeImage}){
 const profile=fireStaticProfile(row);if(!profile||material.extras?.foxholeFireStaticVersion===1)return false;
 const [rgb,alpha]=await packFireMasks(await nativeImage(profile.mask));
 material.pbrMetallicRoughness={baseColorFactor:[0,0,0,1],metallicFactor:0,roughnessFactor:1,metallicRoughnessTexture:await image(rgb)};material.occlusionTexture=await image(alpha);delete material.normalTexture;
 material.alphaMode='BLEND';material.doubleSided=true;
 material.extras={...material.extras,foxholeMaterialFamily:'fire-static',foxholeFireStaticVersion:1,foxholeFireStatic:profile};return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(import.meta.dirname,'prepare-effect-materials.mjs')){
 const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];if(!args.includes('--input')||!args.includes('--native'))throw Error('Pass --input and --native; optionally --regions deadlands');
 console.log(JSON.stringify(await prepareEffectMaterials({input:arg('--input'),native:arg('--native'),regions:args.includes('--regions')?arg('--regions').split(','):undefined,translate:translateFireStatic})));
}
