export function encodeWordPlanar(bytes,delta=0){
 if(bytes.byteLength%4)throw Error('Word-planar input must contain whole 32-bit words');const src=new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),n=src.length,out=new Uint8Array(bytes.byteLength);
 for(let i=0;i<n;i++){const v=(src[i]-(delta&&i>=delta?src[i-delta]:0))>>>0;out[i]=v&255;out[n+i]=(v>>>8)&255;out[n*2+i]=(v>>>16)&255;out[n*3+i]=v>>>24;}return out;
}
export function decodeWordPlanar(bytes,delta=0){
 if(bytes.byteLength%4)throw Error('Word-planar data must contain whole 32-bit words');const n=bytes.byteLength/4,out=new Uint32Array(n);
 for(let i=0;i<n;i++){const v=(bytes[i]|bytes[n+i]<<8|bytes[n*2+i]<<16|bytes[n*3+i]<<24)>>>0;out[i]=(v+(delta&&i>=delta?out[i-delta]:0))>>>0;}return out.buffer;
}
