import {nativeFamily} from './effect-materials.mjs';
export function glassProfile(row){
 if(!nativeFamily(row,'War/Content/Materials/Environment/Glass')||row.blend!=='BLEND_Translucent')return null;
 const s=row.scalars,c=row.colors?.['Diffuse Color'],sw=row.switches;
 if(!c||![c.R,c.G,c.B,s?.['Overall Opacity'],s?.Metallic,s?.Roughness].every(v=>Number.isFinite(v)&&v>=0)||!['Diffuse Texture?','Mat Texture?','Normal Map?'].every(k=>typeof sw?.[k]==='boolean'))return null;
 const diffuse=sw['Diffuse Texture?']?row.textures?.['Diffuse Texture']?.path:null;if(sw['Diffuse Texture?']&&!diffuse)return null;
 return {diffuse,color:[c.R,c.G,c.B],opacity:Math.min(1,s['Overall Opacity']),metallic:Math.min(1,s.Metallic),roughness:Math.min(1,s.Roughness),materialTexture:sw['Mat Texture?'],normal:sw['Normal Map?']};
}
/** Translate only graph-proven branches; keep unknown normal lerp/refraction intact. */
export async function translateGlass({material,row,image,nativeImage}){
 const p=glassProfile(row);if(!p||material.extras?.foxholeGlassControlsVersion===1)return false;
 const pbr=material.pbrMetallicRoughness??={};
 // This switch chooses texture OR color. Multiplying the two darkens textured glass.
 pbr.baseColorFactor=[...(p.diffuse?[1,1,1]:p.color),p.opacity];
 if(p.diffuse)pbr.baseColorTexture=await image(await nativeImage(p.diffuse));else delete pbr.baseColorTexture;
 if(!p.materialTexture){delete pbr.metallicRoughnessTexture;pbr.metallicFactor=p.metallic;pbr.roughnessFactor=p.roughness;}
 if(!p.normal)delete material.normalTexture;
 material.alphaMode='BLEND';material.doubleSided=row.properties?.TwoSided!==false;
 material.extras={...material.extras,foxholeMaterialFamily:'glass',foxholeGlassControlsVersion:1};return true;
}
