const views=new WeakMap(),floats=new WeakMap(),signed=new WeakMap(),unsigned=new WeakMap(),octets=new WeakMap();
const littleEndian=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;
export function attributeReader(g,name,count,fallback){
 const a=g.attributes[name];if(!a)return(i,k)=>fallback[k];
 const d=a.buffer.data,format=a.format||'',bits=format.startsWith('float32')?32:format.includes('16')?16:8,width=Number(format.at(-1)),stride=a.stride||width*bits/8,offset=a.offset||0;
 // Preserve the original Float32 values directly instead of decoding every
 // component through DataView while flattening millions of model vertices.
 if(littleEndian&&format.startsWith('float32')&&d.byteOffset%4===0&&stride%4===0&&offset%4===0){
  let values=floats.get(d);if(!values){values=new Float32Array(d.buffer,d.byteOffset,Math.floor(d.byteLength/4));floats.set(d,values);}
  const step=stride/4,start=offset/4;return(i,k)=>k>=width?fallback[k]:values[start+i*step+k];
 }
 if(littleEndian&&bits===16&&d.byteOffset%2===0&&stride%2===0&&offset%2===0&&(format.startsWith('snorm16')||format.startsWith('unorm16'))){
  const negative=format.startsWith('snorm'),cache=negative?signed:unsigned;let values=cache.get(d);
  if(!values){values=new (negative?Int16Array:Uint16Array)(d.buffer,d.byteOffset,Math.floor(d.byteLength/2));cache.set(d,values);}
  const step=stride/2,start=offset/2;
  return negative?(i,k)=>k>=width?fallback[k]:Math.max(-1,values[start+i*step+k]/32767):(i,k)=>k>=width?fallback[k]:values[start+i*step+k]/65535;
 }
 if(format.startsWith('unorm8')){
  let values=octets.get(d);if(!values){values=new Uint8Array(d.buffer,d.byteOffset,d.byteLength);octets.set(d,values);}
  return(i,k)=>k>=width?fallback[k]:values[offset+i*stride+k]/255;
 }
 let view=views.get(d);if(!view){view=new DataView(d.buffer,d.byteOffset,d.byteLength);views.set(d,view);}
 return(i,k)=>k>=width?fallback[k]:format.startsWith('float')?view.getFloat32(offset+i*stride+k*4,true):format.startsWith('snorm')?Math.max(-1,view.getInt16(offset+i*stride+k*2,true)/32767):bits===8?view.getUint8(offset+i*stride+k)/255:view.getUint16(offset+i*stride+k*2,true)/65535;
}
