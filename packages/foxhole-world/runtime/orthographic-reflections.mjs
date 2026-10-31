// A top-down map is a planning view. Fade glossy reflection as an orthographic
// camera approaches vertical, preserving authored perspective materials and
// smoothly restoring their response when the user tilts the camera.
const materialGL=`
float foxholeReflectionScale = 1.0;
if(abs(uProjectionMatrix[3][3]) > .5){
 // Orthographic rays are parallel; eye-to-fragment vectors create false
 // grazing reflections when zooming close to elevated or distant surfaces.
 viewDir = normalize(vec3(uViewMatrix[0][2],uViewMatrix[1][2],uViewMatrix[2][2]));
 foxholeReflectionScale = 1.0-smoothstep(.65,.98,abs(viewDir.z));
}
fresnelF0 *= foxholeReflectionScale;
f90 *= foxholeReflectionScale;
// Retain the base colour of metal objects when their reflection is removed.
metallic *= foxholeReflectionScale;
`;
const materialGPU=materialGL.replaceAll('uProjectionMatrix','camera.uProjectionMatrix').replaceAll('uViewMatrix','camera.uViewMatrix').replace('float foxholeReflectionScale','var foxholeReflectionScale').replaceAll('vec3(','vec3<f32>(').replace(/(?<![\w\d])(\.\d+)/g,'0$1');
export const orthographicReflectionBit={name:'foxholeOrthographicPlanningReflections',gl:{fragment:{material:materialGL}},gpu:{fragment:{material:materialGPU}}};

/** Apply after native frame restoration, before any lighting runs. */
export function withOrthographicPlanningReflections(bits){
 if(!bits.some(b=>b.name==='pbrMaterial'))return bits;
 const result=bits.map(bit=>{
  if(bit.name!=='ibl'&&!bit.name.startsWith('foxholeWaterScreenReflections'))return bit;
  const adapted={...bit,name:bit.name+':planning-reflections'};
  for(const backend of ['gl','gpu']){
   const stage=bit[backend];if(!stage?.fragment?.lighting)continue;
   let lighting=stage.fragment.lighting;
   if(bit.name==='ibl')lighting=lighting.replace('FssEss * radiance + (FmsEms + k_D) * irradiance','foxholeReflectionScale * (FssEss * radiance + FmsEms * irradiance) + k_D * irradiance');
   else lighting=lighting.replaceAll('material.waterReflectionStrength','(material.waterReflectionStrength*foxholeReflectionScale)');
   adapted[backend]={...stage,fragment:{...stage.fragment,lighting}};
  }
  return adapted;
 });
 return [...result,orthographicReflectionBit];
}
