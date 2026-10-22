import {prepareNativeParticleSort} from './native-particle-sort.mjs';
import {isLanternFlame,lanternFlameColor,lanternFlameBit} from './lantern-flame.mjs';
import {ParticleContainer3D,particleMotionBit} from '@pixi/3d';
import modules from './native-particle-modules.json' with {type:'json'};
import {nativeParticleCurveBit} from './native-particle-curves.mjs';
import {nativeParticleOrbit} from './native-particle-orbit.mjs';
import {nativeEmissionSchedule,nativeEmissionLifetime,nativeParticleSpin,nativeParticleSeed,sampleNativeRange as sample,sampleNativeVector as sampleVector,sampleNativeParticleShape} from './native-particle-emission.mjs';
import {isPersistentParticleEmitter} from './world-effect-policy.mjs';
import {hideViewerParticleEffect,unsupportedParticleMaterialReason} from './viewer-effects-policy.mjs';
const point=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const vector=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2],m[1]*p[0]+m[5]*p[1]+m[9]*p[2],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]];
const ue=([x,y,z])=>[x/100,z/100,-y/100],xyz=([x,y,z])=>({x,y,z});
const srgb=x=>Math.round(255*Math.max(0,Math.min(1,x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055)));
export const nativeEmitterModules=(system,emitter)=>emitter.nativeModules||modules.systems[system]?.[emitter.name];
export function persistentParticleEmitters(placement,effects){
 if(!placement.visible||placement.hidden||!placement.autoActivate||hideViewerParticleEffect(placement.system))return [];
 return (effects.emitters[placement.system]||[]).filter(e=>!unsupportedParticleMaterialReason(e.material,effects.materials[e.material])&&e.count&&isPersistentParticleEmitter(nativeEmitterModules(placement.system,e))&&nativeEmissionSchedule(e).count);
}
/** Advection is in the shared native metre frame, independent of emitter rotation. */
const nativeParticleWind={name:'nativeParticleWind',bindings:{material:{uSceneWind:'vec3<f32>'}},
 gpu:{vertex:{beforeTransform:'position=vec4<f32>(position.xyz+material.uSceneWind*(particleAge-(1.0-exp(-particleAge))),1.0);'}},
 gl:{vertex:{beforeTransform:'position=vec4(position.xyz+material.uSceneWind*(particleAge-(1.0-exp(-particleAge))),1.0);'}}};
export function updateNativeParticleWind(container,wind){
 if(!container.nativeWindResponsive)return;
 const strength=Number.isFinite(wind?.strength)?Math.max(0,Math.min(1,wind.strength)):0;
 const angle=(Number.isFinite(wind?.directionDeg)?wind.directionDeg:0)*Math.PI/180,speed=strength*6;
 container.uniforms.uSceneWind=speed?[Math.cos(angle)*speed,0,-Math.sin(angle)*speed]:[0,0,0];
}
export function buildNativeParticleEmitter({placement,emitter:e,material:m,texture,particleHex,frame,region}){
 const lantern=isLanternFlame(placement,m),native=nativeEmitterModules(placement.system,e),schedule=nativeEmissionSchedule(e),random=nativeParticleSeed([region,placement.actor,placement.name,placement.matrix.join(','),e.name].join('|'));
 const windResponsive=!lantern&&!m.fire&&/smoke|steam|mist|dust/i.test(placement.system+' '+e.name+' '+e.material);
 const bits=[nativeEmissionLifetime,particleMotionBit,...(windResponsive?[nativeParticleWind]:[]),nativeParticleSpin,...(native?.orbit?[nativeParticleOrbit]:[]),nativeParticleCurveBit(e.curves,placement.system+e.name),...(lantern?[lanternFlameBit]:[]),particleHex];
 const container=new ParticleContainer3D({texture,capacity:schedule.count,billboard:'spherical',space:frame?'local':'world',blendMode:m.fire&&!lantern?'add':'normal',extraBits:bits,label:placement.actor+'/'+placement.name});
 // The origin remains the sorting anchor; board-frame local centers retain
 // their metre-space launch/motion, while quad diameter is in board world units.
 const anchor=placement.matrix.slice(12,15);container.position.set(...anchor);
 container.uniforms.uGravity=vector(placement.matrix,ue(e.acceleration[0]));container.uniforms.uDrag=Math.max(0,sample(native?.drag||[0,0],random));
 container.uniforms.uParticleTime=0;container.uniforms.uEmissionPeriod=schedule.period;
 if(native?.orbit)for(const [i,axis]of ['X','Y','Z'].entries()){const basis=[0,0,0];basis[i]=100;container.uniforms['uNativeOrbit'+axis]=vector(placement.matrix,ue(basis));}
 const phase=random()*schedule.period;
 for(let i=0;i<schedule.count;i++){
  const local=sampleVector(e.location,random).map((v,k)=>v+e.origin[k]),velocity=sampleVector(e.velocity,random);
  for(const shape of native?.volumes||[]){const sample=sampleNativeParticleShape(shape,random);for(let k=0;k<3;k++){local[k]+=sample.position[k];velocity[k]+=sample.velocity[k];}}
  const p=point(placement.matrix,ue(local)),v=vector(placement.matrix,ue(velocity)),size=Math.max(.001,Math.abs(sampleVector(e.size,random)[0])*(frame?.scale||1)/100),life=Math.max(.01,sample(e.lifetime,random));
  const linear=sampleVector(e.color,random).map((v,k)=>v*m.color[k]),color=(lantern?lanternFlameColor(linear):linear).map(srgb),alpha=Math.min(1,Math.max(0,sample(e.alpha,random)*m.opacity));
  const rotation=sample(native?.rotation||[0,1],random)*Math.PI*2;
  container.setParticleAt(i,...(frame?p.map((v,k)=>v-anchor[k]):p),size,rotation,(color[0]<<16)|(color[1]<<8)|color[2],alpha);
  container.setParticle(i,{aBirth:-((i/schedule.count*schedule.period+phase)%schedule.period),aLife:life,aVel:xyz(v),aNativeSpin:sample(native?.rotationRate||[0,0],random)*Math.PI*2,
   ...(native?.orbit?{aNativeOrbitOffset:xyz(sampleVector(native.orbit.offset,random).map(v=>v/100)),aNativeOrbitRotation:xyz(sampleVector(native.orbit.rotation,random)),aNativeOrbitRate:xyz(sampleVector(native.orbit.rate,random))}:{})});
 }
 container.nativeWindResponsive=windResponsive;if(windResponsive)container.uniforms.uSceneWind=[0,0,0];
 if(!m.fire&&['PSORTMODE_ViewProjDepth','PSORTMODE_DistanceToView','PSORTMODE_Age_OldestFirst'].includes(native?.sortMode)&&!native.orbit)container.nativeDepthSort=prepareNativeParticleSort(container,native.sortMode);
 container.nativeActor=placement.actor;container.nativeSchedule=schedule;
 return container;
}
