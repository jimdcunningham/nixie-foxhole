import {DEPTH_VIEW_PLACEHOLDER,EMPTY_BUFFER_RESOURCE,PostEffect,FullscreenPass} from '@pixi/3d';
import {SsaoEffect} from '@pixi/3d/extras';
import {projectionAwareSsao} from './ssao-projection.mjs';
// beta.2's SSAO leaves sceneDepth in the shared sampled-depth slot. On the next
// frame WebGPU rejects writing that same texture as an attachment. Restore the
// placeholder immediately after each effect draw, before the pool reuses depth.
export class SafeSsaoEffect extends SsaoEffect {
 build(graph,io){
  const addPass=graph.addPass;
  graph.addPass=function(pass){
   if(pass.name==='ssao:compute')pass._fragment=projectionAwareSsao(pass._fragment);
   if(pass.name==='ssao:merge'){
    // Finish in the existing AO merge instead of introducing a second presenter.
    // Keep the source's display-space daylight balance and film contrast local
    // to 3D pixels, so map icons and shell colors remain unchanged.
    const finish=sceneColorFinish(true);
    pass._fragment={gpu:pass._fragment.gpu.replace('return vec4<f32>(base.rgb * sampleColor2(uv).rgb, base.a);',finish.gpu),gl:pass._fragment.gl.replace('return vec4(base.rgb * sampleColor2(uv).rgb, base.a);',finish.gl)};
   }
   protectFullscreenPass(pass);
   return addPass.call(this,pass);
  };
  try{super.build(graph,io);}finally{graph.addPass=addPass;}
 }
}

// The same finish runs with or without AO; toggling AO never changes daylight colour.
export function sceneColorFinish(occlusion){return{
 gpu:`var rgb=base.rgb${occlusion?'*sampleColor2(uv).rgb':''};
  let cyan=max(0.0,min(rgb.g,rgb.b)-rgb.r);
  rgb+=vec3<f32>(0.35,-0.10,-0.13)*cyan;
  rgb=(rgb*vec3<f32>(1.02,1.0,0.98)-vec3<f32>(0.5))*1.03+vec3<f32>(0.5);
  return vec4<f32>(max(rgb,vec3<f32>(0.0)),base.a);`,
 gl:`vec3 rgb=base.rgb${occlusion?'*sampleColor2(uv).rgb':''};
  float cyan=max(0.0,min(rgb.g,rgb.b)-rgb.r);
  rgb+=vec3(0.35,-0.10,-0.13)*cyan;
  rgb=(rgb*vec3(1.02,1.0,0.98)-vec3(0.5))*1.03+vec3(0.5);
  return vec4(max(rgb,vec3(0.0)),base.a);`
};}
function protectFullscreenPass(pass){
 const render=pass.render;
 pass.render=function(session){
  if(this.name==='ssao:compute'){this._uniforms.uniforms.uRange[2]=session.view3d.camera.mode==='orthographic'?1:0;this._uniforms.update();}
  // beta.2 globalBitGpu slots 10/11 are borrowed from the last model batch.
  // Fullscreen shaders don't read them, but WebGPU still validates all bound
  // resources. Retiring a region destroys those buffers before its next draw.
  if(!('gl' in session.renderer)){session.globalBindGroup.setResource(EMPTY_BUFFER_RESOURCE,10);session.globalBindGroup.setResource(EMPTY_BUFFER_RESOURCE,11);}
  try{return render.call(this,session);}finally{session.globalBindGroup.setResource(DEPTH_VIEW_PLACEHOLDER,this.pipe.globalSlots.opaqueDepth);}
 };
}
export class SceneColorFinishEffect extends PostEffect {
 build(graph,io){const finish=sceneColorFinish(false),pass=new FullscreenPass({renderer:io.renderer,label:'scene:color-finish',fragment:{gpu:'fn effect(uv:vec2<f32>)->vec4<f32>{let base=sampleColor(uv);'+finish.gpu+'}',gl:'vec4 effect(vec2 uv){vec4 base=sampleColor(uv);'+finish.gl+'}'},reads:{color:io.input},writes:io.output});protectFullscreenPass(pass);graph.addPass(pass);}
}
