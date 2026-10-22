// Display geometry only. Ground queries keep the original landscape triangles.
export const TERRAIN_GEOMETRY_STEPS=[1,2,4,8,16,32];
const axisFor=(size,step)=>{const axis=[];for(let i=0;i<size-1;i+=step)axis.push(i);axis.push(size-1);return axis;};
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));

export function terrainGeometryStep(camera,bounds,spacing=1){
 if(!camera?.position||!(camera.height>0))return 32;
 let metresPerPixel;
 if(camera.orthographicHeight>0)metresPerPixel=camera.orthographicHeight/camera.height;
 else{const p=camera.position,distance=Math.hypot(...bounds.min.map((lo,i)=>Math.max(lo-p[i],0,p[i]-bounds.max[i])));metresPerPixel=2*Math.max(.1,distance)*Math.tan((camera.fov||45)*Math.PI/360)/camera.height;}
 const wanted=2*metresPerPixel/Math.max(.001,spacing);
 return TERRAIN_GEOMETRY_STEPS.findLast(step=>step<=wanted)||1;
}

/** Preserve component transforms, the final row/column and native fine topology. */
export async function buildTerrainLod(meta,source,step,{signal,yieldWork=yieldTask}={}){
 if(!TERRAIN_GEOMETRY_STEPS.includes(step))throw Error('Invalid terrain geometry step');
 let vertices=0,triangles=0;
 for(const c of meta.components){if(!Number.isInteger(c.size)||c.size<2||c.offset<0||(c.offset+c.size*c.size)*3>source.length)throw Error('Invalid terrain component');const n=axisFor(c.size,step).length;vertices+=n*n+(step>1?8*n:0);triangles+=2*(n-1)**2+(step>1?8*(n-1):0);}
 const positions=new Float32Array(vertices*3),normals=new Float32Array(vertices*3),indices=new Uint32Array(triangles*3);let vo=0,io=0,slice=performance.now();
 for(const c of meta.components){
  signal?.throwIfAborted();const axis=axisFor(c.size,step),n=axis.length,base=vo;
  const at=(x,y,k)=>source[(c.offset+y*c.size+x)*3+k];
  for(const y of axis)for(const x of axis){
   const p=vo++*3;for(let k=0;k<3;k++)positions[p+k]=at(x,y,k);
   const x0=Math.max(0,x-1),x1=Math.min(c.size-1,x+1),y0=Math.max(0,y-1),y1=Math.min(c.size-1,y+1);
   const ux=at(x1,y,0)-at(x0,y,0),uy=at(x1,y,1)-at(x0,y,1),uz=at(x1,y,2)-at(x0,y,2),vx=at(x,y1,0)-at(x,y0,0),vy=at(x,y1,1)-at(x,y0,1),vz=at(x,y1,2)-at(x,y0,2);
   const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;let len=Math.hypot(nx,ny,nz);if(ny<0)len=-len;normals[p]=len?nx/len:0;normals[p+1]=len?ny/len:1;normals[p+2]=len?nz/len:0;
  }
  for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){const a=base+y*n+x,b=a+1,d=a+n,e=d+1;indices[io++]=a;indices[io++]=b;indices[io++]=d;indices[io++]=b;indices[io++]=e;indices[io++]=d;}
  if(step>1){
   const cell=Math.max(Math.hypot(at(c.size-1,0,0)-at(0,0,0),at(c.size-1,0,2)-at(0,0,2)),Math.hypot(at(0,c.size-1,0)-at(0,0,0),at(0,c.size-1,2)-at(0,0,2)))/(c.size-1),depth=Math.max(8,2*step*cell);
   const edges=[axis.map((_,i)=>base+i),axis.map((_,i)=>base+i*n+n-1),axis.map((_,i)=>base+(n-1)*n+n-1-i),axis.map((_,i)=>base+(n-1-i)*n)];
   for(const edge of edges){const start=vo;for(const id of edge){const from=id*3,top=vo++*3,bottom=vo++*3;for(let k=0;k<3;k++){positions[top+k]=positions[bottom+k]=positions[from+k];normals[top+k]=normals[bottom+k]=normals[from+k];}positions[bottom+1]-=depth;}for(let i=0;i<n-1;i++){const a=start+i*2;indices[io++]=a;indices[io++]=a+1;indices[io++]=a+2;indices[io++]=a+2;indices[io++]=a+1;indices[io++]=a+3;}}
  }
  if(performance.now()-slice>4){await yieldWork();signal?.throwIfAborted();slice=performance.now();}
 }
 return {positions,normals,indices,step,triangles,bytes:positions.byteLength+normals.byteLength+indices.byteLength};
}

// Serialize display refinements so several camera updates cannot allocate fine
// meshes at once. Every build cooperatively yields and can be retired mid-build.
let queue=Promise.resolve();
export function createTerrainGeometryLod({meta,source,create,release,apply,signal,build=buildTerrainLod,now=()=>performance.now()}){
 const bounds={min:meta.min,max:meta.max};let spacing=1;
 if(meta.components.length){const c=meta.components[0],a=c.offset*3,b=(c.offset+c.size-1)*3;spacing=Math.hypot(source[b]-source[a],source[b+2]-source[a+2])/(c.size-1)||1;}
 let base,current,pending,disposed=false,candidate=32,since=0,retryAt=0;
 const stats={step:32,triangles:0,bytes:0,pending:false,error:null};
 const cancelled=()=>{signal?.throwIfAborted();if(disposed)throw new DOMException('Terrain retired','AbortError');};
 function request(step){
  if(disposed||pending||current?.step===step)return pending?.promise||Promise.resolve(current?.geometry);
  const lifetime=new AbortController(),abort=()=>lifetime.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});
  const job={step,lifetime};pending=job;stats.pending=true;
  const work=async()=>{cancelled();lifetime.signal.throwIfAborted();const mesh=step===32&&base?null:await build(meta,source,step,{signal:lifetime.signal});cancelled();lifetime.signal.throwIfAborted();const next=mesh?{geometry:create(mesh),step,triangles:mesh.triangles,bytes:mesh.bytes}:base;const old=current;if(step===32)base=next;current=next;apply(next.geometry);Object.assign(stats,{step,triangles:next.triangles,bytes:next.bytes,error:null});if(old&&old!==base&&old!==next)release(old.geometry);return next.geometry;};
  job.promise=queue.then(work);queue=job.promise.catch(()=>{});
  job.promise=job.promise.catch(error=>{if(error.name!=='AbortError'){stats.error=String(error);retryAt=now()+10000;}throw error;}).finally(()=>{signal?.removeEventListener('abort',abort);if(pending===job){pending=null;stats.pending=false;}});
  return job.promise;
 }
 return {stats,initialize:()=>request(32),update(camera,visible=true){
  if(disposed||!current)return;const wanted=visible?terrainGeometryStep(camera,bounds,spacing):32,time=now();
  if(wanted!==candidate){candidate=wanted;since=time;if(pending&&pending.step!==wanted)pending.lifetime.abort();}
  if(wanted!==current.step&&!pending&&time>=retryAt&&time-since>=(wanted<current.step?200:800))void request(wanted).catch(()=>{});
 },destroy(){if(disposed)return;disposed=true;pending?.lifetime.abort();if(current&&current!==base)release(current.geometry);if(base)release(base.geometry);current=base=null;}};
}
