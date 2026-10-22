import {Pass3D,ForwardRenderPass,RenderPassBit} from '@pixi/3d';

// Projected overlays belong to their opaque receivers. Composite them after
// terrain and shoulders, before airborne transparency. Separate mesh batches
// cannot be globally distance-sorted by the renderer's transparent pass.
export const SURFACE_DECAL_PASS='native-surface-decals';
export const FACTION_FLAG_SURFACE_PASS='native-faction-flag-surface';
// Draw faction cloth after projected wall overlays and before transparency.
// Keep its primary opaque shader and masked shadows, without an earlier colour draw.
export function factionFlagPassMask(material){material.enablePass(FACTION_FLAG_SURFACE_PASS);return (material._passBit&~RenderPassBit.MATERIAL_PASS_MASK)|RenderPassBit.SHADOW;}
export function surfaceDecalMaterial(material){
 material.disablePass('transparent');
 material.enablePass(SURFACE_DECAL_PASS);
 material.nativeSurfaceDecal=true;
 return material;
}
class SurfaceDecalDraw extends ForwardRenderPass {
 onRenderableDirty(item,batch){
  // Reuse the compiled primary material, including view lighting, weather and
  // tone mapping. A custom membership otherwise expects an override shader.
  item._passCache[this.bit]=item._passCache[item.material._passBit&RenderPassBit.MATERIAL_PASS_MASK];
  super.onRenderableDirty(item,batch);
 }
}
export class SurfaceDecalPass extends Pass3D {
 constructor(){super();this.stage='afterOpaque';}
 build(graph,{renderer}){graph.addPass(new SurfaceDecalDraw({renderer,name:SURFACE_DECAL_PASS,sort:'key'}));graph.addPass(new SurfaceDecalDraw({renderer,name:FACTION_FLAG_SURFACE_PASS,sort:'key'}));}
}
