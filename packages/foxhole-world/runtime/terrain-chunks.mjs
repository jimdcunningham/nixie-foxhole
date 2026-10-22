import {buildTerrainLod,terrainGeometryStep,TERRAIN_GEOMETRY_STEPS} from './terrain-geometry-lod.mjs';
import {terrainGeometryBudgetFor} from './terrain-geometry-budget.mjs';

export function terrainLodAllocation(components,step){let vertices=0,triangles=0;for(const c of components){const n=Math.ceil((c.size-1)/step)+1;vertices+=n*n+(step>1?8*n:0);triangles+=2*(n-1)**2+(step>1?8*(n-1):0);}return {vertices,triangles,bytes:vertices*24+triangles*12};}

/** Exact source bounds include tilted/warped and overlapping components. */
export async function partitionTerrain(meta,source,{size=256,signal,yieldWork=()=>new Promise(r=>setTimeout(r,0))}={}){
 const groups=new Map();let slice=performance.now();
 for(const c of meta.components){
  signal?.throwIfAborted();if(!Number.isInteger(c.size)||c.size<2||!Number.isInteger(c.offset)||c.offset<0||(c.offset+c.size*c.size)*3>source.length)throw Error('Invalid terrain component');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=c.offset*3,end=(c.offset+c.size*c.size)*3;i<end;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],source[i+k]);max[k]=Math.max(max[k],source[i+k]);}
  const a=c.offset*3,b=(c.offset+c.size-1)*3,d=(c.offset+(c.size-1)*c.size)*3;
  const spacing=Math.min(Math.hypot(source[b]-source[a],source[b+2]-source[a+2]),Math.hypot(source[d]-source[a],source[d+2]-source[a+2]))/(c.size-1)||1;
  const skirt=Math.max(8,64*Math.max(Math.hypot(source[b]-source[a],source[b+2]-source[a+2]),Math.hypot(source[d]-source[a],source[d+2]-source[a+2]))/(c.size-1));
  const key=Math.floor((min[0]+max[0])/2/size)+','+Math.floor((min[2]+max[2])/2/size);let chunk=groups.get(key);
  if(!chunk){chunk={key,components:[],bounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},spacing:Infinity};groups.set(key,chunk);}
  chunk.components.push(c);chunk.spacing=Math.min(chunk.spacing,spacing);for(let k=0;k<3;k++){chunk.bounds.min[k]=Math.min(chunk.bounds.min[k],min[k]-(k===1?skirt:0));chunk.bounds.max[k]=Math.max(chunk.bounds.max[k],max[k]);}
  if(performance.now()-slice>4){await yieldWork();signal?.throwIfAborted();slice=performance.now();}
 }
 let indexStart=0;for(const chunk of groups.values()){chunk.indexStart=indexStart;chunk.indexCount=terrainLodAllocation(chunk.components,32).triangles*3;indexStart+=chunk.indexCount;}
 return [...groups.values()];
}

/** Transform world frustum planes into metres/Y-up once per region. */
export function nativeTerrainPlanes(planes,frame,out=new Float64Array(24)){
 if(!planes||planes.length!==24)return null;
 for(let i=0;i<24;i+=4){const a=planes[i],b=planes[i+1],c=planes[i+2],d=planes[i+3];if(!Number.isFinite(a+b+c+d))return null;if(frame){out[i]=a*frame[2];out[i+1]=c*frame[2];out[i+2]=b*frame[2];out[i+3]=d+a*frame[0]+b*frame[1];}else{out[i]=a;out[i+1]=b;out[i+2]=c;out[i+3]=d;}}
 return out;
}
export function terrainBoundsVisible(bounds,planes){
 if(!planes)return true;
 for(let i=0;i<24;i+=4){const a=planes[i],b=planes[i+1],c=planes[i+2];const reach=a*(a>=0?bounds.max[0]:bounds.min[0])+b*(b>=0?bounds.max[1]:bounds.min[1])+c*(c>=0?bounds.max[2]:bounds.min[2])+planes[i+3];if(reach<-.01)return false;}return true;
}
const distanceTo=(bounds,p)=>Math.hypot(...bounds.min.map((lo,i)=>Math.max(lo-p[i],0,p[i]-bounds.max[i])));

const jobs=[];let working=false;
function enqueue(run,priority,signal){return new Promise((resolve,reject)=>{
 const job={run,priority,resolve,reject,signal};const abort=()=>{const index=jobs.indexOf(job);if(index>=0){jobs.splice(index,1);signal.removeEventListener('abort',abort);reject(signal.reason);}};job.abort=abort;jobs.push(job);signal.addEventListener('abort',abort,{once:true});queueMicrotask(pump);
});}
async function pump(){if(working)return;working=true;try{while(jobs.length){jobs.sort((a,b)=>b.priority-a.priority);const job=jobs.shift();job.signal.removeEventListener('abort',job.abort);try{job.signal.throwIfAborted();job.resolve(await job.run());}catch(error){job.reject(error);}}}finally{working=false;}}

/** Chunked direct draws share one material, exact source heights and coarse
 * vertex buffers. Off-screen detail can be evicted without removing relief. */
export function createChunkedTerrainLod({meta,source,create,release,createView,releaseView,apply,signal,frame,renderer,adaptive=true,frustumCulling=true,budget=terrainGeometryBudgetFor(renderer),build=buildTerrainLod,now=()=>performance.now()}){
 let chunks=[],base,baseMesh,releaseBase,disposed=false,pending,lastUpdate=-Infinity;
 const planeScratch=new Float64Array(24),drawPlaneScratch=new Float64Array(24);
 const stats={step:32,chunks:0,visibleChunks:0,detailChunks:0,draws:0,triangles:0,residentTriangles:0,bytes:0,pending:false,error:null,budget:budget.stats};
 const abort=()=>{pending?.controller.abort(signal?.reason);};signal?.addEventListener('abort',abort,{once:true});
 function drop(chunk){if(chunk.fine){release(chunk.fine.geometry);chunk.fine.token.release();chunk.fine=null;}}
 function snapshot(){stats.detailChunks=chunks.filter(c=>c.fine).length;stats.step=Math.min(32,...chunks.map(c=>c.fine?.step||32));stats.residentTriangles=(baseMesh?.triangles||0)+chunks.reduce((n,c)=>n+(c.fine?.triangles||0),0);stats.bytes=(baseMesh?.bytes||0)+(baseMesh?.indices.byteLength||0)+chunks.reduce((n,c)=>n+(c.fine?.bytes||0),0);stats.pending=!!pending;}
 async function initialize(){
  if(!adaptive){baseMesh=await build(meta,source,1,{signal});signal?.throwIfAborted();if(disposed)throw new DOMException('Terrain retired','AbortError');base=create(baseMesh);Object.assign(stats,{step:1,chunks:1,visibleChunks:1,detailChunks:1,draws:1,triangles:baseMesh.triangles,residentTriangles:baseMesh.triangles,bytes:baseMesh.bytes});apply(base);return base;}
  chunks=await partitionTerrain(meta,source,{signal});if(disposed)throw new DOMException('Terrain retired','AbortError');
  baseMesh=await build({...meta,components:chunks.flatMap(c=>c.components)},source,32,{signal});signal?.throwIfAborted();if(disposed)throw new DOMException('Terrain retired','AbortError');
  base=create(baseMesh);
  for(const chunk of chunks){chunk.view=createView(base,baseMesh.indices.subarray(chunk.indexStart,chunk.indexStart+chunk.indexCount),chunk.bounds);chunk.wanted=chunk.candidate=32;chunk.since=0;chunk.retryAt=0;chunk.priority=0;}
  releaseBase=budget.retainBase(baseMesh.bytes+baseMesh.indices.byteLength);stats.chunks=chunks.length;snapshot();apply(base);return base;
 }
 function request(chunk){
  const controller=new AbortController(),job={chunk,controller,step:chunk.wanted};pending=job;snapshot();
  const run=async()=>{
   controller.signal.throwIfAborted();let step=job.step,token,allocation;
   const evict=()=>{controller.abort();if(chunk.fine?.token===token){drop(chunk);snapshot();}};
   while(step<32){allocation=terrainLodAllocation(chunk.components,step);token=budget.reserve(allocation.bytes,chunk.priority,evict);if(token)break;step=TERRAIN_GEOMETRY_STEPS[TERRAIN_GEOMETRY_STEPS.indexOf(step)+1];}
   if(!token||chunk.fine?.step===step){token?.release();chunk.retryAt=now()+1000;return;}
   try{const mesh=await build({...meta,components:chunk.components},source,step,{signal:controller.signal});controller.signal.throwIfAborted();signal?.throwIfAborted();if(disposed)throw new DOMException('Terrain retired','AbortError');
    const geometry=create(mesh);if(!token.commit()){release(geometry);throw new DOMException('Terrain allocation retired','AbortError');}drop(chunk);chunk.fine={geometry,step,bytes:mesh.bytes,triangles:mesh.triangles,token};chunk.retryAt=step===chunk.wanted?0:now()+1000;stats.error=null;
   }catch(error){token.release();throw error;}
  };
  void enqueue(run,chunk.priority,controller.signal).catch(error=>{if(error?.name!=='AbortError'){stats.error=String(error);chunk.retryAt=now()+10000;}}).finally(()=>{if(pending===job)pending=null;snapshot();});
 }
 return {stats,initialize,get frustumCulling(){return frustumCulling;},set frustumCulling(value){frustumCulling=value;},
  update(camera,visible=true){
   if(!adaptive||disposed||!base||!camera?.position)return;const time=now();if(time-lastUpdate<50)return;lastUpdate=time;
   const planes=nativeTerrainPlanes(camera.planes,frame,planeScratch),candidates=[];
   for(const chunk of chunks){const onScreen=visible&&terrainBoundsVisible(chunk.bounds,planes),distance=distanceTo(chunk.bounds,camera.position);chunk.priority=onScreen?1/(1+distance):0;
    const wanted=onScreen?terrainGeometryStep(camera,chunk.bounds,chunk.spacing):32;chunk.wanted=wanted;chunk.fine?.token.touch(chunk.priority);
    if(wanted!==chunk.candidate){chunk.candidate=wanted;chunk.since=time;if(pending?.chunk===chunk&&pending.step!==wanted)pending.controller.abort();}
    if(time-chunk.since<(wanted<(chunk.fine?.step||32)?200:800))continue;
    if(wanted===32){drop(chunk);continue;}
    if(chunk.fine?.step!==wanted&&time>=chunk.retryAt)candidates.push(chunk);
   }
   if(!pending&&candidates.length){candidates.sort((a,b)=>b.priority-a.priority);request(candidates[0]);}snapshot();
  },
  getDraws(worldPlanes){
   if(disposed||!base)return[];if(!adaptive){const visible=!frustumCulling||terrainBoundsVisible({min:meta.min,max:meta.max},nativeTerrainPlanes(worldPlanes,frame,drawPlaneScratch));stats.visibleChunks=stats.draws=visible?1:0;stats.triangles=visible?baseMesh.triangles:0;return visible?[base]:[];}const planes=nativeTerrainPlanes(worldPlanes,frame,drawPlaneScratch),visible=chunks.filter(chunk=>terrainBoundsVisible(chunk.bounds,planes));
   const draws=visible.length===chunks.length&&!visible.some(c=>c.fine)?[base]:visible.map(c=>c.fine?.geometry||c.view);
   stats.visibleChunks=visible.length;stats.draws=draws.length;stats.triangles=visible.reduce((n,c)=>n+(c.fine?.triangles||c.indexCount/3),0);return draws;
  },
  destroy(){if(disposed)return;disposed=true;signal?.removeEventListener('abort',abort);pending?.controller.abort();for(const chunk of chunks){drop(chunk);if(chunk.view)releaseView(chunk.view);}if(base)release(base);releaseBase?.();base=null;baseMesh=null;chunks=[];snapshot();}
 };
}
