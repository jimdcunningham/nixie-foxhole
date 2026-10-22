import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadBakedResource} from '../runtime/resource-cache.mjs';
const fixture=(name='one')=>{const bytes=new TextEncoder().encode(name),hash=createHash('sha256').update(bytes).digest('hex');return {bytes,ref:{path:'blobs/'+hash+'.bin.gz',hash,bytes:bytes.length}};};
function cache(){const data=new Map();return {data,open:async()=>({match:async key=>data.get(key)?.clone(),put:async(key,response)=>{data.set(key,response);},delete:async key=>data.delete(key)})};}
test('immutable resources reuse the persistent cache and coalesce concurrent reads',async()=>{
 const {bytes,ref}=fixture(),storage=cache();let requests=0;const fetcher=async()=>{requests++;return new Response(bytes);};
 const options={fetcher,cachesApi:storage},base='https://world.test/first/';
 const [a,b]=await Promise.all([loadBakedResource(base,ref,options),loadBakedResource(base,ref,options)]);
 assert.deepEqual(new Uint8Array(a),bytes);assert.deepEqual(a,b);assert.equal(requests,1);
 await loadBakedResource(base,ref,options);assert.equal(requests,1);
});
test('a corrupt cache entry is replaced and corrupt network bytes are never cached',async()=>{
 const {bytes,ref}=fixture('integrity'),storage=cache(),base='https://world.test/integrity/';storage.data.set(base+ref.path,new Response('broken'));
 const result=await loadBakedResource(base,ref,{cachesApi:storage,fetcher:async()=>new Response(bytes)});assert.deepEqual(new Uint8Array(result),bytes);
 const bad=fixture('bad');await assert.rejects(loadBakedResource(base,bad.ref,{cachesApi:storage,fetcher:async()=>new Response('wrong')}),/integrity/);assert.equal(storage.data.has(base+bad.ref.path),false);
});
test('cache quota failures preserve rendering and aborted consumers cannot receive a result',async()=>{
 const {bytes,ref}=fixture('quota'),controller=new AbortController();
 const cachesApi={open:async()=>{throw Error('quota');}};
 assert.deepEqual(new Uint8Array(await loadBakedResource('https://world.test/quota/',ref,{cachesApi,fetcher:async()=>new Response(bytes)})),bytes);
 controller.abort();await assert.rejects(loadBakedResource('https://world.test/abort/',ref,{signal:controller.signal}),{name:'AbortError'});
});
