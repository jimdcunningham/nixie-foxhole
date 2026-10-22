// Only the LOD selector's changed rows are uploaded. Preserve native batching,
// frustum culling, shadow membership and every transform/material lane exactly.
export function uploadLodVisibility(store,min,max,rows){
 const buffer=store._buffer;
 const fallback=()=>{store.markDirtyRange(min,max);return {sparse:false,bytes:(max-min+1)*store.stride*4};};
 // Retain a per-store diagnostic baseline without changing LOD selection.
 if(store.foxholeSparseLodUploads===false||!buffer||store._textureSource||!Object.values(buffer._gpuData||{}).some(value=>value.gpuBuffer))return fallback();
 // Do not replace pending native matrix/material updates with visibility work.
 store.update();
 if(buffer._updateID)return fallback();
 rows.sort((a,b)=>a-b);const ranges=[];let start=rows[0],end=start;
 for(let i=1;i<rows.length;i++){const row=rows[i];if(row-end<=4)end=row;else{ranges.push([start,end]);start=end=row;}}
 ranges.push([start,end]);
 if(ranges.length>256)return fallback();
 let bytes=0;
 for(const [a,z]of ranges){const count=(z-a+1)*store.stride*4;buffer.update(count,a*store.stride*4);bytes+=count;if(buffer._updateID)return fallback();}
 return {sparse:true,bytes,ranges:ranges.length};
}
