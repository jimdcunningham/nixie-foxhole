import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import sharp from 'sharp';
import decodePng,{init as initPng} from '@jsquash/png/decode.js';
import decodeWebp,{init as initWebp} from '@jsquash/webp/decode.js';
import {createBakeStore} from './bake-store.mjs';
const require=createRequire(import.meta.url),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let ready;
async function decode(bytes){ready??=Promise.all([fs.readFile(require.resolve('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')).then(bytes=>initPng(bytes)),fs.readFile(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm')).then(bytes=>initWebp({wasmBinary:bytes}))]);await ready;const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);return bytes[0]===137?decodePng(buffer):decodeWebp(buffer);}
/** Preserve the selected encoded terrain images after proving their decoded pixel identity. */
export async function reusePreparedTerrainTextures({worldDirectory,preparedViewerDirectory,blobDirectory,region}){
 const index=JSON.parse(await fs.readFile(path.join(worldDirectory,'index.json'),'utf8')),entry=index.regions[region];
 const scene=JSON.parse(gunzipSync(await fs.readFile(path.join(worldDirectory,entry.manifest.path))));
 const prepared=JSON.parse(await fs.readFile(path.join(preparedViewerDirectory,'dependency-bundles/regions',region+'.json'),'utf8'));
 const global=JSON.parse(await fs.readFile(path.join(preparedViewerDirectory,'dependency-bundles/manifest.json'),'utf8'));
 const store=createBakeStore(worldDirectory);let savedBytes=0,reused=0;
 for(const [bucketIndex,bucket]of scene.passes.terrain.meta.buckets.entries())for(const [channel,kind]of ['albedo','normal'].entries()){
  const original=prepared.resources[`${region}/terrain-live/${kind}-${bucketIndex}.bin.gz`],source=scene.sources[scene.passes.terrain.sources[bucketIndex*2+channel]];
  if(original?.codec!=='rgba-image-array')continue;
  if(original.slices.length!==source.layers||original.size!==source.width)throw Error('Prepared terrain dimensions changed');
  for(const [i,slice]of original.slices.entries()){
   const originalEntry=global.blobs[slice.blob]?.entry,file=originalEntry?.dependencyFile?path.resolve(preparedViewerDirectory,originalEntry.dependencyFile):path.join(blobDirectory,slice.blob);
   const encoded=await fs.readFile(file),decoded=await decode(encoded),current=source.resource.images[i];
   const expected=await sharp(await fs.readFile(path.join(worldDirectory,current.path))).ensureAlpha().raw().toBuffer();
   const pixels=Buffer.from(decoded.data.buffer,decoded.data.byteOffset,decoded.data.byteLength);
   if(decoded.width!==source.width||decoded.height!==source.height||!pixels.equals(expected))throw Error('Prepared texture pixels differ from the baked source');
   const replacement=await store.blob(encoded,{kind:'image',pixelHash:hash(pixels)});source.resource.images[i]=replacement;savedBytes+=current.bytes-replacement.bytes;reused++;
  }
 }
 const result=await store.region(scene);return {reused,savedBytes,downloadBytes:result.downloadBytes};
}
