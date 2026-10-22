export function shoulderChunk({p,indices,distance,sample}){
 const count=p.length/3,remap=new Int32Array(count).fill(-1),distances=new Float64Array(count),seen=new Uint8Array(count);
 const positions=new Float32Array(p.length),normals=new Float32Array(p.length),uvs=new Float32Array(count*2),keep=new Uint32Array(indices.length);let vertices=0,indexCount=0;
 const distanceAt=id=>{if(!seen[id]){distances[id]=distance(p[id*3],p[id*3+2]);seen[id]=1;}return distances[id];};
 for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2];
  if(distanceAt(a)>2.3&&distanceAt(b)>2.3&&distanceAt(c)>2.3&&distance((p[a*3]+p[b*3]+p[c*3])/3,(p[a*3+2]+p[b*3+2]+p[c*3+2])/3)>2.3)continue;
  for(let k=0;k<3;k++){const id=indices[i+k];let mapped=remap[id];if(mapped===-1){mapped=vertices++;remap[id]=mapped;
   const x=p[id*3],z=p[id*3+2],ground=sample(x,z),above=ground===null?10000:p[id*3+1]+.045-ground,y=ground??0,dx=(sample(x+.5,z)??y)-(sample(x-.5,z)??y),dz=(sample(x,z+.5)??y)-(sample(x,z-.5)??y),len=Math.hypot(dx,1,dz),j=mapped*3;
   positions[j]=x;positions[j+1]=p[id*3+1]+.060;positions[j+2]=z;normals[j]=-dx/len;normals[j+1]=1/len;normals[j+2]=-dz/len;uvs[mapped*2]=above;
  }keep[indexCount++]=mapped;}
 }
 return indexCount?{p:positions.slice(0,vertices*3),n:normals.slice(0,vertices*3),uv:uvs.slice(0,vertices*2),ix:keep.slice(0,indexCount)}:null;
}
