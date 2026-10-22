import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {MeshoptEncoder} from 'meshoptimizer/encoder';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import sharp from 'sharp';

export function createBakeStore(directory) {
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 async function save(bytes,extension){
  const digest=hash(bytes),relative='blobs/'+digest+extension,file=path.join(directory,relative);
  await fs.mkdir(path.dirname(file),{recursive:true});
  try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
  return {path:relative,bytes:bytes.length,hash:digest};
 }
 async function blob(bytes,details){
  if(details.kind==='image'){
   const info=await sharp(bytes).metadata();
   if(!info.width||!info.height)throw Error('Invalid baked image');
   // Preserve the already selected texture encoding and native dimensions.
   return {...await save(bytes,info.format==='webp'?'.webp':'.png'),codec:'image',...(details.pixelHash?{pixelHash:details.pixelHash}:{})};
  }
  if(details.kind==='pixels'){
   const {width,height,layers=1}=details,channels=details.format==='r8unorm'?1:4;
   if(bytes.length!==width*height*layers*channels)throw Error('Invalid texture-array byte count');
   const images=[];
   for(let i=0;i<layers;i++){
    const raw=bytes.subarray(i*width*height*channels,(i+1)*width*height*channels);
    let extension='.webp',image=await sharp(raw,{raw:{width,height,channels}}).webp({lossless:true,effort:4}).toBuffer();
    // Pixel identity is verified before a resource enters the delivery bundle.
    const decoded=await (channels===4?sharp(image).ensureAlpha():sharp(image).greyscale()).raw().toBuffer();
    if(channels===4&&!decoded.equals(raw)){
     image=await sharp(raw,{raw:{width,height,channels}}).png({compressionLevel:9}).toBuffer();extension='.png';
     if(!(await sharp(image).ensureAlpha().raw().toBuffer()).equals(raw))throw Error('Lossless texture encoding changed pixels');
    }
    images.push({...await save(image,extension),pixelHash:hash(raw)});
   }
   return {codec:'pixels',channels,images};
  }
  await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
  let codec='raw',payload=bytes,count,stride=details.stride;
  if(details.kind==='indices'){
   stride=details.constructor==='Uint16Array'?2:4;count=bytes.length/stride;
   payload=MeshoptEncoder.encodeGltfBuffer(bytes,count,stride,'INDICES');codec='INDICES';
  }else if(stride>=4&&stride<=256&&stride%4===0&&bytes.length%stride===0){
   count=bytes.length/stride;payload=MeshoptEncoder.encodeGltfBuffer(bytes,count,stride,'ATTRIBUTES');codec='ATTRIBUTES';
  }
  if(codec!=='raw'){
   const check=new Uint8Array(bytes.length);MeshoptDecoder.decodeGltfBuffer(check,count,stride,payload,codec);
   if(!Buffer.from(check).equals(bytes))throw Error('Geometry encoding changed buffer bytes');
  }
  const compressed=gzipSync(payload,{level:9});
  return {...await save(compressed,'.bin.gz'),codec,count,stride,rawBytes:bytes.length,constructor:details.constructor,sourceHash:hash(bytes)};
 }
 async function region(scene){
  if(scene.version!==1||!/^[a-z0-9]+$/.test(scene.region)||!scene.nodes?.length)throw Error('Invalid prepared region');
  const text=Buffer.from(JSON.stringify(scene)),entry=await save(gzipSync(text,{level:9}),'.json.gz');
  const directoryEntries=new Map();
  function scan(value){if(!value||typeof value!=='object')return;if(value.path&&value.hash&&Number.isSafeInteger(value.bytes))directoryEntries.set(value.path,value);for(const child of Object.values(value))scan(child);}
  scan(scene);directoryEntries.set(entry.path,entry);
  const resources=[...directoryEntries.values()].map(({path,hash,bytes})=>({path,hash,bytes}));
  const item={id:scene.region,manifest:entry,resources,downloadBytes:resources.reduce((sum,r)=>sum+r.bytes,0),geometryCount:scene.geometries.length,materialCount:scene.materials.length,nodeCount:scene.nodes.length};
  const indexFile=path.join(directory,'index.json');
  const previous=await fs.readFile(indexFile,'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return {version:1,regions:{}};});
  previous.regions[scene.region]=item;
  const temporary=indexFile+'.'+process.pid+'.tmp';await fs.writeFile(temporary,JSON.stringify(previous));await fs.rename(temporary,indexFile);
  return item;
 }
 return {blob,region};
}
