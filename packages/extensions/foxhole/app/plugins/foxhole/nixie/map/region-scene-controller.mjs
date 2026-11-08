const shadowAppearanceKey=Symbol.for('foxhole.world.shadow-appearance');
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

/** Union transfer observations shared across simultaneous region loads. */
export function summarizeTerrainTransfers(records){
 const seen=new Map();for(const record of records){const transfers=record.state?.terrainTransfers||record.scene?.metrics?.terrainTransfers;for(const event of transfers?.events||[])if(event?.id&&!seen.has(event.id))seen.set(event.id,event);}
 const result={bytes:0,observed:0,unknown:0,cached:0};for(const event of seen.values()){if(event.kind==='observed'&&Number.isFinite(event.bytes)&&event.bytes>0){result.bytes+=event.bytes;result.observed++;}else if(event.kind==='http-cache')result.cached++;else result.unknown++;}return result;
}
/** Region residency follows explicit selection. Only preparation is queued. */
export class FoxholeRegionSceneController {
 constructor({baseUrl,loadRegion,indexLoader=null,fetcher=fetch,onStatus=null,concurrency=2,manageEnvironment=true,deferTerrainDetail=false,previewConcurrency=concurrency}){if(!Number.isInteger(concurrency)||concurrency<1)throw new RangeError('Region preparation concurrency must be a positive integer');Object.assign(this,{baseUrl,loadRegion,indexLoader,onStatus,concurrency,manageEnvironment,deferTerrainDetail,previewConcurrency});this.fetcher=(...args)=>fetcher(...args);this.records=new Map();this.attachedPasses=[];this.combinedPasses=new Map();this.destroyedScenes=new WeakSet();this.retiringScenes=new Set();this.disposal=new Promise(resolve=>{this.resolveDisposal=resolve;});this.view=null;this.index=null;this.indexLoad=null;this.indexController=new AbortController();this.loading=new Set();this.layerQueue=[];this.activeLayerLoads=0;this.mapImageRetirements=new Set();this.disposed=false;this.selectionKey='';this.selectionGeneration=0;this.cutouts=[];}
 disposeScene(scene){
  if(!scene||this.destroyedScenes.has(scene))return;this.destroyedScenes.add(scene);
  // Record the barrier before aborting or destroying; both can settle work synchronously.
  const tracked=typeof scene.whenDisposed==='function';this.retiringScenes.add(scene);
  try{scene.root.removeFromParent();scene.destroy();}catch(error){console.error('Foxhole region disposal failed',error);return;}
  if(tracked)Promise.resolve().then(()=>scene.whenDisposed()).then(()=>{this.retiringScenes.delete(scene);this.checkDisposed();this.pump();},error=>{console.error('Foxhole region disposal failed',error);});
  else this.retiringScenes.delete(scene);
 }
 checkDisposed(){if(this.disposed&&!this.loading.size&&!this.retiringScenes.size&&!this.mapImageRetirements.size)this.resolveDisposal();}
 whenDisposed(){return this.disposal;}
 canRetry(record){return !record.scene||this.loading.has(record)||typeof record.scene.whenDisposed==='function';}
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
 releaseMapImages(record,keep){for(const image of record.terrainMapImages||[]){if(image===keep)continue;record.terrainMapImages.delete(image);const pending=Promise.resolve().then(()=>image.release?.());this.mapImageRetirements.add(pending);void pending.catch(error=>console.error('Map image release failed',error)).finally(()=>{this.mapImageRetirements.delete(pending);this.checkDisposed();});}}
 updateMapImage(record,source){
  if(record.terrainMapImage?.key===source?.key)return;
  record.terrainMapImages??=new Set();if(record.terrainMapImage)record.terrainMapImages.add(record.terrainMapImage);if(source)record.terrainMapImages.add(source);record.terrainMapImage=source;
  const scene=record.scene||record.preparing;
  void Promise.resolve(scene?.setTerrainMapImage?.(source?.load)).then(applied=>{if(applied!==false)this.releaseMapImages(record,record.terrainMapImage);},error=>{if(!record.retired){record.state={...record.state,phase:'error',error:String(error)};this.report();}});
 }
 remove(record){record.retired=true;record.controller.abort();this.records.delete(record.id);this.reconcile();this.disposeScene(record.scene);if(record.terrainMapImage){record.terrainMapImages??=new Set();record.terrainMapImages.add(record.terrainMapImage);}this.releaseMapImages(record);}
 restoreLighting(){if(!this.lightingView)return;const view=this.lightingView;view.toneMapping=this.previousToneMapping;if(this.hadLightingProfile)view[lightingProfileKey]=this.previousLightingProfile;else delete view[lightingProfileKey];this.lightingView=null;}
 applyLighting(view){if(!this.lightingView){this.lightingView=view;this.previousToneMapping=view.toneMapping;this.hadLightingProfile=Object.hasOwn(view,lightingProfileKey);this.previousLightingProfile=view[lightingProfileKey];}view[lightingProfileKey]=worldLightingProfile(view);view.toneMapping='aces';}
 restoreShadows(){if(!this.shadowView)return;const view=this.shadowView;if(this.previousShadowAppearance===undefined)delete view[shadowAppearanceKey];else view[shadowAppearanceKey]=this.previousShadowAppearance;view._invalidateMaterialShaders?.();this.shadowView=null;}
 applyShadows(view){if(!this.shadowView){this.shadowView=view;this.previousShadowAppearance=view[shadowAppearanceKey];}const a=view[shadowAppearanceKey];if(!a||a.soft!==this.softShadows||a.strength!==this.shadowStrength){view[shadowAppearanceKey]={soft:this.softShadows,strength:this.shadowStrength};view._invalidateMaterialShaders?.();}}
 retire(){for(const record of [...this.records.values()])this.remove(record);this.selectionKey='';this.restoreShadows();this.restoreLighting();}
 retryFailed(){if(this.disposed)return false;const failed=[...this.records.values()].filter(record=>record.state.phase==='error'&&this.canRetry(record));if(!failed.length)return false;for(const record of failed)this.remove(record);this.pump();return true;}
 retryLoading(){
  if(this.disposed)return false;const active=[...this.records.values()].filter(record=>this.canRetry(record)&&record.started&&!record.retired&&!['Ready','error'].includes(record.state.phase));if(!active.length)return false;
  for(const record of active){const {controller,state,scene,retired,started,preparing,...source}=record;this.remove(record);this.records.set(record.id,{...source,controller:new AbortController(),state:{phase:'Queued',downloadBytes:0},scene:null,retired:false,started:false});}
  this.report();this.pump();return true;
 }
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
 sync({view,settings,mode,regions,position={x:0,y:0},deltaMS,wind,warState}){
  if(this.disposed)return;
  // One monotonic clock keeps newly resident regions on the same gust front.
  const windTime=performance.now()/1000;
  if(!this.terrainOverlays||this.terrainOverlays.rdz!==(settings.terrainRdz===true)||this.terrainOverlays.topo!==(settings.terrainTopo===true)||this.terrainOverlays.borders!==(settings.borders===true)||this.terrainOverlays.divisions!==(settings.voronoi===true)||this.terrainOverlays.faction!==(settings.faction===true)||this.terrainOverlays.grid!==(settings.grid===true)||this.terrainOverlays.front!==!!(settings.frontline||settings.frontAlt)||this.terrainOverlays.hotspots!==(settings.hotspots===true))this.terrainOverlays={rdz:settings.terrainRdz===true,topo:settings.terrainTopo===true,borders:settings.borders===true,divisions:settings.voronoi===true,faction:settings.faction===true,grid:settings.grid===true,front:!!(settings.frontline||settings.frontAlt),hotspots:settings.hotspots===true};
  this.softShadows=settings.softShadows!==false;this.shadowStrength=['medium','strong'].includes(settings.shadowStrength)?settings.shadowStrength:'light';this.waterReflections=settings.waterReflections!==false;this.vegetationShadows=settings.vegetationShadows!==false;this.vegetationWind=settings.vegetationWind!==false;this.layers=settings.worldLayers;this.frustumCulling=settings.frustumCulling!==false;this.ambientOcclusion=settings.ambientOcclusion!==false;const solidMap=settings.solidMap===true,vegetationDensity=['reduced','minimal'].includes(settings.vegetationDensity)?settings.vegetationDensity:'full',adaptiveStreaming=settings.adaptiveStreaming===true,modelLod=settings.modelLod===true,terrainLod=settings.terrainLod===true,adaptiveTextures=settings.adaptiveTextures===true,terrainSurface=['plain','map'].includes(settings.terrainSurface)?settings.terrainSurface:'native';
  const previewOnly=this.deferTerrainDetail&&terrainSurface==='map'&&!solidMap&&this.layers?.terrain===true
   &&Object.entries(this.layers).every(([key,value])=>key==='terrain'||key==='shell'||!value);
  if(this.view!==view||this.adaptiveStreaming!==adaptiveStreaming||this.modelLod!==modelLod||this.terrainLod!==terrainLod||this.adaptiveTextures!==adaptiveTextures||this.vegetationDensity!==vegetationDensity||this.terrainSurface!==terrainSurface||this.solidMap!==solidMap){this.retire();this.view=view;this.adaptiveStreaming=adaptiveStreaming;this.modelLod=modelLod;this.terrainLod=terrainLod;this.adaptiveTextures=adaptiveTextures;this.vegetationDensity=vegetationDensity;this.terrainSurface=terrainSurface;this.solidMap=solidMap;}
  this.previewOnly=previewOnly;
  const ids=selectedSpatialRegions({...settings,mode}),sources=regions||ids.map(id=>({id,position,warState}));
  if(ids.length){this.applyShadows(view);this.applyLighting(view);}else{this.restoreShadows();this.restoreLighting();}
  const desired=new Map(sources.filter(r=>ids.includes(r.id)).map(r=>[r.id,r]));
  const key=[...desired.keys()].sort().join('|'),selectionChanged=key!==this.selectionKey,positionChanged=[...this.records.values()].some(record=>{const source=desired.get(record.id);return !!source&&(source.position.x!==record.position.x||source.position.y!==record.position.y);});if(selectionChanged)this.selectionKey=key;if(selectionChanged||positionChanged){this.selectionGeneration++;this.started=performance.now();}
  for(const record of [...this.records.values()]){const source=desired.get(record.id);if(!source||source.position.x!==record.position.x||source.position.y!==record.position.y)this.remove(record);}
  for(const [id,source]of desired){let record=this.records.get(id);if(!record){record={...source,id,controller:new AbortController(),state:{phase:'Queued',downloadBytes:0},scene:null,retired:false,started:false};this.records.set(id,record);}this.updateMapImage(record,source.terrainMapImage);record.warState=source.warState;record.planningOverlays=source.planningOverlays;if(record.preparing&&record.preparing!==record.scene)record.preparing.setLayers?.(this.detailLayers(record));if(record.preparing){record.preparing.setFrustumCulling?.(this.frustumCulling);record.preparing.setAmbientOcclusion?.(this.ambientOcclusion);record.preparing.setWaterReflections?.(this.waterReflections);record.preparing.setVegetationShadows?.(this.vegetationShadows);record.preparing.setVegetationWind?.(this.vegetationWind);record.preparing.setPlanningOverlays?.({...this.terrainOverlays,...record.planningOverlays});}
   if(record.scene){record.scene.setPlanningOverlays?.({...this.terrainOverlays,...record.planningOverlays});record.scene.setAmbientOcclusion?.(this.ambientOcclusion);record.scene.setWaterReflections?.(this.waterReflections);record.scene.setVegetationShadows?.(this.vegetationShadows);record.scene.setVegetationWind?.(this.vegetationWind);record.scene.setFrustumCulling?.(this.frustumCulling);record.scene.setWarState?.(record.warState);record.scene.setLayers?.(this.detailLayers(record));const camera=view.camera,cp=camera?.position,scale=32;if(cp)record.scene.update?.({deltaMS,wind,time:windTime,camera:{position:[(cp.x-record.position.x)/scale,cp.z/scale,(cp.y+record.position.y)/scale],height:view.height,fov:camera.fov||45,planes:camera.frustum?.planesData,orthographicHeight:camera.mode==='orthographic'?2*camera.orthographicSize*camera.zoom*view.height/view.width/scale:null}});}
  }
  this.pump();this.refineNearbyTerrain();if((selectionChanged||positionChanged)&&desired.size)this.report();if(!desired.size)this.onStatus?.({phase:'idle'});
 }
 report(){
  if(!this.onStatus)return;
  const records=[...this.records.values()];if(!records.length){this.onStatus?.({phase:'idle'});return;}
  const ready=records.filter(r=>r.state.phase==='Ready'),failed=records.filter(r=>r.state.phase==='error'),current=records.filter(r=>r.started&&!['Ready','error'].includes(r.state.phase)),done=ready.length+failed.length===records.length;
  const metrics={downloadBytes:records.reduce((n,r)=>n+(r.state.downloadBytes||0),0),terrainTransfers:summarizeTerrainTransfers(records),regionCount:records.length,readyRegions:ready.length,failedRegions:failed.length,loadingRegions:current.length,selectionGeneration:this.selectionGeneration,retryableFailed:failed.some(r=>this.canRetry(r)),retryableLoading:current.some(r=>this.canRetry(r)&&!r.retired)};
  if(records.length===1){this.onStatus?.({...records[0].state,region:records[0].id,...metrics});return;}
  this.onStatus?.({...metrics,...(!done?{progress:{completed:ready.length,total:records.length,unit:'regions'}}:{}),phase:done?(failed.length?'error':'Ready'):`Loading regions ${ready.length}/${records.length}${current.length>1?' - '+current.length+' preparing':current[0]?' - '+current[0].id+': '+current[0].state.phase:''}`,readyMs:done?performance.now()-this.started:undefined,error:failed.length?failed.map(r=>r.id+': '+r.state.error).join('; '):undefined});
 }
 pump(){
  // Retired jobs keep their slots until all asynchronous resources have drained.
  if(this.disposed||this.retiringScenes.size||[...this.loading].some(record=>record.retired))return;
  const limit=this.previewOnly?this.previewConcurrency:this.concurrency;
  while(this.loading.size<limit){const queued=[...this.records.values()].filter(record=>!record.started),camera=this.view?.camera?.position;
   if(camera&&this.terrainSurface==='map')queued.sort((a,b)=>Math.hypot(camera.x-a.position.x,camera.y+a.position.y)-Math.hypot(camera.x-b.position.x,camera.y+b.position.y));
   const record=queued[0];if(!record)return;record.started=true;this.loading.add(record);void this.start(record).finally(()=>{this.loading.delete(record);this.checkDisposed();this.pump();});}
 }
 scheduleLayerTask(record,task,signal){
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const job={record,task,signal,resolve,reject};
   job.cancel=()=>{
    const index=this.layerQueue.indexOf(job);
    if(index<0)return;
    this.layerQueue.splice(index,1);
    reject(signal.reason);
   };
   signal.addEventListener('abort',job.cancel,{once:true});
   this.layerQueue.push(job);
   this.pumpLayerTasks();
  });
 }
 pumpLayerTasks(){
  const camera=this.view?.camera?.position;
  const distance=job=>Math.hypot(camera.x-job.record.position.x,camera.y+job.record.position.y);
  if(camera)this.layerQueue.sort((a,b)=>distance(a)-distance(b));
  while(this.activeLayerLoads<4&&this.layerQueue.length){
   const job=this.layerQueue.shift();
   job.signal.removeEventListener('abort',job.cancel);
   this.activeLayerLoads++;
   void Promise.resolve().then(()=>{
    job.signal.throwIfAborted();
    return job.task();
   }).then(job.resolve,job.reject).finally(()=>{
    this.activeLayerLoads--;
    this.pumpLayerTasks();
   });
  }
 }
 refineNearbyTerrain(){
  if(!this.deferTerrainDetail||this.loading.size||this.refiningTerrain||!this.records.size)return;
  if([...this.records.values()].some(record=>!record.started))return;
  const camera=this.view?.camera,p=camera?.position;if(!p)return;
  const altitude=p.z/32;
  if(camera.mode==='orthographic'){
   const height=2*camera.orthographicSize*camera.zoom*this.view.height/this.view.width/32;
   if(height>3500)return;
  }else if(altitude>700)return;
  const distance=record=>Math.hypot(p.x-record.position.x,p.y+record.position.y)/32;
  const nearest=[...this.records.values()].filter(record=>record.scene?.refineTerrain&&!record.refinementRequested&&distance(record)<1250)
   .sort((a,b)=>distance(a)-distance(b))[0];
  if(!nearest)return;
  nearest.refinementRequested=true;this.refiningTerrain=true;
  void nearest.scene.refineTerrain().catch(error=>{
   if(!nearest.retired)console.warn('Foxhole terrain refinement failed',nearest.id,error);
  }).finally(()=>{this.refiningTerrain=false;});
 }
 async loadIndex(signal){
  signal?.throwIfAborted();if(this.index)return this.index;this.indexController.signal.throwIfAborted();
  let record=this.indexLoad;
  // A canceled last subscriber owns the old request until its I/O has drained.
  // A later subscriber may wait for that generation, but cannot revive it.
  if(record?.controller.signal.aborted){
   if(signal)await new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}record.task.then(()=>{signal.removeEventListener('abort',abort);resolve();},()=>{signal.removeEventListener('abort',abort);resolve();});});
   else await record.task.catch(()=>{});
   signal?.throwIfAborted();return this.loadIndex(signal);
  }
  if(!record){
   record={controller:new AbortController(),waiters:0,settled:false};
   const requestSignal=AbortSignal.any([this.indexController.signal,record.controller.signal]);
   record.task=(async()=>{
    let index;
    if(this.indexLoader)index=await this.indexLoader(requestSignal);
    else{const response=await this.fetcher(this.baseUrl+'index.json',{signal:requestSignal,cache:'no-cache'});if(requestSignal.aborted){try{await response.body?.cancel();}catch{}requestSignal.throwIfAborted();}if(!response.ok){try{await response.body?.cancel();}catch{}throw Error('The region assets are unavailable ('+response.status+').');}index=await response.json();}
    requestSignal.throwIfAborted();if(index.version!==1)throw Error('Unsupported region bundle version.');if(this.indexLoad===record)this.index=index;return index;
   })().finally(()=>{record.settled=true;if(this.indexLoad===record)this.indexLoad=null;});
   this.indexLoad=record;
  }
  record.waiters++;let onAbort;
  try{
   const pending=signal?new Promise((resolve,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();record.task.then(resolve,reject);}):record.task;
   const index=await pending;signal?.throwIfAborted();return index;
  }finally{
   if(onAbort)signal.removeEventListener('abort',onAbort);record.waiters--;
   if(!record.waiters&&!record.settled){record.controller.abort();await record.task.catch(()=>{});}
  }
 }
 async start(record){
  const {id,position,controller}=record,signal=controller.signal;record.state={phase:'Downloading Region',downloadBytes:0};this.report();
  const valid=()=>!this.disposed&&!record.retired&&!signal.aborted&&this.records.get(id)===record;
  const adopt=scene=>{if(!valid()){this.disposeScene(scene);return false;}scene.prepareWindShadows?.(this.view);scene.prepareWaterSurfaceDepth?.(this.view);scene.setPlanningOverlays?.({...this.terrainOverlays,...record.planningOverlays});scene.setFrustumCulling?.(this.frustumCulling);scene.setAmbientOcclusion?.(this.ambientOcclusion);scene.setWaterReflections?.(this.waterReflections);scene.setVegetationShadows?.(this.vegetationShadows);scene.setVegetationWind?.(this.vegetationWind);scene.setWarState?.(record.warState);scene.setLayers?.(this.detailLayers(record));if(this.cutouts.length)scene.setGroundCutouts?.(this.cutouts);if(record.scene!==scene){record.scene=scene;this.view.root.addChild(scene.root);this.reconcile();}return true;};
  try{
   await this.loadIndex(signal);
   signal.throwIfAborted();const entry=this.index.regions[id];if(!entry)throw Error('This region is not available in the assets bundle yet.');
   const cp=this.view.camera?.position;
   const scene=await this.loadRegion({baseUrl:this.baseUrl,entry,frame:{...position,scale:32},signal,progressive:true,ambientOcclusion:this.ambientOcclusion,waterReflections:this.waterReflections,vegetationShadows:this.vegetationShadows,vegetationWind:this.vegetationWind,vegetationDensity:this.vegetationDensity,adaptiveStreaming:this.adaptiveStreaming,modelLod:this.modelLod,terrainLod:this.terrainLod,adaptiveTextures:this.adaptiveTextures,frustumCulling:this.frustumCulling,solidMap:this.solidMap,terrainSurface:this.terrainSurface,deferTerrainDetail:this.previewOnly,scheduleLayerTask:(task,signal)=>this.scheduleLayerTask(record,task,signal),terrainMapTexture:record.terrainMapImage?.load,layers:this.detailLayers(record),onSceneCreated:scene=>{record.preparing=scene;void scene.setTerrainMapImage?.(record.terrainMapImage?.load).catch(error=>{if(!record.retired){record.state={...record.state,phase:'error',error:String(error)};this.report();}});},priorityPosition:cp?[(cp.x-position.x)/32,cp.z/32,(cp.y+position.y)/32]:undefined,onSceneReady:adopt,onProgress:state=>{if(valid()){record.state=this.onStatus?{...state,totalBytes:entry.downloadBytes}:state;this.report();}}});
   if(!adopt(scene))return;record.state={phase:'Ready',...scene.metrics};this.report();
  }catch(error){const scene=record.scene;record.scene=null;this.reconcile();this.disposeScene(scene);if(valid()){record.state={...record.state,phase:'error',error:error instanceof Error?error.message:String(error)};console.error('Foxhole region load failed',id,error);this.report();}}finally{
   // Settled loaders release preparation; failed scenes have already retired their resources.
   record.preparing=null;
  }
 }
 diagnostics(){
  const records=[...this.records.values()];if(!records.length)return[];
  const attached=records.filter(r=>r.scene).length,errors=records.filter(r=>r.state.phase==='error').length,bytes=records.reduce((n,r)=>n+(r.state.downloadBytes||r.scene?.metrics?.downloadBytes||0),0);
  const transfers=summarizeTerrainTransfers(records),terrain=transfers.observed?`pooled terrain transfer:at least ${(transfers.bytes/1048576).toFixed(1)} MiB${transfers.unknown?` (${transfers.unknown} unknown)`:''}`:transfers.unknown?`pooled terrain transfer:unknown (${transfers.unknown} requests)`:'pooled terrain transfer:no network timing observed';
  const lines=[`regions:${records.length}  attached:${attached}  preparing:${this.loading.size}  errors:${errors}  legacy resource metric (incomplete):${(bytes/1048576).toFixed(1)} MiB  mode:progressive ${this.adaptiveStreaming?'streaming':'resident'} / cull:${this.frustumCulling?'frustum':'off'}`,terrain];
  lines.push(`models:${this.modelLod?'LOD':'source'}  terrain:${this.terrainLod?'LOD':'source'}  terrain textures:${this.adaptiveTextures&&this.terrainSurface==='native'?'adaptive':'source'}`);
  lines.push(`AO:${this.ambientOcclusion?'on':'off'}  shadows:${this.view?.shadowQuality||'medium'}  casters:${this.view?.lights?.filter(light=>light.canCastShadow).length||0}  vegetation:${this.vegetationDensity}`);
  if(records.length===1){const r=records[0],m=r.scene?.metrics||r.state;lines.push(`region:${r.id}  ${r.state.phase}${m.readyMs===undefined?'':'  prep total:'+ (m.readyMs/1000).toFixed(1)+' s'}${m.firstVisibleMs===undefined?'':'  terrain:'+ (m.firstVisibleMs/1000).toFixed(1)+' s'}`);}
  const lightBudgets=new Set(records.map(r=>r.scene?.metrics?.catalogLights).filter(Boolean));for(const lights of lightBudgets)lines.push(`catalog lights:${lights.active}/${lights.budget}  sources:${lights.candidates}`);
  for(const r of records)if(r.state.error)lines.push(`region error ${r.id}: ${String(r.state.error).slice(0,300)}`);
  return lines;
 }
 streamingStats(){const cells=[...this.records.values()].flatMap(r=>Object.values(r.scene?.metrics?.modelCells||{}));return{resident:cells.reduce((n,c)=>n+c.resident,0),loading:cells.reduce((n,c)=>n+c.loading,0),total:cells.reduce((n,c)=>n+c.total,0)};}
 terrainStats(){const stats={chunks:0,visible:0,detail:0,draws:0,triangles:0,bytes:0,pending:0,errors:0};for(const r of this.records.values()){const g=r.scene?.metrics?.terrainGeometry;if(!g)continue;stats.chunks+=g.chunks||0;stats.visible+=g.visibleChunks||0;stats.detail+=g.detailChunks||0;stats.draws+=g.draws||0;stats.triangles+=g.triangles||0;stats.bytes+=g.bytes||0;stats.pending+=g.pending?1:0;stats.errors+=g.error?1:0;}return stats;}
 tourRegions(){return [...this.records.values()].filter(r=>r.scene?.createRoadTour&&!r.retired).map(r=>({id:r.id,position:r.position,scene:r.scene}));}
 mapAssetAt(x,y){const assets=new Set();for(const r of this.records.values())if(!r.retired)for(const asset of r.scene?.mapAssetsAt?.(x,y)||[])assets.add(asset);return assets.size===1?[...assets][0]:null;}
 sampleWater(x,y){if(this.layers?.water===false)return null;let highest=null;for(const r of this.records.values()){const value=r.scene?.sampleWater?.(x,y);if(value!=null&&Number.isFinite(value))highest=highest===null?value:Math.max(highest,value);}return highest;}
 sampleGround(x,y){let highest=this.sampleWater(x,y);if(this.layers?.terrain!==false)for(const r of this.records.values()){const value=r.scene?.sampleGround?.(x,y);if(value!=null&&Number.isFinite(value))highest=highest===null?value:Math.max(highest,value);}return highest;}
 setGroundCutouts(volumes){this.cutouts=volumes;for(const r of this.records.values())r.scene?.setGroundCutouts?.(volumes);}
 get active(){return [...this.records.values()].some(r=>r.scene);}
 destroy(){if(this.disposed)return;this.disposed=true;this.indexController.abort();this.retire();this.onStatus?.({phase:'idle'});this.checkDisposed();}
}
