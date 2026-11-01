import {createTerrainMapImageSource} from '../runtime/terrain-map-image.mjs';
import {prepareWaterSurfaceDepth} from '../runtime/water-surface-depth.mjs';
import {prepareVegetationWindShadows} from '../runtime/vegetation-wind-shadows.mjs';
import {createVegetationWind} from '../authoring/vegetation-wind.mjs';
import {normalizeWorldModelLayers,worldModelLayers} from '../authoring/world-model-layers.mjs';
import {waterSurfaceSampler} from '../runtime/water-surface.mjs';
import {catalogLightBudgetFor} from '../runtime/catalog-lights.mjs';
import {effectLayers} from '../authoring/world-effect-policy.mjs';
import {setRegionFrustumCulling} from '../runtime/frustum-culling.mjs';
import {createWorldActorVisibility} from '../authoring/world-actor-visibility.mjs';
import {modelCells,createModelCellStream} from '../runtime/model-cells.mjs';
import {RoadTour,buildRoadNetwork,buildClearanceSampler} from '../authoring/road-tour.mjs';
import {createChunkedTerrainLod} from '../runtime/terrain-chunks.mjs';
import {buildTerrainPreview} from '../runtime/terrain-preview.mjs';
import {createLayerDemand} from '../runtime/layer-demand.mjs';
import {renderedModelGeometries} from '../runtime/first-frame-materials.mjs';
import {createTerrainPlanningOverlays} from '../authoring/terrain-planning-overlays.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {completeLoadTasks} from '../runtime/load-tasks.mjs';
import {createRegionRevealQueue} from '../runtime/progressive-loading.mjs';
import {createRegionLayerVisibility} from '../runtime/region-layer-visibility.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const source=readFileSync(new URL('../runtime/load-compact-region.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')+'\nloadCompactRegion;';

function fixture(progressive,layers,{adaptiveStreaming=progressive,modelLod=adaptiveStreaming,terrainLod=adaptiveStreaming,adaptiveTextures=false,waterGeometry=false,previewTerrain=false,deferEnvironment=false,deferCatalog=false,failModels=false,disposalGates=null}={}){
 const catalogGate=deferred();let catalogRequests=0,catalogDisposed=0;
 const surface=deferred(),models=deferred(),visible=deferred(),layout=deferred(),previewShown=deferred(),environmentGate=deferred(),environmentStarted=deferred(),states=[],progressEvents=[],requests=[],detailRequests=[],modelRequests=[],modelPolicies=[],terrainPolicies=[],texturePolicies=[],stageNames=[],updates={model:0,terrain:0,textures:0};let partial,root,disposed=0,finished=0;
 class Container {
  constructor(options={}){Object.assign(this,{children:[],visible:true,destroyed:false},options);}
  addChild(...children){for(const child of children){child.removeFromParent?.();child.parent=this;this.children.push(child);}return children[0];}
  removeFromParent(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
  setChildIndex(child,index){this.children=this.children.filter(item=>item!==child);this.children.splice(index,0,child);}
  destroy({children=false}={}){if(this.destroyed)return;this.destroyed=true;if(children)for(const child of this.children)child.destroy();}
 }
 class Geometry {constructor(options){Object.assign(this,options);this.attributes={};this.indexBuffer={destroy(){}};this.bounds3D={max:{y:100}};}destroy(){this.destroyed=true;}}
 class Material {constructor(options){Object.assign(this,options);this.data={};this.textures={};this.state={};this._extraBits=options.extraBits;}destroy(){this.destroyed=true;}}
 class Mesh extends Container {}
 class Pass {constructor(){this.visible=true;}destroy(){}}
 class Terrain extends Pass {whenDisposed(){return disposalGates?.terrain.promise||Promise.resolve();}constructor(){super();this.planning=createTerrainPlanningOverlays();if(previewTerrain)this.loadProgressive=async(_region,geometry,options,{onPreview})=>{this.current={geometry,qualityCap:128};onPreview();previewShown.resolve();await surface.promise;options.signal.throwIfAborted();this.current={geometry,qualityCap:Infinity};};}setPlanningOverlays(options,state){return this.planning.set(options,state);}destroy(){this.planning.destroy();}async load(_region,geometry,options){texturePolicies.push({descriptor:!!options.terrainDescriptor,pool:!!options.texturePool});options.status('Loading terrain textures');await surface.promise;this.current={geometry};}updateQuality(){updates.textures++;}}
 class Shoulders extends Pass {constructor(){super();this.summary={sourceTriangles:0};}async prepare(){}finish(){}}
 const provider={terrainDescriptor:()=>({}),metrics:{},json:async path=>{requests.push(path);return path.endsWith('roads/tour-source.json')?{curves:[{id:'road',mesh:'road',points:[[0,8,0],[400,8,0]]}]}:path.endsWith('terrain.json')?{min:[0,8,0],max:[1,8,1],components:[{name:'fixture',size:2,offset:0}]}:path.endsWith('world.json')?{prototypes:[{name:'House',file:'house.gltf',kind:'building',category:'building',placements:[{actor:'house',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]}]}:path.endsWith('flags.json')?[]:path.endsWith('roads/render.json')?{materials:{},chunks:[]}:{};},binary:async path=>{requests.push(path);return path.endsWith('terrain.bin')?new Float32Array([0,8,0,1,8,0,0,8,1,1,8,1]).buffer:path;},zipped:async()=>new ArrayBuffer(0),texture:async()=>({}),environment:async()=>{environmentStarted.resolve();if(deferEnvironment)await environmentGate.promise;return {};},readRoadAssembly:async()=>({}),writeRoadAssembly:async()=>{},stage(name){stageNames.push(name);},report(){},url:path=>path,trackExternalAsset(){},async measure(_name,fn){return fn();},finish(){finished++;return{readyMs:100};},whenDisposed(){return disposalGates?.provider.promise||Promise.resolve();},destroy(){disposed++;}};
 const load=runInNewContext(source,{createTerrainMapImageSource,prepareAtlasRetirement:()=>{},prepareWaterSurfaceDepth,prepareVegetationWindShadows,createVegetationWind,normalizeWorldModelLayers,worldModelLayers,waterSurfaceSampler,modelCells,createModelCellStream,RoadTour,buildRoadNetwork,buildClearanceSampler,performance,AbortController,AbortSignal,DOMException,Float64Array,Float32Array,Uint32Array,ArrayBuffer,Map,Set,Math,Promise,
  createNativeWaterMaterial:async({extraBits})=>({material:new Material({extraBits})}),createCompactProvider:async()=>provider,Container3D:Container,Geometry3D:Geometry,Material3D:Material,Mesh3D:Mesh,
  createTerrainExcavationMask:()=>({bind(){},set(){},destroy(){}}),LiveTerrainPass:Terrain,RoadShoulderPass:Shoulders,SurfaceDecalPass:Pass,SafeSsaoEffect:Pass,SceneColorFinishEffect:Pass,
  catalogLightBudgetFor,effectLayers,setRegionFrustumCulling,createWorldActorVisibility,buildTerrainPreview,terrainTexturePoolFor:()=>({}),createChunkedTerrainLod:options=>{terrainPolicies.push(options.adaptive);const chunks=createChunkedTerrainLod(options),update=chunks.update.bind(chunks);chunks.update=(...args)=>{updates.terrain++;return update(...args);};return chunks;},createRegionRevealQueue,createRegionLayerVisibility,completeLoadTasks,createLayerDemand,craneSpawnPlacements:()=>[],catalogBindingFor:()=>null,loadRailGeometry:async()=>({}),
  createRegionFramePreparation:()=>({frame:new Float32Array([0,0,32,0]),prepare(){}}),framedMaterialBits:bits=>bits,
  parseGlb:path=>({view:index=>index===2?new Uint32Array(path.includes('water')&&!waterGeometry?[]:[0,1,2]):new Float32Array([0,0,0,1,0,0,0,0,1])}),WIDTH:2184,HEIGHT:1890,heightSampler:()=>()=>8,
  packWeatherSurfaceTextures:()=>({destroy(){}}),unpackRoadAssembly:()=>({chunks:[]}),packRoadAssembly:()=>new Uint8Array(),
  buildRegionShell:()=>({positions:new Float32Array(),normals:new Float32Array(),indices:new Uint32Array()}),shellDepthBit:{name:"shell"},REGION_SHELL_COLOR:0x191919,weatherSurfaceBit:{name:"weather"},
  prepareRegionEnvironment:()=>()=>{},prepareFirstFrameMaterials:()=>()=>{},renderedModelGeometries,readWorldCatalog:async()=>({}),
  loadWorldModels:async({root:modelsRoot,onLayout,signal,categories,optimize,progressive:publication})=>{modelPolicies.push({optimize,publication});modelRequests.push(categories||['bridges']);const world={layers:Object.fromEntries((categories||['infrastructure']).map(key=>[key,new Container()])),counts:{failed:[],lodFailures:[]},owned:[],sites:[],catalogPlacements:[],cranePlacements:[],bridgeRoadSeams:{},setWarState(state){states.push(state);return true;},actorVisible:()=>true,lod:{update(){updates.model++;}},dispose(){}};for(const layer of Object.values(world.layers))modelsRoot.addChild(layer);onLayout(world);layout.resolve();await models.promise;signal.throwIfAborted();if(failModels)throw Error("native fixture failed");return world;},
  loadRegionCranes:async()=>({count:0,destroy(){}}),loadRegionCatalog:async()=>{catalogRequests++;if(deferCatalog)await catalogGate.promise;return{summary:{},setWarState(){},destroy(){catalogDisposed++;}};},
  createRoadTransitions:async()=>({}),loadRoadDecals:async({root})=>({root}),loadWorldDetails:async({bridgeRoadSeams,effectLayer})=>{if(effectLayer)detailRequests.push(effectLayer);await bridgeRoadSeams;return{syncLayers(){},setActorVisibility(){},update(){}};},
 });
 let done=false;const pending=load({baseUrl:'https://world.test/',entry:{id:'fixture'},frame:{x:0,y:0,scale:32},progressive,adaptiveStreaming,modelLod,terrainLod,adaptiveTextures,layers,onProgress:event=>progressEvents.push(event),onSceneReady:scene=>{partial=scene;root=scene.root;visible.resolve(scene);}}).then(scene=>{done=true;root=scene.root;return scene;});
 return{catalogGate,get catalogRequests(){return catalogRequests;},get catalogDisposed(){return catalogDisposed;},surface,models,visible,layout,previewShown,environmentGate,environmentStarted,stageNames,states,progressEvents,pending,requests,detailRequests,modelRequests,modelPolicies,terrainPolicies,texturePolicies,updates,get partial(){return partial;},get root(){return root;},get done(){return done;},get disposed(){return disposed;},get finished(){return finished;}};
}

test('environment and layer stage boundaries follow real asynchronous work',async()=>{
 const f=fixture(true,terrainWater,{deferEnvironment:true});await f.environmentStarted.promise;
 assert.deepEqual(f.stageNames,['metadata','environment']);
 let visible=false;void f.visible.promise.then(()=>{visible=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(visible,false);
 f.environmentGate.resolve();await f.visible.promise;
 assert.deepEqual(f.stageNames,['metadata','environment','layers']);
 f.surface.resolve();const scene=await f.pending;scene.destroy();
});

test('initial region loading reports real requested layer completion',async()=>{
 const f=fixture(true,terrainWater,{adaptiveStreaming:false});await f.visible.promise;
 await new Promise(resolve=>setImmediate(resolve));
 const before=f.progressEvents.filter(event=>event.progress?.unit==='layers');
 assert.ok(before.some(event=>event.progress.total>0&&event.progress.completed<event.progress.total));
 f.surface.resolve();const scene=await f.pending;
 const events=f.progressEvents.filter(event=>event.progress?.unit==='layers');
 assert.ok(events.some(event=>event.progress.completed===event.progress.total));
 assert.ok(events.every(event=>event.progress.completed<=event.progress.total));
 scene.destroy();
});
test('actual loader exposes terrain geometry and ground before material/model completion',async()=>{
 const f=fixture(true),scene=await f.visible.promise;
 assert.equal(f.done,false);assert.equal(scene.sampleGround(0,0),256);const preview=scene.root.children.find(child=>child.label==='Loading Terrain');assert.ok(preview);assert.ok(preview.geometry.positions.length/3<20000,'preview must stay small instead of packing native terrain into the shared atlas');
 const shell=scene.root.children.find(child=>child.label==='Region Shell');assert.ok(shell,'shell is visible with the first preview while textures and models are pending');
 scene.setLayers({terrain:false,rocks:false,shell:false});assert.equal(preview.visible,false);assert.equal(shell.visible,false);scene.setLayers({terrain:true,rocks:false,shell:true});assert.equal(preview.visible,true);assert.equal(shell.visible,true);
 const war={items:[]};scene.setWarState(war);await f.layout.promise;assert.equal(f.states.at(-1),war);
 f.models.resolve();f.surface.resolve();const completed=await f.pending;assert.equal(completed,scene);assert.notEqual(scene.passes[0].current.geometry,preview.geometry,'the final direct pass owns adaptive geometry independently of the loading preview');assert.equal(scene.root.children.some(child=>child.label==='Loading Terrain'),false);assert.equal(preview.destroyed,true);assert.equal(scene.root.children.filter(child=>child.label==='Region Shell').length,1);assert.equal(scene.root.children.find(child=>child.label==='Region Shell'),shell,'preview shell is retained at completion');assert.equal(scene.root.children.some(child=>child.label==='World rocks'),false,'disabled rocks are never prepared');scene.destroy();assert.equal(f.disposed,1);assert.equal(scene.root.destroyed,true);
});

test('atomic loading returns no partial scene and waits for complete materials',async()=>{
 const f=fixture(false);await f.layout.promise;assert.equal(f.partial,undefined);f.models.resolve();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.done,false);f.surface.resolve();const scene=await f.pending;assert.equal(scene.metrics.firstVisibleMs,undefined);scene.destroy();assert.equal(f.disposed,1);
});

test('atomic mode preloads hidden layers once and keeps the complete region across camera and layer changes',async()=>{
 const f=fixture(false,terrainWater);await f.layout.promise;assert.equal(f.partial,undefined);f.models.resolve();f.surface.resolve();const scene=await f.pending;
 assert.equal(scene.metrics.resident,true);assert.equal(scene.metrics.terrainGeometry.step,1);
 const requested=f.modelRequests.map(row=>row.join(',')).sort();assert.deepEqual(requested,['bridges','building','infrastructure','rocks','structures','trees','vegetation']);
 const root=scene.root,geometry=scene.passes[0].current.geometry,count=f.modelRequests.length;
 const building=root.children.find(child=>child.label==='World building');assert.ok(building);assert.equal(building.children[0].visible,false,'hidden buildings are loaded, but layer visibility still applies');
 for(const position of [[0,0,0],[0,100000,0]])scene.update({camera:{position,height:800,fov:45},deltaMS:1000});
 scene.setLayers({...terrainWater,building:true});await scene.whenLayersReady();assert.equal(building.children[0].visible,true);
 scene.setLayers(terrainWater);await scene.whenLayersReady();scene.setLayers({...terrainWater,building:true});await scene.whenLayersReady();
 assert.equal(f.modelRequests.length,count);assert.equal(scene.root,root);assert.equal(scene.passes[0].current.geometry,geometry);assert.equal(root.children.find(child=>child.label==='World building'),building);
 scene.destroy();assert.equal(root.destroyed,true);assert.equal(f.disposed,1);
});

test('retiring a partial load defers resource destruction until asynchronous stages drain',async()=>{
 const f=fixture(true),scene=await f.visible.promise;await f.layout.promise;const rejected=assert.rejects(f.pending,{name:'AbortError'});
 scene.destroy();assert.equal(scene.root.destroyed,false);f.models.resolve();f.surface.resolve();await rejected;assert.equal(scene.root.destroyed,true);assert.equal(f.disposed,1);scene.destroy();assert.equal(f.disposed,1);
});

const terrainWater={terrain:true,water:true,shell:true,building:false,structures:false,rocks:false,trees:false,vegetation:false,infrastructure:false,roads:false,decals:false,puddles:false,effects:false};
test('terrain and water never start model, catalog, road or detail loading; a later layer preserves terrain',async()=>{
 const f=fixture(true,terrainWater);f.surface.resolve();const scene=await f.pending;
 assert.deepEqual(f.modelRequests,[]);assert.ok(!f.requests.some(path=>path.endsWith('terrain-lod1.glb')),'distant terrain uses source heights without reconstructing full native GLB');assert.equal(scene.metrics.terrainGeometry.step,32);
 assert.ok(!f.requests.some(path=>/world.json|roads\/|world-fixes\/details|effects|utility|flags/.test(path)),JSON.stringify(f.requests));
 const terrain=scene.passes[0].current.geometry,regions=scene.root;
 scene.setLayers({...terrainWater,building:true});await f.layout.promise;
 assert.deepEqual(JSON.parse(JSON.stringify(f.modelRequests)),[['building']]);f.models.resolve();await scene.whenLayersReady();
 assert.equal(scene.passes[0].current.geometry,terrain);assert.equal(scene.root,regions);
 scene.setLayers(terrainWater);await scene.whenLayersReady();scene.setLayers({...terrainWater,building:true});await scene.whenLayersReady();
 assert.equal(f.modelRequests.length,2,'retired model layers reload while the same terrain stays resident');scene.destroy();
});

test('disabling a late layer drains its tasks before stopping workers and can be retried',async()=>{
 const f=fixture(true,terrainWater);f.surface.resolve();const scene=await f.pending;
 scene.setLayers({...terrainWater,building:true});await f.layout.promise;const count=f.finished;scene.setLayers(terrainWater);
 let idle=false;const drained=scene.whenLayersReady().then(()=>idle=true);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(idle,false);assert.equal(f.finished,count,'workers cannot stop while cancelled consumers are still draining');
 f.models.resolve();await drained;assert.equal(scene.root.children.some(c=>c.label==='World building'),false);scene.setLayers({...terrainWater,building:true});await scene.whenLayersReady();assert.equal(f.modelRequests.length,2);scene.destroy();
});

test('road tour metadata loads on demand without enabling road or model layers',async()=>{
 const f=fixture(true,terrainWater);f.surface.resolve();const scene=await f.pending;
 assert.equal(f.requests.some(path=>path.endsWith('roads/tour-source.json')),false);
 const tour=await scene.createRoadTour();assert.equal(tour.network.info.nativeCurves,1);
 assert.equal(tour.start({position:[0,60,0],target:[0,8,0]}),true);
 assert.ok(tour.update(.1).position.every(Number.isFinite));
 assert.deepEqual(f.modelRequests,[]);assert.equal(f.requests.filter(path=>path.endsWith('roads/tour-source.json')).length,1);
 scene.destroy();await assert.rejects(scene.createRoadTour(),{name:'AbortError'});
});

test('unchanged war state does not republish every resident cell visibility',async()=>{
 const f=fixture(false,{terrain:true,building:true,water:false,roads:false,structures:false,rocks:false,trees:false,vegetation:false,infrastructure:false,decals:false,puddles:false,effects:false});
 await f.layout.promise;f.models.resolve();f.surface.resolve();const scene=await f.pending;
 const war={items:[]};scene.setWarState(war);const calls=f.states.length;
 for(let i=0;i<60;i++)scene.setWarState(war);
 assert.equal(f.states.length,calls);
 scene.setWarState({items:[]});assert.ok(f.states.length>calls);scene.destroy();
});

test('progressive resident mode reveals terrain early, loads source detail once and retains explicitly enabled layers',async()=>{
 const f=fixture(true,terrainWater,{adaptiveStreaming:false}),partial=await f.visible.promise;
 assert.equal(f.done,false);assert.equal(partial.root[Symbol.for('nixie.spatial.full-detail-root')],true);assert.ok(partial.root.children.some(child=>child.label==='Loading Terrain'));
 f.surface.resolve();const scene=await f.pending;assert.equal(scene,partial);assert.equal(scene.metrics.progressive,true);assert.equal(scene.metrics.resident,true);assert.equal(scene.metrics.adaptiveStreaming,false);assert.equal(scene.metrics.terrainGeometry.step,1);assert.deepEqual(f.modelRequests,[]);
 f.models.resolve();scene.setLayers({...terrainWater,building:true});await scene.whenLayersReady();assert.deepEqual(JSON.parse(JSON.stringify(f.modelRequests)),[['building']]);assert.deepEqual(JSON.parse(JSON.stringify(f.modelPolicies)),[{optimize:false,publication:true}]);
 const building=scene.root.children.find(child=>child.label==='World building'),geometry=scene.passes[0].current.geometry;
 scene.setLayers(terrainWater);await scene.whenLayersReady();assert.equal(building.children[0].visible,false);assert.notEqual(building.destroyed,true);
 for(const position of [[0,0,0],[0,100000,0]])scene.update({camera:{position,height:800,fov:45},deltaMS:1000});
 scene.setLayers({...terrainWater,building:true});await scene.whenLayersReady();assert.equal(f.modelRequests.length,1);assert.equal(building.children[0].visible,true);assert.equal(scene.passes[0].current.geometry,geometry);scene.destroy();assert.equal(f.disposed,1);
});

test('hiding a progressive resident layer during its initial load does not cancel or rebuild that layer',async()=>{
 const f=fixture(true,{...terrainWater,building:true},{adaptiveStreaming:false}),scene=await f.visible.promise;await f.layout.promise;
 scene.setLayers(terrainWater);f.models.resolve();f.surface.resolve();await f.pending;assert.equal(f.modelRequests.length,1);
 const building=scene.root.children.find(child=>child.label==='World building');assert.ok(building);assert.equal(building.children[0].visible,false);
 scene.setLayers({...terrainWater,building:true});await scene.whenLayersReady();assert.equal(f.modelRequests.length,1);assert.equal(building.children[0].visible,true);scene.destroy();
});

test('streaming, model LOD, terrain LOD and terrain textures operate independently in the actual loader',async()=>{
 for(let mask=0;mask<16;mask++){
  const policy={adaptiveStreaming:!!(mask&1),modelLod:!!(mask&2),terrainLod:!!(mask&4),adaptiveTextures:!!(mask&8)};
  const f=fixture(true,{...terrainWater,building:true},policy);f.models.resolve();f.surface.resolve();const scene=await f.pending;
  try{
   assert.equal(scene.root[Symbol.for('nixie.spatial.full-detail-root')],true,JSON.stringify(policy));
   assert.equal(scene.metrics.resident,!policy.adaptiveStreaming);assert.equal(scene.metrics.progressive,true);
   for(const [key,value]of Object.entries(policy))assert.equal(scene.metrics[key],value);
   assert.equal(scene.metrics.terrainGeometry.step,policy.terrainLod?32:1);
   assert.deepEqual(f.terrainPolicies,[policy.terrainLod]);assert.deepEqual(f.texturePolicies,[{descriptor:policy.adaptiveTextures,pool:policy.adaptiveTextures}]);
   assert.equal(f.modelPolicies.length,1);assert.equal(f.modelPolicies[0].optimize,policy.modelLod);assert.equal(f.modelPolicies[0].publication,true);
   for(let i=0;i<2;i++)scene.update({camera:{position:[i*5,300,0],height:800,fov:45},deltaMS:16});
   assert.deepEqual(f.updates,{model:policy.modelLod?2:0,terrain:policy.terrainLod?2:0,textures:policy.adaptiveTextures?2:0});
   assert.equal(!!scene.metrics.modelCells?.building,policy.adaptiveStreaming,'only asset streaming creates cell residency');
  }finally{scene.destroy();}
 }
});

test('the compact loader defaults to progressive resident publication with source detail',async()=>{
 const f=fixture(undefined,terrainWater,{adaptiveStreaming:false}),partial=await f.visible.promise;
 assert.equal(f.done,false);assert.ok(partial.root.children.some(child=>child.label==='Loading Terrain'));
 f.surface.resolve();const scene=await f.pending;
 try{assert.equal(scene,partial);assert.equal(scene.metrics.progressive,true);assert.equal(scene.metrics.resident,true);assert.equal(scene.metrics.modelLod,false);assert.equal(scene.metrics.terrainLod,false);assert.equal(scene.metrics.adaptiveTextures,false);assert.equal(scene.metrics.terrainGeometry.step,1);}finally{scene.destroy();}
});
test('AO can switch during preparation and after readiness without replacing source geometry',async()=>{
 const f=fixture(true,terrainWater,{adaptiveStreaming:false}),scene=await f.visible.promise;
 scene.setAmbientOcclusion(false);assert.equal(scene.sharedPasses.ambientOcclusion.enabled,false);assert.equal(scene.sharedPasses.colorFinish.enabled,true);
 f.surface.resolve();await f.pending;assert.equal(scene.metrics.ambientOcclusion,false);const root=scene.root,geometry=scene.passes[0].current.geometry;
 for(const enabled of [true,false,true]){scene.setAmbientOcclusion(enabled);assert.equal(scene.sharedPasses.ambientOcclusion.enabled,enabled);assert.equal(scene.sharedPasses.colorFinish.enabled,!enabled);assert.equal(scene.metrics.ambientOcclusion,enabled);assert.equal(scene.root,root);assert.equal(scene.passes[0].current.geometry,geometry);}
 scene.destroy();
});

test('effect demand loads only enabled owner layers, with building effects independent of props',async()=>{
 const f=fixture(true,{...terrainWater,building:true,effects:true},{adaptiveStreaming:true});await f.layout.promise;f.models.resolve();f.surface.resolve();const scene=await f.pending;
 assert.deepEqual(f.detailRequests.sort(),['building','water']);
 assert.equal(f.requests.filter(p=>p.endsWith('/world.json')).length,1,'effect ownership reuses shared metadata without model/texture duplication');
 assert.equal(f.requests.filter(p=>p.endsWith('/effects/render.json')).length,1,'all effect owner groups share one immutable document');
 scene.setLayers({...terrainWater,vegetation:true,effects:true});await scene.whenLayersReady();
 assert.ok(f.detailRequests.includes('vegetation'));assert.equal(f.detailRequests.includes('structures'),false);scene.destroy();
});

test('water-only effects never request model placement metadata or geometry',async()=>{
 const f=fixture(true,{...terrainWater,effects:true},{adaptiveStreaming:true});f.surface.resolve();f.models.resolve();const scene=await f.pending;
 assert.deepEqual(f.detailRequests,['water']);assert.equal(f.requests.some(p=>p.endsWith('/world.json')),false);assert.deepEqual(f.modelRequests,[]);scene.destroy();
});

test('water shares RDZ settings and exemptions before and after framed material preparation',async()=>{
 const f=fixture(true,terrainWater,{waterGeometry:true}),scene=await f.visible.promise;
 scene.setPlanningOverlays({rdz:true,topo:true});
 f.surface.resolve();await f.pending;
 const water=scene.root.children.find(child=>child.label==='Water').children.find(child=>child.label==='Native Water');
 assert.ok(water);const material=water.material,planning=scene.passes[0].planning;
 try{
  assert.notEqual(material.destroyed,true,'bind the final framed material, not the destroyed original');
  assert.equal(material.data.terrainOverlayInfo[0],1);assert.equal(material.data.terrainOverlayInfo[1],1);
  assert.equal(material.textures.baseColor.source,planning.source);
  assert.ok(material._extraBits.some(bit=>bit.name==='waterPlanningOverlays'));
  const count=f.requests.length;
  scene.setWarState({items:[{iconType:20,x:.5,y:.05}]});
  assert.equal(material.data.terrainOverlayInfo[2],1);
  scene.setPlanningOverlays({rdz:false,topo:true});
  assert.equal(material.data.terrainOverlayInfo[0],0);assert.equal(material.data.terrainOverlayInfo[1],1);
  scene.setPlanningOverlays({rdz:true});assert.equal(material.data.terrainOverlayInfo[2],1);
  assert.equal(water.material,material);assert.equal(f.requests.length,count,'overlay changes never reload water');
 }finally{scene.destroy();}
});


test('full-quality preview replaces the placeholder without marking terrain ready early',async()=>{
 const f=fixture(true,terrainWater,{adaptiveStreaming:false,previewTerrain:true}),scene=await f.visible.promise;
 await f.previewShown.promise;
 assert.equal(scene.root.children.some(child=>child.label==='Loading Terrain'),false,'placeholder cannot overlap the textured preview');
 assert.equal(scene.passes[0].current.qualityCap,128);assert.equal(f.done,false);
 const terrain=scene.metrics.layers.find(layer=>layer.key==='terrain');assert.equal(terrain.loaded,false);assert.equal(terrain.loading,true);
 scene.setLayers({...terrainWater,terrain:false});assert.equal(scene.passes[0].visible,false);
 scene.setLayers(terrainWater);assert.equal(scene.passes[0].visible,true);
 f.surface.resolve();await f.pending;assert.equal(scene.passes[0].current.qualityCap,Infinity);assert.equal(scene.metrics.layers.find(layer=>layer.key==='terrain').loaded,true);scene.destroy();
});


test('scene disposal waits for both provider and terrain retirement',async()=>{
 const provider=deferred(),terrain=deferred(),f=fixture(true,terrainWater,{disposalGates:{provider,terrain}});
 await f.visible.promise;f.surface.resolve();const scene=await f.pending;let finished=false;
 const barrier=scene.whenDisposed().then(()=>{finished=true;});scene.destroy();scene.destroy();
 assert.equal(f.disposed,1);assert.equal(scene.root.destroyed,true,'idle scene still detaches and cleans up synchronously');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);provider.resolve();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'terrain remains owned');terrain.resolve();await barrier;assert.equal(finished,true);
});


test('post-ready work drains before the scene disposal barrier resolves',async()=>{
 const f=fixture(true,terrainWater);f.surface.resolve();const scene=await f.pending;
 scene.setLayers({...terrainWater,building:true});await f.layout.promise;let finished=false;
 const barrier=scene.whenDisposed().then(()=>{finished=true;});scene.destroy();
 assert.equal(scene.root.destroyed,false,'work retains its resources while it drains');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);f.models.resolve();await barrier;
 assert.equal(scene.root.destroyed,true);assert.equal(f.disposed,1);
});


test('native models and catalog models prepare together after layer layout is owned',async()=>{
 const f=fixture(true,{...terrainWater,building:true},{adaptiveStreaming:false,deferCatalog:true});
 await f.layout.promise;await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(f.catalogRequests,1,'catalog loading must start before the native model gate completes');assert.equal(f.done,false);}
 finally{f.models.resolve();f.surface.resolve();f.catalogGate.resolve();const scene=await f.pending;scene.destroy();}
 assert.equal(f.catalogDisposed,1);
});

test('native model failure drains its parallel catalog before destroying layer ownership',async()=>{
 const f=fixture(true,{...terrainWater,building:true},{adaptiveStreaming:false,deferCatalog:true,failModels:true}),pending=f.pending.catch(error=>error);
 const scene=await f.visible.promise;await f.layout.promise;f.models.resolve();f.surface.resolve();
 await new Promise(resolve=>setTimeout(resolve,10));
 try{assert.equal(f.catalogRequests,1);assert.equal(scene.root.destroyed,false,'catalog still owns the layer while it drains');assert.equal(f.disposed,0);}
 finally{f.catalogGate.resolve();const error=await pending;assert.match(error.message,/native fixture failed/);}
 assert.equal(scene.root.destroyed,true);assert.equal(f.catalogDisposed,1);assert.equal(f.disposed,1);
});
