import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegionLayerVisibility} from '../runtime/region-layer-visibility.mjs';

test('layer preferences hide category parents without changing native LOD rows',()=>{
 const lod={visible:true},rocks={visible:true,children:[lod]},water={visible:true},terrain={},shoulders={},calls=[];
 const setLayers=createRegionLayerVisibility({targets:{rocks:[rocks],water:[water]},terrain,shoulders,details:{syncLayers:flags=>calls.push(flags)}});
 setLayers({rocks:false,roads:false});
 assert.equal(rocks.visible,false);assert.equal(lod.visible,true);assert.equal(water.visible,true);
 assert.equal(shoulders.visible,false);assert.equal(terrain.visible,true);
 lod.visible=false;setLayers({rocks:false,roads:false});assert.equal(calls.length,1);
 setLayers({terrain:false});assert.equal(rocks.visible,true);assert.equal(lod.visible,false);assert.equal(shoulders.visible,false);
 setLayers();assert.equal(terrain.visible,true);assert.equal(shoulders.visible,true);
 assert.ok(Object.values(calls.at(-1)).every(Boolean));
});
