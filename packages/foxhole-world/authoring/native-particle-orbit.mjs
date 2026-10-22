// Orbit offsets are sampled in native emitter axes. Transform the animated
// offset through the component basis before the region's board-frame transform.
const rotate=`vec3 orbitAngle=(aNativeOrbitRotation+aNativeOrbitRate*particleAge)*6.28318530718;
vec3 orbitCos=cos(orbitAngle); vec3 orbitSin=sin(orbitAngle); vec3 orbitOffset=aNativeOrbitOffset;
orbitOffset=vec3(orbitOffset.x,orbitCos.x*orbitOffset.y-orbitSin.x*orbitOffset.z,orbitSin.x*orbitOffset.y+orbitCos.x*orbitOffset.z);
orbitOffset=vec3(orbitCos.y*orbitOffset.x+orbitSin.y*orbitOffset.z,orbitOffset.y,-orbitSin.y*orbitOffset.x+orbitCos.y*orbitOffset.z);
orbitOffset=vec3(orbitCos.z*orbitOffset.x-orbitSin.z*orbitOffset.y,orbitSin.z*orbitOffset.x+orbitCos.z*orbitOffset.y,orbitOffset.z);
position.xyz+=uNativeOrbitX*orbitOffset.x+uNativeOrbitY*orbitOffset.y+uNativeOrbitZ*orbitOffset.z;`;
const gpu=rotate.replaceAll('vec3 ','var ').replaceAll('vec3(','vec3<f32>(')
 .replaceAll(/\baNativeOrbit\w+/g,name=>'input.'+name).replaceAll(/\buNativeOrbit\w+/g,name=>'material.'+name)
 .replace('position.xyz+=','position=vec4<f32>(position.xyz+').replace(/;$/ ,',1.0);');
export const nativeParticleOrbit={name:'nativeParticleOrbit_v2',attributes:{aNativeOrbitOffset:'float32x3',aNativeOrbitRotation:'float32x3',aNativeOrbitRate:'float32x3'},bindings:{material:{uNativeOrbitX:'vec3<f32>',uNativeOrbitY:'vec3<f32>',uNativeOrbitZ:'vec3<f32>'}},gpu:{vertex:{beforeTransform:gpu}},gl:{vertex:{beforeTransform:rotate.replaceAll(/\buNativeOrbit\w+/g,name=>'material.'+name)}}};
