import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,ParticleContainer3D} from '@pixi/3d';
import {Texture} from 'pixi.js';
import {loadWorldDetails} from '../authoring/world-details.mjs';
const mistSystem='War/Content/FX/WaterMist.WaterMist';
const emitter={name:'ParticleSpriteEmitter_0',material:'Mist',count:40,acceleration:[[0,0,0],[0,0,0]],location:[[0,0,0],[0,0,0]],origin:[0,0,0],velocity:[[0,0,0],[0,0,0]],size:[[600,600,600],[1000,1000,1000]],lifetime:[12,20],color:[[.66,.66,.66],[.66,.66,.66]],alpha:[1,1]};
for(const frame of [undefined,{x:100,y:200,scale:32}])test('incomplete water mist is omitted while other synthetic emitters retain their transforms '+(frame?'in the host frame':'in native space'),async()=>{
 const root=new Container3D(),systems=[mistSystem,'War/Content/FX/Smokestack','War/Content/FX/RiverSplashes'];
 const effects={materials:{Mist:{file:'Mist.webp',color:[1,1,1],opacity:1}},placements:systems.map((system,i)=>({actor:'actor'+i,name:'FX',system,visible:true,autoActivate:true,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,.5,0,1]})),emitters:Object.fromEntries(systems.map(system=>[system,[structuredClone(emitter)]]))};const before=structuredClone(effects);
 const details=await loadWorldDetails({region:'deadlands',root,frame,json:async p=>p.endsWith('details/render.json')?{chunks:[],coverage:[]}:p.endsWith('details/materials.json')?{}:p.endsWith('effects/render.json')?effects:{materials:{},placements:[]},zipped:async()=>new ArrayBuffer(0),texture:async()=>Texture.WHITE,hexBit:{name:'boundary',gpu:{fragment:{material:''}},gl:{fragment:{material:''}}}});
 const particles=root.children.filter(node=>node instanceof ParticleContainer3D);assert.equal(particles.length,2);assert.deepEqual(particles.map(p=>p.nativeActor),['actor1','actor2']);assert.equal(details.summary.unsupportedParticleComponents,1);assert.equal(details.summary.particles,80);assert.deepEqual(effects,before,'source recipes remain intact');
 details.syncLayers({water:false});assert.equal(particles[0].visible,true);assert.equal(particles[1].visible,false);details.syncLayers({effects:false});assert.ok(particles.every(p=>!p.visible));root.destroy({children:true});
});
