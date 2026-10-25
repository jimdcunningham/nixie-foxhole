import {memoryWorldCaches} from './cache-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {packRoadAssembly,unpackRoadAssembly,snapshotRoadGroups} from '../runtime/road-assembly-pack.mjs';
import {readCachedRoadAssembly,writeCachedRoadAssembly} from '../runtime/recipe-cache.mjs';
import {createRoadTransitions} from '../authoring/road-transitions.mjs';
import {Container3D,Material3D} from '@pixi/3d';
test('cached and fresh road assembly create identical GPU attributes and indices',async()=>{
 const p=new Float32Array([0,0,0,1,0,0,0,0,1]),n=new Float32Array([0,1,0,0,1,0,0,1,0]),uv=new Float32Array([0,0,1,0,0,1]),indices=new Uint32Array([0,1,2]),baseMaterial=new Material3D({baseColor:0xffffff});
 const make=()=>createRoadTransitions({region:'test',json:async()=>({joins:[],skipped:[],method:'test'}),geo:g=>g,materials:{},mat:m=>m,weatherMaterial:m=>m});
 const fresh=await make(),cached=await make(),a=new Container3D(),b=new Container3D(),input={chunk:{material:'road'},p,n,uv,indices};
 await fresh.addChunk({...input,root:a,baseMaterial});
 const prepared=fresh.prepareChunk(input),snapshot=unpackRoadAssembly(packRoadAssembly({version:1,chunks:[{sourceTriangles:1,transitionTriangles:prepared.transitionTriangles,groups:snapshotRoadGroups(prepared.groups)}]})).chunks[0];
 await cached.addPrepared({...snapshot,groups:new Map(snapshot.groups),root:b,baseMaterial});
 const ga=a.children[0].geometry,gb=b.children[0].geometry;assert.deepEqual(gb.indexBuffer.data,ga.indexBuffer.data);assert.equal(b.children[0].position.y,a.children[0].position.y);
 for(const name of Object.keys(ga.attributes))assert.deepEqual(gb.attributes[name].buffer.data,ga.attributes[name].buffer.data);
 assert.deepEqual(cached.summary,fresh.summary);a.destroy({children:true});b.destroy({children:true});ga.destroy(true);gb.destroy(true);baseMaterial.destroy();
});
test('finished road cache preserves rendered floats, indices, group order and shoulder data',()=>{
 const groups=new Map([['a|b',{join:{a:'a',b:'b'},p:[-0,1.2345,3],n:[0,1,0],uv:[.1,.2],extra:[3,4,5,6],native:[7,8,9,10],ix:[0,0,0]}],['base',{join:null,p:new Float32Array([0,0,0]),n:new Float32Array([0,1,0]),uv:new Float32Array(2),ix:new Uint32Array([0,0,0])}]]);
 const value={version:1,chunks:[{material:'a',sourceTriangles:2,transitionTriangles:1,groups:snapshotRoadGroups(groups),shoulder:{p:new Float32Array([1,2,3]),ix:new Uint32Array([0,0,0])}}]};
 assert.deepEqual(unpackRoadAssembly(packRoadAssembly(value)),value);assert.throws(()=>unpackRoadAssembly(new ArrayBuffer(4)));assert.throws(()=>unpackRoadAssembly(packRoadAssembly(value).slice(0,-4)));
});
test('road cache uses source identity, checks integrity, and shares the derived storage budget',async()=>{
 const storage=memoryWorldCaches(),entries=storage.rows('foxhole-world-recipes-v1'),cachesApi=storage.api,metrics={},options={cachesApi,metrics,budget:64},base='https://test.invalid/world/',a='a'.repeat(64),b='b'.repeat(64),bytes=new Uint8Array([1,2,3]).buffer;
 await writeCachedRoadAssembly(base,a,bytes,options);assert.deepEqual(await readCachedRoadAssembly(base,a,options),bytes);assert.equal(metrics.roadAssemblyCacheHits,1);
 assert.equal(await readCachedRoadAssembly(base,b,options),null);
 const key=[...entries.keys()][0],good=entries.get(key);entries.set(key,new Response(await good.arrayBuffer(),{headers:{'X-Foxhole-Assembly-Hash':'0'.repeat(64)}}));assert.equal(await readCachedRoadAssembly(base,a,options),null);
 await writeCachedRoadAssembly(base,a,bytes,options);await writeCachedRoadAssembly(base,b,new Uint8Array(80).buffer,options);assert.ok([...entries.values()].reduce((n,r)=>n+Number(r.headers.get('X-Foxhole-Recipe-Bytes')),0)<=64);
});
