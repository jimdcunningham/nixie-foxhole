import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import decodePng,{init as initPng} from '@jsquash/png/decode.js';
import decodeWebp,{init as initWebp} from '@jsquash/webp/decode.js';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';

const require=createRequire(import.meta.url),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_IMAGE_BYTES=64*1024**2,MAX_IMAGE_SIZE=4096;
let ready;
async function decode(bytes){
 ready??=Promise.all([fs.readFile(require.resolve('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')).then(data=>initPng(data)),fs.readFile(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm')).then(data=>initWebp({wasmBinary:data}))]);
 await ready;const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 return bytes[0]===137?decodePng(buffer):decodeWebp(buffer);
}
/** Generate each exact runtime reduction directly from one decoded original. */
export async function generateTerrainSliceTiers(bytes,{kind,size,sourceHash,pixelHash,targets=[128]}){
 if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
 if(bytes.length>MAX_IMAGE_BYTES||!['color','normal'].includes(kind)||!Number.isInteger(size)||size<1||size>MAX_IMAGE_SIZE||!Array.isArray(targets)||!targets.length||new Set(targets).size!==targets.length||targets.some(target=>!Number.isInteger(target)||target<1||target>=size))throw Error('Invalid terrain tier source');
 if(!/^[a-f0-9]{64}$/.test(sourceHash||'')||digest(bytes)!==sourceHash)throw Error('Terrain tier source integrity failure');
 const info=await sharp(bytes,{limitInputPixels:MAX_IMAGE_SIZE**2}).metadata();
 if(!['png','webp'].includes(info.format)||info.width!==size||info.height!==size)throw Error('Invalid terrain tier image dimensions');
 const image=await decode(bytes),original=new Uint8Array(image.data.buffer,image.data.byteOffset,image.data.byteLength);
 if(image.width!==size||image.height!==size||original.length!==size*size*4)throw Error('Invalid terrain tier pixels');
 if(pixelHash&&(!/^[a-f0-9]{64}$/.test(pixelHash)||digest(original)!==pixelHash))throw Error('Terrain tier source pixel integrity failure');
 const tiers=[];
 for(const target of targets){
  const pixels=resizeTerrainPixels(original,size,size,1,target,{kind}).bytes,expected=digest(pixels);
  const input=()=>sharp(pixels,{raw:{width:target,height:target,channels:4}});
  let encoded=await input().webp({lossless:true,effort:4}).toBuffer(),extension='.webp';
  let verify=await decode(encoded);
  if(digest(verify.data)!==expected){encoded=await input().png({compressionLevel:9}).toBuffer();extension='.png';verify=await decode(encoded);}
  if(verify.width!==target||verify.height!==target||digest(verify.data)!==expected)throw Error('Terrain tier encoding changed pixels');
  tiers.push({bytes:encoded,extension,width:target,height:target,pixelHash:expected});
 }
 return tiers;
}
/** Generate one exact reduction, preserving even transparent RGB bytes. */
export async function generateTerrainSliceTier(bytes,{target=128,...options}){
 return (await generateTerrainSliceTiers(bytes,{...options,targets:[target]}))[0];
}

/** Create a smaller publication source, preserving normal vectors and alpha. */
export async function generateTerrainSource(bytes,{kind,size,sourceHash,pixelHash,target,quality=kind==='normal'?85:75}){
 if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
 if(bytes.length>MAX_IMAGE_BYTES||!['color','normal'].includes(kind)||!Number.isInteger(size)||size<1||size>MAX_IMAGE_SIZE||!Number.isInteger(target)||target<1||target>size||!Number.isInteger(quality)||quality<1||quality>100)throw Error('Invalid terrain source reduction');
 if(!/^[a-f0-9]{64}$/.test(sourceHash||'')||digest(bytes)!==sourceHash)throw Error('Terrain source integrity failure');
 const info=await sharp(bytes,{limitInputPixels:MAX_IMAGE_SIZE**2}).metadata();
 if(!['png','webp'].includes(info.format)||info.width!==size||info.height!==size)throw Error('Invalid terrain source dimensions');
 const image=await decode(bytes),original=new Uint8Array(image.data.buffer,image.data.byteOffset,image.data.byteLength);
 if(image.width!==size||image.height!==size||original.length!==size*size*4)throw Error('Invalid terrain source pixels');
 if(pixelHash&&(!/^[a-f0-9]{64}$/.test(pixelHash)||digest(original)!==pixelHash))throw Error('Terrain source pixel integrity failure');
 const pixels=target===size?original:resizeTerrainPixels(original,size,size,1,target,{kind}).bytes;
 const input=()=>sharp(pixels,{raw:{width:target,height:target,channels:4}});
 let encoded=await input().webp({quality,alphaQuality:100,effort:2,exact:true}).toBuffer(),extension='.webp';
 let verified=await decode(encoded);
 let alphaMatches=true;for(let i=3;i<pixels.length;i+=4)if(verified.data[i]!==pixels[i]){alphaMatches=false;break;}
 if(!alphaMatches){encoded=await input().png({compressionLevel:9}).toBuffer();extension='.png';verified=await decode(encoded);}
 if(verified.width!==target||verified.height!==target)throw Error('Terrain source encoding changed image dimensions');
 for(let i=3;i<pixels.length;i+=4)if(verified.data[i]!==pixels[i])throw Error('Terrain source encoding changed alpha');
 let opaque=true;for(let i=3;i<verified.data.length;i+=4)if(verified.data[i]!==255){opaque=false;break;}
 return {bytes:encoded,extension,width:target,height:target,pixelHash:digest(verified.data),opaque};
}
