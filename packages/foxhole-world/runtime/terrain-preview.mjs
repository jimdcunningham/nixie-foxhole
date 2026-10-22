import {WIDTH,HEIGHT,clipMesh} from '../authoring/terrain-tools.mjs';

/** Bounded loading-only relief. Native terrain stays in the direct terrain pass. */
export function buildTerrainPreview(sample){
 const nx=128,nz=Math.ceil(nx*HEIGHT/WIDTH),stride=nx+1,heights=new Float64Array(stride*(nz+1)),valid=new Uint8Array(heights.length),positions=new Float32Array(heights.length*3),normals=new Float32Array(positions.length),indices=[];
 const dx=WIDTH/nx,dz=HEIGHT/nz;
 for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){const i=z*stride+x,px=x*dx-WIDTH/2,pz=z*dz-HEIGHT/2,h=sample(px,pz);valid[i]=h!==null&&Number.isFinite(h)?1:0;heights[i]=valid[i]?h:0;positions.set([px,heights[i],pz],i*3);}
 for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){const i=z*stride+x,left=x&&valid[i-1]?i-1:i,right=x<nx&&valid[i+1]?i+1:i,back=z&&valid[i-stride]?i-stride:i,front=z<nz&&valid[i+stride]?i+stride:i;const a=(heights[left]-heights[right])/Math.max(dx,((right-left)||1)*dx),b=(heights[back]-heights[front])/Math.max(dz,((front-back)/stride||1)*dz),n=Math.hypot(a,1,b);normals.set([a/n,1/n,b/n],i*3);}
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const a=z*stride+x,b=a+1,c=a+stride,d=c+1;if(valid[a]&&valid[c]&&valid[b])indices.push(a,c,b);if(valid[b]&&valid[c]&&valid[d])indices.push(b,c,d);}
 return clipMesh(positions,normals,new Uint32Array(indices));
}
