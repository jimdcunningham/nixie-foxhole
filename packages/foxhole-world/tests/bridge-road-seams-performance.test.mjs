import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgeRoadSeams} from '../authoring/bridge-road-seams.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

test('bridge collection reuses vertex normal work and avoids triangle index copies',()=>{
 const vertices=[],indices=[];let normalReads=0,copies=0;
 for(let z=0;z<=12;z++)for(let x=0;x<=12;x++){
  const v=[x,1+x*.1,z,0,1,0];
  for(let k=3;k<6;k++){const value=v[k];Object.defineProperty(v,k,{get(){normalReads++;return value;}});}
  vertices.push(v);
 }
 for(let z=0;z<12;z++)for(let x=0;x<12;x++){const a=z*13+x,b=a+13;indices.push(a,b,a+1,a+1,b,b+1);}
 const typed=new Uint32Array(indices),slice=typed.slice;
 typed.slice=function(...args){copies++;return slice.apply(this,args);};
 const seams=new BridgeRoadSeams();
 seams.collect([{vertices,indices:typed}],[{matrix:identity},{matrix:[...identity.slice(0,12),24,3,-16,1]}],'StoneBridge');
 assert.equal(seams.summary.surfaceTriangles,576);
 assert.equal(copies,0,'triangle scanning must not allocate an index copy per triangle');
 assert.equal(normalReads,vertices.length*3*2,'each placement transforms a shared vertex normal once');
});

test('bridge collection preserves upward thresholds, degenerate rejection and shared spatial surfaces',()=>{
 const points=ny=>[[0,1,0,0,ny,0],[0,1,2,0,ny,0],[2,1,0,0,ny,0]];
 const seams=new BridgeRoadSeams();
 seams.collect([
  {vertices:points(.5),indices:new Uint32Array([0,1,2])},
  {vertices:points(.499999),indices:new Uint32Array([0,1,2])},
  {vertices:[[0,0,0,0,1,0],[0,2,0,0,1,0],[0,0,2,0,1,0]],indices:new Uint32Array([0,1,2])},
 ],[{matrix:identity}],'BridgeDeck');
 assert.equal(seams.summary.bridgePlacements,1);
 assert.equal(seams.summary.surfaceTriangles,1);
 const surface=seams.cells.get('0,0')[0];
 assert.deepEqual(surface,{t:[[0,1,0],[0,1,2],[2,1,0]],x:-0,z:-0,d:1,minX:0,maxX:2,minZ:0,maxZ:2});
 const p=new Float32Array([.1,1,.1,.1,1,.5,.5,1,.1]),n=new Float32Array([0,1,0,0,1,0,0,1,0]),uv=new Float32Array(6),indices=new Uint32Array([0,1,2]);
 assert.equal(seams.cut({p,n,uv,indices,offset:0}).indices.length,0);
 const under=p.slice();for(let i=1;i<under.length;i+=3)under[i]=-5;
 assert.deepEqual(seams.cut({p:under,n,uv,indices,offset:0}).indices,indices);
});

test('non-bridge and helper meshes do not read source vertices',()=>{
 const part={get vertices(){throw Error('unnecessary source materialization');}};
 for(const name of ['Factory','BridgeCollision','BridgeProxy','BridgeSwitch']){
  const seams=new BridgeRoadSeams();seams.collect([part],[{matrix:identity}],name);
  assert.equal(seams.summary.bridgePlacements,0);
 }
});
