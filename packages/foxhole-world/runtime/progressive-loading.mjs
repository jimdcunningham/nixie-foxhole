/** Publish bounded scene mutations between browser rendering opportunities. */
export function createRegionRevealQueue({signal,budgetMs=4,now=()=>performance.now(),schedule=fn=>setTimeout(fn,0),cancel=clearTimeout}={}) {
 const jobs=[];let timer=null,closed=false;
 const reason=()=>signal?.reason||new DOMException('Region disposed','AbortError');
 function dispose(){if(closed)return;closed=true;if(timer!==null)cancel(timer);timer=null;for(const job of jobs.splice(0))job.reject(reason());signal?.removeEventListener('abort',dispose);}
 function drain(){timer=null;const start=now();while(jobs.length&&!closed){const job=jobs.shift();if(signal?.aborted){job.reject(reason());dispose();break;}try{job.resolve(job.build());}catch(error){job.reject(error);}if(now()-start>=budgetMs)break;}if(jobs.length&&!closed)timer=schedule(drain);}
 signal?.addEventListener('abort',dispose,{once:true});
 return {run(build){if(closed||signal?.aborted)return Promise.reject(reason());return new Promise((resolve,reject)=>{jobs.push({build,resolve,reject});if(timer===null)timer=schedule(drain);});},dispose};
}

/** Start shared downloads together; reveal complete assets in availability order. */
export async function* readyAssets(assets,load,{progressive=false,signal}={}) {
 const tasks=new Map(assets.map(asset=>[asset,Promise.resolve().then(()=>load(asset)).then(()=>({asset}),error=>({asset,error}))]));
 try {
  if(!progressive){const results=await Promise.all(tasks.values());const failure=results.find(row=>row.error);if(failure)throw failure.error;}
  while(tasks.size){signal?.throwIfAborted();const result=progressive?await Promise.race(tasks.values()):await tasks.values().next().value;tasks.delete(result.asset);if(result.error)throw result.error;yield result.asset;}
 }finally{await Promise.all(tasks.values());}
}

export function prioritizeRegionPrototypes(prototypes,position) {
 if(!position)return prototypes;
 const distance=p=>p.placements.reduce((nearest,row)=>Math.min(nearest,Math.hypot(row.matrix[12]-position[0],row.matrix[14]-position[2])),Infinity);
 return prototypes.map((prototype,index)=>({prototype,index,distance:distance(prototype)})).sort((a,b)=>a.distance-b.distance||a.index-b.index).map(row=>row.prototype);
}
