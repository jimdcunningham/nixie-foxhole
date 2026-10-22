import test from 'node:test';
import assert from 'node:assert/strict';
import {FoxholeRegionSceneController} from '../app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
test('placement support is visible water above the bed for every product, with independent layer switches',()=>{
 const controller=Object.create(FoxholeRegionSceneController.prototype);
 controller.layers={};controller.records=new Map([['fixture',{scene:{sampleGround:()=>-50,sampleWater:()=>10}}]]);
 assert.equal(controller.sampleGround(0,0),10);assert.equal(controller.sampleWater(0,0),10);
 controller.layers.water=false;assert.equal(controller.sampleGround(0,0),-50);assert.equal(controller.sampleWater(0,0),null);
 controller.layers={terrain:false};assert.equal(controller.sampleGround(0,0),10);
 controller.layers.water=false;assert.equal(controller.sampleGround(0,0),null);
 controller.layers={};controller.records.set('land',{scene:{sampleGround:()=>30,sampleWater:()=>null}});
 assert.equal(controller.sampleGround(0,0),30,'water beneath land must not replace dry terrain');
 controller.records.clear();assert.equal(controller.sampleGround(0,0),null);
});
