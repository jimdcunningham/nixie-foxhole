import {Geometry3D} from '@pixi/3d';
import {attributeReader} from './world-models.mjs';

/** Convex hull planes of the same transformed excavation prism used by the editor floor. */
export function excavationVolume(points){
 const planes=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const p of points)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
 for(let i=0;i<points.length-2;i++)for(let j=i+1;j<points.length-1;j++)for(let k=j+1;k<points.length;k++){
  const a=points[i],u=points[j].map((v,l)=>v-a[l]),v=points[k].map((v,l)=>v-a[l]);
  let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);if(length<1e-9)continue;
  n=n.map(v=>v/length);let d=-n.reduce((s,v,l)=>s+v*a[l],0),low=Infinity,high=-Infinity;
  for(const p of points){const q=n[0]*p[0]+n[1]*p[1]+n[2]*p[2]+d;low=Math.min(low,q);high=Math.max(high,q);}
  if(high>1e-5&&low< -1e-5)continue;
  if(high>1e-5){n=n.map(v=>-v);d=-d;}
  if(!planes.some(p=>Math.abs(p[0]-n[0])+Math.abs(p[1]-n[1])+Math.abs(p[2]-n[2])<1e-5&&Math.abs(p[3]-d)<1e-4))planes.push([...n,d]);
 }
 return {planes,min,max};
}

function split(polygon,plane){
 const inside=[],outside=[];
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length],da=plane[0]*a[0]+plane[1]*a[1]+plane[2]*a[2]+plane[3],db=plane[0]*b[0]+plane[1]*b[1]+plane[2]*b[2]+plane[3];
  (da<=0?inside:outside).push(a);
  if((da<=0)!==(db<=0)){const t=da/(da-db),p=a.map((v,k)=>v+(b[k]-v)*t);inside.push(p);outside.push(p);}
 }
 return {inside,outside};
}

export function subtractExcavation(polygon,volume){
 if(volume.planes.length<4||volume.min.some((v,k)=>polygon.every(p=>p[k]<v-1e-6))||volume.max.some((v,k)=>polygon.every(p=>p[k]>v+1e-6)))return [polygon];
 const fragments=[];let remaining=polygon;
 for(const plane of volume.planes){const cut=split(remaining,plane);if(cut.outside.length>=3)fragments.push(cut.outside);remaining=cut.inside;if(remaining.length<3)break;}
 return fragments;
}

/** Keep untouched terrain on its original buffers. Only occupied spatial tiles
 * get replacement triangles; moving a hole within those tiles never uploads the
 * large baseline index buffer again. No source positions or normals are reduced.
 */
export function createTerrainExcavations(geometry){
 const original=geometry.indexBuffer.data,p=geometry.attributes.aPosition.buffer.data,n=attributeReader(geometry,'aNormal',3,[0,1,0]),uv=geometry.attributes.aUV?.buffer.data;
 const extra=['aColor','aColor1'].filter(name=>geometry.attributes[name]).map(name=>({name,read:attributeReader(geometry,name,4,[0,0,0,0])}));
 let bins,mutable,selected=new Set(),key='',replacement=null;
 function index(){
  bins=new Map();
  for(let at=0;at<original.length;at+=3){const a=original[at]*3,b=original[at+1]*3,c=original[at+2]*3;
   const x0=Math.floor(Math.min(p[a],p[b],p[c])/32),x1=Math.floor(Math.max(p[a],p[b],p[c])/32),z0=Math.floor(Math.min(p[a+2],p[b+2],p[c+2])/32),z1=Math.floor(Math.max(p[a+2],p[b+2],p[c+2])/32);
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const k=x+z*65536,bucket=bins.get(k);if(bucket)bucket.push(at);else bins.set(k,[at]);}
  }
 }
 function release(){replacement?.destroy(true);replacement=null;}
 function set(points,prepared,nextKey=JSON.stringify(points)){
  if(key===nextKey)return false;
  const box=geometry.bounds3D;
  const volumes=(prepared||points.map(excavationVolume)).filter(v=>v.planes.length>=4&&v.min[0]<=box.max.x&&v.max[0]>=box.min.x&&v.min[1]<=box.max.y&&v.max[1]>=box.min.y&&v.min[2]<=box.max.z&&v.max[2]>=box.min.z),next=new Set();
  if(!volumes.length&&!selected.size){key=nextKey;return false;}
  if(volumes.length&&!bins)index();
  for(const v of volumes)for(let z=Math.floor(v.min[2]/32);z<=Math.floor(v.max[2]/32);z++)for(let x=Math.floor(v.min[0]/32);x<=Math.floor(v.max[0]/32);x++)for(const at of bins.get(x+z*65536)||[])next.add(at);
  const positions=[],normals=[],uvs=[],indices=[],extraData=extra.map(()=>[]);
  for(const at of next){
   let fragments=[[0,1,2].map(i=>{const id=original[at+i];return [p[id*3],p[id*3+1],p[id*3+2],n(id,0),n(id,1),n(id,2),...(uv?[uv[id*2],uv[id*2+1]]:[]),...extra.flatMap(e=>[0,1,2,3].map(k=>e.read(id,k)))];})];
   for(const v of volumes)fragments=fragments.flatMap(poly=>subtractExcavation(poly,v));
   for(const poly of fragments){const start=positions.length/3;for(const v of poly){positions.push(v[0],v[1],v[2]);normals.push(v[3],v[4],v[5]);if(uv)uvs.push(v[6],v[7]);for(let i=0;i<extra.length;i++){const at=6+(uv?2:0)+i*4;extraData[i].push(...v.slice(at,at+4));}}for(let i=1;i<poly.length-1;i++)indices.push(start,start+i,start+i+1);}
  }
  if(positions.length/3>2_000_000)throw Error('Terrain excavation exceeds the geometry budget');
  const extraOptions=Object.fromEntries(extra.map((e,i)=>[e.name==='aColor'?'colors':'colors1',new Float32Array(extraData[i])]));
  const newGeometry=next.size&&indices.length?new Geometry3D({positions:new Float32Array(positions),normals:new Float32Array(normals),...(uv?{uvs:new Float32Array(uvs)}:{}),...extraOptions,indices:new Uint32Array(indices),quantizeNormals:false}):null;
  if(next.size!==selected.size||[...next].some(at=>!selected.has(at))){
   if(!mutable&&next.size)mutable=original.slice();
   if(mutable){for(const at of selected)mutable.set(original.subarray(at,at+3),at);for(const at of next)mutable.fill(0,at,at+3);geometry.indexBuffer.data=next.size?mutable:original;geometry.indexBuffer.update();}
  }
  release();replacement=newGeometry;selected=next;key=nextKey;return true;
 }
 return {set,get geometry(){return replacement;},destroy(){release();if(!geometry.destroyed&&geometry.indexBuffer.data!==original){geometry.indexBuffer.data=original;geometry.indexBuffer.update();}bins=null;mutable=null;selected.clear();}};
}
