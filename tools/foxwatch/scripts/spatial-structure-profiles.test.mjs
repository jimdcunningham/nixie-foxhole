import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSpatialStructureScene,prepareSpatialStructureModifications,spatialStructureProfile} from './spatial-structure-profiles.mjs';
test('authored component names bind repeated geometry without relying on bounds or export order',()=>{
 const scene={scene:{roots:[{name:'Root',children:[{name:'Front',meshId:'same',children:[]},{name:'Back',meshId:'same',children:[]}]}]}};
 const asset={renderLayers:[{i:'frontwall',cn:'Front'},{i:'backwall',cn:'Back'}]};
 const copy=structuredClone(scene),prepared=prepareSpatialStructureScene(asset,scene);
 assert.deepEqual(scene,copy);assert.equal(prepared.scene.roots[0].children[0].spatialGroup,'structure-layer-frontwall');
 assert.deepEqual(spatialStructureProfile(prepared,{semanticGroups:{'structure-layer-frontwall':'front-group','structure-layer-backwall':'back-group'}}),
 {version:1,layers:{frontwall:['front-group'],backwall:['back-group']}});
});

test('optional parts retain their authored slot transforms and qualified meshes without mutating prototypes',async()=>{
 const slot={id:'asset:slot',name:'Common:FrontModSlot',unrealLocationCentimeters:[250,0,-160],unrealRotationDegrees:[0,-90,0],children:[{id:'wall',name:'Wall',meshId:'wall',children:[]}]};
 const asset={id:'asset',codeName:'FortT3',isBunker:true,renderLayers:[{i:'frontwall',cn:'Common:FrontModSlot'}],modifications:[{name:'FrontModSlot',variants:{door:{}}}]};
 const input={scene:{roots:[slot]},assets:{meshes:[{id:'wall',sourcePath:'wall.glb'}],materials:[]}};
 const prototype={scene:{roots:[{id:'prototype',name:'Door',meshId:'wall',children:[]}]},assets:{meshes:[{id:'wall',sourcePath:'door.glb'}],materials:[]}};
 const before=structuredClone({input,prototype});
 const shared=new Map([['asset:FrontModSlot:door','door-hash']]);
 const prepared=await prepareSpatialStructureModifications(asset,prepareSpatialStructureScene(asset,input),async path=>path==='mods/door-hash.scene.json'?prototype:undefined,shared);
 assert.deepEqual({input,prototype},before);
 assert.deepEqual(prepared.scene.roots[0].unrealRotationDegrees,[0,-90,0]);
 const part=prepared.spatialModifications[0];assert.deepEqual(part.replacesLayers,['frontwall']);
 assert.notEqual(prepared.scene.roots[0].children[1].children[0].meshId,'wall');
 assert.equal(prepared.assets.meshes[1].sourcePath,'door.glb');
 assert.deepEqual(spatialStructureProfile(prepared,{semanticGroups:{[part.group]:'door-group','structure-layer-frontwall':'wall-group'}}).modifications,
 [{slotId:'FrontModSlot',variantId:'door',nodeNames:['door-group'],replacesLayers:['frontwall']}]);
 await assert.rejects(()=>prepareSpatialStructureModifications(asset,prepareSpatialStructureScene(asset,input),async()=>undefined),/Missing structural/);
});
test('component scenes bind composite roofs and inherited aliases through exact source ancestry',async()=>{
 const mesh={id:'roof',name:'Roof',meshId:'roof',children:[]};
 const scene={scene:{roots:[{id:'root',name:'Base',children:[mesh]}]},assets:{meshes:[],materials:[]}};
 const asset={id:'base',codeName:'FortBaseT2',isBunker:true,renderLayers:[{i:'roof',cn:'LegacyRoofSlot'}]};
 const prepared=await prepareSpatialStructureModifications(asset,prepareSpatialStructureScene(asset,scene),async path=>path==='base/components/roof.scene.json'?scene:undefined);
 assert.equal(prepared.scene.roots[0].children[0].spatialGroup,'structure-layer-roof');
});
