export function buildMesh(meta, source, step) {
  const started=performance.now();
  const samples=n=>{const a=[];for(let i=0;i<n-1;i+=step)a.push(i);a.push(n-1);return a};
  const count=meta.components.reduce((v,c)=>v+samples(c.size).length**2,0);
  const tris=meta.components.reduce((v,c)=>v+2*(samples(c.size).length-1)**2,0);
  const positions=new Float32Array(count*3), normals=new Float32Array(count*3), indices=new Uint32Array(tris*3),chunks=[];
  let vo=0,io=0, maxError=0,sumError2=0,errorCount=0;
  for(const c of meta.components){
    const axis=samples(c.size), n=axis.length,base=vo,indexStart=io;
    const at=(x,y,a)=>source[(c.offset+y*c.size+x)*3+a];
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const y of axis)for(const x of axis){
      const p=vo*3;
      for(let a=0;a<3;a++){const v=at(x,y,a);positions[p+a]=v;min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v)}
      const x0=Math.max(x-1,0),x1=Math.min(x+1,c.size-1),y0=Math.max(y-1,0),y1=Math.min(y+1,c.size-1);
      const ux=at(x1,y,0)-at(x0,y,0),uy=at(x1,y,1)-at(x0,y,1),uz=at(x1,y,2)-at(x0,y,2);
      const vx=at(x,y1,0)-at(x,y0,0),vy=at(x,y1,1)-at(x,y0,1),vz=at(x,y1,2)-at(x,y0,2);
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx, len=Math.hypot(nx,ny,nz);if(ny<0)len=-len;
      normals.set([nx/len,ny/len,nz/len],p);vo++;
    }
    for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){
      const a=base+y*n+x,b=a+1,d=a+n,e=d+1;
      indices.set([a,b,d,b,e,d],io);io+=6;
      if(step>1)for(let sy=axis[y];sy<=axis[y+1];sy++)for(let sx=axis[x];sx<=axis[x+1];sx++){
        const fx=(sx-axis[x])/(axis[x+1]-axis[x]),fy=(sy-axis[y])/(axis[y+1]-axis[y]);
        const h00=at(axis[x],axis[y],1),h10=at(axis[x+1],axis[y],1),h01=at(axis[x],axis[y+1],1),h11=at(axis[x+1],axis[y+1],1);
        const predicted=fx+fy<=1?h00+(h10-h00)*fx+(h01-h00)*fy:h11+(h01-h11)*(1-fx)+(h10-h11)*(1-fy);
        const err=Math.abs(predicted-at(sx,sy,1));maxError=Math.max(maxError,err);sumError2+=err*err;errorCount++;
      }
    }
    chunks.push({name:c.name,indexStart,count:io-indexStart,min,max});
  }
  return {positions,normals,indices,chunks,stats:{step,vertices:count,triangles:tris,bufferBytes:positions.byteLength+normals.byteLength+indices.byteLength,maxHeightErrorMeters:maxError,rmsHeightErrorMeters:Math.sqrt(sumError2/Math.max(1,errorCount)),buildMs:performance.now()-started}};
}

export function makeGlb(meta,mesh){
  const {positions,normals,indices}=mesh, sizes=[positions.byteLength,normals.byteLength,indices.byteLength];
  const actualMin=[Infinity,Infinity,Infinity],actualMax=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i++){const axis=i%3;actualMin[axis]=Math.min(actualMin[axis],positions[i]);actualMax[axis]=Math.max(actualMax[axis],positions[i]);}
  const bin=new Uint8Array(sizes.reduce((a,b)=>a+b,0));let offset=0;
  for(const array of [positions,normals,indices]){bin.set(new Uint8Array(array.buffer),offset);offset+=array.byteLength}
  const gltf={asset:{version:'2.0',generator:'Disposable FoxWatch terrain probe'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:meta.map.split('/').pop(),mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]}],materials:[{name:'Unpainted Terrain',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[0.52,0.58,0.48,1],metallicFactor:0,roughnessFactor:1}}],buffers:[{byteLength:bin.length}],bufferViews:sizes.map((n,i)=>({buffer:0,byteOffset:sizes.slice(0,i).reduce((a,b)=>a+b,0),byteLength:n,target:i===2?34963:34962})),accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:meta.min,max:meta.max},{bufferView:1,componentType:5126,count:normals.length/3,type:'VEC3'},{bufferView:2,componentType:5125,count:indices.length,type:'SCALAR'}]};
  gltf.accessors[0].min=actualMin;gltf.accessors[0].max=actualMax;
  let json=new TextEncoder().encode(JSON.stringify(gltf));const jp=new Uint8Array(Math.ceil(json.length/4)*4);jp.fill(32);jp.set(json);
  const result=new Uint8Array(12+8+jp.length+8+bin.length),header=new DataView(result.buffer);
  header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,result.length,true);header.setUint32(12,jp.length,true);header.setUint32(16,0x4e4f534a,true);result.set(jp,20);header.setUint32(20+jp.length,bin.length,true);header.setUint32(24+jp.length,0x004e4942,true);result.set(bin,28+jp.length);return result;
}
