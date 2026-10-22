import {RenderPassBit,ShaderDescriptor} from '@pixi/3d';
import {Texture} from 'pixi.js';
import {vegetationWindTransform} from '../authoring/vegetation-wind.mjs';

// Private adapter for the pinned Pixi depth pass. Borrow its existing material
// store, rather than updating geometry or duplicating per-instance wind data.
const views=new WeakSet(),passes=new WeakSet(),bits=new Map(),templates=new WeakMap();
const storeBit={name:'foxholeWindShadowStore',bindings:{global:{uFoliageMaterialStore:{type:'texture_2d<u32>',visibility:'vertex'}}}};
function windBit(material){
 const offsets=['foliageWind','foliageUp','foliageShape'].map(name=>{
  const value=material.data[name],offset=(value.byteOffset-material.data._f32.byteOffset)/16;
  if(!Number.isInteger(offset)||value.length!==4)throw Error('Unsupported foliage shadow material layout');return offset;
 }),scale=material.data.foliageScale,key=[...offsets,scale].join(':');
 let bit=bits.get(key);if(bit)return bit;
 const shape='foliageWind:vec4<f32>,foliageUp:vec4<f32>,foliageShape:vec4<f32>,foliageScale:f32';
 const gpuHeader='struct FoxholeShadowWind {'+shape+'}\nfn foxholeShadowTexel(t:u32)->vec4<f32>{let width=textureDimensions(uFoliageMaterialStore).x;return bitcast<vec4<f32>>(textureLoad(uFoliageMaterialStore,vec2<i32>(i32(t%width),i32(t/width)),0));}';
 const glHeader='struct FoxholeShadowWind {vec4 foliageWind;vec4 foliageUp;vec4 foliageShape;float foliageScale;};\nvec4 foxholeShadowTexel(int t){int width=textureSize(uFoliageMaterialStore,0).x;return uintBitsToFloat(texelFetch(uFoliageMaterialStore,ivec2(t%width,t/width),0));}';
 const read=gpu=>(gpu?'let material = ':'FoxholeShadowWind material = ')+'FoxholeShadowWind('+offsets.map(offset=>'foxholeShadowTexel('+(gpu?'renderable.materialIndex*16u+':'int(indexLanes.y)*16+')+offset+(gpu?'u':'')+')').join(',')+','+Number(scale).toFixed(8)+');\n';
 bit={name:'foxholeWindShadow:'+key,gpu:{vertex:{header:gpuHeader,afterTransform:read(true)+vegetationWindTransform(true,{normal:false,project:false})}},gl:{vertex:{header:glHeader,afterTransform:read(false)+vegetationWindTransform(false,{normal:false,project:false})}}};bits.set(key,bit);return bit;
}
function installPass(view,pass){
 if(!pass?.descriptor?.shaderDescriptor||passes.has(pass))return;passes.add(pass);
 const source=pass.descriptor.shaderDescriptor,base=new ShaderDescriptor({...source,bitsGpu:[...source.bitsGpu,storeBit],bitsGl:[...source.bitsGl,storeBit]});
 pass.descriptor={...pass.descriptor,shaderDescriptor:base};
 const variants=new Map(),dirty=pass.onRenderableDirty;
 pass.onRenderableDirty=function(item,batch){
  const material=item.material;if(!material.data?.foliageWind||material._passes[this.bit])return dirty.call(this,item,batch);
  const bit=windBit(material);let descriptor=variants.get(bit);
  if(!descriptor){let template=templates.get(base.template);
   if(!template){template={...base.template};
    if(template.gpu)template.gpu=template.gpu.replace('let worldPosition = batchWorldMatrix * renderable.transform * position;','let modelMatrix = batchWorldMatrix * renderable.transform;\n  var worldPosition = modelMatrix * position;\n  {{vertexAfterTransform}}');
    if(template.gl)template.gl={...template.gl,vertex:template.gl.vertex.replace('gl_Position = uViewProjectionMatrix * worldPosition;','{{afterTransform}}\n  gl_Position = uViewProjectionMatrix * worldPosition;')};
    templates.set(base.template,template);
   }
   descriptor={...pass.descriptor,shaderDescriptor:new ShaderDescriptor({...base,template,bitsGpu:[...base.bitsGpu,bit],bitsGl:[...base.bitsGl,bit]})};variants.set(bit,descriptor);
  }
  const previous=this.descriptor;this.descriptor=descriptor;try{return dirty.call(this,item,batch);}finally{this.descriptor=previous;}
 };
 // WGSL packs textures before storage buffers: the new texture is slot 0,
 // so forward the stock GPU pass's five store writes to slots 1..5. GLSL
 // appends the texture after its existing uniform/texture slots, at slot 6.
 const gpu=!!pass._globalBindGroup,slot=gpu?0:6,group=gpu?pass._globalBindGroup:pass._shadowBindGroup,setResource=group.setResource;
 if(gpu)group.setResource=function(resource,index){return setResource.call(this,resource,index+1);};
 const stage=gpu?'prepare':'render',render=pass[stage];
 pass[stage]=function(session){setResource.call(group,this.pipe.materialStoreBuffer.texture.source,slot);return render.call(this,session);};
 const unload=pass.unload;pass.unload=function(){setResource.call(group,Texture.EMPTY.source,slot);return unload.call(this);};
 for(const batch of view._meshBatches||[])for(const item of batch.items)if(item)item._passCache[RenderPassBit.SHADOW]=undefined;
 view._invalidateMaterialShaders?.();view._invalidateDrawCaches?.();
}
/** Scope the depth adapter to this View3D, including graph rebuilds and unloads. */
export function prepareVegetationWindShadows(view){
 if(!view?._ensureInitialized)return;
 if(!views.has(view)){views.add(view);const initialize=view._ensureInitialized;
  view._ensureInitialized=function(renderer){const result=initialize.call(this,renderer);installPass(this,this.passByBit?.[RenderPassBit.SHADOW]);return result;};
 }
 installPass(view,view.passByBit?.[RenderPassBit.SHADOW]);
}
