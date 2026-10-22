const shadowAppearanceKey=Symbol.for('foxhole.world.shadow-appearance');
const shadowQualityKey=Symbol.for('nixie.spatial.shadow-quality');
const lightingProfileKey=Symbol.for('nixie.spatial.lighting-profile');

// Softer direct light and indirect fill retain detail and colour on shaded models.
// Saved scene controls still animate the host sun and moon.
export function worldLightingProfile(view){
 const camera=view.camera,p=camera?.position,ortho=camera?.mode==='orthographic'?(camera.orthographicSize||0)*(camera.zoom||1):0;
 const reach=Math.min(camera?.far||128000,128000,Math.max(2048,Math.abs(p?.z||0)*4,(camera?.near||0)*150,ortho*4));
 return {sunIntensity:4.5,ambientIntensity:2,environmentIntensity:.55,nightAmbientIntensity:.025,nightEnvironmentIntensity:.025,
  shadow:{cascades:3,maxDistance:reach,lambda:.7,bias:.00015,normalBias:.8,update:1}};
}
import {combineRegionPasses} from './region-render-passes.mjs';
const aliases={callahanspassagehex:'callahans',deadlandshex:'deadlands',lochmorhex:'lochmor',fishermansrowhex:'fishermans',weatheredexpansehex:'weathered'};
export function regionIdForKey(key){return aliases[key.toLowerCase()]||key.replace(/Hex$/i,'').toLowerCase();}

export function selectedSpatialRegions({enabled,regionKeys,mode}){return enabled&&mode!=='flat'?[...new Set(regionKeys.map(regionIdForKey))]:[];}

// Native edge order, converted from metres/Y-up to the board's pixel frame.
const neighbors=[[-1638,945],[0,1890],[1638,945],[1638,-945],[0,-1890],[-1638,-945]];
export function regionShellEdges(position,others){return neighbors.map(([x,z])=>!others.some(other=>Math.abs(other.x-position.x-x*32)<1&&Math.abs(other.y-position.y+z*32)<1));}

/** Region residency follows explicit selection. Only preparation is queued. */
export class FoxholeRegionSceneController {
 constructor({baseUrl,loadRegion,fetcher=fetch,onStatus=null,concurrency=2,manageEnvironment=true}){if(!Number.isInteger(concurrency)||concurrency<1)throw new RangeError('Region preparation concurrency must be a positive integer');Object.assign(this,{baseUrl,loadRegion,onStatus,concurrency,manageEnvironment});this.fetcher=(...args)=>fetcher(...args);this.records=new Map();this.attachedPasses=[];this.combinedPasses=new Map();this.destroyedScenes=new WeakSet();this.view=null;this.index=null;this.indexLoad=null;this.indexController=new AbortController();this.loading=new Set();this.disposed=false;this.selectionKey='';this.cutouts=[];}
 disposeScene(scene){if(!scene||this.destroyedScenes.has(scene))return;this.destroyedScenes.add(scene);scene.root.removeFromParent();scene.destroy();}
 reconcile(){
  if(!this.view||this.view.destroyed)return;
  const scenes=[...this.records.values()].map(r=>r.scene).filter(Boolean),shared=new Map(),combined=new Map(),passes=[];
  for(const scene of scenes){const common=new Set([...Object.values(scene.sharedPasses||{}),...Object.values(scene.combinedPasses||{})]);passes.push(...scene.passes.filter(pass=>!common.has(pass)));for(const [key,pass]of Object.entries(scene.sharedPasses||{}))if(!shared.has(key))shared.set(key,pass);for(const [key,pass]of Object.entries(scene.combinedPasses||{})){if(!combined.has(key))combined.set(key,[]);combined.get(key).push(pass);}}
  for(const [key,owners]of combined){let cached=this.combinedPasses.get(key);if(!cached||owners.length!==cached.owners.length||owners.some((owner,i)=>owner!==cached.owners[i])){cached={owners,pass:combineRegionPasses(owners)};this.combinedPasses.set(key,cached);}passes.push(cached.pass);}
  for(const key of this.combinedPasses.keys())if(!combined.has(key))this.combinedPasses.delete(key);
  passes.push(...shared.values());
  const attached=[...this.records.values()].filter(r=>r.scene);for(const r of attached)r.scene.setShellEdges?.(regionShellEdges(r.position,attached.filter(other=>other!==r).map(other=>other.position)));
  if(passes.length!==this.attachedPasses.length||passes.some((pass,i)=>pass!==this.attachedPasses[i])){this.view.passes=[...this.view.passes.filter(pass=>!this.attachedPasses.includes(pass)),...passes];this.attachedPasses=passes;}
  const environment=this.manageEnvironment?scenes.find(scene=>scene.environment)?.environment:undefined;
  if(environment&&!this.ownsEnvironment){this.previousEnvironment=this.view.environment;this.ownsEnvironment=true;}
  if(this.ownsEnvironment)this.view.environment=environment||this.previousEnvironment;
  if(!environment)this.ownsEnvironment=false;
 }
 remove(record){record.retired=true;record.controller.abort();this.records.delete(record.id);this.reconcile();this.disposeScene(record.scene);}
 restoreCull(){if(this.cullView){this.cullView.cull=this.previousCull;if(this.cullView._sceneBatch)this.cullView._sceneBatch.cull=this.previousSceneCull;this.cullView=null;}}
 restoreLighting(){if(!this.lightingView)return;const view=this.lightingView;view.toneMapping=this.previousToneMapping;if(this.hadLightingProfile)view[lightingProfileKey]=this.previousLightingProfile;else delete view[lightingProfileKey];this.lightingView=null;}
 applyLighting(view){if(!this.lightingView){this.lightingView=view;this.previousToneMapping=view.toneMapping;this.hadLightingProfile=Object.hasOwn(view,lightingProfileKey);this.previousLightingProfile=view[lightingProfileKey];}view[lightingProfileKey]=worldLightingProfile(view);view.toneMapping='aces';}
 restoreShadows(){if(!this.shadowView)return;const view=this.shadowView;view.shadowQuality=this.previousShadowQuality;view.shadowFilter=this.previousShadowFilter;if(this.hadShadowOverride)view[shadowQualityKey]=this.previousShadowOverride;else delete view[shadowQualityKey];if(this.previousShadowAppearance===undefined)delete view[shadowAppearanceKey];else view[shadowAppearanceKey]=this.previousShadowAppearance;view._invalidateMaterialShaders?.();this.shadowView=null;}
 applyShadows(view,quality){if(!this.shadowView){this.shadowView=view;this.previousShadowAppearance=view[shadowAppearanceKey];this.previousShadowQuality=view.shadowQuality;this.previousShadowFilter=view.shadowFilter;this.hadShadowOverride=Object.hasOwn(view,shadowQualityKey);this.previousShadowOverride=view[shadowQualityKey];}view[shadowQualityKey]=quality;view.shadowQuality=quality==='off'?'medium':quality;view.shadowFilter=quality==='low'?(this.softShadows?'pcf':'hard'):'pcf-high';const a=view[shadowAppearanceKey];if(!a||a.soft!==this.softShadows||a.strength!==this.shadowStrength){view[shadowAppearanceKey]={soft:this.softShadows,strength:this.shadowStrength};view._invalidateMaterialShaders?.();}}
 retire(){for(const record of [...this.records.values()])this.remove(record);this.selectionKey='';this.restoreCull();this.restoreShadows();this.restoreLighting();}
 detailLayers(record){
  if(!this.adaptiveStreaming)return this.layers;
  const camera=this.view?.camera,p=camera?.position;if(!p)return this.layers;
  const dx=Math.max(0,Math.abs((p.x-record.position.x)/32)-1092),dz=Math.max(0,Math.abs((p.y+record.position.y)/32)-945);
  const height=camera.mode==='orthographic'?0:Math.max(0,p.z/32-128),distance=Math.hypot(dx,dz,height);
  const ortho=camera.mode==='orthographic'?2*camera.orthographicSize*camera.zoom*this.view.height/this.view.width/32:0;
  const now=performance.now(),near=distance<(record.detailResident?1500:1100)&&(!ortho||ortho<3500);
  if(near)record.detailSeen=now;
  record.detailResident=near||!!record.detailResident&&now-(record.detailSeen??-Infinity)<8000;
  return record.detailResident?this.layers:{...this.layers,building:false,structures:false,rocks:false,trees:false,vegetation:false,infrastructure:false,roads:false,decals:false,puddles:false,effects:false};
 }
 sync({view,settings,mode,regions,position={x:0,y:0},deltaMS,warState}){
  if(this.disposed)return;
  if(!this.terrainOverlays||this.terrainOverlays.rdz!==(settings.terrainRdz===true)||this.terrainOverlays.topo!==(settings.terrainTopo===true))this.terrainOverlays={rdz:settings.terrainRdz===true,topo:settings.terrainTopo===true};
  this.softShadows=settings.softShadows!==false;this.shadowStrength=['medium','strong'].includes(settings.shadowStrength)?settings.shadowStrength:'light';this.waterReflections=settings.waterReflections!==false;this.vegetationShadows=settings.vegetationShadows!==false;this.layers=settings.worldLayers;this.frustumCulling=settings.frustumCulling!==false;this.ambientOcclusion=settings.ambientOcclusion!==false;this.shadowQuality=['off','low','high'].includes(settings.shadowQuality)?settings.shadowQuality:'medium';const vegetationDensity=['reduced','minimal'].includes(settings.vegetationDensity)?settings.vegetationDensity:'full',adaptiveStreaming=settings.adaptiveStreaming===true,modelLod=settings.modelLod===true,terrainLod=settings.terrainLod===true,adaptiveTextures=settings.adaptiveTextures===true,terrainSurface=['plain','map'].includes(settings.terrainSurface)?settings.terrainSurface:'native';
  if(this.view!==view||this.adaptiveStreaming!==adaptiveStreaming||this.modelLod!==modelLod||this.terrainLod!==terrainLod||this.adaptiveTextures!==adaptiveTextures||this.vegetationDensity!==vegetationDensity||this.terrainSurface!==terrainSurface){this.retire();this.view=view;this.adaptiveStreaming=adaptiveStreaming;this.modelLod=modelLod;this.terrainLod=terrainLod;this.adaptiveTextures=adaptiveTextures;this.vegetationDensity=vegetationDensity;this.terrainSurface=terrainSurface;}
  const ids=selectedSpatialRegions({...settings,mode}),sources=regions||ids.map(id=>({id,position,warState}));
  if(ids.length){this.applyShadows(view,this.shadowQuality);this.applyLighting(view);}else{this.restoreShadows();this.restoreLighting();}
  if(ids.length){if(!this.cullView){this.cullView=view;this.previousCull=view.cull;this.previousSceneCull=view._sceneBatch?.cull;}view.cull=this.frustumCulling?'gpu':'off';if(view._sceneBatch)view._sceneBatch.cull=view.cull;}else this.restoreCull();
  const desired=new Map(sources.filter(r=>ids.includes(r.id)).map(r=>[r.id,r]));
  const key=[...desired.keys()].sort().join('|'),selectionChanged=key!==this.selectionKey;if(selectionChanged){this.selectionKey=key;this.started=performance.now();}
  for(const record of [...this.records.values()]){const source=desired.get(record.id);if(!source||source.position.x!==record.position.x||source.position.y!==record.position.y)this.remove(record);}
  for(const [id,source]of desired){let record=this.records.get(id);if(!record){record={...source,id,controller:new AbortController(),state:{phase:'Queued',downloadBytes:0},scene:null,retired:false,started:false};this.records.set(id,record);}record.warState=source.warState;if(record.preparing&&record.preparing!==record.scene)record.preparing.setLayers?.(this.detailLayers(record));if(record.preparing){record.preparing.setFrustumCulling?.(this.frustumCulling);record.preparing.setAmbientOcclusion?.(this.ambientOcclusion);record.preparing.setWaterReflections?.(this.waterReflections);record.preparing.setVegetationShadows?.(this.vegetationShadows);record.preparing.setPlanningOverlays?.(this.terrainOverlays);}
   if(record.scene){record.scene.setPlanningOverlays?.(this.terrainOverlays);record.scene.setAmbientOcclusion?.(this.ambientOcclusion);record.scene.setWaterReflections?.(this.waterReflections);record.scene.setVegetationShadows?.(this.vegetationShadows);record.scene.setFrustumCulling?.(this.frustumCulling);record.scene.setWarState?.(record.warState);record.scene.setLayers?.(this.detailLayers(record));const camera=view.camera,cp=camera?.position,scale=32;if(cp)record.scene.update?.({deltaMS,camera:{position:[(cp.x-record.position.x)/scale,cp.z/scale,(cp.y+record.position.y)/scale],height:view.height,fov:camera.fov||45,planes:camera.frustum?.planesData,orthographicHeight:camera.mode==='orthographic'?2*camera.orthographicSize*camera.zoom*view.height/view.width/scale:null}});}
  }
  this.pump();if(selectionChanged&&desired.size)this.report();if(!desired.size)this.onStatus?.({phase:'idle'});
 }
 report(){
  if(!this.onStatus)return;
  const records=[...this.records.values()];if(!records.length){this.onStatus?.({phase:'idle'});return;}
  const ready=records.filter(r=>r.state.phase==='Ready'),failed=records.filter(r=>r.state.phase==='error'),current=records.filter(r=>r.started&&!['Ready','error'].includes(r.state.phase)),done=ready.length+failed.length===records.length;
  const metrics={downloadBytes:records.reduce((n,r)=>n+(r.state.downloadBytes||0),0),regionCount:records.length,readyRegions:ready.length,failedRegions:failed.length,loadingRegions:current.length};
  if(records.length===1){this.onStatus?.({...records[0].state,region:records[0].id,...metrics});return;}
  this.onStatus?.({...metrics,phase:done?(failed.length?'error':'Ready'):`Loading regions ${ready.length}/${records.length}${current.length>1?' - '+current.length+' preparing':current[0]?' - '+current[0].id+': '+current[0].state.phase:''}`,readyMs:done?performance.now()-this.started:undefined,error:failed.length?failed.map(r=>r.id+': '+r.state.error).join('; '):undefined});
 }
 pump(){
  // Retired jobs keep their slots until all asynchronous resources have drained.
  if(this.disposed||[...this.loading].some(record=>record.retired))return;
  while(this.loading.size<this.concurrency){const record=[...this.records.values()].find(r=>!r.started);if(!record)return;record.started=true;this.loading.add(record);void this.start(record).finally(()=>{this.loading.delete(record);this.pump();});}
 }
 loadIndex(){
  if(this.index)return Promise.resolve(this.index);
  // The metadata request belongs to the controller, not either region's lifetime.
  return this.indexLoad??=(async()=>{const response=await this.fetcher(this.baseUrl+'index.json',{signal:this.indexController.signal,cache:'no-cache'});if(!response.ok)throw Error('The region assets are unavailable ('+response.status+').');const index=await response.json();this.indexController.signal.throwIfAborted();if(index.version!==1)throw Error('Unsupported region bundle version.');return this.index=index;})().catch(error=>{this.indexLoad=null;throw error;});
 }
 async start(record){
  const {id,position,controller}=record,signal=controller.signal;record.state={phase:'Downloading Region',downloadBytes:0};this.report();
  const valid=()=>!this.disposed&&!record.retired&&!signal.aborted&&this.records.get(id)===record;
  const adopt=scene=>{if(!valid()){this.disposeScene(scene);return false;}scene.setPlanningOverlays?.(this.terrainOverlays);scene.setFrustumCulling?.(this.frustumCulling);scene.setAmbientOcclusion?.(this.ambientOcclusion);scene.setWaterReflections?.(this.waterReflections);scene.setVegetationShadows?.(this.vegetationShadows);scene.setWarState?.(record.warState);scene.setLayers?.(this.detailLayers(record));if(this.cutouts.length)scene.setGroundCutouts?.(this.cutouts);if(record.scene!==scene){record.scene=scene;this.view.root.addChild(scene.root);this.reconcile();}return true;};
  try{
   await this.loadIndex();
   signal.throwIfAborted();const entry=this.index.regions[id];if(!entry)throw Error('This region is not available in the assets bundle yet.');
   const cp=this.view.camera?.position;
   const scene=await this.loadRegion({baseUrl:this.baseUrl,entry,frame:{...position,scale:32},signal,progressive:true,ambientOcclusion:this.ambientOcclusion,waterReflections:this.waterReflections,vegetationShadows:this.vegetationShadows,vegetationDensity:this.vegetationDensity,adaptiveStreaming:this.adaptiveStreaming,modelLod:this.modelLod,terrainLod:this.terrainLod,adaptiveTextures:this.adaptiveTextures,frustumCulling:this.frustumCulling,terrainSurface:this.terrainSurface,layers:this.detailLayers(record),onSceneCreated:scene=>{record.preparing=scene;},priorityPosition:cp?[(cp.x-position.x)/32,cp.z/32,(cp.y+position.y)/32]:undefined,onSceneReady:adopt,onProgress:state=>{if(valid()){record.state=this.onStatus?{...state,totalBytes:entry.downloadBytes}:state;this.report();}}});
   if(!adopt(scene))return;record.state={phase:'Ready',...scene.metrics};this.report();
  }catch(error){const scene=record.scene;record.scene=null;this.reconcile();this.disposeScene(scene);if(valid()){record.state={...record.state,phase:'error',error:error instanceof Error?error.message:String(error)};console.error('Foxhole region load failed',id,error);this.report();}}
 }
 diagnostics(){
  const records=[...this.records.values()];if(!records.length)return[];
  const attached=records.filter(r=>r.scene).length,errors=records.filter(r=>r.state.phase==='error').length,bytes=records.reduce((n,r)=>n+(r.state.downloadBytes||r.scene?.metrics?.downloadBytes||0),0);
  const lines=[`regions:${records.length}  attached:${attached}  preparing:${this.loading.size}  errors:${errors}  downloaded:${(bytes/1048576).toFixed(1)} MiB  mode:progressive ${this.adaptiveStreaming?'streaming':'resident'} / cull:${this.frustumCulling?'frustum':'off'}`];
  lines.push(`models:${this.modelLod?'LOD':'source'}  terrain:${this.terrainLod?'LOD':'source'}  terrain textures:${this.adaptiveTextures&&this.terrainSurface==='native'?'adaptive':'source'}`);
  lines.push(`AO:${this.ambientOcclusion?'on':'off'}  shadows:${this.shadowQuality}  casters:${this.view?.lights?.filter(light=>light.canCastShadow).length||0}  vegetation:${this.vegetationDensity}`);
  if(records.length===1){const r=records[0],m=r.scene?.metrics||r.state;lines.push(`region:${r.id}  ${r.state.phase}${m.readyMs===undefined?'':'  prep total:'+ (m.readyMs/1000).toFixed(1)+' s'}${m.firstVisibleMs===undefined?'':'  terrain:'+ (m.firstVisibleMs/1000).toFixed(1)+' s'}`);}
  const lightBudgets=new Set(records.map(r=>r.scene?.metrics?.catalogLights).filter(Boolean));for(const lights of lightBudgets)lines.push(`catalog lights:${lights.active}/${lights.budget}  sources:${lights.candidates}`);
  for(const r of records)if(r.state.error)lines.push(`region error ${r.id}: ${String(r.state.error).slice(0,300)}`);
  return lines;
 }
 streamingStats(){const cells=[...this.records.values()].flatMap(r=>Object.values(r.scene?.metrics?.modelCells||{}));return{resident:cells.reduce((n,c)=>n+c.resident,0),loading:cells.reduce((n,c)=>n+c.loading,0),total:cells.reduce((n,c)=>n+c.total,0)};}
 terrainStats(){const stats={chunks:0,visible:0,detail:0,draws:0,triangles:0,bytes:0,pending:0,errors:0};for(const r of this.records.values()){const g=r.scene?.metrics?.terrainGeometry;if(!g)continue;stats.chunks+=g.chunks||0;stats.visible+=g.visibleChunks||0;stats.detail+=g.detailChunks||0;stats.draws+=g.draws||0;stats.triangles+=g.triangles||0;stats.bytes+=g.bytes||0;stats.pending+=g.pending?1:0;stats.errors+=g.error?1:0;}return stats;}
 tourRegions(){return [...this.records.values()].filter(r=>r.scene?.createRoadTour&&!r.retired).map(r=>({id:r.id,position:r.position,scene:r.scene}));}
 sampleWater(x,y){if(this.layers?.water===false)return null;let highest=null;for(const r of this.records.values()){const value=r.scene?.sampleWater?.(x,y);if(value!=null&&Number.isFinite(value))highest=highest===null?value:Math.max(highest,value);}return highest;}
 sampleGround(x,y){let highest=this.sampleWater(x,y);if(this.layers?.terrain!==false)for(const r of this.records.values()){const value=r.scene?.sampleGround?.(x,y);if(value!=null&&Number.isFinite(value))highest=highest===null?value:Math.max(highest,value);}return highest;}
 setGroundCutouts(volumes){this.cutouts=volumes;for(const r of this.records.values())r.scene?.setGroundCutouts?.(volumes);}
 get active(){return [...this.records.values()].some(r=>r.scene);}
 destroy(){if(this.disposed)return;this.disposed=true;this.indexController.abort();this.retire();this.onStatus?.({phase:'idle'});}
}
