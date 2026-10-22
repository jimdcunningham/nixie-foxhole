import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {waterSurfaceSampler} from '../runtime/water-surface.mjs';

test('water follows its rendered triangle heights without spanning dry gaps',()=>{
 const p=new Float32Array([0,10,0, 10,20,0, 0,30,10, 20,8,0, 30,8,0, 20,8,10]);
 const sample=waterSurfaceSampler(p,new Uint32Array([0,1,2,3,4,5]));
 assert.equal(sample(2,3),18);assert.equal(sample(22,2),8);
 for(const point of [[8,8],[15,0],[-1,0],[NaN,0]])assert.equal(sample(...point),null);
});
test('overlapping water selects the upper surface, including reversed winding and negative levels',()=>{
 const p=new Float32Array([-70,-10,-70, -60,-10,-70, -70,-10,-60, -70,-5,-70, -60,-5,-70, -70,-5,-60]);
 for(const indices of [[0,1,2,5,4,3],[5,4,3,0,1,2]])assert.equal(waterSurfaceSampler(p,new Uint32Array(indices))(-68,-68),-5);
});


test('regional water samples follow the board frame, layer visibility and disposal',()=>{
 const source=readFileSync(new URL('../runtime/load-compact-region.mjs',import.meta.url),'utf8');
 const method=source.match(/  sampleWater\(x,y\)\{[^\n]+\},/)[0].trim().slice(0,-1);
 const calls=[],state={disposed:false,frame:{x:1000,y:-500,scale:32},layerFlags:{},sampleWater:(x,z)=>{calls.push([x,z]);return 5;}};
 const query=runInNewContext('({'+method+'}).sampleWater',state);
 assert.equal(query(1064,-596),160);assert.deepEqual(calls,[[2,3]]);
 state.layerFlags.water=false;assert.equal(query(1064,-596),null);
 state.layerFlags.water=true;state.disposed=true;assert.equal(query(1064,-596),null);
 state.disposed=false;assert.equal(query(1e9,1e9),null);
 state.sampleWater=null;assert.equal(query(1064,-596),null);
});
