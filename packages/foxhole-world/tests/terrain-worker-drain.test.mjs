import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../authoring/decode-worker.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
function worker(cachedTerrainPixels) {
 const messages = [], self = {location:{href:'https://world.test/'},postMessage:value=>messages.push(value)};
 runInNewContext(source,{self,performance:{setResourceTimingBufferSize(){},now:()=>0,getEntriesByName:()=>[]},MeshoptDecoder:{ready:Promise.resolve()},cachedTerrainPixels,URL,Uint8Array,ArrayBuffer,Promise});
 messages.length=0;return {self,messages};
}
const entry = paths => ({size:2,slices:paths.map(path=>({resource:{path}}))});
const pixels = n => ({bytes:new Uint8Array(16).fill(n),width:2,height:2});

test('terrain worker drains in-flight slices after a failure and starts no new slices',async()=>{
 let releaseA,releaseC,rejectB;
 const a=new Promise(resolve=>{releaseA=resolve;}),c=new Promise(resolve=>{releaseC=resolve;}),b=new Promise((_,reject)=>{rejectB=reject;});
 const started=[];
 const {self,messages}=worker(async(_base,slice)=>{const name=slice.resource.path;started.push(name);if(name==='a')await a;else if(name==='b')await b;else if(name==='c')await c;return pixels(1);});
 const run=self.onmessage({data:{kind:'array',id:1,entry:entry(['a','b','c','d','e']),baseUrl:'https://world.test/',reportTextureProgress:true}});
 await tick();assert.deepEqual(started,['a','b','c']);rejectB(Error('injected failure'));await tick();
 assert.equal(messages.some(m=>m.error),false);releaseA();await tick();
 assert.deepEqual(started,['a','b','c']);assert.equal(messages.some(m=>m.error),false);
 releaseC();await run;await tick();assert.deepEqual(started,['a','b','c']);assert.match(messages.at(-1).error,/injected failure/);
 const count=messages.length;await tick();assert.equal(messages.length,count);
});

test('terrain worker retains bounded parallelism and slice ordering on success',async()=>{
 let active=0,max=0;
 const {self,messages}=worker(async(_base,slice)=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,(6-Number(slice.resource.path))*2));active--;return pixels(Number(slice.resource.path));});
 await self.onmessage({data:{kind:'array',id:2,entry:entry(['0','1','2','3','4','5']),baseUrl:'https://world.test/'}});
 assert.equal(max,3);assert.equal(messages.length,1);const data=new Uint8Array(messages[0].result);
 for(let i=0;i<6;i++)assert.deepEqual([...data.subarray(i*16,i*16+16)],Array(16).fill(i));
});

test('terrain worker waits for every sibling when multiple slices fail',async()=>{
 let releaseA,rejectB,rejectC;
 const a=new Promise(resolve=>{releaseA=resolve;}),b=new Promise((_,reject)=>{rejectB=reject;}),c=new Promise((_,reject)=>{rejectC=reject;});
 const started=[];
 const {self,messages}=worker(async(_base,slice)=>{const name=slice.resource.path;started.push(name);if(name==='a')await a;else if(name==='b')await b;else if(name==='c')await c;return pixels(1);});
 const run=self.onmessage({data:{kind:'array',id:3,entry:entry(['a','b','c','d']),baseUrl:'https://world.test/'}});
 await tick();rejectC(Error('first failure'));await tick();rejectB(Error('second failure'));await tick();
 assert.deepEqual(started,['a','b','c']);assert.equal(messages.some(m=>m.error),false);
 releaseA();await run;assert.match(messages.at(-1).error,/first failure/);assert.equal(messages.length,1);
});
