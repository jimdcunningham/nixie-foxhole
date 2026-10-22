// Query the actual landscape triangles, including offset/scaled components and
// overlapping landscapes. Rounding every vertex onto one metre grid loses both
// the component origin and which surface is visible at a given position.
export function terrainSurfaceSampler(meta, source) {
 const bins = new Map(), cellSize = 64;
 for (const component of meta.components) {
  const {size, offset} = component;
  if (size < 2) continue;
  const start = offset * 3, last = size - 1;
  const ox = source[start], oz = source[start + 2];
  const ux = (source[start + last * 3] - ox) / last;
  const uz = (source[start + last * 3 + 2] - oz) / last;
  const vx = (source[start + last * size * 3] - ox) / last;
  const vz = (source[start + last * size * 3 + 2] - oz) / last;
  const determinant = ux * vz - uz * vx;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw Error('Degenerate landscape component: ' + component.name);
  const descriptor = {size, start, last, ox, oz, ux, uz, vx, vz, determinant};
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity,warped=false;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const at=start+(y*size+x)*3,px=source[at],pz=source[at+2];
   minX=Math.min(minX,px);maxX=Math.max(maxX,px);minZ=Math.min(minZ,pz);maxZ=Math.max(maxZ,pz);
   if(Math.abs(px-(ox+ux*x+vx*y))>0.00025||Math.abs(pz-(oz+uz*x+vz*y))>0.00025)warped=true;
  }
  // A pitched/rolled landscape projects height into XZ too. Only these uncommon
  // components need a cell index and exact barycentric queries in world XZ.
  if(warped){
   descriptor.cells=new Map();
   for(let y=0;y<last;y++)for(let x=0;x<last;x++){
    const a=start+(y*size+x)*3,b=a+3,d=a+size*3,e=d+3;
    const minBX=Math.floor(Math.min(source[a],source[b],source[d],source[e])/4),maxBX=Math.floor(Math.max(source[a],source[b],source[d],source[e])/4);
    const minBZ=Math.floor(Math.min(source[a+2],source[b+2],source[d+2],source[e+2])/4),maxBZ=Math.floor(Math.max(source[a+2],source[b+2],source[d+2],source[e+2])/4);
    for(let bz=minBZ;bz<=maxBZ;bz++)for(let bx=minBX;bx<=maxBX;bx++){
     const key=bx+bz*65536,bucket=descriptor.cells.get(key);if(bucket)bucket.push(a);else descriptor.cells.set(key,[a]);
    }
   }
  }
  for (let z = Math.floor(minZ / cellSize); z <= Math.floor(maxZ / cellSize); z++) {
   for (let x = Math.floor(minX / cellSize); x <= Math.floor(maxX / cellSize); x++) {
    const key = x + z * 65536, bucket = bins.get(key);
    if (bucket) bucket.push(descriptor); else bins.set(key, [descriptor]);
   }
  }
 }
 return (x, z) => {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const candidates = bins.get(Math.floor(x / cellSize) + Math.floor(z / cellSize) * 65536);
  let highest = -Infinity;
  for (const c of candidates || []) {
   if(c.cells){
    for(const a of c.cells.get(Math.floor(x/4)+Math.floor(z/4)*65536)||[]){
     const b=a+3,d=a+c.size*3,e=d+3;
     highest=Math.max(highest,triangleHeight(source,a,b,d,x,z),triangleHeight(source,b,e,d,x,z));
    }
    continue;
   }
   const dx = x - c.ox, dz = z - c.oz;
   let gx = (dx * c.vz - dz * c.vx) / c.determinant;
   let gy = (dz * c.ux - dx * c.uz) / c.determinant;
   // Source coordinates are Float32; tolerate only their boundary roundoff.
   if (gx < -0.0005 || gy < -0.0005 || gx > c.last + 0.0005 || gy > c.last + 0.0005) continue;
   gx = Math.max(0, Math.min(c.last, gx)); gy = Math.max(0, Math.min(c.last, gy));
   const ix = Math.min(c.last - 1, Math.floor(gx)), iy = Math.min(c.last - 1, Math.floor(gy));
   const fx = gx - ix, fy = gy - iy, a = c.start + (iy * c.size + ix) * 3;
   const h0 = source[a + 1], h1 = source[a + 4], h2 = source[a + c.size * 3 + 1], h3 = source[a + (c.size + 1) * 3 + 1];
   const height = fx + fy <= 1
    ? h0 * (1 - fx - fy) + h1 * fx + h2 * fy
    : h1 * (1 - fy) + h3 * (fx + fy - 1) + h2 * (1 - fx);
   highest = Math.max(highest, height);
  }
  return Number.isFinite(highest) ? highest : null;
 };
}

function triangleHeight(source,a,b,c,x,z){
 const ux=source[b]-source[a],uz=source[b+2]-source[a+2],vx=source[c]-source[a],vz=source[c+2]-source[a+2],dx=x-source[a],dz=z-source[a+2];
 const det=ux*vz-uz*vx;if(Math.abs(det)<1e-12)return -Infinity;
 const u=(dx*vz-dz*vx)/det,v=(dz*ux-dx*uz)/det;
 if(u<-1e-7||v<-1e-7||u+v>1+1e-7)return -Infinity;
 return source[a+1]*(1-u-v)+source[b+1]*u+source[c+1]*v;
}
