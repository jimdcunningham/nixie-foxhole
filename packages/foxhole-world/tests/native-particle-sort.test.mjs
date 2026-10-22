import test from 'node:test';import assert from 'node:assert/strict';
import {Texture} from 'pixi.js';
import {buildNativeParticleEmitter} from '../authoring/native-particle-runtime.mjs';
import {prepareNativeParticleSort} from '../authoring/native-particle-sort.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function smoke(){return buildNativeParticleEmitter({region:'fixture',placement:{actor:'chimney',name:'smoke',system:'War/Content/FX/smokestack.smokestack',matrix:identity},emitter:{name:'ParticleSpriteEmitter_3',material:'SmokeStacks',count:2,rate:[.2,.2],lifetime:[10,10],location:[[0,0,0],[0,0,0]],origin:[0,0,0],velocity:[[0,0,0],[0,0,0]],acceleration:[[0,0,0],[0,0,0]],size:[[100,100,100],[100,100,100]],color:[[1,1,1],[1,1,1]],alpha:[.5,.5]},material:{color:[1,1,1],opacity:1},texture:Texture.WHITE,particleHex:{name:'fixture',gpu:{},gl:{}}});}
function set(p,i,z,velocity=0){p.setParticleAt(i,0,0,z,1,0,0xffffff,.5);p.setParticle(i,{aBirth:0,aLife:10,aVel:{x:0,y:0,z:velocity}});}
test('native smoke orders moving centres rather than spawn points and reverses with the camera',()=>{
 const p=smoke();set(p,0,-2,3);set(p,1,1);p.uniforms.uDrag=0;p.uniforms.uParticleTime=0;
 p.nativeDepthSort.update({direction:[0,0,-1]});assert.deepEqual(p.nativeDepthSort.order,[0,1]);
 p.uniforms.uParticleTime=2;p.nativeDepthSort.update({direction:[0,0,-1]});assert.deepEqual(p.nativeDepthSort.order,[1,0]);
 p.nativeDepthSort.update({direction:[0,0,1]});assert.deepEqual(p.nativeDepthSort.order,[0,1]);p.destroy();
});
test('framed near-plane sorting matches native axes and retains drag and wind motion',()=>{
 const p=smoke();set(p,0,-2,3);set(p,1,1);p.uniforms.uDrag=.5;p.uniforms.uParticleTime=2;p.uniforms.uSceneWind=[0,0,6];
 p.nativeDepthSort.update({direction:[0,0,-1]});const native=[...p.nativeDepthSort.order];
 const planes=new Float32Array(24);planes[21]=-1;p.nativeDepthSort.update({planes},{scale:32});assert.deepEqual(p.nativeDepthSort.order,native);assert.deepEqual(native,[1,0]);p.destroy();
});
test('private sorted indices preserve other emitters, attributes, missing-camera draws and disposal',()=>{
 const a=smoke(),b=smoke(),original=b.geometry.indices.slice(),attributes=a.data.f32.slice(),buffer=a.nativeDepthSort.buffer;
 assert.notEqual(a.geometry.indexBuffer,b.geometry.indexBuffer);a.nativeDepthSort.update();assert.deepEqual(a.geometry.indices,b.geometry.indices);
 set(a,0,1);set(a,1,-1);a.nativeDepthSort.update({direction:[0,0,-1]});assert.deepEqual(b.geometry.indices,original);assert.equal(a.geometry.indices[0],4);
 const frozen=a.data.f32.slice();a.nativeDepthSort.update({direction:[0,0,1]});assert.deepEqual(a.data.f32,frozen);assert.notDeepEqual(attributes,frozen);
 a.destroy();assert.equal(buffer.destroyed,true);assert.equal(b.geometry.indexBuffer.destroyed,false);b.destroy();
});

test('wind advection and emission wrap change the order without altering spawn attributes',()=>{
 const p=smoke();set(p,0,-1);set(p,1,1);p.setParticle(0,{aBirth:-2});p.uniforms.uParticleTime=1;p.uniforms.uSceneWind=[0,0,6];
 p.nativeDepthSort.update({direction:[0,0,-1]});assert.deepEqual(p.nativeDepthSort.order,[1,0]);
 p.uniforms.uSceneWind=[0,0,0];p.nativeDepthSort.update({direction:[0,0,-1]});assert.deepEqual(p.nativeDepthSort.order,[0,1]);p.destroy();
});
test('native age and view-distance modes retain their distinct semantics',()=>{
 const p=smoke();set(p,0,-1);set(p,1,1);p.setParticle(1,{aBirth:-2});
 const age=prepareNativeParticleSort(p,'PSORTMODE_Age_OldestFirst');age.update();assert.deepEqual(age.order,[1,0]);
 p.uniforms.uParticleTime=9;age.update();assert.deepEqual(age.order,[0,1],'a reborn slot becomes young again');
 const distance=prepareNativeParticleSort(p,'PSORTMODE_DistanceToView');distance.update({position:[0,0,5]});assert.deepEqual(distance.order,[0,1]);distance.update({position:[0,0,-5]});assert.deepEqual(distance.order,[1,0]);p.destroy();
});
test('board framing retains the live smoke order buffer',async()=>{
 const {Container3D}=await import('@pixi/3d'),{applyRegionFrame}=await import('../runtime/spatial-frame.mjs');const root=new Container3D(),p=smoke();root.addChild(p);const indices=p.geometry.indexBuffer;
 applyRegionFrame({root,materials:[],terrainPass:{}},{x:100000,y:-200000,scale:32});assert.equal(p.geometry.indexBuffer,indices);root.destroy({children:true});
});
