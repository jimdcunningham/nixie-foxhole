import {openRetainedWorldCache} from './cache-retention.mjs';
import {boundedByteStream} from './bounded-byte-stream.mjs';
// Browser-only derived pixels. The key includes the exact encoded source hash
// and decoder version; delivery assets and their encoded bytes never change.
const cacheName='foxhole-world-terrain-pixels-v1';
const defaultBudget=1024*1024*1024;
// A cache hit stays off the mutation lock. Coalesce access renewals so that
// simultaneous texture reads do not delay decoding or queue one lock per slice.
const renewals=new WeakMap();
function renewUsage(cache,key){
 let pending=renewals.get(cache);
 if(!pending){pending=new Set();renewals.set(cache,pending);setTimeout(()=>{renewals.delete(cache);void cache.touch(pending).catch(()=>{});},50);}
 pending.add(key);
}
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export const terrainPixelByteStream=boundedByteStream;

export async function cachedTerrainPixels(base,slice,build,{metrics,cachesApi=globalThis.caches,budget=defaultBudget,variant='jsquash-v1',signal}={}){
 signal?.throwIfAborted();
 const hash=slice.resource?.decodedHash;
 if(!/^[a-f0-9]{64}$/.test(hash||''))return build();
 const key=new URL(`decoded-rgba-${variant}/${hash}/${slice.width}x${slice.height}.bin`,base).href;
 const expected=slice.width*slice.height*4;let cache,retained;
 try{[cache,retained]=await Promise.all([cachesApi?.open(cacheName),openRetainedWorldCache(cacheName,{cachesApi,budget})]);}catch{}
 const cached=await cache?.match(key).catch(()=>null);
 if(signal?.aborted){void cached?.body?.cancel().catch(()=>{});throw signal.reason;}
 if(cached){try{
  const bytes=await new Response(cached.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  signal?.throwIfAborted();
  const valid=bytes.byteLength===expected&&await digest(bytes)===cached.headers.get('X-Foxhole-Pixel-Hash');
  signal?.throwIfAborted();
  if(valid){
   if(metrics)metrics.textureCacheHits=(metrics.textureCacheHits||0)+1;
   if(retained)renewUsage(retained,key);
   return {bytes:new Uint8Array(bytes),width:slice.width,height:slice.height};
  }
 }catch(error){if(signal?.aborted)throw signal.reason;}signal?.throwIfAborted();await (retained?retained.delete(key):cache.delete(key)).catch(()=>{});signal?.throwIfAborted();}
 if(metrics)metrics.textureCacheMisses=(metrics.textureCacheMisses||0)+1;
 const decoded=await build();
 signal?.throwIfAborted();
 if(decoded.width!==slice.width||decoded.height!==slice.height||decoded.bytes.byteLength!==expected)throw Error('Terrain dimensions changed');
 if(cache)try{
  // Both tasks may still be reading the owned pixels if either fails. Drain
  // them before returning that buffer to a caller that may mutate or transfer it.
  const results=await Promise.allSettled([new Response(terrainPixelByteStream(decoded.bytes).pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),digest(decoded.bytes)]);
  signal?.throwIfAborted();
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  const [compressed,pixelHash]=results.map(result=>result.value);
  if(compressed.byteLength<=budget){
   const stored=await retained?.put(key,new Response(compressed,{headers:{'X-Foxhole-Pixel-Hash':pixelHash,'X-Foxhole-Pixel-Bytes':String(compressed.byteLength)}}));
   if(stored&&metrics)metrics.textureCacheWrittenBytes=(metrics.textureCacheWrittenBytes||0)+compressed.byteLength;
  }
 }catch(error){if(signal?.aborted)throw signal.reason;if(metrics)metrics.cacheWriteFailures=(metrics.cacheWriteFailures||0)+1;}
 signal?.throwIfAborted();
 return decoded;
}
