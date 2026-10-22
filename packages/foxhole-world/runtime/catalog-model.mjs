import {Assets,extensions,ExtensionType} from 'pixi.js';
import {loadGlb} from '@pixi/3d';

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
const parser='loadFoxholeCatalogGlb';
extensions.add({extension:{type:ExtensionType.LoadParser,name:parser},name:parser,
 async load(url,asset,loader){
  const response=await fetch(url);if(!response.ok)throw Error('Catalog model download failed ('+response.status+')');
  const bytes=await response.arrayBuffer();if(bytes.byteLength>32*1024*1024)throw Error('Catalog model exceeds 32 MiB');
  const blob=URL.createObjectURL(new Blob([catalogGlbForLoader(bytes)],{type:'model/gltf-binary'}));
  try{return await loadGlb.load(blob,asset,loader);}finally{URL.revokeObjectURL(blob);}
 },unload:(...args)=>loadGlb.unload(...args)});
export const loadCatalogModel=url=>Assets.load({src:url,parser});
