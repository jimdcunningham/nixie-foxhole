import {factionFlagPassMask} from './surface-decal-pass.mjs';
import {catalogStructureOwner,catalogFactionFlag} from './catalog-faction-flags.mjs';
import {nativeMaterialPeer,nativeMaterialOverrides} from './native-material-peer.mjs';
import {normalizeWorldModelLayers,worldModelLayers,isVegetationLayer} from './world-model-layers.mjs';
import {filterVegetationPlacements} from './vegetation-density.mjs';
import {leaseFlattenedGeometry} from './shared-model-geometry.mjs';
import {completeLoadTasks} from '../runtime/load-tasks.mjs';
import {prioritizeRegionPrototypes} from '../runtime/progressive-loading.mjs';
import {catalogBindingFor,catalogWorldPlacements} from './catalog-world-policy.mjs';
import {isResourceFieldPrototype,resourceFieldPlacements} from './resource-field-placements.mjs';
import {createWorldActorVisibility} from './world-actor-visibility.mjs';
import {craneSpawnPlacements} from './crane-spawn-placements.mjs';
import {isMirroredTransform,createMirroredGeometryCache} from './mirrored-geometry.mjs';
import {modelMaterialNames} from '../runtime/model-material-names.mjs';
import {BridgeRoadSeams} from './bridge-road-seams.mjs';
import{eligibleNightPrototype,emitterShapes,placeEmitter}from'./night-light-policy.mjs';
import{createDistanceLod,setLodSlotVisible}from'./distance-lod.mjs';
import{uploadLodVisibility}from'./lod-visibility-upload.mjs';
import{Assets}from'pixi.js';
import{Container3D,Model3D,Mesh3D,Geometry3D,Material3D,Matrix4,BatchedMesh3D,RenderPassBit}from'@pixi/3d';
import{bounds,classify,clipWorld}from'./world-geometry.mjs';
import{usesDedicatedWaterPass}from'./native-water-policy.mjs';
import{hideViewerEffect}from'./viewer-effects-policy.mjs';
import{isWaterStencil}from'./water-stencil.mjs';
function geometry(v,indices,keepColors=true){const positions=new Float32Array(v.length*3),normals=new Float32Array(v.length*3),uvs=new Float32Array(v.length*2),colors=keepColors?new Float32Array(v.length*4):undefined;for(let i=0;i<v.length;i++){const p=v[i];for(let j=0;j<3;j++){positions[i*3+j]=p[j];normals[i*3+j]=p[j+3];}uvs[i*2]=p[6];uvs[i*2+1]=p[7];if(colors)for(let j=0;j<4;j++)colors[i*4+j]=p[j+12];}return new Geometry3D({positions,normals,uvs,...(colors?{colors}:{}),indices,quantizeNormals:false});}
export {attributeReader} from './geometry-attributes.mjs';

export async function loadWorldModels({region,json,status,root,flagTexture,teamAt,batchLayout='category',assetUrl=url=>url,loadModel=url=>Assets.load(url),signal,concurrency=24,catalogResourceFields=false,catalog,progressive=false,optimize=true,vegetationDensity='full',vegetationShadows=true,windMaterials,priorityPosition,onLayout=()=>{},publishBatch=build=>build(),categories,bridgesOnly=false,worldData,visibilityData,actorVisibility:sharedActorVisibility,flagSurfacePass=false}){
 const [data,lodManifest,nightManifest]=await Promise.all([Promise.resolve(worldData||json(`${region}/world.json`)).then(normalizeWorldModelLayers),!optimize||new URLSearchParams(location.search).has("atlasBake")?Promise.resolve({assets:{}}):json(`${region}/lod-manifest.json`),json(`${region}/night-materials.json`)]),layers={};for(const k of worldModelLayers){layers[k]=new Container3D({label:k});root.addChild(layers[k]);}
 // Legacy component and rock exports mark embedded foliage opaque and use an
 // RGB-only copy of its albedo. Reuse alpha from an explicitly masked native
 // foliage prototype with the same logical texture; never infer it from RGB.
 const foliageAlphaSources=new Map();
 for(const p of (visibilityData||data).prototypes){
  if(!/\/Foliage\//i.test(p.path||'')||p.materials?.some(m=>m.diffuse&&m.masked!==true))continue;
  for(const m of p.materials||[])if(m.masked&&m.diffuse&&!foliageAlphaSources.has(m.diffuse))foliageAlphaSources.set(m.diffuse,{prototype:p,name:m.name});
 }
 const actorVisibility=sharedActorVisibility||createWorldActorVisibility({region,prototypes:(visibilityData||data).prototypes}),actorSlots=[];let appliedVisibilityRevision=-1;
 const counts={prototypes:0,resources:0,placements:0,parts:0,inside:0,crossing:0,outside:0,triangles:0,minY:Infinity,maxY:-Infinity,byCategory:{},failed:[],flagBuildings:0,riverPlacementsInWaterPass:0,waterStencilPlacements:0,hiddenLightEffectParts:0,lodResources:0,lodParts:0,lodFailures:[]},bridgeRoadSeams=new BridgeRoadSeams(),sources=[],owned=[],batches=[],flagSlots=[],sites=[],partsCache=new Map(),lodCache=new Map(),lodRecords=[],clearanceBatches=[],mirroredGeometry=createMirroredGeometryCache(),pooledGeometry=new Set(),geometryLeases=[],windLeases=[],nightMaterials=new Map(),emitters=[];const pendingSlots=new Map();let next=0,done=0,lastStatus=0,disposed=false;
 async function addBatch(slots,category,label,level=0){return publishBatch(()=>{const batch=new BatchedMesh3D({size:slots.length,cull:'gpu',label});batch.lodOnly=level>0;if(progressive&&level>0)batch.visible=level===2;const dirty=new Map();for(let i=0;i<slots.length;i++){const s=slots[i];batch.setGeometryAt(i,s.geometry);batch.setMaterialAt(i,s.material);batch.setMatrixAt(i,s.matrix);batch.items[i].receiveShadow=true;actorSlots.push({batch,index:i,actor:s.row?.actor,flag:s.flag,category,mask:(s.material.alphaMode==='blend'?RenderPassBit.TRANSPARENT:RenderPassBit.OPAQUE)|(!isVegetationLayer(category)||vegetationShadows?RenderPassBit.SHADOW:0)});batch.setItemActive(i,actorVisibility.visible(s.row?.actor)&&!s.flag?(s.material.alphaMode==='blend'?RenderPassBit.TRANSPARENT:RenderPassBit.OPAQUE)|(!isVegetationLayer(category)||vegetationShadows?RenderPassBit.SHADOW:0):0);if(s.record){s.record.levels[level].push({batch,index:i,triangles:s.geometry.indexBuffer.data.length/3});if(progressive){const near=priorityPosition&&Math.hypot(...s.record.center.map((value,i)=>value-priorityPosition[i]))-s.record.radius<180;setLodSlotVisible(batch,i,level===(near?0:2),dirty);}}if(s.flag)flagSlots.push({batch,index:i,source:s.material,name:s.flagName,key:s.key,matrix:s.row.matrix,actor:s.row.actor,team:teamAt(s.row.matrix[12],s.row.matrix[14])});}for(const [changed,[min,max,rows]]of dirty){uploadLodVisibility(changed.batch.storeBuffer,min,max,rows);changed.batch._visibilityDirtyId++;}layers[category]?.addChild(batch);batches.push(batch);if(level===0)clearanceBatches.push(batch);return batch;});}
 function flatten(source,p,override){const model=new Model3D(source),parts=[],names=modelMaterialNames(source,p.materials?.map(material=>material.name));model.scale.z=-1;if(p.anchor)model.position.set(p.anchor.x,p.anchor.y,p.anchor.z);
  function visit(node,parent){node.updateLocalTransform();const matrix=parent.clone().multiply(node.localTransform);if(node instanceof Mesh3D){const g=node.geometry,replacement=override?.get(node.material),materialName=replacement?.name||names.get(node.material)||'';
    if(hideViewerEffect(materialName)){counts.hiddenLightEffectParts++;for(const child of node.children)visit(child,matrix);return;}

    const material=replacement?.material||override?.get(materialName)||node.material,keepColors=material.vertexColors;
    // Native model materials disable vertex colors; retain color data only
    // for a material that actually consumes it. Positions/normals/UVs stay exact.
    const lease=leaseFlattenedGeometry(g,matrix,keepColors),flat=lease.geometry,box=lease.bounds,index=flat.indexBuffer.data;
    geometryLeases.push(lease);pooledGeometry.add(flat);owned.push(flat);
    parts.push({get vertices(){return lease.vertices;},indices:index,geometry:flat,material,materialName,bounds:box,flag:catalogFactionFlag('',materialName),flagName:materialName,key:p.file+'-'+source.materials.indexOf(node.material),lampShapes:!override&&eligibleNightPrototype(p.name)&&nightManifest.assets[p.file]?.materials[materialName]?emitterShapes(lease.vertices,index,nightManifest.assets[p.file].materials[materialName]):[]});

   }for(const child of node.children)visit(child,matrix);
  }visit(model,new Matrix4());model.destroy({children:true});return parts;
 }
 async function partsFor(p){const nightEntry=eligibleNightPrototype(p.name)?nightManifest.assets[p.file]:null,key=p.file+JSON.stringify(p.anchor||null)+!!nightEntry;if(partsCache.has(key))return partsCache.get(key);const promise=(async()=>{const url=assetUrl(`${region}/${nightEntry?.file||p.file}`),source=await loadModel(url);sources.push({source,url});if(nightEntry)for(const [name,config]of Object.entries(nightEntry.materials)){const material=source.material[name];if(!material?.emissive)throw Error('Night material has no emissive group: '+name);nightMaterials.set(material,config.strength);}for(const material of source.materials)material.vertexColors=false;
 if(/\/Foliage\//i.test(p.path||'')||p.materials?.some(m=>/\/Foliage\//i.test(m.source||''))){
  const names=modelMaterialNames(source,p.materials?.map(m=>m.name));
  for(const row of p.materials||[]){
   const foliage=/\/Foliage\//i.test(p.path||'')||/\/Foliage\//i.test(row.source||'');
   const peer=foliage&&row.masked===false&&foliageAlphaSources.get(row.diffuse);
   if(!peer||peer.prototype===p)continue;
   const reference=(await partsFor(peer.prototype)).find(part=>part.materialName===peer.name)?.material;
   if(reference?.alphaMode!=='mask')continue;
   for(const material of source.materials)if(names.get(material)===row.name&&material.alphaMode==='opaque'){
    material.textures.baseColor=reference.textures.baseColor;material.alphaMode='mask';material.alphaCutoff=reference.alphaCutoff;
   }
  }
 }
 const peer=nativeMaterialPeer(p,(visibilityData||data).prototypes);
 const overrides=peer?nativeMaterialOverrides(source,peer,await partsFor(peer)):null;
 let parts=flatten(source,p,overrides);if(windMaterials){const lease=windMaterials.acquire(p,parts);windLeases.push(lease);parts=lease.parts;}counts.resources++;return parts;})();partsCache.set(key,promise);return promise;}
 async function lodsFor(p,base){const entry=lodManifest.assets[p.file];if(!entry||p.kind==='building'||!['vegetation','trees','structures','rocks'].includes(p.category))return null;const key=p.file+JSON.stringify(p.anchor||null)+!!(eligibleNightPrototype(p.name)&&nightManifest.assets[p.file]);if(lodCache.has(key))return lodCache.get(key);const promise=(async()=>{try{const materialMap=new Map(base.map(part=>[part.materialName,part.material])),levels=[];for(const level of entry.levels){const source=await loadModel(assetUrl(level.file));sources.push({source,url:assetUrl(level.file)});const parts=flatten(source,p,materialMap);if(parts.some(part=>!materialMap.has(part.materialName)))throw Error('LOD material cannot be matched to native full-detail material');levels.push(parts);counts.lodResources++;}return levels;}catch(e){counts.lodFailures.push({name:p.name,error:String(e)});return null;}})();lodCache.set(key,promise);return promise;}
 let lastPublish=0;
 async function flushBuckets(all=false){for(const [key,slots]of pendingSlots){while(slots.length&&(all||slots.length>=512)){const [category,level]=key.split(':');await addBatch(slots.splice(0,progressive?512:slots.length),category,category+' LOD'+level,+level);}}}
 async function collect(slots,category,level,label){if(!slots.length)return;if(batchLayout==='prototype'){await addBatch(slots,category,label,level);return;}const key=category+':'+level;if(!pendingSlots.has(key))pendingSlots.set(key,[]);const bucket=pendingSlots.get(key);for(const slot of slots)bucket.push(slot);if(progressive){await flushBuckets();if(performance.now()-lastPublish>50){lastPublish=performance.now();await flushBuckets(true);}}}
 const variants=new Map();let flagGeneration=0;async function flags(teamOverride='live'){
  const generation=++flagGeneration;
  for(const s of flagSlots){const team=teamOverride==='live'?s.team:teamOverride;
   if(!['COLONIALS','WARDENS'].includes(team)||!actorVisibility.visible(s.actor)){s.batch.setItemActive(s.index,0);continue;}
   const key=s.key+'-'+team;let mat=variants.get(key);
   if(!mat){const texture=await flagTexture(team,s.source,s.name);if(disposed||generation!==flagGeneration)return;mat=new Material3D({baseColorTexture:texture||s.source.textures.baseColor,roughness:.9,doubleSided:true,alphaMode:'mask',alphaCutoff:.3333});variants.set(key,mat);}
   if(disposed||generation!==flagGeneration)return;s.batch.setMaterialAt(s.index,mat);s.batch.setItemActive(s.index,flagSurfacePass?factionFlagPassMask(mat):RenderPassBit.OPAQUE|RenderPassBit.SHADOW);
  }
 }
 const selected=p=>(!categories||categories.includes(p.kind==='building'?'building':p.category))&&(!bridgesOnly||/bridge/i.test(p.name)&&!/proxy|collision|switch/i.test(p.name));
 const catalogPlacements=bridgesOnly?[]:catalogWorldPlacements(data,catalog).filter(p=>!categories||categories.includes(p.category));for(const p of catalogPlacements)if(p.kind==='fixed')sites.push({name:p.type,matrix:p.matrix});counts.catalogPlacements=catalogPlacements.length;
 function setWarState(state){actorVisibility.setWarState(state);if(appliedVisibilityRevision===actorVisibility.revision)return false;appliedVisibilityRevision=actorVisibility.revision;for(const s of actorSlots)s.batch.setItemActive(s.index,actorVisibility.visible(s.actor)&&!s.flag?s.mask:0);for(const s of flagSlots)s.team=catalogStructureOwner({matrix:s.matrix},state)||'NONE';if(flagSlots.length)void flags().catch(error=>{if(!disposed)counts.failed.push({name:'Faction flags',error:String(error)});});counts.warLayout={...actorVisibility.summary};return true;}function setVegetationShadows(enabled){if(vegetationShadows===enabled)return;vegetationShadows=enabled;for(const s of actorSlots)if(isVegetationLayer(s.category)){s.mask=enabled?s.mask|RenderPassBit.SHADOW:s.mask&~RenderPassBit.SHADOW;s.batch.setItemActive(s.index,actorVisibility.visible(s.actor)&&!s.flag?s.mask:0);}}
 const result={setVegetationShadows,setWarState,actorVisible:actorVisibility.visible,catalogPlacements,resourceFieldPlacements:resourceFieldPlacements(data),cranePlacements:craneSpawnPlacements({prototypes:data.prototypes.filter(p=>selected(p)&&!catalogBindingFor(p,catalog))}),lodRecords,bridgeRoadSeams,layers,counts,sites,flags,owned,sources,batches,clearanceBatches,lod:null,night:{materials:nightMaterials,emitters},dispose(){if(disposed)return;disposed=true;for(const layer of Object.values(layers))layer.removeFromParent();for(const b of batches)b.destroy();mirroredGeometry.destroy();for(const g of owned)if(!pooledGeometry.has(g))g.destroy(true);for(const lease of geometryLeases)lease.release();for(const layer of Object.values(layers))layer.destroy({children:false});for(const m of variants.values())m.destroy();for(const lease of windLeases)lease.release();}};
 if(!sharedActorVisibility)actorVisibility.setWarState(null);onLayout(result);const chosen=data.prototypes.filter(selected).map(p=>filterVegetationPlacements(p,vegetationDensity)).filter(p=>p.placements.length),ordered=progressive?prioritizeRegionPrototypes(chosen,priorityPosition):chosen;
 async function worker(){while(next<ordered.length&&!signal?.aborted){const p=ordered[next++];try{if(catalogBindingFor(p,catalog)){done++;continue;}if(catalogResourceFields&&isResourceFieldPrototype(p)){done++;continue;}if(/\/(?:Back|Front)SwitchMesh$/.test(p.name)){done++;continue;}
  // The dedicated water pass already renders the visible native river. Its
  // generic GLB copies include capture helpers and otherwise cause coincident
  // surface drawing plus striped self-shadowing. Keep rocks, boats and props.
  if(usesDedicatedWaterPass(p)){counts.riverPlacementsInWaterPass+=p.placements.length;done++;continue;}
  if(isWaterStencil(p)){counts.waterStencilPlacements+=p.placements.length;done++;continue;}
  const parts=await partsFor(p);if(!parts.length){done++;continue;}const nativeLods=bridgesOnly||!optimize?null:await lodsFor(p,parts),allBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};for(const part of parts)for(let a=0;a<3;a++){allBounds.min[a]=Math.min(allBounds.min[a],part.bounds.min[a]);allBounds.max[a]=Math.max(allBounds.max[a],part.bounds.max[a]);}
  const rows=[];for(const input of p.placements){const matrix=p.localMatrix?Array.from(new Matrix4().fromArray(input.matrix).multiply(new Matrix4().fromArray(p.localMatrix)).elements):input.matrix;const c=classify(allBounds,matrix);counts[c]++;if(c!=='outside')rows.push({...input,matrix,c});}if(!rows.length){done++;continue;}bridgeRoadSeams.collect(parts,rows,p.name);if(bridgesOnly){done++;continue;}
  const center=allBounds.min.map((v,a)=>(v+allBounds.max[a])/2),half=allBounds.min.map((v,a)=>(allBounds.max[a]-v)/2);for(const row of rows){if(!allBounds.min.every(Number.isFinite)||!allBounds.max.every(Number.isFinite))continue;const m=row.matrix;counts.minY=Math.min(counts.minY,m[1]*center[0]+m[5]*center[1]+m[9]*center[2]+m[13]-Math.abs(m[1])*half[0]-Math.abs(m[5])*half[1]-Math.abs(m[9])*half[2]);counts.maxY=Math.max(counts.maxY,m[1]*center[0]+m[5]*center[1]+m[9]*center[2]+m[13]+Math.abs(m[1])*half[0]+Math.abs(m[5])*half[1]+Math.abs(m[9])*half[2]);}
  const category=p.kind==='building'?'building':p.category,slots=[],lodSlots=[[],[]],lodBounds={min:[...allBounds.min],max:[...allBounds.max]};for(const level of nativeLods||[])for(const part of level)for(let a=0;a<3;a++){lodBounds.min[a]=Math.min(lodBounds.min[a],part.bounds.min[a]);lodBounds.max[a]=Math.max(lodBounds.max[a],part.bounds.max[a]);}for(const row of rows){const matrix=new Matrix4().fromArray(row.matrix),mirrored=isMirroredTransform(row.matrix);for(const part of parts)for(const shape of part.lampShapes||[]){const e=placeEmitter(shape,row.matrix,category,p.name);if(e){e.owner=row.actor||row.name||p.name+row.matrix.slice(12,15).join();emitters.push(e);}}if(nativeLods&&lodBounds.min.every(Number.isFinite)&&lodBounds.max.every(Number.isFinite)){const c=lodBounds.min.map((v,a)=>(v+lodBounds.max[a])/2),h=lodBounds.min.map((v,a)=>(lodBounds.max[a]-v)/2),m=row.matrix;counts.minY=Math.min(counts.minY,m[1]*c[0]+m[5]*c[1]+m[9]*c[2]+m[13]-Math.abs(m[1])*h[0]-Math.abs(m[5])*h[1]-Math.abs(m[9])*h[2]);counts.maxY=Math.max(counts.maxY,m[1]*c[0]+m[5]*c[1]+m[9]*c[2]+m[13]+Math.abs(m[1])*h[0]+Math.abs(m[5])*h[1]+Math.abs(m[9])*h[2]);}let record=null;if(nativeLods&&row.c==='inside'&&classify(lodBounds,row.matrix)==='inside'){const m=row.matrix,c=allBounds.min.map((v,a)=>(v+allBounds.max[a])/2),radius=Math.hypot(...allBounds.min.map((v,a)=>(allBounds.max[a]-v)/2))*Math.max(Math.hypot(...m.slice(0,3)),Math.hypot(...m.slice(4,7)),Math.hypot(...m.slice(8,11)));record={center:[m[0]*c[0]+m[4]*c[1]+m[8]*c[2]+m[12],m[1]*c[0]+m[5]*c[1]+m[9]*c[2]+m[13],m[2]*c[0]+m[6]*c[1]+m[10]*c[2]+m[14]],radius,category,cover:category==='vegetation'&&/grass|flower|groundcover|nettle|wheat|corn|reed|cattail/i.test(p.name),levels:[[],[],[]]};lodRecords.push(record);for(let l=0;l<2;l++)for(const part of nativeLods[l]){lodSlots[l].push({row,geometry:mirrored?mirroredGeometry.get(part.geometry):part.geometry,material:part.material,matrix,record});counts.lodParts++;}}for(const part of parts){let g=part.geometry,slotMatrix=matrix;if(row.c==='crossing'){const clipped=clipWorld(part.vertices,part.indices,row.matrix);if(!clipped.indices.length)continue;g=geometry(clipped.vertices,clipped.indices,part.material.vertexColors);owned.push(g);slotMatrix=new Matrix4();}else if(mirrored)g=mirroredGeometry.get(g);slots.push({geometry:g,material:part.material,matrix:slotMatrix,flag:part.flag,flagName:part.flagName,key:part.key,row,record});counts.triangles+=g.indexBuffer.data.length/3;}}
  await collect(slots,category,0,p.name);await collect(lodSlots[0],category,1,p.name+' LOD1');await collect(lodSlots[1],category,2,p.name+' LOD2');counts.parts+=slots.length;
  if(p.kind==='building'||/Bridge/i.test(p.name)||/^(FishingBoat0[123]|FishingBoat_C\/StaticMesh)$/.test(p.name)){for(const row of rows)sites.push({name:p.name,matrix:row.matrix});if(p.kind==='building'&&parts.some(p=>p.flag))counts.flagBuildings+=rows.length;}
  counts.prototypes++;counts.placements+=rows.length;counts.byCategory[category]=(counts.byCategory[category]||0)+rows.length;
 }catch(e){if(signal?.aborted)throw e;counts.failed.push({name:p.name,error:String(e)});console.error(p.name,e);}done++;const now=performance.now();if(now-lastStatus>=100||done===ordered.length){lastStatus=now;status(`Loading world ${done}/${ordered.length} · ${counts.placements.toLocaleString()} placements`);}if(done%5===0)await new Promise(resolve=>setTimeout(resolve,0));}}
 try{await completeLoadTasks(Array.from({length:concurrency},()=>worker()));await flushBuckets(true);pendingSlots.clear();partsCache.clear();lodCache.clear();signal?.throwIfAborted();result.lod=optimize?createDistanceLod(lodRecords,counts.triangles):null;counts.batchLayout=batchLayout;counts.batches=batches.length;await flags();return result;}catch(error){result.dispose();throw error;}
}


