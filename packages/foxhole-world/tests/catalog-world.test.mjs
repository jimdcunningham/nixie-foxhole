import {createCatalogLightBudget} from '../runtime/catalog-lights.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {Container3D,parseGltf,RenderPassBit} from '@pixi/3d';
import {prepareCatalogWorld,catalogWorldPlacements,selectCatalogWorld,catalogFamilies,catalogBindingFor} from '../authoring/catalog-world-policy.mjs';
import {loadRegionCatalog} from '../runtime/load-region-catalog.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';
import {applyRegionFrame} from '../runtime/spatial-frame.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],row=(actor,x=0)=>({actor,matrix:[...identity.slice(0,12),x,7,0,1]}),icon=(iconType,x=0)=>({iconType,x:.5+x/2184,y:.5});
const ids=[...Object.values(catalogFamilies).flatMap(Object.values),'refinery'];
const catalog={assets:Object.fromEntries(ids.map(asset=>[asset,{path:'types/structures/'+asset+'/'+asset+'.glb',offsetX:32,offsetY:64,offsetZ:96,sha256:'a'.repeat(64),bytes:100}]))};
function data(){return {prototypes:[...['Area','ScrapMine','SulfurMine','ComponentMine'].map(component=>({name:'BPResourceMineProxy_C/'+component,file:component+'.gltf',category:'structures',kind:'environment',placements:[row('mine')]})),{name:'BPRefinery_C/Wall',file:'wall.gltf',category:'structures',kind:'building',placements:[row('refinery',100)]},{name:'BPRefinery_C/Props',file:'props.gltf',category:'structures',placements:[row('refinery',100)]},{name:'UncataloguedScenery/Mesh',file:'scenery.gltf',category:'rocks',placements:[row('rock',200)]}]};}
test('catalog policy replaces entire proxy assemblies and exact static blueprints while retaining native actors',()=>{const before=data(),result=prepareCatalogWorld(before,catalog);assert.equal(before.prototypes.length,7);assert.equal(result.world.prototypes.length,3);assert.equal(result.placements.length,2);assert.ok(!JSON.stringify(result.world).includes('Area.gltf'));assert.deepEqual([...result.remainingFiles],['scenery.gltf']);assert.equal(result.placements.find(p=>p.actor==='refinery').category,'building');assert.deepEqual([...selectCatalogWorld(result.placements,{items:[icon(40)]}).values()].sort(),['componentmine','refinery']);assert.deepEqual([...selectCatalogWorld(result.placements,null).values()],['refinery']);assert.equal(catalogBindingFor({name:'BPRefinery_C/Bridge',category:'infrastructure'},catalog),null);assert.deepEqual(prepareCatalogWorld(result.world,catalog).world,result.world,'publication is idempotent');});
async function triangle({flag=false,anchor=false}={}){const a=new Float32Array([0,0,0,1,0,0,0,1,0]);return parseGltf({asset:{version:'2.0'},buffers:[{byteLength:a.byteLength}],bufferViews:[{buffer:0,byteLength:a.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],materials:[{name:"Body"},...(flag?[{name:"FlagHangingColonials"}]:[])],meshes:[{primitives:[{attributes:{POSITION:0},material:0},...(flag?[{attributes:{POSITION:0},material:1}]:[])]}],nodes:[{mesh:0},...(anchor?[{name:"Crane Spawn",translation:[4,5,6]}]:[])],scenes:[{nodes:anchor?[0,1]:[0]}],scene:0},[a.buffer]);}
test('catalog mines share source buffers, retain pivots, choose one type and survive reflected region frames',async()=>{const source=await triangle(),root=new Container3D(),layers={structures:new Container3D(),building:new Container3D()},loads=[];root.addChild(layers.structures,layers.building);const placements=catalogWorldPlacements(data(),catalog),scene=await loadRegionCatalog({baseUrl:'https://assets.test/world/',catalog,layers,placements,loadModel:async url=>{loads.push(url);return source;}});scene.setWarState({items:[icon(40)]});assert.deepEqual(scene.summary.byAsset,{refinery:1,componentmine:1});const mine=scene.batches.find(b=>b.label==='Catalog componentmine'),sulfur=scene.batches.find(b=>b.label==='Catalog sulfurmine');assert.ok(mine.items[0]._lastRenderPass&RenderPassBit.OPAQUE);assert.equal(sulfur.items[0]._lastRenderPass,0);assert.deepEqual([...mine.items[0].geometry.indexBuffer.data],[0,2,1]);assert.equal(mine.items[0].geometry.attributes.aPosition.buffer,source.geometries[0][0].attributes.aPosition.buffer);assert.deepEqual([...mine.matrices.data.slice(mine.matrices.offset+12,mine.matrices.offset+15)],[1,10,-2]);applyRegionFrame({root,materials:[],terrainPass:{}},{scale:32});assert.deepEqual([...mine.items[0].geometry.indexBuffer.data],[0,1,2]);const count=loads.length;scene.setWarState({items:[icon(32)]});assert.equal(mine.items[0]._lastRenderPass,0);assert.ok(sulfur.items[0]._lastRenderPass);assert.equal(loads.length,count);scene.setWarState(null,actor=>actor!=='refinery');assert.equal(scene.summary.visible,0);const g=source.geometries[0][0];scene.destroy();root.destroy({children:true});assert.notEqual(g.destroyed,true);source.destroy();});
test('published catalog actor metadata keeps layout selection while skipping native meshes and duplicate cranes',async()=>{const saved=globalThis.location;globalThis.location={search:''};const root=new Container3D();let world;try{world=await loadWorldModels({region:'fixture',root,catalog,status(){},teamAt:()=> 'NONE',json:async path=>path.endsWith('world.json')?prepareCatalogWorld(data(),catalog).world:{assets:{}},loadModel:async()=>triangle()});assert.deepEqual(world.counts.failed,[]);assert.equal(world.catalogPlacements.length,2);assert.equal(world.cranePlacements.length,0,'catalog refinery owns its posed crane');}finally{world?.dispose();root.destroy({children:true});globalThis.location=saved;}});

test('catalog owners attach one shared posed part and omit separately rendered faction flags',async()=>{
 const source=await triangle({flag:true,anchor:true}),shared=await triangle(),id='shared.'+'c'.repeat(64),d=structuredClone(catalog);d.assets.refinery.modelParts={parts:[{resourceId:'foxhole.model.'+id,nodeName:'Crane Spawn'}]};d.sharedParts={[id]:{path:'shared/models/'+id.slice(7)+'.glb'}};
 const root=new Container3D(),scene=await loadRegionCatalog({baseUrl:'https://assets.test/world/',catalog:d,layers:{structures:root},placements:[{actor:'refinery',kind:'fixed',asset:'refinery',category:'structures',matrix:identity}],loadModel:async url=>url.includes('/shared/models/')?shared:source});scene.setWarState(null);
 const batch=scene.batches[0];assert.equal(batch.size,2,'one building mesh plus one shared crane mesh; no duplicate flag');assert.equal(batch.items[1].geometry.attributes.aPosition.buffer,shared.geometries[0][0].attributes.aPosition.buffer);const m=batch.matrices;assert.deepEqual([...m.data.slice(m.offset+m.stride+12,m.offset+m.stride+15)],[5,8,-8]);scene.destroy();root.destroy();assert.notEqual(shared.geometries[0][0].destroyed,true);source.destroy();shared.destroy();
});

test('catalog batches reveal ready assets before slow siblings with war masks already applied',async()=>{
 const source=await triangle(),layers={building:new Container3D()},published=[];let release,firstReady;
 const slow=new Promise(resolve=>{release=resolve;}),first=new Promise(resolve=>{firstReady=resolve;});
 const d={assets:{alpha:{path:'types/structures/alpha/alpha.glb',offsetX:0,offsetY:0,offsetZ:0},beta:{path:'types/structures/beta/beta.glb',offsetX:0,offsetY:0,offsetZ:0}}};
 const placements=['alpha','beta'].map(asset=>({actor:asset,kind:'fixed',asset,category:'building',matrix:identity}));
 const pending=loadRegionCatalog({baseUrl:'https://assets.test/world/',catalog:d,layers,placements,progressive:true,actorVisible:actor=>actor!=='beta',loadModel:async url=>{if(url.includes('/alpha/'))await slow;return source;},publishBatch:build=>{const batch=build();published.push({label:batch.label,active:batch.items[0]._lastRenderPass});firstReady();return batch;}});
 await first;assert.deepEqual(published,[{label:'Catalog beta',active:0}]);release();const scene=await pending;
 assert.equal(published[1].label,'Catalog alpha');assert.ok(published[1].active&RenderPassBit.OPAQUE);scene.destroy();layers.building.destroy({children:true});source.destroy();
});

test('native progressive batches are bounded and appear while a slow model is pending',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const source=await triangle(),root=new Container3D();let release,firstReady,port,world;
 const slow=new Promise(resolve=>{release=resolve;}),first=new Promise(resolve=>{firstReady=resolve;}),sizes=[];
 const prototypes=[{name:'Fast',file:'fast.glb',category:'rocks',placements:Array.from({length:600},(_,i)=>row('fast'+i))},{name:'Slow',file:'slow.glb',category:'building',kind:'building',placements:[row('slow')]}];
 try{
  const pending=loadWorldModels({region:'fixture',root,status(){},teamAt:()=> 'NONE',json:async path=>path.endsWith('world.json')?{prototypes}:{assets:{}},progressive:true,concurrency:1,onLayout:value=>{port=value;},loadModel:async url=>{if(url.includes('slow.glb'))await slow;return source;},publishBatch:build=>{const batch=build();sizes.push(batch.size);firstReady();return batch;}});
  await first;assert.ok(port.layers.rocks.children.length>0);assert.equal(port.layers.building.children.length,0);assert.equal(sizes[0],512);release();world=await pending;assert.ok(sizes.every(size=>size<=512));assert.equal(sizes.reduce((sum,n)=>sum+n,0),601);assert.deepEqual(world.counts.failed,[]);
 }finally{release();(world||port)?.dispose();root.destroy({children:true});source.destroy();globalThis.location=saved;}
});

test('large catalog groups reveal at most 512 parts per scheduled batch',async()=>{
 const source=await triangle(),root=new Container3D(),d={assets:{refinery:{path:'types/structures/refinery/refinery.glb',offsetX:0,offsetY:0,offsetZ:0}}};
 const scene=await loadRegionCatalog({baseUrl:'https://assets.test/world/',catalog:d,layers:{building:root},placements:Array.from({length:600},(_,i)=>({actor:'a'+i,kind:'fixed',asset:'refinery',category:'building',matrix:identity})),progressive:true,loadModel:async()=>source});
 assert.deepEqual(scene.batches.map(batch=>batch.size),[512,88]);assert.equal(scene.summary.visible,600);scene.destroy();root.destroy({children:true});source.destroy();
});

test('distant progressive native batches use resident coarse LOD until normal LOD takes over',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const source=await triangle(),root=new Container3D(),seen=[];let world;
 const prototypes=[{name:'Rock',file:'rock.glb',category:'rocks',placements:[row('rock')]}];
 try{
  world=await loadWorldModels({region:'fixture',root,status(){},teamAt:()=> 'NONE',json:async path=>path.endsWith('world.json')?{prototypes}:path.endsWith('lod-manifest.json')?{assets:{'rock.glb':{levels:[{file:'lod1.glb'},{file:'lod2.glb'}]}}}:{assets:{}},progressive:true,priorityPosition:[0,0,2000],loadModel:async()=>source,publishBatch:build=>{const batch=build();seen.push({level:batch.label.at(-1),visible:batch.visible,lane:batch.items[0]._worldVisible});return batch;}});
  assert.deepEqual(seen.map(row=>row.lane),[0,0,1]);assert.equal(seen[2].visible,true);
  assert.equal(world.lodRecords[0].levels[0][0].batch.items[0]._worldVisible,1,'completed LOD can restore full detail');
  world.lod.update({position:[0,0,2000],height:800,fov:45,force:true});assert.equal(world.lodRecords[0].levels[2][0].batch.items[0]._worldVisible,1);
 }finally{world?.dispose();root.destroy({children:true});source.destroy();globalThis.location=saved;}
});


test('catalog batching retains nested/shared light transforms and masks them with their actor',async()=>{
 const positions=new Float32Array([0,0,0,1,0,0,0,1,0]);
 const source=await parseGltf({asset:{version:'2.0'},buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],extensions:{KHR_lights_punctual:{lights:[{type:'point',intensity:7,range:5,color:[1,.5,.25]}]}},nodes:[{mesh:0},{name:'Light Parent',translation:[2,4,6],children:[2]},{translation:[1,0,0],extensions:{KHR_lights_punctual:{light:0}}}],scenes:[{nodes:[0,1]}],scene:0},[positions.buffer]);
 const shared=await triangle({anchor:true}),id='shared.'+'d'.repeat(64),d=structuredClone(catalog);
 // Use the lit model as a shared part, proving traversal survives catalog hydration.
 d.assets.refinery.modelParts={parts:[{resourceId:'foxhole.model.'+id,nodeName:'Crane Spawn'}]};d.sharedParts={[id]:{path:'shared/models/'+id.slice(7)+'.glb'}};
 const root=new Container3D(),budget=createCatalogLightBudget();
 const scene=await loadRegionCatalog({baseUrl:'https://assets.test/world/',catalog:d,layers:{building:root},placements:[{actor:'depot',kind:'fixed',asset:'refinery',category:'building',matrix:row('depot',20).matrix}],loadModel:async url=>url.includes('/shared/models/')?source:shared,lightBudget:budget});
 assert.equal(scene.summary.lightCount,1);budget.update([28,19,-14]);const lamp=root.children.find(n=>n.label==='Catalog Light');assert.ok(lamp);assert.deepEqual([lamp.position.x,lamp.position.y,lamp.position.z],[28,19,-14]);assert.equal(lamp.range,5);assert.equal(lamp.intensity,7);
 scene.setWarState(null,()=>false);budget.update([0,0,0]);assert.equal(lamp.visible,false);assert.equal(scene.summary.visible,0);
 scene.setWarState(null);budget.update([0,0,0]);assert.equal(lamp.visible,true);scene.destroy();assert.equal(lamp.destroyed,true);assert.equal(budget.metrics.candidates,0);root.destroy({children:true});source.destroy();shared.destroy();
});
