/** Queue only requested groups. Completed groups remain reusable until region disposal. */
export function createLayerDemand({tasks, signal, concurrency=2, onChange=()=>{}}) {
 const states=new Map(Object.keys(tasks).map(key=>[key,{key,loaded:false,requested:false,running:null,error:null}]));
 const waiters=[],settled=[];let closed=false;
 const abort=()=>signal?.reason||new DOMException('Region disposed','AbortError');
 function pending(){return [...states.values()].some(s=>s.running||s.requested&&!s.loaded&&!s.error);}
 function notify(){if(![...states.values()].some(s=>s.running))for(const resolve of settled.splice(0))resolve();onChange([...states.values()].map(({key,loaded,requested,running,error})=>({key,loaded,requested,loading:!!running,error})));if(closed||!pending())for(const w of waiters.splice(0)){const error=closed?abort():[...states.values()].find(s=>s.requested&&s.error)?.error;error?w.reject(error):w.resolve();}}
 function pump(){
  if(closed){notify();return;}
  for(const s of states.values())if(!s.requested&&s.loaded&&!s.running&&tasks[s.key].unload&&![...states.values()].some(other=>other.running&&(tasks[other.key].dependencies||[]).includes(s.key))){
   s.loaded=false;s.running=new AbortController();
   Promise.resolve().then(()=>tasks[s.key].unload()).catch(error=>{s.error=error;}).finally(()=>{s.running=null;pump();notify();});
  }
  let slots=concurrency-[...states.values()].filter(s=>s.running).length;
  for(const s of states.values()){
   if(!slots||!s.requested||s.loaded||s.running||s.error)continue;
   const dependencies=(tasks[s.key].dependencies||[]).map(key=>states.get(key));
   const failed=dependencies.find(d=>d.error);if(failed){s.error=failed.error;continue;}if(dependencies.some(d=>!d.loaded))continue;
   slots--;const controller=new AbortController(),lifetime=signal?AbortSignal.any([signal,controller.signal]):controller.signal;s.running=controller;
   Promise.resolve().then(()=>{lifetime.throwIfAborted();return tasks[s.key].load(lifetime);}).then(()=>{lifetime.throwIfAborted();s.loaded=true;}).catch(error=>{if(!lifetime.aborted)s.error=error;}).finally(()=>{s.running=null;pump();notify();});
  }
  notify();
 }
 function setLayers(layers){
  if(closed)return;
  const desired=new Set(Object.entries(tasks).filter(([,t])=>t.needed(layers)).map(([key])=>key));
  const include=key=>{for(const dep of tasks[key].dependencies||[])if(!desired.has(dep)){desired.add(dep);include(dep);}};for(const key of desired)include(key);
  let changed=false;for(const s of states.values()){const requested=desired.has(s.key);if(requested!==s.requested){changed=true;s.requested=requested;s.error=null;if(!requested)s.running?.abort(new DOMException('Layer disabled','AbortError'));}}
  if(changed)pump();
 }
 function dispose(){if(closed)return;closed=true;for(const s of states.values())s.running?.abort(abort());pump();signal?.removeEventListener('abort',dispose);}
 signal?.addEventListener('abort',dispose,{once:true});
 return {get busy(){return [...states.values()].some(s=>s.running);},setLayers,whenSettled(){return new Promise(resolve=>{settled.push(resolve);notify();});},whenIdle(){if(closed)return Promise.reject(abort());return new Promise((resolve,reject)=>{waiters.push({resolve,reject});pump();});},dispose};
}
