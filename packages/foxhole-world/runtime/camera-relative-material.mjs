import {worldShadowBit,shadowAppearanceId} from '../authoring/shadow-appearance.mjs';
import {ShaderDescriptor} from '@pixi/3d';
import {cameraRelativeClipPosition} from './camera-relative-position.mjs';
const prepared=new WeakSet();
const projectionBit={name:'foxholeCameraRelativeProjection',gpu:{vertex:{end:'clipPosition = '+cameraRelativeClipPosition('worldPosition.xyz',true)+';'}},gl:{vertex:{end:'gl_Position = '+cameraRelativeClipPosition('worldPosition.xyz',false)+';'}}};

// Imported static model materials bypass the native terrain/material factory.
// Extend only their primary draw descriptor: shadow cameras keep their own path.
export function prepareCameraRelativeMaterial(material){
 if(prepared.has(material))return;prepared.add(material);
 const original=material.getPrimaryDescriptor,variants=new WeakMap();
 material.getPrimaryDescriptor=function(view){
  const source=original.call(this,view);
  const id=shadowAppearanceId(view);let cache=variants.get(source);if(!cache)variants.set(source,cache=new Map());let descriptor=cache.get(id);if(descriptor)return descriptor;
  const projected=source.template||source.bitsGpu.some(bit=>bit.name==='foxholeNativeFrameEnd:material'||bit===projectionBit)||source.bitsGl.some(bit=>bit.name==='foxholeNativeFrameEnd:material'||bit===projectionBit);
  if(projected&&[...source.bitsGpu,...source.bitsGl].every(bit=>worldShadowBit(bit,view)===bit)){cache.set(id,source);return source;}
  const adapt=bits=>[...(projected?[]:[projectionBit]),...bits.map(bit=>worldShadowBit(bit,view))];
  descriptor=new ShaderDescriptor({bitsGpu:adapt(source.bitsGpu),bitsGl:adapt(source.bitsGl),template:source.template,overrides:source.overrides,includeCamera:source.includeCamera,includeGlobal:source.includeGlobal});cache.set(id,descriptor);
  return descriptor;
 };
}
