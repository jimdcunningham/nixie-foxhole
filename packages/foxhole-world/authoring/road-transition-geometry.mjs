const dotUV=(fit,x,z)=>fit[0]*x+fit[1]*z+fit[2];
export function partitionRoadChunk({chunk,p,n,uv,indices,joins}){
  let transitionTriangles=0;const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<p.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[i+k]);max[k]=Math.max(max[k],p[i+k]);}
  const candidates=joins.filter(j=>(j.a===chunk.material||j.b===chunk.material)&&j.p[0]>=min[0]-10&&j.p[0]<=max[0]+10&&j.p[2]>=min[2]-10&&j.p[2]<=max[2]+10&&j.p[1]>=min[1]-2&&j.p[1]<=max[1]+2),groups=new Map();
  if(!candidates.length){groups.set('base',{join:null,p,n,uv,ix:indices});return{groups,transitionTriangles};}
  const joinIndices=new Map(joins.map((join,index)=>[join,index]));
  for(let i=0;i<indices.length;i+=3){const ids=[indices[i],indices[i+1],indices[i+2]],a=ids[0]*3,b=ids[1]*3,c=ids[2]*3;let nearest=null,best=Infinity;
   for(const j of candidates){
    const ax=p[a]-j.p[0],az=p[a+2]-j.p[2],bx=p[b]-j.p[0],bz=p[b+2]-j.p[2],cx=p[c]-j.p[0],cz=p[c+2]-j.p[2],u=j.axis[0],v=j.axis[1];
    const d0=ax*u+az*v-j.bias,d1=bx*u+bz*v-j.bias,d2=cx*u+cz*v-j.bias;
    if(Math.min(d0,d1,d2)>5.5||Math.max(d0,d1,d2)<-5.5)continue;
    const s0=-ax*v+az*u,s1=-bx*v+bz*u,s2=-cx*v+cz*u;
    if(Math.min(s0,s1,s2)>8||Math.max(s0,s1,s2)<-8)continue;
    const y0=p[a+1]-j.p[1],y1=p[b+1]-j.p[1],y2=p[c+1]-j.p[1];
    if(Math.min(y0,y1,y2)>2||Math.max(y0,y1,y2)<-2)continue;
    const distance=Math.abs((d0+d1+d2)/3)+Math.abs((s0+s1+s2)/3)*.1;
    if(distance<best){nearest=j;best=distance;}
   }
   const key=nearest?nearest.a+'|'+nearest.b:'base';let g=groups.get(key);if(!g){g={join:nearest,p:[],n:[],uv:[],extra:[],native:[],ix:[],remap:new Map()};groups.set(key,g);}for(const id of ids){const vertexKey=nearest?joinIndices.get(nearest)+':'+id:id;if(!g.remap.has(vertexKey)){g.remap.set(vertexKey,g.p.length/3);g.p.push(p[id*3],p[id*3+1],p[id*3+2]);g.n.push(n[id*3],n[id*3+1],n[id*3+2]);if(nearest){const j=nearest,x=p[id*3]-j.p[0],z=p[id*3+2]-j.p[2],isB=chunk.material===j.b;g.uv.push(dotUV(j.uvA.u,x,z),dotUV(j.uvA.v,x,z));g.native.push(uv[id*2],uv[id*2+1],0,1);g.extra.push(dotUV(j.uvB.u,x,z),dotUV(j.uvB.v,x,z),x*j.axis[0]+z*j.axis[1]-j.bias,isB?1:0);}else g.uv.push(uv[id*2],uv[id*2+1]);}g.ix.push(g.remap.get(vertexKey));}if(nearest)transitionTriangles++;
  }

return{groups,transitionTriangles};
}
