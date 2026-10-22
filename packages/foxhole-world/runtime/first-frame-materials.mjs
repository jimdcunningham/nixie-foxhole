import {MeshPassCache,RenderPassBit,generateBrdfLut,generateIblSpecialCubemap} from '@pixi/3d';
const active=new WeakMap();

/** Use the pinned renderer's identical IBL settings, on its next open encoder.
 * This moves sky filtering ahead of model assembly rather than changing quality.
 */
export function prepareRegionEnvironment(renderer,environment,{signal,brdf=generateBrdfLut,cube=generateIblSpecialCubemap}={}){
 const pipe=renderer?.gpu&&renderer.renderPipes?.view3d,runner=renderer?.runners?.renderStart;
 if(!pipe?._iblEnvironmentMap||!runner||signal?.aborted)return()=>{};
 let done=false;const hook={renderStart(){cancel(true);if(signal?.aborted)return;
  pipe._brdfLutTexture ||= brdf({renderer,size:512});
  const id=environment.source.uid;
  pipe._iblEnvironmentMap[id] ||= cube({renderer,sourceTexture:environment,size:256,sampleCount:1024});
 }};
 // SystemRunner dispatches its live array with a cached length; never splice
 // it from a callback. Cancellation between frames can still remove immediately.
 function cancel(defer=false){if(done)return;done=true;if(defer===true)queueMicrotask(()=>runner.remove(hook));else runner.remove(hook);signal?.removeEventListener('abort',cancel);}
 runner.add(hook);signal?.addEventListener('abort',cancel,{once:true});return cancel;
}

/** Collect the actual reflected geometry bound to arriving batches. */
export function renderedModelGeometries(node){
 const result=new Set();function visit(n){if(n.geometry)result.add(n.geometry);for(const item of n.items||[])if(item.geometry)result.add(item.geometry);for(const child of n.children||[])visit(child);}visit(node);return result;
}

/** Coalesce publications until this frame completes. Each slot keeps a separate
 * mutable pass cache; only identical static shader layouts/materials reuse work.
 */
export function prepareFirstFrameMaterials(renderer,geometries,owner=Symbol()){
 const system=renderer?.gpu&&renderer.material3d,runner=renderer?.runners?.postrender;
 if(!system||!runner)return()=>{};
 const current=active.get(renderer);if(current)return current.extend(geometries,owner);
 const scope=new WeakSet(),memo=new WeakMap(),owners=new Map(),original=system.ensureMaterial;let restored=false;
 function ensure(mesh,view){
  try{
   const g=mesh.geometry,m=mesh.material;
   if(!scope.has(g)||g.dynamic||g.morphTargetCount||mesh.skeleton||mesh.billboardMode!=='none')return original.call(this,mesh,view);
   let layouts=memo.get(m);if(!layouts)memo.set(m,layouts=new Map());
   const key=g.attributeKey||g,hit=layouts.get(key),bit=m._passBit&RenderPassBit.MATERIAL_PASS_MASK;
   if(hit&&hit.topology===g.topology&&hit.view===view&&hit.bit===bit&&hit.descriptorId===m._descriptorDirtyId&&hit.receiveShadow===mesh.receiveShadow&&hit.environment===view._envBit&&hit.fog===view._fogBit&&hit.tone===view._toneMappingBit&&hit.shadows===view._hasShadows&&hit.filter===view.shadowFilter){
    mesh._passCache[bit]=new MeshPassCache(hit.cache.shader,hit.cache.state,hit.cache.topology);return hit.cache.shader;
   }
   const shader=original.call(this,mesh,view),cache=mesh._passCache[bit];
   if(cache)layouts.set(key,{topology:g.topology,view,bit,descriptorId:m._descriptorDirtyId,receiveShadow:mesh.receiveShadow,environment:view._envBit,fog:view._fogBit,tone:view._toneMappingBit,shadows:view._hasShadows,filter:view.shadowFilter,cache});
   return shader;
  }catch(error){restore();throw error;}
 }
 const hook={postrender(){restore(true);}};
 function restore(defer=false){if(restored)return;restored=true;owners.clear();if(defer===true)queueMicrotask(()=>runner.remove(hook));else runner.remove(hook);if(system.ensureMaterial===ensure)system.ensureMaterial=original;if(active.get(renderer)===record)active.delete(renderer);}
 const record={extend(values,owner){for(const g of values)scope.add(g);if(!owners.has(owner)){const cancel=()=>{if(restored||owners.get(owner)!==cancel)return;owners.delete(owner);if(!owners.size)restore();};owners.set(owner,cancel);}return owners.get(owner);}};
 system.ensureMaterial=ensure;runner.add(hook);active.set(renderer,record);return record.extend(geometries,owner);
}
