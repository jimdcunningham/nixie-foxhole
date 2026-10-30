// Compression reads the caller-owned buffer in bounded views. Callers must
// await all readers before handing that buffer back for mutation or transfer.
export function boundedByteStream(input){
 const bytes=input instanceof Uint8Array?input:ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);
 let offset=0;const chunkBytes=256*1024;
 return new ReadableStream({pull(controller){
  if(offset===bytes.byteLength){controller.close();return;}
  const end=Math.min(offset+chunkBytes,bytes.byteLength);controller.enqueue(bytes.subarray(offset,end));offset=end;
 }},{highWaterMark:0});
}
