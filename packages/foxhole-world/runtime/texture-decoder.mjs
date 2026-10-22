export function createBakedTextureDecoder(){
 const worker=new Worker(new URL('./texture-worker.mjs',import.meta.url),{type:'module'}),pending=new Map();let next=0;
 worker.onmessage=({data})=>{const entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);if(data.error)entry.reject(Error(data.error));else entry.resolve(data);};
 worker.onerror=event=>{for(const entry of pending.values())entry.reject(Error(event.message));pending.clear();};
 return {decode(bytes,channels,pixelHash){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});worker.postMessage({id,bytes,channels,pixelHash},[bytes]);});},destroy(){worker.terminate();for(const entry of pending.values())entry.reject(new DOMException('Region disposed','AbortError'));pending.clear();}};
}
