import test from 'node:test';
import assert from 'node:assert/strict';
import {glbToGltf} from '@pixi/3d';
import {catalogGlbForLoader} from '../runtime/catalog-model.mjs';

test('catalog WebP adaptation preserves the complete GLB binary and shared part metadata',()=>{
 const document={asset:{version:'2.0',extras:{nixieModelParts:{version:1,parts:[{nodeName:'shared-part-0000',resourceId:'foxhole.model.shared.'+'a'.repeat(64)}]}}},images:[{bufferView:0,mimeType:'image/webp'}],textures:[{extensions:{EXT_texture_webp:{source:0}}}],buffers:[{byteLength:4}],bufferViews:[{buffer:0,byteLength:4}]};
 const encoded=new TextEncoder().encode(JSON.stringify(document)),length=Math.ceil(encoded.length/4)*4,input=new Uint8Array(28+length+4),v=new DataView(input.buffer);
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,input.length,true);v.setUint32(12,length,true);v.setUint32(16,0x4e4f534a,true);input.fill(32,20,20+length);input.set(encoded,20);v.setUint32(20+length,4,true);v.setUint32(24+length,0x004e4942,true);input.set([1,2,3,4],28+length);
 const output=catalogGlbForLoader(input.buffer),resultView=new DataView(output.buffer),resultLength=resultView.getUint32(12,true),result=JSON.parse(new TextDecoder().decode(output.subarray(20,20+resultLength)));
 assert.equal(result.textures[0].source,0);assert.deepEqual(result.asset.extras,document.asset.extras);assert.deepEqual(output.subarray(20+resultLength),input.subarray(20+length));assert.equal(resultView.getUint32(8,true),output.length);
 assert.throws(()=>catalogGlbForLoader(new ArrayBuffer(8)),/Invalid catalog GLB/);
});


test('catalog models share embedded pixels and retain them until all owners unload',async()=>{
 const {runInNewContext}=await import('node:vm'),{readFile}=await import('node:fs/promises'),{webcrypto}=await import('node:crypto');let parser,decodes=0,closed=0,alternate=false;
 const document={asset:{version:'2.0'},buffers:[{byteLength:4}],images:[{bufferView:0,mimeType:'image/png'}],textures:[{source:0}],bufferViews:[{buffer:0,byteLength:4}]};
 const json=new TextEncoder().encode(JSON.stringify(document)),length=Math.ceil(json.length/4)*4,input=new Uint8Array(28+length+4),view=new DataView(input.buffer);
 view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,input.length,true);view.setUint32(12,length,true);view.setUint32(16,0x4e4f534a,true);input.fill(32,20,20+length);input.set(json,20);view.setUint32(20+length,4,true);view.setUint32(24+length,0x004e4942,true);input.set([1,2,3,4],28+length);
 const code=(await readFile(new URL('../runtime/catalog-model.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 class ImageSource{constructor(o){Object.assign(this,o)}}class Texture{constructor(o){Object.assign(this,o)}destroy(){this.source.destroyed=true}}
 runInNewContext(code,{crypto:webcrypto,Uint8Array,Map,WeakMap,ArrayBuffer,DataView,TextEncoder,TextDecoder,ImageSource,Texture,Assets:{},ExtensionType:{LoadParser:1},extensions:{add(p){parser=p}},fetchWorldAsset:async()=>({ok:true,arrayBuffer:async()=>input.buffer}),glbToGltf,normalizeMeshopt:async json=>{if(alternate){json.samplers=[{wrapS:33071}];json.textures[0].sampler=0;}},decodeWorldImage:async()=>{decodes++;return{close(){closed++}}},parseGltf:async(j,b,t)=>({textures:t,destroy(){}})});
 const [a,b]=await Promise.all([parser.load('a'),parser.load('b')]);assert.equal(decodes,1);assert.equal(a.textures[0],b.textures[0]);alternate=true;const c=await parser.load('c');assert.equal(decodes,2);assert.notEqual(a.textures[0],c.textures[0]);await parser.unload(a);assert.equal(closed,0);await parser.unload(b);assert.equal(closed,1);await parser.unload(c);assert.equal(closed,2);
});


test('catalog downloads stay bounded and outside the shared decode queue',async()=>{
 const {runInNewContext}=await import('node:vm'),{readFile}=await import('node:fs/promises');let parser,started=0,active=0,peak=0,scheduled=0,release;
 const gate=new Promise(resolve=>release=resolve),json=new TextEncoder().encode('{"asset":{"version":"2.0"}}'),length=Math.ceil(json.length/4)*4,input=new Uint8Array(28+length),view=new DataView(input.buffer);
 view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,input.length,true);view.setUint32(12,length,true);view.setUint32(16,0x4e4f534a,true);input.fill(32,20,20+length);input.set(json,20);view.setUint32(24+length,0x004e4942,true);
 const code=(await readFile(new URL('../runtime/catalog-model.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 runInNewContext(code,{Uint8Array,Map,WeakMap,ArrayBuffer,DataView,TextEncoder,TextDecoder,Assets:{},ExtensionType:{LoadParser:1},extensions:{add(p){parser=p}},fetchWorldAsset:async()=>{started++;peak=Math.max(peak,++active);try{await gate;return{ok:true,arrayBuffer:async()=>input.buffer};}finally{active--;}},glbToGltf,normalizeMeshopt:async()=>{},parseGltf:async()=>({textures:[],destroy(){}})});
 const scheduleModelTask=async task=>{scheduled++;return task();},pending=Array.from({length:9},(_,i)=>parser.load(String(i),{data:{scheduleModelTask}}));
 await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(started,4,'catalog buffers must retain the previous four-source preparation bound');assert.equal(scheduled,0,'pending downloads cannot occupy decode slots');}
 finally{release();await Promise.all(pending);}
 assert.equal(peak,4);assert.equal(scheduled,18,'only meshopt and glTF parsing use the shared queue');
});
