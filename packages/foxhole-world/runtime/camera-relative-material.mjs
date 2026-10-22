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
  let descriptor=variants.get(source);if(descriptor)return descriptor;
  if(source.template||source.bitsGpu.some(bit=>bit.name==='foxholeNativeFrameEnd:material'||bit===projectionBit)||source.bitsGl.some(bit=>bit.name==='foxholeNativeFrameEnd:material'||bit===projectionBit)){variants.set(source,source);return source;}
  if(!descriptor){descriptor=new ShaderDescriptor({bitsGpu:[projectionBit,...source.bitsGpu],bitsGl:[projectionBit,...source.bitsGl],template:source.template,overrides:source.overrides,includeCamera:source.includeCamera,includeGlobal:source.includeGlobal});variants.set(source,descriptor);}
  return descriptor;
 };
}
