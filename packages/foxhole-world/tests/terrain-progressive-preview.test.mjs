import test from 'node:test';import assert from 'node:assert/strict';
import {BufferImageSource} from 'pixi.js';import {LiveTerrainPass} from '../authoring/live-terrain.mjs';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function setup({tier=true,malformed=false,previewFail=false,fullFail=false}={}){
 const pass=new LiveTerrainPass(),gate=defer(),previewShown=defer(),fullStarted=defer(),controller=new AbortController(),geometry={id:'native'},calls=[],previewSources=[];let releases=0;
 const ref={path:'content/raw/'+ 'b'.repeat(64)+'/asset.webp',hash:'b'.repeat(64),decodedHash:'b'.repeat(64)},variant={width:128,height:128,pixelHash:malformed?'bad':'a'.repeat(64),resource:ref};
 const entry={size:256,slices:[{resource:{decodedHash:'c'.repeat(64)},...(tier?{tiers:{128:variant}}:{})}]};
 const meta={region:'test',buckets:[{size:256,count:1}],weights:{width:2,height:2,minX:0,maxZ:2},layers:[{}],noise:{width:1,height:1},snowMaterial:{width:1,height:1}};
 const make=(width,height,format='rgba8unorm')=>new BufferImageSource({resource:new Uint8Array(width*height*(format==='r8unorm'?1:4)),width,height,format,arrayLayerCount:1,viewDimension:'2d-array',alphaMode:'no-premultiply-alpha'});
 const pool={async acquire(descriptors,size){calls.push('preview');assert.equal(size,128);assert.equal(descriptors.length,3);if(previewFail)throw Error('preview unavailable');previewSources.push(make(128,128),make(128,128),make(2,2,'r8unorm'));return{cap:128,sources:previewSources,release(){releases++;for(const s of previewSources)if(!s.destroyed)s.destroy();}};}};
 const json=async()=>meta,zipped=async id=>{calls.push(id);if(id.includes('albedo-0')){fullStarted.resolve();await gate.promise;if(fullFail)throw Error('full source unavailable');controller.signal.throwIfAborted();}if(id.includes('weights'))return new Uint8Array(4).buffer;if(id.includes('noise')||id.includes('snowMaterial'))return new Uint8Array(4).buffer;return new Uint8Array(256*256*4).buffer;};
 const options={surface:'native',json,zipped,status(){},prepareTerrain:async()=>{},signal:controller.signal};
 const configuration={terrainDescriptor:(_id,kind)=>({kind,entry}),texturePool:pool,onPreview:()=>previewShown.resolve()};
 return{pass,gate,previewShown,fullStarted,controller,geometry,calls,previewSources,options,configuration,get releases(){return releases;}};
}
test('full-quality terrain stays pending while the preview is active, then swaps exactly once',async()=>{
 const f=setup(),planning=f.pass.planning;f.pass.setPlanningOverlays({topo:true},null);f.pass.geometryLod={id:'before'};let settled=false;
 const load=f.pass.loadProgressive('test',f.geometry,f.options,f.configuration);void load.then(()=>{settled=true;},()=>{settled=true;});
 try{
  await f.previewShown.promise;await f.fullStarted.promise;const preview=f.pass.current;
  assert.equal(settled,false);assert.equal(preview.qualityCap,128);assert.equal(preview.geometry,f.geometry);assert.equal(f.pass.planning,planning);assert.equal(preview.uniforms.uniforms.terrainOverlayInfo,planning.info);assert.equal(planning.info[1],1);assert.equal(f.pass.textureContext,null,'full-quality mode has no adaptive updates');
  f.pass.geometryLod={id:'updated while loading'};
  f.gate.resolve();await load;const full=f.pass.current;assert.notEqual(full,preview);assert.equal(full.qualityCap,Infinity);assert.equal(full.geometry,f.geometry);assert.equal(full.sources[0].width,256);assert.equal(full.sources[1].width,256);assert.equal(full.sources[2].width,2,'final weights remain at native size');assert.equal(f.releases,1);assert.ok(f.previewSources.every(s=>s.destroyed));assert.equal(f.pass.planning,planning);assert.equal(full.uniforms.uniforms.terrainOverlayInfo,planning.info);assert.equal(planning.info[1],1);assert.equal(f.pass.geometryLod.id,'updated while loading');
 }finally{f.gate.resolve();await load.catch(()=>{});f.pass.destroy();}
});
test('missing or malformed tier bypasses the preview and loads originals',async()=>{
 for(const settings of [{tier:false},{malformed:true}]){const f=setup(settings),load=f.pass.loadProgressive('test',f.geometry,f.options,f.configuration);
  try{await f.fullStarted.promise;assert.ok(!f.calls.includes('preview'));f.gate.resolve();await load;assert.equal(f.pass.current.qualityCap,Infinity);assert.equal(f.releases,0);}finally{f.gate.resolve();await load.catch(()=>{});f.pass.destroy();}}
});
test('preview failure falls back to the original full-quality path',async()=>{
 const f=setup({previewFail:true}),load=f.pass.loadProgressive('test',f.geometry,f.options,f.configuration);
 try{await f.fullStarted.promise;assert.ok(f.calls.includes('preview'));assert.equal(f.pass.current,null);f.gate.resolve();await load;assert.equal(f.pass.current.qualityCap,Infinity);}finally{f.gate.resolve();await load.catch(()=>{});f.pass.destroy();}
});
test('abort and full-quality failure dispose the published preview',async()=>{
 for(const failure of [false,true]){const f=setup({fullFail:failure}),load=f.pass.loadProgressive('test',f.geometry,f.options,f.configuration);await f.previewShown.promise;await f.fullStarted.promise;
  if(!failure)f.controller.abort();f.gate.resolve();await assert.rejects(load,failure?/full source unavailable/:{name:'AbortError'});assert.equal(f.pass.current,null);assert.equal(f.releases,1);assert.ok(f.previewSources.every(s=>s.destroyed));f.pass.destroy();}
});
test('a late full-quality result never replaces a newer terrain generation',async()=>{
 const f=setup(),load=f.pass.loadProgressive('test',f.geometry,f.options,f.configuration);await f.previewShown.promise;await f.fullStarted.promise;
 await f.pass.load('test',{id:'new'}, {surface:'plain',status(){},texture:async()=>{throw Error('not used');}});f.gate.resolve();await assert.rejects(load,{name:'AbortError'});assert.equal(f.pass.current.surface,'plain');assert.equal(f.pass.current.geometry.id,'new');assert.equal(f.releases,1);f.pass.destroy();
});
