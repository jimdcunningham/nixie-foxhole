import assert from 'node:assert/strict';
import test from 'node:test';
import {spatialModelPath} from './spatial-model-paths.mjs';
test('base models and upgrade parts stay in the owning asset directory',()=>{
 assert.equal(spatialModelPath({id:'factory'}),'types/structures/factory/factory.glb');
 assert.equal(spatialModelPath({id:'truck',isVehicle:true},'truck.upgrade.turret'),'types/vehicles/truck/truck.upgrade.turret.glb');
 assert.equal(spatialModelPath({id:'hammer',isItem:true}),'types/items/hammer/hammer.glb');
 for(const id of ['other.upgrade','factory/escape','factory..part'])assert.throws(()=>spatialModelPath({id:'factory'},id));
});
