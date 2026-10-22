import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,ParticleContainer3D} from '@pixi/3d';
import {Texture} from 'pixi.js';
import {nativeParticleSeed,sampleNativeParticleShape,nativeEmissionSchedule,nativeEmissionLifetime} from '../authoring/native-particle-emission.mjs';
import {effectOwnerLayer,isPersistentParticleEmitter} from '../authoring/world-effect-policy.mjs';
import {loadWorldDetails} from '../authoring/world-details.mjs';
import {compileNativeParticleModules} from '../tools/prepare-native-particles.mjs';

test('native extraction follows the highest-detail emitter references, shapes, drag and finite loops',()=>{
 const ref=name=>({ObjectName:`Object'System:outer.${name}'`});
 const native=[{Type:'ParticleSystem',Properties:{Emitters:[ref('emitter')]}},{Name:'emitter',Properties:{LODLevels:[ref('lod')]}},
  {Name:'lod',Properties:{RequiredModule:ref('required'),SpawnModule:ref('spawn'),Modules:[ref('sphere'),ref('drag'),ref('rotation')]}},
  {Name:'required',Properties:{EmitterLoops:1,EmitterDuration:2}},
  {Name:'spawn',Properties:{BurstList:[{Count:20,CountLow:10,Time:.25}]}},
  {Name:'sphere',Type:'ParticleModuleLocationPrimitiveSphere',Properties:{StartRadius:{MinValue:600,MaxValue:600},Negative_Z:false,Velocity:true,VelocityScale:{MinValue:-.1,MaxValue:.1}}},
  {Name:'drag',Type:'ParticleModuleAccelerationDrag',Properties:{DragCoefficientRaw:{MinValue:.5,MaxValue:.5}}},
  {Name:'rotation',Type:'ParticleModuleRotationRate',Properties:{StartRotationRate:{MinValue:-.1,MaxValue:.1}}}];
 const e=compileNativeParticleModules(native).emitter;
 assert.equal(e.loops,1);assert.equal(e.duration,2);assert.deepEqual(e.drag,[.5,.5]);assert.deepEqual(e.rotationRate,[-.1,.1]);
 assert.equal(e.volumes[0].negative[2],false);assert.deepEqual(e.volumes[0].radius,[600,600]);assert.equal(isPersistentParticleEmitter(e),false);assert.deepEqual(e.bursts,[{count:20,countLow:10,time:.25}]);
});

const shape={shape:'sphere',radius:[600,600],height:[1000,1000],location:[[10,20,30],[10,20,30]],axis:2,positive:[true,true,true],negative:[true,true,false],surface:false,velocity:true,velocityScale:[.1,.1],radialVelocity:true};
test('duplicate native LOD object names resolve by export identity rather than selecting another emitter',()=>{
 const ref=(name,index)=>({ObjectName:`Object'System:${name}'`,ObjectPath:'System.'+index});
 const native=[{Type:'ParticleSystem',Properties:{Emitters:[ref('first',1),ref('second',2)]}},
  {Name:'first',Properties:{LODLevels:[ref('ParticleLODLevel_0',3)]}},{Name:'second',Properties:{LODLevels:[ref('ParticleLODLevel_0',4)]}},
  {Name:'ParticleLODLevel_0',Properties:{RequiredModule:ref('requiredA',5)}},{Name:'ParticleLODLevel_0',Properties:{RequiredModule:ref('requiredB',6)}},
  {Name:'requiredA',Properties:{EmitterLoops:0}},{Name:'requiredB',Properties:{EmitterLoops:1}}];
 const result=compileNativeParticleModules(native);assert.equal(result.first.loops,0);assert.equal(result.second.loops,1);
});
test('sphere spawning fills its volume and preserves axes, center and location-generated velocity',()=>{
 const random=nativeParticleSeed('sphere'),radii=[],points=[];
 for(let i=0;i<1500;i++){const p=sampleNativeParticleShape(shape,random),v=p.position.map((v,k)=>v-[10,20,30][k]);radii.push(Math.hypot(...v));points.push(v);assert.ok(v[2]>=0);assert.ok(Math.hypot(...v)<=600.001);p.velocity.forEach((x,k)=>assert.ok(Math.abs(x-v[k]*.1)<1e-8));}
 assert.ok(radii.reduce((a,b)=>a+b,0)/radii.length>430);assert.ok(points.some(p=>p[0]<-300)&&points.some(p=>p[0]>300));
 const surface=sampleNativeParticleShape({...shape,surface:true},random);assert.ok(Math.abs(Math.hypot(...surface.position.map((v,k)=>v-[10,20,30][k]))-600)<1e-6);
});
test('cylinder spawning supports alternate height axes and radial-only velocity',()=>{
 const random=nativeParticleSeed('cylinder');let low=0,high=0;
 for(let i=0;i<1000;i++){const p=sampleNativeParticleShape({...shape,shape:'cylinder',axis:0,negative:[true,true,true],radius:[5000,5000],location:[[0,0,0],[0,0,0]]},random);assert.ok(Math.abs(p.position[0])<=500);assert.ok(Math.hypot(p.position[1],p.position[2])<=5000.001);assert.equal(p.velocity[0],0);low=Math.min(low,p.position[0]);high=Math.max(high,p.position[0]);}
 assert.ok(low< -450&&high>450);
});
test('emission keeps capacity separate from rate and retains dead-slot clipping',()=>{
 assert.deepEqual(nativeEmissionSchedule({count:100,rate:[5,5],lifetime:[20,10]}),{count:100,period:20,rate:5});
 assert.equal(nativeEmissionSchedule({count:10,rate:[0,0],lifetime:[1,2]}).count,0);
 assert.match(nativeEmissionLifetime.gpu.vertex.afterTransform,/particleAge > input.aLife/);
 assert.match(nativeEmissionLifetime.gl.vertex.afterTransform,/particleAge > aLife/);
 assert.match(nativeEmissionLifetime.gpu.vertex.beforeTransform,/uEmissionPeriod/);
});

const system='War/Content/FX/Dustmotes.Dustmotes',identity=[1,0,0,0,0,1,0,0,0,0,1,0,10,2,20,1];
function recipe(name=system){return {materials:{dust:{file:'dust.webp',color:[1,1,1],opacity:1}},placements:[{actor:'hospital',name:'Dust',system:name,visible:true,autoActivate:true,matrix:identity}],emitters:{[name]:[{name:'ParticleSpriteEmitter_0',material:'dust',count:100,rate:[5,5],lifetime:[20,10],location:[[0,0,0],[0,0,0]],origin:[0,0,0],velocity:[[0,0,0],[0,0,0]],acceleration:[[0,0,0],[0,0,0]],size:[[15,15,15],[10,10,10]],color:[[1,1,1],[1,1,1]],alpha:[.5,.5]}]}};}
async function load(effects,options={}){
 const root=new Container3D(),reads=[];const detail=await loadWorldDetails({region:'deadlands',root,layers:{decals:false,puddles:false,effects:true},json:async p=>{reads.push(p);if(p.endsWith('effects/render.json'))return effects;throw Error('Unexpected read '+p);},texture:async p=>{reads.push(p);return Texture.WHITE;},zipped:async()=>{throw Error('Unexpected geometry read');},hexBit:{name:'test',gpu:{fragment:{material:''}},gl:{fragment:{material:''}}},...options});
 return {root,detail,reads,particles:root.children.filter(c=>c instanceof ParticleContainer3D)};
}
test('native dust motion fixture retains volume, drag and rate independently of material eligibility',async()=>{
 const {root,particles:[p]}=await load(recipe());
 assert.ok(p);assert.equal(p.uniforms.uDrag,.5);
 const stride=p.data.f32.length/p.capacity/4,points=[],life=p._attributes.aLife.offset,birth=p._attributes.aBirth.offset;
 // Attribute descriptors use byte offsets; inspect the public descriptor below
 // through the same array layout ParticleContainer exposes to its update API.
 const offset=name=>p._attributes[name].offset/4;
 let sumLife=0;
 for(let i=0;i<p.capacity;i++){const start=i*4*stride;points.push([...p.data.f32.slice(start,start+3)]);sumLife+=p.data.f32[start+offset('aLife')];}
 assert.ok(points.some(v=>Math.hypot(v[0]-10,v[1]-2,v[2]-20)>3),'dust must fill its native six metre volume');
 assert.ok(points.every(v=>v[1]>=2),'negative native Z is disabled');
 assert.ok(sumLife/p.uniforms.uEmissionPeriod>70&&sumLife/p.uniforms.uEmissionPeriod<80,'expected density is near 75, not 100');
 assert.ok(Number.isFinite(life)&&Number.isFinite(birth));root.destroy({children:true});
});
test('finite combat effects allocate no persistent particles or textures',async()=>{
 const r=await load(recipe('War/Content/FX/ShrapnelAirBlast.ShrapnelAirBlast'));
 assert.equal(r.particles.length,0);assert.equal(r.reads.filter(p=>p.endsWith('.webp')).length,0);assert.equal(r.detail.summary.transientParticleComponents,1);r.root.destroy({children:true});
});
test('effect ownership follows buildings and water, with independent layer and actor visibility',async()=>{
 const worldData={prototypes:[{category:'building',placements:[{actor:'hospital'}]}]};
 assert.equal(effectOwnerLayer({actor:'hospital',system},{worldData}),'building');
 assert.equal(effectOwnerLayer({system:'War/Content/FX/Waterfall03.Waterfall03'}),'water');
 const r=await load(recipe(),{worldData,effectLayer:'building'});assert.equal(r.particles.length,1);
 r.detail.syncLayers({effects:true,building:true,structures:false});assert.equal(r.particles[0].visible,true);
 r.detail.syncLayers({effects:true,building:false,structures:true});assert.equal(r.particles[0].visible,false);
 r.detail.setActorVisibility(()=>false);r.detail.syncLayers({effects:true,building:true});assert.equal(r.particles[0].visible,false);r.root.destroy({children:true});
});

test('incomplete native mask materials allocate no particles or textures, including aliases',async()=>{
 for(const [name,source]of [['Dustmotes','War/Content/FX/Textures/SmallParticles.SmallParticles'],['GrassParticle','War/Content/FX/Textures/SmallParticles.SmallParticles'],['WaterSplashesWaterfallMist','War/Content/FX/Textures/SmokeAlphas02.SmokeAlphas02'],['WaterSplashes5','War/Content/FX/Textures/WaterSubUvs.WaterSubUvs']]){
  const data=recipe();const e=data.emitters[system][0];e.material=name;data.materials={[name]:{file:name+'.webp',source,color:[1,1,1],opacity:1}};
  const r=await load(data);assert.equal(r.particles.length,0,name);assert.equal(r.reads.filter(p=>p.endsWith('.webp')).length,0,name);assert.equal(r.detail.summary.unsupportedMaterialParticleComponents,1,name);r.root.destroy({children:true});
 }
 const data=recipe('War/Content/FX/Smoke.Smoke'),name='SmokeStacks';data.emitters['War/Content/FX/Smoke.Smoke'][0].material=name;data.materials={[name]:{file:name+'.webp',source:'War/Content/Blueprints/FX/Textures/SmokeAlphas01.SmokeAlphas01',color:[1,1,1],opacity:1}};
 const r=await load(data);assert.equal(r.particles.length,1,'chimney smoke stays available');assert.equal(r.detail.summary.unsupportedMaterialParticleComponents,0);r.root.destroy({children:true});
});
