import test from 'node:test';import assert from 'node:assert/strict';import {BufferImageSource} from 'pixi.js';import {LiveTerrainPass} from '../authoring/live-terrain.mjs';
const source=channels=>new BufferImageSource({resource:new Uint8Array(channels),width:1,height:1,arrayLayerCount:1,viewDimension:'2d-array',format:channels===1?'r8unorm':'rgba8unorm'});
async function fixture(){let next,prepare;const leases=[];const lease=cap=>{const value={cap,sources:[source(4),source(4),source(1)],release(){this.released=(this.released||0)+1;for(const s of this.sources)s.destroy();}};leases.push(value);return value;};const pool={stats:{},schedule:fn=>Promise.resolve().then(fn),acquire:async(_,cap)=>next?next(cap):lease(cap)},pass=new LiveTerrainPass(),geometry={};const meta={region:'fixture',buckets:[{start:0,size:1,count:1}],weights:{width:1,height:1,minX:0,maxZ:0},layers:[{}],noise:{width:1,height:1},snowMaterial:{width:1,height:1}};await pass.load('fixture',geometry,{json:async()=>meta,zipped:async()=>new Uint8Array(4).buffer,status(){},terrainDescriptor:id=>({id}),texturePool:pool,prepareTerrain:source=>prepare?.(source)});return {pass,lease,leases,geometry,setNext:fn=>next=fn,setPrepare:fn=>prepare=fn};}
test('quality swaps retain geometry/uniforms and retire old leases after complete replacement',async()=>{const f=await fixture();try{const old=f.pass.current;await f.pass.setTextureSize(512);assert.equal(f.pass.current.geometry,f.geometry);assert.equal(f.pass.current.uniforms,old.uniforms);assert.equal(f.pass.current.qualityCap,512);assert.equal(f.leases[0].released,1);}finally{f.pass.destroy();}assert.equal(f.leases[1].released,1);});
test('failed upgrades leave the currently rendered textures intact',async()=>{const f=await fixture();try{const old=f.pass.current;f.setNext(async()=>{throw Error('unavailable');});await assert.rejects(f.pass.setTextureSize(512),/unavailable/);assert.equal(f.pass.current,old);assert.equal(f.leases[0].released,undefined);}finally{f.pass.destroy();}});
test('a late quality result cannot restore a retired region',async()=>{const f=await fixture();let resolve;f.setNext(()=>new Promise(r=>resolve=r));const change=f.pass.setTextureSize(512);await new Promise(r=>setTimeout(r,0));f.pass.clear();const late=f.lease(512);resolve(late);await change;assert.equal(f.pass.current,null);assert.equal(late.released,1);f.pass.destroy();});

 test('retirement during auxiliary texture loading releases the initial lease',async()=>{
 const pass=new LiveTerrainPass(),sources=[source(4),source(4),source(1)];let released=0,resolveNoise;const noise=new Promise(r=>resolveNoise=r);
 const meta={buckets:[{size:1,count:1}],weights:{width:1,height:1},layers:[{}],noise:{width:1,height:1},snowMaterial:{width:1,height:1}};
 const load=pass.load('fixture',{}, {json:async()=>meta,status(){},terrainDescriptor:id=>({id}),texturePool:{acquire:async()=>({cap:128,sources,release(){released++;for(const s of sources)s.destroy();}})},zipped:async id=>id.includes('noise')?noise:new Uint8Array(4).buffer});
 await new Promise(r=>setTimeout(r,0));pass.clear();resolveNoise(new Uint8Array(4).buffer);await assert.rejects(load,{name:'AbortError'});assert.equal(pass.current,null);assert.equal(released,1);
 });

test('asynchronous texture preparation keeps the old complete set visible until all sources are ready',async()=>{
 const f=await fixture();let resolve;const gate=new Promise(r=>resolve=r);f.setPrepare(()=>gate);
 try{const old=f.pass.current,change=f.pass.setTextureSize(512);await new Promise(r=>setTimeout(r,0));assert.equal(f.pass.current,old);assert.equal(f.leases[0].released,undefined);resolve();await change;assert.equal(f.pass.current.qualityCap,512);assert.equal(f.leases[0].released,1);}finally{resolve();f.pass.destroy();}
});
test('retirement during asynchronous GPU preparation cannot resurrect a region',async()=>{
 const f=await fixture();let resolve;const gate=new Promise(r=>resolve=r);f.setPrepare(()=>gate);
 const change=f.pass.setTextureSize(512);await new Promise(r=>setTimeout(r,0));f.pass.clear();resolve();await change;assert.equal(f.pass.current,null);assert.equal(f.leases[1].released,1);f.pass.destroy();
});
test('a superseded requested texture size cannot publish after asynchronous preparation',async()=>{
 const f=await fixture();let resolve;const gate=new Promise(r=>resolve=r);f.setPrepare(()=>gate);
 try{const first=f.pass.setTextureSize(512);await new Promise(r=>setTimeout(r,0));const second=f.pass.setTextureSize(256);resolve();await Promise.all([first,second]);assert.equal(f.pass.current.qualityCap,256);assert.equal(f.leases[1].released,1);}finally{resolve();f.pass.destroy();}
});
test('GPU preparation failures retain the complete old set and release the failed replacement',async()=>{
 const f=await fixture();try{const old=f.pass.current;f.setPrepare(async()=>{throw Error('upload failed');});await assert.rejects(f.pass.setTextureSize(512),/upload failed/);assert.equal(f.pass.current,old);assert.equal(f.leases[1].released,1);assert.equal(f.leases[0].released,undefined);}finally{f.pass.destroy();}
});
