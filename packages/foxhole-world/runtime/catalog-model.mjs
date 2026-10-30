import {fetchWorldAsset} from './asset-locations.mjs';
import {Assets,extensions,ExtensionType,Texture,ImageSource} from 'pixi.js';
import {glbToGltf,normalizeMeshopt,parseGltf} from '@pixi/3d';
import {decodeWorldImage} from './image-bitmap.mjs';

// The beta GLB loader expects texture.source even when EXT_texture_webp is used.
// Keep the public asset URL as the Assets cache key and delegate decoding/cleanup.
export function catalogGlbForLoader(bytes){
 const input=new Uint8Array(bytes),view=new DataView(input.buffer,input.byteOffset,input.byteLength);
 if(input.length<28||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==input.length)throw Error('Invalid catalog GLB');
 const length=view.getUint32(12,true),end=20+length;
 if(end+8>input.length||view.getUint32(16,true)!==0x4e4f534a)throw Error('Invalid catalog GLB chunks');
 const document=JSON.parse(new TextDecoder().decode(input.subarray(20,end)));
 for(const texture of document.textures||[]){
  const source=texture.extensions?.EXT_texture_webp?.source;
  if(source!==undefined){if(!Number.isInteger(source)||document.images?.[source]?.mimeType!=='image/webp')throw Error('Invalid catalog WebP texture');texture.source=source;}
 }
 const json=new TextEncoder().encode(JSON.stringify(document)),padded=Math.ceil(json.length/4)*4,output=new Uint8Array(20+padded+input.length-end);
 output.set(input.subarray(0,20));const outView=new DataView(output.buffer);outView.setUint32(8,output.length,true);outView.setUint32(12,padded,true);
 output.fill(32,20,20+padded);output.set(json,20);output.set(input.subarray(end),20+padded);return output;
}
// Catalog models frequently embed identical material images. Share their decoded
// pixels by content while keeping a lease for each loaded model source.
const images=new Map(),owners=new WeakMap();
async function acquireImage(bytes,keys,sampling){
 const digest=await crypto.subtle.digest('SHA-256',bytes),key=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')+sampling;
 let record=images.get(key);if(!record){record={count:0,promise:null};record.promise=(async()=>new Texture({source:new ImageSource({resource:await decodeWorldImage(bytes),alphaMode:'premultiply-alpha-on-upload',autoGenerateMipmaps:true})}))();images.set(key,record);}
 record.count++;keys.push(key);return record.promise;
}
async function releaseImages(keys){for(const key of keys){const r=images.get(key);if(!r||--r.count)continue;images.delete(key);try{const t=await r.promise;t.source.resource?.close?.();t.destroy(true);}catch{}}}
// Keep downloaded buffers and image work bounded without occupying the host's
// shared CPU slots while cache/network reads are pending.
let preparing=0;const waiting=[];
async function acquire(){if(preparing<4)preparing++;else await new Promise(resolve=>waiting.push(resolve));}
function release(){const next=waiting.shift();if(next)next();else preparing--;}
const parser='loadFoxholeCatalogGlb';
extensions.add({extension:{type:ExtensionType.LoadParser,name:parser},name:parser,
 async load(url,asset){
  await acquire();try{const schedule=asset?.data?.scheduleModelTask||((task)=>task());
  const response=await fetchWorldAsset(url);if(!response.ok)throw Error('Catalog model download failed ('+response.status+')');
  const bytes=await response.arrayBuffer();if(bytes.byteLength>32*1024*1024)throw Error('Catalog model exceeds 32 MiB');
  const {json,buffers}=glbToGltf(catalogGlbForLoader(bytes).buffer);while(buffers.length<(json.buffers?.length||0))buffers.push(new ArrayBuffer(0));
  await schedule(()=>normalizeMeshopt(json,buffers));const keys=[];
  const pending=(json.images||[]).map(async (row,index)=>{if(row.uri)throw Error('External catalog images are unsupported');const v=json.bufferViews[row.bufferView];return acquireImage(buffers[v.buffer].slice(v.byteOffset||0,(v.byteOffset||0)+v.byteLength),keys,JSON.stringify((json.textures||[]).filter(t=>t.source===index).map(t=>json.samplers?.[t.sampler]||null)));});
  const settled=await Promise.allSettled(pending);
  try{const failure=settled.find(r=>r.status==='rejected');if(failure)throw failure.reason;const textures=settled.map(r=>r.value),source=await schedule(()=>parseGltf(json,buffers,textures));owners.set(source,keys);return source;}
  catch(error){await releaseImages(keys);throw error;}
  }finally{release();}
 },async unload(source){const keys=owners.get(source)||[];owners.delete(source);source.textures.length=0;source.destroy();await releaseImages(keys);}});
export const loadCatalogModel=(url,{scheduleModelTask}={})=>Assets.load({src:url,parser,data:{scheduleModelTask}});
