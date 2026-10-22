import test from 'node:test';
import assert from 'node:assert/strict';
import {worldModelLayer,normalizeWorldModelLayers} from '../authoring/world-model-layers.mjs';
import {modelCells} from '../runtime/model-cells.mjs';
import {effectOwnerLayer} from '../authoring/world-effect-policy.mjs';
import {chooseLod} from '../authoring/distance-lod.mjs';
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,10,0,10,1];
const proto=(name,category,path)=>({name,category,path,kind:'environment',placements:[{actor:name,matrix}]});
test('native rock and foliage meshes override coarse blueprint prop categories',()=>{
 for(const name of ['RockShorlineCliff','RockWestgateLayer3','ShorelineRocks_03','Boulder01'])assert.equal(worldModelLayer(proto('RockCluster_C/StaticMesh','structures','War/Content/Meshes/Environment/Props/'+name+'.uasset')),'rocks');
 assert.equal(worldModelLayer(proto('BPUnderwaterMountain02_C/StaticMesh','structures','War/Content/Meshes/Environment/Props/RockShorlineMountain02.uasset')),'rocks');
 assert.equal(worldModelLayer(proto('Wall_C/Ivy','structures','War/Content/Meshes/Environment/Foliage/Ivy12.uasset')),'vegetation');
 for(const name of ['BirchSilver_1','Fir02','FirSnow01','Pine01Ruined','DeadTree03','TreeTrunk02','SilverBirchBare','PoplarTreeBush02'])assert.equal(worldModelLayer(proto(name,'vegetation')),'trees');
 for(const name of ['BeechShrub02_2','GrassPlantFernA_01','Ivy11','Mushroom_02'])assert.equal(worldModelLayer(proto(name,'vegetation')),'vegetation');
 for(const name of ['CoverStreetlamp1d','RocketBattery','StoneBridge'])assert.equal(worldModelLayer(proto(name,'structures')),'structures');
 assert.equal(worldModelLayer({...proto('RockFactory','structures'),kind:'building'}),'building');
});
test('classification is immutable and streaming partitions match effect ownership',()=>{
 const rock=proto('RockCluster_C/StaticMesh','structures','War/Content/Meshes/Environment/Props/RockShorlineCliff.uasset'),tree=proto('BirchSilver_1','vegetation'),bush=proto('BeechShrub02_2','vegetation'),prop=proto('Crate','structures'),data={prototypes:[rock,tree,bush,prop]},normalized=normalizeWorldModelLayers(data);
 assert.notEqual(normalized,data);assert.equal(rock.category,'structures');assert.equal(tree.category,'vegetation');assert.equal(normalized.prototypes[2],bush);assert.equal(normalizeWorldModelLayers(data),normalized);assert.equal(normalizeWorldModelLayers(normalized),normalized);
 for(const [category,p]of [['rocks',rock],['trees',tree],['vegetation',bush],['structures',prop]]){
  assert.deepEqual(modelCells(data,category).flatMap(c=>c.data.prototypes.map(p=>p.name)),[p.name]);
  assert.equal(effectOwnerLayer({actor:p.name,system:'fixture'},{worldData:data}),category);
 }
});
test('the independent tree layer retains the vegetation LOD proximity policy',()=>{
 const camera={distance:150,radius:1,height:800,fov:45};
 assert.equal(chooseLod({...camera,category:'trees'}),chooseLod({...camera,category:'vegetation'}));
 assert.notEqual(chooseLod({...camera,category:'trees'}),chooseLod({...camera,category:'structures'}));
});
