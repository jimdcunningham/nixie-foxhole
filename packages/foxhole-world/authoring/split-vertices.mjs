/** Copy the native interleaved layout without allocating three views per vertex. */
export function splitVertices(vertices,offset,count){
 const p=new Float32Array(count*3),n=new Float32Array(p.length),uv=new Float32Array(count*2);
 for(let i=0,at=offset*8;i<count;i++,at+=8){
  const j=i*3,k=i*2;
  p[j]=vertices[at];p[j+1]=vertices[at+1];p[j+2]=vertices[at+2];
  n[j]=vertices[at+3];n[j+1]=vertices[at+4];n[j+2]=vertices[at+5];
  uv[k]=vertices[at+6];uv[k+1]=vertices[at+7];
 }
 return {p,n,uv};
}
