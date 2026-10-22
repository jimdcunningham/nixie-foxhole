// Native SmallPuddle parameters: Colo0r1 is linear RGB; its alpha is not opacity.
// Opacity comes from the separate scalar. Unreal Specular maps to 2x glTF's factor.
export function restoreNativeSmallWaterMaterials(document){
 for(const material of document.materials||[]){
  if(material.extras?.foxholeMaterialSource!=='War/Content/Materials/SmallPuddle.uasset')continue;
  const pbr=material.pbrMetallicRoughness||={};
  pbr.baseColorFactor=[.02,.016119,.011275,.945872];
  pbr.metallicFactor=0;pbr.roughnessFactor=.1;
  material.alphaMode='BLEND';
  if(material.normalTexture)material.normalTexture.scale=.688991;
  material.extensions||={};
  material.extensions.KHR_materials_specular={...material.extensions.KHR_materials_specular,specularFactor:.6};
  document.extensionsUsed||=[];
  if(!document.extensionsUsed.includes('KHR_materials_specular'))document.extensionsUsed.push('KHR_materials_specular');
 }
 return document;
}
