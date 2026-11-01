// Keep native semantic identity outside Pixi's material-name dictionary. Names
// can collide, and an ordinary material called "Puddles" is not water evidence.
const profilesBySource=new WeakMap();
export function retainContainedWaterMaterials(source,document){
 const profiles=new Map();
 for(const [index,row]of (document.materials||[]).entries()){
  if(row.extras?.foxholeMaterialFamily!=='puddles'||!row.extras?.foxholeMaterialSource)continue;
  const pbr=row.pbrMetallicRoughness,color=pbr?.baseColorFactor;
  if(!Array.isArray(color)||color.length!==4||!color.every(Number.isFinite)||!Number.isFinite(pbr.roughnessFactor))continue;
  if(source.materials[index])profiles.set(source.materials[index],{color:color.slice(0,3),opacity:color[3],roughness:pbr.roughnessFactor});
 }
 profilesBySource.set(source,profiles);return source;
}
export function containedWaterMaterials(source){return profilesBySource.get(source)||new Map();}

/** Reuse a surface within one model-layer lifetime; its caller owns disposal. */
export function createContainedWaterResolver(create){
 const pending=new Map();
 return async source=>{
  const overrides=new Map();
  for(const [original,profile]of containedWaterMaterials(source)){
   const key=JSON.stringify(profile);
   if(!pending.has(key))pending.set(key,Promise.resolve().then(()=>create(profile)));
   overrides.set(original,{material:await pending.get(key)});
  }
  return overrides;
 };
}
