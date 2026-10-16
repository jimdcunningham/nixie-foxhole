import test from 'node:test';
import assert from 'node:assert/strict';
import { readFoxholeGeneratedModel } from './generated-models.ts';
import assets from '../src/scene-v2-assets-node.ts';
import {bindFoxholeModelLayerNodes} from '../src/model-layer-nodes.ts';
import {renderFoxholeSceneV2Entity} from '../src/scene-v2-renderers.ts';
import {getFoxholeSceneV2ModelComponentData,readFoxholeStructuralModelProfile} from '../src/scene-v2-models.ts';
import type {NixieExperimentalComponentEntitySnapshotV1 as Entity} from '@nixie/extension-sdk/experimental/scene-v2';
const make=(id:string,sockets:string[]=[]):Entity=>({entityId:'structure',revision:1,components:[
 {ownerId:'nixie.foxhole-planner',componentId:'asset',version:1,definitionAvailable:true,data:{catalogId:'foxhole.structures',assetId:id}},
 {ownerId:'nixie.foxhole-planner',componentId:'socket-attachments',version:1,definitionAvailable:true,data:{attachments:sockets.map(localSocketName=>({localSocketName,targetEntityId:'neighbor',targetSocketName:'BackSocket'}))}}]});
test('every foundation trim shape binds all authored borders and keeps its floor surface',()=>{
 for(const id of ['foundation01t1','foundation011x2t1','foundation012x2t1','foundation02t1','foundation01t3','foundation011x2t3','foundation012x2t3','foundation02t3']){
  const asset=assets[id]!;assert.ok(asset.model?.structuralProfile,id);
  assert.deepEqual(Object.keys(asset.model.structuralProfile.layers).sort(),Object.keys(asset.renderLayers).sort());
  bindFoxholeModelLayerNodes(asset,readFoxholeGeneratedModel(id));
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

const modified=(id:string,selections:Array<{slotId:string;variantId:string}>,sockets:string[]=[])=>{
 const entity=make(id,sockets);entity.components.push({ownerId:'nixie.foxhole-planner',componentId:'modification',version:1,definitionAvailable:true,data:{selections}});return entity;
};
test('every optional bunker and trench part starts hidden and wall replacements remain independent',()=>{
 for(const id of ['fortt3','trencht3']){
  const asset=assets[id]!,profile=asset.model!.structuralProfile!;
  const expected=Object.values(asset.modifications).reduce((sum,slot)=>sum+Object.values(slot.variants).filter(v=>!v.isUpgrade).length,0);
  assert.equal(profile.modifications!.length,expected,id);
  const defaultNames=renderFoxholeSceneV2Entity(make(id)).experimentalSpatial!.hiddenModelNodes!;
  assert.ok(profile.modifications!.every(part=>part.nodeNames.every(name=>defaultNames.includes(name))));
  const bytes=readFoxholeGeneratedModel(id);
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());const exported=new Set(gltf.nodes.map((n:{name:string})=>n.name));
  for(const name of [...Object.values(profile.layers).flat(),...profile.modifications!.flatMap(p=>p.nodeNames)])assert.ok(exported.has(name),name);
 }
 const profile=assets.fortt3!.model!.structuralProfile!,parts=profile.modifications!;
 const door=parts.find(p=>p.slotId==='FrontModSlot'&&p.variantId==='door')!;
 const stairs=parts.find(p=>p.slotId==='BackFortStairsModSlot'&&p.variantId==='stairs')!;
 const entity=modified('fortt3',[door,stairs].map(({slotId,variantId})=>({slotId,variantId})));const before=structuredClone(entity);
 const plan=renderFoxholeSceneV2Entity(entity),hidden=plan.experimentalSpatial!.hiddenModelNodes!;
 assert.ok(door.nodeNames.every(name=>!hidden.includes(name)));assert.ok(stairs.nodeNames.every(name=>!hidden.includes(name)));
 assert.ok(profile.layers.frontwall!.every(name=>hidden.includes(name)));
 assert.ok(profile.layers.backwall!.every(name=>!hidden.includes(name)));
 assert.deepEqual(entity,before);assert.deepEqual(renderFoxholeSceneV2Entity(JSON.parse(JSON.stringify(entity))),plan);
 const walls=renderFoxholeSceneV2Entity(entity,{contractVersion:1,entities:[],settings:{'foxhole.structure.hideWalls':true}}).experimentalSpatial!.hiddenModelNodes!;
 assert.ok(door.nodeNames.every(name=>walls.includes(name)));assert.equal(new Set(walls).size,walls.length);
});
test('joined trench sides swap solid meshes for authored openings and retain the opposite side',()=>{
 for(const id of ['trencht1','trencht2','trencht3'])for(const sides of [['Left'],['Right'],['Left','Right']]){
  const asset=assets[id]!,profile=asset.model!.structuralProfile!;
  const names=sides.map(side=>asset.buildSockets.find(s=>s.name.split(':').at(-1)===side+'Socket')!.name);
  const entity=make(id,names),neighbor=make(id);neighbor.entityId='neighbor';
  const plan=renderFoxholeSceneV2Entity(entity,{contractVersion:1,entities:[entity,neighbor]}),hidden=plan.experimentalSpatial!.hiddenModelNodes!;
  for(const side of ['Left','Right']){
   const joined=sides.includes(side),key=side.toLowerCase();
   assert.ok(profile.layers[key+'wall']!.every(name=>hidden.includes(name)===joined));
   assert.ok(profile.layers['openwall'+key]!.every(name=>hidden.includes(name)!==joined));
  }
  assert.ok(profile.layers.floor!.every(name=>!hidden.includes(name)));
 }
});
test('roof modifications follow visibility settings and malformed recipes fail at binding',()=>{
 const profile=assets.trencht3!.model!.structuralProfile!,roof=profile.modifications!.find(p=>p.variantId==='trenchroof')!;
 const entity=modified('trencht3',[{slotId:roof.slotId,variantId:roof.variantId}]);
 const normal=renderFoxholeSceneV2Entity(entity).experimentalSpatial!.hiddenModelNodes!;
 const hidden=renderFoxholeSceneV2Entity(entity,{contractVersion:1,entities:[],settings:{'foxhole.structure.hideRoofs':true}}).experimentalSpatial!.hiddenModelNodes!;
 assert.ok(roof.nodeNames.every(name=>!normal.includes(name)&&hidden.includes(name)));
 assert.throws(()=>readFoxholeStructuralModelProfile({version:1,layers:{roof:['roof']},modifications:[{slotId:'Roof',variantId:'roof',nodeNames:['part'],replacesLayers:['missing']}]}));
});
