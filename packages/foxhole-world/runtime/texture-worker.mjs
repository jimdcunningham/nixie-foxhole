import decodePng,{init as initPng} from '@jsquash/png/decode.js';
import decodeWebp,{init as initWebp} from '@jsquash/webp/decode.js';
import pngUrl from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm?url';
import webpUrl from '@jsquash/webp/codec/dec/webp_dec.wasm?url';
let pngReady,webpReady;
self.onmessage=async({data:{id,bytes,channels,pixelHash}})=>{
 try{
  const input=new Uint8Array(bytes),png=input[0]===137;
  if(png){pngReady??=initPng(pngUrl);await pngReady;}else{webpReady??=initWebp({locateFile:()=>webpUrl});await webpReady;}
  const image=await(png?decodePng(bytes):decodeWebp(bytes));let pixels=new Uint8Array(image.data.buffer,image.data.byteOffset,image.data.byteLength);
  if(channels===1){const mono=new Uint8Array(image.width*image.height);for(let i=0;i<mono.length;i++)mono[i]=pixels[i*4];pixels=mono;}
  if(pixelHash){const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==pixelHash)throw Error('Baked texture pixel identity check failed');}
  const output=pixels.buffer.slice(pixels.byteOffset,pixels.byteOffset+pixels.byteLength);self.postMessage({id,width:image.width,height:image.height,bytes:output},[output]);
 }catch(error){self.postMessage({id,error:String(error.message||error)});}
};
