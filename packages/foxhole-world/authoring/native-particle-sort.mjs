import {Buffer,BufferUsage} from 'pixi.js';

// Keep per-emitter order private: ParticleContainer3D's quad indices are shared.
// Only the draw order changes; native spawn attributes remain immutable.
export function prepareNativeParticleSort(container,mode='PSORTMODE_ViewProjDepth'){
 const count=container.capacity,template=container.geometry.indices.slice(0,6),indices=new Uint32Array(count*6),order=Array.from({length:count},(_,i)=>i),depth=new Float64Array(count);
 const buffer=new Buffer({data:indices,usage:BufferUsage.INDEX|BufferUsage.COPY_DST,label:'native-particle-depth-order'});
 for(let i=0;i<count;i++)for(let j=0;j<6;j++)indices[i*6+j]=i*4+template[j];
 container.geometry.addIndex(buffer);container.once('destroyed',()=>buffer.destroy());
 const {f32,offsets,floatStride}=container.data,stride=floatStride*4,offset=name=>offsets[name]/4;
 const birth=offset('aBirth'),velocity=offset('aVel'),life=offset('aLife');
 let initialized=false;
 return {buffer,order,update(camera,frame){
  const planes=camera?.planes,direction=camera?.direction;
  const ageOrder=mode==='PSORTMODE_Age_OldestFirst',distanceOrder=mode==='PSORTMODE_DistanceToView';
  if(distanceOrder?!camera?.position:!ageOrder&&!direction&&(!planes||planes.length<24))return;
  // Plane 5 is the inward near-plane normal, i.e. camera forward. Framed
  // cameras supply board axes; sort animated centres in their native axes.
  const d=direction||(planes?[planes[20],planes[21],planes[22]]:[0,0,0]);
  const [dx,dy,dz]=direction||!frame?d:[d[0],d[2],d[1]];
  const u=container.uniforms,time=u.uParticleTime,period=u.uEmissionPeriod,k=u.uDrag,g=u.uGravity,wind=u.uSceneWind||[0,0,0];
  for(let i=0;i<count;i++){
   const at=i*stride,raw=time-f32[at+birth],t=raw-Math.floor(raw/period)*period;
   const a=k>1e-4?(1-Math.exp(-k*t))/k:t,b=k>1e-4?(t-a)/k:t*t*.5,w=t-(1-Math.exp(-t));
   const x=f32[at]+f32[at+velocity]*a+g[0]*b+wind[0]*w,y=f32[at+1]+f32[at+velocity+1]*a+g[1]*b+wind[1]*w,z=f32[at+2]+f32[at+velocity+2]*a+g[2]*b+wind[2]*w;
   const cp=camera?.position,anchor=container.position,local=container.space==='local';
   depth[i]=t>f32[at+life]?Infinity:ageOrder?t:distanceOrder?(x-cp[0]+(local?anchor.x:0))**2+(y-cp[1]+(local?anchor.y:0))**2+(z-cp[2]+(local?anchor.z:0))**2:x*dx+y*dy+z*dz;
  }
  order.sort((a,b)=>depth[b]-depth[a]||a-b);
  let changed=!initialized;
  for(let i=0;i<count;i++)for(let j=0;j<6;j++){const next=order[i]*4+template[j],at=i*6+j;if(indices[at]!==next){indices[at]=next;changed=true;}}
  if(changed){buffer.update();initialized=true;}
 }};
}
