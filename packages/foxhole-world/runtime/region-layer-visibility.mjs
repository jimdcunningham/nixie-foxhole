/** Keep layer switches independent of per-instance LOD visibility and the render graph. */
export function createRegionLayerVisibility({targets, details, terrain, shoulders}) {
 const keys=["terrain","building","structures","rocks","vegetation","infrastructure","roads","decals","puddles","water","effects","shell"];
 let previous;
 return (layers={},force=false)=>{
  if(!force&&previous&&keys.every(key=>(layers[key]!==false)===previous[key]))return;
  const flags=Object.fromEntries(keys.map(key=>[key,layers[key]!==false]));
  for(const key of keys)for(const target of targets[key]||[])target.visible=flags[key];
  terrain.visible=flags.terrain;
  shoulders.visible=flags.roads&&flags.terrain;
  details.syncLayers(flags);
  previous=flags;
 };
}
