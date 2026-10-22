const f=n=>{if(!Number.isFinite(n))throw Error('Non-finite landscape parameter');return Number.isInteger(n)?n+'.0':String(n);};
export function liveTerrainBit(meta){
 const fields={weightTransform:'vec4<f32>',weather:'vec4<f32>'};for(let i=0;i<meta.buckets.length;i++){fields['uTerrainColors'+i]='texture_2d_array<f32>';fields['uTerrainNormals'+i]='texture_2d_array<f32>';}Object.assign(fields,{uTerrainWeights:'texture_2d_array<f32>',uTerrainRepeat:'sampler',uTerrainClamp:'sampler',uTerrainNoise:'texture_2d<f32>',uTerrainSnowMaterial:'texture_2d<f32>'});
 const reader=(gpu,kind)=>meta.buckets.map((b,i)=>{const last=i===meta.buckets.length-1,call=gpu?'textureSampleGrad':'textureGrad',name='uTerrain'+kind+i,coords=gpu?'uv,i-'+b.start:'vec3(uv,float(i-'+b.start+'))',sample=call+'('+name+','+(gpu?'uTerrainRepeat,':'')+coords+',dx,dy)';return (last?'':'if(i<'+(b.start+b.count)+'){')+'return '+sample+(last?';':';}');}).join('');

 const layers=meta.layers.map((l,i)=>{
  const a=l.variants[0],b=l.variants[1]||a,m0=l.masks[0],m1=l.masks[1],dot=m=>`vec3(${m.channel.slice(0,3).map(f).join(',')})`;
  return `{
   float w=terrainWeight(${i},weightUV,weightDX,weightDY);
   if(w>0.00001){
    vec4 a0=terrainColor(${a.slice},terrainXZ/${f(a.tile)},terrainDX/${f(a.tile)},terrainDY/${f(a.tile)});
    vec4 a1=terrainColor(${b.slice},terrainXZ/${f(b.tile)},terrainDX/${f(b.tile)},terrainDY/${f(b.tile)});
    vec3 n0=terrainNormal(${a.slice},terrainXZ/${f(a.tile)},terrainDX/${f(a.tile)},terrainDY/${f(a.tile)});
    vec3 n1=terrainNormal(${b.slice},terrainXZ/${f(b.tile)},terrainDX/${f(b.tile)},terrainDY/${f(b.tile)});
    float m0=dot(terrainNoise(terrainXZ/${f(m0.tile)},terrainDX/${f(m0.tile)},terrainDY/${f(m0.tile)}).rgb,${dot(m0)});
    float m1=dot(terrainNoise(terrainXZ/${f(m1.tile)},terrainDX/${f(m1.tile)},terrainDY/${f(m1.tile)}).rgb,${dot(m1)});
    float blend=${l.variety?`clamp(pow(max(0.0,m0*m1),${f(l.levels)})*${f(l.intensity)},0.0,1.0)`:'0.0'};
    terrainAlbedo+=mix(a0.rgb,a1.rgb,blend)*w;terrainBump+=mix(n0,n1,blend)*w;terrainTotal+=w;
   }
  }`;
 }).join('\n');
 const body=`
 if(vPosition.y<-220.0||abs(vPosition.z)>945.0||abs(vPosition.x)+abs(vPosition.z)*0.577777778>1092.0){discard;}
 vec2 terrainXZ=vec2(vPosition.x,-vPosition.z);
 vec2 terrainDX=dFdx(terrainXZ);vec2 terrainDY=dFdy(terrainXZ);
 vec2 weightUV=(vec2(vPosition.x-terrain.weightTransform.x,terrain.weightTransform.y-vPosition.z)+vec2(0.5))/terrain.weightTransform.zw;
 vec2 weightDX=dFdx(weightUV);vec2 weightDY=dFdy(weightUV);
 vec3 terrainAlbedo=vec3(0.0);vec3 terrainBump=vec3(0.0);float terrainTotal=0.0;
 ${layers}
 if(terrainTotal>0.00001){albedo=terrainAlbedo/terrainTotal;}else{albedo=vec3(0.14,0.145,0.105);}
 vec3 mapNormal=normalize(terrainBump+vec3(0.0,0.0,0.00001));
 vec3 surfaceNormal=normal;
 vec3 T=normalize(vec3(1.0,-surfaceNormal.x/max(abs(surfaceNormal.y),0.001),0.0));vec3 B=normalize(cross(surfaceNormal,T));
 normal=normalize(T*mapNormal.x-B*mapNormal.y+surfaceNormal*max(0.05,mapNormal.z));
 float broadWet=terrainNoise(terrainXZ/18.0,terrainDX/18.0,terrainDY/18.0).r;
 float wet=terrain.weather.x*pow(max(0.0,surfaceNormal.y),2.0)*mix(0.6,1.0,broadWet);
 albedo*=1.0-wet*0.4;roughness=mix(0.88,0.075,wet);
 float snowMask=terrain.weather.y*pow(max(0.0,surfaceNormal.y),3.0)*smoothstep(0.12,0.55,broadWet);
 vec4 snowColor=terrainColor(${meta.snowSlice},terrainXZ/3.0,terrainDX/3.0,terrainDY/3.0);
 vec3 snowNormal=terrainNormal(${meta.snowSlice},terrainXZ/3.0,terrainDX/3.0,terrainDY/3.0);
 albedo=mix(albedo,snowColor.rgb,snowMask);normal=normalize(mix(normal,T*snowNormal.x-B*snowNormal.y+surfaceNormal*max(.05,snowNormal.z),snowMask));roughness=mix(roughness,terrainSnowRough(terrainXZ/3.0,terrainDX/3.0,terrainDY/3.0),snowMask);
 roughness=clamp(roughness+max(length(dFdx(normal)),length(dFdy(normal)))*0.2,0.045,1.0);
 specularNormal=normal;
 `;
 // A tiny common source keeps the actual surface blend identical on both backends.
 const wgsl=body.replaceAll('vPosition','input.vPosition').replaceAll('dFdx(','dpdx(').replaceAll('dFdy(','dpdy(').replaceAll('mix(','mix(')
  .replace(/vec2 (\w+)=/g,'var $1=').replace(/vec3 (\w+)=/g,'var $1=').replace(/vec4 (\w+)=/g,'var $1=').replace(/float (\w+)=/g,'var $1=')
  .replaceAll('vec2(','vec2<f32>(').replaceAll('vec3(','vec3<f32>(').replaceAll('vec4(','vec4<f32>(').replace(/(?<![\w\d])(\.\d+)/g,'0$1');
 return{name:'nativeLandscapeSurface:'+meta.region,attributes:{aPosition:'float32x3',aNormal:'float32x3'},interStage:{vPosition:'vec3<f32>',vNormal:'vec3<f32>'},bindings:{terrain:fields},
  gpu:{header:`
fn terrainColor(i:i32,uv:vec2<f32>,dx:vec2<f32>,dy:vec2<f32>)->vec4<f32>{${reader(true,'Colors')}}
fn terrainNormalPacked(i:i32,uv:vec2<f32>,dx:vec2<f32>,dy:vec2<f32>)->vec4<f32>{${reader(true,'Normals')}}
fn terrainNormal(i:i32,uv:vec2<f32>,dx:vec2<f32>,dy:vec2<f32>)->vec3<f32>{return terrainNormalPacked(i,uv,dx,dy).rgb*2.0-1.0;}
fn terrainWeight(i:i32,uv:vec2<f32>,dx:vec2<f32>,dy:vec2<f32>)->f32{return textureSampleGrad(uTerrainWeights,uTerrainClamp,uv,i,dx,dy).r;}
fn terrainSnowRough(uv:vec2<f32>,dx:vec2<f32>,dy:vec2<f32>)->f32{return textureSampleGrad(uTerrainSnowMaterial,uTerrainRepeat,uv,dx,dy).g;}
fn terrainNoise(uv:vec2<f32>,dx:vec2<f32>,dy:vec2<f32>)->vec4<f32>{return textureSampleGrad(uTerrainNoise,uTerrainRepeat,uv,dx,dy);}
`,fragment:{material:wgsl}},gl:{header:`
vec4 terrainColor(int i,vec2 uv,vec2 dx,vec2 dy){${reader(false,'Colors')}}
vec4 terrainNormalPacked(int i,vec2 uv,vec2 dx,vec2 dy){${reader(false,'Normals')}}
vec3 terrainNormal(int i,vec2 uv,vec2 dx,vec2 dy){return terrainNormalPacked(i,uv,dx,dy).rgb*2.0-1.0;}
float terrainWeight(int i,vec2 uv,vec2 dx,vec2 dy){return textureGrad(uTerrainWeights,vec3(uv,float(i)),dx,dy).r;}
float terrainSnowRough(vec2 uv,vec2 dx,vec2 dy){return textureGrad(uTerrainSnowMaterial,uv,dx,dy).g;}
vec4 terrainNoise(vec2 uv,vec2 dx,vec2 dy){return textureGrad(uTerrainNoise,uv,dx,dy);}
`,fragment:{material:body.replaceAll('terrain.weightTransform','weightTransform').replaceAll('terrain.weather','weather')}}};
}
export const liveTerrainTemplate={bindGroups:['global','camera','terrain'],gpu:`{{header}}
@vertex fn mainVertex(input:VertexInput)->VertexOutput {var out:VertexOutput;out.position=camera.uViewProjectionMatrix*vec4<f32>(input.aPosition,1.0);out.vPosition=input.aPosition;out.vNormal=input.aNormal;return out;}
@fragment fn mainFragment(input:FragmentInput)->@location(0) vec4<f32>{
 var normal=normalize(input.vNormal);var albedo=vec3<f32>(1.0);var finalColor=vec3<f32>(0.0);var alpha=1.0;
 var metallic=0.0;var roughness=0.88;var fresnelF0=vec3<f32>(0.04);var f90=1.0;var emissive=vec3<f32>(0.0);var occlusion=1.0;var ambient=vec3<f32>(0.0);var directLight=vec3<f32>(0.0);var viewDir=select(normalize(camera.uCameraPosition.xyz - input.vPosition), normalize(vec3<f32>(camera.uViewMatrix[0][2], camera.uViewMatrix[1][2], camera.uViewMatrix[2][2])), abs(camera.uProjectionMatrix[3][3]) > 0.5);var specularNormal=normal;
 {{fragmentMaterial}}
 {{fragmentLighting}}
 finalColor*=global.uExposure;
 {{fragmentEnd}}
 return vec4<f32>(finalColor,1.0);
}`,gl:{vertex:`#version 300 es
{{header}}
void main(){vPosition=aPosition;vNormal=aNormal;gl_Position=uViewProjectionMatrix*vec4(aPosition,1.0);}`,fragment:`#version 300 es
{{header}}
out vec4 outColor;
void main(){vec3 normal=normalize(vNormal);vec3 albedo=vec3(1.0);vec3 finalColor=vec3(0.0);float alpha=1.0;
float metallic=0.0;float roughness=.88;vec3 fresnelF0=vec3(.04);float f90=1.0;vec3 emissive=vec3(0.0);float occlusion=1.0;vec3 ambient=vec3(0.0);vec3 directLight=vec3(0.0);vec3 viewDir=(abs(uProjectionMatrix[3][3]) > 0.5 ? normalize(vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2])) : normalize(uCameraPosition.xyz - vPosition));vec3 specularNormal=normal;
{{material}}
{{lighting}}
finalColor*=uExposure;
{{end}}
outColor=vec4(finalColor,1.0);}`}};

