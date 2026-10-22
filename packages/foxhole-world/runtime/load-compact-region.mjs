import {prepareWaterSurfaceDepth} from './water-surface-depth.mjs';
import {prepareVegetationWindShadows} from './vegetation-wind-shadows.mjs';
import {createVegetationWind} from '../authoring/vegetation-wind.mjs';
import {nativeFactionFlagTexture} from './catalog-flag-materials.mjs';
import {catalogLightBudgetFor} from './catalog-lights.mjs';
import {normalizeWorldModelLayers,worldModelLayers} from '../authoring/world-model-layers.mjs';
import {setRegionFrustumCulling} from './frustum-culling.mjs';
import {createWorldActorVisibility} from '../authoring/world-actor-visibility.mjs';
import {modelCells,createModelCellStream} from './model-cells.mjs';
import {RoadTour,buildRoadNetwork,buildClearanceSampler} from '../authoring/road-tour.mjs';
import {createChunkedTerrainLod} from './terrain-chunks.mjs';
import {buildTerrainPreview} from './terrain-preview.mjs';
import {terrainTexturePoolFor} from './terrain-texture-pool.mjs';
import {craneSpawnPlacements} from '../authoring/crane-spawn-placements.mjs';
import {catalogBindingFor} from '../authoring/catalog-world-policy.mjs';
import {createLayerDemand} from './layer-demand.mjs';
import {loadRailGeometry} from '../authoring/rail-geometry.mjs';
import {createRegionRevealQueue} from './progressive-loading.mjs';
import {readWorldCatalog,loadRegionCatalog} from './load-region-catalog.mjs';
import {loadRegionCranes} from './load-region-cranes.mjs';
import {SurfaceDecalPass} from '../authoring/surface-decal-pass.mjs';
import {createTerrainExcavationMask} from '../authoring/terrain-excavation-mask.mjs';
import {createRegionLayerVisibility} from './region-layer-visibility.mjs';
import {packRoadAssembly,unpackRoadAssembly,snapshotRoadGroups} from './road-assembly-pack.mjs';
import {prepareFirstFrameMaterials,prepareRegionEnvironment,renderedModelGeometries} from './first-frame-materials.mjs';
import {splitVertices} from '../authoring/split-vertices.mjs';
import {completeLoadTasks} from './load-tasks.mjs';
import {SafeSsaoEffect,SceneColorFinishEffect} from '../authoring/safe-ssao.mjs';
import {Container3D,Geometry3D,Material3D,Mesh3D} from '@pixi/3d';
import {createCompactProvider} from './compact-provider.mjs';
import {parseGlb,WIDTH,HEIGHT} from '../authoring/terrain-tools.mjs';
import {terrainSurfaceSampler as heightSampler} from '../authoring/terrain-surface.mjs';
import {waterSurfaceSampler} from './water-surface.mjs';
import {LiveTerrainPass} from '../authoring/live-terrain.mjs';
import {RoadShoulderPass} from '../authoring/road-shoulders.mjs';
import {createRoadTransitions} from '../authoring/road-transitions.mjs';
import {loadRoadDecals} from '../authoring/world-road-decals.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';
import {loadWorldDetails} from '../authoring/world-details.mjs';
import {effectLayers} from '../authoring/world-effect-policy.mjs';
import {createNativeWaterMaterial} from '../authoring/native-water-material.mjs';
import {packedWeatherSurfaceBit as weatherSurfaceBit,packWeatherSurfaceTextures} from '../authoring/weather-surface.mjs';
import {buildRegionShell,shellDepthBit,REGION_SHELL_COLOR} from '../authoring/region-shell.mjs';
import {framedMaterialBits,createRegionFramePreparation} from './spatial-frame.mjs';

function properties(value){const keys=new Set();for(let p=value;p&&p!==Object.prototype;p=Object.getPrototypeOf(p))for(const key of Object.getOwnPropertyNames(p))if(!key.startsWith('_')&&key!=='constructor')keys.add(key);return keys;}
export async function loadCompactRegion({baseUrl,entry,signal:externalSignal,frame,renderer,onProgress=()=>{},prepareTerrain=()=>{},progressive=true,adaptiveStreaming=false,modelLod=false,terrainLod=false,adaptiveTextures=false,frustumCulling=true,ambientOcclusion=true,waterReflections=true,vegetationShadows=true,vegetationWind=true,vegetationDensity='full',onSceneReady=()=>{},priorityPosition,layers={},terrainSurface='native',onSceneCreated=()=>{},scheduleModelTask}){
 const started=performance.now(),lifetime=new AbortController(),signal=externalSignal?AbortSignal.any([externalSignal,lifetime.signal]):lifetime.signal;
 const provider=await createCompactProvider({baseUrl,entry,signal,onProgress,scheduleModelTask}),{json,binary,zipped,texture}=provider,region=entry.id,root=new Container3D({label:'Foxhole Region '+entry.id,eventMode:'none'}),ownedGeometry=new Set(),ownedMaterial=new Set(),excavationMask=createTerrainExcavationMask();let weatherMaterials=[];const shellWalls=[];let shellEdgeFlags=[];
 if(!modelLod)Object.defineProperty(root,Symbol.for('nixie.spatial.full-detail-root'),{value:true});
 let roads,roadTransitions,waterMat,weatherTextures={},packedWeather,disposed=false,cleaned=false,loading=true,terrainLoaded=false,terrainPreview,terrainChunks,sourceMaxHeight=256,environment,warState=null,sharedActorVisibility,layerFlags=layers,revealedBatches=0;
 const windMaterials=createVegetationWind({frame,enabled:vegetationWind});
 const catalogLights=catalogLightBudgetFor(renderer||root),lightCamera=new Float64Array(3);
 const modelGroups=new Map(),detailGroups=new Map(),modelStreams=new Map();let detailCamera=priorityPosition?{position:priorityPosition}:null;let demand,initialComplete=false,layerCycleStarted=null,preparedMs=0;
 const geo=g=>(ownedGeometry.add(g),g);
 function mat(m){
  if(frame&&m._extraBits?.length){const original=m;m=new original.constructor({extraBits:framedMaterialBits([...original._featureBits||[],...original._extraBits]),alphaMode:original.alphaMode,alphaCutoff:original.alphaCutoff,doubleSided:original.doubleSided,vertexColors:original.vertexColors,flatShading:original.flatShading,fog:original.fog});
   for(const key of properties(original.data)){const v=original.data[key];if(typeof v==='number'||ArrayBuffer.isView(v)||Array.isArray(v))m.data[key]=ArrayBuffer.isView(v)?v.slice():v;}
   for(const key of properties(original.textures))if(original.textures[key]?.source)m.textures[key]=original.textures[key];m._passBit=original._passBit;m.state.depthMask=original.state.depthMask;m.state.blendMode=original.state.blendMode;original.destroy();}
  if(m._extraBits?.some(bit=>bit.name.startsWith('nativeGroundExcavation:')))excavationMask.bind(m);ownedMaterial.add(m);if(framePreparation)m.data.foxholeFrame=framePreparation.frame;return m;
 }
 const status=phase=>{provider.report(phase);},liveTerrainPass=new LiveTerrainPass(),roadShoulders=new RoadShoulderPass({terrainPass:liveTerrainPass,geo,release:g=>{ownedGeometry.delete(g);if(!g.destroyed)g.destroy(true);}}),passes=[liveTerrainPass,roadShoulders,new SurfaceDecalPass(),new SafeSsaoEffect({radius:1.2*(frame?.scale||1),maxDistance:.78*(frame?.scale||1),intensity:1,power:1.25,bias:.02,samples:32,resolution:'inherit'}),new SceneColorFinishEffect()];
 passes[3].enabled=ambientOcclusion;passes[4].enabled=!ambientOcclusion;
 liveTerrainPass.excavationMask=excavationMask;
 if(frame)liveTerrainPass.frame=new Float32Array([frame.x,-frame.y,frame.scale,0]);
 const hexBit={name:'foxholeHexBoundary',gpu:{fragment:{material:'if (input.vPosition.y < -220.0 || abs(input.vPosition.z) > 945.0 || abs(input.vPosition.x) + abs(input.vPosition.z) * 0.577777778 > 1092.0) { discard; }'}},gl:{fragment:{material:'if(vPosition.y<-220.0 || abs(vPosition.z)>945.0 || abs(vPosition.x)+abs(vPosition.z)*0.577777778>1092.0) discard;'}}};
 const weatherMaterial=m=>{for(const [key,value]of Object.entries(weatherTextures))if(key in m.textures)m.textures[key]=value;weatherMaterials.push(m);m.data.surfaceWeather=[0,0,0,0];return m;};
 let terrainOverlays={rdz:false,topo:false};
 let sample,sampleWater,releasePreparation,releaseEnvironmentPreparation,roadCacheReady;
 function terrainGeometry(parsed){const p=parsed.view(0),n=parsed.view(1),indices=parsed.view(2),uv=new Float32Array(p.length/3*2);for(let i=0;i<p.length/3;i++){uv[i*2]=(p[i*3]+WIDTH/2)/WIDTH;uv[i*2+1]=(HEIGHT/2-p[i*3+2])/HEIGHT;}return geo(new Geometry3D({positions:p,normals:n,indices,uvs:uv,quantizeNormals:false}));}
 // Progressive publication is independent of camera-driven residency. Retain
 // enabled layers after their first request in the progressive resident mode.
 const residentFlags=Object.fromEntries(['terrain','water','shell','building','structures','rocks','trees','vegetation','infrastructure','roads','decals','puddles','effects'].map(key=>[key,layers[key]!==false]));
 const loadFlags=()=>adaptiveStreaming?layerFlags:progressive?residentFlags:{};
 function prepareNode(node=root){setRegionFrustumCulling(node,frustumCulling);framePreparation?.prepare(node);}
 const streamingBusy=()=>[...modelStreams.values()].some(stream=>stream.busy);
 function cleanup(){if(cleaned)return;cleaned=true;signal.removeEventListener('abort',destroy);reveal?.dispose();demand?.dispose();releasePreparation?.();releaseEnvironmentPreparation?.();provider.destroy();terrainChunks?.destroy();for(const pass of passes)pass.destroy();for(const group of modelGroups.values()){group.catalog?.destroy();group.cranes?.destroy();group.world?.dispose();}windMaterials.destroy();root.removeFromParent();root.destroy({children:true});for(const g of ownedGeometry)if(!g.destroyed)g.destroy(true);for(const m of ownedMaterial)if(!m.destroyed)m.destroy();excavationMask.destroy();packedWeather?.destroy(true);}
 function destroy(){if(disposed)return;disposed=true;root.removeFromParent();const busy=demand?.busy||streamingBusy();lifetime.abort();const streams=[...modelStreams.values()].map(stream=>stream.dispose());if(!loading){if(busy)void Promise.all([demand?.whenSettled(),...streams]).then(cleanup);else cleanup();}}
 signal.addEventListener('abort',destroy,{once:true});
 const framePreparation=frame?createRegionFramePreparation({root,materials:ownedMaterial,terrainPass:liveTerrainPass},frame):null;
 const reveal=progressive?createRegionRevealQueue({signal}):null;
 const targets={roads:[],water:[],shell:[],decals:[]};
 const applyLayers=createRegionLayerVisibility({targets,details:{syncLayers:flags=>{for(const detail of detailGroups.values())detail.syncLayers(flags);}},terrain:liveTerrainPass,shoulders:roadShoulders});
 function applyWarState(force=false){sharedActorVisibility?.setWarState(warState);for(const group of modelGroups.values()){const world=group.world;if(!world)continue;const changed=world.setWarState(warState);if(changed||force){group.cranes?.setActorVisibility?.(world.actorVisible);group.catalog?.setWarState(warState,world.actorVisible);}}const visible=actor=>sharedActorVisibility?sharedActorVisibility.visible(actor):[...modelGroups.values()].every(group=>!group.world||group.world.actorVisible(actor));for(const detail of detailGroups.values())detail.setActorVisibility(visible);}

 function refresh(){applyWarState(true);applyLayers(layerFlags,true);}
 function order(){let index=0;for(const label of ['Water','Region Shell']){const child=root.children.find(c=>c.label===label);if(child)root.setChildIndex(child,index++);}}
 const publishBatch=progressive?build=>reveal.run(()=>{signal.throwIfAborted();const batch=build();prepareNode(batch);revealedBatches++;scene.prepareFirstFrame(renderer,batch);return batch;}):build=>build();
 const scene={root,passes,combinedPasses:{terrain:passes[0],shoulders:passes[1]},sharedPasses:{surfaceDecals:passes[2],ambientOcclusion:passes[3],colorFinish:passes[4]},metrics:provider.metrics,get environment(){return environment;},get sites(){return [...modelGroups.values()].flatMap(group=>group.world?.sites||[]);},scene:{get counts(){const counts={failed:[],lodFailures:[],byCategory:{},catalog:{visible:0,byAsset:{}}};for(const [key,group]of modelGroups){if(key==='bridges')continue;for(const [name,value]of Object.entries(group.world?.counts||{})){if(name==='minY')counts.minY=Math.min(counts.minY??Infinity,value);else if(name==='maxY')counts.maxY=Math.max(counts.maxY??-Infinity,value);else if(typeof value==='number')counts[name]=(counts[name]||0)+value;else if(Array.isArray(value))counts[name]=[...(counts[name]||[]),...value];else if(name==='byCategory')Object.assign(counts.byCategory,value);else if(name==='catalog'){counts.catalog.visible+=value.visible||0;for(const [asset,n]of Object.entries(value.byAsset||{}))counts.catalog.byAsset[asset]=(counts.catalog.byAsset[asset]||0)+n;}}}return counts;}},
  async createRoadTour(){
   signal.throwIfAborted();const source=await json(region+'/roads/tour-source.json');signal.throwIfAborted();
   const batches=[...modelGroups.values()].flatMap(group=>group.world?.clearanceBatches||group.world?.batches||[]);
   const tour=new RoadTour(buildRoadNetwork(source),{terrain:sample,clearance:buildClearanceSampler(batches,sample)});
   if(!loading&&!demand?.busy&&!streamingBusy())provider.finish();return tour;
  },
  setShellEdges(visible){shellEdgeFlags=visible;shellWalls.forEach((wall,i)=>wall.visible=visible[i]!==false);},
  setWarState(state){if(state===warState)return;warState=state;liveTerrainPass.setPlanningOverlays?.(terrainOverlays,warState);applyWarState(true);},
  setPlanningOverlays(options={}){terrainOverlays=options;liveTerrainPass.setPlanningOverlays?.(options,warState);},
  setWaterReflections(enabled){waterReflections=enabled!==false;if(waterMat)waterMat.data.waterReflectionStrength=waterReflections?1:0;},
  prepareWindShadows:prepareVegetationWindShadows,
  prepareWaterSurfaceDepth,
  setVegetationWind:enabled=>windMaterials.setEnabled(enabled),
  setVegetationShadows(enabled){vegetationShadows=enabled!==false;for(const group of modelGroups.values())group.world?.setVegetationShadows?.(vegetationShadows);},
  setAmbientOcclusion(enabled){ambientOcclusion=enabled;passes[3].enabled=enabled;passes[4].enabled=!enabled;scene.metrics.ambientOcclusion=enabled;},
  setFrustumCulling(enabled){if(frustumCulling===enabled)return;frustumCulling=enabled;setRegionFrustumCulling(root,enabled);if(terrainChunks)terrainChunks.frustumCulling=enabled;scene.metrics.frustumCulling=enabled;},
  setLayers(layers={}){for(const key in layers)if(layers[key]!==layerFlags[key]){catalogLights.invalidate();break;}layerFlags=layers;applyLayers(layers);if(adaptiveStreaming)demand?.setLayers(layers);else if(progressive){let changed=false;for(const key in residentFlags)if(!residentFlags[key]&&layers[key]!==false){residentFlags[key]=true;changed=true;}if(changed)demand?.setLayers(residentFlags);}},
  async whenLayersReady(){await demand?.whenIdle();},
  setGroundCutouts(volumes){const native=frame?volumes.map(v=>v.map(p=>[(p[0]-frame.x)/frame.scale,p[2]/frame.scale,(p[1]+frame.y)/frame.scale])):volumes;excavationMask.set(native,sourceMaxHeight);},
  sampleWater(x,y){if(disposed||!sampleWater||layerFlags.water===false)return null;const nx=frame?(x-frame.x)/frame.scale:x,nz=frame?-(y-frame.y)/frame.scale:y;if(Math.abs(nz)>945||Math.abs(nx)+Math.abs(nz)*.577777778>1092)return null;const height=sampleWater(nx,nz);return height===null?null:height*(frame?.scale||1);},
  sampleGround(x,y){if(disposed||!terrainLoaded)return null;const nx=frame?(x-frame.x)/frame.scale:x,nz=frame?-(y-frame.y)/frame.scale:y;if(Math.abs(nz)>945||Math.abs(nx)+Math.abs(nz)*.577777778>1092)return null;const height=sample(nx,nz);return height===null?null:height*(frame?.scale||1);},
  prepareFirstFrame(renderer,node=root){releasePreparation=prepareFirstFrameMaterials(renderer,renderedModelGeometries(node),root);},
  update({camera,wind,time:windTime,deltaMS=16.67}={}){time+=deltaMS/1000;windMaterials.update(Number.isFinite(windTime)?windTime:time,wind);if(waterMat){waterMat.data.waterTime=time;waterMat.data.waterReflectionStrength=waterReflections?1:0;}for(const detail of detailGroups.values())detail.update(time,wind);if(camera){detailCamera=camera;const p=camera.position,s=frame?.scale||1;lightCamera[0]=frame?p[0]*s+frame.x:p[0];lightCamera[1]=frame?p[2]*s-frame.y:p[1];lightCamera[2]=frame?p[1]*s:p[2];catalogLights.update(lightCamera,camera.planes);if(adaptiveStreaming)for(const stream of modelStreams.values())stream.update(camera);if(terrainLod)terrainChunks?.update(camera,liveTerrainPass.visible);if(adaptiveTextures)liveTerrainPass.updateQuality?.(camera);if(modelLod)for(const group of modelGroups.values())group.world?.lod?.update(camera);}},destroy};let time=0;
 scene.metrics.catalogLights=catalogLights.metrics;
 onSceneCreated(scene);
 // Every task checks its own lifetime before asking the shared provider for more
 // work. A shared request already in flight may finish into the region cache.
 function taskContext(taskSignal,label){
  const taskRoot=root.addChild(new Container3D({label})),geometry=new Set(),materials=new Set(),modelLease=provider.createModelLease?.();
  const checked=fn=>async(...args)=>{taskSignal.throwIfAborted();const result=await fn(...args);taskSignal.throwIfAborted();return result;};
  return {root:taskRoot,signal:taskSignal,json:checked(json),zipped:checked(zipped),binary:checked(binary),texture:checked(texture),model:checked(modelLease?modelLease.get:provider.model),
   geo:g=>{if(taskSignal.aborted){g.destroy(true);taskSignal.throwIfAborted();}geometry.add(g);return geo(g);},
   mat:m=>{if(taskSignal.aborted){m.destroy();taskSignal.throwIfAborted();}const value=mat(m);materials.add(value);return value;},
   rollback(){modelLease?.release();taskRoot.removeFromParent();taskRoot.destroy({children:true});for(const g of geometry){ownedGeometry.delete(g);if(!g.destroyed)g.destroy(true);}for(const m of materials){ownedMaterial.delete(m);if(!m.destroyed)m.destroy();}}
  };
 }
 let catalogReady,worldData,effectMetadataReady,retireRoads,retireDecals;const modelMetadata=new Map();
 const modelJson=id=>{if(!/\/(?:lod-manifest|night-materials)\.json$/.test(id))return json(id);if(!modelMetadata.has(id))modelMetadata.set(id,json(id).catch(error=>{modelMetadata.delete(id);throw error;}));return modelMetadata.get(id);};
 const metadata=()=>worldData??=json(region+'/world.json').then(normalizeWorldModelLayers);
 async function weather(taskSignal){for(const [slot,file]of Object.entries({weatherSnow:'snow',weatherBump:'normal',weatherMask:'mask',weatherNoise:'noise'})){taskSignal.throwIfAborted();weatherTextures[slot]=await texture(region+'/terrain-live/weather/'+file+'.png',true);taskSignal.throwIfAborted();}packedWeather=packWeatherSurfaceTextures(weatherTextures.weatherSnow,weatherTextures.weatherMask);weatherTextures.weatherSnow=packedWeather;}

 const catalog=()=>catalogReady??=readWorldCatalog({baseUrl,signal,onAsset:provider.trackExternalAsset});
 async function models(key,taskSignal,bridgesOnly=false,category=key,cellData){
  const ctx=taskContext(taskSignal,'World '+key),group={};modelGroups.set(key,group);
  try{taskSignal.throwIfAborted();const manifest=bridgesOnly?undefined:await catalog();
   const visibilityData=await metadata();sharedActorVisibility??=createWorldActorVisibility({region,prototypes:visibilityData.prototypes});
   group.world=await loadWorldModels({flagSurfacePass:true,region,json:async id=>{taskSignal.throwIfAborted();const value=await modelJson(id);taskSignal.throwIfAborted();return value;},status,root:ctx.root,assetUrl:provider.url,loadModel:ctx.model,signal:taskSignal,batchLayout:'category',catalogResourceFields:true,catalog:manifest,worldData:cellData||await metadata(),visibilityData,actorVisibility:sharedActorVisibility,categories:bridgesOnly?undefined:[category],bridgesOnly,progressive,optimize:modelLod,vegetationDensity,vegetationShadows,windMaterials,priorityPosition,
    publishBatch:build=>publishBatch(()=>{taskSignal.throwIfAborted();return build();}),
    onLayout(value){group.world=value;if(!bridgesOnly){targets[category]??=[];targets[category].push(value.layers[category]);}refresh();},teamAt:()=> 'NONE',
    flagTexture:team=>nativeFactionFlagTexture(baseUrl,team,{onAsset:provider.trackExternalAsset})});
   if(group.world.counts.failed.length||group.world.counts.lodFailures.length)throw Error('Region model load incomplete: '+JSON.stringify([...group.world.counts.failed,...group.world.counts.lodFailures].slice(0,3)));
   group.dispose=()=>{group.catalog?.destroy();group.cranes?.destroy();group.world?.dispose();modelGroups.delete(key);if(!bridgesOnly)targets[category]=(targets[category]||[]).filter(layer=>layer!==group.world?.layers[category]);ctx.rollback();};
   if(bridgesOnly){ctx.root.visible=false;return;}
   if(category==='structures'){const data=cellData||await metadata();const placements=craneSpawnPlacements({prototypes:data.prototypes.filter(p=>!catalogBindingFor(p,manifest))});group.cranes=await loadRegionCranes({baseUrl,scheduleModelTask,root:group.world.layers[key],placements,signal:taskSignal,publishBatch,getActorVisible:()=>group.world.actorVisible});}
   group.catalog=await loadRegionCatalog({flagSurfacePass:true,baseUrl,scheduleModelTask,catalog:manifest,layers:group.world.layers,placements:group.world.catalogPlacements,signal:taskSignal,onAsset:provider.trackExternalAsset,progressive,publishBatch,getWarState:()=>warState,actorVisible:group.world.actorVisible,lightBudget:catalogLights,frame});
   taskSignal.throwIfAborted();group.world.counts.cranePlacements=group.cranes?.count||0;group.world.counts.catalog=group.catalog.summary;refresh();framePreparation?.prepare(ctx.root);scene.prepareFirstFrame(renderer,ctx.root);return group;
  }catch(error){group.catalog?.destroy();group.cranes?.destroy();group.world?.dispose();modelGroups.delete(key);if(!bridgesOnly)targets[category]=(targets[category]||[]).filter(layer=>layer!==group.world?.layers[category]);ctx.rollback();throw error;}
 }
 async function streamModels(category,taskSignal){
  if(!adaptiveStreaming){await models(category,taskSignal,false,category);return;}
  const data=await metadata(),cells=modelCells(data,category),stream=createModelCellStream({cells,signal:taskSignal,
   load:(cell,cellSignal)=>models(category+'/'+cell.id,cellSignal,false,category,cell.data),
   onChange:states=>{scene.metrics.modelCells??={};scene.metrics.modelCells[category]={resident:states.filter(s=>s.loaded).length,loading:states.filter(s=>s.loading).length,total:cells.length};
    if(initialComplete&&!disposed){const active=streamingBusy()||demand?.busy,failed=states.find(state=>state.requested&&state.error);if(!active)provider.finish();onProgress({phase:failed?'error':active?'Streaming nearby '+category:'Ready',...scene.metrics,...(failed?{error:String(failed.error)}:{})});}}
  });
  modelStreams.set(category,stream);try{await stream.initialize(detailCamera||{position:[0,256,0]});}catch(error){await stream.dispose();modelStreams.delete(category);throw error;}
 }
 async function retireModels(category){const stream=modelStreams.get(category);if(stream){await stream.dispose();modelStreams.delete(category);}else modelGroups.get(category)?.dispose?.();}
 async function loadDetails(key,taskSignal,flags,effectLayer){const ctx=taskContext(taskSignal,'Details '+key);
  try{const effectData=effectLayer?await (effectMetadataReady??=json(region+'/world-fixes/effects/render.json')):undefined;taskSignal.throwIfAborted();const effectWorldData=effectLayer&&effectLayer!=='water'?await metadata():undefined;taskSignal.throwIfAborted();if(effectWorldData)sharedActorVisibility??=createWorldActorVisibility({region,prototypes:effectWorldData.prototypes});const detail=await loadWorldDetails({region,...ctx,layers:flags,effectLayer,effectData,worldData:effectWorldData,hexBit,weatherSurfaceBit,weatherMaterial,groundBit:excavationMask.bit,bridgeRoadSeams:modelGroups.get('bridges')?.world?.bridgeRoadSeams,frame,nativeRoadTransitions:true});taskSignal.throwIfAborted();detail.dispose=()=>{detailGroups.delete(key);ctx.rollback();};detailGroups.set(key,detail);framePreparation?.prepare();refresh();return detail;}
  catch(error){detailGroups.delete(key);ctx.rollback();throw error;}
 }

async function loadRoads(seamsReady,ctx){
  const {json,zipped,texture,geo,mat,signal}=ctx;
  roads=new Container3D({label:'Roads'});roads.visible=false;ctx.root.addChild(roads);targets.roads=[ctx.root];
  const decalRoot=new Container3D({label:'Native Road Decals'});roads.addChild(decalRoot);
  const meta=await json(region+'/roads/render.json'),cached=await roadCacheReady;
  const [vb,ib]=cached?[]:await Promise.all([zipped(region+'/roads/render-vertices.bin.gz'),zipped(region+'/roads/render-indices.bin.gz')]);
  const verts=cached?null:new Float32Array(vb),ix=cached?null:new Uint32Array(ib),materials=new Map();
  for(const[key,d]of Object.entries(meta.materials)){
   const [t,n]=await Promise.all([d.file?texture(region+'/'+d.file,true):undefined,d.normalFile?texture(region+'/'+d.normalFile,true):undefined]);
   materials.set(key,mat(weatherMaterial(new Material3D({baseColorTexture:t,normalTexture:n,normalScale:1,baseColor:t?0xffffff:0x827365,roughness:1,metallic:0,doubleSided:true,extraBits:[hexBit,weatherSurfaceBit,excavationMask.bit]}))));
  }
  await roadShoulders.prepare({region,json,zipped,terrain:sample});
  roadTransitions=await createRoadTransitions({region,json,texture,geo,mat,hexBit,weatherSurfaceBit,weatherMaterial,groundBit:excavationMask.bit,materials:meta.materials,enabled:true});
  const decorations=loadRailGeometry({region,json,zipped,texture,geo,mat,root:roads,hexBit,weatherSurfaceBit,weatherMaterial});
  const assemble=async()=>{
   const snapshot={version:1,chunks:[]};
   if(cached){
    for(const c of cached.chunks){
     roadShoulders.summary.sourceTriangles+=c.sourceTriangles;if(c.shoulder)roadShoulders.parts.push(c.shoulder);
     await roadTransitions.addPrepared({...c,groups:new Map(c.groups),root:roads,baseMaterial:materials.get(c.material)});
    }
   }else{
    const bridgeRoadSeams=await seamsReady;
    for(const c of meta.chunks){
     const {p,n,uv}=splitVertices(verts,c.vertexOffset,c.vertexCount),roadIndices=ix.slice(c.indexOffset,c.indexOffset+c.indexCount),cut=bridgeRoadSeams.cut({p,n,uv,indices:roadIndices});
     const shoulder=roadShoulders.addChunk({p:cut.p,indices:cut.indices}),prepared=roadTransitions.prepareChunk({chunk:c,...cut}),sourceTriangles=cut.indices.length/3;
     await roadTransitions.addPrepared({...prepared,sourceTriangles,root:roads,baseMaterial:materials.get(c.material)});
     snapshot.chunks.push({material:c.material,sourceTriangles,transitionTriangles:prepared.transitionTriangles,groups:snapshotRoadGroups(prepared.groups),shoulder});
    }
   }
   roadShoulders.finish();
   if(!cached)await provider.writeRoadAssembly(packRoadAssembly(snapshot));
  };
  await completeLoadTasks([assemble(),decorations]);
  // Rail meshes are loaded alongside road decals but are physical infrastructure.
  const tracks=decalRoot.children.find(child=>child.label==='Native Rail Tracks');if(tracks)roads.addChild(tracks);
  roads.setChildIndex(decalRoot,roads.children.length-1);signal.throwIfAborted();if(progressive)framePreparation?.prepare(roads);refresh();roads.visible=true;
 }

 try{
  provider.stage('metadata');const [terrainMeta,source]=await Promise.all([json(region+'/terrain.json'),binary(region+'/terrain.bin')]);
  const sourcePositions=new Float32Array(source);sample=heightSampler(terrainMeta,sourcePositions);sourceMaxHeight=terrainMeta.max[1];terrainLoaded=true;
  provider.stage('environment');environment=await provider.environment();releaseEnvironmentPreparation=prepareRegionEnvironment(renderer,environment,{signal});
  const enabled=(flags,key)=>flags[key]!==false;
  let terrainGeometryReady;
  const geometryReady=()=>terrainGeometryReady??=provider.measure('terrain-geometry',async()=>{
   terrainChunks=createChunkedTerrainLod({meta:terrainMeta,source:sourcePositions,signal,renderer,adaptive:terrainLod,frustumCulling,frame:liveTerrainPass.frame,
    create:mesh=>geo(new Geometry3D({positions:mesh.positions,normals:mesh.normals,indices:mesh.indices,quantizeNormals:false})),
    release:g=>{ownedGeometry.delete(g);if(!g.destroyed)g.destroy(true);},
    createView:(base,indices)=>geo(new Geometry3D({attributes:base.attributes,indices,bounds3D:base.bounds3D})),
    releaseView:g=>{ownedGeometry.delete(g);g.indexBuffer.destroy();if(!g.destroyed)g.destroy(false);},
    apply:g=>{if(liveTerrainPass.current)liveTerrainPass.current.geometry=g;}});
   liveTerrainPass.geometryLod=terrainChunks;
   scene.metrics.terrainGeometry=terrainChunks.stats;return terrainChunks.initialize();
  }).catch(error=>{terrainChunks?.destroy();terrainChunks=null;terrainGeometryReady=null;throw error;});
  // Build the inexpensive border before the preview; no model assets are needed.
  if(!progressive&&!adaptiveStreaming||enabled(layerFlags,'shell')){
   const shell=buildRegionShell(await json(region+'/world-fixes/boundary/profile.json')),shellMat=mat(new Material3D({baseColor:REGION_SHELL_COLOR,roughness:.95,doubleSided:true,extraBits:[shellDepthBit]}));shellMat.data.shellDepthBias=.000001;
   const shellRoot=new Container3D({label:'Region Shell'});targets.shell.push(root.addChild(shellRoot));
   const shellPart=(indices,label)=>shellRoot.addChild(new Mesh3D({label,geometry:geo(new Geometry3D({positions:shell.positions,normals:shell.normals,indices})),material:shellMat,castShadow:false,receiveShadow:false}));
   if(shell.wallIndices){shellPart(shell.floorIndices,'Region Floor');shell.wallIndices.forEach((indices,i)=>shellWalls.push(shellPart(indices,'Region Wall '+i)));}else shellPart(shell.indices,'Region Shell Geometry');
  }
  if(progressive){
   if(enabled(layerFlags,'terrain')){const preview=buildTerrainPreview(sample),geometry=geo(new Geometry3D({...preview,quantizeNormals:false}));signal.throwIfAborted();terrainPreview=root.addChild(new Mesh3D({label:'Loading Terrain',geometry,material:mat(new Material3D({baseColor:0x7a8061,roughness:1,metallic:0,extraBits:[hexBit]})),castShadow:false}));targets.terrain=[terrainPreview];}
   framePreparation?.prepare();refresh();order();scene.metrics.firstVisibleMs=performance.now()-started;
   if(onSceneReady(scene)===false)throw new DOMException('Region retired','AbortError');
  }
  const tasks={
   terrain:{needed:f=>enabled(f,'terrain'),load:async taskSignal=>{const ctx=taskContext(taskSignal,'Terrain Loading');try{const geometry=await geometryReady();taskSignal.throwIfAborted();await liveTerrainPass.load(region,geometry,{surface:terrainSurface,texture:ctx.texture,json:ctx.json,zipped:ctx.zipped,status,prepareTerrain,signal:taskSignal,terrainDescriptor:adaptiveTextures?provider.terrainDescriptor:undefined,texturePool:adaptiveTextures&&provider.terrainDescriptor?terrainTexturePoolFor(renderer):undefined});taskSignal.throwIfAborted();if(terrainPreview){terrainPreview.removeFromParent();terrainPreview.destroy();terrainPreview=null;targets.terrain=[];}framePreparation?.prepare();refresh();}catch(error){liveTerrainPass.clear?.();ctx.rollback();throw error;}}},
   water:{needed:f=>enabled(f,'water'),load:async taskSignal=>{const ctx=taskContext(taskSignal,'Water');try{const parsed=parseGlb(await ctx.binary(region+'/water-visible.glb'));const waterSample=waterSurfaceSampler(parsed.view(0),parsed.view(2));if(parsed.view(2).length){const prepared=await createNativeWaterMaterial({region,json:ctx.json,texture:ctx.texture,hexBit});waterMat=ctx.mat(prepared.material);waterMat.data.waterReflectionStrength=waterReflections?1:0;targets.water.push(ctx.root.addChild(new Mesh3D({label:'Native Water',geometry:ctx.geo(terrainGeometry(parsed)),material:waterMat,castShadow:false})));}taskSignal.throwIfAborted();sampleWater=waterSample;framePreparation?.prepare();refresh();}catch(error){targets.water=[];waterMat=null;sampleWater=null;ctx.rollback();throw error;}}},
   weather:{needed:()=>false,load:weather},
   bridges:{needed:()=>false,load:taskSignal=>models('bridges',taskSignal,true),unload:()=>modelGroups.get('bridges')?.dispose?.()},
   ...Object.fromEntries(worldModelLayers.map(key=>[key,{needed:f=>enabled(f,key),load:taskSignal=>streamModels(key,taskSignal),unload:()=>retireModels(key)}])),
   roads:{needed:f=>enabled(f,'roads'),dependencies:['weather','bridges'],load:async taskSignal=>{const ctx=taskContext(taskSignal,'Transport');try{roadCacheReady=provider.readRoadAssembly().then(bytes=>bytes?unpackRoadAssembly(bytes):null);await loadRoads(modelGroups.get('bridges').world.bridgeRoadSeams,ctx);taskSignal.throwIfAborted();framePreparation?.prepare();refresh();retireRoads=()=>{targets.roads=[];roadShoulders.clear?.();ctx.rollback();};}catch(error){targets.roads=[];roadShoulders.parts=[];ctx.rollback();throw error;}},unload:()=>{retireRoads?.();retireRoads=null;}},
   decals:{needed:f=>enabled(f,'decals'),dependencies:['weather','bridges'],load:async taskSignal=>{const ctx=taskContext(taskSignal,'Surface Decals');let detail;try{detail=await loadDetails('decals',taskSignal,{decals:true,puddles:false,effects:false});await loadRoadDecals({region,...ctx,root:ctx.root,terrain:sample,hexBit,weatherSurfaceBit,weatherMaterial,groundBit:excavationMask.bit,bridgeRoadSeams:modelGroups.get('bridges').world.bridgeRoadSeams,includeRails:false});taskSignal.throwIfAborted();targets.decals=[ctx.root];framePreparation?.prepare();refresh();retireDecals=()=>{detail?.dispose();targets.decals=[];ctx.rollback();};}catch(error){detail?.dispose();targets.decals=[];ctx.rollback();throw error;}},unload:()=>{retireDecals?.();retireDecals=null;}},
   puddles:{needed:f=>enabled(f,'puddles'),dependencies:['weather'],load:taskSignal=>loadDetails('puddles',taskSignal,{decals:false,puddles:true,effects:false}),unload:()=>detailGroups.get('puddles')?.dispose()},
   ...Object.fromEntries(effectLayers.map(category=>[category+'Effects',{needed:f=>enabled(f,'effects')&&enabled(f,category),load:taskSignal=>loadDetails(category+'Effects',taskSignal,{decals:false,puddles:false,effects:true},category),unload:()=>detailGroups.get(category+'Effects')?.dispose()}])),
  };
  // Late shell enablement uses the same region; it never requires a model reload.
  tasks.shell={needed:f=>enabled(f,'shell'),load:async taskSignal=>{if(targets.shell.length)return;const ctx=taskContext(taskSignal,'Region Shell');try{const shell=buildRegionShell(await ctx.json(region+'/world-fixes/boundary/profile.json')),material=ctx.mat(new Material3D({baseColor:REGION_SHELL_COLOR,roughness:.95,doubleSided:true,extraBits:[shellDepthBit]}));material.data.shellDepthBias=.000001;const part=(indices,label)=>ctx.root.addChild(new Mesh3D({label,geometry:ctx.geo(new Geometry3D({positions:shell.positions,normals:shell.normals,indices})),material,castShadow:false,receiveShadow:false}));if(shell.wallIndices){part(shell.floorIndices,'Region Floor');shell.wallIndices.forEach((indices,i)=>shellWalls[i]=part(indices,'Region Wall '+i));}else part(shell.indices,'Region Shell Geometry');targets.shell=[ctx.root];scene.setShellEdges(shellEdgeFlags);framePreparation?.prepare();refresh();}catch(error){ctx.rollback();throw error;}}};
  demand=createLayerDemand({tasks,signal,onChange:states=>{scene.metrics.layers=states.map(({error,...state})=>({...state,...(error?{error:String(error)}:{})}));if(initialComplete){if(!states.some(s=>s.loading)&&!modelGroups.size&&!streamingBusy())provider.releaseModels?.();const pending=states.filter(s=>s.requested&&!s.loaded&&!s.error),failed=states.find(s=>s.requested&&s.error);if(pending.length||states.some(s=>s.loading)){layerCycleStarted??=performance.now();onProgress({phase:pending.length?'Loading layers: '+pending.map(s=>s.key).join(', '):'Finishing layer cleanup',...scene.metrics});}else{if(layerCycleStarted!==null){preparedMs+=performance.now()-layerCycleStarted;layerCycleStarted=null;}if(!streamingBusy())Object.assign(scene.metrics,provider.finish());scene.metrics.readyMs=preparedMs;onProgress({phase:failed?'error':'Ready',...scene.metrics,...(failed?{error:String(failed.error)}:{})});}}}});
  demand.setLayers(loadFlags());await demand.whenIdle();signal.throwIfAborted();
  order();prepareNode();refresh();
  Object.assign(scene.metrics,provider.finish(),{progressive,adaptiveStreaming,modelLod,terrainLod,adaptiveTextures,ambientOcclusion,vegetationDensity,vegetationShadows,resident:!adaptiveStreaming,frustumCulling,revealedBatches,terrainSurface});preparedMs=scene.metrics.readyMs;initialComplete=true;return scene;
 }catch(error){destroy();throw error;}finally{loading=false;if(disposed){await demand?.whenSettled();await Promise.all([...modelStreams.values()].map(stream=>stream.dispose()));cleanup();}}
}
