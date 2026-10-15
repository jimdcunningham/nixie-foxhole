import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import assets from '../src/scene-v2-assets-node.ts';
import {bindFoxholeModelLayerNodes} from '../src/model-layer-nodes.ts';
import {renderFoxholeSceneV2Entity} from '../src/scene-v2-renderers.ts';
import {getFoxholeSceneV2ModelComponentData} from '../src/scene-v2-models.ts';
import type {NixieExperimentalComponentEntitySnapshotV1 as Entity} from '@nixie/extension-sdk/experimental/scene-v2';
const make=(id:string,sockets:string[]=[]):Entity=>({entityId:'structure',revision:1,components:[
 {ownerId:'nixie.foxhole-planner',componentId:'asset',version:1,definitionAvailable:true,data:{catalogId:'foxhole.structures',assetId:id}},
 {ownerId:'nixie.foxhole-planner',componentId:'socket-attachments',version:1,definitionAvailable:true,data:{attachments:sockets.map(localSocketName=>({localSocketName,targetEntityId:'neighbor',targetSocketName:'BackSocket'}))}}]});
test('every foundation trim shape binds all authored borders and keeps its floor surface',()=>{
 for(const id of ['foundation01t3','foundation011x2t3','foundation012x2t3','foundation02t3']){
  const asset=assets[id]!;assert.ok(asset.model?.structuralProfile,id);
  assert.deepEqual(Object.keys(asset.model.structuralProfile.layers).sort(),Object.keys(asset.renderLayers).sort());
  bindFoxholeModelLayerNodes(asset,readFileSync(new URL('../../../packages/extensions/foxhole/public/foxhole/assets/models/'+id+'.glb',import.meta.url)));
  assert.ok(Number.isFinite((asset as typeof asset & {foundationSurfaceZ:number}).foundationSurfaceZ));
  const entity=make(id,asset.buildSockets.map(socket=>socket.name));const before=structuredClone(entity);
  const plan=renderFoxholeSceneV2Entity(entity);const names=plan.experimentalSpatial?.hiddenModelNodes??[];
  assert.ok(names.length>0,id);assert.ok(!names.includes('structure-layer-floor'));assert.deepEqual(entity,before);
  assert.equal('structuralProfile' in getFoxholeSceneV2ModelComponentData(asset.model),false);
 }
});
test('bunker and trench layers derive 3D visibility from the authored layer rules',()=>{
 for(const id of ['fortt3','trencht3']){
  const asset=assets[id]!;assert.ok(asset.model?.structuralProfile,id);
  assert.deepEqual(Object.keys(asset.model.structuralProfile.layers).sort(),Object.keys(asset.renderLayers).sort());
  const entity=make(id);const normal=renderFoxholeSceneV2Entity(entity);
  const hidden=renderFoxholeSceneV2Entity(entity,{contractVersion:1,entities:[],settings:{'foxhole.structure.hideWalls':true,'foxhole.structure.hideRoofs':true}});
  assert.ok((hidden.experimentalSpatial?.hiddenModelNodes?.length??0)>(normal.experimentalSpatial?.hiddenModelNodes?.length??0));
  if(id==='trencht3') assert.ok(normal.experimentalSpatial?.hiddenModelNodes?.includes('structure-layer-openwallleft'));
 }
});
