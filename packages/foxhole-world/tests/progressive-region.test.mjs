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
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {completeLoadTasks} from '../runtime/load-tasks.mjs';
import {createRegionRevealQueue} from '../runtime/progressive-loading.mjs';
import {createRegionLayerVisibility} from '../runtime/region-layer-visibility.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const source=readFileSync(new URL('../runtime/load-compact-region.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')+'\nloadCompactRegion;';

function fixture(progressive,layers,{adaptiveStreaming=progressive,modelLod=adaptiveStreaming,terrainLod=adaptiveStreaming,adaptiveTextures=false}={}){
 const surface=deferred(),models=deferred(),visible=deferred(),layout=deferred(),states=[],requests=[],detailRequests=[],modelRequests=[],modelPolicies=[],terrainPolicies=[],texturePolicies=[],updates={model:0,terrain:0,textures:0};let partial,root,disposed=0,finished=0;
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
 class Terrain extends Pass {async load(_region,geometry,options){texturePolicies.push({descriptor:!!options.terrainDescriptor,pool:!!options.texturePool});options.status('Loading terrain textures');await surface.promise;this.current={geometry};}updateQuality(){updates.textures++;}}
 class Shoulders extends Pass {constructor(){super();this.summary={sourceTriangles:0};}async prepare(){}finish(){}}
 const provider={terrainDescriptor:()=>({}),metrics:{},json:async path=>{requests.push(path);return path.endsWith('roads/tour-source.json')?{curves:[{id:'road',mesh:'road',points:[[0,8,0],[400,8,0]]}]}:path.endsWith('terrain.json')?{min:[0,8,0],max:[1,8,1],components:[{name:'fixture',size:2,offset:0}]}:path.endsWith('world.json')?{prototypes:[{name:'House',file:'house.gltf',kind:'building',category:'building',placements:[{actor:'house',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]}]}:path.endsWith('flags.json')?[]:path.endsWith('roads/render.json')?{materials:{},chunks:[]}:{};},binary:async path=>{requests.push(path);return path.endsWith('terrain.bin')?new Float32Array([0,8,0,1,8,0,0,8,1,1,8,1]).buffer:path;},zipped:async()=>new ArrayBuffer(0),texture:async()=>({}),environment:async()=>({}),readRoadAssembly:async()=>({}),writeRoadAssembly:async()=>{},stage(){},report(){},url:path=>path,trackExternalAsset(){},async measure(_name,fn){return fn();},finish(){finished++;return{readyMs:100};},destroy(){disposed++;}};
 const load=runInNewContext(source,{prepareVegetationWindShadows,createVegetationWind,normalizeWorldModelLayers,worldModelLayers,waterSurfaceSampler,modelCells,createModelCellStream,RoadTour,buildRoadNetwork,buildClearanceSampler,performance,AbortController,AbortSignal,DOMException,Float64Array,Float32Array,Uint32Array,ArrayBuffer,Map,Set,Math,Promise,
  createCompactProvider:async()=>provider,Container3D:Container,Geometry3D:Geometry,Material3D:Material,Mesh3D:Mesh,
  createTerrainExcavationMask:()=>({bind(){},set(){},destroy(){}}),LiveTerrainPass:Terrain,RoadShoulderPass:Shoulders,SurfaceDecalPass:Pass,SafeSsaoEffect:Pass,SceneColorFinishEffect:Pass,
  catalogLightBudgetFor,effectLayers,setRegionFrustumCulling,createWorldActorVisibility,buildTerrainPreview,terrainTexturePoolFor:()=>({}),createChunkedTerrainLod:options=>{terrainPolicies.push(options.adaptive);const chunks=createChunkedTerrainLod(options),update=chunks.update.bind(chunks);chunks.update=(...args)=>{updates.terrain++;return update(...args);};return chunks;},createRegionRevealQueue,createRegionLayerVisibility,completeLoadTasks,createLayerDemand,craneSpawnPlacements:()=>[],catalogBindingFor:()=>null,loadRailGeometry:async()=>({}),
  createRegionFramePreparation:()=>({frame:new Float32Array([0,0,32,0]),prepare(){}}),framedMaterialBits:bits=>bits,
  parseGlb:path=>({view:index=>index===2?new Uint32Array(path.includes('water')?[]:[0,1,2]):new Float32Array([0,0,0,1,0,0,0,0,1])}),WIDTH:2184,HEIGHT:1890,heightSampler:()=>()=>8,
  packWeatherSurfaceTextures:()=>({destroy(){}}),unpackRoadAssembly:()=>({chunks:[]}),packRoadAssembly:()=>new Uint8Array(),
  buildRegionShell:()=>({positions:new Float32Array(),normals:new Float32Array(),indices:new Uint32Array()}),shellDepthBit:{name:"shell"},REGION_SHELL_COLOR:0x191919,weatherSurfaceBit:{name:"weather"},
  prepareRegionEnvironment:()=>()=>{},prepareFirstFrameMaterials:()=>()=>{},renderedModelGeometries,readWorldCatalog:async()=>({}),
  loadWorldModels:async({root:modelsRoot,onLayout,signal,categories,optimize,progressive:publication})=>{modelPolicies.push({optimize,publication});modelRequests.push(categories||['bridges']);const world={layers:Object.fromEntries((categories||['infrastructure']).map(key=>[key,new Container()])),counts:{failed:[],lodFailures:[]},owned:[],sites:[],catalogPlacements:[],cranePlacements:[],bridgeRoadSeams:{},setWarState(state){states.push(state);return true;},actorVisible:()=>true,lod:{update(){updates.model++;}},dispose(){}};for(const layer of Object.values(world.layers))modelsRoot.addChild(layer);onLayout(world);layout.resolve();await models.promise;signal.throwIfAborted();return world;},
  loadRegionCranes:async()=>({count:0,destroy(){}}),loadRegionCatalog:async()=>({summary:{},setWarState(){},destroy(){}}),
  createRoadTransitions:async()=>({}),loadRoadDecals:async({root})=>({root}),loadWorldDetails:async({bridgeRoadSeams,effectLayer})=>{if(effectLayer)detailRequests.push(effectLayer);await bridgeRoadSeams;return{syncLayers(){},setActorVisibility(){},update(){}};},
 });
 let done=false;const pending=load({baseUrl:'https://world.test/',entry:{id:'fixture'},frame:{x:0,y:0,scale:32},progressive,adaptiveStreaming,modelLod,terrainLod,adaptiveTextures,layers,onSceneReady:scene=>{partial=scene;root=scene.root;visible.resolve(scene);}}).then(scene=>{done=true;root=scene.root;return scene;});
 return{surface,models,visible,layout,states,pending,requests,detailRequests,modelRequests,modelPolicies,terrainPolicies,texturePolicies,updates,get partial(){return partial;},get root(){return root;},get done(){return done;},get disposed(){return disposed;},get finished(){return finished;}};
}

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
   assert.equal(scene.root[Symbol.for('nixie.spatial.full-detail-root')],policy.modelLod?undefined:true,JSON.stringify(policy));
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
