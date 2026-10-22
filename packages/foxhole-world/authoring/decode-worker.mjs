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
 return{bytes:new Uint8Array(image.data),width:image.width,height:image.height};
}
function plainGlb(bytes){const d=new DataView(bytes),jsonLength=d.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonLength))),bin=new Uint8Array(bytes,28+jsonLength),chunks=[];let offset=0;
 for(const v of doc.bufferViews){const ext=v.extensions?.EXT_meshopt_compression;let chunk;if(ext){chunk=new Uint8Array(ext.count*ext.byteStride);MeshoptDecoder.decodeGltfBuffer(chunk,ext.count,ext.byteStride,bin.subarray(ext.byteOffset,ext.byteOffset+ext.byteLength),ext.mode,ext.filter||'NONE');delete v.extensions.EXT_meshopt_compression;}else chunk=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);const pad=(4-offset%4)%4;if(pad){chunks.push(new Uint8Array(pad));offset+=pad;}v.buffer=0;v.byteOffset=offset;v.byteLength=chunk.length;chunks.push(chunk);offset+=chunk.length;}
 doc.buffers=[{byteLength:offset}];for(const key of ['extensionsUsed','extensionsRequired'])if(doc[key])doc[key]=doc[key].filter(x=>x!=='EXT_meshopt_compression');
 const json=new TextEncoder().encode(JSON.stringify(doc)),jp=(json.length+3)&~3,bp=(offset+3)&~3,out=new ArrayBuffer(28+jp+bp),view=new DataView(out),u=new Uint8Array(out);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,out.byteLength,true);view.setUint32(12,jp,true);view.setUint32(16,0x4e4f534a,true);u.fill(32,20,20+jp);u.set(json,20);view.setUint32(20+jp,bp,true);view.setUint32(24+jp,0x004e4942,true);let p=28+jp;for(const c of chunks){u.set(c,p);p+=c.length;}return out;
}
self.onmessage=async({data})=>{const start=performance.now();try{await MeshoptDecoder.ready;let result;
 if(data.kind==='image'){const decoded=await rgba(data.bytes);result=decoded.bytes.buffer;self.postMessage({id:data.id,result,width:decoded.width,height:decoded.height,ms:performance.now()-start},[result]);return;}
 if(data.kind==='array'){const {entry}=data;const targetSize=Math.min(entry.size,data.maxSize||entry.size),kind=data.normal?'normal':'color';const cacheMetrics={cacheHits:0,cacheMisses:0,cacheWriteFailures:0,downloadBytes:0};const stride=targetSize*targetSize*4,out=new Uint8Array(stride*entry.slices.length),timings=[],decodeStats={nativeExact:0,wasm:0};let index=0;
  await Promise.all(Array.from({length:3},async()=>{while(index<entry.slices.length){const i=index++,slice=entry.slices[i],url=data.sliceUrls?.[i]||((data.blobPrefix||'/__asset_ab/blob/')+slice.blob+(data.blobSuffix||''));const build=async()=>{const bytes=data.baseUrl&&slice.resource?await fetchCompactResource(data.baseUrl,slice.resource,{metrics:cacheMetrics}):await (async()=>{const r=await fetch(url);if(!r.ok)throw Error('Terrain slice '+r.status);return r.arrayBuffer();})();const decoded=await rgba(bytes,slice);decodeStats[decoded.nativeExact?'nativeExact':'wasm']++;if(decoded.width!==entry.size||decoded.height!==entry.size)throw Error('Terrain dimensions changed');return resizeTerrainPixels(decoded.bytes,decoded.width,decoded.height,1,targetSize,{kind});};const derived=targetSize===entry.size?slice:{...slice,width:targetSize,height:targetSize};const decoded=data.baseUrl?await cachedTerrainPixels(data.baseUrl,derived,build,{metrics:cacheMetrics,...(targetSize===entry.size?{}:{variant:'terrain-'+kind+'-area-v1'})}):await build();if(decoded.width!==targetSize||decoded.height!==targetSize)throw Error('Terrain dimensions changed');out.set(decoded.bytes,i*stride);const timing=performance.getEntriesByName(new URL(url,self.location.href).href).at(-1);if(timing)timings.push({name:timing.name,startTime:timing.startTime,transferSize:timing.transferSize,encodedBodySize:timing.encodedBodySize,duration:timing.duration});}}));result=out.buffer;self.postMessage({id:data.id,result,timings,decodeStats,cacheMetrics,timeOrigin:performance.timeOrigin,ms:performance.now()-start},[result]);return;
 }else if(data.kind==='weights'){const bytes=await fetchCompactResource(data.baseUrl,data.entry.resource,{metrics:data.metrics});const resized=resizeTerrainPixels(new Uint8Array(bytes),data.width,data.height,data.layers,data.maxSize,{channels:1});result=resized.bytes.buffer;self.postMessage({id:data.id,result,ms:performance.now()-start},[result]);return;
 }else if(data.codec==='xyz-planar-brotli'){const src=new Float32Array(data.bytes),count=src.length/3,out=new Float32Array(src.length);for(let i=0;i<count;i++){out[i*3]=src[i];out[i*3+1]=src[count+i];out[i*3+2]=src[count*2+i];}result=out.buffer;}
 else if(data.codec==='word-planar-brotli')result=decodeWordPlanar(new Uint8Array(data.bytes),data.entry.delta);
 else if(data.codec==='meshopt-glb-brotli')result=plainGlb(data.bytes);
 else if(data.codec==='packed-road-vertices'){const out=new Uint8Array(data.entry.count*28);MeshoptDecoder.decodeGltfBuffer(out,data.entry.count,28,new Uint8Array(data.bytes),'ATTRIBUTES','NONE');result=unpackRoadVertices(out,data.entry.count);}
 else if(data.codec==='meshopt-road-brotli'){const out=new Uint8Array(data.entry.count*data.entry.stride);MeshoptDecoder.decodeGltfBuffer(out,data.entry.count,data.entry.stride,new Uint8Array(data.bytes),data.entry.mode,'NONE');result=out.buffer;}
 else result=data.bytes;
 self.postMessage({id:data.id,result,ms:performance.now()-start},[result]);
 }catch(error){self.postMessage({id:data.id,error:String(error.stack||error)});}};

self.postMessage({kind:'foxhole-worker-ready'});
