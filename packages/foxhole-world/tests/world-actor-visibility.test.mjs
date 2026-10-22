import test from 'node:test';import assert from 'node:assert/strict';
import {createWorldActorVisibility} from '../authoring/world-actor-visibility.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const p=(type,actor,x,z)=>({name:type+'/Mesh',placements:[{actor,matrix:[...identity.slice(0,12),x,0,z,1]}]});
const icon=(type,x,z)=>({iconType:type,x:.5+x/2184,y:.5-z/1890});
test('native layout masks remove alternative buildings and their attached props; live rigs select only actual candidates',()=>{
 const prototypes=[p('BPFactory_C','factory',671.90936,135.69344),p('BPFactory_C','alternate',392.57062,-379.51468),p('BPRefinery_C','refinery',379.14874,-371.38095),p('Village_C','house',389,-371),p('Crates_C','crates',379,-371),...Array.from({length:10},(_,i)=>p('BPResourceOilRigProxy_C','rig'+i,i*20,-200))];
 const rules={factory:{include:5},alternate:{exclude:4},refinery:{exclude:4},house:{include:4},crates:{parent:'refinery'}};
 const policy=createWorldActorVisibility({region:'fixture',prototypes,rules});assert.equal(policy.visible('factory'),false);assert.equal(policy.visible('rig0'),false);
 const state={items:[icon(34,671.90936,135.69344),icon(75,0,-200),icon(75,180,-200)]};assert.equal(policy.setWarState(state),true);assert.deepEqual(policy.summary.layerMasks,[4]);
 assert.equal(policy.visible('factory'),true);assert.equal(policy.visible('alternate'),false);assert.equal(policy.visible('refinery'),false);assert.equal(policy.visible('crates'),false);assert.equal(policy.visible('house'),true);assert.equal(policy.summary.visibleOilRigs,2);assert.equal(policy.setWarState(state),false);
 policy.setWarState({items:[icon(34,392.57062,-379.51468),icon(17,379.14874,-371.38095)]});assert.equal(policy.visible('refinery'),true);assert.equal(policy.visible('house'),false);assert.equal(policy.visible('crates'),true);
});
test('ambiguous layouts retain common actors without guessing between different alternatives',()=>{
 const policy=createWorldActorVisibility({region:'fixture',prototypes:[p('BPFactory_C','factory',0,0),p('House_C','left',10,0),p('House_C','right',20,0),p('Scenery_C','plain',30,0)],rules:{factory:{include:5},left:{include:1},right:{include:4}}});
 policy.setWarState({items:[icon(34,0,0)]});assert.deepEqual(policy.summary.layerMasks,[1,4]);assert.equal(policy.visible('factory'),true);assert.equal(policy.visible('left'),false);assert.equal(policy.visible('right'),false);assert.equal(policy.visible('plain'),true);
});
