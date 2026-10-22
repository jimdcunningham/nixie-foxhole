const sharedInflight=new Map(),ownedInflight=new WeakMap();
let writes=Promise.resolve();
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const cacheName='foxhole-world-recipes-v1';
const defaultBudget=1024*1024*1024;

// v2 rebuilds shoulder heights/normals against the component-aware terrain sampler.
function roadKey(base,hash){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid road assembly source hash');return new URL('assembled-roads-v2/'+hash+'.bin',base).href;}
export async function readCachedRoadAssembly(base,hash,{metrics,cachesApi=globalThis.caches}={}){
 let cache;try{cache=await cachesApi?.open(cacheName);}catch{}const key=roadKey(base,hash),cached=await cache?.match(key).catch(()=>null);
 if(cached){try{const bytes=await new Response(cached.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(await digest(bytes)===cached.headers.get('X-Foxhole-Assembly-Hash')){if(metrics)metrics.roadAssemblyCacheHits=(metrics.roadAssemblyCacheHits||0)+1;return bytes;}}catch{}await cache.delete(key).catch(()=>{});}return null;
}
export async function writeCachedRoadAssembly(base,hash,bytes,{metrics,cachesApi=globalThis.caches,budget=defaultBudget}={}){
 let cache;try{cache=await cachesApi?.open(cacheName);}catch{}if(!cache)return;
 try{const [compressed,outputHash]=await Promise.all([new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),digest(bytes)]);if(compressed.byteLength>budget)return;
  const write=async()=>{const keys=await cache.keys(),sizes=await Promise.all(keys.map(async request=>Number((await cache.match(request))?.headers.get('X-Foxhole-Recipe-Bytes'))||0));let size=sizes.reduce((a,b)=>a+b,0)+compressed.byteLength;for(let i=0;size>budget&&i<keys.length;i++){await cache.delete(keys[i]);size-=sizes[i];}await cache.put(roadKey(base,hash),new Response(compressed,{headers:{'X-Foxhole-Recipe-Bytes':String(compressed.byteLength),'X-Foxhole-Assembly-Hash':outputHash}}));};
  const pending=writes.then(write);writes=pending.catch(()=>{});await pending;
 }catch{if(metrics)metrics.cacheWriteFailures=(metrics.cacheWriteFailures||0)+1;}
}

function recipeKey(base,hash){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid recipe output hash');return new URL('derived-v1/'+hash+'.bin',base).href;}
export async function readCachedRecipe(base,hash,{metrics,cachesApi=globalThis.caches}={}){
 const key=recipeKey(base,hash);let cache;try{cache=await cachesApi?.open(cacheName);}catch{}
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
  let cache;try{cache=await cachesApi?.open(cacheName);}catch{}
  const cached=await readCachedRecipe(base,hash,{metrics,cachesApi});if(cached)return cached;
  if(metrics)metrics.recipeCacheMisses=(metrics.recipeCacheMisses||0)+1;
  const bytes=await build();
  if(await digest(bytes)!==hash)throw Error('Recipe output integrity failure');
  signal?.throwIfAborted();
  if(cache){try{
   const compressed=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
   if(compressed.byteLength<=budget){
    const write=async()=>{
     const keys=await cache.keys(),sizes=await Promise.all(keys.map(async request=>Number((await cache.match(request))?.headers.get('X-Foxhole-Recipe-Bytes'))||0));
     let size=sizes.reduce((a,b)=>a+b,0)+compressed.byteLength;
     for(let i=0;size>budget&&i<keys.length;i++){await cache.delete(keys[i]);size-=sizes[i];}
     await cache.put(key,new Response(compressed,{headers:{'X-Foxhole-Recipe-Bytes':String(compressed.byteLength)}}));
     if(metrics)metrics.recipeCacheWrittenBytes=(metrics.recipeCacheWrittenBytes||0)+compressed.byteLength;
    };
    const queued=writes.then(write);writes=queued.catch(()=>{});await queued;
   }
  }catch{if(metrics)metrics.cacheWriteFailures=(metrics.cacheWriteFailures||0)+1;}}
  return bytes;
 })().finally(()=>inflight.delete(key));inflight.set(key,pending);}
 const bytes=await pending;signal?.throwIfAborted();return bytes;
}
