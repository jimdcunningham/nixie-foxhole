// Bounded perspective-correct screen traversal against the opaque scene.
// View-space metres keep the same reach and thickness in native and board frames.
// Background, underwater surfaces, off-screen rays and misses retain normal IBL.
const common = `
vec4 waterReflectionClip(vec3 p,float scale){return uProjectionMatrix*vec4(p*scale,1.0);}
vec2 waterReflectionUV(vec4 clip){return clip.xy/clip.w*.5+vec2(.5);}
vec3 waterReflectionViewPoint(vec3 probe,float d,float scale){
 // Solve the full projection along the pixel ray, including lens rotation/offset.
 vec4 a=uProjectionMatrix*vec4(probe*scale,0.0);
 vec4 b=uProjectionMatrix[3];
 if(abs(b.w)<.5){return probe*((b.z-d*b.w)/(d*a.w-a.z));}
 float z=(b.z-d*b.w)/(d*uProjectionMatrix[2][3]-uProjectionMatrix[2][2]);
 return vec3(probe.xy,z/scale);
}
vec3 waterReflectionViewDirection(vec3 p){
 if(abs(uProjectionMatrix[3][3])>.5){return normalize(vec3(uViewMatrix[0][2],uViewMatrix[1][2],uViewMatrix[2][2]));}
 return normalize(uCameraPosition-p);
}
vec4 waterTraceReflection(vec3 worldPosition,vec3 worldNormal,vec3 up,float roughness,float scale){
 vec3 eye=mat3(uViewMatrix)*(worldPosition-uCameraPosition)/scale;
 vec3 viewNormal=normalize(mat3(uViewMatrix)*worldNormal);
 vec3 incoming=normalize(eye);
 if(abs(uProjectionMatrix[3][3])>.5){incoming=vec3(0.0,0.0,-1.0);}
 vec3 ray=reflect(incoming,viewNormal);
 vec3 viewUp=normalize(mat3(uViewMatrix)*up);
 if(dot(ray,viewUp)<.015){return vec4(0.0);}
 vec3 start=eye+viewNormal*.06+ray*.15;
 float reach=80.0;
 if(ray.z>.001){reach=min(reach,max(0.0,(-.1-start.z)/ray.z));}
 if(reach<.3){return vec4(0.0);}
 vec3 finish=start+ray*reach;
 vec4 h0=waterReflectionClip(start,scale);
 vec4 h1=waterReflectionClip(finish,scale);
 if(h0.w<=.001||h1.w<=.001){return vec4(0.0);}
 float k0=1.0/h0.w;
 float k1=1.0/h1.w;
 vec2 uv0=waterReflectionUV(h0);
 vec2 uv1=waterReflectionUV(h1);
 vec2 pixels=waterReflectionDimensions()*uViewportUVScale;
 int steps=int(clamp(ceil(length((uv1-uv0)*pixels)/3.0),8.0,48.0));
 float previous=0.0;
 float previousDelta=-1.0;
 for(int i=1;i<=48;i++){
  if(i>steps){break;}
  float t=float(i)/float(steps);
  vec3 probe=mix(start*k0,finish*k1,t)/mix(k0,k1,t);
  vec2 uv=mix(uv0,uv1,t);
  if(any(lessThan(uv,vec2(.002)))||any(greaterThan(uv,vec2(.998)))){break;}
  float raw=waterReflectionDepth(uv);
  float delta=-probe.z+waterReflectionViewPoint(probe,raw,scale).z;
  if(raw<.99999&&delta>=0.0&&previousDelta<0.0){
   float low=previous;
   float high=t;
   for(int j=0;j<6;j++){
    float middle=(low+high)*.5;
    vec3 candidate=mix(start*k0,finish*k1,middle)/mix(k0,k1,middle);
    vec2 candidateUV=mix(uv0,uv1,middle);
    float d=waterReflectionDepth(candidateUV);
    float gap=-candidate.z+waterReflectionViewPoint(candidate,d,scale).z;
    if(d<.99999&&gap>=0.0){high=middle;}else{low=middle;}
   }
   vec3 hit=mix(start*k0,finish*k1,high)/mix(k0,k1,high);
   vec2 hitUV=mix(uv0,uv1,high);
   float d=waterReflectionDepth(hitUV);
   vec3 surface=waterReflectionViewPoint(hit,d,scale);
   float gap=-hit.z+surface.z;
   float thickness=max(.16,-surface.z*.002);
   float distance=length(hit-eye);
   if(d<.99999&&gap>=0.0&&gap<thickness&&dot(surface-eye,viewUp)>.02&&distance>.25){
    float edge=min(min(hitUV.x,1.0-hitUV.x),min(hitUV.y,1.0-hitUV.y));
    float confidence=smoothstep(.015,.10,edge)*(1.0-smoothstep(55.0,80.0,distance))*(1.0-smoothstep(.4,.75,roughness));
    return vec4(waterReflectionColor(hitUV,roughness).rgb,confidence);
   }
  }
  previous=t;
  previousDelta=delta;
 }
 return vec4(0.0);
}
`;
const lighting = `
if(material.waterReflectionStrength>0.0){
 vec3 reflectionView=waterReflectionViewDirection(vPosition);
 vec4 screenReflection=waterTraceReflection(vPosition,normal,vec3(0.0,1.0,0.0),roughness,1.0);
 if(screenReflection.a>0.0){
  float reflectionNdotV=max(dot(normal,reflectionView),0.0);
  vec2 reflectionBrdf=waterReflectionBrdf(vec2(reflectionNdotV,roughness));
  vec3 reflectionKs=fresnelF0+(max(vec3(1.0-roughness),fresnelF0)-fresnelF0)*exp2((-5.55473*reflectionNdotV-6.98316)*reflectionNdotV);
  vec3 reflectionWeight=reflectionKs*reflectionBrdf.x+f90*reflectionBrdf.y;
  // Replace the existing IBL lobe; retain diffuse colour and direct sun highlights.
  float oldNdotV=max(dot(normal,viewDir),0.0);
  vec2 oldBrdf=waterReflectionBrdf(vec2(oldNdotV,roughness));
  vec3 oldKs=fresnelF0+(max(vec3(1.0-roughness),fresnelF0)-fresnelF0)*exp2((-5.55473*oldNdotV-6.98316)*oldNdotV);
  vec3 oldWeight=oldKs*oldBrdf.x+f90*oldBrdf.y;
  vec3 environmentReflection=sampleEnvironment(reflect(-viewDir,specularNormal),roughness);
  float confidence=screenReflection.a*clamp(material.waterReflectionStrength,0.0,1.0)*(1.0-foam);
  finalColor+=(waterDecodeScene(screenReflection.rgb)*reflectionWeight-environmentReflection*oldWeight)*confidence;
 }
}
`;
function gpuCode(code){
 return code.replace(/(vec[234]|float) (\w+)\(([^)]*)\)\{/g,(_,type,name,args)=>`fn ${name}(${args.split(',').filter(Boolean).map(arg=>{const [t,n]=arg.trim().split(/\s+/);return n+':'+(t==='float'?'f32':t+'<f32>');}).join(',')})->${type==='float'?'f32':type+'<f32>'}{`)
 .replace(/for\(int (\w+)=/g,'for(var $1:i32=')
 .replace(/\b(?:vec[234]|float|int) (\w+)=/g,'var $1=')
 .replace(/\bvec([234])\(/g,'vec$1<f32>(').replace(/\bfloat\(/g,'f32(').replace(/\bint\(/g,'i32(')
 .replaceAll('mat3(uViewMatrix)','mat3x3<f32>(uViewMatrix[0].xyz,uViewMatrix[1].xyz,uViewMatrix[2].xyz)')
 .replaceAll('uProjectionMatrix','camera.uProjectionMatrix').replaceAll('uViewMatrix','camera.uViewMatrix').replaceAll('uCameraPosition','camera.uCameraPosition').replaceAll('uViewportUVScale','camera.uViewportUVScale')
 .replaceAll('vPosition','input.vPosition')
 .replace('any(lessThan(uv,vec2<f32>(.002)))||any(greaterThan(uv,vec2<f32>(.998)))','any(uv<vec2<f32>(.002))||any(uv>vec2<f32>(.998))')
 .replace(/(?<![\w\d])(\.\d+)/g,'0$1');
}
export const waterScreenReflectionsBit={
 name:'foxholeWaterScreenReflections',
 bindings:{material:{waterReflectionStrength:'f32'}},
 gl:{header:`
 vec2 waterReflectionDimensions(){return vec2(textureSize(uOpaqueDepthTexture,0));}
 float waterReflectionDepth(vec2 uv){ivec2 size=textureSize(uOpaqueDepthTexture,0);ivec2 pixel=clamp(ivec2(uv*uViewportUVScale*vec2(size)),ivec2(0),size-ivec2(1));return texelFetch(uOpaqueDepthTexture,pixel,0).r;}
 vec4 waterReflectionColor(vec2 uv,float roughness){return textureLod(uOpaqueColorTexture,uv*uViewportUVScale,roughness*2.0);}
 vec2 waterReflectionBrdf(vec2 uv){return texture(uBrdfLutTexture,uv).rg;}
 `+common.replace('waterReflectionViewPoint(vec3 probe,float d,float scale){','waterReflectionViewPoint(vec3 probe,float d,float scale){d=d*2.0-1.0;'),fragment:{lighting}},
 gpu:{header:`
 fn waterReflectionDimensions()->vec2<f32>{return vec2<f32>(textureDimensions(uOpaqueDepthTexture));}
 fn waterReflectionDepth(uv:vec2<f32>)->f32{let size=vec2<i32>(textureDimensions(uOpaqueDepthTexture));let pixel=clamp(vec2<i32>(uv*camera.uViewportUVScale*vec2<f32>(size)),vec2<i32>(0),size-vec2<i32>(1));return textureLoad(uOpaqueDepthTexture,pixel,0);}
 fn waterReflectionColor(uv:vec2<f32>,roughness:f32)->vec4<f32>{return textureSampleLevel(uOpaqueColorTexture,uBrdfLutSampler,uv*camera.uViewportUVScale,roughness*2.0);}
 fn waterReflectionBrdf(uv:vec2<f32>)->vec2<f32>{return textureSampleLevel(uBrdfLutTexture,uBrdfLutSampler,uv,0.0).rg;}
 `+gpuCode(common).replace('return clip.xy/clip.w*0.5+vec2<f32>(0.5);','let uv=clip.xy/clip.w*0.5+vec2<f32>(0.5);return vec2<f32>(uv.x,1.0-uv.y);'),fragment:{lighting:gpuCode(lighting)}}
};
