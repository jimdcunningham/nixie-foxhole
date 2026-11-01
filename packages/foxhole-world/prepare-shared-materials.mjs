import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import sharp from 'sharp';
import {spawnSync} from 'node:child_process';
import {sharedMaterialProfile,matchingMaterialProfile} from './material-families.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clamp=value=>Math.max(0,Math.min(255,Math.round(value)));

/** Data textures remain linear; copy RGB verbatim when adding a cutout channel. */
export async function packSharedMaterial(color,packed,profile){
 const c=await sharp(color).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const factor=Math.min(1,512/Math.max(c.info.width,c.info.height)),width=Math.max(1,Math.round(c.info.width*factor)),height=Math.max(1,Math.round(c.info.height*factor));
 const m=await sharp(packed).ensureAlpha().resize(width,height,{kernel:'linear'}).raw().toBuffer();
 const orm=Buffer.alloc(m.length),rgba=Buffer.from(c.data);
 for(let i=0;i<m.length;i+=4){
  orm[i]=255;orm[i+1]=clamp(profile.roughChannel===null?profile.rough*255:m[i+profile.roughChannel]*profile.roughMultiply);
  orm[i+2]=clamp(profile.metalChannel===null?profile.metal*255:m[i+profile.metalChannel]);orm[i+3]=255;
 }
 if(typeof profile.alpha==='number'){
  const opacity=width===c.info.width&&height===c.info.height?m:await sharp(packed).ensureAlpha().resize(c.info.width,c.info.height,{kernel:'linear'}).raw().toBuffer();
  for(let i=0;i<rgba.length;i+=4)rgba[i+3]=opacity[i+profile.alpha];
 }
 return {orm:await sharp(orm,{raw:{width,height,channels:4}}).png().toBuffer(),
  color:profile.alpha===null?null:await sharp(rgba,{raw:{width:c.info.width,height:c.info.height,channels:4}}).png().toBuffer()};
}

/** Normalize immutable prepared models; old blobs remain available for recovery. */
export async function prepareSharedMaterials({input,native,regions}){
 const root=await fs.realpath(input),viewer=path.join(root,'viewer'),manifestFile=path.join(viewer,'dependency-bundles/manifest.json');
 const manifest=JSON.parse(await fs.readFile(manifestFile));
 const inspection=JSON.parse(await fs.readFile(path.join(native,'material-inspection.json')));
 const profiles=inspection.materials.map(sharedMaterialProfile).filter(Boolean);
 const nativeFiles=new Map(JSON.parse(await fs.readFile(path.join(native,'material-source.json'))).map(r=>[r.path,path.resolve(native,r.file)]));
 const converted=new Map(),added=new Map(),updates=[],packedImages=new Map();let materials=0;
 async function read(digest){
  const row=manifest.blobs[digest];if(!row)throw Error('Undeclared model dependency '+digest);
  const file=await fs.realpath(row.entry.dependencyFile?path.resolve(viewer,row.entry.dependencyFile):path.join(root,'blobs',digest));
  if(!file.startsWith(root+path.sep))throw Error('Model dependency escapes prepared source');
  const bytes=await fs.readFile(file);if(bytes.length!==row.bytes||hash(bytes)!==digest)throw Error('Model dependency integrity failure');
  return row.entry.codec.includes('brotli')?brotliDecompressSync(bytes):bytes;
 }
 async function store(bytes,entry,logical,region){
  const digest=hash(bytes);await fs.writeFile(path.join(root,'blobs',digest),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  let row=added.get(digest);if(!row){row={bytes:bytes.length,regions:[],profiles:['initial'],ids:[],entry:{...entry,bytes:bytes.length,blob:digest}};added.set(digest,row);}
  if(!row.regions.includes(region))row.regions.push(region);if(!row.ids.includes(logical))row.ids.push(logical);
  return row.entry;
 }
 for(const filename of (await fs.readdir(path.join(viewer,'dependency-bundles/regions'))).sort()){
  if(!filename.endsWith('.json')||(regions&&!regions.includes(filename.slice(0,-5))))continue;
  const file=path.join(viewer,'dependency-bundles/regions',filename),region=JSON.parse(await fs.readFile(file));let changed=false;
  for(const [logical,entry]of Object.entries(region.resources)){
   if(!logical.endsWith('.gltf'))continue;
   let result=converted.get(entry.blob);
   if(result===undefined){
    const doc=JSON.parse(await read(entry.blob)),resources=[];let count=0;
    for(const material of doc.materials||[]){
     const profile=matchingMaterialProfile(material,profiles);if(!profile||material.extras?.foxholeSharedMaterialVersion===1)continue;
     const binding=material.pbrMetallicRoughness?.baseColorTexture,texture=doc.textures?.[binding?.index],image=doc.images?.[texture?.source];
     const digest=image?.uri?.match(/^\/__asset_ab\/content\/B\/([a-f0-9]{64})\/[a-f0-9]{64}\/asset\.[a-z0-9]+$/)?.[1];
     if(!digest)throw Error('Unsupported native material image reference: '+logical);
     const packedFile=nativeFiles.get(profile.packed);if(!packedFile)throw Error('Missing native packed texture '+profile.packed);
     const packingKey=digest+JSON.stringify(profile);
     if(!packedImages.has(packingKey))packedImages.set(packingKey,packSharedMaterial(await read(digest),await fs.readFile(packedFile),profile));
     const packed=await packedImages.get(packingKey);
     function imageBinding(bytes){
      const digest=hash(bytes),logical='world-textures/'+digest+'.png';resources.push({bytes,digest,logical});
      const source=doc.images.push({uri:`/__asset_ab/content/B/${digest}/${digest}/asset.png`})-1;
      return {...binding,index:doc.textures.push({...texture,source})-1};
     }
     material.pbrMetallicRoughness.metallicRoughnessTexture=imageBinding(packed.orm);
     material.pbrMetallicRoughness.metallicFactor=material.pbrMetallicRoughness.roughnessFactor=1;
     if(packed.color)material.pbrMetallicRoughness.baseColorTexture=imageBinding(packed.color);
     if(profile.alpha!==null){material.alphaMode='MASK';material.alphaCutoff=profile.cutoff;}
     material.extras={...material.extras,foxholeSharedMaterialVersion:1,foxholeMaterialFamily:profile.family,foxholePackedSurfaceSource:profile.packed,
      ...(profile.alpha!==null?{foxholeOpacitySource:profile.alpha==='albedo'?profile.albedo:profile.packed,foxholeOpacityChannel:profile.alpha==='albedo'?'A':['R','G','B','A'][profile.alpha]}:{})};
     count++;
    }
    result=count?{bytes:brotliCompressSync(Buffer.from(JSON.stringify(doc)),{params:{[constants.BROTLI_PARAM_QUALITY]:6}}),resources}:null;
    materials+=count;converted.set(entry.blob,result);
   }
   if(!result)continue;
   const next=await store(result.bytes,{...entry,sourceHash:hash(brotliDecompressSync(result.bytes)),dependencyFile:undefined},logical,region.region);
   region.resources[logical]=next;changed=true;
   for(const image of result.resources)region.resources[image.logical]=await store(image.bytes,{codec:'identity',sourceHash:image.digest},image.logical,region.region);
  }
  if(changed)updates.push([file,region]);
 }
 if(updates.length){for(const [digest,row]of added)manifest.blobs[digest]=row;await fs.writeFile(manifestFile,JSON.stringify(manifest));for(const [file,region]of updates)await fs.writeFile(file,JSON.stringify(region));}
 return {regions:updates.map(([,r])=>r.region),materials,profiles:profiles.length};
}

/** Extract only the qualified material families used by the selected prepared regions. */
export async function extractSharedMaterials({input,native,pak,importer,regions}){
 const root=await fs.realpath(input),viewer=path.join(root,'viewer');
 const manifest=JSON.parse(await fs.readFile(path.join(viewer,'dependency-bundles/manifest.json'))),sources=new Set(),models=new Set();
 for(const name of await fs.readdir(path.join(viewer,'dependency-bundles/regions'))){
  if(!name.endsWith('.json')||(regions&&!regions.includes(name.slice(0,-5))))continue;
  const region=JSON.parse(await fs.readFile(path.join(viewer,'dependency-bundles/regions',name)));
  for(const [logical,entry]of Object.entries(region.resources))if(logical.endsWith('.gltf'))models.add(entry.blob);
 }
 for(const digest of models){const row=manifest.blobs[digest],entry=row.entry,bytes=await fs.readFile(entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',digest));
  if(hash(bytes)!==digest)throw Error('Material extraction input integrity failure');
  const doc=JSON.parse(entry.codec.includes('brotli')?brotliDecompressSync(bytes):bytes);
  for(const material of doc.materials||[])if(material.extras?.foxholeMaterialSource)sources.add(material.extras.foxholeMaterialSource.toLowerCase());
 }
 await fs.mkdir(native,{recursive:true});
 await fs.writeFile(path.join(native,'material-names.json'),JSON.stringify([...new Set([...sources].map(s=>path.posix.basename(s,'.uasset')))]));
 function probe(mode){const result=spawnSync('dotnet',[importer,pak,mode,native],{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error('Native material extraction failed: '+mode);}
 probe('materials');
 const file=path.join(native,'material-inspection.json'),inspection=JSON.parse(await fs.readFile(file));
 inspection.materials=inspection.materials.filter(r=>sources.has(r.path.toLowerCase()));
 const requests=[...new Set(inspection.materials.map(sharedMaterialProfile).filter(Boolean).map(p=>p.packed))];
 await fs.writeFile(file,JSON.stringify(inspection));
 await fs.writeFile(path.join(native,'material-texture-requests.json'),JSON.stringify(requests));
 probe('material-textures');
 return {materials:inspection.materials.length,textures:requests.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(import.meta.dirname,'prepare-shared-materials.mjs')){
 const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1],input=arg('--input'),native=arg('--native');
 if(!args.includes('--input')||!args.includes('--native'))throw Error('Pass --input <prepared root> --native <extraction directory>; optionally --pak <Paks directory> and --regions deadlands');
 const regions=args.includes('--regions')?arg('--regions').split(','):undefined;
 if(args.includes('--pak'))await extractSharedMaterials({input,native,pak:arg('--pak'),regions,
  importer:args.includes('--importer')?arg('--importer'):path.join(import.meta.dirname,'importer/bin/Debug/net8.0/Importer.dll')});
 console.log(JSON.stringify(await prepareSharedMaterials({input,native,regions})));
}
