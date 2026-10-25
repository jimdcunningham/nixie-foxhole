import {openRetainedWorldCache} from './cache-retention.mjs';
const sharedInflight=new Map(),ownedInflight=new WeakMap();
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const cacheName='foxhole-world-recipes-v1';
const defaultBudget=1024*1024*1024;

// v2 rebuilds shoulder heights/normals against the component-aware terrain sampler.
export function roadKey(base,hash){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid road assembly source hash');return new URL('assembled-roads-v2/'+hash+'.bin',base).href;}
export async function readCachedRoadAssembly(base,hash,{metrics,cachesApi=globalThis.caches}={}){
 let cache;try{cache=await openRetainedWorldCache(cacheName,{cachesApi});}catch{}const key=roadKey(base,hash),cached=await cache?.match(key).catch(()=>null);
 if(cached){try{const bytes=await new Response(cached.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(await digest(bytes)===cached.headers.get('X-Foxhole-Assembly-Hash')){if(metrics)metrics.roadAssemblyCacheHits=(metrics.roadAssemblyCacheHits||0)+1;return bytes;}}catch{}await cache.delete(key).catch(()=>{});}return null;
}
export async function writeCachedRoadAssembly(base,hash,bytes,{metrics,cachesApi=globalThis.caches,budget=defaultBudget}={}){
 let cache;try{cache=await openRetainedWorldCache(cacheName,{cachesApi});}catch{}if(!cache)return;
 try{const [compressed,outputHash]=await Promise.all([new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),digest(bytes)]);if(compressed.byteLength>budget)return;
  await (await openRetainedWorldCache(cacheName,{cachesApi,budget}))?.put(roadKey(base,hash),new Response(compressed,{headers:{'X-Foxhole-Recipe-Bytes':String(compressed.byteLength),'X-Foxhole-Assembly-Hash':outputHash}}));
 }catch{if(metrics)metrics.cacheWriteFailures=(metrics.cacheWriteFailures||0)+1;}
}

export function recipeKey(base,hash){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid recipe output hash');return new URL('derived-v1/'+hash+'.bin',base).href;}
export async function readCachedRecipe(base,hash,{metrics,cachesApi=globalThis.caches}={}){
 const key=recipeKey(base,hash);let cache;try{cache=await openRetainedWorldCache(cacheName,{cachesApi});}catch{}
 const cached=await cache?.match(key).catch(()=>null);
 if(cached){try{
  const bytes=await new Response(cached.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if(await digest(bytes)===hash){if(metrics)metrics.recipeCacheHits=(metrics.recipeCacheHits||0)+1;return bytes;}
 }catch{}await cache.delete(key).catch(()=>{});}
 return null;
}

/** Local derived data only: identical rendered buffers, no additional downloads. */
export async function cachedRecipe(base,hash,build,{signal,metrics,cachesApi=globalThis.caches,budget=defaultBudget}={}){
 const key=recipeKey(base,hash);
 signal?.throwIfAborted();
 let inflight=sharedInflight;if(signal){inflight=ownedInflight.get(signal);if(!inflight){inflight=new Map();ownedInflight.set(signal,inflight);}}
 let pending=inflight.get(key);
 if(!pending){pending=(async()=>{
  let cache;try{cache=await openRetainedWorldCache(cacheName,{cachesApi});}catch{}
  const cached=await readCachedRecipe(base,hash,{metrics,cachesApi});if(cached)return cached;
  if(metrics)metrics.recipeCacheMisses=(metrics.recipeCacheMisses||0)+1;
  const bytes=await build();
  if(await digest(bytes)!==hash)throw Error('Recipe output integrity failure');
  signal?.throwIfAborted();
  if(cache){try{
   const compressed=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
   if(compressed.byteLength<=budget){
    const stored=await (await openRetainedWorldCache(cacheName,{cachesApi,budget}))?.put(key,new Response(compressed,{headers:{'X-Foxhole-Recipe-Bytes':String(compressed.byteLength)}}));
    if(stored&&metrics)metrics.recipeCacheWrittenBytes=(metrics.recipeCacheWrittenBytes||0)+compressed.byteLength;
   }
  }catch{if(metrics)metrics.cacheWriteFailures=(metrics.cacheWriteFailures||0)+1;}}
  return bytes;
 })().finally(()=>inflight.delete(key));inflight.set(key,pending);}
 const bytes=await pending;signal?.throwIfAborted();return bytes;
}
