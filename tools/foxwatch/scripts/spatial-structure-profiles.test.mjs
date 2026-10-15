import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSpatialStructureScene,spatialStructureProfile} from './spatial-structure-profiles.mjs';
test('authored component names bind repeated geometry without relying on bounds or export order',()=>{
 const scene={scene:{roots:[{name:'Root',children:[{name:'Front',meshId:'same',children:[]},{name:'Back',meshId:'same',children:[]}]}]}};
 const asset={renderLayers:[{i:'frontwall',cn:'Front'},{i:'backwall',cn:'Back'}]};
 const copy=structuredClone(scene),prepared=prepareSpatialStructureScene(asset,scene);
 assert.deepEqual(scene,copy);assert.equal(prepared.scene.roots[0].children[0].spatialGroup,'structure-layer-frontwall');
 assert.deepEqual(spatialStructureProfile(prepared,{semanticGroups:{'structure-layer-frontwall':'front-group','structure-layer-backwall':'back-group'}}),
 {version:1,layers:{frontwall:['front-group'],backwall:['back-group']}});
});
