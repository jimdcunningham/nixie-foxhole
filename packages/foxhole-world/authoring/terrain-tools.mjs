export const WIDTH=2184,HEIGHT=1890;
export const planes=[[1,HEIGHT?WIDTH/4/(HEIGHT/2):0,WIDTH/2],[1,-WIDTH/4/(HEIGHT/2),WIDTH/2],[-1,WIDTH/4/(HEIGHT/2),WIDTH/2],[-1,-WIDTH/4/(HEIGHT/2),WIDTH/2],[0,1,HEIGHT/2],[0,-1,HEIGHT/2]];
export const mapPoint=(x,y)=>[x*WIDTH-WIDTH/2,HEIGHT/2-y*HEIGHT];
export const normalizedPoint=(x,z)=>[(x+WIDTH/2)/WIDTH,(HEIGHT/2-z)/HEIGHT];
export const inHex=(x,z,tolerance=1e-5)=>planes.every(([a,b,c])=>a*x+b*z<=c+tolerance);
export function clipPolygon(polygon,plane){const[a,b,c]=plane,out=[];for(let i=0;i<polygon.length;i++){const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=a*p[0]+b*p[2]-c,dq=a*q[0]+b*q[2]-c;if(dp<=1e-8)out.push(p);if((dp<=0)!==(dq<=0)){const t=dp/(dp-dq);out.push(p.map((v,i)=>v+(q[i]-v)*t));}}return out;}
export function clipMesh(positions,normals,indices){
 const p=Array.from(positions),n=Array.from(normals),out=[];let clipped=0,rejected=0;
 for(let i=0;i<indices.length;i+=3){const ids=[indices[i],indices[i+1],indices[i+2]],v=ids.map(id=>[...positions.subarray(id*3,id*3+3),...normals.subarray(id*3,id*3+3)]);if(v.every(v=>inHex(v[0],v[2]))){out.push(...ids);continue}if(planes.some(([a,b,c])=>v.every(v=>a*v[0]+b*v[2]>c+1e-6))){rejected++;continue}let poly=v;for(const plane of planes){poly=clipPolygon(poly,plane);if(poly.length<3)break}if(poly.length<3){rejected++;continue}clipped++;const base=p.length/3;for(const v of poly){p.push(...v.slice(0,3));const len=Math.hypot(...v.slice(3));n.push(...v.slice(3).map(x=>x/len))}for(let j=1;j<poly.length-1;j++)out.push(base,base+j,base+j+1);}
 const remap=new Map(),pos=[],nor=[],ix=new Uint32Array(out.length);for(let i=0;i<out.length;i++){const id=out[i];if(!remap.has(id)){remap.set(id,pos.length/3);pos.push(p[id*3],p[id*3+1],p[id*3+2]);nor.push(n[id*3],n[id*3+1],n[id*3+2])}ix[i]=remap.get(id)}
 return{positions:new Float32Array(pos),normals:new Float32Array(nor),indices:ix,clipped,rejected};
}
// Recipe v1 pins this legacy grid for byte-exact reconstruction. Scene height
// queries use terrainSurfaceSampler in terrain-surface.mjs instead.
export function heightSampler(meta,source){const width=Math.round(meta.max[0]-meta.min[0])+1,height=Math.round(meta.max[2]-meta.min[2])+1,grid=new Float32Array(width*height);grid.fill(NaN);for(let i=0;i<source.length;i+=3){const x=Math.round(source[i]-meta.min[0]),z=Math.round(source[i+2]-meta.min[2]);grid[z*width+x]=source[i+1]}
 return(x,z)=>{const gx=x-meta.min[0],gz=z-meta.min[2],ix=Math.floor(gx),iz=Math.floor(gz);if(ix<0||iz<0||ix>=width-1||iz>=height-1)return null;const fx=gx-ix,fz=gz-iz,values=[grid[iz*width+ix],grid[iz*width+ix+1],grid[(iz+1)*width+ix],grid[(iz+1)*width+ix+1]];if(values.some(x=>!Number.isFinite(x)))return values.find(Number.isFinite)??null;return fx<=fz?values[0]*(1-fz)+values[2]*(fz-fx)+values[3]*fx:values[0]*(1-fx)+values[1]*(fx-fz)+values[3]*fz};
}
export function parseGlb(buffer){const d=new DataView(buffer),length=d.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length))),start=28+length;return{json,view:i=>{const a=json.accessors[i],v=json.bufferViews[a.bufferView],offset=start+(v.byteOffset||0)+(a.byteOffset||0),count=a.count*({VEC3:3,VEC2:2,SCALAR:1}[a.type]);return a.componentType===5126?new Float32Array(buffer,offset,count):new Uint32Array(buffer,offset,count)}}}
