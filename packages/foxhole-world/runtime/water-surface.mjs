/** Exact heights on the rendered water triangles, indexed in native metre/XZ space. */
export function waterSurfaceSampler(positions, indices) {
 const bins=new Map(),cellSize=64;
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  const ax=positions[a],az=positions[a+2],ux=positions[b]-ax,uz=positions[b+2]-az,vx=positions[c]-ax,vz=positions[c+2]-az;
  const determinant=ux*vz-uz*vx;if(!Number.isFinite(determinant)||Math.abs(determinant)<1e-12)continue;
  const triangle={a,b,c,ax,az,ux,uz,vx,vz,determinant};
  for(let z=Math.floor(Math.min(az,positions[b+2],positions[c+2])/cellSize);z<=Math.floor(Math.max(az,positions[b+2],positions[c+2])/cellSize);z++)
   for(let x=Math.floor(Math.min(ax,positions[b],positions[c])/cellSize);x<=Math.floor(Math.max(ax,positions[b],positions[c])/cellSize);x++){
    const key=x+','+z,bucket=bins.get(key);if(bucket)bucket.push(triangle);else bins.set(key,[triangle]);
   }
 }
 return(x,z)=>{
  if(!Number.isFinite(x)||!Number.isFinite(z))return null;
  let highest=-Infinity;
  for(const t of bins.get(Math.floor(x/cellSize)+','+Math.floor(z/cellSize))||[]){
   const dx=x-t.ax,dz=z-t.az,u=(dx*t.vz-dz*t.vx)/t.determinant,v=(dz*t.ux-dx*t.uz)/t.determinant;
   if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)highest=Math.max(highest,positions[t.a+1]*(1-u-v)+positions[t.b+1]*u+positions[t.c+1]*v);
  }
  return Number.isFinite(highest)?highest:null;
 };
}
