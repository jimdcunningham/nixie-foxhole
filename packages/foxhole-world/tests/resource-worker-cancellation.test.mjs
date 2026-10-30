import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../runtime/resource-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('resource worker cancels fetch and sends terminal only after producer drains',async()=>{
 const messages=[],started=defer(),aborted=defer(),drain=defer();const self={postMessage:value=>messages.push(value)};
 const fetchCompactResource=async(_base,_ref,{signal})=>{started.resolve(signal);await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted.resolve();resolve();},{once:true}));await drain.promise;throw signal.reason;};
 runInNewContext(source,{self,performance:{now:()=>0,setResourceTimingBufferSize(){},getEntriesByType:()=>[]},AbortController,fetchCompactResource,readCachedRecipe:async()=>null,readCachedRoadAssembly:async()=>null,Promise,String});
 messages.length=0;const task=self.onmessage({data:{id:123,baseUrl:'https://world.test/',ref:{path:'resource'}}});const signal=await started.promise;await self.onmessage({data:{kind:'cancel-resource',id:123}});await aborted.promise;assert.equal(signal.aborted,true);assert.equal(messages.length,0,'no terminal response before producer cleanup');drain.resolve();await task;assert.equal(messages.length,1);assert.equal(messages[0].id,123);assert.match(messages[0].error,/AbortError/);
});
