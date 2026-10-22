import {BufferImageSource} from 'pixi.js';
import {TERRAIN_TEXTURE_TIERS,terrainMipBytes} from './terrain-texture-quality.mjs';
const pools=new WeakMap();let fallback;
export function terrainTexturePoolFor(renderer){if(!renderer)return fallback??=createTerrainTexturePool();let pool=pools.get(renderer);if(!pool){pool=createTerrainTexturePool();pools.set(renderer,pool);}return pool;}
export function terrainTextureLayout(descriptor,cap){
 const {entry,kind}=descriptor;const limit=kind==='weights'?(cap<=256?512:cap<=512?1024:Infinity):cap;
 const width=kind==='weights'?descriptor.width:entry.size,height=kind==='weights'?descriptor.height:entry.size,layers=kind==='weights'?descriptor.layers:entry.slices.length;
 const scale=Math.min(1,limit/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)),format=kind==='weights'?'r8unorm':kind==='color'?'rgba8unorm-srgb':'rgba8unorm',channels=kind==='weights'?1:4;
 const identity=kind==='weights'?[entry.resource.decodedHash||entry.resource.hash]:entry.slices.map(s=>s.resource?.decodedHash||s.resource?.hash||s.blob);
 return {width:w,height:h,layers,format,maxSize:limit,bytes:terrainMipBytes(w,h,layers,channels),key:JSON.stringify(['terrain-area-v1',descriptor.baseUrl,kind,width,height,w,h,layers,identity])};
}
/** Reference-counted source ownership. The budget includes reservations and mipmaps. */
export function createTerrainTexturePool({budget=2*1024**3,createSource=options=>new BufferImageSource(options),decode}={}){
 const records=new Map();let usedBytes=0,hits=0,loads=0,worker,serial=0,active=0,sequence=Promise.resolve();const pending=new Map(),jobs=[];
 function stopWorker(){if(worker&&!active&&!jobs.length){worker.terminate();worker=null;}}
 function runWorker(data){if(!worker){worker=new Worker(new URL('../authoring/decode-worker.mjs',import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(data.kind==='foxhole-worker-ready')return;const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message||'Terrain decoder failed'));pending.clear();worker?.terminate();worker=null;};}
  return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({...data,id});});}
 function pump(){while(active<2&&jobs.length){active++;const job=jobs.shift();Promise.resolve().then(job.build).then(job.resolve,job.reject).finally(()=>{active--;pump();stopWorker();});}}
 const work=build=>new Promise((resolve,reject)=>{jobs.push({build,resolve,reject});pump();});
 const load=decode||((descriptor,layout)=>work(()=>runWorker(descriptor.kind==='weights'?{kind:'weights',entry:descriptor.entry,baseUrl:descriptor.baseUrl,width:descriptor.width,height:descriptor.height,layers:descriptor.layers,maxSize:layout.maxSize}:{kind:'array',entry:descriptor.entry,baseUrl:descriptor.baseUrl,maxSize:layout.width,normal:descriptor.kind==='normal',sliceUrls:descriptor.entry.slices.map(s=>new URL(s.resource.path,descriptor.baseUrl).href)})));
 function free(record){if(!record.accounted)return;record.accounted=false;usedBytes-=record.layout.bytes;if(records.get(record.layout.key)===record)records.delete(record.layout.key);record.source?.destroy();}
 function release(record){record.refs--;if(!record.refs)free(record);}
 return {
  get stats(){return {usedBytes,budget,arrays:records.size,hits,loads,pending:active+jobs.length};},
  schedule(build){const task=sequence.then(build);sequence=task.catch(()=>{});return task;},
  async acquire(descriptors,wanted,{signal}={}){
   signal?.throwIfAborted();let cap,layouts;
   for(const candidate of TERRAIN_TEXTURE_TIERS.filter(t=>t<=wanted).reverse()){
    const rows=descriptors.map(d=>terrainTextureLayout(d,candidate)),extra=new Map();for(const layout of rows)if(!records.has(layout.key))extra.set(layout.key,layout.bytes);
    if(usedBytes+[...extra.values()].reduce((a,b)=>a+b,0)<=budget){cap=candidate;layouts=rows;break;}
   }
   if(!layouts)throw Error('Terrain texture budget exhausted');
   const leases=[];
   for(let i=0;i<descriptors.length;i++){
    const descriptor=descriptors[i],layout=layouts[i];let record=records.get(layout.key);
    if(record)hits++;else{
     loads++;record={layout,refs:0,accounted:true};records.set(layout.key,record);usedBytes+=layout.bytes;
     record.promise=Promise.resolve().then(()=>load(descriptor,layout)).then(buffer=>{
      const channels=layout.format==='r8unorm'?1:4;if(buffer.byteLength!==layout.width*layout.height*layout.layers*channels)throw Error('Terrain texture size mismatch');
      const source=createSource({resource:new Uint8Array(buffer),width:layout.width,height:layout.height,arrayLayerCount:layout.layers,viewDimension:'2d-array',format:layout.format,alphaMode:'no-premultiply-alpha',autoGenerateMipmaps:true,scaleMode:'linear',mipmapFilter:'linear',addressMode:descriptor.kind==='weights'?'clamp-to-edge':'repeat',maxAnisotropy:16});record.source=source;if(!record.accounted)source.destroy();return source;
     }).catch(error=>{free(record);throw error;});
    }
    record.refs++;leases.push(record);
   }
   let released=false;const releaseAll=()=>{if(released)return;released=true;for(const record of leases)release(record);};
   try{const settled=await Promise.allSettled(leases.map(record=>record.promise));const failed=settled.find(s=>s.status==='rejected');if(failed)throw failed.reason;signal?.throwIfAborted();return {cap,sources:settled.map(s=>s.value),layouts,release:releaseAll};}catch(error){releaseAll();throw error;}
  },
 };
}
