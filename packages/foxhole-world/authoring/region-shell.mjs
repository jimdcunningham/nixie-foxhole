import {REGION_SHELL_FLOOR,REGION_SHELL_THICKNESS} from './region-shell-size.mjs';
export {REGION_SHELL_FLOOR,REGION_SHELL_THICKNESS};
export const REGION_SHELL_COLOR=0x191919;
// Shared offline/runtime geometry: the rim is the upper envelope of actual
// triangle cuts, rather than an AABB or regularly sampled height approximation.
export const corners=[[-1092,0],[-546,945],[546,945],[1092,0],[546,-945],[-546,-945]];
export const edges=corners.map((a,i)=>{const b=corners[(i+1)%6],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);return{a,b,dx,dz,length,nx:-dz/length,nz:dx/length};});
// Give cut faces a small depth priority at coincident terrain edges.
// Only depth changes: silhouettes, world positions and the bottom stay exact.
export const shellDepthBit={name:'regionShellCutDepth',bindings:{material:{shellDepthBias:'f32'}},gpu:{vertex:{end:'if(abs(worldNormal.y)<0.5){clipPosition.z-=material.shellDepthBias*clipPosition.w;}'}},gl:{vertex:{end:'if(abs(worldNormal.y)<0.5){gl_Position.z-=material.shellDepthBias*2.0*gl_Position.w;}'}}};
export function triangleCuts(tri,output,kind){
 for(let e=0;e<6;e++){
  const edge=edges[e],d=tri.map(p=>{const v=(p[0]-edge.a[0])*edge.nx+(p[2]-edge.a[1])*edge.nz;return Math.abs(v)<.0002?0:v;});
  if(d.every(v=>v>1e-5)||d.every(v=>v< -1e-5))continue;
  const points=[];
  for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3],da=d[i],db=d[(i+1)%3];if(Math.abs(da)<1e-5)points.push(a);if(da*db<0){const t=da/(da-db);points.push(a.map((v,k)=>v+(b[k]-v)*t));}}
  const projected=points.map(p=>[((p[0]-edge.a[0])*edge.dx+(p[2]-edge.a[1])*edge.dz)/edge.length,p[1]]);
  // Coplanar faces can contribute three edges; the envelope selects the top.
  for(let i=0;i<projected.length;i++)for(let j=i+1;j<projected.length;j++){
   let [a,b]=[projected[i],projected[j]];if(a[0]>b[0])[a,b]=[b,a];
   if(b[0]-a[0]<1e-7||b[0]<=0||a[0]>=edge.length)continue;
   const slope=(b[1]-a[1])/(b[0]-a[0]),lo=Math.max(0,a[0]),hi=Math.min(edge.length,b[0]);
   output[e].push([lo,a[1]+(lo-a[0])*slope,hi,a[1]+(hi-a[0])*slope,kind]);
  }
 }
}
const at=(s,t)=>s[1]+(s[3]-s[1])*(t-s[0])/(s[2]-s[0]);
export function upperEnvelope(segments,edge,fallback){
 const bins=Array.from({length:Math.ceil(edge.length)},()=>[]),pieces=[];
 for(const s of segments)for(let b=Math.floor(s[0]);b<=Math.min(bins.length-1,Math.floor(s[2]));b++)bins[b].push(s);
 for(let b=0;b<bins.length;b++){
  const lo=b,hi=Math.min(b+1,edge.length),ss=bins[b],breaks=[lo,hi];
  for(const s of ss){if(s[0]>lo&&s[0]<hi)breaks.push(s[0]);if(s[2]>lo&&s[2]<hi)breaks.push(s[2]);}
  for(let i=0;i<ss.length;i++)for(let j=i+1;j<ss.length;j++){
   const a=ss[i],c=ss[j],l=Math.max(lo,a[0],c[0]),h=Math.min(hi,a[2],c[2]);if(h<=l)continue;
   const dl=at(a,l)-at(c,l),dh=at(a,h)-at(c,h);if(dl*dh<0)breaks.push(l+(h-l)*dl/(dl-dh));
  }
  breaks.sort((a,b)=>a-b);
  for(let i=0;i<breaks.length-1;i++){
   const l=breaks[i],h=breaks[i+1];if(h-l<1e-7)continue;const mid=(l+h)/2;
   let best=null,y=-Infinity;for(const s of ss)if(mid>=s[0]&&mid<=s[2]){const v=at(s,mid);if(v>y){y=v;best=s;}}
   const piece=best?[l,at(best,l),h,at(best,h),best[4]]:[l,fallback(l),h,fallback(h),'terrain-fallback'];
   const prev=pieces.at(-1);
   if(prev&&prev[4]===piece[4]&&Math.abs(prev[2]-l)<1e-6&&Math.abs(prev[3]-piece[1])<1e-6&&Math.abs((prev[3]-prev[1])/(prev[2]-prev[0])-(piece[3]-piece[1])/(h-l))<1e-7){prev[2]=h;prev[3]=piece[3];}else pieces.push(piece);
  }
 }
 return pieces;
}
export function buildRegionShell(profile){
 // Keep the playable hex and floor exact; thickness extends outward and below.
 const floor=REGION_SHELL_FLOOR,thickness=REGION_SHELL_THICKNESS,bottom=floor-thickness,top=45;
 const positions=[],normals=[],indices=[],wallIndices=[],floorIndices=[];
 const outerCorners=corners.map((p,i)=>{
  const previous=edges[(i+5)%6],next=edges[i],nx=previous.nx+next.nx,nz=previous.nz+next.nz;
  const scale=thickness/(nx*next.nx+nz*next.nz);
  return[p[0]+nx*scale,p[1]+nz*scale];
 });
 const point=(a,b,u,y)=>[Math.fround(a[0]+(b[0]-a[0])*u),y,Math.fround(a[1]+(b[1]-a[1])*u)];
 const tri=(a,b,c,n)=>{
  const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
  const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
  if(Math.hypot(...cross)<1e-8)return;
  if(cross.reduce((sum,v,i)=>sum+v*n[i],0)<0)[b,c]=[c,b];
  const base=positions.length/3;positions.push(...a,...b,...c);normals.push(...n,...n,...n);indices.push(base,base+1,base+2);
 };
 const quad=(a,b,c,d,n)=>{tri(a,b,c,n);tri(a,c,d,n);};
 // The rim is level, so each hex edge can be one solid wall. Sharing the
 // mitered outer corners closes the joints without cracks or overlapping boxes.
 for(let i=0;i<6;i++){
  const e=edges[i],outerA=outerCorners[i],outerB=outerCorners[(i+1)%6];
  const a=point(e.a,e.b,0,top),b=point(e.a,e.b,1,top),af=[a[0],floor,a[2]],bf=[b[0],floor,b[2]];
  const oa=point(outerA,outerB,0,top),ob=point(outerA,outerB,1,top),oaBottom=[oa[0],bottom,oa[2]],obBottom=[ob[0],bottom,ob[2]];
  const start=indices.length;
  quad(af,bf,b,a,[-e.nx,0,-e.nz]);
  quad(oaBottom,obBottom,ob,oa,[e.nx,0,e.nz]);
  quad(a,b,ob,oa,[0,1,0]);
  wallIndices.push(new Uint32Array(indices.slice(start)));const floorStart=indices.length;
  tri([0,floor,0],af,bf,[0,1,0]);
  tri([0,bottom,0],obBottom,oaBottom,[0,-1,0]);
  floorIndices.push(...indices.slice(floorStart));
 }
 return{positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices),wallIndices,floorIndices:new Uint32Array(floorIndices),summary:{floor,bottom,thickness,topMin:top,topMax:top,triangles:indices.length/3,segments:6,sealMetres:0,profile:profile.summary}};
}
