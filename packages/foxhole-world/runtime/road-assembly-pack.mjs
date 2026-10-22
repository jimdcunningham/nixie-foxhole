// Version this cache key whenever bridge clipping, shoulder generation or road
// partitioning changes. Only finished, rendered Float32/Uint32 data is retained.
export function packRoadAssembly(value){
 const arrays=[],offsets=[];let size=0;
 const header=new TextEncoder().encode(JSON.stringify(value,(_,v)=>{
  if(v instanceof Float32Array||v instanceof Uint32Array){const index=arrays.length;arrays.push(new Uint8Array(v.buffer,v.byteOffset,v.byteLength));offsets.push(size);size+=v.byteLength;return {$roadArray:index,type:v instanceof Float32Array?'f32':'u32',length:v.length};}return v;
 }));
 const start=(4+header.length+3)&~3,out=new ArrayBuffer(start+size),bytes=new Uint8Array(out);new DataView(out).setUint32(0,header.length,true);bytes.set(header,4);
 for(let i=0;i<arrays.length;i++)bytes.set(arrays[i],start+offsets[i]);return out;
}
export function unpackRoadAssembly(buffer){
 if(buffer.byteLength<4)throw Error('Invalid road assembly cache');
 const size=new DataView(buffer).getUint32(0,true),start=(4+size+3)&~3;if(start>buffer.byteLength)throw Error('Invalid road assembly header');
 let offset=start,index=0;
 const out=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,size)),(_,v)=>{
  if(v&&Object.hasOwn(v,'$roadArray')){if(v.$roadArray!==index++||!Number.isSafeInteger(v.length)||v.length<0||offset+v.length*4>buffer.byteLength||!['f32','u32'].includes(v.type))throw Error('Invalid road assembly array');const data=new (v.type==='f32'?Float32Array:Uint32Array)(buffer,offset,v.length);offset+=v.length*4;return data;}return v;
 });
 if(offset!==buffer.byteLength||out.version!==1||!Array.isArray(out.chunks))throw Error('Invalid road assembly payload');return out;
}
export function snapshotRoadGroups(groups){return [...groups].map(([key,g])=>[key,{join:g.join?{a:g.join.a,b:g.join.b}:null,p:new Float32Array(g.p),n:new Float32Array(g.n),uv:new Float32Array(g.uv),...(g.join?{extra:new Float32Array(g.extra),native:new Float32Array(g.native)}:{}),ix:new Uint32Array(g.ix)}]);}
