import {Geometry3D} from '@pixi/3d';
export function isMirroredTransform(m){return m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2])<0;}
export function reverseTriangleWinding(indices){const reversed=indices.slice();for(let i=0;i<reversed.length;i+=3)[reversed[i+1],reversed[i+2]]=[reversed[i+2],reversed[i+1]];return reversed;}

/** Share vertex buffers; only one reversed index buffer per mirrored prototype/LOD. */
export function createMirroredGeometryCache(){
 const variants=new Map();
 function release(original){
  const entry=variants.get(original);if(!entry)return;
  variants.delete(original);original.off('destroy',entry.release);
  entry.geometry.destroy(false);
  if(!entry.indices.destroyed)entry.indices.destroy();
 }
 return {
  get(original){
   let entry=variants.get(original);
   if(entry&&!entry.geometry.indexBuffer){release(original);entry=null;}
   if(!entry){
    const geometry=new Geometry3D({attributes:original.attributes,indices:reverseTriangleWinding(original.indexBuffer.data),topology:original.topology,indexCount:original.indexCount,bounds3D:original.bounds3D.clone()});
    entry={geometry,indices:geometry.indexBuffer,release:()=>release(original)};
    variants.set(original,entry);original.once('destroy',entry.release);
   }
   return entry.geometry;
  },
  destroy(){for(const original of variants.keys())release(original);}
 };
}
