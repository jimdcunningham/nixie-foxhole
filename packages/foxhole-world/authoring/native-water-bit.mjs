import {waterOpticsHeader} from './water-optics.mjs';
// Source images and linear palettes come from Foxhole's Water2 material graph.
// Four-way moving normals, refracted opaque color, scene-depth shoreline foam
// and native boat stencils run in Pixi PBR. UE flow painting/SSR remain incomplete.
const materialGL=`
// Orthographic rays are parallel, regardless of zoom or distance from the camera.
viewDir = waterViewDirection(vPosition);
vec2 waterXZ = vPosition.xz;
float pond = step(.5,material.hasPonds)*step(0.0,vPosition.y);
float waterTime = material.waterTime*mix(1.0,.2,pond);
vec2 largeUV = waterXZ / 16.0;
vec2 smallUV = waterXZ / 2.4;
vec2 largeN = (sampleWaveLarge(largeUV + vec2(.013,.007)*waterTime).rg
 + sampleWaveLarge(largeUV*1.07 + vec2(-.009,.012)*waterTime + vec2(.37,.61)).rg
 + sampleWaveLarge(largeUV*.93 + vec2(.005,-.011)*waterTime + vec2(.73,.29)).rg
 + sampleWaveLarge(largeUV*1.13 + vec2(-.011,-.006)*waterTime + vec2(.17,.83)).rg - vec2(2.0)) * .5;
vec2 smallN = (sampleWaveSmall(smallUV + vec2(.027,-.016)*waterTime).rg
 + sampleWaveSmall(smallUV*1.03 + vec2(-.023,.019)*waterTime + vec2(.41,.19)).rg - vec2(1.0));
vec2 waterN = (largeN * material.waveStrength + smallN * .16)*mix(1.0,.3,pond);
normal = normalize(vec3(waterN.x, sqrt(max(.08,1.0-dot(waterN,waterN))), -waterN.y));
specularNormal = normal;
vec2 heightUV = (vec2((vPosition.x+1092.0)/2184.0,(945.0-vPosition.z)/1890.0)*vec2(2184.0,1890.0)+vec2(.5))/vec2(2185.0,1891.0);
vec2 bed = sampleWaterBed(heightUV).rg;
float bedHeight = dot(bed,vec2(65280.0,255.0))/65535.0*256.0-128.0;
float waterDepth = max(0.0,vPosition.y-bedHeight);
float waterViewDepth = -(uViewMatrix*vec4(vPosition,1.0)).z;
float sceneGap = max(0.0,waterSceneDepth(vPosition)-waterViewDepth);
float contactDepth = min(waterDepth,sceneGap*max(.08,abs(viewDir.y)));
float shallows = exp(-waterDepth*mix(.65,.18,pond));
float waveFoam = sampleWaterFoam(waterXZ/7.0+vec2(.018,.007)*waterTime).r;
float modulation = sampleMetallicRoughness(waterXZ/24.0+vec2(-.006,.004)*waterTime).r;
float clouds = sampleOcclusion(waterXZ/36.0+vec2(.004,-.007)*waterTime).g;
float shoreFoam = (1.0-smoothstep(.06,.95,contactDepth))*smoothstep(.20,.65,waveFoam*.65+modulation*.35)*.68;
float bodyFoam = pow(max(waveFoam,0.0),4.5)*pow(max(modulation,0.0),3.0)*smoothstep(.45,.9,clouds)*.4;
float foam = clamp((shoreFoam+bodyFoam)*(1.0-pond),0.0,.85);
float opticalDepth = min(waterDepth,sceneGap*max(.1,abs(viewDir.y)));
vec3 refractedRay = refract(-viewDir,normal,1.0/1.333);
vec3 flatRay = refract(-viewDir,vec3(0.0,1.0,0.0),1.0/1.333);
vec3 refractedPoint = vPosition+(refractedRay-flatRay)*min(opticalDepth,5.0)*.55;
if(waterSceneDepth(refractedPoint)<waterViewDepth+.015){refractedPoint=vPosition;}
vec3 behind = waterDecodeScene(sampleScreenCopy(uOpaqueColorTexture,refractedPoint,0.0).rgb);
vec3 absorption = exp(-vec3(.50,.28,.36)*opticalDepth/max(.5,abs(refractedRay.y)));
float fresnelWater = .02037+.97963*pow(1.0-max(dot(normal,viewDir),0.0),5.0);
float transmitWater = exp(-opticalDepth*.27)*(1.0-fresnelWater)*(1.0-foam);
vec3 bodyColor = mix(material.waterBody.rgb,material.waterShallow.rgb,shallows);
// Only transmitted scene light is emissive. Body colour must darken with the sun.
emissive = behind*absorption*transmitWater;
albedo = mix(bodyColor*(1.0-transmitWater)*1.2,material.waterFoamColor.rgb,foam);
roughness = mix(mix(.18,.24,pond),.78,foam);
metallic = 0.0;
occlusion = 1.0;
fresnelF0 = vec3(.02037);
f90 = 1.0;
alpha = 1.0;
`;
// Keep the same arithmetic and source samplers on both backends.
function wgsl(gl){return gl.replaceAll('vPosition','input.vPosition').replaceAll('uViewMatrix','camera.uViewMatrix')
 .replace(/vec2 (\w+) =/g,'var $1 =').replace(/vec3 (\w+) =/g,'var $1 =').replace(/float (\w+) =/g,'var $1 =')
 .replaceAll('vec2(', 'vec2<f32>(').replaceAll('vec3(', 'vec3<f32>(').replaceAll('vec4(', 'vec4<f32>(')
 .replace('sampleScreenCopy(uOpaqueColorTexture,refractedPoint','sampleScreenCopy(uOpaqueColorTexture,uBrdfLutSampler,refractedPoint')
 .replace(/(?<![\w\d])(\.\d+)/g,'0$1');}
export const nativeWaterBit={
 name:'foxholeNativeWater2',
 textures:['waveLarge','waveSmall','waterFoam','waterBed'],
 bindings:{material:{waterTime:'f32',waveStrength:'f32',hasPonds:'f32',waterBody:'vec4<f32>',waterShallow:'vec4<f32>',waterFoamColor:'vec4<f32>',waterScatter:'vec4<f32>'}},
 gl:{header:waterOpticsHeader(false),fragment:{material:materialGL}},gpu:{header:waterOpticsHeader(true),fragment:{material:wgsl(materialGL)}}
};
