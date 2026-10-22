import test from 'node:test';import assert from 'node:assert/strict';import {Texture,TextureSource} from 'pixi.js';
import {nativeSmokeOutlet} from '../authoring/native-smoke-outlet.mjs';import {nativeSmokeCloudTexture} from '../runtime/native-smoke-texture.mjs';import {buildNativeParticleEmitter} from '../authoring/native-particle-runtime.mjs';
const matrix=[0,0,-1,0,0,1,0,0,1,0,0,0,100,3,200,1];
test('industrial smoke uses the measured lip centre under its actor transform',()=>{
 const world={prototypes:[{path:'War/Content/Meshes/Environment/Towns/IndustrialChimneyFurnace01.uasset',placements:[{actor:'chimney',matrix}]}]},p={actor:'chimney',system:'War/Content/FX/smokestack.smokestack'},outlet=nativeSmokeOutlet(p,world);
 assert.ok(Math.abs(outlet.position[0]-100.082952097)<1e-8);assert.ok(Math.abs(outlet.position[1]-17.539495468)<1e-8);assert.ok(Math.abs(outlet.position[2]-200.003427088)<1e-8);assert.deepEqual(outlet.up,[0,1,0]);
 assert.equal(nativeSmokeOutlet({...p,actor:'unknown'},world),null);assert.equal(nativeSmokeOutlet({...p,system:'Smoke'},world),null);assert.equal(nativeSmokeOutlet(p),null);
});
test('native cloud data resolves beside the world directory and remains linear with repeat sampling',async()=>{
 const texture=new Texture({source:new TextureSource({width:1,height:1})}),urls=[];const value=await nativeSmokeCloudTexture('https://assets.test/foxhole/assets/world/',{loadTexture:async url=>{urls.push(url);return texture;},onAsset:url=>urls.push(url)});
 assert.equal(value,texture);assert.equal(urls.length,2);assert.equal(urls[0],urls[1]);assert.match(urls[0],/^https:\/\/assets.test\/foxhole\/assets\/shared\/smoke\/[a-f0-9]{64}\.webp$/);assert.equal(texture.source.alphaMode,'no-premultiply-alpha');assert.equal(texture.source.style.addressMode,'repeat');texture.destroy(true);
});
test('masked smoke retains native motion and shifts its launch to the outlet in native and board frames',()=>{
 const emitter={name:'ParticleSpriteEmitter_3',material:'SmokeStacks',count:2,rate:[1,1],lifetime:[2,2],location:[[0,0,0],[0,0,0]],origin:[0,0,0],velocity:[[0,0,100],[0,0,100]],acceleration:[[0,0,0],[0,0,0]],size:[[100,100,100],[100,100,100]],color:[[.78,.78,.78],[.78,.78,.78]],alpha:[1,1]},outlet={position:[10,15,20],up:[0,1,0]};
 for(const frame of [undefined,{x:10000,y:20000,scale:32}]){const p=buildNativeParticleEmitter({region:'fixture',placement:{actor:'chimney',name:'smoke',system:'War/Content/FX/smokestack.smokestack',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,10,14,20,1]},emitter,material:{color:[1,1,1],opacity:1.5},texture:Texture.WHITE,smokeCloudTexture:Texture.WHITE,particleHex:{name:'fixture',gpu:{},gl:{}},outlet,frame});
 assert.deepEqual([...p.data.f32.slice(0,3)],frame?[0,0,0]:[10,15,20]);assert.deepEqual([...p.uniforms.uSmokeOutlet],[10,15,20,1]);assert.equal(p.uniforms.uSmokeOpacity,1.5);assert.equal(p._attributes.aSmokeOffset.components,4);assert.ok(p.material._extraBits.some(bit=>bit.name==='nativeAtmosphericCoverage_v1'));assert.ok(p.material._extraBits.find(bit=>bit.name.startsWith('nativeParticleCurves')).gl.vertex.beforeTransform.includes('nativeParticleLinear'));assert.deepEqual([...p.uniforms.uGravity],[0,0,0]);const offsets=p.data.offsets,at=offsets.aVel/4;assert.deepEqual([...p.data.f32.slice(at,at+3)],[0,1,0]);p.destroy();}
});
