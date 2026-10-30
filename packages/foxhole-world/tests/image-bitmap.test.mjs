import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeWorldImage} from '../runtime/image-bitmap.mjs';
test('world image decode associates upload-premultiplied colors and preserves data maps',async()=>{
 const previous=globalThis.createImageBitmap,calls=[];globalThis.createImageBitmap=async(blob,options)=>{calls.push({blob,options});return 'bitmap';};
 try{const blob=new Blob([new Uint8Array([1,2,3])]);assert.equal(await decodeWorldImage(blob),'bitmap');await decodeWorldImage(new Uint8Array([1,2,3]),'no-premultiply-alpha');await decodeWorldImage(blob,'premultiplied-alpha');assert.equal(calls[0].blob,blob);assert.deepEqual(calls.map(c=>c.options.premultiplyAlpha),['premultiply','none','none']);assert.ok(calls.every(c=>c.options.colorSpaceConversion==='none'));assert.deepEqual(new Uint8Array(await calls[1].blob.arrayBuffer()),new Uint8Array([1,2,3]));}finally{globalThis.createImageBitmap=previous;}
});

test('image decoding bounds overlapping native allocations and drains queued work',async()=>{
 const original=globalThis.createImageBitmap,gates=[];let calls=0,active=0,peak=0;
 globalThis.createImageBitmap=()=>new Promise(resolve=>{calls++;peak=Math.max(peak,++active);gates.push(()=>{active--;resolve({width:32,height:32});});});
 try{
  const tasks=Array.from({length:5},()=>decodeWorldImage(new Uint8Array([1])));
  await new Promise(setImmediate);assert.equal(calls,2);assert.equal(peak,2);
  gates.shift()();await new Promise(setImmediate);assert.equal(calls,3);assert.equal(active,2);
  while(calls<5||gates.length){gates.shift()?.();await new Promise(setImmediate);}
  assert.equal((await Promise.all(tasks)).length,5);assert.equal(peak,2);
 }finally{globalThis.createImageBitmap=original;}
});
