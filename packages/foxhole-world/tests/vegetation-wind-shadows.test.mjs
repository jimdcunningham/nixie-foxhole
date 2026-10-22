import test from 'node:test';
import assert from 'node:assert/strict';
import {BindGroup,Texture} from 'pixi.js';
import {Material3D,ShaderDescriptor,RenderPassBit} from '@pixi/3d';
import {createVegetationWind} from '../authoring/vegetation-wind.mjs';
import {prepareVegetationWindShadows} from '../runtime/vegetation-wind-shadows.mjs';

function fixture(gpu){
 const seen=[],calls=[],group=new BindGroup(),store={texture:{source:Texture.WHITE.source}};
 const descriptor={state:{depthTest:true},shaderDescriptor:new ShaderDescriptor({includeGlobal:false,bitsGpu:[],bitsGl:[],template:gpu?{gpu:'let worldPosition = batchWorldMatrix * renderable.transform * position;\n let clipPosition = camera.uViewProjectionMatrix * worldPosition;'}:{gl:{vertex:'vec4 worldPosition = modelMatrix * position;\n gl_Position = uViewProjectionMatrix * worldPosition;'}}})};
 const makePass=()=>({bit:RenderPassBit.SHADOW,descriptor,pipe:{materialStoreBuffer:store},...(gpu?{_globalBindGroup:group}:{_shadowBindGroup:group}),
  onRenderableDirty(item){seen.push(this.descriptor);if(item.fail)throw Error('compile');},
  prepare(){calls.push('prepare');},render(){calls.push('render');},unload(){calls.push('unload');}});
 const view={passByBit:{[RenderPassBit.SHADOW]:makePass()},_meshBatches:[],_ensureInitialized(){calls.push('initialize');}};
 return {view,group,store,seen,calls,makePass};
}
function material(frame){const source=new Material3D(),owner=createVegetationWind({frame}),lease=owner.acquire({category:'trees',name:'PineTree'},[{material:source,materialName:'Leaves',bounds:{min:[0,0,0],max:[1,12,1]}}]);return {source,owner,lease,material:lease.parts[0].material,destroy(){lease.release();owner.destroy();source.destroy();}};}

for(const gpu of [false,true])test((gpu?'GPU':'GL')+' shadow draws borrow current material rows, retain rigid casters, and preserve light projection',()=>{
 const f=fixture(gpu),a=material(),b=material(),host=material({scale:32}),rigid=new Material3D();
 try{const unrelated=fixture(gpu),original=unrelated.view.passByBit[1].descriptor;prepareVegetationWindShadows(f.view);const pass=f.view.passByBit[1],base=pass.descriptor;
  pass.onRenderableDirty({material:a.material});const animated=f.seen.at(-1),bit=(gpu?animated.shaderDescriptor.bitsGpu:animated.shaderDescriptor.bitsGl).at(-1),shader=animated.shaderDescriptor.template;
  assert.ok(bit.name.startsWith('foxholeWindShadow:'));assert.match(gpu?shader.gpu:shader.gl.vertex,/AfterTransform|afterTransform/);assert.match(gpu?shader.gpu:shader.gl.vertex,/uViewProjectionMatrix \* worldPosition/);assert.doesNotMatch(bit.gpu.vertex.afterTransform,/worldNormal|camera\./);assert.notEqual(a.material.data._f32,b.material.data._f32);
  pass.onRenderableDirty({material:b.material});assert.equal(f.seen.at(-1),animated,'equal layouts reuse a depth shader, regardless of material identity');
  pass.onRenderableDirty({material:host.material});assert.notEqual(f.seen.at(-1),animated,'metres and board pixels use their own scale');
  pass.onRenderableDirty({material:rigid});assert.equal(f.seen.at(-1),base);assert.equal(pass.descriptor,base);assert.equal(unrelated.view.passByBit[1].descriptor,original);
  assert.throws(()=>pass.onRenderableDirty({material:a.material,fail:true}),/compile/);assert.equal(pass.descriptor,base,'failed compilation restores the shared pass descriptor');
  pass[gpu?'prepare':'render']({});assert.equal(groupResource(f.group,gpu?0:6),Texture.WHITE.source);
  f.store.texture.source=Texture.EMPTY.source;pass[gpu?'prepare':'render']({});assert.equal(groupResource(f.group,gpu?0:6),Texture.EMPTY.source,'a replaced material store is rebound');
  if(gpu){const resource={uid:991,_resourceType:'bufferResource',_resourceId:991};f.group.setResource(resource,0);assert.equal(groupResource(f.group,1),resource);}
  pass.unload();assert.ok(f.calls.includes('unload'));
 }finally{a.destroy();b.destroy();host.destroy();rigid.destroy();f.group.destroy();}
});
function groupResource(group,index){return group.resources[index];}

test('view adapter is idempotent and prepares replacement shadow passes after graph rebuild',()=>{
 const f=fixture(true),existing=f.view.passByBit[1];prepareVegetationWindShadows(f.view);const initialize=f.view._ensureInitialized,dirty=existing.onRenderableDirty;
 prepareVegetationWindShadows(f.view);assert.equal(f.view._ensureInitialized,initialize);assert.equal(existing.onRenderableDirty,dirty);
 const a=material();try{existing.onRenderableDirty({material:a.material});const firstTemplate=f.seen.at(-1).shaderDescriptor.template;
 const replacement=f.makePass();f.view.passByBit[1]=replacement;f.view._ensureInitialized();assert.ok(replacement.descriptor.shaderDescriptor.bitsGpu.some(bit=>bit.name==='foxholeWindShadowStore'));assert.equal(f.calls.filter(c=>c==='initialize').length,1);
 replacement.onRenderableDirty({material:a.material});assert.equal(f.seen.at(-1).shaderDescriptor.template,firstTemplate,'graph rebuilds preserve the compiled template cache identity');
 }finally{a.destroy();f.group.destroy();}
});
