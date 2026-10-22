// beta.2's depth effect helpers assume perspective. Keep the AO kernel in
// actual view-space metres when the map camera switches to orthographic.
export function projectionAwareSsao(fragment){
 const gpu=`
fn ssaoDepth(d:f32)->f32 { if(fx.uRange.z>0.5){return mix(fxh.uFxClip.x,fxh.uFxClip.y,d);} return linearDepth(d); }
fn ssaoPosition(uv:vec2<f32>)->vec3<f32> {if(fx.uRange.z>0.5){let ndc=uv*2.0-1.0;return vec3<f32>(ndc.x/fxh.uFxClip.z,ndc.y/fxh.uFxClip.w,-ssaoDepth(sampleDepth(uv)));}return viewPos(uv);}
`;
 const gl=`
float ssaoDepth(float d){if(uRange.z>0.5){return mix(uFxClip.x,uFxClip.y,d);}return linearDepth(d);}
vec3 ssaoPosition(vec2 uv){if(uRange.z>0.5){vec2 ndc=uv*2.0-1.0;return vec3(ndc.x/uFxClip.z,ndc.y/uFxClip.w,-ssaoDepth(sampleDepth(uv)));}return viewPos(uv);}
`;
 const gpuProjection='let projected=vec2<f32>(samplePos.x*fxh.uFxClip.z,samplePos.y*fxh.uFxClip.w);\n    let sUv=projected/select(-samplePos.z,1.0,fx.uRange.z>0.5)*0.5+0.5;';
 const glProjection='vec2 projected=vec2(samplePos.x*uFxClip.z,samplePos.y*uFxClip.w);\n    vec2 sUv=projected/(uRange.z>0.5?1.0:-samplePos.z)*0.5+0.5;';
 return{gpu:gpu+fragment.gpu.replaceAll('viewPos(','ssaoPosition(').replaceAll('linearDepth(','ssaoDepth(').replace('let sUv = vec2<f32>(samplePos.x * fxh.uFxClip.z, samplePos.y * fxh.uFxClip.w) / (-samplePos.z) * 0.5 + 0.5;',gpuProjection),gl:gl+fragment.gl.replaceAll('viewPos(','ssaoPosition(').replaceAll('linearDepth(','ssaoDepth(').replace('vec2 sUv = vec2(samplePos.x * uFxClip.z, samplePos.y * uFxClip.w) / (-samplePos.z) * 0.5 + 0.5;',glProjection)};
}
