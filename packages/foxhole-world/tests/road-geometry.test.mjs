import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionRoadChunk} from '../authoring/road-transition-geometry.mjs';
import {BridgeRoadSeams} from '../authoring/bridge-road-seams.mjs';
test('road transitions retain native UVs and interpolate the chosen junction surface',()=>{
 const p=new Float32Array([-1,0,-1,1,0,-1,0,0,1,40,0,0,42,0,0,40,0,2]),n=new Float32Array(p.length).fill(1),uv=new Float32Array([0,0,1,0,.5,1,2,2,3,2,2,3]),indices=new Uint32Array([0,1,2,3,4,5]);
 const join={a:'road',b:'stone',p:[0,0,0],axis:[1,0],bias:0,uvA:{u:[1,0,0],v:[0,1,0]},uvB:{u:[2,0,0],v:[0,2,0]}};
 const {groups,transitionTriangles}=partitionRoadChunk({chunk:{material:'road'},p,n,uv,indices,joins:[join]});
 assert.equal(transitionTriangles,1);assert.deepEqual([...groups.keys()],['road|stone','base']);
 assert.deepEqual(groups.get('road|stone').native,[0,0,0,1,1,0,0,1,.5,1,0,1]);
 assert.deepEqual(groups.get('road|stone').extra,[-2,-2,-1,0,2,-2,1,0,0,2,0,0]);
 assert.deepEqual(groups.get('base').p,[40,0,0,42,0,0,40,0,2]);
});
test('bridge cuts remove coincident road surfaces and preserve roads beneath the bridge',()=>{
 const seam=new BridgeRoadSeams(),matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 seam.collect([{vertices:[[-5,1,-5,0,1,0],[-5,1,5,0,1,0],[5,1,-5,0,1,0],[5,1,5,0,1,0]],indices:new Uint32Array([0,1,2,2,1,3])}],[{matrix}],'BridgeRamp');
 const positions=y=>new Float32Array([-1,y,-1,-1,y,1,1,y,-1]),n=new Float32Array([0,1,0,0,1,0,0,1,0]),uv=new Float32Array(6),indices=new Uint32Array([0,1,2]);
 assert.equal(seam.cut({p:positions(1),n,uv,indices,offset:0}).indices.length,0);
 assert.deepEqual(seam.cut({p:positions(-2),n,uv,indices,offset:0}).indices,indices);
});
