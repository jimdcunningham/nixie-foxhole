import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../authoring/decode-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const entry=paths=>({size:2,slices:paths.map(path=>({resource:{path}}))});
const pixels={bytes:new Uint8Array(16),width:2,height:2};
function fixture(cache){const messages=[],self={location:{href:'https://world.test/'},postMessage:value=>messages.push(value)};runInNewContext(source,{self,AbortController,DOMException,performance:{setResourceTimingBufferSize(){},now:()=>0,getEntriesByName:()=>[]},MeshoptDecoder:{ready:Promise.resolve()},cachedTerrainPixels:cache,URL,Uint8Array,ArrayBuffer,Promise});messages.length=0;return{self,messages};}
test('cancel stops new slices, cancels resource signals, and drains already-started cache work',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),started=[],signals=[];
 const {self,messages}=fixture(async(_base,slice,_build,{signal})=>{started.push(slice.resource.path);signals.push(signal);if(slice.resource.path==='b')await gate;else await new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});return pixels;});
 const work=self.onmessage({data:{kind:'array',id:1,entry:entry(['a','b','c','d']),baseUrl:'https://world.test/',reportTextureProgress:true}});await tick();assert.deepEqual(started,['a','b','c']);
 await self.onmessage({data:{kind:'cancel-terrain',id:1}});await tick();assert.ok(signals.every(s=>s.aborted));assert.equal(messages.some(m=>m.error),false);assert.deepEqual(started,['a','b','c']);
 release();await work;assert.match(messages.at(-1).error,/AbortError/);assert.equal(messages.filter(m=>m.kind==='terrain-progress').length,0);
});
test('canceling one worker job does not cancel another job',async()=>{
 const gates=new Map(),signals=new Map();const {self,messages}=fixture(async(_base,slice,_build,{signal})=>{signals.set(slice.resource.path,signal);await new Promise(resolve=>gates.set(slice.resource.path,resolve));return pixels;});
 const first=self.onmessage({data:{kind:'array',id:1,entry:entry(['a']),baseUrl:'https://world.test/'}}),second=self.onmessage({data:{kind:'array',id:2,entry:entry(['b']),baseUrl:'https://world.test/'}});await tick();
 await self.onmessage({data:{kind:'cancel-terrain',id:1}});assert.equal(signals.get('a').aborted,true);assert.equal(signals.get('b').aborted,false);gates.get('a')();gates.get('b')();await Promise.all([first,second]);
 assert.match(messages.find(m=>m.id===1).error,/AbortError/);assert.ok(messages.find(m=>m.id===2).result);
});
