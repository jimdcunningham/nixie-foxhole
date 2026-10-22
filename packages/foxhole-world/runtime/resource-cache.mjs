const inflight=new Map();
export const WORLD_CACHE_NAME='foxhole-render-ready-v1';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

/** Immutable encoded resources survive GPU disposal and region changes. */
export async function loadBakedResource(base,resource,{signal,fetcher=fetch,cachesApi=globalThis.caches,metrics}={}){
 if(resource.pack){
  if(!Number.isSafeInteger(resource.offset)||resource.offset<0||!Number.isSafeInteger(resource.bytes)||resource.offset+resource.bytes>resource.pack.bytes)throw Error('Invalid packed resource range');
  const bytes=await loadBakedResource(base,resource.pack,{signal,fetcher,cachesApi,metrics});return bytes.slice(resource.offset,resource.offset+resource.bytes);
 }
 if(!/^(?:blobs\/[a-f0-9]{64}\.(?:bin\.gz|json\.gz|webp|png)|packs\/[a-f0-9]{64}\.bin)$/.test(resource.path)||!resource.path.includes(resource.hash))throw Error('Invalid baked resource reference');
 signal?.throwIfAborted();
 const url=new URL(resource.path,base).href;
 let request=inflight.get(url);
 if(!request){
  request=(async()=>{
   let cache;try{cache=await cachesApi?.open(WORLD_CACHE_NAME);}catch{}
   const cached=await cache?.match(url).catch(()=>null);
   if(cached){const bytes=await cached.arrayBuffer();if(bytes.byteLength===resource.bytes&&await digest(bytes)===resource.hash){if(metrics)metrics.cacheHits++;return bytes;}await cache.delete(url).catch(()=>{});}
   const response=await fetcher(url);if(!response.ok)throw Error('Region resource download failed ('+response.status+')');
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength!==resource.bytes||await digest(bytes)!==resource.hash)throw Error('Region resource integrity check failed');
   if(metrics){metrics.downloadBytes+=bytes.byteLength;metrics.cacheMisses++;}
   try{await cache?.put(url,new Response(bytes,{headers:{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream'}}));}catch{if(metrics)metrics.cacheWriteFailures++;}
   return bytes;
  })().finally(()=>inflight.delete(url));inflight.set(url,request);
 }
 const result=await request;signal?.throwIfAborted();return result;
}

export async function decompressBakedBytes(buffer){
 return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
