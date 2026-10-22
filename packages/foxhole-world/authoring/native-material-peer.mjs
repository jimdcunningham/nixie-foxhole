// The southern streetlamp export has three engine placeholders instead of its
// shared bulb, painted-metal and glass slots. Keep its distinct mesh and UVs.
export function nativeMaterialPeer(prototype,prototypes){
 if(prototype.name!=='BPCoverStreetlamp1aSouth_C/StaticMesh'||prototype.materials?.length!==3||!prototype.materials.every(m=>m.name==='WorldGridMaterial'&&!m.diffuse))return null;
 return prototypes.find(p=>p.name==='BPCoverStreetlamp1a_C/StaticMesh'&&p.materials?.map(m=>m.name).join('|')==='FireBarrel|StreetLamp|GlassBasic'&&p.materials[1].diffuse)||null;
}
export function nativeMaterialOverrides(source,peer,parts){
 if(source.materials.length!==peer.materials.length)return null;
 const result=new Map();
 for(let i=0;i<source.materials.length;i++){
  const name=peer.materials[i].name,material=parts.find(p=>p.materialName===name)?.material;
  if(!material)return null;
  result.set(source.materials[i],{name,material});
 }
 return result;
}
