import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';
import {fetchCompactResource} from '../runtime/compact-cache.mjs';
import {cachedTerrainPixels} from '../runtime/decoded-texture-cache.mjs';
import {unpackRoadVertices} from './packed-road-codec.mjs';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {decodeWordPlanar} from './word-planar.mjs';
import pngWasm from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm?url';
import webpWasm from '@jsquash/webp/codec/dec/webp_dec.wasm?url';
import decodePng,{init as initPng} from '@jsquash/png/decode.js';
import decodeWebp,{init as initWebp} from '@jsquash/webp/decode.js';
// Workers have their own resource-timing buffer. Its default 250 entries loses
// terrain requests across repeated A/B swaps even though the page buffer is big.
performance.setResourceTimingBufferSize(30000);
let pngReady,webpReady;
async function rgba(bytes,entry){
 const data=new Uint8Array(bytes),png=data[0]===137;
 if(entry?.opaque&&entry.pixelHash&&typeof ImageDecoder==='function'&&self.crypto?.subtle){let decoder;try{
  decoder=new ImageDecoder({data:bytes,type:png?'image/png':'image/webp',colorSpaceConversion:'none'});const {image}=await decoder.decode({frameIndex:0});let out,width,height;try{width=image.displayWidth;height=image.displayHeight;out=new Uint8Array(width*height*4);await image.copyTo(out,{format:'RGBA',layout:[{offset:0,stride:width*4}]});}finally{image.close();}
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',out))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash===entry.pixelHash)return{bytes:out,width,height,nativeExact:true};
 }catch{}finally{decoder?.close();}}
 if(data[4]===102&&data[5]===116&&data[6]===121&&data[7]===112){
  const decoder=new ImageDecoder({data:bytes,type:'image/avif',colorSpaceConversion:'none'});
  try{const {image}=await decoder.decode({frameIndex:0});try{const width=image.displayWidth,height=image.displayHeight,out=new Uint8Array(width*height*4);await image.copyTo(out,{format:'RGBA',layout:[{offset:0,stride:width*4}]});return{bytes:out,width,height};}finally{image.close();}}finally{decoder.close();}
 }
 if(png){pngReady??=initPng(pngWasm);await pngReady;}
 else{webpReady??=initWebp({locateFile:()=>webpWasm});await webpReady;}
 const image=await(png?decodePng(bytes):decodeWebp(bytes));
 // jsquash's ImageData owns a stable pixel buffer. Reuse it when it can be
 // transferred whole; otherwise copy the view so unrelated backing bytes and
 // non-transferable buffers cannot escape with an image result.
 const pixels=image.data,owned=pixels.buffer instanceof ArrayBuffer&&pixels.byteOffset===0&&pixels.byteLength===pixels.buffer.byteLength;
 return{bytes:owned?new Uint8Array(pixels.buffer):new Uint8Array(pixels),width:image.width,height:image.height};
}
function terrainVariant(slice,targetSize,sourceSize){
 const tier=targetSize<sourceSize&&[128,256,512].includes(targetSize)?slice.tiers?.[targetSize]:null,ref=tier?.resource;
 return tier?.width===targetSize&&tier?.height===targetSize&&/^[a-f0-9]{64}$/.test(tier.pixelHash||'')&&/^[a-f0-9]{64}$/.test(ref?.hash||'')&&/^[a-f0-9]{64}$/.test(ref?.decodedHash||'')&&typeof ref?.path==='string'?tier:null;
}
const pixelDigest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
// Network wrappers can retain a cancellation as their cause; never turn an
// aborted optional fetch into a potentially much larger original download.
function isAbort(error){const seen=new Set();while(error&&typeof error==='object'&&!seen.has(error)){seen.add(error);if(error.name==='AbortError'||error.code==='ABORT_ERR')return true;error=error.cause;}return false;}
function isExhaustion(error){const seen=new Set();while(error&&typeof error==='object'&&!seen.has(error)){seen.add(error);if(error.name==='RangeError'||error.name==='OutOfMemoryError')return true;error=error.cause;}return false;}
class TerrainTierError extends Error {constructor(message,options){super(message,options);this.name='TerrainTierError';}}
function recoverableTierError(error){return error?.name==='TerrainTierError'||error?.name==='WorldResourceError'&&['unavailable','integrity'].includes(error.kind);}
function plainGlb(bytes){const d=new DataView(bytes),jsonLength=d.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonLength))),bin=new Uint8Array(bytes,28+jsonLength),chunks=[];let offset=0;
 for(const v of doc.bufferViews){const ext=v.extensions?.EXT_meshopt_compression;let chunk;if(ext){chunk=new Uint8Array(ext.count*ext.byteStride);MeshoptDecoder.decodeGltfBuffer(chunk,ext.count,ext.byteStride,bin.subarray(ext.byteOffset,ext.byteOffset+ext.byteLength),ext.mode,ext.filter||'NONE');delete v.extensions.EXT_meshopt_compression;}else chunk=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);const pad=(4-offset%4)%4;if(pad){chunks.push(new Uint8Array(pad));offset+=pad;}v.buffer=0;v.byteOffset=offset;v.byteLength=chunk.length;chunks.push(chunk);offset+=chunk.length;}
 doc.buffers=[{byteLength:offset}];for(const key of ['extensionsUsed','extensionsRequired'])if(doc[key])doc[key]=doc[key].filter(x=>x!=='EXT_meshopt_compression');
 const json=new TextEncoder().encode(JSON.stringify(doc)),jp=(json.length+3)&~3,bp=(offset+3)&~3,out=new ArrayBuffer(28+jp+bp),view=new DataView(out),u=new Uint8Array(out);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,out.byteLength,true);view.setUint32(12,jp,true);view.setUint32(16,0x4e4f534a,true);u.fill(32,20,20+jp);u.set(json,20);view.setUint32(20+jp,bp,true);view.setUint32(24+jp,0x004e4942,true);let p=28+jp;for(const c of chunks){u.set(c,p);p+=c.length;}return out;
}
const terrainJobs=new Map();
self.onmessage=async({data})=>{
 if(data.kind==='cancel-terrain'){terrainJobs.get(data.id)?.abort(new DOMException('Terrain job retired','AbortError'));return;}
 const controller=['array','weights'].includes(data.kind)&&typeof AbortController==='function'?new AbortController():null,signal=controller?.signal;
 if(controller)terrainJobs.set(data.id,controller);
 const start=performance.now(),onNetwork=observation=>{if(!signal?.aborted)self.postMessage({kind:'terrain-observation',id:data.id,observation});};try{signal?.throwIfAborted();await MeshoptDecoder.ready;signal?.throwIfAborted();let result;
 if(data.kind==='image'){const decoded=await rgba(data.bytes);result=decoded.bytes.buffer;self.postMessage({id:data.id,result,width:decoded.width,height:decoded.height,ms:performance.now()-start},[result]);return;}
 if(data.kind==='array'){const {entry}=data;const targetSize=Math.min(entry.size,data.maxSize||entry.size),kind=data.normal?'normal':'color';const cacheMetrics={cacheHits:0,cacheMisses:0,cacheWriteFailures:0,downloadBytes:0};const stride=targetSize*targetSize*4,out=new Uint8Array(stride*entry.slices.length),timings=[],decodeStats={nativeExact:0,wasm:0};let index=0,completed=0;
  let failed=false,firstError;const tasks=Array.from({length:3},async()=>{try{while(!failed&&!signal?.aborted&&index<entry.slices.length){const i=index++,slice=entry.slices[i],variant=data.baseUrl?terrainVariant(slice,targetSize,entry.size):null,originalUrl=data.baseUrl&&slice.resource?new URL(slice.resource.path,data.baseUrl).href:data.sliceUrls?.[i]||((data.blobPrefix||'/__asset_ab/blob/')+slice.blob+(data.blobSuffix||''));let url=variant?new URL(variant.resource.path,data.baseUrl).href:originalUrl;
   const decodeSelected=async(selected,isTier)=>{signal?.throwIfAborted();const bytes=data.baseUrl&&selected.resource?await fetchCompactResource(data.baseUrl,selected.resource,{metrics:cacheMetrics,onNetwork,signal}):await (async()=>{const r=await fetch(url,{signal});if(!r.ok)throw Error('Terrain slice '+r.status);return r.arrayBuffer();})();signal?.throwIfAborted();const decoded=await rgba(bytes,selected);signal?.throwIfAborted();const expected=isTier?targetSize:entry.size;if(decoded.width!==expected||decoded.height!==expected){if(isTier)throw new TerrainTierError('Terrain tier dimensions changed');throw Error('Terrain dimensions changed');}if(isTier&&await pixelDigest(decoded.bytes)!==variant.pixelHash)throw new TerrainTierError('Terrain tier pixel integrity failure');signal?.throwIfAborted();decodeStats[decoded.nativeExact?'nativeExact':'wasm']++;return resizeTerrainPixels(decoded.bytes,decoded.width,decoded.height,1,targetSize,{kind});};
   const build=async()=>{signal?.throwIfAborted();if(!variant)return decodeSelected(slice,false);try{return await decodeSelected({...variant,opaque:slice.opaque},true);}catch(error){signal?.throwIfAborted();if(isAbort(error)||isExhaustion(error)||!recoverableTierError(error))throw error;url=originalUrl;try{return await decodeSelected(slice,false);}catch(originalError){if(isAbort(originalError))throw originalError;const failure=new Error('Original terrain failed: '+String(originalError?.message||originalError)+'; optional tier failed: '+String(error.message||error),{cause:originalError});failure.name=originalError?.name||'Error';throw failure;}}};const derived=targetSize===entry.size?slice:{...slice,width:targetSize,height:targetSize};const decoded=data.baseUrl?await cachedTerrainPixels(data.baseUrl,derived,build,{metrics:cacheMetrics,signal,...(targetSize===entry.size?{}:{variant:'terrain-'+kind+'-area-v1'})}):await build();signal?.throwIfAborted();if(decoded.width!==targetSize||decoded.height!==targetSize)throw Error('Terrain dimensions changed');out.set(decoded.bytes,i*stride);if(data.reportTextureProgress)self.postMessage({kind:'terrain-progress',id:data.id,completed:++completed,total:entry.slices.length});const timing=performance.getEntriesByName(new URL(url,self.location.href).href).at(-1);if(timing)timings.push({name:timing.name,startTime:timing.startTime,transferSize:timing.transferSize,encodedBodySize:timing.encodedBodySize,duration:timing.duration});}}catch(error){if(!failed){failed=true;firstError=error;}throw error;}});await Promise.allSettled(tasks);signal?.throwIfAborted();if(failed)throw firstError;result=out.buffer;self.postMessage({id:data.id,result,timings,decodeStats,cacheMetrics,timeOrigin:performance.timeOrigin,ms:performance.now()-start},[result]);return;
 }else if(data.kind==='weights'){const bytes=await fetchCompactResource(data.baseUrl,data.entry.resource,{metrics:data.metrics,onNetwork,signal});signal?.throwIfAborted();const resized=resizeTerrainPixels(new Uint8Array(bytes),data.width,data.height,data.layers,data.maxSize,{channels:1});result=resized.bytes.buffer;self.postMessage({id:data.id,result,ms:performance.now()-start},[result]);return;
 }else if(data.codec==='xyz-planar-brotli'){const src=new Float32Array(data.bytes),count=src.length/3,out=new Float32Array(src.length);for(let i=0;i<count;i++){out[i*3]=src[i];out[i*3+1]=src[count+i];out[i*3+2]=src[count*2+i];}result=out.buffer;}
 else if(data.codec==='word-planar-brotli')result=decodeWordPlanar(new Uint8Array(data.bytes),data.entry.delta);
 else if(data.codec==='meshopt-glb-brotli')result=plainGlb(data.bytes);
 else if(data.codec==='packed-road-vertices'){const out=new Uint8Array(data.entry.count*28);MeshoptDecoder.decodeGltfBuffer(out,data.entry.count,28,new Uint8Array(data.bytes),'ATTRIBUTES','NONE');result=unpackRoadVertices(out,data.entry.count);}
 else if(data.codec==='meshopt-road-brotli'){const out=new Uint8Array(data.entry.count*data.entry.stride);MeshoptDecoder.decodeGltfBuffer(out,data.entry.count,data.entry.stride,new Uint8Array(data.bytes),data.entry.mode,'NONE');result=out.buffer;}
 else result=data.bytes;
 self.postMessage({id:data.id,result,ms:performance.now()-start},[result]);
 }catch(error){self.postMessage({id:data.id,error:String(error?.stack||error)});}finally{if(controller&&terrainJobs.get(data.id)===controller)terrainJobs.delete(data.id);}};

self.postMessage({kind:'foxhole-worker-ready'});
