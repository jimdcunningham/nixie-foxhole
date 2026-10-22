import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogGlbForLoader} from '../runtime/catalog-model.mjs';

test('catalog WebP adaptation preserves the complete GLB binary and shared part metadata',()=>{
 const document={asset:{version:'2.0',extras:{nixieModelParts:{version:1,parts:[{nodeName:'shared-part-0000',resourceId:'foxhole.model.shared.'+'a'.repeat(64)}]}}},images:[{bufferView:0,mimeType:'image/webp'}],textures:[{extensions:{EXT_texture_webp:{source:0}}}],buffers:[{byteLength:4}],bufferViews:[{buffer:0,byteLength:4}]};
 const encoded=new TextEncoder().encode(JSON.stringify(document)),length=Math.ceil(encoded.length/4)*4,input=new Uint8Array(28+length+4),v=new DataView(input.buffer);
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,input.length,true);v.setUint32(12,length,true);v.setUint32(16,0x4e4f534a,true);input.fill(32,20,20+length);input.set(encoded,20);v.setUint32(20+length,4,true);v.setUint32(24+length,0x004e4942,true);input.set([1,2,3,4],28+length);
 const output=catalogGlbForLoader(input.buffer),resultView=new DataView(output.buffer),resultLength=resultView.getUint32(12,true),result=JSON.parse(new TextDecoder().decode(output.subarray(20,20+resultLength)));
 assert.equal(result.textures[0].source,0);assert.deepEqual(result.asset.extras,document.asset.extras);assert.deepEqual(output.subarray(20+resultLength),input.subarray(20+length));assert.equal(resultView.getUint32(8,true),output.length);
 assert.throws(()=>catalogGlbForLoader(new ArrayBuffer(8)),/Invalid catalog GLB/);
});
