// The prepared Fire01 image is a tiled noise mask, not a bounded flame.
// Keep the native emission and lifetime curves, but bound this small lantern
// flame inside its billboard and composite it as native translucent Fire01.
export const isLanternFlame=(placement,material)=>placement.system==='War/Content/FX/LanternFire.LanternFire'&&material.fire===true;
export function lanternFlameColor(linear){const exposure=1/(1+Math.max(0,...linear));return linear.map(v=>Math.max(0,v)*exposure);}
const gl=`vec2 lanternUV=vUV;
float lanternHeight=1.0-lanternUV.y;
float lanternWidth=mix(0.34,0.055,smoothstep(0.1,0.95,lanternHeight));
float lanternSway=sin(material.uParticleTime*6.0+lanternUV.y*8.0)*0.035*lanternHeight;
float lanternSide=1.0-smoothstep(lanternWidth*0.45,lanternWidth,abs(lanternUV.x-0.5-lanternSway));
float lanternEnds=smoothstep(0.02,0.18,lanternUV.y)*(1.0-smoothstep(0.82,0.98,lanternUV.y));
float lanternMask=sampleBaseColor(lanternUV).a;
alpha*=lanternSide*lanternEnds*lanternMask*lanternMask*0.7;
float lanternCore=(1.0-smoothstep(0.0,0.16,abs(lanternUV.x-0.5)))*smoothstep(0.3,0.8,lanternUV.y);
albedo=mix(albedo,vec3(1.0,0.78,0.38),lanternCore*0.5);`;
const gpu=gl.replaceAll('vUV','input.vUV').replaceAll('vec2 lanternUV=','let lanternUV=').replaceAll('float ','let ').replaceAll('vec3(','vec3<f32>(');
export const lanternFlameBit={name:'foxholeLanternFlame_v1',gl:{fragment:{material:gl}},gpu:{fragment:{material:gpu}}};
