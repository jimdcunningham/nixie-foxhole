import {Geometry3D,Matrix4,Vector3} from '@pixi/3d';
import {attributeReader} from './geometry-attributes.mjs';
const cache=new WeakMap();
/** Immutable native transforms are shared only while at least one cell owns them. */
export function leaseFlattenedGeometry(source,matrix,keepColors){
 const share=!source.dynamic&&!source.morphTargetCount;
 let entries=share?cache.get(source):undefined;if(share&&!entries)cache.set(source,entries=new Map());
 const key=(keepColors?'colors:':'plain:')+Array.from(matrix.elements).join(',');
 let record=entries?.get(key);
 if(!record){
  matrix=matrix.clone();
  const count=source.vertexCount,positions=new Float32Array(count*3),normals=new Float32Array(count*3),uvs=new Float32Array(count*2),colors=keepColors?new Float32Array(count*4):undefined;
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},point=new Vector3(),normal=new Vector3(),normalMatrix=new Matrix4().getInverse(matrix).transpose();
  const rp=attributeReader(source,'aPosition',3,[0,0,0]),rn=attributeReader(source,'aNormal',3,[0,1,0]),ru=attributeReader(source,'aUV',2,[0,0]),rc=attributeReader(source,'aColor',4,[1,1,1,1]);
  const transform=i=>{point.set(rp(i,0),rp(i,1),rp(i,2)).applyMatrix4(matrix);normal.set(rn(i,0),rn(i,1),rn(i,2)).transformDirection(normalMatrix);};
  for(let i=0;i<count;i++){
   transform(i);positions[i*3]=point.x;positions[i*3+1]=point.y;positions[i*3+2]=point.z;normals[i*3]=normal.x;normals[i*3+1]=normal.y;normals[i*3+2]=normal.z;
   for(let k=0;k<3;k++){const v=k===0?point.x:k===1?point.y:point.z;bounds.min[k]=Math.min(bounds.min[k],v);bounds.max[k]=Math.max(bounds.max[k],v);}
   uvs[i*2]=ru(i,0);uvs[i*2+1]=ru(i,1);if(colors)for(let k=0;k<4;k++)colors[i*4+k]=rc(i,k);
  }
  const indices=new Uint32Array(source.indexBuffer.data);if(matrix.determinant()<0)for(let i=0;i<indices.length;i+=3){const v=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=v;}
  const geometry=new Geometry3D({positions,normals,uvs,...(colors?{colors}:{}),indices,quantizeNormals:false});let vertices;
  record={geometry,bounds,refs:0,get vertices(){return vertices??=Array.from({length:count},(_,i)=>{transform(i);return[point.x,point.y,point.z,normal.x,normal.y,normal.z,ru(i,0),ru(i,1),1,0,0,1,rc(i,0),rc(i,1),rc(i,2),rc(i,3)];});}};
  entries?.set(key,record);
 }
 record.refs++;let released=false;
 return {geometry:record.geometry,bounds:record.bounds,get vertices(){return record.vertices;},release(){if(released)return;released=true;if(--record.refs===0){entries?.delete(key);record.geometry.destroy(true);}}};
}
