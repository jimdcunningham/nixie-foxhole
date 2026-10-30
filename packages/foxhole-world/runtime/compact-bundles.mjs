import {boundedByteStream} from './bounded-byte-stream.mjs';
import {createResourceTimingObserver} from './terrain-network-observation.mjs';
const MAX_BYTES=4*1024**2, HASH=/^[a-f0-9]{64}$/, PATH=/^content\/(?:br|raw)\/([a-f0-9]{64})\/asset\.[a-z0-9]+$/;
const flights=new WeakMap(),observe=createResourceTimingObserver();
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const key=row=>'https://foxhole-world-resource.invalid/sha256/'+row.decodedHash;
export class CompactBundleError extends Error {}
export function validateCompactBundle(bundle){
 const ref=bundle?.resource;
 if(!ref||!PATH.test(ref.path)||!ref.path.includes(ref.hash)||!HASH.test(ref.hash)||!HASH.test(ref.decodedHash)||ref.encoding!=='br'||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>MAX_BYTES+65536||!Number.isSafeInteger(ref.decodedBytes)||ref.decodedBytes<1||ref.decodedBytes>MAX_BYTES||!Array.isArray(bundle.entries)||bundle.entries.length<2||bundle.entries.length>4096)throw Error('Invalid compact bundle');
 let end=0;const paths=new Set();
 for(const entry of bundle.entries){if(!PATH.test(entry.path)||!HASH.test(entry.decodedHash)||paths.has(entry.path)||!['br','raw'].includes(entry.encoding)||entry.offset!==end||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||end+entry.bytes>ref.decodedBytes)throw Error('Invalid compact bundle entry');paths.add(entry.path);end+=entry.bytes;}
 if(end!==ref.decodedBytes)throw Error('Incomplete compact bundle');
 return bundle;
}
/** Attach only in memory; serialized worker jobs carry the requested group. */
export function attachCompactBundles(manifest){
 if(!manifest.bundles)return;
 if(manifest.bundles.version!==1||!Array.isArray(manifest.bundles.groups)||manifest.bundles.groups.length>16384)throw Error('Invalid compact bundle index');
 const refs=new Map((manifest.physicalResources||[]).map(ref=>[ref.path,ref])),byPath=new Map();
 for(const group of manifest.bundles.groups){validateCompactBundle(group);const physical=refs.get(group.resource.path);if(!physical||physical.hash!==group.resource.hash||physical.decodedHash!==group.resource.decodedHash)throw Error('Undeclared compact bundle');for(const entry of group.entries){const original=refs.get(entry.path);if(!original||original.decodedHash!==entry.decodedHash||byPath.has(entry.path))throw Error('Conflicting compact bundle entry');byPath.set(entry.path,group);}}
 const visit=value=>{if(!value||typeof value!=='object')return;if(value.path&&value.decodedHash){const group=byPath.get(value.path);if(group){if(group.entries.find(e=>e.path===value.path).decodedHash!==value.decodedHash)throw Error('Compact bundle identity differs');value.bundle=group;}return;}for(const [name,child] of Object.entries(value))if(name!=='bundles')visit(child);};
 visit(manifest);
}
async function cached(cache,entry,signal){
 const response=await cache.match(key(entry)).catch(()=>null);if(!response)return null;
 let bytes;try{bytes=await (response.headers.get('X-Foxhole-Compression')==='gzip'?new Response(response.body.pipeThrough(new DecompressionStream('gzip'))):response).arrayBuffer();}catch{signal?.throwIfAborted();return null;}
 signal?.throwIfAborted();return bytes.byteLength===entry.bytes&&await digest(bytes)===entry.decodedHash?bytes:null;
}
async function bounded(response,maximum,signal){
 const chunks=[];let size=0;
 try{for await(const chunk of response.body??[]){signal.throwIfAborted();size+=chunk.length;if(size>maximum)throw new CompactBundleError('Compact bundle exceeds decoded bound');chunks.push(chunk);}}
 finally{void response.body?.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
/** A cross-worker lock protects fan-out. Only verified per-asset bodies persist. */
export async function readCompactBundle(base,ref,{cache,signal,fetcher=fetch,metrics,onNetwork,locks=globalThis.navigator?.locks}={}){
 signal?.throwIfAborted();
 const bundle=validateCompactBundle(ref.bundle),entry=bundle.entries.find(e=>e.path===ref.path&&e.decodedHash===ref.decodedHash);
 if(!entry)throw Error('Resource absent from compact bundle');
 let active=flights.get(cache);if(!active){active=new Map();flights.set(cache,active);}
 const url=new URL(bundle.resource.path,base).href;let record=active.get(url);
 if(!record){
  record={waiters:0,settled:false,controller:new AbortController(),observers:new Set()};const ownedSignal=record.controller.signal;
  const load=async()=>{
   ownedSignal.throwIfAborted();
   // Another worker may already have seeded this group while we waited.
   if(await cached(cache,entry,ownedSignal))return null;
   const ticket=observe.start(url);let response;try{response=await fetcher(url,{signal:ownedSignal});}catch(error){observe.finish(ticket,false);ownedSignal.throwIfAborted();if(error?.name==='TypeError'||error?.name==='NetworkError')throw new CompactBundleError('Compact bundle unavailable',{cause:error});throw error;}
   if(!response.ok){void response.body?.cancel().catch(()=>{});throw new CompactBundleError('Compact bundle HTTP '+response.status);}
   let bytes;
   try{bytes=await bounded(response,bundle.resource.decodedBytes,ownedSignal);}finally{const event=observe.finish(ticket);if(event){record.observation=event;for(const fn of record.observers)try{fn(event);}catch{}}}
   if(bytes.byteLength!==bundle.resource.decodedBytes||await digest(bytes)!==bundle.resource.decodedHash)throw new CompactBundleError('Compact bundle integrity failure');
   for(const e of bundle.entries){ownedSignal.throwIfAborted();if(await digest(bytes.subarray(e.offset,e.offset+e.bytes))!==e.decodedHash)throw new CompactBundleError('Compact bundle entry integrity failure');}
   if(metrics){metrics.downloadBytes=(metrics.downloadBytes||0)+bundle.resource.bytes;metrics.bundleRequests=(metrics.bundleRequests||0)+1;metrics.bundleBytes=(metrics.bundleBytes||0)+bundle.resource.bytes;}
   // Complete each bounded batch before acknowledging cancellation or disposal.
   for(let at=0;at<bundle.entries.length;at+=16){ownedSignal.throwIfAborted();const results=await Promise.allSettled(bundle.entries.slice(at,at+16).map(async e=>{
    if(await cached(cache,e,ownedSignal))return;
    const slice=bytes.subarray(e.offset,e.offset+e.bytes),body=e.encoding==='br'?new Response(boundedByteStream(slice).pipeThrough(new CompressionStream('gzip')),{headers:{'X-Foxhole-Compression':'gzip'}}):new Response(boundedByteStream(slice));
    const stored=await cache.put(key(e),body);if(stored===false)throw Error('Bundle cache budget exhausted');
   }));if(metrics)metrics.cacheWriteFailures=(metrics.cacheWriteFailures||0)+results.filter(r=>r.status==='rejected').length;}
   return bytes;
  };
  record.task=(locks?locks.request('foxhole-world-bundle:'+bundle.resource.decodedHash,{signal:ownedSignal},load):load()).finally(()=>{record.settled=true;if(active.get(url)===record)active.delete(url);});
  active.set(url,record);
 }
 signal?.throwIfAborted();record.waiters++;const observer=onNetwork?value=>{if(!signal?.aborted)onNetwork(value);}:null;if(observer){record.observers.add(observer);if(record.observation)observer(record.observation);}
 let abort;
 try{
  const bytes=await (signal?new Promise((resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();record.task.then(resolve,reject);}):record.task);signal?.throwIfAborted();
  const value=await cached(cache,entry,signal);if(value){if(metrics){const field=bytes?'cacheMisses':'cacheHits';metrics[field]=(metrics[field]||0)+1;}return value;}
  if(bytes)return bytes.slice(entry.offset,entry.offset+entry.bytes).buffer;
  throw new CompactBundleError('Compact bundle cache unavailable');
 }finally{
  if(abort)signal.removeEventListener('abort',abort);if(observer)record.observers.delete(observer);record.waiters--;
  if(!record.waiters&&!record.settled){if(active.get(url)===record)active.delete(url);record.controller.abort();await record.task.catch(()=>{});}
 }
}
