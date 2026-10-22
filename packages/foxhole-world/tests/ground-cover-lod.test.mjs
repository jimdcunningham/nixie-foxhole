import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseLod,createDistanceLod} from '../authoring/distance-lod.mjs';
const cover={distance:100,radius:.5,height:800,fov:45,category:'vegetation',cover:true};
test('nearby ground cover uses its pixel footprint rather than forcing full geometry',()=>{
 assert.equal(chooseLod(cover),2);
 assert.equal(chooseLod({...cover,radius:5}),0,'large close plants retain full geometry');
 assert.equal(chooseLod({...cover,radius:1}),1);
 assert.equal(chooseLod({...cover,cover:false}),0,'tree proximity policy stays unchanged');
});
test('cover selection respects orthographic scale and subpixel hysteresis',()=>{
 assert.equal(chooseLod({...cover,distance:10,orthographicHeight:100}),2);
 assert.equal(chooseLod({...cover,distance:10,orthographicHeight:10000}),-1);
 assert.equal(chooseLod({...cover,distance:10,orthographicHeight:10000,tinyCover:false}),2);
 const atPixels=pixels=>({...cover,radius:pixels*100/(2*(800/(2*Math.tan(Math.PI/8))))});
 assert.equal(chooseLod({...atPixels(.8),previous:2}),2);
 assert.equal(chooseLod({...atPixels(.8),previous:-1}),-1);
 assert.equal(chooseLod({...atPixels(42),previous:0}),0);
 assert.equal(chooseLod({...atPixels(42),previous:1}),1);
});

test('cells without native LOD candidates do not evaluate camera selection',()=>{
 const lod=createDistanceLod([],12345);let reads=0;
 const camera={get position(){reads++;return[100,100,100];},height:800,fov:45};
 for(let i=0;i<1000;i++)assert.equal(lod.update(camera),false);
 assert.equal(reads,0,'empty building/catalog controllers must not allocate or scan on every camera frame');
 assert.equal(lod.snapshot().selectedTriangles,12345);
 assert.equal(lod.snapshot().eligiblePlacements,0);
 lod.update({full:true});assert.equal(lod.snapshot().mode,'full');
});

test('resident LOD camera checks reuse scalar state on unchanged and moving frames',()=>{
 const record={center:[0,0,0],radius:1,category:'vegetation',cover:false,levels:[[],[],[]]};
 const lod=createDistanceLod([record],0),position=[0,0,200];let maps=0,copies=0;
 position.map=function(fn){maps++;return Array.prototype.map.call(this,fn);};
 position[Symbol.iterator]=function*(){copies++;yield this[0];yield this[1];yield this[2];};
 const camera={position,height:800,fov:45,now:0};
 for(let i=0;i<1000;i++){camera.now=i*6;position[0]=i*.3;lod.update(camera);}
 assert.equal(maps,0,'per-cell camera checks must not allocate mapped coordinate arrays');
 assert.equal(copies,0,'selection scans must not allocate saved camera arrays');
 assert.equal(lod.snapshot().eligiblePlacements,1);
});


function batchFixture(size=1,lodOnly=false){
 const store={stride:24,u32Data:new Uint32Array((size+1)*24),markDirtyRange(){}};
 return{size,lodOnly,visible:true,items:Array.from({length:size},(_,i)=>({_worldVisible:1,_storeIndex:i+1})),batch:{storeBuffer:store,_visibilityDirtyId:0}};
}
function nativeRecord(base,medium,distant){return{center:[0,0,0],radius:1,category:'vegetation',cover:false,levels:[base,medium,distant].map(batch=>[{batch,index:0,triangles:batch===base?100:10}])};}
test('fully hidden source LOD batches skip submission and return when the camera approaches',()=>{
 const base=batchFixture(),medium=batchFixture(1,true),distant=batchFixture(1,true),record=nativeRecord(base,medium,distant);
 const lod=createDistanceLod([record],100);
 lod.update({position:[0,0,2000],height:800,fov:45,now:0});
 assert.equal(record.level,2);assert.equal(base.visible,false,'zero-visible source batches must not keep dispatching cull/draw commands');
 assert.equal(medium.visible,false);assert.equal(distant.visible,true);
 lod.update({position:[0,0,10],height:800,fov:45,now:200});
 assert.equal(base.visible,true);assert.equal(distant.visible,false);
});
test('a source batch containing fixed non-LOD slots remains visible',()=>{
 const base=batchFixture(2),medium=batchFixture(1,true),distant=batchFixture(1,true);
 const lod=createDistanceLod([nativeRecord(base,medium,distant)],200);
 lod.update({position:[0,0,2000],height:800,fov:45,now:0});
 assert.equal(base.visible,true,'fixed source geometry must survive even when every LOD candidate switches away');
});
