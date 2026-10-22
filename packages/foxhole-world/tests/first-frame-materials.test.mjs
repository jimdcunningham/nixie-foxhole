import test from 'node:test';
import assert from 'node:assert/strict';
import {MeshPassCache,RenderPassBit} from '@pixi/3d';
import {SystemRunner} from 'pixi.js';
import {prepareFirstFrameMaterials,prepareRegionEnvironment,renderedModelGeometries} from '../runtime/first-frame-materials.mjs';
function fixture(){
 let calls=0;const hooks=new Set(),shader={},state={},original=function(mesh){calls++;mesh._passCache[RenderPassBit.OPAQUE]=new MeshPassCache(shader,state,'triangle-list');return shader;};
 const renderer={gpu:{},material3d:{ensureMaterial:original},runners:{postrender:{add:h=>hooks.add(h),remove:h=>hooks.delete(h)}}},geometry={},material={_passBit:RenderPassBit.OPAQUE,_descriptorDirtyId:1},view={shadowFilter:'pcf'},mesh=(g=geometry,m=material)=>({geometry:g,material:m,billboardMode:'none',receiveShadow:true,_passCache:[]});
 return {renderer,geometry,material,view,mesh,hooks,original,calls:()=>calls};
}
test('first-frame reuse preserves separate mutable instance caches and all shader variants',async()=>{
 const f=fixture(),done=prepareFirstFrameMaterials(f.renderer,[f.geometry]),ensure=m=>f.renderer.material3d.ensureMaterial(m,f.view),a=f.mesh(),b=f.mesh();
 assert.equal(ensure(a),ensure(b));assert.equal(f.calls(),1);assert.notEqual(a._passCache[2],b._passCache[2]);
 a._passCache[2].batchKey=123;assert.notEqual(a._passCache[2].batchKey,b._passCache[2].batchKey);
 f.view.shadowFilter='vsm';ensure(f.mesh());assert.equal(f.calls(),2);
 f.material._descriptorDirtyId++;ensure(f.mesh());assert.equal(f.calls(),3);
 const noShadow=f.mesh();noShadow.receiveShadow=false;ensure(noShadow);assert.equal(f.calls(),4);
 ensure(f.mesh({}));assert.equal(f.calls(),5); // A geometry outside this region never reuses work.
 for(const h of [...f.hooks])h.postrender();await Promise.resolve();assert.equal(f.renderer.material3d.ensureMaterial,f.original);assert.equal(f.hooks.size,0);done();
});
test('retirement, replacement and preparation errors restore the original renderer',()=>{
 const f=fixture(),first=prepareFirstFrameMaterials(f.renderer,[f.geometry]),second=prepareFirstFrameMaterials(f.renderer,[f.geometry]);
 first();assert.notEqual(f.renderer.material3d.ensureMaterial,f.original);second();assert.equal(f.renderer.material3d.ensureMaterial,f.original);
 const fail=()=>{throw Error('shader failure');};f.renderer.material3d.ensureMaterial=fail;
 prepareFirstFrameMaterials(f.renderer,[f.geometry]);assert.throws(()=>f.renderer.material3d.ensureMaterial(f.mesh(),f.view),/shader failure/);assert.equal(f.renderer.material3d.ensureMaterial,fail);assert.equal(f.hooks.size,0);
});
test('sky preparation keeps the native sampling settings and cancels stale work',async()=>{
 const hooks=new Set(),pipe={_iblEnvironmentMap:{}},renderer={gpu:{},renderPipes:{view3d:pipe},runners:{renderStart:{add:h=>hooks.add(h),remove:h=>hooks.delete(h)}}},environment={source:{uid:123}},calls=[];
 const options={brdf:o=>(calls.push(['brdf',o.size]),{}),cube:o=>(calls.push(['cube',o.size,o.sampleCount]),{})};
 prepareRegionEnvironment(renderer,environment,options);assert.equal(calls.length,0);for(const h of [...hooks])h.renderStart();await Promise.resolve();assert.deepEqual(calls,[['brdf',512],['cube',256,1024]]);assert.equal(hooks.size,0);
 prepareRegionEnvironment(renderer,environment,options);for(const h of [...hooks])h.renderStart();await Promise.resolve();assert.equal(calls.length,2);
 const controller=new AbortController();prepareRegionEnvironment(renderer,{source:{uid:456}},{...options,signal:controller.signal});controller.abort();assert.equal(hooks.size,0);assert.equal(pipe._iblEnvironmentMap[456],undefined);
});

// SystemRunner iterates its live array with a cached length. A Set/copy fixture
// cannot reproduce a hook removing itself before a later renderer listener.
for(const kind of ['postrender','renderStart'])test(kind+' preparation leaves the live runner intact until dispatch completes',async()=>{
 const runner=new SystemRunner(kind),f=fixture(),renderer=f.renderer;
 renderer.runners[kind]=runner;renderer.renderPipes={view3d:{_iblEnvironmentMap:{}}};
 let after=0;const tail={[kind](){after++;}};
 const release=kind==='postrender'?prepareFirstFrameMaterials(renderer,[f.geometry]):prepareRegionEnvironment(renderer,{source:{uid:42}},{brdf:()=>({}),cube:()=>({})});
 runner.add(tail);
 assert.doesNotThrow(()=>runner.emit(),'one-shot preparation must not splice an emitting SystemRunner');
 assert.equal(after,1,'later frame listeners still run');
 if(kind==='postrender')assert.equal(renderer.material3d.ensureMaterial,f.original,'material override restores synchronously');
 await Promise.resolve();assert.deepEqual(runner.items,[tail],'one-shot hook is removed after dispatch');
 release();runner.emit();assert.equal(after,2);runner.destroy();
});

test('publications in one frame share preparation across equivalent static layouts',async()=>{
 const f=fixture(),ga={attributeKey:'position:float32x3'},gb={attributeKey:'position:float32x3'},gc={attributeKey:'position:float32x3+normal:float32x3'};
 const a=prepareFirstFrameMaterials(f.renderer,[ga]),b=prepareFirstFrameMaterials(f.renderer,[gb,gc]);
 f.renderer.material3d.ensureMaterial(f.mesh(ga),f.view);f.renderer.material3d.ensureMaterial(f.mesh(gb),f.view);assert.equal(f.calls(),1);
 f.renderer.material3d.ensureMaterial(f.mesh(gc),f.view);assert.equal(f.calls(),2,'different shader layouts retain separate compilation');
 a();assert.notEqual(f.renderer.material3d.ensureMaterial,f.original);b();assert.equal(f.renderer.material3d.ensureMaterial,f.original);
});

test('preparation scopes use bound geometry and repeated region ownership is cancellable',()=>{
 const f=fixture(),source={},actual={attributeKey:'reflected-layout'},root={children:[{items:[{geometry:actual}],children:[]}]},scope=renderedModelGeometries(root);
 assert.equal(scope.has(source),false);assert.equal(scope.has(actual),true);
 const first=prepareFirstFrameMaterials(f.renderer,scope,root),second=prepareFirstFrameMaterials(f.renderer,scope,root);
 assert.equal(first,second);f.renderer.material3d.ensureMaterial(f.mesh(actual),f.view);f.renderer.material3d.ensureMaterial(f.mesh(actual),f.view);assert.equal(f.calls(),1);
 second();assert.equal(f.renderer.material3d.ensureMaterial,f.original);assert.equal(f.hooks.size,0);
});
test('equal attribute layouts preserve topology and dynamic exclusions',()=>{
 const f=fixture(),a={attributeKey:'same',topology:'triangle-list'},b={attributeKey:'same',topology:'triangle-strip'},dynamic={attributeKey:'same',topology:'triangle-list',dynamic:true};
 const release=prepareFirstFrameMaterials(f.renderer,[a,b,dynamic]);for(const g of [a,b,dynamic,dynamic])f.renderer.material3d.ensureMaterial(f.mesh(g),f.view);
 assert.equal(f.calls(),4);release();
});
