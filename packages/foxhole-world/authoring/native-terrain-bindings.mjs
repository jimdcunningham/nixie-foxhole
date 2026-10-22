import {BindGroup} from 'pixi.js';
import {globalBitGpu,cameraBit} from '@pixi/3d';

// Landscape passes shade native vertices directly. They do not read the mesh
// stores or opaque-frame copies that ordinary model materials need. Keeping
// those unused textures in the layout exhausted WebGPU's 16-texture limit.
const unused=new Set(['uOpaqueDepthTexture','uOpaqueColorTexture','uMaterialStorage',
 'uRenderableStorage','uRenderableInstanceStorage','uBonePitStorage','uMorphStorage','uGeometryStorage']);
const landscapeGlobal={...globalBitGpu,name:'nativeLandscapeGlobal',bindings:{global:
 Object.fromEntries(Object.entries(globalBitGpu.bindings.global).filter(([name])=>!unused.has(name)))}};

export function compileNativeTerrainShader(renderer,bits,template){
 return 'gl' in renderer?renderer.material3d.compilePassShader(bits,template)
  :renderer.material3d.compileIsolatedShader([landscapeGlobal,cameraBit,...bits],template);
}

export function nativeTerrainGlobalGroup(session,previous){
 if('gl' in session.renderer)return session.globalBindGroup;
 const group=previous??new BindGroup({});
 for(let binding=0;binding<7;binding++)group.setResource(session.globalBindGroup.getResource(binding),binding);
 return group;
}
