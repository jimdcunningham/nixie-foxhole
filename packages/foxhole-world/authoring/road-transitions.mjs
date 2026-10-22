import {partitionRoadChunk} from './road-transition-geometry.mjs';
import {Geometry3D,Material3D,Mesh3D} from '@pixi/3d';

const frameGL=`mat3 roadJoinFrame(vec3 n,vec3 p,vec2 uv){vec3 a=dFdx(p),b=dFdy(p);vec2 u=dFdx(uv),v=dFdy(uv);vec3 bp=cross(b,n),ap=cross(n,a),t=bp*u.x+ap*v.x,s=bp*u.y+ap*v.y;float k=inversesqrt(max(max(dot(t,t),dot(s,s)),0.000001));return mat3(t*k,s*k,n);}`;
const frameGPU=`fn roadJoinFrame(n:vec3<f32>,p:vec3<f32>,uv:vec2<f32>)->mat3x3<f32>{let a=dpdx(p);let b=-dpdy(p);let u=dpdx(uv);let v=-dpdy(uv);let bp=cross(b,n);let ap=cross(n,a);let t=bp*u.x+ap*v.x;let s=bp*u.y+ap*v.y;let k=inverseSqrt(max(max(dot(t,t),dot(s,s)),0.000001));return mat3x3<f32>(t*k,s*k,n);}`;
// Pixi beta packs eight material texture indices. Roads do not use ORM or AO,
// so those two slots carry the second surface; the bit restores roughness/AO.
function blendBit(hasNormal){
 const gl=`float roadJitter=sin(vPosition.x*2.13+sin(vPosition.z*1.37))*.22+sin(vPosition.z*4.9+vPosition.x*3.7)*.09;
float roadBlend=smoothstep(-3.0,3.0,vRoadJoin.z+roadJitter);
float roadInfluence=(1.0-smoothstep(2.5,5.0,abs(vRoadJoin.z)))*material.roadBlendEnabled;
vec4 roadOther=sampleOcclusion(vRoadJoin.xy);
vec3 roadCanonical=mix(albedo,pow(roadOther.rgb/max(roadOther.a,.001),vec3(2.2)),roadBlend);
vec4 roadOwnA=sampleBaseColor(vRoadSource.xy);vec4 roadOwnB=sampleOcclusion(vRoadSource.xy);
vec3 roadNative=mix(pow(roadOwnA.rgb/max(roadOwnA.a,.001),vec3(2.2)),pow(roadOwnB.rgb/max(roadOwnB.a,.001),vec3(2.2)),vRoadJoin.w);
albedo=mix(roadNative,roadCanonical,roadInfluence);
vec3 roadGeometric=normalize(gl_FrontFacing?vNormal:-vNormal);
vec3 roadOtherNormal=${hasNormal?'sampleMetallicRoughness(vRoadJoin.xy).xyz*2.0-1.0':'vec3(0.0,0.0,1.0)'};
vec3 roadCanonicalNormal=normalize(mix(normal,normalize(roadJoinFrame(roadGeometric,vPosition,vRoadJoin.xy)*roadOtherNormal),roadBlend));
vec3 roadOwnNormalA=sampleNormal(vRoadSource.xy).xyz*2.0-1.0;
vec3 roadOwnNormalB=${hasNormal?'sampleMetallicRoughness(vRoadSource.xy).xyz*2.0-1.0':'vec3(0.0,0.0,1.0)'};
vec3 roadNativeNormal=normalize(roadJoinFrame(roadGeometric,vPosition,vRoadSource.xy)*mix(roadOwnNormalA,roadOwnNormalB,vRoadJoin.w));
normal=normalize(mix(roadNativeNormal,roadCanonicalNormal,roadInfluence));specularNormal=normal;roughness=1.0;occlusion=1.0;`;
 const gpu=gl.replaceAll('vPosition','input.vPosition').replaceAll('vRoadJoin','input.vRoadJoin').replaceAll('vRoadSource','input.vRoadSource').replaceAll('vNormal','input.vNormal').replace(/float (\w+)=/g,'let $1=').replace(/vec4 (\w+)=/g,'let $1=').replace(/vec3 (\w+)=/g,'let $1=').replaceAll('vec3(','vec3<f32>(').replaceAll('gl_FrontFacing?input.vNormal:-input.vNormal','select(-input.vNormal,input.vNormal,input.frontFacing)');
 return{name:'foxholeRoadTransition'+(hasNormal?'Normal':'Flat'),attributes:{aColor1:'float32x4',aColor:'float32x4'},interStage:{vRoadJoin:'vec4<f32>',vRoadSource:'vec4<f32>'},bindings:{material:{roadBlendEnabled:'f32'}},gl:{vertex:{end:'vRoadJoin=aColor1;vRoadSource=aColor;'},fragment:{header:frameGL,material:gl}},gpu:{header:frameGPU,vertex:{end:'output.vRoadJoin=input.aColor1;output.vRoadSource=input.aColor;'},fragment:{material:gpu}}};
}
export async function createRoadTransitions({region,json,texture,geo,mat,hexBit,weatherSurfaceBit,weatherMaterial,groundBit,materials,enabled=true}){
 const data=await json(region+'/world-fixes/road-transitions.json'),variants=new Map(),prepared=[];
 const summary={connections:data.joins.length,skippedConnections:data.skipped.length,transitionTriangles:0,sourceTriangles:0,extraMeshes:0,materials:0,enabled,method:data.method};
 async function materialFor(a,b){const key=a+'|'+b;if(variants.has(key))return variants.get(key);const da=materials[a],db=materials[b];if(!da||!db)throw Error('Missing transition road material');const [color,normal,other,otherNormal]=await Promise.all([da.file?texture(`${region}/${da.file}`,true):undefined,da.normalFile?texture(`${region}/${da.normalFile}`,true):undefined,texture(`${region}/${db.file}`,true),db.normalFile?texture(`${region}/${db.normalFile}`,true):undefined]);const m=mat(weatherMaterial(new Material3D({baseColorTexture:color,normalTexture:normal,roughness:1,metallic:0,doubleSided:true,vertexColors:false,extraBits:[hexBit,blendBit(!!otherNormal),weatherSurfaceBit,...(groundBit?[groundBit]:[])]})));m.textures.occlusion=other;if(otherNormal)m.textures.metallicRoughness=otherNormal;m.data.roadBlendEnabled=summary.enabled?1:0;variants.set(key,m);prepared.push(m);summary.materials=prepared.length;return m;}
 function prepareChunk(input){return partitionRoadChunk({...input,joins:data.joins});}
 async function addPrepared({groups,transitionTriangles,sourceTriangles,root,baseMaterial}){
  summary.sourceTriangles+=sourceTriangles;summary.transitionTriangles+=transitionTriangles;
  summary.extraMeshes+=Math.max(0,groups.size-1);for(const g of groups.values()){const mesh=new Mesh3D({label:g.join?'Road Material Transition':'Road',geometry:geo(new Geometry3D({positions:new Float32Array(g.p),normals:new Float32Array(g.n),uvs:new Float32Array(g.uv),...(g.join?{colors1:new Float32Array(g.extra),colors:new Float32Array(g.native)}:{}),indices:new Uint32Array(g.ix)})),material:g.join?await materialFor(g.join.a,g.join.b):baseMaterial,castShadow:false});mesh.position.y=.045;root.addChild(mesh);}
 }
 async function addChunk(input){return addPrepared({...input,...prepareChunk(input),sourceTriangles:input.indices.length/3});}
 return{summary,addChunk,addPrepared,prepareChunk,setEnabled(value){summary.enabled=!!value;for(const m of prepared)m.data.roadBlendEnabled=value?1:0;},focus(index=0){return data.joins[index%data.joins.length]?.p;}};
}
