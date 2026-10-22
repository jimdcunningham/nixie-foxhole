import {particleLifetimeBit} from '@pixi/3d';

const sample=(r,random)=>r[0]+(r[1]-r[0])*random();
const sampleVector=(r,random)=>r[0].map((v,i)=>v+(r[1][i]-v)*random());
const constrain=(v,i,shape)=>shape.positive[i]?(shape.negative[i]?v:Math.abs(v)):(shape.negative[i]?-Math.abs(v):0);

/** Native centimetres/Z-up until the existing region transform is applied. */
export function sampleNativeParticleShape(shape,random){
 const radius=Math.max(0,sample(shape.radius,random)),center=sampleVector(shape.location,random);
 let offset;
 if(shape.shape==='sphere'){
  const z=random()*2-1,a=random()*Math.PI*2,xy=Math.sqrt(Math.max(0,1-z*z));
  offset=[xy*Math.cos(a),xy*Math.sin(a),z].map((v,i)=>constrain(v,i,shape));
  const length=Math.hypot(...offset),dimensions=shape.positive.filter((v,i)=>v||shape.negative[i]).length;
  const r=radius*(shape.surface?1:random()**(1/Math.max(1,dimensions)));
  offset=offset.map(v=>length?v/length*r:0);
 }else{
  const angle=random()*Math.PI*2,r=radius*(shape.surface?1:Math.sqrt(random())),height=sample(shape.height,random),axis=shape.axis;
  offset=[0,0,0];offset[axis]=(random()-.5)*height;
  offset[(axis+1)%3]=Math.cos(angle)*r;offset[(axis+2)%3]=Math.sin(angle)*r;
  offset=offset.map((v,i)=>constrain(v,i,shape));
 }
 const scale=shape.velocity?sample(shape.velocityScale,random):0;
 return {position:offset.map((v,i)=>v+center[i]),velocity:offset.map((v,i)=>shape.shape==='cylinder'&&shape.radialVelocity&&i===shape.axis?0:v*scale)};
}

/** Capacity bounds the lifetime window, not the number that must stay alive. */
export function nativeEmissionSchedule(emitter){
 const maxLife=Math.max(.01,...emitter.lifetime),rate=emitter.rate?Math.max(0,(emitter.rate[0]+emitter.rate[1])/2):emitter.count/maxLife;
 if(!rate||!emitter.count)return {count:0,period:maxLife,rate:0};
 const count=Math.max(1,Math.min(emitter.count,Math.ceil(rate*maxLife)));
 return {count,period:Math.max(maxLife,count/rate),rate};
}

// Empty gaps in a slot's emission period retain native dead-particle clipping.
// All slots are immutable after construction; only system time changes per frame.
export const nativeEmissionLifetime={...particleLifetimeBit,name:'nativeRateLifetime_v2',bindings:{material:{...particleLifetimeBit.bindings.material,uEmissionPeriod:'f32'}},
 gpu:{vertex:{...particleLifetimeBit.gpu.vertex,beforeTransform:'let ageUnwrapped=material.uParticleTime-input.aBirth; let period=max(material.uEmissionPeriod,1e-6); let particleAge=ageUnwrapped-floor(ageUnwrapped/period)*period; let particleProgress=clamp(particleAge/max(input.aLife,1e-6),0.0,1.0);'}},
 gl:{vertex:{...particleLifetimeBit.gl.vertex,beforeTransform:'float ageUnwrapped=material.uParticleTime-aBirth; float period=max(material.uEmissionPeriod,1e-6); float particleAge=ageUnwrapped-floor(ageUnwrapped/period)*period; float particleProgress=clamp(particleAge/max(aLife,1e-6),0.0,1.0);'}}};

export const nativeParticleSpin={name:'nativeParticleSpin_v1',attributes:{aNativeSpin:'float32'},gpu:{vertex:{beforeTransform:'particleRotation+=input.aNativeSpin*particleAge;'}},gl:{vertex:{beforeTransform:'particleRotation+=aNativeSpin*particleAge;'}}};

export function nativeParticleSeed(identity){let seed=2166136261;for(let i=0;i<identity.length;i++)seed=Math.imul(seed^identity.charCodeAt(i),16777619);return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
export {sample as sampleNativeRange,sampleVector as sampleNativeVector};
