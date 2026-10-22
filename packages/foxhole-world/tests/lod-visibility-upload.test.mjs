import assert from 'node:assert/strict';
import test from 'node:test';
import {uploadLodVisibility} from '../authoring/lod-visibility-upload.mjs';
function fixture(){
 const data=new Uint32Array(100000*24),gpu=data.slice(),writes=[];
 const store={stride:24,_textureSource:null,_minDirty:Infinity,_maxDirty:-Infinity,markDirtyRange(a,z){this._minDirty=Math.min(this._minDirty,a);this._maxDirty=Math.max(this._maxDirty,z);},update(){if(this._minDirty<=this._maxDirty){this._buffer.update((this._maxDirty-this._minDirty+1)*96,this._minDirty*96);this._minDirty=Infinity;this._maxDirty=-Infinity;}}};
 store._buffer={_gpuData:{1:{gpuBuffer:{}}},_updateID:0,update(bytes,offset){writes.push({bytes,offset});gpu.set(data.subarray(offset/4,(offset+bytes)/4),offset/4);this._updateID=0;}};
 return {store,data,gpu,writes};
}
test('sparse LOD changes retain all CPU/GPU bits without uploading intervening rows',()=>{
 const {store,data,gpu,writes}=fixture();data[19]=1;data[90000*24+19]=1;
 const result=uploadLodVisibility(store,0,90000,[90000,0]);assert.deepEqual(gpu,data);assert.equal(result.bytes,192);assert.equal(writes.length,2);assert.equal(store._minDirty,Infinity);
});
test('pending native transform and material edits are flushed before sparse visibility',()=>{
 const {store,data,gpu,writes}=fixture();data[50*24+12]=0x80000000;data[50*24+18]=15;store.markDirtyRange(50,50);data[90000*24+19]=1;
 uploadLodVisibility(store,90000,90000,[90000]);assert.deepEqual(gpu,data);assert.equal(writes.length,2);assert.equal(writes[0].offset,50*96);
});
test('adjacent and duplicate rows merge, dense changes use one upload',()=>{
 const {store,data,gpu,writes}=fixture();for(const i of [10,11,14,15])data[i*24+19]=1;
 uploadLodVisibility(store,10,15,[15,10,14,11,11]);assert.deepEqual(gpu,data);assert.equal(writes.length,1);assert.equal(writes[0].bytes,6*96);
});
for(const mode of ['webgl','unallocated','deferred','baseline'])test(`${mode} retains native upload fallback`,()=>{
 const {store,data,gpu,writes}=fixture();data[19]=1;data[90000*24+19]=1;
 if(mode==='webgl')store._textureSource={};if(mode==='unallocated')store._buffer._gpuData={};if(mode==='deferred')store._buffer._updateID=1;if(mode==='baseline')store.foxholeSparseLodUploads=false;
 assert.equal(uploadLodVisibility(store,0,90000,[0,90000]).sparse,false);assert.equal(writes.length,0);assert.equal(store._minDirty,0);assert.equal(store._maxDirty,90000);store.update();assert.deepEqual(gpu,data);
});
