import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCells,createModelCellStream} from '../runtime/model-cells.mjs';
const matrix=(x,z=0)=>[1,0,0,0,0,1,0,0,0,0,1,0,x,0,z,1];
const flush=()=>new Promise(r=>setTimeout(r,0));
test('cell assignment keeps actor attachments together and category data bounded without mutating metadata',()=>{
 const data={prototypes:[{name:'House',kind:'building',category:'structures',placements:[{actor:'house',matrix:matrix(0)},{actor:'far-house',matrix:matrix(1800)}]},{name:'Vines',category:'structures',placements:[{actor:'house',matrix:matrix(500)}]}]};
 const buildings=modelCells(data,'building'),props=modelCells(data,'structures');assert.equal(buildings.length,2);assert.equal(buildings[0].data.prototypes[0].placements.length,1);assert.equal(props[0].id,buildings[0].id,'attachment follows its owning blueprint rather than its component offset');assert.equal(data.prototypes[0].placements.length,2);
});
test('only nearby cells load, a short pan retains them, and a long move retires and reloads safely',async()=>{
 const calls=[],disposed=[],data={prototypes:[{name:'House',kind:'building',placements:[{actor:'a',matrix:matrix(0)},{actor:'b',matrix:matrix(1800)}]}]},stream=createModelCellStream({cells:modelCells(data,'building'),radius:200,retainRadius:300,load:async cell=>{calls.push(cell.id);return{dispose:()=>disposed.push(cell.id)};}});
 const near={position:[0,0,0]},far={position:[1800,0,0]};await stream.initialize(near);assert.equal(calls.length,1);stream.update(far,0);await flush();assert.equal(disposed.length,0);stream.update(far,20000);await stream.initialize(far);assert.equal(stream.resident,1);assert.equal(calls.length,2);assert.equal(disposed.length,1);await stream.dispose();assert.equal(disposed.length,2);
});
test('cell retirement waits for late resource ownership to settle before freeing it',async()=>{
 let resolve,disposed=0;const stream=createModelCellStream({cells:modelCells({prototypes:[{name:'House',kind:'building',placements:[{actor:'a',matrix:matrix(0)}]}]},'building'),load:()=>new Promise(done=>resolve=done)});
 const initial=stream.initialize({position:[0,0,0]});const rejected=assert.rejects(initial,{name:'AbortError'});await flush();let done=false;const closing=stream.dispose().then(()=>done=true);await flush();assert.equal(done,false);resolve({dispose(){disposed++;}});await closing;await rejected;assert.equal(disposed,1);
});

test('unnamed placements remain independent and orthographic demand ignores camera altitude',async()=>{
 const cells=modelCells({prototypes:[{kind:'building',placements:[{matrix:matrix(0)},{matrix:matrix(1800)}]}]},'building');assert.equal(cells.length,2);
 let loaded=0;const stream=createModelCellStream({cells,load:async()=>{loaded++;return{dispose(){}};}});await stream.initialize({position:[0,100000,0],orthographicHeight:500});assert.equal(loaded,1);await stream.dispose();
});

test('immutable placement metadata reuses the cell index across layer toggles',()=>{
 const data={prototypes:[{kind:'building',placements:[{actor:'a',matrix:matrix(0)}]}]};
 assert.equal(modelCells(data,'building'),modelCells(data,'building'));
 assert.notEqual(modelCells(data,'building',{size:128}),modelCells(data,'building'));
});
test('stationary cell selection is bounded but teleports and expiry are immediate',async()=>{
 const cells=modelCells({prototypes:[{kind:'building',placements:[{actor:'a',matrix:matrix(0)},{actor:'b',matrix:matrix(1800)}]}]},'building');
 const stream=createModelCellStream({cells,radius:200,retainRadius:300,load:async()=>({dispose(){}})});
 await stream.initialize({position:[0,0,0]});
 const base=performance.now();for(let i=0;i<60;i++)stream.update({position:[0,0,0]},base+i);
 assert.ok(stream.stats.selections<=2);
 stream.update({position:[1800,0,0]},base+61);await flush();assert.equal(stream.resident,2);
 stream.update({position:[1800,0,0]},base+9000);await flush();assert.equal(stream.resident,1);
 await stream.dispose();
});


test('shared foliage actors partition instances by position while blueprint attachments stay together',async()=>{
 const data={prototypes:[
  {name:'Foliage',category:'vegetation',placements:[{actor:'InstancedFoliageActor_0',name:'Leaves',instanced:true,matrix:matrix(-600)},{actor:'InstancedFoliageActor_0',name:'Leaves',instanced:true,matrix:matrix(900)}]},
  {name:'House',kind:'building',placements:[{actor:'house',matrix:matrix(0)}]},
  {name:'Attached plants',category:'vegetation',placements:[{actor:'house',instanced:true,matrix:matrix(500)}]}
 ]};
 const cells=modelCells(data,'vegetation');assert.equal(cells.length,3);
 const calls=[],stream=createModelCellStream({cells,radius:200,retainRadius:300,load:async cell=>{calls.push(cell);return{dispose(){}};}});
 await stream.initialize({position:[900,50,0]});
 assert.ok(calls.some(c=>c.data.prototypes.some(p=>p.name==='Foliage'&&p.placements.some(r=>r.matrix[12]===900))),'foliage beside the camera must load even when its shared actor starts far away');
 assert.equal(cells.find(c=>c.prototypes.some(p=>p.name==='Attached plants')).id,modelCells(data,'building')[0].id);
 await stream.dispose();
});
