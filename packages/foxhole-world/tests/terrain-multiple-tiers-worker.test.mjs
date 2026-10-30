import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture({target=128,mode='valid',size=1024}={}){
 const source=readFileSync(new URL('../authoring/decode-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const messages=[],fetched=[],cacheKeys=[],self={location:{href:'https://world.test/'},postMessage:value=>messages.push(value)};
 const pixels=new Uint8Array(target*target*4).fill(17),original={path:'original',hash:'a'.repeat(64),decodedHash:'a'.repeat(64)},variant={path:'variant',hash:'b'.repeat(64),decodedHash:'b'.repeat(64)};
 const tier={width:target,height:target,pixelHash:mode==='bad-pixels'?'c'.repeat(64):hash(pixels),resource:variant};
 if(mode==='bad-size')tier.height=target+1;if(mode==='bad-hash')tier.resource={...variant,hash:'bad'};
 const slice={resource:original,...(mode==='missing'?{}:{tiers:{[target]:tier}})};
 runInNewContext(source,{self,performance:{setResourceTimingBufferSize(){},now:()=>0,getEntriesByName:()=>[]},MeshoptDecoder:{ready:Promise.resolve()},resizeTerrainPixels,crypto:webcrypto,webpWasm:'',initWebp:async()=>{},
  decodeWebp:async bytes=>{const isTier=new Uint8Array(bytes)[0]===1;if(isTier&&mode==='decode-failure')throw Error('Decoding error');if(isTier&&mode==='unexpected-decode')throw Error('unexpected decoder fault');return {width:isTier?target:size,height:isTier?target:size,data:isTier?pixels:new Uint8Array(size*size*4)};},
  cachedTerrainPixels:async(_base,key,build)=>{cacheKeys.push(key);return build();},fetchCompactResource:async(_base,ref)=>{fetched.push(ref.path);if(ref===variant){if(mode==='bad-encoded')throw Object.assign(Error('resource integrity failure'),{name:'WorldResourceError',kind:'integrity'});if(mode==='missing-payload'||mode==='original-failure')throw Object.assign(Error('World resource 404'),{name:'WorldResourceError',kind:'unavailable'});if(mode==='abort')throw Object.assign(Error('cancelled'),{name:'AbortError'});if(mode==='wrapped-abort')throw Error('fetch failed',{cause:Object.assign(Error('cancelled'),{name:'AbortError'})});if(mode==='range')throw RangeError('allocation failed');if(mode==='wrapped-range')throw Object.assign(Error('network failed',{cause:RangeError('allocation failed')}),{name:'WorldResourceError',kind:'unavailable'});if(mode==='unexpected')throw Error('unexpected code failure');}else if(mode==='original-failure')throw Error('original resource unavailable');return new Uint8Array([ref===variant?1:2]).buffer;},URL,Uint8Array,ArrayBuffer,Promise});
 messages.length=0;return {self,messages,fetched,cacheKeys,slice,size};
}
async function run(f,target){await f.self.onmessage({data:{kind:'array',id:1,entry:{size:f.size,slices:[f.slice]},baseUrl:'https://world.test/',maxSize:target}});}
test('worker uses only the exact requested valid 128, 256, or 512 variant',async()=>{
 for(const target of [128,256,512]){const f=fixture({target});await run(f,target);assert.deepEqual(f.fetched,['variant']);assert.equal(f.messages.at(-1).result.byteLength,target*target*4);assert.equal(f.cacheKeys[0].resource.path,'original');assert.equal(f.cacheKeys[0].width,target);}
});
test('missing or malformed variant metadata falls back to original source',async()=>{
 for(const mode of ['missing','bad-size','bad-hash']){const f=fixture({target:256,mode});await run(f,256);assert.deepEqual(f.fetched,['original']);assert.equal(f.messages.at(-1).result.byteLength,256*256*4);}
 const f=fixture({target:256});await run(f,512);assert.deepEqual(f.fetched,['original']);assert.equal(f.messages.at(-1).result.byteLength,512*512*4);
});
test('missing or corrupt tier payloads fall back to the verified original',async()=>{
 for(const mode of ['missing-payload','bad-pixels','bad-encoded']){const f=fixture({target:512,mode});await run(f,512);assert.deepEqual(f.fetched,['variant','original']);assert.equal(f.messages.at(-1).result.byteLength,512*512*4);}
});
test('tier cancellation never starts an original fetch, including wrapped aborts',async()=>{
 for(const mode of ['abort','wrapped-abort']){const f=fixture({target:256,mode});await run(f,256);assert.deepEqual(f.fetched,['variant']);assert.match(f.messages.at(-1).error,/cancelled|fetch failed/);}
});
test('an original failure is reported when tier recovery also fails',async()=>{
 const f=fixture({target:256,mode:'original-failure'});await run(f,256);assert.deepEqual(f.fetched,['variant','original']);assert.match(f.messages.at(-1).error,/original resource unavailable/);assert.match(f.messages.at(-1).error,/World resource 404/);
});
test('allocation and unexpected failures never trigger original fetch',async()=>{
 for(const mode of ['range','wrapped-range','unexpected','unexpected-decode','decode-failure']){const f=fixture({target:256,mode});await run(f,256);assert.deepEqual(f.fetched,['variant']);assert.match(f.messages.at(-1).error,/allocation failed|network failed|unexpected|Decoding error/);}
});
test('a native-size tier is ignored so it cannot replace original pixels',async()=>{
 const f=fixture({target:256,size:256});await run(f,256);assert.deepEqual(f.fetched,['original']);assert.equal(f.messages.at(-1).result.byteLength,256*256*4);
});
