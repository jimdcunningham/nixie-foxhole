// Native SmokeStacks uses ParticleAlpha, animated CloudShapes alpha and four
// spawn-time dynamic offsets. The cooked graph omits its arithmetic/panners;
// these bounded rates approximate that motion using the actual native mask.
export function nativeSmokeMaskBit(frame){
 const glPosition=frame?'vec3((vPosition.x-uSmokeFrame.x)/uSmokeFrame.z,vPosition.z/uSmokeFrame.z,(vPosition.y-uSmokeFrame.y)/uSmokeFrame.z)':'vPosition';
 const gl=['vec2 smokeUV=vUV*0.203125;',
 'vec4 smokeA=sampleSmokeClouds(fract(smokeUV+vSmokeFlow.xy));',
 'vec4 smokeB=sampleSmokeClouds(fract(smokeUV*1.37+vSmokeFlow.zw));',
 'alpha=clamp(alpha*smokeA.a*smokeB.a*material.uSmokeOpacity,0.0,1.0);',
 // Keep the authored RGB; low-luminance puffs must not accumulate into soot.
 'alpha*=mix(material.uSmokeDarkOpacity,1.0,smoothstep(0.2,0.75,dot(albedo,vec3(0.2126,0.7152,0.0722))));',
 'float outletHeight=dot('+glPosition+'-material.uSmokeOutlet.xyz,material.uSmokeUp.xyz);',
 'alpha*=mix(1.0,smoothstep(-0.015,0.06,outletHeight),material.uSmokeOutlet.w);'].join('\n');
 const gpuPosition=frame?'vec3<f32>((input.vPosition.x-material.uSmokeFrame.x)/material.uSmokeFrame.z,input.vPosition.z/material.uSmokeFrame.z,(input.vPosition.y-material.uSmokeFrame.y)/material.uSmokeFrame.z)':'input.vPosition';
 return {name:'nativeSmokeCloudMask_v1_'+(frame?'board':'native'),attributes:{aSmokeOffset:'float32x4'},interStage:{vSmokeFlow:'vec4<f32>'},textures:['smokeClouds'],bindings:{material:{uSmokeOpacity:'f32',uSmokeDarkOpacity:'f32',uSmokeOutlet:'vec4<f32>',uSmokeUp:'vec4<f32>',uSmokeFrame:'vec4<f32>'}},
 gpu:{vertex:{end:'output.vSmokeFlow=input.aSmokeOffset+material.uParticleTime*vec4<f32>(0.023,0.031,-0.017,0.027);'},fragment:{material:gl.replace('vec2 smokeUV=vUV','let smokeUV=input.vUV').replaceAll('vec4 smoke','let smoke').replaceAll('vec3(0.2126','vec3<f32>(0.2126').replaceAll('vSmokeFlow','input.vSmokeFlow').replaceAll('float outletHeight=','let outletHeight=').replace(glPosition,gpuPosition)}},
 gl:{vertex:{end:'vSmokeFlow=aSmokeOffset+material.uParticleTime*vec4(0.023,0.031,-0.017,0.027);'},fragment:{material:gl.replaceAll('uSmokeFrame','material.uSmokeFrame')}}};
}
