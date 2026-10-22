import native from '../authoring/native-foliage-masks.json' with {type:'json'};
// Repair legacy RGB-only foliage before decoding; new prepared exports already carry alpha.
export function restoreNativeFoliageMasks(doc,baseUrl){
 const resources=[];
 for(const material of doc.materials||[]){
  const rule=native.materials.find(r=>material.extras?.foxholeMaterialSource===r.material&&material.extras?.foxholeAlbedoSource===r.albedo);
  if(!rule||material.extras?.foxholeOpacitySource)continue;
  const binding=material.pbrMetallicRoughness?.baseColorTexture,texture=doc.textures?.[binding?.index],image=doc.images?.[texture?.source];
  if(!image)continue;
  const imageIndex=doc.images.push({uri:new URL(rule.resource.path,new URL(baseUrl,globalThis.location?.href)).href})-1;
  const textureIndex=doc.textures.push({...texture,source:imageIndex})-1;
  material.pbrMetallicRoughness.baseColorTexture={...binding,index:textureIndex};
  material.alphaMode='MASK';material.alphaCutoff=rule.cutoff;
  material.extras={...material.extras,foxholeOpacitySource:rule.source,foxholeOpacityChannel:'B'};
  resources.push(rule.resource);
 }
 return resources;
}
