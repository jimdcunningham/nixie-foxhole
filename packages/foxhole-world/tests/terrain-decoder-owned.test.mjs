import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import sharp from 'sharp';
import decodeWebp,{init as initWebp} from '@jsquash/webp/decode.js';
import decodePng,{init as initPng} from '@jsquash/png/decode.js';

const source=readFileSync(new URL('../authoring/decode-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function worker({decode,kind='webp'}){
 const events=[],self={location:{href:'https://example.test/'},postMessage:(message,transfer)=>events.push({message,transfer})};
 runInNewContext(source,{self,performance:{setResourceTimingBufferSize(){},now:()=>0},MeshoptDecoder:{ready:Promise.resolve()},
  decodeWebp:kind==='webp'?decode:undefined,decodePng:kind==='png'?decode:undefined,initWebp:async()=>{},initPng:async()=>{},webpWasm:'',pngWasm:'',Uint8Array,ArrayBuffer,Promise});
 events.length=0;return {self,events};
}
function bytesFor(kind){return new Uint8Array([kind==='png'?137:0]).buffer;}
test('whole owned pixel buffers are reused and transferred exactly',async()=>{
 const pixels=new Uint8ClampedArray([1,2,3,4,5,6,7,8]);
 const f=worker({decode:async()=>({data:pixels,width:2,height:1})});
 await f.self.onmessage({data:{kind:'image',id:7,bytes:bytesFor('webp')}});
 const {message,transfer}=f.events.at(-1);
 assert.equal(message.result,pixels.buffer);assert.equal(transfer[0],pixels.buffer);assert.deepEqual([...new Uint8Array(message.result)],[1,2,3,4,5,6,7,8]);
});
test('partial pixel views are copied before the backing buffer is transferred',async()=>{
 const backing=new Uint8Array([99,1,2,3,4,5,6,7,8,88]),pixels=new Uint8ClampedArray(backing.buffer,1,8);
 const f=worker({decode:async()=>({data:pixels,width:2,height:1})});
 await f.self.onmessage({data:{kind:'image',id:8,bytes:bytesFor('webp')}});
 const {message,transfer}=f.events.at(-1);assert.notEqual(message.result,backing.buffer);assert.equal(message.result.byteLength,8);assert.equal(transfer[0],message.result);
 backing.fill(0);assert.deepEqual([...new Uint8Array(message.result)],[1,2,3,4,5,6,7,8]);
});
test('non-transferable shared backing is copied into an ordinary ArrayBuffer',async()=>{
 const pixels=new Uint8Array(new SharedArrayBuffer(8));pixels.set([1,2,3,4,5,6,7,8]);
 const f=worker({decode:async()=>({data:pixels,width:2,height:1})});
 await f.self.onmessage({data:{kind:'image',id:9,bytes:bytesFor('webp')}});
 const {message,transfer}=f.events.at(-1);assert.ok(message.result instanceof ArrayBuffer);assert.equal(transfer[0],message.result);pixels.fill(0);assert.deepEqual([...new Uint8Array(message.result)],[1,2,3,4,5,6,7,8]);
});
test('real jsquash PNG and WebP output remains stable across decode and transfer',async()=>{
 const req=createRequire(import.meta.url);
 await initPng(await readFile(req.resolve('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')));
 await initWebp({wasmBinary:await readFile(req.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))});
 const input=new Uint8Array(32*32*4);for(let i=0;i<input.length;i++)input[i]=(i*71)%256;
 for(const kind of ['png','webp']){
  const png=sharp(input,{raw:{width:32,height:32,channels:4}}),encoded=await(kind==='png'?png.png():png.webp({lossless:true})).toBuffer();
  const decode=kind==='png'?decodePng:decodeWebp,toArray=()=>encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.byteLength);
  const expected=await decode(toArray()),snapshot=new Uint8Array(expected.data),f=worker({decode,kind});
  await f.self.onmessage({data:{kind:'image',id:11,bytes:toArray()}});
  const {message,transfer}=f.events.at(-1);assert.deepEqual(new Uint8Array(message.result),snapshot);assert.equal(transfer[0],message.result);
  const moved=structuredClone(message.result,{transfer});assert.deepEqual(new Uint8Array(moved),snapshot);
  const next=await decode(toArray());assert.deepEqual(new Uint8Array(next.data),snapshot);assert.deepEqual(new Uint8Array(moved),snapshot);
 }
});
