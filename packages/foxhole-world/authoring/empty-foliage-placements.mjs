// Older SceneProbe exports emitted one standalone mesh for an empty native
// foliage component. Its container identity and explicit non-instanced flag
// distinguish this artifact from real instances, even at the region origin.
export function removeEmptyFoliagePlacements(data){
 let removed=0;
 const prototypes=data.prototypes.flatMap(prototype=>{
  const placements=prototype.placements.filter(row=>!(row.instanced===false&&/^InstancedFoliageActor_\d+$/.test(row.actor||'')&&/^FoliageInstancedStaticMeshComponent_\d+$/.test(row.name||'')));
  const count=prototype.placements.length-placements.length;removed+=count;
  return count?(placements.length?[{...prototype,placements}]:[]):[prototype];
 });
 return {world:removed?{...data,prototypes}:data,removed};
}
