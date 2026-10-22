import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import sharp from 'sharp';
import {createBakeStore} from '../bake-store.mjs';
test('the baker writes identical attributes and index sequences as immutable, deduplicated resources',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'foxwatch-bake-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=createBakeStore(root);await MeshoptDecoder.ready;
 for(const [value,kind,stride]of [[new Float32Array([1.2,-3,7,0,4.5,6]),'attributes',12],[new Uint16Array([4,2,1,0,3,4]),'indices',0],[new Uint32Array([65538,17,1,17,65538,41]),'indices',0]]){
  const input=Buffer.from(value.buffer),ref=await store.blob(input,{kind,stride,constructor:value.constructor.name}),encoded=gunzipSync(await fs.readFile(path.join(root,ref.path))),decoded=new Uint8Array(ref.rawBytes);
  MeshoptDecoder.decodeGltfBuffer(decoded,ref.count,ref.stride,encoded,ref.codec);assert.deepEqual(Buffer.from(decoded),input);assert.deepEqual(await store.blob(input,{kind,stride,constructor:value.constructor.name}),ref);
 }
});
test('transparent RGBA pixels survive texture preparation exactly',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'foxwatch-pixels-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const pixels=Buffer.from([255,23,41,0,9,81,137,255]);
 const ref=await createBakeStore(root).blob(pixels,{kind:'pixels',width:2,height:1,layers:1,format:'rgba8unorm'});
 assert.deepEqual(await sharp(await fs.readFile(path.join(root,ref.images[0].path))).ensureAlpha().raw().toBuffer(),pixels);
});
