import test from 'node:test';import assert from 'node:assert/strict';
import {prepareSpatialTrenchScene,spatialTrenchProfile} from './spatial-trench-profiles.mjs';
test('trench profiles include absent sample prototypes and retain canonical transforms without editing inputs',async()=>{
 const input={scene:{roots:[]},assets:{meshes:[],materials:[]},spatialLayerGroups:{old:'old'}},asset={id:'trenchconnectort3',renderLayers:[{i:'piece-wall'}]};
 const prototype={scene:{roots:[{id:'wall',name:'wall',meshId:'wall',unrealLocationCentimeters:[0,0,-160],children:[]}]},assets:{meshes:[{id:'wall',sourcePath:'wall.glb'}],materials:[]}};
 const prepared=await prepareSpatialTrenchScene(asset,input,async()=>prototype);assert.equal(prepared.scene.roots.length,2);assert.equal(input.scene.roots.length,0);assert.equal(prototype.assets.meshes[0].id,'wall');
 const groups=Object.fromEntries(Object.values(prepared.spatialTrenchParts).map(key=>[key,key]));
 const document={nodes:Object.values(groups).map((name,index)=>({name,mesh:index})),meshes:[{},{}]};
 const profile=spatialTrenchProfile(prepared,document,{semanticGroups:groups});assert.equal(profile.parts.floor.meshIndex,1);
 await assert.rejects(()=>prepareSpatialTrenchScene(asset,input,async()=>undefined),/Missing trench spatial prototype/);
});
