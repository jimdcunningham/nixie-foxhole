import {planes,clipPolygon} from './terrain-tools.mjs';
export const hex=[-1092,0,-546,945,546,945,1092,0,546,-945,-546,-945];
export function transform(v,m){const x=v[0],y=v[1],z=v[2];return [m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];}
export function bounds(vertices){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const v of vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],v[i]);max[i]=Math.max(max[i],v[i]);}return{min,max};}
const classifyCorners=new Float64Array(24);
export function classify(box,m){
 // Evaluate the same eight corners without allocating transformed points and
 // seven temporary distance arrays for every instance and native LOD.
 const x0=box.min[0],x1=box.max[0],y0=box.min[1],y1=box.max[1],z0=box.min[2],z1=box.max[2];
 let crossing=false,allBelow=true;
 const values=classifyCorners;let at=0;
 for(let xi=0;xi<2;xi++)for(let yi=0;yi<2;yi++)for(let zi=0;zi<2;zi++){
  const x=xi?x1:x0,y=yi?y1:y0,z=zi?z1:z0;
  values[at++]=m[0]*x+m[4]*y+m[8]*z+m[12];
  const height=m[1]*x+m[5]*y+m[9]*z+m[13];values[at++]=height;
  values[at++]=m[2]*x+m[6]*y+m[10]*z+m[14];
  if(!(height<-220))allBelow=false;if(height<-220)crossing=true;
 }
 if(allBelow)return 'outside';
 for(const [a,b,c]of planes){let min=Infinity,max=-Infinity;for(let i=0;i<24;i+=3){const d=a*values[i]+b*values[i+2]-c;min=Math.min(min,d);max=Math.max(max,d);}if(min>1e-5)return 'outside';if(max>-1e-5)crossing=true;}
 return crossing?'crossing':'inside';
}
// Keep shared source indices and attribute seams. Clipping intersections remain
// triangle-local; no approximate position weld can change normals or UVs.
export function clipWorld(vertices,indices,m){
 const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
 const world=vertices.map(v=>{
  const x=v[0],y=v[1],z=v[2],nx=((e*i-f*h)*v[3]+(f*g-d*i)*v[4]+(d*h-e*g)*v[5])/det,ny=((c*h-b*i)*v[3]+(a*i-c*g)*v[4]+(b*g-a*h)*v[5])/det,nz=((b*f-c*e)*v[3]+(c*d-a*f)*v[4]+(a*e-b*d)*v[5])/det,len=Math.max(1e-12,Math.hypot(nx,ny,nz)),out=new Array(v.length);
  out[0]=m[0]*x+m[4]*y+m[8]*z+m[12];out[1]=m[1]*x+m[5]*y+m[9]*z+m[13];out[2]=m[2]*x+m[6]*y+m[10]*z+m[14];out[3]=nx/len;out[4]=ny/len;out[5]=nz/len;for(let k=6;k<v.length;k++)out[k]=v[k];return out;
 }),out=[],ix=[],remap=new Map();
 const emit=v=>{let id=remap.get(v);if(id===undefined){id=out.length;remap.set(v,id);out.push(v);}return id;};
 for(let k=0;k<indices.length;k+=3){
  const p=world[indices[k]],q=world[indices[k+1]],r=world[indices[k+2]];let inside=p[1]>=-220&&q[1]>=-220&&r[1]>=-220;
  if(inside)for(const [a,b,c]of planes)if(a*p[0]+b*p[2]-c>0||a*q[0]+b*q[2]-c>0||a*r[0]+b*r[2]-c>0){inside=false;break;}
  if(inside){ix.push(emit(p),emit(q),emit(r));continue;}
  let poly=[p,q,r];for(const plane of planes){poly=clipPolygon(poly,plane);if(poly.length<3)break;}
  if(poly.length>=3){const clipped=[];for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],da=a[1]-(-220),db=b[1]-(-220);if(da>=0)clipped.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db),v=a.map((x,k)=>x+(b[k]-x)*t);v[1]=-220;clipped.push(v);}}poly=clipped;}
  if(poly.length<3)continue;const first=emit(poly[0]);for(let j=1;j<poly.length-1;j++)ix.push(first,emit(poly[j]),emit(poly[j+1]));
 }
 if(det<0)for(let k=0;k<ix.length;k+=3){const value=ix[k+1];ix[k+1]=ix[k+2];ix[k+2]=value;}
 return{vertices:out,indices:new Uint32Array(ix)};
}
