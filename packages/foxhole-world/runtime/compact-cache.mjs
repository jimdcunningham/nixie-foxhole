const inflight=new Map();
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function fetchCompactResource(base,ref,{signal,metrics,fetcher=fetch,cachesApi=globalThis.caches}={}){
 if(!/^content\/(br|raw)\/[a-f0-9]{64}\/asset\.[a-z0-9]+$/.test(ref.path)||!ref.path.includes(ref.hash))throw Error('Invalid compact resource');
 signal?.throwIfAborted();const url=new URL(ref.path,base).href;
 let task=inflight.get(url);
 if(!task){task=(async()=>{
  let cache;try{cache=await cachesApi?.open('foxhole-world-compact-v1');}catch{}
  const cached=await cache?.match(url).catch(()=>null);
  if(cached){try{const bytes=await (cached.headers.get('X-Foxhole-Compression')==='gzip'?new Response(cached.body.pipeThrough(new DecompressionStream('gzip'))):cached).arrayBuffer();if(await hash(bytes)===ref.decodedHash){if(metrics)metrics.cacheHits++;return bytes;}}catch{}await cache.delete(url).catch(()=>{});}
  let response;try{response=await fetcher(url);}catch(error){throw new Error('Could not fetch world resource '+url,{cause:error});}if(!response.ok)throw Error('World resource '+response.status);
  const bytes=await response.arrayBuffer();if(await hash(bytes)!==ref.decodedHash)throw Error('World resource integrity failure; check Content-Encoding headers');
  if(metrics){metrics.cacheMisses++;metrics.downloadBytes+=ref.bytes;}
  try{await cache?.put(url,ref.encoding==='br'?new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),{headers:{'X-Foxhole-Compression':'gzip'}}):new Response(bytes));}catch{if(metrics)metrics.cacheWriteFailures++;}
  return bytes;
 })().finally(()=>inflight.delete(url));inflight.set(url,task);}
 const bytes=await task;signal?.throwIfAborted();return bytes;
}
