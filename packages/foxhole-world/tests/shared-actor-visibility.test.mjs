import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D} from '@pixi/3d';
import {createWorldActorVisibility} from '../authoring/world-actor-visibility.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';
test('streamed cells share one regional visibility policy without resetting it and each observe new revisions',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const roots=[new Container3D(),new Container3D()],worlds=[];
 const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],policy=createWorldActorVisibility({region:'fixture',prototypes:[{name:'BPResourceOilRigProxy_C/Mesh',placements:[{actor:'rig',matrix}]}]});
 const state={items:[{iconType:75,x:.5,y:.5}]};
 try{
  const create=root=>loadWorldModels({region:'fixture',root,worldData:{prototypes:[]},actorVisibility:policy,json:async()=>({assets:{}}),status(){},teamAt:()=> 'NONE'});
  const a=await create(roots[0]);worlds.push(a);assert.equal(a.actorVisible,policy.visible);
  assert.equal(a.setWarState(state),true);assert.equal(a.actorVisible('rig'),true);
  const b=await create(roots[1]);worlds.push(b);assert.equal(b.actorVisible('rig'),true,'a new cell must not reset shared state to null');
  assert.equal(b.setWarState(state),true,'each cell must apply an already current shared revision');assert.equal(b.setWarState(state),false);
  const absent={items:[]};assert.equal(a.setWarState(absent),true);assert.equal(b.setWarState(absent),true);assert.equal(b.actorVisible('rig'),false);assert.equal(a.setWarState(absent),false);
 }finally{for(const w of worlds)w.dispose();for(const root of roots)root.destroy({children:true});globalThis.location=saved;}
});
test('repeated actor visibility reads reuse resolved rules until live state changes',()=>{
 let reads=0;const rules={get child(){reads++;return {parent:'parent'};},parent:{hidden:true}};
 const policy=createWorldActorVisibility({region:'fixture',prototypes:[],rules});assert.equal(policy.visible('child'),false);reads=0;
 for(let i=0;i<1000;i++)assert.equal(policy.visible('child'),false);
 assert.equal(reads,0,'resident slots must not reevaluate parent rules on every lookup');
 rules.parent.hidden=false;policy.setWarState({items:[]});assert.equal(policy.visible('child'),true,'a new state invalidates resolved actors');
});
