import {fetchCompactResource} from './compact-cache.mjs';
import {readCachedRecipe,readCachedRoadAssembly} from './recipe-cache.mjs';
performance.setResourceTimingBufferSize(30000);
const jobs=new Map();
self.onmessage=async({data})=>{
 if(data.kind==='cancel-resource'){jobs.get(data.id)?.abort();return;}
 const controller=new AbortController();jobs.set(data.id,controller);
 const start=performance.now(),cacheMetrics={cacheHits:0,cacheMisses:0,cacheWriteFailures:0,downloadBytes:0};
 try{
  const result=data.kind==='recipe-read'?await readCachedRecipe(data.baseUrl,data.hash,{metrics:cacheMetrics}):data.kind==='road-assembly-read'?await readCachedRoadAssembly(data.baseUrl,data.hash,{metrics:cacheMetrics}):await fetchCompactResource(data.baseUrl,data.ref,{metrics:cacheMetrics,signal:controller.signal,cachesApi:data.retainCompactAssets===false?null:undefined});
  const timings=performance.getEntriesByType('resource').filter(e=>e.startTime>=start).map(e=>({name:e.name,startTime:e.startTime,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,duration:e.duration}));
  self.postMessage({id:data.id,result,cacheMetrics,timings,ms:performance.now()-start},result?[result]:[]);
 }catch(error){self.postMessage({id:data.id,error:String(error.stack||error)});}finally{jobs.delete(data.id);}
};
self.postMessage({kind:'foxhole-worker-ready'});
