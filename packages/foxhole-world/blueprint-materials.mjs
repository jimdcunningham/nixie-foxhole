const key=value=>String(value||'').replaceAll('\\','/').toLowerCase();
/** Only the authored Puddles family uses these native scalar/color parameters. */
export function nativePuddleMaterial(row){
 if(!row?.properties?.Expressions?.some(e=>key(e?.ObjectPath).startsWith('war/content/materials/puddles.')))return null;
 const color=row.colors?.Colo0r1,s=row.scalars;
 if(!color||!s||![color.R,color.G,color.B,s.Opacity,s.Roughness,s.Metallic,s.Specular].every(Number.isFinite))return null;
 return {name:row.name,pbrMetallicRoughness:{baseColorFactor:[color.R,color.G,color.B,s.Opacity],roughnessFactor:s.Roughness,metallicFactor:s.Metallic},
  alphaMode:'BLEND',doubleSided:true,extensions:{KHR_materials_specular:{specularFactor:s.Specular*2}},
  extras:{foxholeMaterialSource:row.path,foxholeMaterialFamily:'puddles',foxholePuddleTranslation:'static-pbr'}};
}
/** Copy a material and its bindings without changing another component's textures. */
export function copyMaterial(target,source,material){
 const next=structuredClone(material),textures=new Map(),images=new Map(),samplers=new Map();
 function texture(index){
  if(textures.has(index))return textures.get(index);
  const value=structuredClone(source.textures[index]);
  if(value.extensions)throw Error('Unsupported blueprint material texture extension');
  if(value.source!==undefined){if(!images.has(value.source)){target.images??=[];images.set(value.source,target.images.push(structuredClone(source.images[value.source]))-1);}value.source=images.get(value.source);}
  if(value.sampler!==undefined){if(!samplers.has(value.sampler)){target.samplers??=[];samplers.set(value.sampler,target.samplers.push(structuredClone(source.samplers[value.sampler]))-1);}value.sampler=samplers.get(value.sampler);}
  target.textures??=[];const result=target.textures.push(value)-1;textures.set(index,result);return result;
 }
 function visit(value){for(const [name,binding]of Object.entries(value||{})){if(!binding||typeof binding!=='object')continue;if(name.endsWith('Texture')&&Number.isInteger(binding.index))binding.index=texture(binding.index);else visit(binding);}}
 visit(next);for(const extension of Object.keys(next.extensions||{})){target.extensionsUsed??=[];if(!target.extensionsUsed.includes(extension))target.extensionsUsed.push(extension);}
 return next;
}
/** Slot indices refer to native mesh slots, never the filtered override list. */
export function assignBlueprintMaterials(doc,overrides,resolve){
 let changes=0;
 for(const override of overrides){
  if(!Number.isInteger(override.Index)||override.Index<0)throw Error('Invalid native material slot');
  const primitives=(doc.meshes||[]).flatMap(m=>m.primitives).filter(p=>(p.extras?.foxholeMaterialSlot??p.material)===override.Index);
  if(!primitives.length)throw Error('Native material slot missing from prepared model: '+override.Index);
  if(primitives.every(p=>key(doc.materials[p.material]?.extras?.foxholeMaterialSource)===key(override.MaterialPath)))continue;
  const replacement=resolve(override.MaterialPath);if(!replacement)throw Error('No translated native material for '+override.MaterialPath);
  const index=doc.materials.push(copyMaterial(doc,replacement.doc,replacement.material))-1;
  for(const primitive of primitives){primitive.extras={...primitive.extras,foxholeMaterialSlot:override.Index};primitive.material=index;}
  changes++;
 }
 return changes;
}
