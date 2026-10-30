import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';

test('terrain worker emits intermediate progress only when requested',async()=>{
 const source=readFileSync(new URL('../authoring/decode-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const messages=[],self={location:{href:'https://world.test/'},postMessage:value=>messages.push(value)};
 runInNewContext(source,{self,performance:{setResourceTimingBufferSize(){},now:()=>0,getEntriesByName:()=>[]},MeshoptDecoder:{ready:Promise.resolve()},
  cachedTerrainPixels:async()=>({bytes:new Uint8Array(16),width:2,height:2}),URL,Uint8Array,ArrayBuffer,Promise});
 messages.length=0;
 const entry={size:2,slices:[{resource:{path:'a'}},{resource:{path:'b'}}]};
 await self.onmessage({data:{kind:'array',id:1,entry,baseUrl:'https://world.test/'}});
 assert.equal(messages.length,1);assert.equal(messages[0].id,1);assert.equal(messages[0].result.byteLength,32);
 messages.length=0;
 await self.onmessage({data:{kind:'array',id:2,entry,baseUrl:'https://world.test/',reportTextureProgress:true}});
 assert.deepEqual(messages.filter(value=>value.kind==='terrain-progress').map(value=>value.completed),[1,2]);
 assert.equal(messages.at(-1).id,2);assert.equal(messages.at(-1).result.byteLength,32);
});


function tierFixture({withTier=true,badPixels=false}={}){
 const source=readFileSync(new URL('../authoring/decode-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const messages=[],fetched=[],cacheKeys=[],self={location:{href:'https://world.test/'},postMessage:value=>messages.push(value)};
 const pixels=new Uint8Array(128*128*4).fill(17),pixelHash=createHash('sha256').update(pixels).digest('hex');
 const original={path:'original',hash:'a'.repeat(64),decodedHash:'a'.repeat(64)},variant={path:'variant',hash:'b'.repeat(64),decodedHash:'b'.repeat(64)};
 const slice={resource:original,...(withTier?{tiers:{128:{width:128,height:128,pixelHash:badPixels?'c'.repeat(64):pixelHash,resource:variant}}}:{})};
 runInNewContext(source,{self,performance:{setResourceTimingBufferSize(){},now:()=>0,getEntriesByName:()=>[]},MeshoptDecoder:{ready:Promise.resolve()},
  resizeTerrainPixels,crypto:webcrypto,webpWasm:'',initWebp:async()=>{},
  decodeWebp:async bytes=>{const tier=new Uint8Array(bytes)[0]===1;return {width:tier?128:256,height:tier?128:256,data:tier?pixels:new Uint8Array(256*256*4)};},
  cachedTerrainPixels:async(_base,key,build)=>{cacheKeys.push(key);return build();},fetchCompactResource:async(_base,ref)=>{fetched.push(ref.path);return new Uint8Array([ref===variant?1:2]).buffer;},URL,Uint8Array,ArrayBuffer,Promise});
 messages.length=0;return {self,messages,fetched,cacheKeys,slice};
}
test('terrain worker selects verified 128px tiers and retains original decoded-cache identity',async()=>{
 const f=tierFixture();await f.self.onmessage({data:{kind:'array',id:1,entry:{size:256,slices:[f.slice]},baseUrl:'https://world.test/',maxSize:128}});
 assert.deepEqual(f.fetched,['variant']);assert.equal(f.messages.at(-1).result.byteLength,128*128*4);assert.equal(f.cacheKeys[0].resource.path,'original');
});
test('terrain worker falls back to the original for legacy and higher-resolution requests',async()=>{
 for(const [withTier,maxSize]of [[false,128],[true,256]]){
  const f=tierFixture({withTier});await f.self.onmessage({data:{kind:'array',id:1,entry:{size:256,slices:[f.slice]},baseUrl:'https://world.test/',maxSize}});
  assert.deepEqual(f.fetched,['original']);assert.equal(f.messages.at(-1).result.byteLength,maxSize*maxSize*4);
 }
});
test('terrain worker falls back to the original when variant pixels do not match the receipt',async()=>{
 const f=tierFixture({badPixels:true});await f.self.onmessage({data:{kind:'array',id:1,entry:{size:256,slices:[f.slice]},baseUrl:'https://world.test/',maxSize:128}});
 assert.deepEqual(f.fetched,['variant','original']);assert.equal(f.messages.at(-1).result.byteLength,128*128*4);
});
