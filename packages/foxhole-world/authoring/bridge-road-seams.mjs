// Subtract native bridge surfaces from roads, retaining interpolated road attributes.
const CELL=16;
export class BridgeRoadSeams{
 constructor(){this.cells=new Map();this.summary={bridgePlacements:0,surfaceTriangles:0,affectedRoadTriangles:0,removedSquareMetres:0};}
 collect(parts,rows,name){if(!/bridge/i.test(name)||/proxy|collision|switch/i.test(name))return;
  for(const row of rows){this.summary.bridgePlacements++;const m=row.matrix,normalScale=Math.max(1e-9,Math.hypot(m[1],m[5],m[9]));for(const part of parts){
   // Float64 scratch preserves the original JavaScript projection exactly.
   // Only accepted surface points escape; rejected triangles allocate nothing.
   const vertices=part.vertices,indices=part.indices,count=vertices.length,projected=new Float64Array(count*3),normalY=new Float64Array(count),points=new Array(count);
   for(let i=0;i<count;i++){const p=vertices[i],at=i*3;projected[at]=m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12];projected[at+1]=m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13];projected[at+2]=m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14];normalY[i]=(m[1]*p[3]+m[5]*p[4]+m[9]*p[5])/normalScale;}
   const point=i=>{const at=i*3;return points[i]??=[projected[at],projected[at+1],projected[at+2]];};
   for(let i=0;i<indices.length;i+=3){const ia=indices[i],ib=indices[i+1],ic=indices[i+2];if(!Number.isInteger(ia)||!Number.isInteger(ib)||!Number.isInteger(ic)||ia<0||ib<0||ic<0||ia>=count||ib>=count||ic>=count)throw new RangeError('Bridge triangle index outside vertex data');
   const ai=ia*3,bi=ib*3,ci=ic*3,ax=projected[ai],ay=projected[ai+1],az=projected[ai+2],bx=projected[bi],by=projected[bi+1],bz=projected[bi+2],cx=projected[ci],cy=projected[ci+1],cz=projected[ci+2],det=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);if(Math.abs(det)<.02)continue;
   // Accept upward surfaces only, avoiding vertical walls and their projections.
   const ny=(0+normalY[ia]+normalY[ib]+normalY[ic])/3;if(ny<.5)continue;
   const x=((by-ay)*(cz-az)-(cy-ay)*(bz-az))/det,z=((bx-ax)*(cy-ay)-(cx-ax)*(by-ay))/det,d=ay-x*ax-z*az;
   const surface={t:[point(ia),point(ib),point(ic)],x,z,d,minX:Math.min(ax,bx,cx),maxX:Math.max(ax,bx,cx),minZ:Math.min(az,bz,cz),maxZ:Math.max(az,bz,cz)};this.summary.surfaceTriangles++;
   for(let gx=Math.floor(surface.minX/CELL);gx<=Math.floor(surface.maxX/CELL);gx++)for(let gz=Math.floor(surface.minZ/CELL);gz<=Math.floor(surface.maxZ/CELL);gz++){const key=gx+','+gz;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(surface);}
  }}}
 }
 cut({p,n,uv,indices,offset=.045}){if(!this.cells.size)return{p,n,uv,indices};const positions=[],normals=[],uvs=[],out=[];let near=false,loX=Infinity,hiX=-Infinity,loZ=Infinity,hiZ=-Infinity;for(let i=0;i<p.length;i+=3){loX=Math.min(loX,p[i]);hiX=Math.max(hiX,p[i]);loZ=Math.min(loZ,p[i+2]);hiZ=Math.max(hiZ,p[i+2]);}for(let x=Math.floor(loX/CELL);x<=Math.floor(hiX/CELL)&&!near;x++)for(let z=Math.floor(loZ/CELL);z<=Math.floor(hiZ/CELL);z++)if(this.cells.has(x+','+z)){near=true;break;}if(!near)return{p,n,uv,indices};
  const area=t=>Math.abs((t[1][0]-t[0][0])*(t[2][2]-t[0][2])-(t[1][2]-t[0][2])*(t[2][0]-t[0][0]))/2;
  for(let i=0;i<indices.length;i+=3){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,minX=Math.min(p[a],p[b],p[c]),maxX=Math.max(p[a],p[b],p[c]),minZ=Math.min(p[a+2],p[b+2],p[c+2]),maxZ=Math.max(p[a+2],p[b+2],p[c+2]),candidates=new Set();
   for(let gx=Math.floor(minX/CELL);gx<=Math.floor(maxX/CELL);gx++)for(let gz=Math.floor(minZ/CELL);gz<=Math.floor(maxZ/CELL);gz++)for(const s of this.cells.get(gx+','+gz)||[])if(s.minX<=maxX&&s.maxX>=minX&&s.minZ<=maxZ&&s.maxZ>=minZ)candidates.add(s);
   if(!candidates.size){out.push(indices[i],indices[i+1],indices[i+2]);continue;}
   const original=[0,1,2].map(k=>{const id=indices[i+k];return [...p.subarray(id*3,id*3+3),...n.subarray(id*3,id*3+3),...uv.subarray(id*2,id*2+2)];});
   let pieces=[original],before=area(original);
   for(const s of candidates){const planes=[];const sign=Math.sign((s.t[1][0]-s.t[0][0])*(s.t[2][2]-s.t[0][2])-(s.t[1][2]-s.t[0][2])*(s.t[2][0]-s.t[0][0]));for(let k=0;k<3;k++){const a=s.t[k],b=s.t[(k+1)%3];planes.push(v=>sign*((b[0]-a[0])*(v[2]-a[2])-(b[2]-a[2])*(v[0]-a[0])));}
    // Only remove the overlapping road layer; roads under elevated bridges remain.
    planes.push(v=>v[1]+offset-(s.x*v[0]+s.z*v[2]+s.d)+.15,v=>.10-(v[1]+offset-(s.x*v[0]+s.z*v[2]+s.d)));
    const remaining=[];for(const piece of pieces){if(planes.some(plane=>piece.every(v=>plane(v)<1e-8))){remaining.push(piece);continue;}let inside=piece;for(const plane of planes){const yes=[],no=[];for(let k=0;k<inside.length;k++){const a=inside[k],b=inside[(k+1)%inside.length],da=plane(a),db=plane(b),ia=da>=0,ib=db>=0;(ia?yes:no).push(a);if(ia!==ib){const f=da/(da-db),v=a.map((x,k)=>x+(b[k]-x)*f);yes.push(v);no.push(v);}}if(no.length>=3)remaining.push(no);inside=yes;if(inside.length<3)break;}}pieces=remaining;if(!pieces.length)break;
   }
   const triangles=[];let after=0;for(const piece of pieces)for(let k=1;k<piece.length-1;k++){const t=[piece[0],piece[k],piece[k+1]],a=area(t);if(a<1e-9)continue;after+=a;triangles.push(t);}
   if(before-after>1e-6){this.summary.affectedRoadTriangles++;this.summary.removedSquareMetres+=before-after;for(const t of triangles)for(const v of t){out.push(p.length/3+positions.length/3);positions.push(...v.slice(0,3));normals.push(...v.slice(3,6));uvs.push(...v.slice(6,8));}}else out.push(indices[i],indices[i+1],indices[i+2]);
  }
  if(!positions.length&&out.length===indices.length)return{p,n,uv,indices};const join=(a,b)=>{const v=new Float32Array(a.length+b.length);v.set(a);v.set(b,a.length);return v;};return{p:join(p,positions),n:join(n,normals),uv:join(uv,uvs),indices:new Uint32Array(out)};
 }
}
