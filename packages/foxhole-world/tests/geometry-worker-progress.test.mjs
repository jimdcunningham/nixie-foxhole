import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../authoring/geometry-recipe-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function fixture({direct=true,fetcher}={}){
 const events=[],calls={bound:0,fallback:0},self={postMessage:data=>events.push(data)};
 runInNewContext(source,{self,performance:{setResourceTimingBufferSize(){},now:()=>0,getEntriesByType:()=>[]},
  MeshoptDecoder:{ready:Promise.resolve(),decodeGltfBuffer(){}},decodeWordPlanar:()=>new Uint8Array(),
  flattenDecalReceiver:()=>({}),replayBoundDecalSource:()=>{calls.bound++;return direct?new Float32Array():null;},replayDecalSource:()=>{calls.fallback++;return new Float32Array();},
  crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},
  fetch:fetcher||(async()=>({ok:true,json:async()=>({buffers:[],bufferViews:[]})})),
  URL,Map,Set,ArrayBuffer,Uint8Array,Uint32Array,Float32Array,Promise,Error});
 return {self,events,calls};
}
test('geometry worker reports real receiver completion and separate assembly',async()=>{
 const {self,events}=fixture();
 await self.onmessage({data:{kind:'decals',id:42,recipe:{assets:{a:{url:'https://fixture/a',buffers:[]},b:{url:'https://fixture/b',buffers:[]},c:{url:'https://fixture/c',buffers:[]}}},polygonsCount:0,polygonCodec:'word-planar',polygons:new ArrayBuffer(0),source:new ArrayBuffer(0),vertices:0,bindings:new ArrayBuffer(0),exceptions:new ArrayBuffer(0),hash:'0'.repeat(64),reportGeometryProgress:true}});
 const messages=events.filter(event=>event.kind==='geometry-progress');
 assert.deepEqual(messages.map(({stage,completed,total})=>[stage,completed,total]),[['assets',0,3],['assets',1,3],['assets',2,3],['assets',3,3],['assembly',undefined,undefined]]);
 assert.ok(messages.every(event=>event.id===42));assert.ok(events.at(-1).result instanceof ArrayBuffer);
});
test('geometry progress is opt-in for existing worker consumers',async()=>{
 const {self,events}=fixture();
 await self.onmessage({data:{kind:'decals',id:3,recipe:{assets:{}},polygonsCount:0,polygonCodec:'word-planar',polygons:new ArrayBuffer(0),source:new ArrayBuffer(0),vertices:0,bindings:new ArrayBuffer(0),exceptions:new ArrayBuffer(0),hash:'0'.repeat(64)}});
 assert.ok(events.every(event=>event.kind!=='geometry-progress'));assert.ok(events.at(-1).result instanceof ArrayBuffer);
});

test('geometry worker preserves progress and full replay fallback',async()=>{
 const {self,events,calls}=fixture({direct:false});
 await self.onmessage({data:{kind:'decals',id:7,recipe:{assets:{}},polygonsCount:0,polygonCodec:'word-planar',polygons:new ArrayBuffer(0),source:new ArrayBuffer(0),vertices:0,bindings:new ArrayBuffer(0),exceptions:new ArrayBuffer(0),hash:'0'.repeat(64),reportGeometryProgress:true}});
 assert.deepEqual(calls,{bound:1,fallback:1});assert.ok(events.some(event=>event.kind==='geometry-progress'&&event.stage==='assembly'));assert.ok(events.at(-1).result instanceof ArrayBuffer);
});

test('receiver I/O is bounded and failure drains started loads before worker completion',async()=>{
 const pending=[],fetcher=url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject}));
 const {self,events}=fixture({fetcher}),assets=Object.fromEntries(Array.from({length:20},(_,i)=>['asset'+i,{url:'https://fixture/'+i,buffers:[]}]));
 const task=self.onmessage({data:{kind:'decals',id:17,recipe:{assets},polygonsCount:0,polygonCodec:'word-planar',polygons:new ArrayBuffer(0),source:new ArrayBuffer(0),vertices:0,bindings:new ArrayBuffer(0),exceptions:new ArrayBuffer(0),hash:'0'.repeat(64),reportGeometryProgress:true}});
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 for(let n=0;n<30&&pending.length<16;n++)await tick();
 assert.equal(pending.length,16);
 pending[0].reject(Error('receiver unavailable'));await tick();
 assert.equal(pending.length,16,'do not start additional reads after failure');
 assert.ok(!events.some(event=>event.id===17&&event.error),'all started reads must settle before worker completion');
 for(const row of pending.slice(1))row.resolve({ok:true,json:async()=>({buffers:[],bufferViews:[]})});
 await task;
 assert.match(events.at(-1).error,/receiver unavailable/);assert.equal(pending.length,16);
});
