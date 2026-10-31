import assert from 'node:assert/strict';
import test from 'node:test';
import {FoxholeRegionSceneController} from '../app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('a mod change swaps only the resident terrain image and releases the previous lease after applying',async()=>{
 const controller=new FoxholeRegionSceneController({baseUrl:'https://assets.test/',loadRegion:()=>assert.fail('image changes must not reload a region')});let released=0,resolve;
 const first={key:'first',load:async()=> 'first',release:async()=>{released++;}},second={key:'second',load:async()=> 'second'};
 const scene={setTerrainMapImage:load=>{assert.equal(load,second.load);return new Promise(r=>resolve=r);}};
 const record={scene,terrainMapImage:first};controller.updateMapImage(record,second);assert.equal(released,0);assert.equal(record.scene,scene);resolve(true);await drain();assert.equal(released,1);assert.equal(controller.mapImageRetirements.size,0);controller.destroy();await controller.whenDisposed();
});
test('a superseded swap does not release the image still being displayed',async()=>{
 const controller=new FoxholeRegionSceneController({baseUrl:'https://assets.test/',loadRegion:()=>assert.fail()});let released=0;
 const first={key:'first',release:async()=>{released++;}},second={key:'second',load:async()=> 'second'};
 const record={terrainMapImage:first,scene:{setTerrainMapImage:async()=>false}};controller.updateMapImage(record,second);await drain();assert.equal(released,0);controller.releaseMapImages(record);await drain();assert.equal(released,1);controller.destroy();await controller.whenDisposed();
});
test('unchanged mod keys do not reload or discard the active lease',()=>{
 const controller=new FoxholeRegionSceneController({baseUrl:'https://assets.test/',loadRegion:()=>assert.fail()});const first={key:'same',load:async()=> 'first'};const record={terrainMapImage:first,scene:{setTerrainMapImage:()=>assert.fail()}};controller.updateMapImage(record,{key:'same',load:async()=> 'new closure'});assert.equal(record.terrainMapImage,first);controller.destroy();
});
