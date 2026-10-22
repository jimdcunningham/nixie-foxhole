import {Texture} from 'pixi.js';
import {createDefaultGraph3D,RenderPassBit,DEPTH_VIEW_PLACEHOLDER} from '@pixi/3d';
// Pinned beta.2 attaches blended-refraction depth read-only. Native Water2
// outputs alpha 1 after compositing transmission, so it can publish its surface
// depth for later AO. Other refractive materials retain their depthMask=false.
const prepared=new WeakSet();
export function prepareWaterSurfaceDepth(view){
 if(!view||prepared.has(view))return;prepared.add(view);
 const build=view._buildGraph;
 view._buildGraph=function(renderer,options){
  const graph=build?build.call(this,renderer,options):createDefaultGraph3D(renderer,options).graph;
  for(const entry of graph._passes)if(entry.pass.bit===RenderPassBit.BLENDED_REFRACTION){
   for(const access of entry.record.accesses)if(access.mode==='read_attachment')access.mode='write_attachment';
   // Drop sampled copies before the pool can recycle them as attachments.
   const pass=entry.pass,render=pass.render;pass.render=function(session){try{return render.call(this,session);}finally{session.globalBindGroup.setResource(DEPTH_VIEW_PLACEHOLDER,this.pipe.globalSlots.opaqueDepth);session.globalBindGroup.setResource(Texture.EMPTY.source,this.pipe.globalSlots.opaqueColor);}};
  }
  graph.compile();return graph;
 };
 if(view._passesInitialized)view.passes=[...view.passes];
}
