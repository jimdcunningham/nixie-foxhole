// Browser-only derived pixels. The key includes the exact encoded source hash
// and decoder version; delivery assets and their encoded bytes never change.
const cacheName='foxhole-world-terrain-pixels-v1';
const defaultBudget=1024*1024*1024;
let writes=Promise.resolve();
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export async function cachedTerrainPixels(base,slice,build,{metrics,cachesApi=globalThis.caches,budget=defaultBudget,variant='jsquash-v1'}={}){
 const hash=slice.resource?.decodedHash;
 if(!/^[a-f0-9]{64}$/.test(hash||''))return build();
 const key=new URL(`decoded-rgba-${variant}/${hash}/${slice.width}x${slice.height}.bin`,base).href;
 const expected=slice.width*slice.height*4;let cache;
 try{cache=await cachesApi?.open(cacheName);}catch{}
 const cached=await cache?.match(key).catch(()=>null);
 if(cached){try{
  const bytes=await new Response(cached.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if(bytes.byteLength===expected&&await digest(bytes)===cached.headers.get('X-Foxhole-Pixel-Hash')){
   if(metrics)metrics.textureCacheHits=(metrics.textureCacheHits||0)+1;
   return {bytes:new Uint8Array(bytes),width:slice.width,height:slice.height};
  }
 }catch{}await cache.delete(key).catch(()=>{});}
 if(metrics)metrics.textureCacheMisses=(metrics.textureCacheMisses||0)+1;
 const decoded=await build();
 if(decoded.width!==slice.width||decoded.height!==slice.height||decoded.bytes.byteLength!==expected)throw Error('Terrain dimensions changed');
 if(cache)try{
  const [compressed,pixelHash]=await Promise.all([new Response(new Blob([decoded.bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),digest(decoded.bytes)]);
  if(compressed.byteLength<=budget){
   const write=async()=>{
    const keys=await cache.keys(),sizes=await Promise.all(keys.map(async request=>Number((await cache.match(request))?.headers.get('X-Foxhole-Pixel-Bytes'))||0));
    let size=sizes.reduce((a,b)=>a+b,0)+compressed.byteLength;
    for(let i=0;size>budget&&i<keys.length;i++){await cache.delete(keys[i]);size-=sizes[i];}
    await cache.put(key,new Response(compressed,{headers:{'X-Foxhole-Pixel-Hash':pixelHash,'X-Foxhole-Pixel-Bytes':String(compressed.byteLength)}}));
    if(metrics)metrics.textureCacheWrittenBytes=(metrics.textureCacheWrittenBytes||0)+compressed.byteLength;
   };
   const pending=writes.then(write);writes=pending.catch(()=>{});await pending;
  }
 }catch{if(metrics)metrics.cacheWriteFailures=(metrics.cacheWriteFailures||0)+1;}
 return decoded;
}
