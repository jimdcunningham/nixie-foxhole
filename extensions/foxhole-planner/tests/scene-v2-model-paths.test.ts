import assert from 'node:assert/strict';
import test from 'node:test';
import {isFoxholeGeneratedModelPath,getFoxholeSceneV2PackagedModelPath} from '../src/scene-v2-models.ts';
test('legacy and co-located generated models share the same packaged asset path',()=>{
 for(const path of ['models/truck.upgrade.crane.glb','types/vehicles/truck/truck.upgrade.crane.glb']){
  const model={id:'truck.upgrade.crane',assetId:'truck',path};
  assert.equal(isFoxholeGeneratedModelPath(model),true);
  assert.equal(getFoxholeSceneV2PackagedModelPath(model),'assets/truck/truck.upgrade.crane.glb');
 }
 for(const path of ['types/vehicles/other/truck.glb','../truck.glb','types/vehicles/truck/../truck.glb'])
  assert.equal(isFoxholeGeneratedModelPath({id:'truck',assetId:'truck',path}),false);
});
