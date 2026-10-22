import assert from 'node:assert/strict';
import test from 'node:test';
import assets from '../src/scene-v2-assets-node.ts';
import {foxholeAquaticWaterline} from '../src/aquatic-placement.ts';
import {finalizeFoxholeSurfacePlacement} from '../src/surface-placement.ts';
import {createFoxholeSpatialProjection} from '../src/scene-v2-spatial-transforms.ts';
import type {NixieExperimentalComponentEntitySnapshotV1 as Entity} from '@nixie/extension-sdk/experimental/scene-v2';

function entity(assetId:string):Entity{return{entityId:'placed',revision:0,components:[
 {ownerId:'nixie.foxhole-planner',componentId:'asset',version:1,definitionAvailable:true,data:{assetId,catalogId:'foxhole.structures'}},
 {ownerId:'nixie.core',componentId:'transform',version:1,definitionAvailable:true,data:{x:20,y:30,rotation:0,scaleX:1,scaleY:1}},
 {ownerId:'nixie.core',componentId:'spatial-transform',version:1,definitionAvailable:true,data:{elevation:0,rotationX:0,rotationY:0,scaleZ:1}},
]};}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<.002,`${a} != ${b}`);
for(const assetId of ['barge','motorboat','largeshipbattleshipw','largeshipsubmarinew']){
 test(`${assetId} floats at its native waterline and retains land, roof and explicit-height placement`,()=>{
  const subject=entity(assetId),before=structuredClone(subject),asset=assets[assetId]!;
  const offset=asset.model!.blueprintOrigin!.z+(assetId==='barge'?0:70*32/100);
  close(foxholeAquaticWaterline(asset)!,offset);
  const request={contractVersion:1 as const,entityId:'placed',interaction:'placement' as const,groundElevation:100,waterElevation:100,
   transform:{x:20,y:30,rotation:0,scaleX:1,scaleY:1},context:{contractVersion:1 as const,entities:[subject]}};
  close(finalizeFoxholeSurfacePlacement(request).transform.elevation!,100-offset);
  close(finalizeFoxholeSurfacePlacement({...request,interaction:'planar-translation'}).transform.elevation!,100-offset);
  close(finalizeFoxholeSurfacePlacement({...request,groundElevation:150}).transform.elevation!,150);
  const {waterElevation:_,...land}=request;close(finalizeFoxholeSurfacePlacement(land).transform.elevation!,100);
  assert.equal(finalizeFoxholeSurfacePlacement({...request,interaction:'transform'}).transform.elevation,undefined);
  assert.deepEqual(subject,before);
 });
}
test('every Aquatic category model has a floating reference; ordinary buildings remain on the water surface',()=>{
 const aquatic=Object.values(assets).filter(asset=>asset.category==='naval'&&asset.model);
 assert.ok(aquatic.length>=25);for(const asset of aquatic)assert.ok(Number.isFinite(foxholeAquaticWaterline(asset)),asset.codeName);
 const subject=entity('facilitypowerdiesel');
 const result=finalizeFoxholeSurfacePlacement({contractVersion:1,entityId:'placed',interaction:'placement',groundElevation:10,waterElevation:10,
  transform:{x:20,y:30,rotation:0,scaleX:1,scaleY:1},context:{contractVersion:1,entities:[subject]}});
 assert.equal(result.transform.elevation,10);
});
test('a floating waterline stays at the cursor under scaled and tilted parent transforms',()=>{
 const subject=entity('barge'),parent=entity('barge');parent.entityId='parent';
 parent.components[0]!.data.assetId='facilitypowerdiesel';
 Object.assign(parent.components[1]!.data,{x:50,y:10,scaleX:2,scaleY:3,rotation:.4});
 Object.assign(parent.components[2]!.data,{elevation:-20,rotationX:.2,rotationY:-.15,scaleZ:2});
 subject.components.push({ownerId:'nixie.core',componentId:'hierarchy',version:1,definitionAvailable:true,data:{parentId:'parent',order:0}});
 const before=createFoxholeSpatialProjection([parent,subject]).toWorld(subject,[0,0,0]);
 const result=finalizeFoxholeSurfacePlacement({contractVersion:1,entityId:'placed',interaction:'placement',groundElevation:100,waterElevation:100,
  transform:{x:20,y:30,rotation:0,scaleX:1,scaleY:1},context:{contractVersion:1,entities:[parent,subject]}});
 Object.assign(subject.components[1]!.data,{x:result.transform.x,y:result.transform.y});subject.components[2]!.data.elevation=result.transform.elevation!;
 const after=createFoxholeSpatialProjection([parent,subject]).toWorld(subject,[0,0,foxholeAquaticWaterline(assets.barge!)!]);
 close(after[0],before[0]);close(after[1],before[1]);close(after[2],100);
});


test('dragging ships with different drafts keeps one rigid floating pose, regardless of the primary',()=>{
 for(const primary of ['barge','largeshipbattleshipw','facilitypowerdiesel'])for(const water of [100,150]){
  const members=['barge','largeshipbattleshipw','facilitypowerdiesel'].map((id,i)=>{
   const value=entity(id);value.entityId=id;value.components[1]!.data.x=i*100;
   value.components[2]!.data.elevation=100-(foxholeAquaticWaterline(assets[id]!)??0);return value;
  });
  const subject=members.find(member=>member.entityId===primary)!;
  const originZ=Number(subject.components[2]!.data.elevation);
  const groundElevation=originZ+Math.max(...members.map(member=>water-Number(member.components[2]!.data.elevation)));
  const before=structuredClone(members);
  const result=finalizeFoxholeSurfacePlacement({contractVersion:1,entityId:primary,interaction:'planar-translation',
   movingEntityIds:members.map(member=>member.entityId),groundElevation,waterElevation:water,
   transform:{x:Number(subject.components[1]!.data.x),y:30,rotation:0,scaleX:1,scaleY:1},context:{contractVersion:1,entities:members}});
  close(result.transform.elevation!,originZ+water-100);
  assert.deepEqual(members,before,'the finalizer proposes a shared correction without mutating members');
 }
});

test('repeated water drags below a tilted parent preserve proposed XY instead of accumulating waterline offsets',()=>{
 const subject=entity('barge'),parent=entity('barge');parent.entityId='parent';
 parent.components[0]!.data.assetId='facilitypowerdiesel';
 Object.assign(parent.components[1]!.data,{x:50,y:10,scaleX:2,scaleY:3,rotation:.4});
 Object.assign(parent.components[2]!.data,{elevation:-20,rotationX:.2,rotationY:-.15,scaleZ:2});
 subject.components.push({ownerId:'nixie.core',componentId:'hierarchy',version:1,definitionAvailable:true,data:{parentId:'parent',order:0}});
 for(let i=0;i<3;i++){
  const before=createFoxholeSpatialProjection([parent,subject]).toWorld(subject,[0,0,0]);
  const result=finalizeFoxholeSurfacePlacement({contractVersion:1,entityId:'placed',interaction:'planar-translation',groundElevation:100,waterElevation:100,
   transform:{x:Number(subject.components[1]!.data.x),y:Number(subject.components[1]!.data.y),rotation:0,scaleX:1,scaleY:1},context:{contractVersion:1,entities:[parent,subject]}});
  Object.assign(subject.components[1]!.data,{x:result.transform.x,y:result.transform.y});subject.components[2]!.data.elevation=result.transform.elevation!;
  const projection=createFoxholeSpatialProjection([parent,subject]),after=projection.toWorld(subject,[0,0,0]);
  close(after[0],before[0]);close(after[1],before[1]);
  close(projection.toWorld(subject,[0,0,foxholeAquaticWaterline(assets.barge!)!])[2],100);
 }
});
