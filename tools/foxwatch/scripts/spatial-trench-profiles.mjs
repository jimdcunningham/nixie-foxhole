/** Export one canonical native prototype per authored component. Placement remains runtime-derived. */
export async function prepareSpatialTrenchScene(asset,input,load){
 if(!/^trenchconnectort[123]$/.test(asset.id))return input;
 const sourceNodes=[];const visit=node=>{sourceNodes.push(node);(node.children??[]).forEach(visit);};input.scene.roots.forEach(visit);
 const height=name=>sourceNodes.find(node=>node.name?.split(':').at(-1)===name)?.unrealLocationCentimeters?.[2];
 const floorZ=height('FloorQuadrilateralCover');if(!Number.isFinite(floorZ))throw Error('Missing authored trench floor height: '+asset.id);
 const roofZ=height('BPTrenchConnectorRoofModSlot')??floorZ,defenseZ=height('LeftDefenseModSlot');
 const result=structuredClone(input);result.scene.roots=[];result.assets={meshes:[],materials:[]};
 delete result.spatialLayerGroups;delete result.spatialModifications;result.spatialTrenchParts={};
 const layers=[...(asset.renderLayers??[]).map(layer=>{
  const id=layer.i??layer.id,name=layer.cn??layer.componentName;
  // Raw declarations may include components absent from this tier's extracted scene.
  // Native mesh prototypes remain required even when absent from the preview pose.
  const absent=name&&!name.startsWith('mesh:')&&!sourceNodes.some(node=>node.name?.split(':').at(-1).toLowerCase()===name.split(':').at(-1).toLowerCase());
  return [id,asset.id+'/components/'+id+'.scene.json',absent];
 }),['floor','trencht'+asset.id.at(-1)+'/components/floor.scene.json']];
 for(const [id,path,absent]of layers){const part=await load(path);if(!part){if(absent)continue;throw Error('Missing trench spatial prototype: '+path);}
  const key='spatial-trench-'+id,copy=structuredClone(part),ids=new Map();
  for(const mesh of copy.assets.meshes){const qualified=key+':'+mesh.id;ids.set(mesh.id,qualified);mesh.id=qualified;result.assets.meshes.push(mesh);}
  result.assets.materials.push(...copy.assets.materials??[]);
  const qualify=node=>{node.id=key+':'+node.id;delete node.spatialGroup;if(node.meshId)node.meshId=ids.get(node.meshId);(node.children??[]).forEach(qualify);};copy.scene.roots.forEach(qualify);
  const z=id.startsWith('piece-') ? /^piece-trench(?:connector|barbed)/.test(id) ? defenseZ : /^piece-trencht3roof/.test(id) ? roofZ : floorZ : 0;
  if(!Number.isFinite(z))throw Error('Missing authored trench prototype height: '+id);
  result.scene.roots.push({id:key,name:key,visible:true,spatialGroup:key,unrealLocationCentimeters:[0,0,z],children:copy.scene.roots});result.spatialTrenchParts[id]=key;
 }
 return result;
}
export function spatialTrenchProfile(scene,document,exported){
 if(!scene.spatialTrenchParts)return undefined;const parts={};
 for(const[id,key]of Object.entries(scene.spatialTrenchParts)){
  const group=document.nodes.find(node=>node.name===exported.semanticGroups?.[key]),meshes=new Set();
  const visit=node=>{if(node.mesh!==undefined)meshes.add(node.mesh);(node.children??[]).forEach(index=>visit(document.nodes[index]));};if(group)visit(group);
  if(!meshes.size)throw Error('Trench prototype has no exported geometry: '+id);
  parts[id]={meshIndex:[...meshes][0],...(meshes.size>1?{meshIndices:[...meshes]}:{}),origin:[0,0,0]};
 }
 return {version:1,parts};
}
