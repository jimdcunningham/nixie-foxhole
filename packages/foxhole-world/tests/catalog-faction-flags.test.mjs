import {factionFlagPassMask} from '../authoring/surface-decal-pass.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {Texture} from 'pixi.js';import {Container3D,Material3D,parseGltf,RenderPassBit} from '@pixi/3d';
import {catalogFactionFlag,catalogStructureOwner} from '../authoring/catalog-faction-flags.mjs';
import {acquireCatalogFlagMaterials} from '../runtime/catalog-flag-materials.mjs';
import {loadRegionCatalog} from '../runtime/load-region-catalog.mjs';import {loadWorldModels} from '../authoring/world-models.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],placement=(x=0)=>({kind:'fixed',actor:'base'+x,asset:'hospital',category:'building',matrix:[...identity.slice(0,12),x,0,0,1]}),icon=(teamId,x=0,flags=0,iconType=11)=>({teamId,flags,iconType,x:.5+x/2184,y:.5});
async function model(){const a=new Float32Array([0,0,0,1,0,0,0,1,0]);return parseGltf({asset:{version:'2.0'},buffers:[{byteLength:a.byteLength}],bufferViews:[{buffer:0,byteLength:a.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],materials:[{name:'Body'},{name:'FlagHangingColonials',alphaMode:'BLEND',emissiveFactor:[1,1,1]}],meshes:[{primitives:[{attributes:{POSITION:0},material:0},{attributes:{POSITION:0},material:1}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0},[a.buffer]);}
test('ownership comes only from a matching public structure marker and supported authored faction cloth',()=>{
 for(const type of [11,17,27,34,45,56,75,84,88])assert.equal(catalogStructureOwner(placement(),{items:[icon('WARDENS',0,8,type)]}),'WARDENS');
 for(const state of [null,{items:[]},{items:[icon('NONE')]},{items:[icon('WARDENS',30)]},{items:[icon('WARDENS',0,4)]},{items:[icon('WARDENS',0,0,20)]}])assert.equal(catalogStructureOwner(placement(),state),null);
 for(const name of ['FlagHangingColonials','FlagHangingColonialsTownHall','FlagHangingWardens','FlagWindA','GarrisonFlag'])assert.equal(catalogFactionFlag('hospital',name),true);
 assert.equal(catalogFactionFlag('relicbase1','WaterMeasurement:parameter-light'),true);assert.equal(catalogFactionFlag('refinery','WaterMeasurement:parameter-light'),false);assert.equal(catalogFactionFlag('hospital','HospitalFlag'),false);
});
for(const flagSurfacePass of [false,true])test('catalog flags preserve captures and body materials with surface pass '+flagSurfacePass,async()=>{
 const source=await model(),root=new Container3D(),COLONIALS=new Material3D({baseColor:0x516c4b}),WARDENS=new Material3D({baseColor:0x245682}),materials={COLONIALS,WARDENS},catalog={assets:{hospital:{path:'types/structures/hospital/hospital.glb',offsetX:0,offsetY:0,offsetZ:0}}};
 const scene=await loadRegionCatalog({flagSurfacePass,baseUrl:'https://assets.test/world/',catalog,layers:{building:root},placements:[placement(),placement(100)],flagMaterials:materials,loadModel:async()=>source,getWarState:()=>({items:[icon('COLONIALS'),icon('WARDENS',100)]})});
 const items=scene.batches[0].items;assert.equal(items[0].material,source.materials[0]);assert.equal(items[1].material,COLONIALS);assert.equal(items[3].material,WARDENS);assert.equal(items[1]._lastRenderPass,flagSurfacePass?factionFlagPassMask(COLONIALS):RenderPassBit.OPAQUE|RenderPassBit.SHADOW);assert.ok(items[0]._lastRenderPass&RenderPassBit.OPAQUE);if(flagSurfacePass)assert.equal(items[1]._lastRenderPass&RenderPassBit.OPAQUE,0);
 scene.setWarState({items:[icon('WARDENS'),icon('NONE',100)]});assert.equal(items[1].material,WARDENS);assert.equal(items[3]._lastRenderPass,0);assert.ok(items[2]._lastRenderPass);
 scene.setWarState({items:[icon('COLONIALS',0,4)]});assert.equal(items[1]._lastRenderPass,0);assert.equal(source.materials[1].alphaMode,'blend');assert.notEqual(items[1].material,source.materials[1]);
 scene.destroy();root.destroy();source.destroy();COLONIALS.destroy();WARDENS.destroy();
});
test('faction materials share two immutable textures until the last region lease retires',async()=>{
 const urls=[],options={loadTexture:async url=>{urls.push(url);return Texture.WHITE;}},a=await acquireCatalogFlagMaterials('https://flags.test/assets/world/',options),b=await acquireCatalogFlagMaterials('https://flags.test/assets/world/',options);
 assert.equal(urls.length,2);assert.equal(a.materials,b.materials);assert.equal(a.materials.WARDENS.alphaMode,'mask');a.release();a.release();assert.equal(b.materials.COLONIALS.alphaMode,'mask');b.release();const c=await acquireCatalogFlagMaterials('https://flags.test/assets/world/',options);assert.notEqual(c.materials,a.materials);c.release();
});
for(const flagSurfacePass of [false,true])test('native flags preserve captures with surface pass '+flagSurfacePass,async()=>{
 const before=globalThis.location;globalThis.location={search:''};const source=await model(),root=new Container3D(),requested=[];let world;
 try{world=await loadWorldModels({flagSurfacePass,region:'fixture',root,optimize:false,status(){},teamAt:()=> 'NONE',flagTexture:async team=>{requested.push(team);return Texture.WHITE;},worldData:{prototypes:[{name:'NativeBase/Mesh',file:'base.gltf',category:'building',kind:'building',placements:[{actor:'base',matrix:identity}]}]},json:async()=>({assets:{}}),loadModel:async()=>source});
 world.setWarState({items:[icon('COLONIALS')]});await new Promise(setImmediate);assert.equal(world.batches[0].items[1]._lastRenderPass,flagSurfacePass?factionFlagPassMask(world.batches[0].items[1].material):RenderPassBit.OPAQUE|RenderPassBit.SHADOW);world.setWarState({items:[icon('WARDENS')]});await new Promise(setImmediate);assert.deepEqual(requested,['COLONIALS','WARDENS']);world.setWarState({items:[icon('NONE')]});assert.equal(world.batches[0].items[1]._lastRenderPass,0);
 }finally{world?.dispose();root.destroy({children:true});source.destroy();globalThis.location=before;}
});
