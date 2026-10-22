import {nativeEmissionLifetime} from '../authoring/native-particle-emission.mjs';
import {nativeParticleOrbit} from '../authoring/native-particle-orbit.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Texture} from 'pixi.js';
import {buildNativeParticleEmitter} from '../authoring/native-particle-runtime.mjs';
import {lanternFlameColor,lanternFlameBit} from '../authoring/lantern-flame.mjs';

test('lantern exposure retains HDR colour ratios instead of clipping both red and green',()=>{
 const source=[8*.815,5.465105*.2226248,0],mapped=lanternFlameColor(source);
 assert.ok(source[0]>1&&source[1]>1,'the native lantern emitter exceeds display range in both channels');
 assert.ok(mapped.every(v=>v>=0&&v<1));assert.ok(mapped[0]>mapped[1]*4);assert.equal(mapped[2],0);
 assert.ok(Math.abs(mapped[1]/mapped[0]-source[1]/source[0])<1e-12);
 assert.deepEqual(lanternFlameColor([0,0,0]),[0,0,0]);
});

test('only lantern fire uses bounded translucent shading and retains native particle timing',()=>{
 const emitter={name:'test',count:4,rate:[2,2],lifetime:[2,2],size:[[20,20,20],[20,20,20]],location:[[0,0,0],[0,0,0]],origin:[0,0,20],velocity:[[0,0,0],[0,0,0]],acceleration:[[0,0,0],[0,0,0]],color:[[8,5.465105,1.75],[8,5.465105,1.75]],alpha:[1,1],nativeModules:{enabled:true,loops:0,rotation:[0,0],rotationRate:[0,0]}},material={fire:true,color:[.815,.2226248,0],opacity:1},placement={system:'War/Content/FX/LanternFire.LanternFire',actor:'lantern',name:'fire',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,5,2,3,1]},particleHex={name:'testBoundary',gpu:{fragment:{material:''}},gl:{fragment:{material:''}}};
 const before=JSON.stringify({emitter,material,placement});
 for(const [system,fire,expected]of [[placement.system,true,'normal'],['War/Content/FX/BarrelFire01.BarrelFire01',true,'add'],[placement.system,false,'normal']]){
  const p=buildNativeParticleEmitter({placement:{...placement,system},emitter,material:{...material,fire},texture:Texture.WHITE,particleHex,frame:{x:1000,y:0,scale:32},region:'test'});
  try{assert.equal(p.material.state.blendMode,expected);assert.equal(p.space,'local');assert.equal(p.capacity,4);assert.equal(p.nativeSchedule.rate,2);assert.equal(p.material.state.depthTest,true);assert.equal(p.material.state.depthMask,false);const descriptor=p.material.getPrimaryDescriptor({});assert.equal(descriptor.bitsGpu.includes(lanternFlameBit),system===placement.system&&fire);assert.equal(descriptor.bitsGl.includes(lanternFlameBit),system===placement.system&&fire);}finally{p.destroy();}
 }
 assert.equal(JSON.stringify({emitter,material,placement}),before,'source recipes remain unchanged');
});

test('WebGL particle snippets read custom uniforms from the instanced material struct',()=>{
 assert.ok(nativeEmissionLifetime.bindings.material.uEmissionPeriod);
 assert.ok(nativeParticleOrbit.bindings.material.uNativeOrbitX);
 for(const code of [nativeEmissionLifetime.gl.vertex.beforeTransform,nativeParticleOrbit.gl.vertex.beforeTransform,lanternFlameBit.gl.fragment.material]){
  assert.doesNotMatch(code,/(?<![.\w])u(?:ParticleTime|EmissionPeriod|NativeOrbit[XYZ])\b/,'bare material fields fail in the WebGL instanced shader');
 }
});
